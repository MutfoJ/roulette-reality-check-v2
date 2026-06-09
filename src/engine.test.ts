import { describe, it, expect, beforeEach } from "vitest";
import {
  REDS,
  ZERO_DOUBLE,
  WHEEL_ORDER_EU,
  WHEEL_ORDER_US,
  getWheelSize,
  getWheelOrder,
  houseEdge,
  getNumberColor,
  getPayout,
  isWinningBet,
  evalBet,
  coverageOf,
  expectedEdgeOf,
  makeStrategyState,
  getStake,
  updateStrategyState,
  spinOnce,
  spinNumber,
  reseed,
  runMonteCarloSync,
  type SimOptions,
} from "./engine";

const baseOpts: SimOptions = {
  baseStake: 10,
  progression: "flat",
  betKind: "red",
  straightNumber: 17,
  tableMax: 1_000_000,
  manualBets: [],
  wheelType: "european",
};

describe("wheel constants", () => {
  it("EU wheel has 37 unique pockets 0-36", () => {
    expect(WHEEL_ORDER_EU.length).toBe(37);
    expect(new Set(WHEEL_ORDER_EU).size).toBe(37);
    for (const n of WHEEL_ORDER_EU) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(36);
    }
  });
  it("US wheel has 38 unique pockets including 00 (sentinel 37)", () => {
    expect(WHEEL_ORDER_US.length).toBe(38);
    expect(new Set(WHEEL_ORDER_US).size).toBe(38);
    expect(WHEEL_ORDER_US.includes(ZERO_DOUBLE)).toBe(true);
  });
  it("getWheelSize / getWheelOrder agree", () => {
    expect(getWheelSize("european")).toBe(37);
    expect(getWheelSize("american")).toBe(38);
    expect(getWheelOrder("european").length).toBe(37);
    expect(getWheelOrder("american").length).toBe(38);
  });
  it("house edge matches the textbook values", () => {
    expect(houseEdge("european")).toBeCloseTo(-1 / 37, 10);
    expect(houseEdge("american")).toBeCloseTo(-2 / 38, 10);
  });
});

describe("color + payout", () => {
  it("zeros are green; reds match the canonical set", () => {
    expect(getNumberColor(0)).toBe("green");
    expect(getNumberColor(ZERO_DOUBLE)).toBe("green");
    for (const r of REDS) expect(getNumberColor(r)).toBe("red");
    expect(getNumberColor(2)).toBe("black");
    expect(getNumberColor(31)).toBe("black");
  });
  it("payout table matches casino reality", () => {
    expect(getPayout("red")).toBe(1);
    expect(getPayout("dozen1")).toBe(2);
    expect(getPayout("column2")).toBe(2);
    expect(getPayout("straight")).toBe(35);
    expect(getPayout("manual")).toBe(0);
  });
});

describe("isWinningBet", () => {
  it("evens lose to zero on European wheel", () => {
    expect(isWinningBet(0, "red", 0)).toBe(false);
    expect(isWinningBet(0, "even", 0)).toBe(false);
    expect(isWinningBet(0, "low", 0)).toBe(false);
  });
  it("evens lose to 00 on American wheel", () => {
    expect(isWinningBet(ZERO_DOUBLE, "black", 0)).toBe(false);
    expect(isWinningBet(ZERO_DOUBLE, "high", 0)).toBe(false);
  });
  it("straight on the exact zero pocket is a win", () => {
    expect(isWinningBet(0, "straight", 0)).toBe(true);
    expect(isWinningBet(ZERO_DOUBLE, "straight", ZERO_DOUBLE)).toBe(true);
    expect(isWinningBet(0, "straight", 17)).toBe(false);
  });
  it("dozen / column boundaries", () => {
    expect(isWinningBet(12, "dozen1", 0)).toBe(true);
    expect(isWinningBet(13, "dozen1", 0)).toBe(false);
    expect(isWinningBet(34, "column1", 0)).toBe(true); // 34 % 3 === 1
    expect(isWinningBet(36, "column3", 0)).toBe(true);
  });
});

describe("evalBet profit signs", () => {
  it("loss returns -amount", () => {
    expect(evalBet({ kind: "red", amount: 10 }, 2).profit).toBe(-10);
  });
  it("even-money win pays 1:1", () => {
    expect(evalBet({ kind: "red", amount: 10 }, 1).profit).toBe(10);
  });
  it("straight win pays 35:1", () => {
    expect(evalBet({ kind: "straight", amount: 1, number: 17 }, 17).profit).toBe(35);
  });
});

describe("coverage + expected edge", () => {
  it("red covers 18/37 on EU and 18/38 on US", () => {
    expect(coverageOf("red", "european")).toBeCloseTo(18 / 37, 10);
    expect(coverageOf("red", "american")).toBeCloseTo(18 / 38, 10);
  });
  it("expected edge equals the wheel edge for any standard bet (not manual)", () => {
    for (const k of ["red", "even", "dozen1", "column2", "straight"] as const) {
      expect(expectedEdgeOf(k, "european")).toBeCloseTo(-1 / 37, 10);
      expect(expectedEdgeOf(k, "american")).toBeCloseTo(-2 / 38, 10);
    }
  });
});

describe("progression state machines", () => {
  it("Martingale: doubles on loss, resets to base on win", () => {
    let s = makeStrategyState(10);
    s = updateStrategyState(s, "martingale", 10, false, -10, 10);
    expect(s.stake).toBe(20);
    s = updateStrategyState(s, "martingale", 10, false, -20, 20);
    expect(s.stake).toBe(40);
    s = updateStrategyState(s, "martingale", 10, true, 40, 40);
    expect(s.stake).toBe(10);
  });
  it("Reverse Martingale: doubles on win, resets on loss", () => {
    let s = makeStrategyState(10);
    s = updateStrategyState(s, "reverse-martingale", 10, true, 10, 10);
    expect(s.stake).toBe(20);
    s = updateStrategyState(s, "reverse-martingale", 10, false, -20, 20);
    expect(s.stake).toBe(10);
  });
  it("D'Alembert: +1 unit on loss, -1 on win, never below base", () => {
    let s = makeStrategyState(10);
    s = updateStrategyState(s, "dalembert", 10, false, -10, 10);
    expect(s.stake).toBe(20);
    s = updateStrategyState(s, "dalembert", 10, true, 20, 20);
    expect(s.stake).toBe(10);
    s = updateStrategyState(s, "dalembert", 10, true, 10, 10);
    expect(s.stake).toBe(10); // floor at base
  });
  it("Fibonacci: +1 step on loss, -2 steps (clamped) on win", () => {
    let s = makeStrategyState(10);
    expect(s.fibIndex).toBe(0);
    s = updateStrategyState(s, "fibonacci", 10, false, -10, 10);
    expect(s.fibIndex).toBe(1);
    s = updateStrategyState(s, "fibonacci", 10, false, -10, 10);
    expect(s.fibIndex).toBe(2);
    s = updateStrategyState(s, "fibonacci", 10, true, 10, 10);
    expect(s.fibIndex).toBe(0);
  });
  it("Labouchère: cap at 16 entries, restart line when cleared", () => {
    let s = makeStrategyState(10);
    expect(s.labouchere).toEqual([1, 2, 3, 4]);
    // 4 wins should clear the line and reset to [1,2,3,4]
    s = updateStrategyState(s, "labouchere", 10, true, 10, 10);
    s = updateStrategyState(s, "labouchere", 10, true, 10, 10);
    expect(s.labouchere).toEqual([1, 2, 3, 4]);
    // many losses should never exceed 16 entries
    for (let i = 0; i < 50; i++) s = updateStrategyState(s, "labouchere", 10, false, -10, 10);
    expect(s.labouchere.length).toBeLessThanOrEqual(16);
  });
});

describe("getStake clamping", () => {
  it("clamps to balance and table max", () => {
    const s = makeStrategyState(100);
    expect(getStake(s, "flat", 100, 50, 1000)).toBe(50);
    expect(getStake(s, "flat", 100, 1000, 30)).toBe(30);
  });
  it("returns 0 when broke", () => {
    const s = makeStrategyState(100);
    expect(getStake(s, "flat", 100, 0, 1000)).toBe(0);
  });
});

describe("spinOnce determinism via reseed", () => {
  beforeEach(() => reseed(42));
  it("same seed produces same outcomes", () => {
    reseed(123);
    const a = spinNumber("european");
    const b = spinNumber("european");
    reseed(123);
    expect(spinNumber("european")).toBe(a);
    expect(spinNumber("european")).toBe(b);
  });
  it("balance updates by stake on a loss", () => {
    reseed(1);
    const opts: SimOptions = { ...baseOpts, betKind: "straight", straightNumber: 17 };
    const start = 100;
    let bal = start;
    let st = makeStrategyState(opts.baseStake);
    for (let i = 0; i < 5; i++) {
      const next = spinOnce(bal, st, opts);
      if (!next.result) break;
      st = next.state;
      bal = next.balance;
      // profit must be either -10 (loss) or +350 (win on straight)
      expect([-10, 350]).toContain(next.result.profit);
    }
  });
});

describe("runMonteCarloSync — convergence + invariants", () => {
  it("flat-bet realized edge converges within ~1% for European", () => {
    reseed(7);
    const summary = runMonteCarloSync(50, 4000, 10_000, baseOpts);
    expect(summary.runs).toBe(50);
    expect(summary.iterations).toBe(4000);
    // Tolerance is loose because variance is high; main point is sign + ballpark.
    expect(summary.realizedEdge).toBeLessThan(0);
    expect(Math.abs(summary.realizedEdge - houseEdge("european"))).toBeLessThan(0.01);
  });
  it("survival monotonically decreases", () => {
    reseed(1);
    const summary = runMonteCarloSync(80, 1500, 1000, baseOpts);
    const a = summary.survival.alive;
    for (let i = 1; i < a.length; i++) {
      expect(a[i]).toBeLessThanOrEqual(a[i - 1] + 1e-9);
    }
  });
  it("fan percentiles are ordered low → high at every checkpoint", () => {
    reseed(2);
    const summary = runMonteCarloSync(100, 1000, 1000, baseOpts);
    const { p1, p10, p25, p50, p75, p90, p99 } = summary.fan;
    for (let i = 0; i < p50.length; i++) {
      expect(p1[i]).toBeLessThanOrEqual(p10[i]);
      expect(p10[i]).toBeLessThanOrEqual(p25[i]);
      expect(p25[i]).toBeLessThanOrEqual(p50[i]);
      expect(p50[i]).toBeLessThanOrEqual(p75[i]);
      expect(p75[i]).toBeLessThanOrEqual(p90[i]);
      expect(p90[i]).toBeLessThanOrEqual(p99[i]);
    }
  });
});
