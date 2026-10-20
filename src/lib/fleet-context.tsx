import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { type AircraftState, type Fleet, evaluateFleet, generateFleet } from "./engine/fleet";
import type { Status } from "./engine/core";

export interface FleetAlert {
  id: string;
  tick: number;
  tail: string;
  acId: string;
  comp: string;
  level: Status;
  rul: number;
}

interface Ctx {
  seed: number;
  setSeed: (s: number) => void;
  fleet: Fleet;
  states: AircraftState[];
  simDays: number;
  tick: number;
  paused: boolean;
  setPaused: (p: boolean) => void;
  alerts: FleetAlert[];
}
const FleetCtx = createContext<Ctx | null>(null);
export const DAYS_PER_TICK = 0.1;

export function FleetProvider({ children }: { children: ReactNode }) {
  const [seed, setSeedRaw] = useState(2026);
  const [tick, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const fleet = useMemo(() => generateFleet(seed), [seed]);
  const simDays = tick * DAYS_PER_TICK;
  const states = useMemo(() => evaluateFleet(fleet, simDays), [fleet, simDays]);
  const [alerts, setAlerts] = useState<FleetAlert[]>(() => initialAlerts(states));
  const prev = useRef<Map<string, Status>>(new Map());

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [paused]);

  useEffect(() => {
    const m = prev.current;
    const fresh: FleetAlert[] = [];
    for (const s of states)
      for (const c of s.comps) {
        const k = `${s.ac.id}-${c.key}`;
        const before = m.get(k);
        if (before !== undefined && before !== c.status && c.status !== "healthy") {
          fresh.push({ id: `${k}-${tick}`, tick, tail: s.ac.tail, acId: s.ac.id, comp: c.name, level: c.status, rul: c.rul });
        }
        m.set(k, c.status);
      }
    if (fresh.length) setAlerts((a) => [...fresh, ...a].slice(0, 40));
  }, [states, tick]);

  const setSeed = (s: number) => {
    prev.current = new Map();
    setSeedRaw(s);
    setTick(0);
    setAlerts(initialAlerts(evaluateFleet(generateFleet(s), 0)));
  };

  return (
    <FleetCtx.Provider value={{ seed, setSeed, fleet, states, simDays, tick, paused, setPaused, alerts }}>
      {children}
    </FleetCtx.Provider>
  );
}

function initialAlerts(states: AircraftState[]): FleetAlert[] {
  return states
    .flatMap((s) =>
      s.comps
        .filter((c) => c.status !== "healthy")
        .map((c) => ({ id: `${s.ac.id}-${c.key}-init`, tick: 0, tail: s.ac.tail, acId: s.ac.id, comp: c.name, level: c.status, rul: c.rul })),
    )
    .sort((a, b) => a.rul - b.rul);
}

export function useFleet() {
  const c = useContext(FleetCtx);
  if (!c) throw new Error("useFleet outside FleetProvider");
  return c;
}
