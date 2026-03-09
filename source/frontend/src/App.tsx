import { type ComponentType, type FormEvent, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Droplets,
  Fan,
  FlaskConical,
  Leaf,
  Pencil,
  Radiation,
  Thermometer,
  Trash2,
  Waves,
  Wind,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Backend sensor snapshot shape returned by engine-service.
type SensorState = {
  value: string | number | boolean | Record<string, unknown> | null;
  unit?: string | null;
  timestamp?: string | null;
  schema_family?: string | null;
  source_type?: string | null;
};

type SensorsMap = Record<string, SensorState>;
type ActuatorsMap = Record<string, string | Record<string, unknown>>;

// Rule model mirrors engine-service API contract.
type Rule = {
  id: number;
  name: string;
  sensor_name: string;
  operator: "<" | "<=" | "=" | ">" | ">=";
  threshold: number;
  unit?: string | null;
  actuator_name: string;
  target_state: "ON" | "OFF";
  enabled: boolean;
};

// Local form state keeps threshold/unit as strings while editing.
type RuleForm = {
  name: string;
  sensor_name: string;
  operator: Rule["operator"];
  threshold: string;
  unit: string;
  actuator_name: string;
  target_state: "ON" | "OFF";
  enabled: boolean;
};

// Recharts data point used by the simulated telemetry widget.
type TelemetryPoint = {
  timeLabel: string;
  powerBusKw: number;
  solarArrayKw: number;
};

// REST and WebSocket base URLs (ws:// derived from http:// automatically).
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8002";
const WS_BASE = API_BASE.replace(/^http/, "ws");
const MARS_BG_URL = "/mars-habitat-bg.png";

// Shared visual style for all glassmorphism cards.
const cardClass =
  "rounded-2xl border border-cyan-400/45 bg-slate-900/45 backdrop-blur-md shadow-[0_0_20px_rgba(6,182,212,0.22)]";

// Sensor cards rendered in the dashboard with icon + accent color.
const SENSOR_CARDS: Array<{
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  accent: string;
}> = [
  {
    key: "greenhouse_temperature",
    label: "Greenhouse Temperature",
    icon: Thermometer,
    accent: "text-orange-300",
  },
  {
    key: "entrance_humidity",
    label: "Entrance Humidity",
    icon: Droplets,
    accent: "text-cyan-300",
  },
  {
    key: "co2_hall",
    label: "CO2 Hall",
    icon: Wind,
    accent: "text-cyan-300",
  },
  {
    key: "hydroponic_ph",
    label: "Hydroponic pH",
    icon: FlaskConical,
    accent: "text-orange-300",
  },
  {
    key: "water_tank_level",
    label: "Water Tank Level",
    icon: Waves,
    accent: "text-cyan-300",
  },
  {
    key: "air_quality_pm25",
    label: "Air Quality PM2.5",
    icon: Radiation,
    accent: "text-orange-300",
  },
  {
    key: "corridor_pressure",
    label: "Corridor Pressure",
    icon: Activity,
    accent: "text-cyan-300",
  },
  {
    key: "air_quality_voc",
    label: "Air Quality VOC",
    icon: FlaskConical,
    accent: "text-orange-300",
  },
];

// Supported actuators that can be toggled manually or by rules.
const ACTUATOR_CARDS: Array<{
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { key: "cooling_fan", label: "Cooling Fan", icon: Fan },
  { key: "entrance_humidifier", label: "Entrance Humidifier", icon: Droplets },
  { key: "hall_ventilation", label: "Hall Ventilation", icon: Wind },
  { key: "habitat_heater", label: "Habitat Heater", icon: Thermometer },
];

// Operators supported by the IF-THEN rule engine.
const RULE_OPERATORS: Rule["operator"][] = ["<", "<=", "=", ">", ">="];

// Default form values for "create rule".
const DEFAULT_RULE_FORM: RuleForm = {
  name: "",
  sensor_name: SENSOR_CARDS[0]?.key ?? "greenhouse_temperature",
  operator: ">",
  threshold: "28",
  unit: "",
  actuator_name: ACTUATOR_CARDS[0]?.key ?? "cooling_fan",
  target_state: "ON",
  enabled: true,
};

// Engine responses can be `{actuators: {...}}` or raw map; normalize both.
function normalizeActuatorsPayload(raw: unknown): ActuatorsMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  if ("actuators" in raw) {
    const nested = (raw as { actuators?: unknown }).actuators;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return nested as ActuatorsMap;
    }

    return {};
  }

  return raw as ActuatorsMap;
}

// Small helper used to safely work with unknown JSON values.
function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

// Converts heterogeneous sensor payloads to a UI-friendly value label.
function extractSensorDisplay(sensorName: string, sensor?: SensorState): string {
  if (!sensor) {
    return "--";
  }

  const value = sensor.value;

  if (typeof value === "number") {
    const unit = sensor.unit ? ` ${sensor.unit}` : "";
    return `${value.toFixed(2)}${unit}`;
  }

  if (typeof value === "string") {
    const unit = sensor.unit ? ` ${sensor.unit}` : "";
    return `${value}${unit}`;
  }

  const payload = asRecord(value);

  if (!payload) {
    return "--";
  }

  const measurements = payload.measurements;
  if (Array.isArray(measurements) && measurements.length > 0) {
    const first = asRecord(measurements[0]);
    if (first && typeof first.value === "number") {
      const unit = typeof first.unit === "string" ? ` ${first.unit}` : "";
      return `${first.value.toFixed(2)}${unit}`;
    }
  }

  // Sensor-specific fallbacks for structured payload variants.
  if (sensorName === "water_tank_level") {
    if (typeof payload.level_pct === "number") {
      return `${payload.level_pct.toFixed(2)} %`;
    }
  }

  if (sensorName === "air_quality_pm25") {
    if (typeof payload.pm25_ug_m3 === "number") {
      return `${payload.pm25_ug_m3.toFixed(2)} ug/m3`;
    }
  }

  return JSON.stringify(value);
}

// Render ISO timestamps in a human-readable local format for sensor cards.
function formatSensorTimestamp(timestamp?: string | null): string {
  if (!timestamp) {
    return "--";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return new Intl.DateTimeFormat("it-IT", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

// Actuator payloads may be string states or nested objects.
function extractActuatorState(value: string | Record<string, unknown> | undefined): "ON" | "OFF" {
  if (typeof value === "string") {
    return value === "ON" ? "ON" : "OFF";
  }

  const payload = asRecord(value);
  if (payload && payload.state === "ON") {
    return "ON";
  }

  return "OFF";
}

// Left-pad time fragments for clock rendering.
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

// Compute Martian Coordinated Time (MTC) from current Earth time.
function getMartianClock(): string {
  const unixDays = Date.now() / 86_400_000;
  const julianDate = unixDays + 2_440_587.5;
  const marsSolDate = (julianDate - 2_405_522.0028779) / 1.0274912517;

  const fractional = ((marsSolDate % 1) + 1) % 1;
  const mtcHoursTotal = fractional * 24;
  const mtcHours = Math.floor(mtcHoursTotal);
  const mtcMinutes = Math.floor((mtcHoursTotal - mtcHours) * 60);
  const mtcSeconds = Math.floor((((mtcHoursTotal - mtcHours) * 60) - mtcMinutes) * 60);

  return `MSD ${marsSolDate.toFixed(3)} | MTC ${pad2(mtcHours)}:${pad2(mtcMinutes)}:${pad2(mtcSeconds)}`;
}

// Generate synthetic telemetry points for the simulated stream widget.
function createTelemetryPoint(timestamp: number): TelemetryPoint {
  const date = new Date(timestamp);
  const timeLabel = `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;

  const drift = Math.sin(timestamp / 18_000) * 4;
  const turbulence = (Math.random() - 0.5) * 3;
  const powerBusKw = Math.max(42, Math.min(74, 57 + drift + turbulence));
  const solarArrayKw = Math.max(40, Math.min(82, powerBusKw + 7 + (Math.random() - 0.5) * 4));

  return {
    timeLabel,
    powerBusKw: Number(powerBusKw.toFixed(2)),
    solarArrayKw: Number(solarArrayKw.toFixed(2)),
  };
}

function App() {
  // Top-level page state: backend status, realtime link, entities, and UI flags.
  const [engineStatus, setEngineStatus] = useState("loading...");
  const [wsMessage, setWsMessage] = useState("waiting...");
  const [sensors, setSensors] = useState<SensorsMap>({});
  const [actuators, setActuators] = useState<ActuatorsMap>({});
  const [rules, setRules] = useState<Rule[]>([]);
  const [ruleForm, setRuleForm] = useState<RuleForm>(DEFAULT_RULE_FORM);
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [rulesBusy, setRulesBusy] = useState(false);
  const [rulesFeedback, setRulesFeedback] = useState<string>("");
  const [martianClock, setMartianClock] = useState(getMartianClock);
  const [telemetry, setTelemetry] = useState<TelemetryPoint[]>(() => {
    const now = Date.now();
    return Array.from({ length: 14 }, (_, index) => createTelemetryPoint(now - (13 - index) * 5_000));
  });
  const [radiationStatus, setRadiationStatus] = useState<"Normal" | "Warning">("Normal");
  const [lifeSupportStatus, setLifeSupportStatus] = useState<"Normal" | "Warning">("Normal");

  // Derived/sorted views to keep rendering deterministic.
  const sortedSensorEntries = useMemo(
    () => Object.entries(sensors).sort(([a], [b]) => a.localeCompare(b)),
    [sensors]
  );

  const sortedRules = useMemo(() => [...rules].sort((a, b) => a.id - b.id), [rules]);
  const activeRules = useMemo(() => sortedRules.filter((rule) => rule.enabled), [sortedRules]);

  const wsConnected = wsMessage !== "waiting...";

  // Reset rule form after creation or when user cancels edit mode.
  function resetRuleForm() {
    setRuleForm(DEFAULT_RULE_FORM);
    setEditingRuleId(null);
  }

  // Load selected rule values into the form for in-place editing.
  function fillRuleForm(rule: Rule) {
    setRuleForm({
      name: rule.name,
      sensor_name: rule.sensor_name,
      operator: rule.operator,
      threshold: String(rule.threshold),
      unit: rule.unit ?? "",
      actuator_name: rule.actuator_name,
      target_state: rule.target_state,
      enabled: rule.enabled,
    });
    setEditingRuleId(rule.id);
    setRulesFeedback("");
  }

  // Bootstrap dashboard data with parallel REST requests.
  async function loadInitialData() {
    try {
      const [healthRes, stateRes, actuatorsRes, rulesRes] = await Promise.all([
        fetch(`${API_BASE}/health`),
        fetch(`${API_BASE}/api/state`),
        fetch(`${API_BASE}/api/actuators`),
        fetch(`${API_BASE}/api/rules`),
      ]);

      const healthData = await healthRes.json();
      const stateData = await stateRes.json();
      const actuatorsData = await actuatorsRes.json();
      const rulesData = (await rulesRes.json()) as Rule[];

      setEngineStatus(JSON.stringify(healthData));
      setSensors(stateData as SensorsMap);
      setActuators(normalizeActuatorsPayload(actuatorsData));
      setRules(Array.isArray(rulesData) ? rulesData : []);
    } catch (error) {
      // Keep UI operational even if backend is temporarily unavailable.
      console.error(error);
      setEngineStatus("engine-service not reachable");
    }
  }

  // Refresh rules list independently (also used by periodic poll).
  async function refreshRules() {
    try {
      const response = await fetch(`${API_BASE}/api/rules`);
      const data = (await response.json()) as Rule[];
      setRules(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Rules refresh failed", error);
    }
  }

  // Manual actuator command (US-10).
  async function toggleActuator(name: string, targetState: "ON" | "OFF") {
    try {
      const response = await fetch(`${API_BASE}/api/actuators/${name}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ state: targetState }),
      });

      const data = await response.json();
      setActuators(normalizeActuatorsPayload(data));
    } catch (error) {
      console.error("Actuator toggle failed", error);
    }
  }

  // Create or update rule depending on current edit mode.
  async function submitRuleForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const threshold = Number(ruleForm.threshold);
    if (!Number.isFinite(threshold)) {
      setRulesFeedback("Threshold must be numeric");
      return;
    }

    const payload = {
      name: ruleForm.name.trim() || `${ruleForm.sensor_name}-${ruleForm.actuator_name}`,
      sensor_name: ruleForm.sensor_name,
      operator: ruleForm.operator,
      threshold,
      unit: ruleForm.unit.trim() || null,
      actuator_name: ruleForm.actuator_name,
      target_state: ruleForm.target_state,
      enabled: ruleForm.enabled,
    };

    setRulesBusy(true);
    setRulesFeedback("");

    try {
      const response = await fetch(
        editingRuleId === null ? `${API_BASE}/api/rules` : `${API_BASE}/api/rules/${editingRuleId}`,
        {
          method: editingRuleId === null ? "POST" : "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        throw new Error(await response.text());
      }

      await refreshRules();
      setRulesFeedback(editingRuleId === null ? "Rule created" : "Rule updated");
      resetRuleForm();
    } catch (error) {
      console.error(error);
      setRulesFeedback("Rule operation failed");
    } finally {
      setRulesBusy(false);
    }
  }

  // Enable/disable rule without editing full payload.
  async function toggleRuleEnabled(rule: Rule) {
    setRulesBusy(true);
    setRulesFeedback("");

    try {
      const response = await fetch(`${API_BASE}/api/rules/${rule.id}/enabled`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      await refreshRules();
      setRulesFeedback(`Rule ${rule.id} ${rule.enabled ? "disabled" : "enabled"}`);
    } catch (error) {
      console.error(error);
      setRulesFeedback("Cannot toggle rule state");
    } finally {
      setRulesBusy(false);
    }
  }

  // Delete one rule after explicit confirmation.
  async function deleteRule(ruleId: number) {
    const confirmed = window.confirm(`Delete rule ${ruleId}?`);
    if (!confirmed) {
      return;
    }

    setRulesBusy(true);
    setRulesFeedback("");

    try {
      const response = await fetch(`${API_BASE}/api/rules/${ruleId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      if (editingRuleId === ruleId) {
        resetRuleForm();
      }

      await refreshRules();
      setRulesFeedback(`Rule ${ruleId} deleted`);
    } catch (error) {
      console.error(error);
      setRulesFeedback("Cannot delete rule");
    } finally {
      setRulesBusy(false);
    }
  }

  // Bootstraps initial state, opens websocket channel, and keeps rules list fresh.
  useEffect(() => {
    const initialLoadTimer = window.setTimeout(() => {
      void loadInitialData();
    }, 0);

    const ws = new WebSocket(`${WS_BASE}/ws`);

    ws.onmessage = (event) => {
      setWsMessage(event.data);

      try {
        const payload = JSON.parse(event.data) as {
          type?: string;
          payload?: unknown;
          sensor_name?: string;
        };

        if (payload.type === "state_snapshot") {
          // Full snapshot sent immediately after WS connect.
          const snapshot = asRecord(payload.payload);
          const sensorsPayload = snapshot?.sensors;
          if (sensorsPayload && typeof sensorsPayload === "object" && !Array.isArray(sensorsPayload)) {
            setSensors(sensorsPayload as SensorsMap);
          }
        }

        if (payload.type === "sensor_update" && payload.sensor_name && payload.payload) {
          // Incremental sensor update from engine consumer.
          setSensors((prev) => ({
            ...prev,
            [payload.sensor_name as string]: payload.payload as SensorState,
          }));
        }

        if (payload.type === "actuator_update") {
          // Actuator state refresh after manual or rule-triggered actions.
          setActuators(normalizeActuatorsPayload(payload.payload));
        }
      } catch {
        // heartbeat payload is not relevant for state updates
      }
    };

    const rulesInterval = window.setInterval(() => {
      void refreshRules();
    }, 20_000);

    return () => {
      window.clearTimeout(initialLoadTimer);
      window.clearInterval(rulesInterval);
      ws.close();
    };
  }, []);

  // Dedicated clock ticker for the Martian time display.
  useEffect(() => {
    const clockInterval = window.setInterval(() => {
      setMartianClock(getMartianClock());
    }, 1_000);

    return () => window.clearInterval(clockInterval);
  }, []);

  // Synthetic telemetry feed used to keep stream widget active in 2-person scope.
  useEffect(() => {
    const telemetryInterval = window.setInterval(() => {
      setTelemetry((prev) => {
        const nextPoint = createTelemetryPoint(Date.now());
        const next = [...prev.slice(-13), nextPoint];

        setRadiationStatus(nextPoint.powerBusKw < 50 ? "Warning" : "Normal");
        setLifeSupportStatus(nextPoint.solarArrayKw < 58 ? "Warning" : "Normal");

        return next;
      });
    }, 5_000);

    return () => window.clearInterval(telemetryInterval);
  }, []);

  return (
    // Layered background: solid fallback + Mars image + dark gradient overlay.
    <div className="relative min-h-screen overflow-hidden bg-orange-950">
      <div className="absolute inset-0 bg-orange-950" />
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-25"
        style={{ backgroundImage: `url(${MARS_BG_URL})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-br from-orange-950/88 via-slate-950/92 to-black/96" />

      <div className="relative z-10 mx-auto max-w-7xl p-4 md:p-8">
        {/* Mission header with title, Martian clock and backend connectivity info. */}
        <header className={`${cardClass} mb-4 border-orange-400/45 p-5 shadow-[0_0_20px_rgba(251,146,60,0.25)]`}>
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-cyan-300">Mission: Please Don&apos;t Die</p>
              <h1 className="mt-1 text-2xl font-semibold text-white md:text-3xl">
                Mars Operations Dashboard - Habitat 1
              </h1>
            </div>

            <div className="rounded-xl border border-cyan-400/45 bg-black/30 px-4 py-3 font-mono text-sm text-cyan-200">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-300">Martian Sol Time</p>
              <p className="mt-1 text-base text-cyan-100">{martianClock}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-2 text-xs text-slate-300 md:grid-cols-2">
            <p className="truncate">Engine health snapshot: {engineStatus}</p>
            <p className="text-right">
              Link status:{" "}
              <span className={wsConnected ? "text-cyan-300" : "text-orange-300"}>
                {wsConnected ? "ONLINE" : "BOOTING"}
              </span>
            </p>
          </div>
        </header>

        <main className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          {/* REST sensor panel fed by latest_state cache from engine-service. */}
          <section className={`${cardClass} xl:col-span-4`}>
            <div className="border-b border-cyan-400/30 px-4 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-300">
                REST Sensors (Polling)
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
              {SENSOR_CARDS.map(({ key, label, icon: Icon, accent }) => {
                const sensor = sensors[key];
                const valueLabel = extractSensorDisplay(key, sensor);

                return (
                  <article
                    key={key}
                    className="rounded-xl border border-cyan-500/30 bg-black/30 p-3 shadow-[0_0_12px_rgba(6,182,212,0.18)]"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs uppercase tracking-wider text-slate-300">{label}</p>
                      <Icon className={`h-4 w-4 ${accent}`} />
                    </div>

                    <p className={`text-lg font-semibold ${accent}`}>{valueLabel}</p>
                    <p className="mt-1 truncate text-[11px] text-slate-400">
                      {formatSensorTimestamp(sensor?.timestamp)}
                    </p>
                  </article>
                );
              })}
            </div>

            {sortedSensorEntries.length === 0 && (
              <p className="px-4 pb-4 text-sm text-slate-300">Waiting for sensor payloads...</p>
            )}
          </section>

          {/* Simulated telemetry chart + status badges for radiation/life support. */}
          <section className={`${cardClass} xl:col-span-4`}>
            <div className="border-b border-cyan-400/30 px-4 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-300">
                Telemetry Stream (Simulated)
              </h2>
            </div>

            <div className="h-64 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={telemetry}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                  <XAxis dataKey="timeLabel" tick={{ fill: "#cbd5e1", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#cbd5e1", fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      border: "1px solid rgba(6,182,212,0.45)",
                      borderRadius: "12px",
                      backgroundColor: "rgba(2,6,23,0.9)",
                      color: "#e2e8f0",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="powerBusKw"
                    stroke="#22d3ee"
                    strokeWidth={2}
                    dot={false}
                    name="Power Bus (kW)"
                  />
                  <Line
                    type="monotone"
                    dataKey="solarArrayKw"
                    stroke="#fb923c"
                    strokeWidth={2}
                    dot={false}
                    name="Solar Array (kW)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-2 gap-3 px-4 pb-4">
              <div className="rounded-xl border border-cyan-500/30 bg-black/30 p-3">
                <p className="mb-1 text-xs uppercase tracking-wider text-slate-300">Radiation</p>
                <p className="flex items-center gap-2 text-sm font-semibold">
                  {radiationStatus === "Normal" ? (
                    <Leaf className="h-4 w-4 text-cyan-300" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-orange-300" />
                  )}
                  <span className={radiationStatus === "Normal" ? "text-cyan-300" : "text-orange-300"}>
                    {radiationStatus}
                  </span>
                </p>
              </div>

              <div className="rounded-xl border border-cyan-500/30 bg-black/30 p-3">
                <p className="mb-1 text-xs uppercase tracking-wider text-slate-300">Life Support</p>
                <p className="flex items-center gap-2 text-sm font-semibold">
                  {lifeSupportStatus === "Normal" ? (
                    <Activity className="h-4 w-4 text-cyan-300" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-orange-300" />
                  )}
                  <span className={lifeSupportStatus === "Normal" ? "text-cyan-300" : "text-orange-300"}>
                    {lifeSupportStatus}
                  </span>
                </p>
              </div>
            </div>
          </section>

          {/* Actuator toggles for manual override commands. */}
          <section className={`${cardClass} xl:col-span-4`}>
            <div className="border-b border-cyan-400/30 px-4 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-300">
                Actuators (Toggle)
              </h2>
            </div>

            <div className="space-y-3 p-4">
              {ACTUATOR_CARDS.map(({ key, label, icon: Icon }) => {
                const currentState = extractActuatorState(actuators[key]);
                const targetState = currentState === "ON" ? "OFF" : "ON";

                return (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-xl border border-cyan-500/30 bg-black/30 px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="h-4 w-4 text-cyan-300" />
                      <div>
                        <p className="text-sm text-slate-100">{label}</p>
                        <p className="text-xs text-slate-400">{key}</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      aria-label={`Toggle ${label}`}
                      className={`relative h-7 w-14 rounded-full border transition-all ${
                        currentState === "ON"
                          ? "border-cyan-300 bg-cyan-500/35 shadow-[0_0_14px_rgba(6,182,212,0.4)]"
                          : "border-orange-300/70 bg-orange-500/20 shadow-[0_0_14px_rgba(249,115,22,0.35)]"
                      }`}
                      onClick={() => {
                        void toggleActuator(key, targetState);
                      }}
                    >
                      <span
                        className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full transition-all ${
                          currentState === "ON"
                            ? "left-8 bg-cyan-100 shadow-[0_0_12px_rgba(6,182,212,0.9)]"
                            : "left-1 bg-orange-100 shadow-[0_0_12px_rgba(249,115,22,0.9)]"
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Decorative hologram placeholder (layout anchor for mission-control style). */}
          <section className={`${cardClass} flex min-h-[320px] items-center justify-center xl:col-span-6`}>
            <div className="relative flex h-72 w-72 items-center justify-center rounded-full border border-cyan-300/70 bg-cyan-500/10 shadow-[0_0_35px_rgba(6,182,212,0.3)]">
              <div className="absolute inset-5 rounded-full border border-cyan-300/45 animate-[spin_18s_linear_infinite]" />
              <div className="absolute inset-10 rounded-full border border-orange-300/40 animate-[spin_12s_linear_infinite_reverse]" />
              <div className="absolute h-1 w-40 bg-gradient-to-r from-transparent via-cyan-300/90 to-transparent animate-[spin_8s_linear_infinite]" />

              <span className="absolute left-[22%] top-[33%] h-3 w-3 rounded-full bg-cyan-200 shadow-[0_0_14px_rgba(34,211,238,0.95)]">
                <span className="absolute inset-0 animate-ping rounded-full bg-cyan-200/70" />
              </span>
              <span className="absolute left-[65%] top-[24%] h-3 w-3 rounded-full bg-orange-200 shadow-[0_0_14px_rgba(251,146,60,0.95)]">
                <span className="absolute inset-0 animate-ping rounded-full bg-orange-200/70" />
              </span>
              <span className="absolute left-[56%] top-[65%] h-3 w-3 rounded-full bg-cyan-200 shadow-[0_0_14px_rgba(34,211,238,0.95)]">
                <span className="absolute inset-0 animate-ping rounded-full bg-cyan-200/70" />
              </span>

              <div className="rounded-xl border border-cyan-300/40 bg-black/30 px-4 py-2 text-center">
                <p className="text-xs uppercase tracking-[0.18em] text-cyan-300">Hologram Core</p>
                <p className="mt-1 text-sm text-slate-100">Habitat Map Sync</p>
              </div>
            </div>
          </section>

          {/* Rule engine area: active rules preview + create/edit form + full list controls. */}
          <section className={`${cardClass} xl:col-span-6`}>
            <div className="border-b border-cyan-400/30 px-4 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-300">
                Automation Rules (Terminal + Controls)
              </h2>
            </div>

            <div className="grid gap-4 p-4 lg:grid-cols-2">
              <div className="rounded-xl border border-orange-300/45 bg-black/50 p-4 font-mono text-sm shadow-[0_0_18px_rgba(251,146,60,0.2)]">
                {activeRules.length === 0 ? (
                  <p className="text-slate-300">IF greenhouse_temperature &gt; 28 C THEN set cooling_fan to ON</p>
                ) : (
                  <ul className="space-y-2 text-slate-200">
                    {activeRules.map((rule) => (
                      <li key={rule.id}>
                        <span className="text-orange-300">IF</span> {rule.sensor_name} {rule.operator} {rule.threshold}
                        {rule.unit ? ` ${rule.unit}` : ""} <span className="text-orange-300">THEN</span> set {rule.actuator_name} to{" "}
                        <span className={rule.target_state === "ON" ? "text-cyan-300" : "text-orange-300"}>
                          {rule.target_state}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <form
                className="space-y-3 rounded-xl border border-cyan-500/30 bg-black/40 p-4"
                onSubmit={(event) => {
                  void submitRuleForm(event);
                }}
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    value={ruleForm.name}
                    onChange={(event) => setRuleForm((prev) => ({ ...prev, name: event.target.value }))}
                    className="rounded-lg border border-cyan-500/35 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-300"
                    placeholder="Rule name"
                  />

                  <input
                    value={ruleForm.threshold}
                    onChange={(event) => setRuleForm((prev) => ({ ...prev, threshold: event.target.value }))}
                    className="rounded-lg border border-cyan-500/35 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-300"
                    placeholder="Threshold"
                  />
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <select
                    value={ruleForm.sensor_name}
                    onChange={(event) => setRuleForm((prev) => ({ ...prev, sensor_name: event.target.value }))}
                    className="rounded-lg border border-cyan-500/35 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-300"
                  >
                    {SENSOR_CARDS.map((sensor) => (
                      <option key={sensor.key} value={sensor.key}>
                        {sensor.label}
                      </option>
                    ))}
                  </select>

                  <select
                    value={ruleForm.actuator_name}
                    onChange={(event) => setRuleForm((prev) => ({ ...prev, actuator_name: event.target.value }))}
                    className="rounded-lg border border-cyan-500/35 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-300"
                  >
                    {ACTUATOR_CARDS.map((actuator) => (
                      <option key={actuator.key} value={actuator.key}>
                        {actuator.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <select
                    value={ruleForm.operator}
                    onChange={(event) =>
                      setRuleForm((prev) => ({
                        ...prev,
                        operator: event.target.value as Rule["operator"],
                      }))
                    }
                    className="rounded-lg border border-cyan-500/35 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-300"
                  >
                    {RULE_OPERATORS.map((operator) => (
                      <option key={operator} value={operator}>
                        {operator}
                      </option>
                    ))}
                  </select>

                  <input
                    value={ruleForm.unit}
                    onChange={(event) => setRuleForm((prev) => ({ ...prev, unit: event.target.value }))}
                    className="rounded-lg border border-cyan-500/35 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-300"
                    placeholder="Unit (optional)"
                  />

                  <select
                    value={ruleForm.target_state}
                    onChange={(event) =>
                      setRuleForm((prev) => ({
                        ...prev,
                        target_state: event.target.value as "ON" | "OFF",
                      }))
                    }
                    className="rounded-lg border border-cyan-500/35 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-300"
                  >
                    <option value="ON">ON</option>
                    <option value="OFF">OFF</option>
                  </select>
                </div>

                <label className="inline-flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={ruleForm.enabled}
                    onChange={(event) => setRuleForm((prev) => ({ ...prev, enabled: event.target.checked }))}
                    className="h-4 w-4 rounded border border-cyan-400/50 bg-slate-900/70"
                  />
                  Rule enabled
                </label>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={rulesBusy}
                    className="rounded-lg border border-cyan-300/60 bg-cyan-500/20 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/30 disabled:opacity-60"
                  >
                    {editingRuleId === null ? "Create Rule" : `Update Rule #${editingRuleId}`}
                  </button>

                  {editingRuleId !== null && (
                    <button
                      type="button"
                      disabled={rulesBusy}
                      className="rounded-lg border border-orange-300/70 bg-orange-500/15 px-3 py-2 text-sm font-semibold text-orange-100 transition hover:bg-orange-500/30 disabled:opacity-60"
                      onClick={resetRuleForm}
                    >
                      Cancel Edit
                    </button>
                  )}
                </div>

                {rulesFeedback && <p className="text-xs text-cyan-200">{rulesFeedback}</p>}
              </form>
            </div>

            <div className="px-4 pb-4">
              <div className="space-y-2 rounded-xl border border-cyan-500/30 bg-black/35 p-3">
                {sortedRules.length === 0 ? (
                  <p className="text-sm text-slate-300">No rules configured yet.</p>
                ) : (
                  sortedRules.map((rule) => (
                    <div
                      key={rule.id}
                      className="flex flex-col gap-2 rounded-lg border border-cyan-500/25 bg-slate-950/50 p-3 md:flex-row md:items-center md:justify-between"
                    >
                      <p className="font-mono text-xs text-slate-200">
                        <span className="text-cyan-300">#{rule.id}</span> {rule.name}: IF {rule.sensor_name} {rule.operator}{" "}
                        {rule.threshold}
                        {rule.unit ? ` ${rule.unit}` : ""} THEN {rule.actuator_name} =&gt; {rule.target_state}
                      </p>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={`rounded-md px-2 py-1 text-xs font-semibold ${
                            rule.enabled
                              ? "border border-cyan-300/70 bg-cyan-500/20 text-cyan-100"
                              : "border border-orange-300/70 bg-orange-500/20 text-orange-100"
                          }`}
                          onClick={() => {
                            void toggleRuleEnabled(rule);
                          }}
                        >
                          {rule.enabled ? "Enabled" : "Disabled"}
                        </button>

                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md border border-cyan-300/60 bg-cyan-500/15 px-2 py-1 text-xs font-semibold text-cyan-100"
                          onClick={() => fillRuleForm(rule)}
                        >
                          <Pencil className="h-3 w-3" />
                          Edit
                        </button>

                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md border border-orange-300/70 bg-orange-500/15 px-2 py-1 text-xs font-semibold text-orange-100"
                          onClick={() => {
                            void deleteRule(rule.id);
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
