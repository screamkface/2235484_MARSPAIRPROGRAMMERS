import asyncio
from typing import List
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from starlette.websockets import WebSocketDisconnect

app = FastAPI(title="Engine Service")

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

latest_state = {}
actuator_state = {
    "cooling_fan": "OFF",
    "entrance_humidifier": "OFF",
    "hall_ventilation": "OFF",
    "habitat_heater": "OFF"
}
rules = []

class Rule(BaseModel):
    id: int
    name: str
    sensor_name: str
    operator: str
    threshold: float
    unit: str | None = None
    actuator_name: str
    target_state: str
    enabled: bool = True

@app.get("/health")
def health():
    return {"status": "ok", "service": "engine-service"}

@app.get("/api/state")
def get_state():
    return latest_state

@app.get("/api/actuators")
def get_actuators():
    return actuator_state

@app.get("/api/rules", response_model=List[Rule])
def get_rules():
    return rules

@app.post("/api/rules", response_model=Rule)
def create_rule(rule: Rule):
    rules.append(rule)
    return rule

@app.websocket("/ws")
async def ws_heartbeat(websocket: WebSocket):
    await websocket.accept()
    print("WebSocket client connected")

    try:
        while True:
            await websocket.send_json({
                "type": "heartbeat",
                "message": "engine alive"
            })
            await asyncio.sleep(5)

    except WebSocketDisconnect:
        print("WebSocket client disconnected")

    except Exception as e:
        print(f"WebSocket closed: {type(e).__name__}: {e}")