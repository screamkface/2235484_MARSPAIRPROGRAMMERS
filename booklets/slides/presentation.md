---
marp: true
theme: default
paginate: true
size: 16:9
html: true
title: "Mars Habitat Automation Platform"
description: "Laboratory of Advanced Programming 2025/2026 - Sapienza University of Rome"
style: |
  :root {
    --sapienza-red: #7a0019;
    --ink: #1f2937;
    --muted: #475569;
    --bg: #f8fafc;
    --ok: #0f9d58;
    --line: #cbd5e1;
  }
  section {
    font-family: "Segoe UI", Arial, sans-serif;
    color: var(--ink);
    background: var(--bg);
    font-size: 18px;
    line-height: 1.2;
    padding: 34px 44px;
  }
  h1, h2, h3 {
    color: var(--sapienza-red);
    margin: 0 0 10px 0;
  }
  h1 { font-size: 40px; }
  h2 { font-size: 30px; }
  h3 { font-size: 24px; }
  strong { color: var(--sapienza-red); }
  p, li { margin: 5px 0; }
  ul, ol { margin: 8px 0 0 18px; }
  code {
    background: #e2e8f0;
    color: #111827;
    border-radius: 6px;
    padding: 2px 7px;
    font-size: 0.88em;
  }
  .lead {
    background: linear-gradient(135deg, #ffffff 0%, #fdf2f8 100%);
  }
  .small { font-size: 16px; color: var(--muted); }
  .ok { color: var(--ok); font-weight: 700; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 15px;
    margin-top: 8px;
  }
  th, td {
    border: 1px solid var(--line);
    padding: 6px 8px;
    vertical-align: top;
  }
  th {
    background: #eef2f7;
    color: #334155;
  }
  img.diagram {
    width: 100%;
    border: 2px solid #dbe2ea;
    border-radius: 10px;
    background: #fff;
  }
---

<!-- _class: lead -->
![bg opacity:.20](./assets/mars-habitat-bg.png)

# Mars Habitat Automation Platform
## Mission: Please Don't Die

**Sapienza University of Rome**  
Laboratory of Advanced Programming 2025/2026

Nicola Moscufo (2254216)  
Antonio Rubino (2235484)

**Stack:** `FastAPI` • `RabbitMQ` • `SQLite` • `React` • `Vite` • `Tailwind` • `Docker Compose`

---

# Agenda (15 Minutes)

1. Project goal and constraints
2. Architecture and event flow
3. Rule engine and persistence
4. Dashboard + user stories
5. Live demo plan and final checklist

---

# Problem and Team Scope

- We built a **distributed automation platform** on top of the Mars simulator.
- Input is heterogeneous REST sensor payloads.
- Output is rule-based actuator control and realtime monitoring.

### Team of 2 scope

- Included: REST polling, normalization, broker, rules, dashboard.
- Excluded by assignment: telemetry stream ingestion.

---

# Baseline Requirements Coverage

| Mandatory requirement | Status |
|---|---|
| Event-driven architecture | <span class="ok">Done</span> |
| Multiple backend services | <span class="ok">Done</span> |
| Unified event schema | <span class="ok">Done</span> |
| Latest state in memory | <span class="ok">Done</span> |
| Rule persistence | <span class="ok">Done</span> |
| Realtime dashboard | <span class="ok">Done</span> |
| Docker reproducibility | <span class="ok">Done</span> |

---

# Architecture Overview

![width:1200px](./assets/system-architecture-slide.svg)

<div class="small">Ingestion and processing are decoupled through RabbitMQ. The frontend consumes REST + WebSocket APIs from engine-service.</div>

---

# Containers and Responsibilities

| Service | Responsibility | Interface |
|---|---|---|
| `simulator` | Sensors + actuators API | HTTP (`:8080`) |
| `ingestion-service` | Poll + normalize + publish | HTTP (`:8001`) + AMQP |
| `rabbitmq` | Internal message transport | AMQP (`:5672`), UI (`:15672`) |
| `engine-service` | Rules, state cache, actuator commands | HTTP/WS (`:8002`) |
| `frontend` | Dashboard UI | HTTP (`:3000`) |

---

# Unified Event Contract

```json
{
  "event_id": "uuid-string",
  "timestamp": "2026-03-06T14:00:00.000000+00:00",
  "sensor_name": "greenhouse_temperature",
  "value": 24.7,
  "unit": "C",
  "schema_family": "rest.scalar.v1"
}
```

- Published to exchange `mars.events`
- Routing key `sensor.reading`
- Original payload preserved in `raw_payload`

---

# End-to-End Processing Flow

1. Ingestion discovers and polls REST sensors.
2. Payloads are normalized into `UnifiedEvent`.
3. Events are published to RabbitMQ.
4. Engine consumes and updates `latest_state` cache.
5. Enabled rules are evaluated on each event.
6. Matching rules trigger simulator actuator commands.
7. Frontend receives `sensor_update` and `actuator_update` via WebSocket.

---

# Rule Engine and Persistence

Rule format:
`IF <sensor> <operator> <value> [unit] THEN set <actuator> to ON | OFF`

Supported operators: `<`, `<=`, `=`, `>`, `>=`

**Implementation highlights**
- Rules stored in SQLite (`/data/rules.db`)
- Rules survive restart via Docker volume `engine_data`
- Actuator state cache prevents duplicate commands

![width:820px](./assets/rule-lifecycle.svg)

---

# Dashboard: Monitoring and Control

![width:920px](./assets/us01-sensors.png)

<div class="small">Sensors, latest timestamp, actuator states, and manual commands are available in a single operational view.</div>

---

# Dashboard: Rule Management

![width:780px](./assets/us05-rule-create.png)

<div class="small">Operators can create, edit, enable/disable, and delete automation rules from the UI.</div>

---

# Dashboard: Realtime Updates

![width:780px](./assets/us09-realtime.png)

<div class="small">WebSocket channel pushes live changes without page refresh.</div>

---

# User Stories Coverage

| Story group | IDs | Coverage |
|---|---|---|
| Sensor discovery and latest values | US-01, US-02, US-03 | <span class="ok">Yes</span> |
| Actuator visibility and manual control | US-04, US-10 | <span class="ok">Yes</span> |
| Rule CRUD and enable/disable | US-05, US-06, US-07, US-08 | <span class="ok">Yes</span> |
| Realtime dashboard behavior | US-09 | <span class="ok">Yes</span> |

---

# Demo Plan (Live)

1. Start stack and show container status (`docker compose ps`).
2. Open dashboard and verify live sensor updates.
3. Create a rule and show actuator auto-trigger.
4. Disable the rule and show behavior change.
5. Restart engine and verify rule persistence.
6. Show simulator Swagger (`http://localhost:8080/docs`).

---

<!-- _class: lead center -->
# Final Checklist

![width:860px](./assets/requirements-check.svg)

<div class="small">All mandatory requirements for the 2-person scope are covered and demonstrable end-to-end.</div>

**Questions?**
