# 20-Minute Demo Outline

## 1. Problem and scope (2 min)
- Mars habitat automation goal.
- Team of 2 => REST polling scope.

## 2. Architecture (4 min)
- Services and responsibilities.
- RabbitMQ event flow.
- Why separation ingestion/engine/frontend.

## 3. Live system startup (2 min)
- `docker compose up -d --build`
- Show running containers and health endpoints.

## 4. Dashboard walkthrough (5 min)
- Sensor live cards + timestamps.
- Telemetry widget and status indicators.
- Manual actuator control.

## 5. Rule engine walkthrough (5 min)
- Create rule.
- Observe actuator change when condition matches.
- Edit / disable / delete rule.
- Show persistence after engine restart.

## 6. Wrap-up and limits (2 min)
- Requirement coverage.
- Non-goals and future improvements.
