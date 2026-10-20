// Core numerics: seeded PRNG, degradation physics, and the RUL predictor.

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashInts(...xs: number[]) {
  let h = 0x811c9dc5;
  for (const x of xs) {
    h ^= x | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

export function gauss(r: () => number) {
  const u = Math.max(r(), 1e-9);
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Deterministic gaussian noise addressed by integer keys. */
export function noiseAt(...xs: number[]) {
  return gauss(mulberry32(hashInts(...xs)));
}

export function weibull(r: () => number, shape: number, scale: number) {
  return scale * Math.pow(-Math.log(1 - Math.min(r(), 0.999999)), 1 / shape);
}

export interface DegradationProfile {
  life: number; // flight hours to reach threshold under nominal degradation
  shape: number; // exponential curvature
  sigma: number; // observation noise (health-index units)
  abruptAt?: number; // sudden fault onset (flight hours)
  spike?: { at: number; dur: number; mag: number }; // transient sensor anomaly (not real damage)
}

/** True (hidden) normalized damage. 1.0 = failure threshold. */
export function trueDegradation(p: DegradationProfile, t: number) {
  if (t <= 0) return 0;
  let d = (Math.exp((p.shape * t) / p.life) - 1) / (Math.exp(p.shape) - 1);
  if (p.abruptAt !== undefined && t >= p.abruptAt) d += 0.3 + (t - p.abruptAt) / 40;
  return d;
}

export function failureTime(p: DegradationProfile) {
  let lo = 0;
  let hi = p.life;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (trueDegradation(p, mid) >= 1) hi = mid;
    else lo = mid;
  }
  return hi;
}

export function observe(p: DegradationProfile, t: number, key: number[], idx: number) {
  let v = trueDegradation(p, t) + p.sigma * noiseAt(...key, idx);
  if (p.spike && t >= p.spike.at && t < p.spike.at + p.spike.dur) v += p.spike.mag;
  return v;
}

export const RUL_CAP = 1000;
export const OBS_STEP = 5; // flight hours between health-index samples
const C = 0.05;
const OUTLIER = 0.18;

export interface RulEstimate {
  rul: number;
  lo: number;
  hi: number;
  smoothed: number;
  slope: number;
  anomalies: number;
  smoothSeries: (number | null)[];
}

/**
 * RUL estimator:
 *  1. gap-aware exponential smoothing with innovation gating (rejects transient spikes,
 *     but accepts a level shift after 3 consecutive out-of-gate samples),
 *  2. log-linear trend fit on the recent window (exponential degradation model),
 *  3. extrapolation to the failure threshold; 95% band from slope standard error.
 */
export function estimateRul(
  times: number[],
  obs: (number | null)[],
  opts: { alpha?: number; window?: number } = {},
): RulEstimate {
  const alpha = opts.alpha ?? 0.35;
  const window = opts.window ?? 20;
  const smoothSeries: (number | null)[] = [];
  let s: number | null = null;
  let lastT = 0;
  let pending = 0;
  let anomalies = 0;
  for (let i = 0; i < times.length; i++) {
    const v = obs[i];
    if (v === null || !Number.isFinite(v)) {
      smoothSeries.push(s);
      continue;
    }
    if (s === null) s = v;
    else {
      const gap = Math.max(1, (times[i] - lastT) / OBS_STEP);
      const a = 1 - Math.pow(1 - alpha, gap);
      if (Math.abs(v - s) > OUTLIER && pending < 2) {
        pending++;
        anomalies++;
        smoothSeries.push(s);
        continue;
      }
      if (pending >= 2) s = v; // persistent shift => accept new level
      else s = s + a * (v - s);
      pending = 0;
    }
    lastT = times[i];
    smoothSeries.push(s);
  }

  const pts: [number, number][] = [];
  for (let i = smoothSeries.length - 1; i >= 0 && pts.length < window; i--) {
    const v = smoothSeries[i];
    if (v !== null && obs[i] !== null) pts.push([times[i], Math.log(Math.max(v, 0) + C)]);
  }
  const sLast = s ?? 0;
  const tNow = times[times.length - 1] ?? 0;
  if (sLast >= 1) return { rul: 0, lo: 0, hi: 0, smoothed: sLast, slope: 0, anomalies, smoothSeries };
  if (pts.length < 4) return { rul: RUL_CAP, lo: RUL_CAP, hi: RUL_CAP, smoothed: sLast, slope: 0, anomalies, smoothSeries };

  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n;
  const my = pts.reduce((a, p) => a + p[1], 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
  }
  const k = sxx > 0 ? sxy / sxx : 0;
  const b0 = my - k * mx;
  let sse = 0;
  for (const [x, y] of pts) sse += (y - (b0 + k * x)) ** 2;
  const se = sxx > 0 && n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : 0;
  const yT = Math.log(1 + C);
  const yNow = Math.max(b0 + k * tNow, Math.log(Math.max(sLast, 0) + C));
  const dist = Math.max(0, yT - yNow);
  const rulOf = (slope: number) => (slope > 1e-6 ? Math.min(RUL_CAP, dist / slope) : RUL_CAP);
  return {
    rul: rulOf(k),
    lo: rulOf(k + 1.96 * se),
    hi: rulOf(k - 1.96 * se),
    smoothed: sLast,
    slope: k,
    anomalies,
    smoothSeries,
  };
}

export type Status = "healthy" | "watch" | "critical";
export const WATCH_RUL = 150;
export const CRITICAL_RUL = 50;
export function statusFromRul(rul: number): Status {
  if (rul < CRITICAL_RUL) return "critical";
  if (rul < WATCH_RUL) return "watch";
  return "healthy";
}
