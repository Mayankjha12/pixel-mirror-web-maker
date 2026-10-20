import { type DegradationProfile, hashInts, mulberry32, weibull } from "./core";
import { COMPONENT_SPECS } from "./fleet";
import { simulateLifetime } from "./lifetime";

export interface BacktestMetrics {
  n: number;
  rmse: number;
  mae: number;
  meanLead: number;
  medianLead: number;
  leadHistogram: { bin: string; count: number }[];
  precision: number;
  recall: number;
  f1: number;
  falseAlarmRate: number;
  caughtRate: number;
  abruptCount: number;
  abruptCaught: number;
  downtimePred: number;
  downtimeBase: number;
  downtimeReduction: number;
  lifeUsedPred: number;
  lifeUsedBase: number;
  scatter: { trueRul: number; predRul: number }[];
  perType: { name: string; rmse: number; caught: number; n: number }[];
}

const UTIL = 3; // flight hours per day for downtime accounting

export async function runBacktest(seed: number, n = 200, onProgress?: (p: number) => void): Promise<BacktestMetrics> {
  let se = 0, ae = 0, cnt = 0;
  let tp = 0, fp = 0, fn = 0, healthyPts = 0, healthyAlarms = 0;
  const leads: number[] = [];
  let caught = 0, abruptCount = 0, abruptCaught = 0;
  let downPred = 0, downBase = 0, lifePred = 0, lifeBase = 0;
  const scatter: BacktestMetrics["scatter"] = [];
  const perType = COMPONENT_SPECS.map((s) => ({ name: s.name, se: 0, cnt: 0, caught: 0, n: 0 }));

  for (let i = 0; i < n; i++) {
    const r = mulberry32(hashInts(seed, 991, i));
    const ti = Math.floor(r() * COMPONENT_SPECS.length);
    const spec = COMPONENT_SPECS[ti];
    const life = Math.max(200, weibull(r, 3.2, spec.meanLife));
    const abrupt = r() < 0.08;
    const p: DegradationProfile = {
      life,
      shape: 2.5 + 2.5 * r(),
      sigma: 0.012 + 0.025 * r(),
      abruptAt: abrupt ? life * (0.55 + 0.3 * r()) : undefined,
    };
    const run = simulateLifetime(p, [seed, 5000 + i]);
    for (const pt of run.points) {
      if (pt.rulTrue <= 250) {
        const pred = Math.min(pt.rulPred, 300);
        se += (pred - pt.rulTrue) ** 2;
        ae += Math.abs(pred - pt.rulTrue);
        cnt++;
        perType[ti].se += (pred - pt.rulTrue) ** 2;
        perType[ti].cnt++;
        if (scatter.length < 600 && (i + pt.t) % 3 === 0) scatter.push({ trueRul: +pt.rulTrue.toFixed(1), predRul: +pred.toFixed(1) });
      }
      const alarm = pt.rulPred < 100;
      const pos = pt.rulTrue < 100;
      if (alarm && pos) tp++;
      else if (alarm && !pos) fp++;
      else if (!alarm && pos) fn++;
      if (pt.rulTrue > 200) {
        healthyPts++;
        if (alarm) healthyAlarms++;
      }
    }
    perType[ti].n++;
    if (abrupt) abruptCount++;
    if (run.caught) {
      caught++;
      perType[ti].caught++;
      if (abrupt) abruptCaught++;
    }
    if (run.criticalLead !== null) leads.push(run.criticalLead);
    const actualFail = run.failAt;
    // Predictive: planned repair if warned >= 24 FH ahead, else unplanned
    const warned = run.watchLead !== null && run.watchLead >= 24;
    downPred += warned ? spec.repairDays : spec.unplannedDays;
    lifePred += warned ? Math.max(0, actualFail - Math.min(run.watchLead!, 60)) / actualFail : 1;
    // Time-based: replace at fixed interval 0.6 × mean life
    const interval = 0.6 * spec.meanLife;
    if (actualFail < interval) {
      downBase += spec.unplannedDays;
      lifeBase += 1;
    } else {
      downBase += spec.repairDays;
      lifeBase += interval / actualFail;
    }
    if (i % 10 === 9) {
      onProgress?.((i + 1) / n);
      await new Promise((res) => setTimeout(res, 0));
    }
  }
  leads.sort((a, b) => a - b);
  const bins = [0, 25, 50, 75, 100, 150, 200, 300];
  const leadHistogram = bins.slice(0, -1).map((b, k) => ({
    bin: `${b}–${bins[k + 1]}h`,
    count: leads.filter((l) => l >= b && l < bins[k + 1]).length,
  }));
  leadHistogram.push({ bin: "300h+", count: leads.filter((l) => l >= 300).length });
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  return {
    n,
    rmse: Math.sqrt(se / Math.max(1, cnt)),
    mae: ae / Math.max(1, cnt),
    meanLead: leads.reduce((a, b) => a + b, 0) / Math.max(1, leads.length),
    medianLead: leads[Math.floor(leads.length / 2)] ?? 0,
    leadHistogram,
    precision,
    recall,
    f1: (2 * precision * recall) / Math.max(1e-9, precision + recall),
    falseAlarmRate: healthyAlarms / Math.max(1, healthyPts),
    caughtRate: caught / n,
    abruptCount,
    abruptCaught,
    downtimePred: downPred / n,
    downtimeBase: downBase / n,
    downtimeReduction: 1 - downPred / Math.max(1e-9, downBase),
    lifeUsedPred: lifePred / n,
    lifeUsedBase: lifeBase / n,
    scatter,
    perType: perType.map((p) => ({ name: p.name, rmse: Math.sqrt(p.se / Math.max(1, p.cnt)), caught: p.caught, n: p.n })),
  };
}
export const BACKTEST_UTIL = UTIL;
