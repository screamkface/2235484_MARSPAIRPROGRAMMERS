# Dashboard LoFi Mockup (Text)

```text
+-----------------------------------------------------------------------------------+
| Header: Mission title + Martian clock + link status                               |
+--------------------------+---------------------------+-----------------------------+
| REST Sensors             | Telemetry chart           | Actuator toggles            |
| - temp                   | - power bus trend         | - cooling_fan               |
| - humidity               | - solar array trend       | - entrance_humidifier       |
| - co2                    | - radiation status        | - hall_ventilation          |
| - hydroponic_ph          | - life_support status     | - habitat_heater            |
| - water_tank_level       |                           |                             |
| - corridor_pressure      |                           |                             |
| - air_quality_pm25       |                           |                             |
| - air_quality_voc        |                           |                             |
+--------------------------+---------------------------+-----------------------------+
| Hologram / map placeholder (center)                | Rules terminal + CRUD form  |
+-----------------------------------------------------------------------------------+
```

Interaction notes:
- Sensor values update live via WebSocket.
- Toggle switches send actuator commands.
- Rule form supports create/update and enabled flag.
- Rules list supports enable/disable, edit, delete.
