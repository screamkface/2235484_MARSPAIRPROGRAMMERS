"""Ingestion service for the Mars habitat automation platform.

Responsibilities:
- discover REST sensors from the simulator;
- poll sensor endpoints at fixed intervals;
- normalize heterogeneous payloads to a unified event schema;
- publish events to RabbitMQ for downstream processing.
"""

import asyncio
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urljoin

import aio_pika
import httpx
from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

# FastAPI app exposing only operational endpoints (health) while the main work
# runs in the background polling task.
app = FastAPI(
    title="Ingestion Service",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

# Runtime configuration (overridable from docker-compose / environment).
SIMULATOR_BASE_URL = os.getenv("SIMULATOR_BASE_URL", "http://simulator:8080")
RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")
RABBITMQ_EXCHANGE = os.getenv("RABBITMQ_EXCHANGE", "mars.events")
RABBITMQ_ROUTING_KEY = os.getenv("RABBITMQ_ROUTING_KEY", "sensor.reading")
POLL_INTERVAL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "5"))
RABBITMQ_RECONNECT_DELAY_SECONDS = int(os.getenv("RABBITMQ_RECONNECT_DELAY_SECONDS", "3"))

# Static mapping used to label known sensors with their schema family.
SENSOR_SCHEMA_MAP = {
    "greenhouse_temperature": "rest.scalar.v1",
    "entrance_humidity": "rest.scalar.v1",
    "co2_hall": "rest.scalar.v1",
    "hydroponic_ph": "rest.chemistry.v1",
    "water_tank_level": "rest.level.v1",
    "corridor_pressure": "rest.scalar.v1",
    "air_quality_pm25": "rest.particulate.v1",
    "air_quality_voc": "rest.chemistry.v1",
}


class SensorTarget(BaseModel):
    """A normalized sensor discovery record used by the polling loop."""

    name: str
    url: str
    schema_family: str | None = None


# Exposed health/runtime metrics for quick observability.
state = {
    "rabbitmq_connected": False,
    "discovered_sensors": [],
    "discovery_source": None,
    "published_count": 0,
    "last_poll_at": None,
    "last_error": None,
}

# Shared runtime handles for background tasks and broker resources.
polling_task: asyncio.Task | None = None
rabbitmq_connection: aio_pika.RobustConnection | None = None
rabbitmq_channel: aio_pika.abc.AbstractChannel | None = None
rabbitmq_exchange: aio_pika.abc.AbstractExchange | None = None


def resource_is_open(resource: Any) -> bool:
    """Return True if an aio-pika resource exists and is not closed."""

    if resource is None:
        return False

    return not bool(getattr(resource, "is_closed", False))


def simulator_url(path: str) -> str:
    """Build an absolute simulator URL from a relative path."""

    return f"{SIMULATOR_BASE_URL.rstrip('/')}/{path.lstrip('/')}"


def now_iso() -> str:
    """Return current UTC timestamp in ISO-8601 format."""

    return datetime.now(timezone.utc).isoformat()


def extract_value_and_unit(raw_payload: Any) -> tuple[Any, str | None]:
    """Extract a canonical (value, unit) pair from heterogeneous sensor payloads.

    If no single obvious value exists, return the whole payload as value so no
    information is lost.
    """

    if not isinstance(raw_payload, dict):
        return raw_payload, None

    unit = raw_payload.get("unit")

    preferred_keys = [
        "value",
        "reading",
        "temperature",
        "humidity",
        "pressure",
        "ph",
        "pm25",
        "voc",
        "level",
        "co2",
    ]

    for key in preferred_keys:
        if key in raw_payload:
            return raw_payload[key], unit

    numeric_candidates = [
        value
        for key, value in raw_payload.items()
        if isinstance(value, (int, float)) and key not in {"timestamp", "ts"}
    ]

    if len(numeric_candidates) == 1:
        return numeric_candidates[0], unit

    # Fallback: preserve full payload if a scalar value cannot be inferred.
    return raw_payload, unit


def normalize_sensor_list(raw: Any) -> list[SensorTarget]:
    """Normalize simulator discovery responses into a uniform list of targets.

    The simulator may expose different response shapes; this function makes the
    polling loop independent from those shape differences.
    """

    items: list[Any]

    if isinstance(raw, list):
        items = raw
    elif isinstance(raw, dict):
        if isinstance(raw.get("sensors"), list):
            items = raw["sensors"]
        elif isinstance(raw.get("items"), list):
            items = raw["items"]
        elif isinstance(raw.get("data"), list):
            items = raw["data"]
        else:
            items = []
    else:
        items = []

    targets: list[SensorTarget] = []

    for item in items:
        if isinstance(item, str):
            # Discovery payload may be a plain list of sensor names.
            sensor_name = item
            targets.append(
                SensorTarget(
                    name=sensor_name,
                    url=simulator_url(f"/api/sensors/{sensor_name}"),
                    schema_family=SENSOR_SCHEMA_MAP.get(sensor_name),
                )
            )
            continue

        if isinstance(item, dict):
            sensor_name = (
                item.get("name")
                or item.get("id")
                or item.get("sensor_name")
                or item.get("identifier")
            )
            if not sensor_name:
                continue

            # URL may be absent or relative depending on simulator response.
            raw_url = (
                item.get("url")
                or item.get("href")
                or item.get("path")
                or item.get("endpoint")
            )

            if raw_url:
                sensor_url = raw_url if raw_url.startswith("http") else urljoin(f"{SIMULATOR_BASE_URL}/", raw_url.lstrip("/"))
            else:
                sensor_url = simulator_url(f"/api/sensors/{sensor_name}")

            targets.append(
                SensorTarget(
                    name=sensor_name,
                    url=sensor_url,
                    schema_family=item.get("schema_family") or item.get("schema_id") or SENSOR_SCHEMA_MAP.get(sensor_name),
                )
            )

    return targets


def normalize_discovery_sensors(raw: Any) -> list[SensorTarget]:
    """Normalize `/api/discovery` REST sensor entries into SensorTarget records."""

    if not isinstance(raw, dict):
        return []

    items = raw.get("rest_sensors")
    if not isinstance(items, list):
        return []

    targets: list[SensorTarget] = []
    for item in items:
        if not isinstance(item, dict):
            continue

        sensor_name = item.get("sensor_id") or item.get("name") or item.get("id")
        if not sensor_name:
            continue

        raw_path = item.get("path") or item.get("url") or item.get("href") or item.get("endpoint")
        if isinstance(raw_path, str) and raw_path:
            sensor_url = raw_path if raw_path.startswith("http") else urljoin(f"{SIMULATOR_BASE_URL}/", raw_path.lstrip("/"))
        else:
            sensor_url = simulator_url(f"/api/sensors/{sensor_name}")

        targets.append(
            SensorTarget(
                name=sensor_name,
                url=sensor_url,
                schema_family=item.get("schema_id") or item.get("schema_family") or SENSOR_SCHEMA_MAP.get(sensor_name),
            )
        )

    return targets


async def ensure_rabbitmq(force_reconnect: bool = False):
    """Ensure a live RabbitMQ connection/channel/exchange.

    If `force_reconnect` is true, existing resources are recreated.
    """

    global rabbitmq_connection, rabbitmq_channel, rabbitmq_exchange

    if (
        not force_reconnect
        and resource_is_open(rabbitmq_connection)
        and resource_is_open(rabbitmq_channel)
        and rabbitmq_exchange is not None
    ):
        return

    while True:
        try:
            if resource_is_open(rabbitmq_connection):
                await rabbitmq_connection.close()

            rabbitmq_connection = await aio_pika.connect_robust(RABBITMQ_URL)
            rabbitmq_channel = await rabbitmq_connection.channel()
            rabbitmq_exchange = await rabbitmq_channel.declare_exchange(
                RABBITMQ_EXCHANGE,
                aio_pika.ExchangeType.TOPIC,
                durable=True,
            )
            state["rabbitmq_connected"] = True
            state["last_error"] = None
            print("Connected to RabbitMQ")
            return
        except Exception as e:
            state["rabbitmq_connected"] = False
            state["last_error"] = f"RabbitMQ connection error: {e}"
            print(state["last_error"])
            await asyncio.sleep(RABBITMQ_RECONNECT_DELAY_SECONDS)


async def discover_sensors(client: httpx.AsyncClient) -> list[SensorTarget]:
    """Fetch and normalize the current sensor inventory from simulator.

    Preferred path: `/api/discovery` (contains schema IDs and endpoint paths).
    Fallback path: `/api/sensors` for compatibility.
    """

    sensors: list[SensorTarget] = []

    try:
        response = await client.get(simulator_url("/api/discovery"))
        response.raise_for_status()
        sensors = normalize_discovery_sensors(response.json())
        if sensors:
            state["discovery_source"] = "/api/discovery"
    except Exception as discovery_error:
        print(f"Discovery fallback to /api/sensors due to error: {discovery_error}")

    if not sensors:
        response = await client.get(simulator_url("/api/sensors"))
        response.raise_for_status()
        sensors = normalize_sensor_list(response.json())
        state["discovery_source"] = "/api/sensors"

    state["discovered_sensors"] = [sensor.name for sensor in sensors]
    return sensors


async def fetch_sensor_payload(client: httpx.AsyncClient, sensor: SensorTarget) -> Any:
    """Fetch raw payload for one sensor target."""

    response = await client.get(sensor.url)
    response.raise_for_status()
    return response.json()


def build_unified_event(sensor: SensorTarget, raw_payload: Any) -> dict[str, Any]:
    """Build the internal event contract published to RabbitMQ."""

    value, unit = extract_value_and_unit(raw_payload)

    return {
        "event_id": str(uuid.uuid4()),
        "timestamp": now_iso(),
        "source_type": "rest",
        "sensor_name": sensor.name,
        "schema_family": sensor.schema_family or "unknown",
        "value": value,
        "unit": unit,
        "raw_payload": raw_payload,
        "metadata": {
            "poll_interval_seconds": POLL_INTERVAL_SECONDS,
            "ingestion_service": "ingestion-service",
        },
    }


async def publish_event(event: dict[str, Any]):
    """Publish one unified event with persistence semantics.

    On transient broker failures, reconnect once and retry publish.
    """

    global rabbitmq_exchange

    await ensure_rabbitmq()

    if rabbitmq_exchange is None:
        raise RuntimeError("RabbitMQ exchange not initialized")

    def build_message() -> aio_pika.Message:
        return aio_pika.Message(
            body=json.dumps(event).encode("utf-8"),
            content_type="application/json",
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        )

    try:
        await rabbitmq_exchange.publish(build_message(), routing_key=RABBITMQ_ROUTING_KEY)
    except Exception as e:
        state["rabbitmq_connected"] = False
        state["last_error"] = f"Publish error: {e}"
        print(state["last_error"])

        await ensure_rabbitmq(force_reconnect=True)

        if rabbitmq_exchange is None:
            raise RuntimeError("RabbitMQ exchange not initialized after reconnect")

        await rabbitmq_exchange.publish(build_message(), routing_key=RABBITMQ_ROUTING_KEY)

    state["rabbitmq_connected"] = True
    state["published_count"] += 1


async def polling_loop():
    """Main ingestion loop: discover sensors, poll values, publish events."""

    await ensure_rabbitmq()

    async with httpx.AsyncClient(timeout=10.0, trust_env=False) as client:
        while True:
            try:
                sensors = await discover_sensors(client)

                for sensor in sensors:
                    try:
                        # Each sensor is handled independently so one failure does
                        # not stop the rest of the cycle.
                        raw_payload = await fetch_sensor_payload(client, sensor)
                        event = build_unified_event(sensor, raw_payload)
                        await publish_event(event)
                        print(f"Published event for {sensor.name}: {event['value']}")
                    except Exception as sensor_error:
                        print(f"Error polling {sensor.name}: {sensor_error}")

                state["last_poll_at"] = now_iso()
                state["last_error"] = None

            except Exception as e:
                state["last_error"] = f"Polling loop error: {e}"
                print(state["last_error"])

            await asyncio.sleep(POLL_INTERVAL_SECONDS)


@app.on_event("startup")
async def startup_event():
    """Start polling in background when the API process boots."""

    global polling_task
    polling_task = asyncio.create_task(polling_loop())


@app.on_event("shutdown")
async def shutdown_event():
    """Gracefully stop background task and close RabbitMQ connection."""

    global polling_task, rabbitmq_connection

    if polling_task:
        polling_task.cancel()

    if rabbitmq_connection:
        await rabbitmq_connection.close()


@app.get("/", include_in_schema=False)
def docs_root_redirect():
    """Redirect root URL to Swagger UI."""

    return RedirectResponse(url="/docs")


@app.get("/health")
def health():
    """Operational endpoint used by compose checks and manual debugging."""

    return {
        "status": "ok",
        "service": "ingestion-service",
        **state,
    }
