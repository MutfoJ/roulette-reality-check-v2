// ============================================================
//  Roulette engine — European (single 0) and American (0 + 00)
// ============================================================
//  Internally, 00 is represented as the integer 37. Every public
//  function takes/returns numbers with that convention.
// ============================================================

export type WheelType = "european" | "american";

// European clockwise wheel (37 pockets)
export const WHEEL_ORDER_EU = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
] as const;

// American clockwise wheel (38 pockets) — 37 is 00
export const WHEEL_ORDER_US = [
  0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1,
  37, 27, 10, 25, 29, 12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2,
] as const;

// 37 = "00" sentinel; treated as green
export const ZERO_DOUBLE = 37;
export function isZero(n: number): boolean { return n === 0 || n === ZERO_DOUBLE; }
export function pocketLabel(n: number): string { return n === ZERO_DOUBLE ? "00" : String(n); }

export function getWheelOrder(t: WheelType) { return t === "american" ? WHEEL_ORDER_US : WHEEL_ORDER_EU; }
export function getWheelSize(t: WheelType): number { return t === "american" ? 38 : 37; }
export function getPocketAngle(t: WheelType): number { return 360 / getWheelSize(t); }
export function houseEdge(t: WheelType): number { return t === "american" ? -2 / 38 : -1 / 37; }

// Backwards-compat aliases (still used by some legacy bits)
export const WHEEL_ORDER = WHEEL_ORDER_EU;
export const POCKET_ANGLE = 360 / WHEEL_ORDER_EU.length;

export const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const SPEEDS = [1, 2, 4, 8, 20, 50, 100, 1000, 10000] as const;

export type BetKind =
  | "red" | "black" | "even" | "odd" | "low" | "high"
  | "dozen1" | "dozen2" | "dozen3"
  | "column1" | "column2" | "column3"
  | "straight" | "manual";

export type Progression =
  | "flat" | "martingale" | "reverse-martingale" | "dalembert"
  | "fibonacci" | "oscars" | "labouchere" | "custom";

export type ChartMode = "money" | "percent" | "profit" | "drawdown" | "stake";

export interface Bet { kind: BetKind; amount: number; number?: number; }

// ---------- custom strategy builder ----------
export type CustomAction = "multiply" | "add" | "reset" | "keep";
export interface CustomRules {
  onLossAction: CustomAction;
  onLossValue: number;
  onWinAction: CustomAction;
  onWinValue: number;
  /** Cap stake at base × maxUnits. 0 = uncapped (table max still applies). */
  maxUnits: number;
  /** Reset stake to base after N consecutive losses. 0 = never. */
  resetAfterLosses: number;
}
export const DEFAULT_CUSTOM_RULES: CustomRules = {
  onLossAction: "multiply", onLossValue: 2,
  onWinAction: "reset", onWinValue: 1,
  maxUnits: 0, resetAfterLosses: 0,
};

/** Why a session stopped early. */
export type StopReason = "target" | "stoploss" | "ruin" | null;

export interface SimOptions {
  baseStake: number;
  progression: Progression;
  betKind: BetKind;
  straightNumber: number;
  tableMax: number;
  manualBets?: Bet[];
  wheelType: WheelType;
  /** Rules used when progression === "custom". */
  customRules?: CustomRules;
  /** Stop session once profit reaches this many $ above start. 0/undefined = off. */
  stopProfit?: number;
  /** Stop session once losses reach this many $ below start. 0/undefined = off. */
  stopLoss?: number;
}

export interface StrategyState {
  stake: number;
  fibIndex: number;
  oscarsProfit: number;
  labouchere: number[];
  /** Consecutive losses so far (used by the custom strategy builder). */
  lossStreak: number;
}

export interface SpinResult {
  number: number;
  won: boolean;
  stake: number;
  profit: number;
  payout: number;
  balance: number;
  bets: Bet[];
}

export interface Summary {
  spins: number;
  profit: number;
  roi: number;
  endingBalance: number;
  lowestBalance: number;
  maxBalance: number;
  maxDrawdown: number;
  hitRate: number;
  longestLossStreak: number;
  longestWinStreak: number;
  avgChangePerSpin: number;
  avgStake: number;
  totalStaked: number;
  bustSpin: number | null;
  stdDev: number;
}

export interface MonteCarloSummary {
  runs: number;
  iterations: number;
  ruinRate: number;
  avgRuinSpin: number | null;
  medianRuinSpin: number | null;
  medianEnding: number;
  avgEnding: number;
  worstEnding: number;
  bestEnding: number;
  profitableRate: number;
  /** Average $ change per played spin */
  avgChangePerSpin: number;
  /** Player return per dollar staked, across all runs */
  realizedEdge: number;
  ruinHistogram: { labels: number[]; counts: number[] };
  /** Final bankroll distribution across ALL runs (busted + survived) */
  finalHistogram: { labels: number[]; counts: number[] };
  /** Survival curve: fraction of runs still solvent at each spin index. Sub-sampled to ~200 points. */
  survival: { spins: number[]; alive: number[] };
  /** Bankroll percentile bands + mean at each checkpoint. */
  fan: { spins: number[]; p1: number[]; p10: number[]; p25: number[]; p50: number[]; p75: number[]; p90: number[]; p99: number[]; mean: number[] };
  /** Starting bankroll the run used (for chart reference lines) */
  startingBalance: number;
  /** % of runs that hit the take-profit target (null when no target set). */
  targetHitRate: number | null;
  /** Average / median spins needed to reach the target (null when none hit). */
  avgSpinsToTarget: number | null;
  medianSpinsToTarget: number | null;
  /** % of runs stopped out by the stop-loss (null when no stop-loss set). */
  stopLossRate: number | null;
}

// payout is fixed (defines the bet); coverage is computed at runtime from wheelType.
export const BET_OPTIONS: { value: BetKind; label: string; payout: number; hits: number; help: string }[] = [
  { value: "red",    label: "Red",      payout: 1, hits: 18, help: "1:1. Wins on any red number; loses on black or any zero." },
  { value: "black",  label: "Black",    payout: 1, hits: 18, help: "1:1. Wins on any black number; loses on red or any zero." },
  { value: "even",   label: "Even",     payout: 1, hits: 18, help: "1:1. Wins on 2,4,6...36. Zero (and 00) lose." },
  { value: "odd",    label: "Odd",      payout: 1, hits: 18, help: "1:1. Wins on 1,3,5...35." },
  { value: "low",    label: "1-18",     payout: 1, hits: 18, help: "1:1. Wins on numbers 1 through 18." },
  { value: "high",   label: "19-36",    payout: 1, hits: 18, help: "1:1. Wins on numbers 19 through 36." },
  { value: "dozen1", label: "1st dozen (1-12)",  payout: 2, hits: 12, help: "2:1. Wins on 1-12." },
  { value: "dozen2", label: "2nd dozen (13-24)", payout: 2, hits: 12, help: "2:1. Wins on 13-24." },
  { value: "dozen3", label: "3rd dozen (25-36)", payout: 2, hits: 12, help: "2:1. Wins on 25-36." },
  { value: "column1",label: "Column 1", payout: 2, hits: 12, help: "2:1. Wins on 1,4,7...34 (left column)." },
  { value: "column2",label: "Column 2", payout: 2, hits: 12, help: "2:1. Wins on 2,5,8...35 (middle column)." },
  { value: "column3",label: "Column 3", payout: 2, hits: 12, help: "2:1. Wins on 3,6,9...36 (right column)." },
  { value: "straight",label: "Straight number", payout: 35, hits: 1, help: "35:1. Pick a single pocket. Highest payout, lowest hit rate." },
  { value: "manual",  label: "Manual layout",   payout: 0, hits: 0, help: "Place chips on the casino table to define a custom bet layout. The chosen progression scales the entire layout each spin (e.g. Martingale doubles every chip after a loss)." },
];

export function coverageOf(kind: BetKind, t: WheelType): number {
  if (kind === "manual") return 0;
  const opt = BET_OPTIONS.find(b => b.value === kind);
  return (opt?.hits ?? 0) / getWheelSize(t);
}

export function expectedEdgeOf(kind: BetKind, t: WheelType): number {
  // Manual layouts: every standard roulette bet has the same per-unit edge,
  // so the edge of any manual mix is just the wheel edge.
  if (kind === "manual") return houseEdge(t);
  const opt = BET_OPTIONS.find(b => b.value === kind)!;
  const p = opt.hits / getWheelSize(t);
  return p * opt.payout - (1 - p);
}

export const PROGRESSIONS: { value: Progression; label: string; help: string }[] = [
  { value: "flat", label: "Flat (no progression)",
    help: "Bet the SAME amount every spin. No progression. The honest baseline — pure house edge, no variance amplification." },
  { value: "martingale", label: "Martingale",
    help: "DOUBLE the stake after every loss (best on even-money bets). When the desired stake exceeds the table max, the simulator caps the bet at the max — the system is broken at that point: a win no longer recovers prior losses." },
  { value: "reverse-martingale", label: "Reverse Martingale (Paroli)",
    help: "DOUBLE after every WIN, reset on a loss. Rides hot streaks with small downside. Still a losing system long-term — house edge unchanged." },
  { value: "dalembert", label: "D'Alembert",
    help: "Add 1 unit after a loss, subtract 1 after a win. Slow, gentle progression. Feels safer than Martingale; same negative expectation." },
  { value: "fibonacci", label: "Fibonacci",
    help: "Stake follows Fibonacci (1,1,2,3,5,8,13...): +1 step on loss, -2 steps on win (best on even-money bets). The simulator caps the index at 15 (max multiplier 987×) for performance — long losing streaks past that point hold there until a win." },
  { value: "oscars", label: "Oscar's Grind",
    help: "Aim for +1 unit profit per series. Increase stake by 1 only after wins until target hit, then reset. Tight control; still negative EV." },
  { value: "labouchere", label: "Labouchère (cancellation)",
    help: "Sequence like 1-2-3-4. Stake = first + last (best on even-money bets). Win → cross both off. Loss → append the loss size. The simulator caps the running line at 16 entries to keep it bounded; clearing the line restarts at 1-2-3-4." },
  { value: "custom", label: "Custom (build your own)",
    help: "Design your own progression: choose what happens to the stake after a loss and after a win (multiply, add units, reset, or keep), cap the maximum stake, and optionally force a reset after a losing streak. The math verdict still applies — no rule combination changes the house edge." },
];

// ---------- PRNG ----------
let _seed = (Math.random() * 2 ** 31) | 0;
export function reseed(seed?: number) { _seed = seed ?? ((Math.random() * 2 ** 31) | 0); }
function rand() {
  _seed = (_seed + 0x6D2B79F5) | 0;
  let t = _seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function spinNumber(t: WheelType = "european"): number {
  return Math.floor(rand() * getWheelSize(t));
}

// ---------- bet evaluation ----------
export function getNumberColor(n: number): "red" | "black" | "green" {
  if (n === 0 || n === ZERO_DOUBLE) return "green";
  return REDS.has(n) ? "red" : "black";
}
export function getPayout(kind: BetKind): number {
  if (kind === "straight") return 35;
  if (kind === "manual") return 0;
  if (kind.startsWith("dozen") || kind.startsWith("column")) return 2;
  return 1;
}
export function isWinningBet(n: number, kind: BetKind, straight: number): boolean {
  // Either zero loses every bet except a straight bet on that exact zero.
  if (n === 0 || n === ZERO_DOUBLE) return kind === "straight" && straight === n;
  switch (kind) {
    case "red": return REDS.has(n);
    case "black": return !REDS.has(n);
    case "even": return n % 2 === 0;
    case "odd": return n % 2 === 1;
    case "low": return n >= 1 && n <= 18;
    case "high": return n >= 19 && n <= 36;
    case "dozen1": return n >= 1 && n <= 12;
    case "dozen2": return n >= 13 && n <= 24;
    case "dozen3": return n >= 25 && n <= 36;
    case "column1": return n % 3 === 1;
    case "column2": return n % 3 === 2;
    case "column3": return n % 3 === 0;
    case "straight": return n === straight;
    case "manual": return false;
  }
}
export function evalBet(b: Bet, n: number): { won: boolean; profit: number } {
  const won = isWinningBet(n, b.kind, b.number ?? 0);
  return { won, profit: won ? b.amount * getPayout(b.kind) : -b.amount };
}

// ---------- strategy state ----------
export function makeStrategyState(baseStake: number): StrategyState {
  return { stake: baseStake, fibIndex: 0, oscarsProfit: 0, labouchere: [1, 2, 3, 4], lossStreak: 0 };
}

/** Has the session hit a user-defined stop condition? (ruin is handled separately) */
export function checkStopCondition(balance: number, starting: number, opts: SimOptions): StopReason {
  if (opts.stopProfit && opts.stopProfit > 0 && balance >= starting + opts.stopProfit) return "target";
  if (opts.stopLoss && opts.stopLoss > 0 && balance <= starting - opts.stopLoss) return "stoploss";
  return null;
}
const FIB = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987];
function fib(i: number) { return FIB[Math.min(Math.max(i, 0), FIB.length - 1)]; }

export function getStake(s: StrategyState, p: Progression, base: number, balance: number, max: number, rules?: CustomRules): number {
  let want = base;
  if (p === "flat") want = base;
  else if (p === "martingale") want = s.stake;
  else if (p === "reverse-martingale") want = s.stake;
  else if (p === "dalembert") want = s.stake;
  else if (p === "fibonacci") want = base * fib(s.fibIndex);
  else if (p === "oscars") want = s.stake;
  else if (p === "labouchere") {
    const line = s.labouchere.length ? s.labouchere : [1, 2, 3, 4];
    want = base * (line.length === 1 ? line[0] : line[0] + line[line.length - 1]);
  } else if (p === "custom") {
    want = s.stake;
    const r = rules ?? DEFAULT_CUSTOM_RULES;
    if (r.maxUnits > 0) want = Math.min(want, base * r.maxUnits);
  }
  return Math.max(0, Math.min(Math.floor(want), Math.floor(balance), max));
}

function applyCustomAction(stake: number, base: number, action: CustomAction, value: number): number {
  switch (action) {
    case "multiply": return Math.max(base, stake * Math.max(0.1, value));
    case "add": return Math.max(base, stake + base * value);
    case "reset": return base;
    case "keep": return stake;
  }
}

export function updateStrategyState(
  s: StrategyState, p: Progression, base: number,
  won: boolean, profit: number, stake: number,
  rules?: CustomRules,
): StrategyState {
  const out: StrategyState = {
    stake: s.stake, fibIndex: s.fibIndex, oscarsProfit: s.oscarsProfit,
    labouchere: [...s.labouchere], lossStreak: won ? 0 : s.lossStreak + 1,
  };
  if (p === "custom") {
    const r = rules ?? DEFAULT_CUSTOM_RULES;
    out.stake = won
      ? applyCustomAction(s.stake, base, r.onWinAction, r.onWinValue)
      : applyCustomAction(s.stake, base, r.onLossAction, r.onLossValue);
    if (r.maxUnits > 0) out.stake = Math.min(out.stake, base * r.maxUnits);
    if (!won && r.resetAfterLosses > 0 && out.lossStreak >= r.resetAfterLosses) {
      out.stake = base;
      out.lossStreak = 0;
    }
    return out;
  }
  if (p === "flat") out.stake = base;
  else if (p === "martingale") out.stake = won ? base : Math.max(base, s.stake * 2);
  else if (p === "reverse-martingale") out.stake = won ? Math.max(base, s.stake * 2) : base;
  else if (p === "dalembert") out.stake = won ? Math.max(base, s.stake - base) : s.stake + base;
  else if (p === "fibonacci") out.fibIndex = won ? Math.max(0, s.fibIndex - 2) : s.fibIndex + 1;
  else if (p === "oscars") {
    // Oscar's Grind: target +1 base unit per series.
    // After a win, raise stake by 1 unit BUT never bet more than what would
    // exactly hit the target on the next win — i.e. cap at (base - newSeriesProfit).
    const next = s.oscarsProfit + profit;
    if (next >= base) { out.oscarsProfit = 0; out.stake = base; }
    else {
      out.oscarsProfit = next;
      const remaining = Math.max(base, base - next); // never below 1 base unit
      out.stake = won ? Math.min(s.stake + base, remaining) : s.stake;
    }
  } else if (p === "labouchere") {
    if (won) {
      out.labouchere = out.labouchere.length <= 2 ? [] : out.labouchere.slice(1, -1);
      if (out.labouchere.length === 0) out.labouchere = [1, 2, 3, 4];
    } else {
      out.labouchere.push(Math.max(1, Math.round(stake / base)));
      if (out.labouchere.length > 16) out.labouchere = out.labouchere.slice(-16);
    }
  }
  return out;
}

// ---------- single spin ----------
export interface SpinReturn { result: SpinResult | null; state: StrategyState; balance: number; }

export function spinOnce(balance: number, state: StrategyState, opts: SimOptions): SpinReturn {
  // betKind = "manual": the chip layout's total stake IS the progression unit.
  // Chip amounts are the actual bets; the progression multiplies every chip
  // by the same factor each spin (Flat: 1× constantly. Martingale: 1×, 2×, 4×
  // after losses, reset to 1× on a win. Etc.).
  if (opts.betKind === "manual" && opts.manualBets && opts.manualBets.length > 0) {
    const baseUnit = opts.manualBets.reduce((s, b) => s + b.amount, 0);
    if (baseUnit <= 0) return { result: null, state, balance };
    const stake = getStake(state, opts.progression, baseUnit, balance, opts.tableMax, opts.customRules);
    if (stake <= 0) return { result: null, state, balance };
    const multiplier = stake / baseUnit;
    const scaledBets: Bet[] = opts.manualBets.map(b => ({
      ...b,
      amount: Math.max(1, Math.round(b.amount * multiplier)),
    }));
    const totalStake = scaledBets.reduce((s, b) => s + b.amount, 0);
    if (totalStake > balance) return { result: null, state, balance };
    const n = spinNumber(opts.wheelType);
    let profit = 0;
    for (const b of scaledBets) profit += evalBet(b, n).profit;
    const won = profit > 0;
    const newBalance = balance + profit;
    const newState = updateStrategyState(state, opts.progression, baseUnit, won, profit, totalStake, opts.customRules);
    return {
      result: { number: n, won, stake: totalStake, profit, payout: 0, balance: newBalance, bets: scaledBets },
      state: newState, balance: newBalance,
    };
  }

  // strategy: single bet on opts.betKind
  const stake = getStake(state, opts.progression, opts.baseStake, balance, opts.tableMax, opts.customRules);
  if (stake <= 0) return { result: null, state, balance };
  const n = spinNumber(opts.wheelType);
  const bet: Bet = { kind: opts.betKind, amount: stake, number: opts.betKind === "straight" ? opts.straightNumber : undefined };
  const { won, profit } = evalBet(bet, n);
  const newBalance = balance + profit;
  const newState = updateStrategyState(state, opts.progression, opts.baseStake, won, profit, stake, opts.customRules);
  return {
    result: { number: n, won, stake, profit, payout: getPayout(opts.betKind), balance: newBalance, bets: [bet] },
    state: newState, balance: newBalance,
  };
}

// ---------- summary ----------
export function calculateSummary(history: number[], results: SpinResult[], starting: number): Summary {
  let peak = starting, maxDD = 0, low = starting, high = starting;
  let bust: number | null = null;
  history.forEach((v, i) => {
    if (v > peak) peak = v;
    if (peak - v > maxDD) maxDD = peak - v;
    if (v < low) low = v;
    if (v > high) high = v;
    if (v <= 0 && bust === null && i > 0) bust = i;
  });
  let lossStreak = 0, winStreak = 0, maxLoss = 0, maxWin = 0;
  let wins = 0, totalStaked = 0, sumDelta = 0, sumDelta2 = 0;
  for (const r of results) {
    if (r.won) { wins++; winStreak++; lossStreak = 0; if (winStreak > maxWin) maxWin = winStreak; }
    else { lossStreak++; winStreak = 0; if (lossStreak > maxLoss) maxLoss = lossStreak; }
    totalStaked += r.stake;
    sumDelta += r.profit;
    sumDelta2 += r.profit * r.profit;
  }
  const ending = history[history.length - 1] ?? starting;
  const profit = ending - starting;
  const n = results.length;
  const mean = n ? sumDelta / n : 0;
  const variance = n ? sumDelta2 / n - mean * mean : 0;
  return {
    spins: n,
    profit,
    roi: starting ? (profit / starting) * 100 : 0,
    endingBalance: ending,
    lowestBalance: low,
    maxBalance: high,
    maxDrawdown: maxDD,
    hitRate: n ? (wins / n) * 100 : 0,
    longestLossStreak: maxLoss,
    longestWinStreak: maxWin,
    avgChangePerSpin: n ? profit / n : 0,
    avgStake: n ? totalStaked / n : 0,
    totalStaked,
    bustSpin: bust,
    stdDev: Math.sqrt(Math.max(0, variance)),
  };
}

// ---------- monte carlo ----------

export interface MonteCarloProgress { done: number; total: number; }

/**
 * Synchronous Monte Carlo kernel. Designed to run either on the main thread
 * (legacy / tiny runs) or inside a Web Worker. Calls `onProgress` ~50 times
 * across the run regardless of size.
 */
export function runMonteCarloSync(
  runs: number,
  iterations: number,
  starting: number,
  opts: SimOptions,
  onProgress?: (p: MonteCarloProgress) => void,
  seed?: number,
): MonteCarloSummary {
  if (seed !== undefined) reseed(seed);
  const endings: number[] = [];
  const ruinSpins: number[] = [];
  const targetSpinsArr: number[] = [];
  let stopLossHits = 0;
  let profitable = 0;
  let totalSpinsPlayed = 0;
  let totalStakedAll = 0;
  let totalProfitAll = 0;
  const hasTarget = !!(opts.stopProfit && opts.stopProfit > 0);
  const hasStopLoss = !!(opts.stopLoss && opts.stopLoss > 0);

  const K = Math.min(200, iterations);
  const checkpoints = new Int32Array(K);
  for (let k = 0; k < K; k++) checkpoints[k] = Math.max(1, Math.round(((k + 1) * iterations) / K));
  const samples = new Float32Array(K * runs);
  const aliveAt = new Uint32Array(K);

  const stateBase = (opts.betKind === "manual" && opts.manualBets && opts.manualBets.length > 0)
    ? opts.manualBets.reduce((s, b) => s + b.amount, 0)
    : opts.baseStake;

  // Adaptive: aim for ~50 progress reports total regardless of run count.
  const reportEvery = Math.max(1, Math.floor(runs / 50));

  for (let r = 0; r < runs; r++) {
    let bal = starting;
    let st = makeStrategyState(stateBase);
    let ruin: number | null = null;
    let runStaked = 0;
    let spinsPlayed = 0;
    let alive = true;   // not ruined
    let playing = true; // still spinning (not ruined, not stopped out)
    let cpIdx = 0;
    for (let i = 1; i <= iterations; i++) {
      if (playing) {
        const next = spinOnce(bal, st, opts);
        if (!next.result) { ruin = i; alive = false; playing = false; }
        else {
          runStaked += next.result.stake;
          spinsPlayed++;
          st = next.state; bal = next.balance;
          if (bal <= 0) { ruin = i; bal = 0; alive = false; playing = false; }
          else if (hasTarget && bal >= starting + (opts.stopProfit as number)) {
            targetSpinsArr.push(i); playing = false; // walk away with the win
          } else if (hasStopLoss && bal <= starting - (opts.stopLoss as number)) {
            stopLossHits++; playing = false; // stopped out, balance frozen
          }
        }
      }
      while (cpIdx < K && checkpoints[cpIdx] === i) {
        samples[cpIdx * runs + r] = alive ? bal : 0;
        if (alive) aliveAt[cpIdx]++;
        cpIdx++;
      }
    }
    totalSpinsPlayed += spinsPlayed;
    totalStakedAll += runStaked;
    totalProfitAll += bal - starting;
    endings.push(bal);
    if (bal > starting) profitable++;
    if (ruin !== null) ruinSpins.push(ruin);
    if (onProgress && r % reportEvery === 0) onProgress({ done: r, total: runs });
  }
  endings.sort((a, b) => a - b);
  const sum = endings.reduce((a, b) => a + b, 0);
  const avgEnding = sum / endings.length;
  const median = endings[Math.floor(endings.length / 2)];
  const avgRuin = ruinSpins.length ? ruinSpins.reduce((a, b) => a + b, 0) / ruinSpins.length : null;
  const sortedRuin = [...ruinSpins].sort((a, b) => a - b);
  const medRuin = sortedRuin.length ? sortedRuin[Math.floor(sortedRuin.length / 2)] : null;
  const avgChangePerSpin = totalSpinsPlayed > 0 ? totalProfitAll / totalSpinsPlayed : 0;
  const realizedEdge = totalStakedAll > 0 ? totalProfitAll / totalStakedAll : 0;

  // Fan-chart percentiles: full sort per checkpoint. Native Float32Array.sort
  // is highly optimized in V8 and benchmarks faster than a JS quickselect for
  // the run sizes we deal with — and gives identical results regardless of
  // pivot choice, which keeps the band shapes stable across runs.
  const fanSpins: number[] = Array.from(checkpoints);
  const p1: number[] = [], p10: number[] = [], p25: number[] = [], p50: number[] = [], p75: number[] = [], p90: number[] = [], p99: number[] = [], mean: number[] = [];
  const col = new Float32Array(runs);
  const pickIdx = (q: number) => Math.min(runs - 1, Math.max(0, Math.floor(runs * q)));
  for (let k = 0; k < K; k++) {
    let s = 0;
    for (let r = 0; r < runs; r++) { const v = samples[k * runs + r]; col[r] = v; s += v; }
    col.sort();
    p1.push(col[pickIdx(0.01)]);
    p10.push(col[pickIdx(0.10)]);
    p25.push(col[pickIdx(0.25)]);
    p50.push(col[pickIdx(0.50)]);
    p75.push(col[pickIdx(0.75)]);
    p90.push(col[pickIdx(0.90)]);
    p99.push(col[pickIdx(0.99)]);
    mean.push(s / runs);
  }
  const survivalAlive = Array.from(aliveAt, c => c / runs);

  return {
    runs, iterations,
    ruinRate: (ruinSpins.length / runs) * 100,
    avgRuinSpin: avgRuin,
    medianRuinSpin: medRuin,
    medianEnding: median,
    avgEnding,
    worstEnding: endings[0],
    bestEnding: endings[endings.length - 1],
    profitableRate: (profitable / runs) * 100,
    avgChangePerSpin,
    realizedEdge,
    ruinHistogram: histogram(ruinSpins, 18),
    finalHistogram: histogram(endings, 24),
    survival: { spins: fanSpins, alive: survivalAlive },
    fan: { spins: fanSpins, p1, p10, p25, p50, p75, p90, p99, mean },
    startingBalance: starting,
    targetHitRate: hasTarget ? (targetSpinsArr.length / runs) * 100 : null,
    avgSpinsToTarget: targetSpinsArr.length ? targetSpinsArr.reduce((a, b) => a + b, 0) / targetSpinsArr.length : null,
    medianSpinsToTarget: targetSpinsArr.length ? [...targetSpinsArr].sort((a, b) => a - b)[Math.floor(targetSpinsArr.length / 2)] : null,
    stopLossRate: hasStopLoss ? (stopLossHits / runs) * 100 : null,
  };
}

/** Legacy async wrapper. New code routes through the worker via mcClient. */
export async function runMonteCarlo(
  runs: number,
  iterations: number,
  starting: number,
  opts: SimOptions,
  onProgress?: (p: number) => void,
): Promise<MonteCarloSummary> {
  return runMonteCarloSync(runs, iterations, starting, opts, p => {
    if (onProgress) onProgress(p.done / Math.max(1, p.total));
  });
}

function histogram(arr: number[], bins: number): { labels: number[]; counts: number[] } {
  if (!arr.length) return { labels: [], counts: [] };
  // Loop instead of Math.min/max(...arr): spread on a 100k-element array
  // can blow the call-stack on some engines.
  let min = arr[0], max = arr[0];
  for (let i = 1; i < arr.length; i++) {
    const v = arr[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const w = Math.max(1, (max - min) / bins);
  const counts = new Array(bins).fill(0);
  for (const v of arr) counts[Math.min(bins - 1, Math.floor((v - min) / w))]++;
  return { labels: counts.map((_, i) => Math.round(min + i * w)), counts };
}

// ---------- formatters ----------
export function fmtMoney(v: number) {
  // Whole dollars render without ".00"; fractional values keep 2 decimals.
  const whole = Number.isInteger(Math.round(v * 100) / 100) || Math.abs(v - Math.round(v)) < 1e-9;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD",
    minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(v);
}
export function fmtPct(v: number) { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`; }
