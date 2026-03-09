# LoFi Mockups per User Story

These are low-fidelity textual mockups, one section per user story.

## US-01

```text
[Sensors Panel]
+ greenhouse_temperature
+ entrance_humidity
+ co2_hall
+ hydroponic_ph
+ water_tank_level
+ corridor_pressure
+ air_quality_pm25
+ air_quality_voc
```

## US-02

```text
[Sensor Card]
Title: greenhouse_temperature
Value: 24.70 C
```

## US-03

```text
[Sensor Card Footer]
Last update: 2026-03-06T14:30:00.000000+00:00
```

## US-04

```text
[Actuator Panel]
cooling_fan           [ON ]
entrance_humidifier   [OFF]
hall_ventilation      [OFF]
habitat_heater        [OFF]
```

## US-05

```text
[Rule Form - Create]
Name: Cool greenhouse
IF sensor: greenhouse_temperature
operator: >
threshold: 28
unit: C
THEN actuator: cooling_fan
state: ON
[Create Rule]
```

## US-06

```text
[Rule List + Edit]
#12 Cool greenhouse ... [Edit]

[Rule Form - Edit #12]
threshold: 27
[Update Rule #12]
```

## US-07

```text
[Rule Row]
#12 Cool greenhouse
Status: [Enabled]
(click -> Disabled)
```

## US-08

```text
[Rule Row]
#12 Cool greenhouse [Delete]
Modal: "Delete rule 12?" [Confirm] [Cancel]
```

## US-09

```text
[Realtime Flow]
WebSocket connected
Incoming: sensor_update
UI: greenhouse_temperature value changes without refresh
```

## US-10

```text
[Actuator Toggle]
Cooling Fan [OFF] --(toggle)--> POST /api/actuators/cooling_fan {"state":"ON"}
UI refresh: Cooling Fan [ON]
```

