import {
  type DegradationProfile,
  type Status,
  OBS_STEP,
  estimateRul,
  failureTime,
  hashInts,
  mulberry32,
  noiseAt,
  observe,
  statusFromRul,
  weibull,
} from "./core";

export type ComponentKey = "engine" | "hydraulics" | "avionics" | "landingGear" | "fuel" | "airframe";

export interface ComponentSpec {
  key: ComponentKey;
  name: string;
  weight: number;
  meanLife: number;
  repairDays: number;
  unplannedDays: number;
  part: string;
  partName: string;
  agency: string;
  action: string;
}

export const COMPONENT_SPECS: ComponentSpec[] = [
  { key: "engine", name: "Engine", weight: 0.3, meanLife: 900, repairDays: 4, unplannedDays: 12, part: "ENG-HPT-07", partName: "HP turbine blade set", agency: "ag-eng", action: "Borescope + HPT blade set replacement" },
  { key: "hydraulics", name: "Hydraulics", weight: 0.18, meanLife: 700, repairDays: 2, unplannedDays: 7, part: "HYD-PMP-21", partName: "Hydraulic pump assy", agency: "ag-hyd", action: "Replace hydraulic pump, flush system" },
  { key: "avionics", name: "Avionics", weight: 0.14, meanLife: 1100, repairDays: 1, unplannedDays: 5, part: "AVN-LRU-33", partName: "Mission computer LRU", agency: "ag-avn", action: "Swap LRU, run BIT diagnostics" },
  { key: "landingGear", name: "Landing Gear", weight: 0.14, meanLife: 800, repairDays: 3, unplannedDays: 9, part: "LGR-ACT-12", partName: "Retraction actuator", agency: "ag-hyd", action: "Replace actuator, gear swing test" },
  { key: "fuel", name: "Fuel System", weight: 0.12, meanLife: 950, repairDays: 2, unplannedDays: 6, part: "FUL-BPV-05", partName: "Boost pump & valve kit", agency: "ag-str", action: "Replace boost pump, leak check" },
  { key: "airframe", name: "Airframe", weight: 0.12, meanLife: 1400, repairDays: 5, unplannedDays: 14, part: "STR-FTG-40", partName: "Wing root fitting kit", agency: "ag-str", action: "NDT inspection + fitting repair" },
];
export const SPEC: Record<ComponentKey, ComponentSpec> = Object.fromEntries(
  COMPONENT_SPECS.map((s) => [s.key, s]),
) as Record<ComponentKey, ComponentSpec>;

export const BASES = [
  { id: "north", name: "Base North", squadron: "Sqn Alpha" },
  { id: "west", name: "Base West", squadron: "Sqn Bravo" },
  { id: "east", name: "Base East", squadron: "Sqn Charlie" },
] as const;
export type BaseId = (typeof BASES)[number]["id"];
export const BASE_NAME: Record<string, string> = Object.fromEntries(BASES.map((b) => [b.id, b.name]));
export const HANGARS_PER_BASE = 2;

export interface Agency {
  id: string;
  name: string;
  capacity: number;
  turnaroundDays: number;
  specialties: ComponentKey[];
}
export interface Inventory {
  base: Record<string, Record<string, number>>; // base -> part -> qty
  depot: Record<string, number>;
  leadDays: Record<string, number>;
}

export interface ComponentModel {
  key: ComponentKey;
  uid: number;
  profile: DegradationProfile;
  age0: number;
}
export interface HistoryEvent {
  daysAgo: number;
  kind: "fault" | "maintenance" | "inspection";
  text: string;
}
export interface Aircraft {
  id: string;
  tail: string;
  base: BaseId;
  squadron: string;
  utilization: number; // flight hours per day
  components: ComponentModel[];
  history: HistoryEvent[];
}
export interface Fleet {
  seed: number;
  aircraft: Aircraft[];
  inventory: Inventory;
  agencies: Agency[];
}

export function generateFleet(seed: number): Fleet {
  const r = mulberry32(hashInts(seed, 7));
  const aircraft: Aircraft[] = [];
  for (let i = 0; i < 24; i++) {
    const base = BASES[i % 3];
    const components = COMPONENT_SPECS.map((spec, j) => {
      const life = Math.max(250, weibull(r, 3.2, spec.meanLife));
      const profile: DegradationProfile = { life, shape: 2.5 + 2.5 * r(), sigma: 0.012 + 0.02 * r() };
      const age0 = life * (0.1 + 0.88 * Math.pow(r(), 3.4));
      return { key: spec.key, uid: i * 10 + j, profile, age0 };
    });
    const history: HistoryEvent[] = [];
    const nEv = 3 + Math.floor(r() * 4);
    for (let e = 0; e < nEv; e++) {
      const spec = COMPONENT_SPECS[Math.floor(r() * 6)];
      const kindR = r();
      const kind = kindR < 0.3 ? "fault" : kindR < 0.7 ? "maintenance" : "inspection";
      const text =
        kind === "fault"
          ? `${spec.name}: unscheduled snag reported, rectified`
          : kind === "maintenance"
            ? `${spec.name}: ${spec.action.toLowerCase()}`
            : `${spec.name}: scheduled inspection, no findings`;
      history.push({ daysAgo: Math.floor(5 + r() * 360), kind, text });
    }
    history.sort((a, b) => a.daysAgo - b.daysAgo);
    aircraft.push({
      id: `VD-${101 + i}`,
      tail: `VD-${101 + i}`,
      base: base.id,
      squadron: base.squadron,
      utilization: 2 + r() * 2,
      components,
      history,
    });
  }
  const inventory: Inventory = { base: {}, depot: {}, leadDays: {} };
  for (const b of BASES) {
    inventory.base[b.id] = {};
    for (const s of COMPONENT_SPECS) inventory.base[b.id][s.part] = Math.floor(r() * 2.4);
  }
  for (const s of COMPONENT_SPECS) {
    inventory.depot[s.part] = Math.floor(r() * 3);
    inventory.leadDays[s.part] = 5 + Math.floor(r() * 10);
  }
  const agencies: Agency[] = [
    { id: "ag-eng", name: "Aero-Engine Overhaul Agency", capacity: 2, turnaroundDays: 4, specialties: ["engine"] },
    { id: "ag-hyd", name: "Hydraulics & Gear MRO", capacity: 2, turnaroundDays: 3, specialties: ["hydraulics", "landingGear"] },
    { id: "ag-avn", name: "Avionics Repair Agency", capacity: 3, turnaroundDays: 2, specialties: ["avionics"] },
    { id: "ag-str", name: "Structures & Fuel MRO", capacity: 2, turnaroundDays: 4, specialties: ["airframe", "fuel"] },
  ];
  return { seed, aircraft, inventory, agencies };
}

export interface ComponentState {
  key: ComponentKey;
  name: string;
  age: number;
  health: number;
  rul: number;
  lo: number;
  hi: number;
  status: Status;
  trueRul: number;
  failed: boolean;
  anomalies: number;
  series: { t: number; obs: number; smooth: number | null }[];
}
export interface AircraftState {
  ac: Aircraft;
  comps: ComponentState[];
  health: number;
  worst: ComponentState;
  status: Status;
  rul: number;
}

const WINDOW_POINTS = 30;

export function evaluateComponent(seed: number, ac: Aircraft, c: ComponentModel, simDays: number): ComponentState {
  const spec = SPEC[c.key];
  const age = c.age0 + simDays * ac.utilization;
  const fail = failureTime(c.profile);
  const idx = Math.floor(age / OBS_STEP);
  const times: number[] = [];
  const obs: number[] = [];
  for (let i = Math.max(1, idx - WINDOW_POINTS + 1); i <= idx; i++) {
    times.push(i * OBS_STEP);
    obs.push(observe(c.profile, i * OBS_STEP, [seed, c.uid], i));
  }
  const est = estimateRul(times, obs);
  const failed = age >= fail;
  const health = failed ? 0 : Math.max(0, Math.min(100, 100 * (1 - est.smoothed)));
  const rul = failed ? 0 : est.rul;
  return {
    key: c.key,
    name: spec.name,
    age,
    health,
    rul,
    lo: failed ? 0 : est.lo,
    hi: failed ? 0 : est.hi,
    status: statusFromRul(rul),
    trueRul: Math.max(0, fail - age),
    failed,
    anomalies: est.anomalies,
    series: times.map((t, i) => ({ t, obs: obs[i], smooth: est.smoothSeries[i] })),
  };
}

export function evaluateAircraft(seed: number, ac: Aircraft, simDays: number): AircraftState {
  const comps = ac.components.map((c) => evaluateComponent(seed, ac, c, simDays));
  const min = Math.min(...comps.map((c) => c.health));
  const wmean = comps.reduce((a, c) => a + c.health * SPEC[c.key].weight, 0);
  const worst = comps.reduce((a, c) => (c.rul < a.rul ? c : a), comps[0]);
  return { ac, comps, health: 0.6 * min + 0.4 * wmean, worst, status: worst.status, rul: worst.rul };
}

export function evaluateFleet(fleet: Fleet, simDays: number) {
  return fleet.aircraft.map((ac) => evaluateAircraft(fleet.seed, ac, simDays));
}

export interface Sensors {
  egt: number;
  vibration: number;
  oilPressure: number;
  fuelFlow: number;
  bleedTemp: number;
}
export const SENSOR_META: { key: keyof Sensors; label: string; unit: string; limit: number; dir: "max" | "min" }[] = [
  { key: "egt", label: "Exhaust Gas Temp", unit: "°C", limit: 705, dir: "max" },
  { key: "vibration", label: "Vibration", unit: "ips", limit: 3.4, dir: "max" },
  { key: "oilPressure", label: "Oil Pressure", unit: "psi", limit: 38, dir: "min" },
  { key: "fuelFlow", label: "Fuel Flow", unit: "kg/h", limit: 3350, dir: "max" },
  { key: "bleedTemp", label: "Bleed-Air Temp", unit: "°C", limit: 255, dir: "max" },
];

/** Sensor readings derived from component damage (physics-flavoured mapping) + per-tick noise. */
export function sensorsFor(st: AircraftState, seed: number, tick: number): Sensors {
  const d = (k: ComponentKey) => Math.min(1.2, 1 - st.comps.find((c) => c.key === k)!.health / 100);
  const n = (ch: number) => noiseAt(seed, Number(st.ac.id.slice(3)), ch, tick);
  const de = d("engine");
  return {
    egt: 610 + 95 * de + 4 * n(1),
    vibration: 0.9 + 2.2 * de + 0.9 * d("landingGear") + 0.12 * n(2),
    oilPressure: 58 - 18 * de - 6 * d("hydraulics") + 1.2 * n(3),
    fuelFlow: 2900 + 380 * d("fuel") + 120 * de + 30 * n(4),
    bleedTemp: 205 + 40 * d("airframe") + 18 * de + 2.5 * n(5),
  };
}
