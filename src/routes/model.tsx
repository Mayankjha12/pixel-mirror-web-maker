import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { FlaskConical, Play, AlertOctagon, BookOpen } from "lucide-react";
import { type BacktestMetrics, runBacktest } from "@/lib/engine/backtest";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { CountUp, PageHeader, Panel, tooltipStyle } from "@/components/app/ui-bits";

export const Route = createFileRoute("/model")({
  head: () => ({
    meta: [
      { title: "Model & Backtest — VyomDrishti AI" },
      { name: "description", content: "In-browser backtest over 200 simulated component lifetimes: RUL RMSE, lead time, precision/recall, false alarms and downtime reduction." },
      { property: "og:title", content: "Model & Backtest — VyomDrishti AI" },
      { property: "og:description", content: "Metrics computed live, not hardcoded — with an honest limitations panel." },
    ],
  }),
  component: ModelPage,
});

function ModelPage() {
  const [seed, setSeed] = useState(2026);
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [m, setM] = useState<BacktestMetrics | null>(null);

  const go = async () => {
    setRunning(true);
    setProgress(0);
    const res = await runBacktest(seed, 200, setProgress);
    setM(res);
    setRunning(false);
  };
  useEffect(() => {
    void go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader title="Model & Backtest" subtitle="Runs the RUL estimator online over N = 200 simulated lifetimes (6 component types, 8% with abrupt faults) and scores it against hidden ground truth.">
        <div className="flex items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Seed</span>
            <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} className="h-10 w-28 rounded-md border border-input bg-secondary/50 px-3 font-mono outline-none focus:ring-2 focus:ring-ring" />
          </label>
          <Button size="lg" onClick={go} disabled={running} className="gap-2"><Play className="h-4 w-4" />{running ? "Running…" : "Run backtest"}</Button>
        </div>
      </PageHeader>

      {running && (
        <Panel>
          <div className="flex items-center justify-between text-sm"><span>Simulating lifetimes…</span><span className="font-mono">{Math.round(progress * 200)}/200</span></div>
          <Progress value={progress * 100} className="mt-2" />
        </Panel>
      )}

      {!m ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <M label="RUL RMSE (true RUL ≤ 250h)" v={m.rmse} d={1} s="h" />
            <M label="Mean critical lead time" v={m.meanLead} d={1} s="h" />
            <M label="Precision · RUL<100h alert" v={m.precision * 100} d={1} s="%" />
            <M label="Recall · RUL<100h alert" v={m.recall * 100} d={1} s="%" />
            <M label="False-alarm rate (true RUL>200h)" v={m.falseAlarmRate * 100} d={2} s="%" />
            <M label="Downtime reduction vs time-based" v={m.downtimeReduction * 100} d={1} s="%" />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Panel title="Detection lead-time distribution">
              <div className="h-60">
                <ResponsiveContainer>
                  <BarChart data={m.leadHistogram} margin={{ left: -20, right: 4 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="bin" stroke="var(--muted-foreground)" fontSize={10} />
                    <YAxis allowDecimals={false} stroke="var(--muted-foreground)" fontSize={11} />
                    <Tooltip {...tooltipStyle} cursor={{ fill: "var(--secondary)" }} />
                    <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-muted-foreground">Lead = flight hours between first critical alert (pred. RUL &lt; 50h) and true failure. Median {m.medianLead.toFixed(0)}h. The tight cluster just under 50h reflects that the critical threshold itself is 50h.</p>
            </Panel>
            <Panel title="Predicted vs true RUL">
              <div className="h-60">
                <ResponsiveContainer>
                  <ScatterChart margin={{ left: -14, right: 8 }}>
                    <CartesianGrid stroke="var(--border)" />
                    <XAxis dataKey="trueRul" type="number" name="True" unit="h" domain={[0, 250]} stroke="var(--muted-foreground)" fontSize={11} />
                    <YAxis dataKey="predRul" type="number" name="Pred" unit="h" domain={[0, 300]} stroke="var(--muted-foreground)" fontSize={11} />
                    <Tooltip {...tooltipStyle} />
                    <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 250, y: 250 }]} stroke="var(--warning)" strokeDasharray="4 4" />
                    <Scatter data={m.scatter} fill="var(--primary)" fillOpacity={0.45} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-muted-foreground">Dashed line = perfect prediction. Predictions are capped at 300h.</p>
            </Panel>
            <Panel title="Predictive vs time-based">
              <div className="h-60">
                <ResponsiveContainer>
                  <BarChart data={[
                    { k: "Downtime / event (d)", Predictive: +m.downtimePred.toFixed(2), "Time-based": +m.downtimeBase.toFixed(2) },
                    { k: "Useful life used (×10)", Predictive: +(m.lifeUsedPred * 10).toFixed(2), "Time-based": +(m.lifeUsedBase * 10).toFixed(2) },
                  ]} margin={{ left: -20, right: 4 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="k" stroke="var(--muted-foreground)" fontSize={10} />
                    <YAxis stroke="var(--muted-foreground)" fontSize={11} />
                    <Tooltip {...tooltipStyle} cursor={{ fill: "var(--secondary)" }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Predictive" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Time-based" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-muted-foreground">Caught {(m.caughtRate * 100).toFixed(1)}% of failures with ≥5h lead. Abrupt faults caught: {m.abruptCaught}/{m.abruptCount}.</p>
            </Panel>
          </div>

          <Panel title="Per component type">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
              {m.perType.map((p) => (
                <div key={p.name} className="rounded-lg border border-border p-3 text-sm">
                  <p className="text-xs text-muted-foreground">{p.name}</p>
                  <p className="font-mono">RMSE {p.rmse.toFixed(1)}h</p>
                  <p className="font-mono text-xs text-muted-foreground">caught {p.caught}/{p.n}</p>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={<span className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-primary" />Methodology</span>}>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li><b className="text-foreground">Simulator.</b> Each component's hidden damage follows d(t) = (e^(b·t/L) − 1)/(e^b − 1), with Weibull-distributed life L, curvature b and Gaussian observation noise — the qualitative shape of C-MAPSS turbofan health indices.</li>
            <li><b className="text-foreground">Smoothing.</b> Gap-aware exponential smoothing (α = 0.35) with an innovation gate: samples deviating &gt;0.18 are rejected unless they persist for 3 samples.</li>
            <li><b className="text-foreground">Trend fit.</b> Least-squares fit of ln(d + 0.05) over the last 20 samples, extrapolated to the threshold d = 1. The 95% band uses the slope's standard error.</li>
            <li><b className="text-foreground">Alerts.</b> Watch when RUL &lt; 150h, Critical when RUL &lt; 50h.</li>
            <li><b className="text-foreground">Scoring.</b> Every 5 FH the estimator runs online on data seen so far. RMSE over points with true RUL ≤ 250h; precision/recall on the binary "fails within 100h"; false-alarm rate on points with true RUL &gt; 200h.</li>
            <li><b className="text-foreground">Downtime.</b> Predictive = planned repair if warned ≥ 24 FH ahead, else unplanned. Baseline = replacement at 0.6 × mean life, unplanned if the part fails first.</li>
          </ol>
        </Panel>
        <Panel title={<span className="flex items-center gap-2"><AlertOctagon className="h-4 w-4 text-warning" />Limitations</span>} className="border-warning/30">
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>All data is <b className="text-foreground">simulated</b>. The model is scored against the same family of curves it assumes — real performance will be lower.</li>
            <li>Single failure mode per component; no interactions between components, no maintenance-induced faults.</li>
            <li>Abrupt faults are mostly missed by design — a trend model can't predict a sudden event; it can only react.</li>
            <li><b className="text-foreground">Not validated on real fleet data.</b> Planned: validate on NASA C-MAPSS FD001–FD004 and anonymised real MRO logs; add learned models (LSTM / gradient boosting) behind the same interface.</li>
            <li>Downtime figures use simplified repair/unplanned durations per component type.</li>
          </ul>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-warning"><FlaskConical className="h-3 w-3" />Numbers above are recomputed every run — change the seed to see variance.</p>
        </Panel>
      </div>
    </div>
  );
}

function M({ label, v, d, s }: { label: string; v: number; d: number; s: string }) {
  return (
    <div className="glass lift p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <CountUp value={v} decimals={d} suffix={s} className="mt-1 block text-2xl font-semibold text-primary" />
    </div>
  );
}
