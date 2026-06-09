import { describe, expect, it } from "vitest";
import { runMonteCarloSync, makeStrategyState, updateStrategyState, getStake, DEFAULT_CUSTOM_RULES, type SimOptions } from "./engine";

const base: SimOptions = {
  baseStake: 100, progression: "martingale", betKind: "red",
  straightNumber: 17, tableMax: 5000, wheelType: "european",
};

describe("v3 features", () => {
  it("reports target hit stats when stopProfit set", () => {
    const mc = runMonteCarloSync(300, 2000, 1000, { ...base, stopProfit: 200 }, undefined, 42);
    expect(mc.targetHitRate).not.toBeNull();
    expect(mc.targetHitRate!).toBeGreaterThan(0);
    expect(mc.avgSpinsToTarget).not.toBeNull();
    expect(mc.stopLossRate).toBeNull();
  });
  it("stop-loss freezes runs and reports rate", () => {
    const mc = runMonteCarloSync(300, 2000, 1000, { ...base, stopLoss: 300 }, undefined, 7);
    expect(mc.stopLossRate).not.toBeNull();
    expect(mc.stopLossRate!).toBeGreaterThan(0);
    // stopped-out runs keep their frozen balance >= ~700 minus overshoot; worst ending shouldn't be 0 for ALL...
  });
  it("same seed = identical results", () => {
    const a = runMonteCarloSync(100, 500, 1000, base, undefined, 123);
    const b = runMonteCarloSync(100, 500, 1000, base, undefined, 123);
    expect(a.avgEnding).toBe(b.avgEnding);
    expect(a.ruinRate).toBe(b.ruinRate);
  });
  it("custom strategy: multiply on loss behaves like martingale", () => {
    const rules = { ...DEFAULT_CUSTOM_RULES, onLossAction: "multiply" as const, onLossValue: 2, onWinAction: "reset" as const };
    let st = makeStrategyState(100);
    st = updateStrategyState(st, "custom", 100, false, -100, 100, rules);
    expect(getStake(st, "custom", 100, 100000, 100000, rules)).toBe(200);
    st = updateStrategyState(st, "custom", 100, false, -200, 200, rules);
    expect(getStake(st, "custom", 100, 100000, 100000, rules)).toBe(400);
    st = updateStrategyState(st, "custom", 100, true, 400, 400, rules);
    expect(getStake(st, "custom", 100, 100000, 100000, rules)).toBe(100);
  });
  it("custom strategy: reset after N losses + cap", () => {
    const rules = { ...DEFAULT_CUSTOM_RULES, maxUnits: 4, resetAfterLosses: 3 };
    let st = makeStrategyState(100);
    st = updateStrategyState(st, "custom", 100, false, -100, 100, rules); // 200, streak1
    st = updateStrategyState(st, "custom", 100, false, -200, 200, rules); // 400 capped, streak2
    expect(getStake(st, "custom", 100, 100000, 100000, rules)).toBe(400);
    st = updateStrategyState(st, "custom", 100, false, -400, 400, rules); // streak3 -> reset
    expect(getStake(st, "custom", 100, 100000, 100000, rules)).toBe(100);
    expect(st.lossStreak).toBe(0);
  });
  it("custom MC keeps negative realized edge near wheel edge", () => {
    const mc = runMonteCarloSync(400, 2000, 10000,
      { ...base, progression: "custom", customRules: { ...DEFAULT_CUSTOM_RULES, onLossAction: "add", onLossValue: 1, onWinAction: "reset", onWinValue: 1, maxUnits: 10, resetAfterLosses: 0 } },
      undefined, 99);
    expect(mc.realizedEdge).toBeLessThan(0);
    expect(mc.realizedEdge).toBeGreaterThan(-0.06);
  });
});
