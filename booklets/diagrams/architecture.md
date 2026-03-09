# Architecture Diagrams

## 1) Component View

```mermaid
flowchart LR
  S[Simulator\nREST Sensors + Actuators]
  I[Ingestion Service\nFastAPI]
  B[(RabbitMQ\nmars.events)]
  E[Engine Service\nFastAPI + Rule Engine]
  DB[(SQLite\nrules.db)]
  F[Frontend\nReact + Vite]

  I -- Poll REST sensors --> S
  I -- Publish UnifiedEvent\nrouting key: sensor.reading --> B
  B -- Consume events --> E
  E -- Persist/Read rules --> DB
  E -- REST actuator commands --> S
  F -- REST (state/rules/actuators) --> E
  E -- WebSocket updates --> F
```

## 2) Event Sequence View

```mermaid
sequenceDiagram
  participant Sim as Simulator
  participant Ing as Ingestion Service
  participant MQ as RabbitMQ
  participant Eng as Engine Service
  participant UI as Frontend

  Ing->>Sim: GET /api/sensors + sensor endpoints
  Sim-->>Ing: Heterogeneous REST payloads
  Ing->>Ing: Normalize -> UnifiedEvent
  Ing->>MQ: Publish sensor.reading
  MQ-->>Eng: Deliver event
  Eng->>Eng: Update latest_state cache
  Eng->>Eng: Evaluate enabled rules
  alt rule matched
    Eng->>Sim: POST /api/actuators/{name}
    Sim-->>Eng: Updated actuator state
  end
  Eng-->>UI: WS sensor_update / actuator_update
  UI->>Eng: REST rules & actuator actions
```

## 3) Deployment View

```mermaid
flowchart TB
  subgraph DockerCompose[Single docker-compose deployment]
    SimC[simulator :8080]
    MQC[rabbitmq :5672 / :15672]
    IngC[ingestion-service :8001]
    EngC[engine-service :8002]
    FrontC[frontend :3000]
    Vol[(engine_data volume)]

    IngC --> SimC
    IngC --> MQC
    EngC --> MQC
    EngC --> SimC
    FrontC --> EngC
    EngC --> Vol
  end
```

## Notes
- Separation follows required boundaries: ingestion, processing, presentation.
- Broker is mandatory and used for internal asynchronous decoupling.
- Rule persistence survives service restart via volume-backed SQLite DB.
