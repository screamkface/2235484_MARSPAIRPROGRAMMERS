# User Stories (Team of 2)

This project targets 10 user stories, aligned with the exam requirement for 2-student teams.

## Story Index

| ID | User Story | Acceptance Criteria (summary) | NFR focus | LoFi reference |
|---|---|---|---|---|
| US-01 | As an operator, I want to see all available REST sensors. | Dashboard lists all 8 simulator REST sensors. | Completeness, readability | `booklets/mockups/user-stories-lofi.md#us-01` |
| US-02 | As an operator, I want to see the latest value of each sensor. | Each sensor card shows current value/unit. | Update latency < poll interval + 2s | `booklets/mockups/user-stories-lofi.md#us-02` |
| US-03 | As an operator, I want to see the timestamp of the latest sensor update. | Each card shows latest event timestamp. | Temporal traceability | `booklets/mockups/user-stories-lofi.md#us-03` |
| US-04 | As an operator, I want to see current actuator states. | Actuator section shows ON/OFF state for all actuators. | State consistency with backend | `booklets/mockups/user-stories-lofi.md#us-04` |
| US-05 | As an automation designer, I want to create an IF-THEN rule. | Rule form creates persisted rule in DB. | Persistence reliability | `booklets/mockups/user-stories-lofi.md#us-05` |
| US-06 | As an automation designer, I want to edit an existing rule. | Rule can be edited and saved via API. | Validation correctness | `booklets/mockups/user-stories-lofi.md#us-06` |
| US-07 | As an automation designer, I want to enable/disable a rule. | Toggle updates rule enabled flag without deletion. | Safe operations, low error rate | `booklets/mockups/user-stories-lofi.md#us-07` |
| US-08 | As an automation designer, I want to delete a rule. | Rule can be deleted and disappears from list. | Safe destructive action (confirmation) | `booklets/mockups/user-stories-lofi.md#us-08` |
| US-09 | As an operator, I want real-time dashboard updates. | Sensor/actuator updates arrive via WebSocket without refresh. | Realtime UX continuity | `booklets/mockups/user-stories-lofi.md#us-09` |
| US-10 | As an operator, I want to manually toggle an actuator from UI. | Toggle sends REST command and updates state in UI. | Responsiveness, feedback clarity | `booklets/mockups/user-stories-lofi.md#us-10` |

## Detailed Acceptance Criteria

### US-01
- All simulator REST sensors are represented in the dashboard.
- Missing data is explicitly shown as placeholder (`--`) until first event arrives.

### US-02
- Value visualization supports scalar and structured payloads.
- Unit is displayed when available.

### US-03
- Timestamp shown per sensor is the latest consumed event timestamp.
- Timestamp changes after each new event for that sensor.

### US-04
- All actuators are visible (`cooling_fan`, `entrance_humidifier`, `hall_ventilation`, `habitat_heater`).
- ON/OFF status reflects backend state.

### US-05
- Rule creation requires sensor, operator, threshold, actuator, target state.
- Created rule survives engine restart.

### US-06
- Existing rule can be loaded in edit mode.
- Save operation updates the same rule ID.

### US-07
- Rule enable/disable works through dedicated toggle action.
- Disabled rules are not executed by rule engine.

### US-08
- Delete action requires explicit confirmation.
- Deleted rule is not returned by rules API.

### US-09
- WebSocket connection sends `state_snapshot`, `sensor_update`, `actuator_update`.
- Dashboard updates without manual page refresh.

### US-10
- UI toggle calls actuator API with target ON/OFF state.
- Updated actuator state is visible in dashboard shortly after command.

## Story-to-Component Traceability

- Sensor stories: `ingestion-service` + `engine-service` state cache + frontend sensor cards.
- Rule stories: `engine-service` SQLite CRUD + rule form/list UI.
- Realtime story: `engine-service` WebSocket + frontend WS subscriber.
- Manual actuator story: frontend toggle + engine actuator proxy endpoint.
