# SYSTEM DESCRIPTION:

Mars Habitat Automation Platform is a distributed event-driven system for a simulated Mars habitat environment.
The platform ingests heterogeneous REST sensor payloads, normalizes them into a unified internal event format, publishes events to a message broker, evaluates automation rules, updates actuator states, and provides a real-time dashboard.

This implementation follows the scope for a 2-student team: REST polling is implemented, while telemetry stream ingestion is intentionally out of scope.

# USER STORIES:

1) As an operator, I want to see all available REST sensors.
2) As an operator, I want to see the latest value of each sensor.
3) As an operator, I want to see the timestamp of the latest sensor update.
4) As an operator, I want to see current actuator states.
5) As an automation designer, I want to create an IF-THEN rule.
6) As an automation designer, I want to edit an existing rule.
7) As an automation designer, I want to enable/disable a rule.
8) As an automation designer, I want to delete a rule.
9) As an operator, I want real-time dashboard updates.
10) As an operator, I want to manually toggle an actuator from the UI.

# CONTAINERS:

## CONTAINER_NAME: simulator

### DESCRIPTION:
Provided Mars IoT simulator container (external exam artifact, not modifiable by the team). It exposes REST sensor and actuator APIs consumed by the platform.

### USER STORIES:
1) As an operator, I want to see all available REST sensors.
2) As an operator, I want to see the latest value of each sensor.
3) As an operator, I want to see the timestamp of the latest sensor update.
4) As an operator, I want to see current actuator states.
10) As an operator, I want to manually toggle an actuator from the UI.

### PORTS:
`8080:8080`

### DESCRIPTION:
The simulator acts as the device layer of the architecture and provides all runtime data sources (sensors) and control targets (actuators).

### PERSISTENCE EVALUATION
No repository-managed persistence is defined for this container.

### EXTERNAL SERVICES CONNECTIONS
- Accessed by `ingestion-service` for sensor discovery and polling.
- Accessed by `engine-service` for actuator state retrieval and updates.

### MICROSERVICES:

#### MICROSERVICE: simulator-api
- TYPE: backend (external)
- DESCRIPTION: External API that simulates Mars habitat devices.
- PORTS: `8080`
- TECHNOLOGICAL SPECIFICATION:
  Pre-built container image: `mars-iot-simulator:multiarch_v1`.
- SERVICE ARCHITECTURE:
  Single backend service exposing REST APIs and OpenAPI docs.

- ENDPOINTS:

| HTTP METHOD | URL | Description | User Stories |
| ----------- | --- | ----------- | ------------ |
| GET | `/health` | Returns simulator health status | 1 |
| GET | `/api/sensors` | Lists REST sensors | 1 |
| GET | `/api/sensors/{sensor_name}` | Returns one sensor payload | 2, 3 |
| GET | `/api/actuators` | Returns current actuator states | 4 |
| POST | `/api/actuators/{actuator_name}` | Sets actuator ON/OFF state | 10 |

## CONTAINER_NAME: rabbitmq

### DESCRIPTION:
Message broker container used for asynchronous communication between ingestion and processing services.

### USER STORIES:
1) As an operator, I want to see all available REST sensors.
2) As an operator, I want to see the latest value of each sensor.
3) As an operator, I want to see the timestamp of the latest sensor update.
4) As an operator, I want to see current actuator states.
5) As an automation designer, I want to create an IF-THEN rule.
6) As an automation designer, I want to edit an existing rule.
7) As an automation designer, I want to enable/disable a rule.
8) As an automation designer, I want to delete a rule.
9) As an operator, I want real-time dashboard updates.
10) As an operator, I want to manually toggle an actuator from the UI.

### PORTS:
`5672:5672`, `15672:15672`

### DESCRIPTION:
RabbitMQ is used as required broker for event-driven architecture. Ingestion publishes normalized events and engine consumes them.

### PERSISTENCE EVALUATION
No dedicated RabbitMQ data volume is configured. Broker state is not intended as durable project storage.

### EXTERNAL SERVICES CONNECTIONS
- Receives events from `ingestion-service`.
- Delivers events to `engine-service`.

### MICROSERVICES:

#### MICROSERVICE: rabbitmq-broker
- TYPE: infrastructure
- DESCRIPTION: AMQP broker with management UI.
- PORTS: `5672`, `15672`
- TECHNOLOGICAL SPECIFICATION:
  Docker image `rabbitmq:3-management`.
- SERVICE ARCHITECTURE:
  Central messaging component decoupling ingestion and engine processing.

## CONTAINER_NAME: ingestion-service

### DESCRIPTION:
Backend ingestion container responsible for sensor discovery, polling, payload normalization, and broker publication.

### USER STORIES:
1) As an operator, I want to see all available REST sensors.
2) As an operator, I want to see the latest value of each sensor.
3) As an operator, I want to see the timestamp of the latest sensor update.
9) As an operator, I want real-time dashboard updates.

### PORTS:
`8001:8000`

### DESCRIPTION:
This container continuously polls simulator REST sensors, builds unified events, and publishes them to RabbitMQ exchange `mars.events` using routing key `sensor.reading`.

### PERSISTENCE EVALUATION
No persistent database is required. Runtime metrics/state are in-memory.

### EXTERNAL SERVICES CONNECTIONS
- Outbound HTTP to simulator (`http://simulator:8080`).
- Outbound AMQP to RabbitMQ (`amqp://guest:guest@rabbitmq:5672/`).

### MICROSERVICES:

#### MICROSERVICE: ingestion-api
- TYPE: backend
- DESCRIPTION: Service implementing polling and event normalization.
- PORTS: `8000` (internal), `8001` (published)
- TECHNOLOGICAL SPECIFICATION:
  Python 3.11, FastAPI, aio-pika, httpx, pydantic.
- SERVICE ARCHITECTURE:
  Startup task launches polling loop; each cycle discovers sensors, fetches payloads, normalizes data, and publishes events.

- ENDPOINTS:

| HTTP METHOD | URL | Description | User Stories |
| ----------- | --- | ----------- | ------------ |
| GET | `/health` | Returns service status and polling/publication metrics | 1, 9 |

## CONTAINER_NAME: engine-service

### DESCRIPTION:
Core backend container responsible for event processing, latest-state caching, rule persistence/evaluation, actuator command execution, and real-time communication.

### USER STORIES:
2) As an operator, I want to see the latest value of each sensor.
3) As an operator, I want to see the timestamp of the latest sensor update.
4) As an operator, I want to see current actuator states.
5) As an automation designer, I want to create an IF-THEN rule.
6) As an automation designer, I want to edit an existing rule.
7) As an automation designer, I want to enable/disable a rule.
8) As an automation designer, I want to delete a rule.
9) As an operator, I want real-time dashboard updates.
10) As an operator, I want to manually toggle an actuator from the UI.

### PORTS:
`8002:8000`

### DESCRIPTION:
This container consumes unified events from RabbitMQ queue `engine.sensor.events`, updates latest sensor state in memory, evaluates persisted rules, and triggers actuator updates when rule conditions match.

### PERSISTENCE EVALUATION
Rules are stored in SQLite (`/data/rules.db`) and persisted through Docker volume `engine_data`.

### EXTERNAL SERVICES CONNECTIONS
- Inbound AMQP events from RabbitMQ.
- Outbound HTTP actuator calls to simulator.
- Inbound REST/WebSocket requests from frontend.

### MICROSERVICES:

#### MICROSERVICE: engine-api
- TYPE: backend
- DESCRIPTION: Processing API implementing state, rules, actuator control, and real-time push.
- PORTS: `8000` (internal), `8002` (published)
- TECHNOLOGICAL SPECIFICATION:
  Python 3.11, FastAPI, aio-pika, sqlite3, httpx, WebSocket.
- SERVICE ARCHITECTURE:
  Combines a broker consumer loop with REST/WebSocket interfaces. Latest state is maintained in memory; rules are retrieved from SQLite and evaluated on each incoming event.

- ENDPOINTS:

| HTTP METHOD | URL | Description | User Stories |
| ----------- | --- | ----------- | ------------ |
| GET | `/health` | Returns service and integration health metrics | 9 |
| GET | `/api/state` | Returns latest state of all sensors | 1, 2, 3 |
| GET | `/api/state/{sensor_name}` | Returns latest state for a specific sensor | 2, 3 |
| GET | `/api/actuators` | Returns current actuator states | 4 |
| POST | `/api/actuators/{actuator_name}` | Sets actuator ON/OFF | 10 |
| GET | `/api/rules` | Lists persisted rules | 5, 6, 7, 8 |
| POST | `/api/rules` | Creates a new rule | 5 |
| PUT | `/api/rules/{rule_id}` | Updates an existing rule | 6 |
| PATCH | `/api/rules/{rule_id}/enabled` | Enables/disables a rule | 7 |
| DELETE | `/api/rules/{rule_id}` | Deletes a rule | 8 |
| WS | `/ws` | Sends real-time updates (`state_snapshot`, `sensor_update`, `actuator_update`, heartbeat) | 9 |

- DB STRUCTURE:

**_rules_** : | **_id_** | name | sensor_name | operator | threshold | unit | actuator_name | target_state | enabled |

## CONTAINER_NAME: frontend

### DESCRIPTION:
Frontend container exposing the dashboard UI for monitoring and automation control.

### USER STORIES:
1) As an operator, I want to see all available REST sensors.
2) As an operator, I want to see the latest value of each sensor.
3) As an operator, I want to see the timestamp of the latest sensor update.
4) As an operator, I want to see current actuator states.
5) As an automation designer, I want to create an IF-THEN rule.
6) As an automation designer, I want to edit an existing rule.
7) As an automation designer, I want to enable/disable a rule.
8) As an automation designer, I want to delete a rule.
9) As an operator, I want real-time dashboard updates.
10) As an operator, I want to manually toggle an actuator from the UI.

### PORTS:
`3000:3000`

### DESCRIPTION:
Single-page dashboard with sensor cards, actuator toggles, rule management UI, and simulated telemetry widgets.

### PERSISTENCE EVALUATION
No persistent storage in the frontend container. UI state is runtime-only.

### EXTERNAL SERVICES CONNECTIONS
- REST API calls to `engine-service`.
- WebSocket connection to `engine-service` for real-time updates.

### MICROSERVICES:

#### MICROSERVICE: dashboard-ui
- TYPE: frontend
- DESCRIPTION: Real-time mission control interface for operators and automation designers.
- PORTS: `3000`
- TECHNOLOGICAL SPECIFICATION:
  React, TypeScript, Vite, Tailwind CSS, lucide-react, recharts.
- SERVICE ARCHITECTURE:
  SPA architecture with REST bootstrap + WebSocket live updates; UI modules include sensors, actuators, rules, and telemetry visualization.

- PAGES:

| Name | Description | Related Microservice | User Stories |
| ---- | ----------- | -------------------- | ------------ |
| Dashboard | Main real-time page for monitoring, rule management, and actuator control | `engine-api` | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 |
