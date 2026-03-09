# SYSTEM DESCRIPTION:

Mars Habitat Automation Platform is a distributed event-driven system for a simulated Mars habitat.
The system acquires heterogeneous REST sensor payloads from the simulator, normalizes them into a unified internal event model, sends them through a message broker, evaluates IF-THEN automation rules, and exposes real-time monitoring/control through a dashboard.

For a 2-student team, the project scope is REST polling only. Telemetry stream ingestion is intentionally out of scope.

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

Detailed acceptance criteria, NFR notes, and LoFi references are available in:
- `booklets/user-stories.md`
- `booklets/mockups/user-stories-lofi.md`

# STANDARD EVENT SCHEMA:

All sensor inputs are converted to one internal structure (`UnifiedEvent`) before being published to RabbitMQ exchange `mars.events` with routing key `sensor.reading`.

```json
{
  "event_id": "uuid-string",
  "timestamp": "2026-03-06T14:00:00.000000+00:00",
  "source_type": "rest",
  "sensor_name": "greenhouse_temperature",
  "schema_family": "rest.scalar.v1",
  "value": 24.7,
  "unit": "C",
  "raw_payload": {
    "sensor_id": "greenhouse_temperature",
    "captured_at": "...",
    "value": 24.7,
    "unit": "C"
  },
  "metadata": {
    "poll_interval_seconds": 5,
    "ingestion_service": "ingestion-service"
  }
}
```

Field notes:
- `value` may be scalar or structured depending on the original payload.
- `raw_payload` preserves original simulator data.
- `schema_family` tracks source schema type.

# RULE MODEL:

Supported syntax:

`IF <sensor_name> <operator> <value> [unit] THEN set <actuator_name> to ON | OFF`

Supported operators:
- `<`
- `<=`
- `=`
- `>`
- `>=`

Rule example:

```json
{
  "id": 1,
  "name": "Cool greenhouse",
  "sensor_name": "greenhouse_temperature",
  "operator": ">",
  "threshold": 28.0,
  "unit": "C",
  "actuator_name": "cooling_fan",
  "target_state": "ON",
  "enabled": true
}
```

Evaluation semantics:
- Rules are evaluated on each incoming event.
- Only enabled rules with matching `sensor_name` are checked.
- If a rule has `unit`, event unit must match.
- On match, the engine issues an actuator REST command.

# NON-GOALS:

- Historical sensor time-series persistence.
- Authentication and multi-user management.
- Telemetry stream ingestion (out of scope for team size 2).
