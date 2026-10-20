# VyomDrishti AI

AI predictive-maintenance and fleet-availability platform for an air fleet.
Smart India Hackathon 2026 · Problem Statement **SIH26249 — Air Power: Predictive Maintenance & Fleet Availability** (Ministry of Defence).
Team **Server Down** · Team ID **NSUT053**.

> **Disclaimer:** all telemetry, fleet, spares and agency data is **simulated** by a seeded PRNG, inspired by NASA C-MAPSS turbofan degradation patterns. No real military data, insignia or logos are used.

## Pages
Dashboard · Aircraft (digital twin + live telemetry) · Planner · Logistics · Simulation Lab · Model (backtest) · Architecture.

## Architecture
Data Ingestion → Data Fusion → Fault Prediction → Digital Twin → Maintenance Planning → Feedback Loop. Everything runs client-side in `src/lib/engine`:

| Module | Role |
|---|---|
| `core.ts` | mulberry32 PRNG, hash-addressed noise, degradation model, RUL estimator |
| `fleet.ts` | 24 aircraft × 6 components across 3 bases, spares, agencies, sensor mapping |
| `scheduler.ts` | greedy constrained optimizer + time-based baseline + availability forecast |
| `lifetime.ts` | online run of the estimator over a full component life |
| `backtest.ts` | N=200 lifetime backtest and metrics |
| `scenarios.ts` | the five Simulation Lab scenarios |

## How the engine works
- Hidden damage `d(t) = (e^(b·t/L) − 1)/(e^b − 1)`, Weibull life `L`, Gaussian noise; failure at `d = 1`.
- Health = `100·(1 − smoothed d)`; aircraft health = `0.6·min + 0.4·weighted mean`.
- RUL: gap-aware exponential smoothing with an outlier gate → least-squares fit of `ln(d+0.05)` over the last 20 samples → extrapolate to threshold; 95% band from slope standard error. Watch < 150h, Critical < 50h.
- Scheduler: priority = urgency × availability impact; spares sourced base → other base → depot → reorder; earliest slot that respects hangar slots (2/base) and agency capacity. Outcomes are evaluated against the simulator's *true* failure times.

## How metrics are computed
The Model page simulates 200 lifetimes (8% with abrupt faults), runs the estimator every 5 FH and computes RMSE (true RUL ≤ 250h), critical-alert lead time, precision/recall of "fails within 100h", false-alarm rate (true RUL > 200h) and downtime vs a 0.6×mean-life replacement policy. Nothing is hardcoded.

## Limitations
Simulated data, single failure mode per component, not validated on real fleet data. Planned: validate on NASA C-MAPSS and real MRO logs.
