import os
from fastapi import FastAPI

app = FastAPI(title="Ingestion Service")

SIMULATOR_BASE_URL = os.getenv("SIMULATOR_BASE_URL", "http://simulator:8080")
RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")
POLL_INTERVAL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "5"))

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "ingestion-service",
        "simulator_base_url": SIMULATOR_BASE_URL,
        "rabbitmq_url": RABBITMQ_URL,
        "poll_interval_seconds": POLL_INTERVAL_SECONDS
    }