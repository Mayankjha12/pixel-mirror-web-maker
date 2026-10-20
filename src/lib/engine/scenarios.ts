import { type DegradationProfile, hashInts, mulberry32 } from "./core";
import { type Inventory, COMPONENT_SPECS, SPEC, generateFleet, evaluateFleet } from "./fleet";
import { type LifetimePoint, simulateLifetime } from "./lifetime";
import { type CompInput, planMaintenance, inputsFromStates } from "./scheduler";

export type ScenarioId = "gradual" | "spike" | "spares" | "missing" | "peak";
export const SCENARIOS: { id: ScenarioId; title: string; desc: string }[] = [
  { id: "gradual", title: "Gradual engine degradation", desc: "Slow exponential wear of an engine hot section. Can we warn early enough to plan the repair?" },
  { id: "spike", title: "Sudden anomaly spike", desc: "A transient sensor spike mid-life. The gate should reject it without raising a false grounding." },
  { id: "spares", title: "Competing for one spare", desc: "Four aircraft need the same hydraulic pump; only one is in stock. The optimizer must triage." },
  { id: "missing", title: "Missing / dropped sensor data", desc: "30% of samples dropped plus a 40-hour telemetry blackout late in life." },
  { id: "peak", title: "Peak utilization surge", desc: "Fleet flies 5 FH/day with many components near end-of-life at once." },
];

export interface ScenarioResult {
  id: ScenarioId;
  seed: number;
  title: string;
  caught: boolean | null;
  leadTime: number | null;
  falseAlarms: number;
  availabilityImpact: number; // percentage points vs time-based baseline
  metrics: { label: string; value: string }[];
  lifetime?: LifetimePoint[];
  availability?: { day: number; optimized: number; baseline: number }[];
  allocation?: { tail: string; rulDays: number; start: number | null; source: string; note: string }[];
  notes: string;
  ranAt: number;
}

function lifetimeScenario(id: ScenarioId, seed: number, p: DegradationProfile, opts: Parameters<typeof simulateLifetime>[2], title: string, notes: string): ScenarioResult {
  const run = simulateLifetime(p, [seed, 77], opts);
  const spec = SPEC.engine;
  const util = 3;
  const warned = run.watchLead !== null && run.watchLead >= 24;
  const downPred = warned ? spec.repairDays : spec.unplannedDays;
  const interval = 0.6 * spec.meanLife;
  const downBase = run.failAt < interval ? spec.unplannedDays : spec.repairDays;
  return {
    id,
    seed,
    title,
    caught: run.caught,
    leadTime: run.criticalLead,
    falseAlarms: run.falseAlarms,
    availabilityImpact: ((downBase - downPred) / 30) * 100,
    metrics: [
      { label: "True failure at", value: `${run.failAt.toFixed(0)} FH` },
      { label: "First watch alert", value: run.watchLead !== null ? `${run.watchLead.toFixed(0)} FH before` : "never" },
      { label: "Critical alert lead", value: run.criticalLead !== null ? `${run.criticalLead.toFixed(0)} FH (${(run.criticalLead / util).toFixed(1)} days)` : "missed" },
      { label: "Anomalies gated", value: `${run.anomalies}` },
      { label: "Downtime (predictive vs time-based)", value: `${downPred}d vs ${downBase}d` },
    ],
    lifetime: run.points,
    notes,
    ranAt: Date.now(),
  };
}

export function runScenario(id: ScenarioId, seed: number): ScenarioResult {
  const r = mulberry32(hashInts(seed, 4242, id.length));
  const title = SCENARIOS.find((s) => s.id === id)!.title;
  if (id === "gradual") {
    const p = { life: 600 + 300 * r(), shape: 3.5 + r(), sigma: 0.02 };
    return lifetimeScenario(id, seed, p, {}, title, "Smoothed health index tracks the hidden damage; the log-linear fit converges as curvature grows late in life.");
  }
  if (id === "spike") {
    const life = 600 + 300 * r();
    const p = { life, shape: 3.5 + r(), sigma: 0.02, spike: { at: life * (0.35 + 0.15 * r()), dur: 10, mag: 0.35 + 0.2 * r() } };
    return lifetimeScenario(id, seed, p, {}, title, "Innovation gating holds the smoothed estimate during the 2-sample spike; a persistent shift (3+ samples) would be accepted as real damage.");
  }
  if (id === "missing") {
    const life = 600 + 300 * r();
    const p = { life, shape: 3.5 + r(), sigma: 0.022 };
    const dr = mulberry32(hashInts(seed, 13));
    return lifetimeScenario(id, seed, p, { dropRate: 0.3, dropSeed: dr, gap: [life * 0.75, life * 0.75 + 40] }, title, "Gap-aware smoothing scales its gain with elapsed time; the trend fit uses only real samples so the blackout widens, but does not bias, the band.");
  }
  if (id === "spares") {
    const comps: CompInput[] = [];
    for (let i = 0; i < 4; i++) {
      const rul = 20 + 100 * r();
      comps.push({ acId: `SC-${i + 1}`, tail: `VD-9${i + 1}`, base: "north", key: "hydraulics", ageHours: 600, util: 3, predRulHours: rul, predLoHours: rul * 0.8, trueRulHours: rul * (0.85 + 0.3 * r()) });
    }
    const inv: Inventory = { base: { north: { [SPEC.hydraulics.part]: 1 }, west: {}, east: {} }, depot: { [SPEC.hydraulics.part]: 0 }, leadDays: { [SPEC.hydraulics.part]: 7 } };
    const plan = planMaintenance(comps, inv, generateFleet(seed).agencies);
    const failed = plan.tasks.filter((t) => !t.beforeFailure).length;
    return {
      id, seed, title,
      caught: failed === 0,
      leadTime: null,
      falseAlarms: 0,
      availabilityImpact: plan.avgOpt - plan.avgBase,
      metrics: [
        { label: "Aircraft competing", value: "4" },
        { label: "Spares in stock", value: "1 (7-day lead on reorder)" },
        { label: "Failures before repair", value: `${failed}` },
        { label: "Avg availability (opt vs time-based)", value: `${plan.avgOpt.toFixed(1)}% vs ${plan.avgBase.toFixed(1)}%` },
      ],
      availability: plan.availability,
      allocation: plan.tasks.map((t) => ({
        tail: t.tail,
        rulDays: t.rulDays,
        start: t.start,
        source: t.spareSource,
        note: t.beforeFailure ? "Repaired before failure" : "Fails while awaiting spare",
      })),
      notes: "Highest urgency × impact gets the in-stock spare; others are scheduled on spare arrival. With 1 spare and 4 near-failures, some unplanned downtime is unavoidable — the optimizer minimises it, it can't eliminate it.",
      ranAt: Date.now(),
    };
  }
  // peak
  const fleet = generateFleet(seed);
  fleet.aircraft.forEach((a) => {
    a.utilization = 5;
    a.components.forEach((c) => (c.age0 = c.profile.life * (0.6 + 0.38 * r())));
  });
  const plan = planMaintenance(inputsFromStates(evaluateFleet(fleet, 0)), fleet.inventory, fleet.agencies);
  const conflicts = plan.tasks.reduce((a, t) => a + t.conflicts.length, 0);
  return {
    id, seed, title,
    caught: null,
    leadTime: null,
    falseAlarms: 0,
    availabilityImpact: plan.avgOpt - plan.avgBase,
    metrics: [
      { label: "Maintenance tasks", value: `${plan.tasks.length}` },
      { label: "Residual constraint warnings", value: `${conflicts}` },
      { label: "Avoided downtime", value: `${plan.avoidedDowntimeDays.toFixed(1)} aircraft-days` },
      { label: "Unplanned failures avoided", value: `${plan.avoidedUnplannedFailures}` },
      { label: "Avg availability (opt vs time-based)", value: `${plan.avgOpt.toFixed(1)}% vs ${plan.avgBase.toFixed(1)}%` },
    ],
    availability: plan.availability,
    notes: `${COMPONENT_SPECS.length} component types × 24 aircraft at 5 FH/day. Hangar slots and agency capacity become binding — expect queued tasks.`,
    ranAt: Date.now(),
  };
}
