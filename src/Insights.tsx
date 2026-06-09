// ============================================================
//  Insights tab — pocket heatmap, distribution checks, streak
//  statistics, and a gambler's-fallacy reality check, computed
//  from the live session's spin history.
// ============================================================
import React from "react";
import { Flame, Layers, Repeat, Scale } from "lucide-react";
import {
  ZERO_DOUBLE, REDS, getNumberColor, getWheelSize, pocketLabel, coverageOf,
  type BetKind, type SpinResult, type WheelType,
} from "./engine";

interface Props {
  results: SpinResult[];
  wheelType: WheelType;
  betKind: BetKind;
}

interface PocketStat { n: number; count: number; deviation: number; }

function useInsights(results: SpinResult[], wheelType: WheelType) {
  return React.useMemo(() => {
    const size = getWheelSize(wheelType);
    const counts = new Array<number>(38).fill(0);
    let red = 0, black = 0, green = 0, even = 0, odd = 0, low = 0, high = 0;
    for (const r of results) {
      counts[r.number]++;
      const c = getNumberColor(r.number);
      if (c === "red") red++;
      else if (c === "black") black++;
      else green++;
      if (r.number >= 1 && r.number <= 36) {
        if (r.number % 2 === 0) even++; else odd++;
        if (r.number <= 18) low++; else high++;
      }
    }
    const total = results.length;
    let wins = 0;
    for (const r of results) if (r.won) wins++;
    const expectedPer = total / size;
    const pockets: PocketStat[] = [];
    for (let n = 0; n <= 37; n++) {
      if (n === ZERO_DOUBLE && wheelType !== "american") continue;
      pockets.push({ n, count: counts[n], deviation: expectedPer > 0 ? (counts[n] - expectedPer) / expectedPer : 0 });
    }
    // Win/loss streak length distributions
    const lossStreaks: number[] = [];
    const winStreaks: number[] = [];
    let cur = 0; let curWon: boolean | null = null;
    for (const r of results) {
      if (curWon === null) { curWon = r.won; cur = 1; continue; }
      if (r.won === curWon) cur++;
      else {
        (curWon ? winStreaks : lossStreaks).push(cur);
        curWon = r.won; cur = 1;
      }
    }
    if (curWon !== null) (curWon ? winStreaks : lossStreaks).push(cur);
    const streakDist = (arr: number[], maxLen: number) => {
      const d = new Array<number>(maxLen + 1).fill(0);
      for (const s of arr) d[Math.min(s, maxLen)]++;
      return d;
    };
    // Gambler's fallacy: win rate on the spin following k consecutive losses
    const afterLosses: { k: number; next: number; wins: number }[] = [];
    for (let k = 1; k <= 6; k++) afterLosses.push({ k, next: 0, wins: 0 });
    let streak = 0;
    for (const r of results) {
      if (streak >= 1) {
        for (const a of afterLosses) {
          if (streak >= a.k) { a.next++; if (r.won) a.wins++; }
        }
      }
      streak = r.won ? 0 : streak + 1;
    }
    return {
      total, wins, expectedPer, pockets,
      splits: { red, black, green, even, odd, low, high },
      lossDist: streakDist(lossStreaks, 10),
      winDist: streakDist(winStreaks, 10),
      lossStreakCount: lossStreaks.length,
      winStreakCount: winStreaks.length,
      afterLosses,
    };
  }, [results, wheelType]);
}

function heatColor(dev: number): string {
  // dev: relative deviation from expected. Clamp to ±60%.
  const d = Math.max(-0.6, Math.min(0.6, dev));
  if (d >= 0) return `rgba(251, 113, 133, ${0.12 + (d / 0.6) * 0.75})`; // hot
  return `rgba(76, 201, 240, ${0.12 + (-d / 0.6) * 0.75})`; // cold
}

function SplitBar({ label, a, b, aLabel, bLabel, expectedA }: {
  label: string; a: number; b: number; aLabel: string; bLabel: string; expectedA: number;
}) {
  const total = a + b;
  const pa = total ? (a / total) * 100 : 50;
  return (
    <div className="split-row">
      <span className="split-label">{label}</span>
      <div className="split-bar" role="img" aria-label={`${aLabel} ${pa.toFixed(1)}%`}>
        <div className="split-a" style={{ width: `${pa}%` }} />
        <div className="split-expected" style={{ left: `${expectedA}%` }} title={`Expected ${expectedA.toFixed(1)}%`} />
      </div>
      <span className="split-nums">
        {aLabel} {total ? pa.toFixed(1) : "—"}% · {bLabel} {total ? (100 - pa).toFixed(1) : "—"}%
      </span>
    </div>
  );
}

export function InsightsPanel({ results, wheelType, betKind }: Props) {
  const ins = useInsights(results, wheelType);
  // Baseline = the session's own overall hit rate, so the comparison stays
  // valid even if the bet target changed mid-session. Falls back to the
  // theoretical coverage of the current bet when there's no data yet.
  const p = ins.total > 0
    ? ins.wins / ins.total
    : coverageOf(betKind === "manual" ? "red" : betKind, wheelType);
  const evenChanceExpected = (18 / getWheelSize(wheelType)) * 100;

  if (ins.total === 0) {
    return (
      <div className="panel">
        <div className="section-title"><Flame size={14} /> Session insights</div>
        <p className="empty-state">
          No spins yet. Run the simulator on the Play tab first — this tab then dissects the session:
          which pockets came up hot or cold, whether red/black and odd/even drifted from expectation,
          how long the win/loss streaks ran, and whether a losing streak made a win any more likely
          (spoiler: it doesn't).
        </p>
      </div>
    );
  }

  const maxLossShown = ins.lossDist.length - 1;

  return (
    <>
      <div className="panel">
        <div className="section-title"><Flame size={14} /> Pocket heatmap — {ins.total.toLocaleString()} spins</div>
        <p className="insight-sub">
          Expected hits per pocket: <strong>{ins.expectedPer.toFixed(1)}</strong>.
          Red = hotter than expected, blue = colder. Deviations like these are pure noise — they carry no predictive power.
        </p>
        <div className="heatmap">
          {ins.pockets.map(ps => (
            <div
              key={ps.n}
              className={`heat-cell ${getNumberColor(ps.n)}`}
              style={{ background: heatColor(ps.deviation) }}
              title={`${pocketLabel(ps.n)}: ${ps.count} hits (${(ps.deviation * 100).toFixed(1)}% vs expected)`}
            >
              <span className="heat-num">{pocketLabel(ps.n)}</span>
              <span className="heat-count">{ps.count}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="section-title"><Scale size={14} /> Distribution check</div>
        <div className="split-grid">
          <SplitBar label="Red vs Black" a={ins.splits.red} b={ins.splits.black} aLabel="Red" bLabel="Black" expectedA={50} />
          <SplitBar label="Even vs Odd" a={ins.splits.even} b={ins.splits.odd} aLabel="Even" bLabel="Odd" expectedA={50} />
          <SplitBar label="Low vs High" a={ins.splits.low} b={ins.splits.high} aLabel="1–18" bLabel="19–36" expectedA={50} />
        </div>
        <p className="insight-sub" style={{ marginTop: 10 }}>
          Zeros hit {ins.splits.green.toLocaleString()} times
          ({ins.total ? ((ins.splits.green / ins.total) * 100).toFixed(2) : "0"}% observed vs {(100 - 2 * evenChanceExpected).toFixed(2)}% expected).
          The zeros are exactly where the house edge lives.
        </p>
      </div>

      <div className="panel">
        <div className="section-title"><Repeat size={14} /> Streak anatomy</div>
        <div className="streak-cols">
          <div>
            <h4 className="streak-h">Loss streak lengths ({ins.lossStreakCount.toLocaleString()} streaks)</h4>
            <StreakBars dist={ins.lossDist} tone="bad" maxShown={maxLossShown} />
          </div>
          <div>
            <h4 className="streak-h">Win streak lengths ({ins.winStreakCount.toLocaleString()} streaks)</h4>
            <StreakBars dist={ins.winDist} tone="good" maxShown={maxLossShown} />
          </div>
        </div>
        <p className="insight-sub" style={{ marginTop: 8 }}>
          Streak lengths follow a geometric decay — each extra spin of a streak is a fresh independent event.
          In this session, the chance a losing streak extended one more spin was {(100 * (1 - p)).toFixed(1)}%, every time.
        </p>
      </div>

      <div className="panel">
        <div className="section-title"><Layers size={14} /> The gambler's fallacy, measured</div>
        <p className="insight-sub">
          "After {`N`} losses in a row, a win is due." Here's your session's actual win rate immediately after losing
          streaks, next to this session's overall per-spin win rate ({(p * 100).toFixed(1)}% across all {ins.total.toLocaleString()} spins):
        </p>
        <div className="fallacy-table" role="table">
          <div className="fallacy-row fallacy-head" role="row">
            <span>After … losses</span><span>Samples</span><span>Observed next-spin win</span><span>Session win rate</span>
          </div>
          {ins.afterLosses.map(a => (
            <div className="fallacy-row" role="row" key={a.k}>
              <span>≥ {a.k}</span>
              <span>{a.next.toLocaleString()}</span>
              <span className={a.next ? "" : "dim"}>{a.next ? `${((a.wins / a.next) * 100).toFixed(1)}%` : "—"}</span>
              <span className="dim">{(p * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
        <p className="insight-sub" style={{ marginTop: 8 }}>
          If losses made wins "due", the observed column would climb with the streak length. It doesn't — it hovers
          around the same constant at every depth. The wheel has no memory.
        </p>
      </div>
    </>
  );
}

function StreakBars({ dist, tone, maxShown }: { dist: number[]; tone: "good" | "bad"; maxShown: number }) {
  const max = Math.max(1, ...dist.slice(1));
  return (
    <div className="streak-bars">
      {dist.slice(1).map((c, i) => {
        const len = i + 1;
        return (
          <div className="streak-bar-row" key={len}>
            <span className="streak-len">{len === maxShown ? `${len}+` : len}</span>
            <div className="streak-track">
              <div className={`streak-fill ${tone}`} style={{ width: `${(c / max) * 100}%` }} />
            </div>
            <span className="streak-count">{c.toLocaleString()}</span>
          </div>
        );
      })}
    </div>
  );
}
