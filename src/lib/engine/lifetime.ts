import {
  type DegradationProfile,
  CRITICAL_RUL,
  OBS_STEP,
  RUL_CAP,
  estimateRul,
  failureTime,
  observe,
  trueDegradation,
} from "./core";

export interface LifetimePoint {
  t: number;
  obs: number | null;
  smooth: number | null;
  trueD: number;
  rulPred: number;
  rulLo: number;
  rulHi: number;
  rulTrue: number;
}
export interface LifetimeRun {
  failAt: number;
  points: LifetimePoint[];
  criticalLead: number | null; // flight hours before failure when first critical alert raised
  watchLead: number | null;
  caught: boolean;
  falseAlarms: number; // alert episodes raised while true RUL > 200h
  anomalies: number;
}

/** Run the predictor online over a whole simulated component lifetime. */
export function simulateLifetime(
  p: DegradationProfile,
  key: number[],
  opts: { dropRate?: number; gap?: [number, number]; dropSeed?: () => number } = {},
): LifetimeRun {
  const failAt = failureTime(p);
  const times: number[] = [];
  const obs: (number | null)[] = [];
  const points: LifetimePoint[] = [];
  let criticalLead: number | null = null;
  let watchLead: number | null = null;
  let falseAlarms = 0;
  let inAlarm = false;
  let anomalies = 0;
  const last = Math.floor(failAt / OBS_STEP);
  for (let i = 1; i <= last; i++) {
    const t = i * OBS_STEP;
    let v: number | null = observe(p, t, key, i);
    if (opts.dropRate && opts.dropSeed && opts.dropSeed() < opts.dropRate) v = null;
    if (opts.gap && t >= opts.gap[0] && t < opts.gap[1]) v = null;
    times.push(t);
    obs.push(v);
    const wStart = Math.max(0, times.length - 30);
    const est = times.length >= 6 ? estimateRul(times.slice(wStart), obs.slice(wStart)) : null;
    const rulPred = est ? est.rul : RUL_CAP;
    const rulTrue = failAt - t;
    if (est) anomalies = Math.max(anomalies, est.anomalies);
    if (rulPred < CRITICAL_RUL && criticalLead === null) criticalLead = rulTrue;
    if (rulPred < 150 && watchLead === null) watchLead = rulTrue;
    const alarm = rulPred < 100;
    if (alarm && !inAlarm && rulTrue > 200) falseAlarms++;
    inAlarm = alarm;
    points.push({
      t,
      obs: v,
      smooth: est ? est.smoothed : v,
      trueD: trueDegradation(p, t),
      rulPred: Math.min(rulPred, 400),
      rulLo: est ? Math.min(est.lo, 400) : 400,
      rulHi: est ? Math.min(est.hi, 400) : 400,
      rulTrue,
    });
  }
  return { failAt, points, criticalLead, watchLead, caught: criticalLead !== null && criticalLead >= 5, falseAlarms, anomalies };
}
