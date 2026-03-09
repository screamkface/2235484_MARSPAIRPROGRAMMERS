"""Engine service for Mars habitat automation.

Responsibilities:
- consume normalized sensor events from RabbitMQ;
- keep latest sensor state in memory;
- persist automation rules in SQLite and evaluate them on each event;
- execute actuator commands against simulator REST APIs;
- expose REST and WebSocket APIs for the dashboard.
"""

import asyncio
import json
import os
import sqlite3
import threading
from typing import Any, List, Literal

import aio_pika
import httpx
from fastapi import FastAPI, HTTPException, Response, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from starlette.websockets import WebSocketDisconnect

# Main API process: this service hosts both the rule engine API and the
# background event consumer.
app = FastAPI(
    title="Engine Service",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

# CORS is restricted to local frontend origins used in development/compose.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Runtime configuration (overridable via docker-compose environment).
SIMULATOR_BASE_URL = os.getenv("SIMULATOR_BASE_URL", "http://simulator:8080")
RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")
RABBITMQ_EXCHANGE = os.getenv("RABBITMQ_EXCHANGE", "mars.events")
RABBITMQ_ROUTING_KEY = os.getenv("RABBITMQ_ROUTING_KEY", "sensor.reading")
RABBITMQ_QUEUE = os.getenv("RABBITMQ_QUEUE", "engine.sensor.events")
DB_PATH = os.getenv("DB_PATH", "/data/rules.db")

# In-memory latest-value cache required by assignment (no full history).
latest_state: dict[str, dict[str, Any]] = {}
# Cache of actuator state to avoid redundant simulator commands.
actuator_state_cache: dict[str, Any] = {}
# SQLite access lock because FastAPI handlers and background consumer can run
# concurrently in different threads/executors.
db_lock = threading.Lock()

# Basic runtime counters exposed by /health.
engine_metrics = {
    "rabbitmq_connected": False,
    "consumed_count": 0,
    "last_event_at": None,
    "last_error": None,
    "rules_count": 0,
}

consumer_task: asyncio.Task | None = None


class RuleBase(BaseModel):
    """Base schema for automation rules."""

    name: str
    sensor_name: str
    operator: Literal["<", "<=", "=", ">", ">="]
    threshold: float
    unit: str | None = None
    actuator_name: str
    target_state: Literal["ON", "OFF"]
    enabled: bool = True


class RuleCreate(RuleBase):
    """Payload for creating a new rule."""

    pass


class RuleUpdate(RuleBase):
    """Payload for replacing an existing rule."""

    pass


class Rule(RuleBase):
    """Rule entity returned by API (includes generated ID)."""

    id: int


class RuleEnabledPatch(BaseModel):
    """Payload for lightweight enable/disable patch operation."""

    enabled: bool


class ActuatorCommand(BaseModel):
    """Payload used to switch an actuator ON/OFF."""

    state: Literal["ON", "OFF"]


class ConnectionManager:
    """Tracks active websocket clients and broadcasts JSON updates."""

    def __init__(self):
        self.active_connections: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        """Accept and register a newly connected websocket client."""

        await websocket.accept()
        self.active_connections.add(websocket)

    def disconnect(self, websocket: WebSocket):
        """Remove a websocket client from the active set."""

        self.active_connections.discard(websocket)

    async def broadcast(self, payload: dict[str, Any]):
        """Send one payload to all active clients and prune stale sockets."""

        stale_connections = []

        for connection in list(self.active_connections):
            try:
                await connection.send_json(payload)
            except Exception:
                stale_connections.append(connection)

        for connection in stale_connections:
            self.disconnect(connection)


manager = ConnectionManager()


def get_db_connection() -> sqlite3.Connection:
    """Create a SQLite connection with row access by column name."""

    connection = sqlite3.connect(DB_PATH, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    return connection


def init_rules_db():
    """Initialize DB schema and index for rule storage."""

    with db_lock:
        connection = get_db_connection()
        try:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS rules (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    sensor_name TEXT NOT NULL,
                    operator TEXT NOT NULL,
                    threshold REAL NOT NULL,
                    unit TEXT,
                    actuator_name TEXT NOT NULL,
                    target_state TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    CHECK (operator IN ('<', '<=', '=', '>', '>=')),
                    CHECK (target_state IN ('ON', 'OFF'))
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_rules_sensor_enabled
                ON rules (sensor_name, enabled)
                """
            )
            connection.commit()
        finally:
            connection.close()



def row_to_rule(row: sqlite3.Row) -> Rule:
    """Convert a raw SQLite row into API Rule model."""

    return Rule(
        id=row["id"],
        name=row["name"],
        sensor_name=row["sensor_name"],
        operator=row["operator"],
        threshold=row["threshold"],
        unit=row["unit"],
        actuator_name=row["actuator_name"],
        target_state=row["target_state"],
        enabled=bool(row["enabled"]),
    )



def count_rules_db() -> int:
    """Return total number of rules persisted in DB."""

    with db_lock:
        connection = get_db_connection()
        try:
            row = connection.execute("SELECT COUNT(*) AS total FROM rules").fetchone()
            return int(row["total"]) if row else 0
        finally:
            connection.close()



def refresh_rules_count_metric():
    """Refresh cached rule count metric used by /health."""

    engine_metrics["rules_count"] = count_rules_db()



def list_rules_db() -> list[Rule]:
    """Return all rules ordered by creation ID."""

    with db_lock:
        connection = get_db_connection()
        try:
            rows = connection.execute("SELECT * FROM rules ORDER BY id ASC").fetchall()
            return [row_to_rule(row) for row in rows]
        finally:
            connection.close()



def get_rule_db(rule_id: int) -> Rule | None:
    """Return one rule by ID, or None if not found."""

    with db_lock:
        connection = get_db_connection()
        try:
            row = connection.execute("SELECT * FROM rules WHERE id = ?", (rule_id,)).fetchone()
            return row_to_rule(row) if row else None
        finally:
            connection.close()



def create_rule_db(rule: RuleCreate) -> Rule:
    """Persist a new rule and return the created entity."""

    with db_lock:
        connection = get_db_connection()
        try:
            cursor = connection.execute(
                """
                INSERT INTO rules (name, sensor_name, operator, threshold, unit, actuator_name, target_state, enabled)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    rule.name,
                    rule.sensor_name,
                    rule.operator,
                    rule.threshold,
                    rule.unit,
                    rule.actuator_name,
                    rule.target_state,
                    int(rule.enabled),
                ),
            )
            connection.commit()
            row = connection.execute("SELECT * FROM rules WHERE id = ?", (cursor.lastrowid,)).fetchone()
            if row is None:
                raise RuntimeError("Failed to retrieve created rule")
            return row_to_rule(row)
        finally:
            connection.close()



def update_rule_db(rule_id: int, rule: RuleUpdate) -> Rule | None:
    """Replace an existing rule and return updated record if it exists."""

    with db_lock:
        connection = get_db_connection()
        try:
            cursor = connection.execute(
                """
                UPDATE rules
                SET name = ?, sensor_name = ?, operator = ?, threshold = ?, unit = ?,
                    actuator_name = ?, target_state = ?, enabled = ?
                WHERE id = ?
                """,
                (
                    rule.name,
                    rule.sensor_name,
                    rule.operator,
                    rule.threshold,
                    rule.unit,
                    rule.actuator_name,
                    rule.target_state,
                    int(rule.enabled),
                    rule_id,
                ),
            )
            connection.commit()
            if cursor.rowcount == 0:
                return None
            row = connection.execute("SELECT * FROM rules WHERE id = ?", (rule_id,)).fetchone()
            return row_to_rule(row) if row else None
        finally:
            connection.close()



def patch_rule_enabled_db(rule_id: int, enabled: bool) -> Rule | None:
    """Toggle only the enabled flag of one rule."""

    with db_lock:
        connection = get_db_connection()
        try:
            cursor = connection.execute(
                "UPDATE rules SET enabled = ? WHERE id = ?",
                (int(enabled), rule_id),
            )
            connection.commit()
            if cursor.rowcount == 0:
                return None
            row = connection.execute("SELECT * FROM rules WHERE id = ?", (rule_id,)).fetchone()
            return row_to_rule(row) if row else None
        finally:
            connection.close()



def delete_rule_db(rule_id: int) -> bool:
    """Delete one rule by ID; return True if row existed."""

    with db_lock:
        connection = get_db_connection()
        try:
            cursor = connection.execute("DELETE FROM rules WHERE id = ?", (rule_id,))
            connection.commit()
            return cursor.rowcount > 0
        finally:
            connection.close()



def normalize_actuators_payload(raw: Any) -> dict[str, Any]:
    """Normalize simulator actuator payloads into `{name: state}` mapping."""

    if isinstance(raw, dict):
        if "actuators" in raw:
            return normalize_actuators_payload(raw["actuators"])

        result: dict[str, Any] = {}
        for key, value in raw.items():
            if isinstance(value, dict):
                result[key] = value.get("state", value)
            else:
                result[key] = value
        return result

    if isinstance(raw, list):
        result: dict[str, Any] = {}
        for item in raw:
            if isinstance(item, dict):
                name = item.get("name") or item.get("id")
                state = item.get("state")
                if name:
                    result[name] = state
        return result

    return {}



def wrap_actuators_payload(actuators: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Wrap normalized actuator map with the response envelope used by API."""

    return {"actuators": actuators}


async def fetch_actuators_from_simulator() -> dict[str, Any]:
    """Fetch current actuator states from simulator and refresh local cache."""

    global actuator_state_cache

    async with httpx.AsyncClient(timeout=10.0, trust_env=False) as client:
        response = await client.get(f"{SIMULATOR_BASE_URL.rstrip('/')}/api/actuators")
        response.raise_for_status()

    normalized = normalize_actuators_payload(response.json())
    actuator_state_cache = normalized
    return normalized


async def send_actuator_command_to_simulator(actuator_name: str, state: str) -> dict[str, Any]:
    """Send ON/OFF command to simulator and broadcast resulting state update."""

    payload = {"state": state}

    async with httpx.AsyncClient(timeout=10.0, trust_env=False) as client:
        response = await client.post(
            f"{SIMULATOR_BASE_URL.rstrip('/')}/api/actuators/{actuator_name}",
            json=payload,
        )
        response.raise_for_status()

    updated_actuators = await fetch_actuators_from_simulator()
    response_payload = wrap_actuators_payload(updated_actuators)
    await manager.broadcast({"type": "actuator_update", "payload": response_payload})
    return response_payload



def compare_values(operator: str, left: float, right: float) -> bool:
    """Evaluate one comparison using supported rule operators."""

    if operator == "<":
        return left < right
    if operator == "<=":
        return left <= right
    if operator == "=":
        return left == right
    if operator == ">":
        return left > right
    if operator == ">=":
        return left >= right
    return False


def normalize_unit_token(unit: Any) -> str | None:
    """Normalize unit strings for tolerant comparisons.

    Examples:
    - "C", "c", "°C", "deg C", "celsius" -> "c"
    - "µg/m3", "μg/m3", "ug/m3" -> "ug/m3"
    - "percent", "pct", "%" -> "%"
    """

    if unit is None:
        return None

    raw = unit if isinstance(unit, str) else str(unit)
    normalized = raw.strip().casefold()
    if not normalized:
        return None

    # Remove common formatting noise.
    normalized = normalized.replace(" ", "")
    normalized = normalized.replace("°", "")
    normalized = normalized.replace("µ", "u").replace("μ", "u")

    # Harmonize textual prefixes/synonyms.
    if normalized.startswith("deg"):
        normalized = normalized[3:]

    aliases = {
        "celsius": "c",
        "fahrenheit": "f",
        "percent": "%",
        "pct": "%",
    }
    normalized = aliases.get(normalized, normalized)

    return normalized or None



def extract_numeric_value(value: Any) -> float | None:
    """Extract a numeric reading from scalar or nested payload structures."""

    if isinstance(value, (int, float)):
        return float(value)

    if isinstance(value, dict):
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
            "level_pct",
            "pm25_ug_m3",
        ]

        for key in preferred_keys:
            raw = value.get(key)
            if isinstance(raw, (int, float)):
                return float(raw)

        measurements = value.get("measurements")
        if isinstance(measurements, list):
            for measurement in measurements:
                if isinstance(measurement, dict) and isinstance(measurement.get("value"), (int, float)):
                    return float(measurement["value"])

        for raw in value.values():
            extracted = extract_numeric_value(raw)
            if extracted is not None:
                return extracted

    return None


async def evaluate_rules_for_event(event: dict[str, Any]):
    """Evaluate enabled rules for one event and execute matching actions."""

    sensor_name = event.get("sensor_name")
    if not isinstance(sensor_name, str):
        return

    event_value = extract_numeric_value(event.get("value"))
    if event_value is None:
        return

    event_unit = normalize_unit_token(event.get("unit"))

    if not actuator_state_cache:
        try:
            await fetch_actuators_from_simulator()
        except Exception:
            # Rules can still be evaluated without cache; command call will fail later if simulator is down.
            pass

    commands: dict[str, str] = {}

    for rule in list_rules_db():
        if not rule.enabled or rule.sensor_name != sensor_name:
            continue

        rule_unit = normalize_unit_token(rule.unit)
        if rule_unit and rule_unit != event_unit:
            continue

        if compare_values(rule.operator, event_value, rule.threshold):
            # Last matching rule for an actuator wins within this event cycle.
            commands[rule.actuator_name] = rule.target_state

    for actuator_name, target_state in commands.items():
        cached_state = actuator_state_cache.get(actuator_name)
        if isinstance(cached_state, str) and cached_state == target_state:
            continue

        try:
            await send_actuator_command_to_simulator(actuator_name, target_state)
        except Exception as e:
            engine_metrics["last_error"] = f"Rule action error for {actuator_name}: {e}"
            print(engine_metrics["last_error"])


async def handle_sensor_event(event: dict[str, Any]):
    """Update state cache, push websocket update, and run rule evaluation."""

    sensor_name = event["sensor_name"]

    latest_state[sensor_name] = {
        "value": event.get("value"),
        "unit": event.get("unit"),
        "timestamp": event.get("timestamp"),
        "schema_family": event.get("schema_family"),
        "source_type": event.get("source_type"),
    }

    engine_metrics["consumed_count"] += 1
    engine_metrics["last_event_at"] = event.get("timestamp")
    engine_metrics["last_error"] = None

    await manager.broadcast(
        {
            "type": "sensor_update",
            "sensor_name": sensor_name,
            "payload": latest_state[sensor_name],
        }
    )

    await evaluate_rules_for_event(event)


async def consume_forever():
    """Run resilient AMQP consume loop forever with reconnect on errors."""

    while True:
        try:
            connection = await aio_pika.connect_robust(RABBITMQ_URL)
            channel = await connection.channel()
            exchange = await channel.declare_exchange(
                RABBITMQ_EXCHANGE,
                aio_pika.ExchangeType.TOPIC,
                durable=True,
            )
            queue = await channel.declare_queue(RABBITMQ_QUEUE, durable=True)
            await queue.bind(exchange, routing_key=RABBITMQ_ROUTING_KEY)

            engine_metrics["rabbitmq_connected"] = True
            engine_metrics["last_error"] = None
            print("Engine connected to RabbitMQ and waiting for events")

            async with queue.iterator() as queue_iter:
                async for message in queue_iter:
                    async with message.process():
                        try:
                            event = json.loads(message.body.decode("utf-8"))
                            await handle_sensor_event(event)
                            print(f"Consumed event for {event['sensor_name']}")
                        except Exception as e:
                            engine_metrics["last_error"] = f"Event processing error: {e}"
                            print(engine_metrics["last_error"])

        except Exception as e:
            engine_metrics["rabbitmq_connected"] = False
            engine_metrics["last_error"] = f"Consumer loop error: {e}"
            print(engine_metrics["last_error"])
            await asyncio.sleep(3)


@app.on_event("startup")
async def startup_event():
    """Prepare DB/cache and start background RabbitMQ consumer."""

    global consumer_task

    init_rules_db()
    refresh_rules_count_metric()

    try:
        await fetch_actuators_from_simulator()
    except Exception as e:
        engine_metrics["last_error"] = f"Actuator cache warmup failed: {e}"
        print(engine_metrics["last_error"])

    consumer_task = asyncio.create_task(consume_forever())


@app.on_event("shutdown")
async def shutdown_event():
    """Cancel background consumer task when service stops."""

    global consumer_task

    if consumer_task:
        consumer_task.cancel()


@app.get("/", include_in_schema=False)
def docs_root_redirect():
    """Redirect root URL to Swagger UI."""

    return RedirectResponse(url="/docs")


@app.get("/health")
def health():
    """Operational health endpoint with metrics and cache visibility."""

    refresh_rules_count_metric()
    return {
        "status": "ok",
        "service": "engine-service",
        **engine_metrics,
        "connected_websockets": len(manager.active_connections),
        "known_sensors": list(latest_state.keys()),
    }


@app.get("/api/state")
def get_state():
    """Return latest state for all known sensors."""

    return latest_state


@app.get("/api/state/{sensor_name}")
def get_sensor_state(sensor_name: str):
    """Return latest state for one sensor or 404 if unknown."""

    if sensor_name not in latest_state:
        raise HTTPException(status_code=404, detail="Sensor not found")
    return latest_state[sensor_name]


@app.get("/api/actuators")
async def get_actuators():
    """Proxy current actuator states from simulator."""

    try:
        actuators = await fetch_actuators_from_simulator()
        return wrap_actuators_payload(actuators)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Cannot fetch actuators: {e}")


@app.post("/api/actuators/{actuator_name}")
async def toggle_actuator(actuator_name: str, command: ActuatorCommand):
    """Toggle a specific actuator and return refreshed actuator snapshot."""

    try:
        return await send_actuator_command_to_simulator(actuator_name, command.state)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Cannot update actuator: {e}")


@app.get("/api/rules", response_model=List[Rule])
def get_rules():
    """Return all persisted rules."""

    return list_rules_db()


@app.post("/api/rules", response_model=Rule)
def create_rule(rule: RuleCreate):
    """Create and persist a new rule."""

    try:
        created = create_rule_db(rule)
        refresh_rules_count_metric()
        return created
    except sqlite3.IntegrityError as e:
        raise HTTPException(status_code=400, detail=f"Invalid rule: {e}")


@app.put("/api/rules/{rule_id}", response_model=Rule)
def update_rule(rule_id: int, rule: RuleUpdate):
    """Replace one existing rule."""

    try:
        updated = update_rule_db(rule_id, rule)
    except sqlite3.IntegrityError as e:
        raise HTTPException(status_code=400, detail=f"Invalid rule: {e}")

    if updated is None:
        raise HTTPException(status_code=404, detail="Rule not found")

    refresh_rules_count_metric()
    return updated


@app.patch("/api/rules/{rule_id}/enabled", response_model=Rule)
def patch_rule_enabled(rule_id: int, payload: RuleEnabledPatch):
    """Enable or disable a rule without changing other fields."""

    patched = patch_rule_enabled_db(rule_id, payload.enabled)
    if patched is None:
        raise HTTPException(status_code=404, detail="Rule not found")
    return patched


@app.delete("/api/rules/{rule_id}", status_code=204)
def delete_rule(rule_id: int):
    """Delete one rule by ID."""

    deleted = delete_rule_db(rule_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Rule not found")

    refresh_rules_count_metric()
    return Response(status_code=204)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Realtime channel: send snapshot, then periodic heartbeat and updates."""

    await manager.connect(websocket)

    try:
        await websocket.send_json(
            {
                "type": "state_snapshot",
                "payload": {
                    "sensors": latest_state,
                },
            }
        )

        while True:
            await websocket.send_json(
                {
                    "type": "heartbeat",
                    "message": "engine alive",
                }
            )
            await asyncio.sleep(15)

    except WebSocketDisconnect:
        print("WebSocket client disconnected")

    except Exception as e:
        print(f"WebSocket closed: {type(e).__name__}: {e}")

    finally:
        manager.disconnect(websocket)
