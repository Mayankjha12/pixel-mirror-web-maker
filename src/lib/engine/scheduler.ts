import { CRITICAL_RUL, WATCH_RUL } from "./core";
import { type Agency, type AircraftState, type ComponentKey, type Inventory, HANGARS_PER_BASE, SPEC } from "./fleet";

export const HORIZON = 30;

export interface CompInput {
  acId: string;
  tail: string;
  base: string;
  key: ComponentKey;
  ageHours: number;
  util: number; // flight hours / day
  predRulHours: number;
  predLoHours: number;
  trueRulHours: number;
}

export interface ScheduledTask {
  id: string;
  acId: string;
  tail: string;
  base: string;
  key: ComponentKey;
  name: string;
  part: string;
  rulDays: number;
  rulHours: number;
  trueFailDay: number;
  duration: number;
  priority: number;
  start: number | null;
  hangar: number;
  agencyId: string;
  spareSource: "base" | "transfer" | "depot" | "order" | "none";
  spareFrom?: string;
  spareReadyDay: number;
  beforeFailure: boolean;
  conflicts: string[];
}

export interface PlanResult {
  tasks: ScheduledTask[];
  naive: ScheduledTask[];
  naiveConflicts: number;
  availability: { day: number; optimized: number; baseline: number }[];
  avgOpt: number;
  avgBase: number;
  downOptDays: number;
  downBaseDays: number;
  avoidedDowntimeDays: number;
  avoidedUnplannedFailures: number;
  transfers: { part: string; from: string; to: string; tail: string }[];
}

export function inputsFromStates(states: AircraftState[]): CompInput[] {
  return states.flatMap((s) =>
    s.comps.map((c) => ({
      acId: s.ac.id,
      tail: s.ac.tail,
      base: s.ac.base,
      key: c.key,
      ageHours: c.age,
      util: s.ac.utilization,
      predRulHours: c.rul,
      predLoHours: c.lo,
      trueRulHours: c.failed ? 0 : c.trueRul,
    })),
  );
}

function needsTask(c: CompInput) {
  // plan anything predicted (conservatively, using the lower band) to cross threshold within horizon + buffer
  return c.predLoHours / c.util < HORIZON + 5 || c.predRulHours < WATCH_RUL;
}

function makeTask(c: CompInput): ScheduledTask {
  const spec = SPEC[c.key];
  const rulDays = Math.max(0, c.predRulHours / c.util);
  const urgency = 1 / (1 + Math.max(0, c.predLoHours / c.util));
  const impact = (spec.unplannedDays - spec.repairDays) * (1 + spec.weight) * (c.predRulHours < CRITICAL_RUL ? 1.5 : 1);
  return {
    id: `${c.acId}-${c.key}`,
    acId: c.acId,
    tail: c.tail,
    base: c.base,
    key: c.key,
    name: spec.name,
    part: spec.part,
    rulDays,
    rulHours: c.predRulHours,
    trueFailDay: c.trueRulHours / c.util,
    duration: spec.repairDays,
    priority: urgency * impact,
    start: null,
    hangar: 0,
    agencyId: spec.agency,
    spareSource: "none",
    spareReadyDay: 0,
    beforeFailure: false,
    conflicts: [],
  };
}

function cloneInv(inv: Inventory): Inventory {
  return {
    base: Object.fromEntries(Object.entries(inv.base).map(([b, p]) => [b, { ...p }])),
    depot: { ...inv.depot },
    leadDays: { ...inv.leadDays },
  };
}

type Interval = [number, number];
function downIntervalsFor(task: { start: number | null; duration: number; trueFailDay: number; key: ComponentKey }): Interval {
  const spec = SPEC[task.key];
  if (task.start !== null && task.start <= task.trueFailDay) return [task.start, task.start + task.duration];
  return [task.trueFailDay, task.trueFailDay + spec.unplannedDays];
}

function availabilitySeries(acIds: string[], down: Map<string, Interval[]>) {
  const out: number[] = [];
  for (let d = 0; d < HORIZON; d++) {
    let up = 0;
    for (const id of acIds) {
      const iv = down.get(id) ?? [];
      if (!iv.some(([s, e]) => d + 0.5 >= s && d + 0.5 < e)) up++;
    }
    out.push((100 * up) / Math.max(1, acIds.length));
  }
  return out;
}
const sumDown = (s: number[], n: number) => s.reduce((a, v) => a + ((100 - v) / 100) * n, 0);

/** Time-based (calendar/hour interval) maintenance baseline. */
export function baselineDowntime(comps: CompInput[]) {
  const down = new Map<string, Interval[]>();
  let unplanned = 0;
  for (const c of comps) {
    const spec = SPEC[c.key];
    const interval = 0.6 * spec.meanLife;
    const dueHours = Math.ceil(c.ageHours / interval) * interval - c.ageHours;
    const dueDay = dueHours / c.util;
    const failDay = c.trueRulHours / c.util;
    let iv: Interval | null = null;
    if (failDay < dueDay && failDay < HORIZON) {
      iv = [failDay, failDay + spec.unplannedDays];
      unplanned++;
    } else if (dueDay < HORIZON) iv = [dueDay, dueDay + spec.repairDays];
    if (iv) down.set(c.acId, [...(down.get(c.acId) ?? []), iv]);
  }
  return { down, unplanned };
}

export function planMaintenance(comps: CompInput[], inventory: Inventory, agencies: Agency[]): PlanResult {
  const acIds = [...new Set(comps.map((c) => c.acId))];
  const candidates = comps.filter(needsTask).map(makeTask);
  const agencyById = Object.fromEntries(agencies.map((a) => [a.id, a]));
  const bases = [...new Set(comps.map((c) => c.base))];

  // ---------- Naive just-in-time plan (for conflict detection) ----------
  const naiveInv = cloneInv(inventory);
  const naive = candidates.map((t) => {
    const n = { ...t, conflicts: [] as string[] };
    n.start = Math.max(0, Math.floor(t.rulDays - t.duration));
    n.hangar = 0;
    const stock = naiveInv.base[t.base]?.[t.part] ?? 0;
    if (stock > 0) {
      naiveInv.base[t.base][t.part]--;
      n.spareSource = "base";
    } else {
      n.conflicts.push(`Missing spare ${t.part} at ${t.base}`);
      n.spareSource = "none";
    }
    return n;
  });
  for (const a of naive) {
    for (const b of naive) {
      if (a === b || a.start === null || b.start === null) continue;
      const overlap = a.start < b.start + b.duration && b.start < a.start + a.duration;
      if (!overlap) continue;
      if (a.base === b.base && a.hangar === b.hangar && a.id < b.id) a.conflicts.push(`Hangar slot clash with ${b.tail}`);
    }
    if (a.start !== null) {
      const load = naive.filter(
        (b) => b.agencyId === a.agencyId && b.start !== null && a.start! < b.start + b.duration && b.start < a.start! + a.duration,
      ).length;
      if (load > (agencyById[a.agencyId]?.capacity ?? 1)) a.conflicts.push(`Agency full (${agencyById[a.agencyId]?.name})`);
    }
  }
  const naiveConflicts = naive.reduce((n, t) => n + t.conflicts.length, 0);

  // ---------- Greedy priority optimizer ----------
  const inv = cloneInv(inventory);
  const hangarBusy: Record<string, Interval[][]> = Object.fromEntries(
    bases.map((b) => [b, Array.from({ length: HANGARS_PER_BASE }, () => [] as Interval[])]),
  );
  const agencyLoad: Record<string, number[]> = Object.fromEntries(agencies.map((a) => [a.id, Array(HORIZON + 20).fill(0)]));
  const transfers: PlanResult["transfers"] = [];
  const sorted = [...candidates].sort((a, b) => b.priority - a.priority);
  const acBusy = new Map<string, Interval[]>();

  for (const t of sorted) {
    // 1. Spare sourcing
    if ((inv.base[t.base]?.[t.part] ?? 0) > 0) {
      inv.base[t.base][t.part]--;
      t.spareSource = "base";
      t.spareReadyDay = 0;
    } else {
      const donor = bases.find((b) => b !== t.base && (inv.base[b]?.[t.part] ?? 0) > 1) ?? bases.find((b) => b !== t.base && (inv.base[b]?.[t.part] ?? 0) > 0);
      if (donor) {
        inv.base[donor][t.part]--;
        t.spareSource = "transfer";
        t.spareFrom = donor;
        t.spareReadyDay = 1;
        transfers.push({ part: t.part, from: donor, to: t.base, tail: t.tail });
      } else if ((inv.depot[t.part] ?? 0) > 0) {
        inv.depot[t.part]--;
        t.spareSource = "depot";
        t.spareFrom = "depot";
        t.spareReadyDay = 2;
        transfers.push({ part: t.part, from: "depot", to: t.base, tail: t.tail });
      } else {
        t.spareSource = "order";
        t.spareReadyDay = inv.leadDays[t.part] ?? 10;
        t.conflicts.push(`Spare shortage: ${t.part} on order, ${t.spareReadyDay}d lead time`);
      }
    }
    // 2. Earliest feasible slot (hangar + agency capacity + aircraft not already in work)
    const agency = agencyById[t.agencyId];
    let placed = false;
    for (let d = t.spareReadyDay; d < HORIZON + 10 && !placed; d++) {
      const end = d + t.duration;
      const agencyOk = Array.from({ length: t.duration }, (_, k) => agencyLoad[t.agencyId][d + k] ?? 0).every(
        (l) => l < (agency?.capacity ?? 1),
      );
      if (!agencyOk) continue;
      // bundle with existing work on same aircraft if overlapping is allowed: same hangar reuse
      const mine = acBusy.get(t.acId) ?? [];
      for (let h = 0; h < HANGARS_PER_BASE; h++) {
        const busy = hangarBusy[t.base][h];
        if (busy.some(([s, e]) => d < e && s < end)) continue;
        if (mine.some(([s, e]) => d < e && s < end)) continue;
        t.start = d;
        t.hangar = h;
        busy.push([d, end]);
        mine.push([d, end]);
        acBusy.set(t.acId, mine);
        for (let k = 0; k < t.duration; k++) agencyLoad[t.agencyId][d + k]++;
        placed = true;
        break;
      }
    }
    if (!placed) t.conflicts.push("No hangar/agency slot inside horizon");
    t.beforeFailure = t.start !== null && t.start <= t.trueFailDay;
    if (t.start !== null && t.start > t.rulDays) t.conflicts.push("Scheduled after predicted failure — expedite spare");
  }

  // ---------- Availability forecasts ----------
  const downOpt = new Map<string, Interval[]>();
  const taskIds = new Set(sorted.map((t) => t.id));
  for (const t of sorted) {
    if (t.start === null && t.trueFailDay >= HORIZON) continue;
    downOpt.set(t.acId, [...(downOpt.get(t.acId) ?? []), downIntervalsFor(t)]);
  }
  let missed = 0;
  for (const c of comps) {
    if (taskIds.has(`${c.acId}-${c.key}`)) continue;
    const fd = c.trueRulHours / c.util;
    if (fd < HORIZON) {
      missed++;
      downOpt.set(c.acId, [...(downOpt.get(c.acId) ?? []), [fd, fd + SPEC[c.key].unplannedDays]]);
    }
  }
  const base = baselineDowntime(comps);
  const opt = availabilitySeries(acIds, downOpt);
  const bas = availabilitySeries(acIds, base.down);
  const unplannedOpt = sorted.filter((t) => !t.beforeFailure && t.trueFailDay < HORIZON).length + missed;
  const downOptDays = sumDown(opt, acIds.length);
  const downBaseDays = sumDown(bas, acIds.length);
  return {
    tasks: sorted,
    naive,
    naiveConflicts,
    availability: opt.map((v, d) => ({ day: d + 1, optimized: +v.toFixed(1), baseline: +bas[d].toFixed(1) })),
    avgOpt: opt.reduce((a, b) => a + b, 0) / HORIZON,
    avgBase: bas.reduce((a, b) => a + b, 0) / HORIZON,
    downOptDays,
    downBaseDays,
    avoidedDowntimeDays: downBaseDays - downOptDays,
    avoidedUnplannedFailures: base.unplanned - unplannedOpt,
    transfers,
  };
}
