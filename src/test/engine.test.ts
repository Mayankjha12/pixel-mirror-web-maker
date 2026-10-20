import { describe, expect, it } from "vitest";
import { statusFromRul, estimateRul } from "@/lib/engine/core";
import { generateFleet, evaluateFleet } from "@/lib/engine/fleet";

describe("engine rules", () => {
  it("alerts: watch below 150h, critical below 50h", () => {
    expect(statusFromRul(149)).toBe("watch");
    expect(statusFromRul(150)).toBe("healthy");
    expect(statusFromRul(49)).toBe("critical");
  });
  it("fleet is 24 aircraft x 6 components across 3 bases, deterministic by seed", () => {
    const a = generateFleet(7), b = generateFleet(7);
    expect(a.aircraft).toHaveLength(24);
    expect(a.aircraft.every((x) => x.components.length === 6)).toBe(true);
    expect(new Set(a.aircraft.map((x) => x.base)).size).toBe(3);
    expect(evaluateFleet(a, 0)[3].rul).toBe(evaluateFleet(b, 0)[3].rul);
  });
  it("RUL extrapolates an exponential trend to the threshold", () => {
    const t = Array.from({ length: 20 }, (_, i) => i * 5);
    const obs = t.map((x) => Math.exp(0.02 * x) * 0.05 * 1.05 - 0.05);
    const r = estimateRul(t, obs);
    const expected = Math.log(1.05 / (0.05 * 1.05)) / 0.02 - 95;
    expect(Math.abs(r.rul - expected)).toBeLessThan(5);
  });
});
