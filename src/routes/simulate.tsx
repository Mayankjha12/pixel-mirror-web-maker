import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Area, AreaChart, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Play, Shuffle, CheckCircle2, XCircle, Activity, Zap, Users, WifiOff, Flame } from "lucide-react";
import { SCENARIOS, type ScenarioId, type ScenarioResult, runScenario } from "@/lib/engine/scenarios";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, tooltipStyle } from "@/components/app/ui-bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/simulate")({
  head: () => ({
    meta: [
      { title: "Simulation Lab — VyomDrishti AI" },
      { name: "description", content: "Run five stress-test scenarios through the real prediction and scheduling engine with a reproducible seed." },
      { property: "og:title", content: "Simulation Lab — VyomDrishti AI" },
      { property: "og:description", content: "Gradual wear, anomaly spikes, spare contention, dropped data and peak utilization." },
    ],
  }),
  component: SimLab,
});

const ICONS: Record<ScenarioId, typeof Activity> = { gradual: Activity, spike: Zap, spares: Users, missing: WifiOff, peak: Flame };
const STORE = "vyomdrishti-runs";

function SimLab() {
  const [sel, setSel] = useState<ScenarioId>("gradual");
  const [seed, setSeed] = useState(42);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [runs, setRuns] = useState<ScenarioResult[]>([]);
  const [frame, setFrame] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) setRuns(JSON.parse(raw));
    } catch {
      /* ignore corrupt storage */
    }
  }, []);

  const total = result?.lifetime?.length ?? result?.availability?.length ?? 0;
  useEffect(() => {
    if (!result) return;
    setFrame(0);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setFrame(total);
      return;
    }
    const step = Math.max(1, Math.ceil(total / 80));
    const id = setInterval(() => setFrame((f) => (f >= total ? (clearInterval(id), f) : f + step)), 30);
    return () => clearInterval(id);
  }, [result, total]);

  const run = () => {
    setBusy(true);
    setTimeout(() => {
      const r = runScenario(sel, seed);
      setResult(r);
      const next = [r, ...runs].slice(0, 25);
      setRuns(next);
      try {
        localStorage.setItem(STORE, JSON.stringify(next.map((x) => ({ ...x, lifetime: x.lifetime?.filter((_, i) => i % 2 === 0) }))));
      } catch {
        /* quota */
      }
      setBusy(false);
    }, 30);
  };
  const replay = () => {
    const pool = runs.length ? runs : SCENARIOS.map((s) => runScenario(s.id, 1 + Math.floor(Math.random() * 9999)));
    const r = pool[Math.floor(Math.random() * pool.length)];
    setSel(r.id);
    setSeed(r.seed);
    setResult({ ...r });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Simulation Lab" subtitle="Each scenario runs the same estimator and scheduler used across the app. Same seed → identical result." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {SCENARIOS.map((s, i) => {
          const Icon = ICONS[s.id];
          return (
            <button key={s.id} onClick={() => setSel(s.id)} className={cn("glass lift p-4 text-left", sel === s.id && "border-primary/60 shadow-[var(--shadow-glow)]")} aria-pressed={sel === s.id}>
              <div className="flex items-center gap-2 text-primary"><Icon className="h-4 w-4" /><span className="font-mono text-xs">0{i + 1}</span></div>
              <p className="mt-2 font-medium">{s.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{s.desc}</p>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Seed</span>
          <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} className="h-10 w-32 rounded-md border border-input bg-secondary/50 px-3 font-mono outline-none focus:ring-2 focus:ring-ring" />
        </label>
        <Button size="lg" onClick={run} disabled={busy} className="gap-2"><Play className="h-4 w-4" />{busy ? "Running…" : "Run scenario"}</Button>
        <Button size="lg" variant="outline" onClick={replay} className="gap-2"><Shuffle className="h-4 w-4" />Replay a random recorded run</Button>
        <span className="text-xs text-muted-foreground">{runs.length} recorded runs</span>
      </div>

      {!result ? (
        <Panel><p className="py-16 text-center text-sm text-muted-foreground">Pick a scenario and press Run.</p></Panel>
      ) : (
        <motion.div key={result.ranAt + result.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid gap-6 lg:grid-cols-3">
          <Panel title={`${result.title} · seed ${result.seed}`}>
            <div className="grid grid-cols-2 gap-3">
              <Big label="Failure caught" value={result.caught === null ? "n/a" : result.caught ? "Yes" : "No"} icon={result.caught === false ? XCircle : CheckCircle2} tone={result.caught === false ? "text-critical" : "text-success"} />
              <Big label="Detection lead" value={result.leadTime !== null ? `${result.leadTime.toFixed(0)} FH` : "—"} />
              <Big label="False alarms" value={`${result.falseAlarms}`} tone={result.falseAlarms ? "text-warning" : "text-success"} />
              <Big label="Availability impact" value={`${result.availabilityImpact >= 0 ? "+" : ""}${result.availabilityImpact.toFixed(1)} pp`} tone={result.availabilityImpact >= 0 ? "text-primary" : "text-critical"} />
            </div>
            <dl className="mt-4 space-y-1.5 text-sm">
              {result.metrics.map((m) => (
                <div key={m.label} className="flex justify-between gap-3 border-b border-border/50 pb-1.5"><dt className="text-muted-foreground">{m.label}</dt><dd className="text-right font-mono">{m.value}</dd></div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">{result.notes}</p>
          </Panel>

          <Panel title="Replay" className="lg:col-span-2" action={<span className="font-mono text-xs text-muted-foreground">{Math.min(frame, total)}/{total}</span>}>
            {result.lifetime ? (
              <div className="h-80">
                <ResponsiveContainer>
                  <ComposedChart data={result.lifetime.slice(0, frame)} margin={{ left: -10, right: 8 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="t" type="number" domain={[0, result.lifetime[result.lifetime.length - 1]?.t ?? 1]} unit="h" stroke="var(--muted-foreground)" fontSize={11} />
                    <YAxis yAxisId="d" domain={[0, 1.3]} stroke="var(--muted-foreground)" fontSize={11} />
                    <YAxis yAxisId="r" orientation="right" domain={[0, 400]} stroke="var(--muted-foreground)" fontSize={11} unit="h" />
                    <Tooltip {...tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <ReferenceLine yAxisId="r" y={50} stroke="var(--critical)" strokeDasharray="3 3" />
                    <Line yAxisId="d" dataKey="obs" name="Observed" stroke="var(--chart-2)" strokeWidth={0} dot={{ r: 1 }} isAnimationActive={false} />
                    <Line yAxisId="d" dataKey="trueD" name="True damage (hidden)" stroke="var(--success)" dot={false} strokeDasharray="4 3" isAnimationActive={false} />
                    <Line yAxisId="d" dataKey="smooth" name="Smoothed" stroke="var(--primary)" dot={false} strokeWidth={2} isAnimationActive={false} />
                    <Line yAxisId="r" dataKey="rulPred" name="Predicted RUL" stroke="var(--warning)" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                    <Line yAxisId="r" dataKey="rulTrue" name="True RUL" stroke="var(--muted-foreground)" dot={false} strokeDasharray="2 3" isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <>
                <div className="h-60">
                  <ResponsiveContainer>
                    <AreaChart data={result.availability!.slice(0, frame)} margin={{ left: -16, right: 8 }}>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="day" type="number" domain={[1, 30]} stroke="var(--muted-foreground)" fontSize={11} />
                      <YAxis domain={[0, 100]} unit="%" stroke="var(--muted-foreground)" fontSize={11} />
                      <Tooltip {...tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Area dataKey="optimized" name="Optimized" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.15} isAnimationActive={false} />
                      <Area dataKey="baseline" name="Time-based" stroke="var(--chart-2)" fill="none" strokeDasharray="5 4" isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                {result.allocation && (
                  <table className="mt-3 w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground"><tr><th>Aircraft</th><th>RUL</th><th>Start</th><th>Spare</th><th>Outcome</th></tr></thead>
                    <tbody>
                      {result.allocation.map((a) => (
                        <tr key={a.tail} className="border-t border-border/60">
                          <td className="py-1.5 font-mono">{a.tail}</td><td className="font-mono">{a.rulDays.toFixed(1)}d</td><td className="font-mono">{a.start !== null ? `D${a.start}` : "—"}</td><td>{a.source}</td>
                          <td className={a.note.startsWith("Repaired") ? "text-success" : "text-critical"}>{a.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </Panel>
        </motion.div>
      )}
    </div>
  );
}

function Big({ label, value, tone, icon: Icon }: { label: string; value: string; tone?: string; icon?: typeof Activity }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 flex items-center gap-1.5 font-mono text-xl font-semibold", tone)}>{Icon && <Icon className="h-4 w-4" />}{value}</p>
    </div>
  );
}
