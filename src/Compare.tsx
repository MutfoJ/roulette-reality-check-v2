// ============================================================
//  Compare tab — run identical Monte Carlo batches for up to 6
//  strategy setups and overlay the results.
// ============================================================
import React from "react";
import uPlot from "uplot";
import { GitCompareArrows, Play, Plus, Trash2 } from "lucide-react";
import {
  BET_OPTIONS, PROGRESSIONS, fmtMoney, fmtPct,
  type MonteCarloSummary, type SimOptions,
} from "./engine";
import { runMonteCarloInWorker } from "./mcClient";

export const COMPARE_COLORS = ["#f4c762", "#4cc9f0", "#4ade80", "#fb7185", "#c084fc", "#fb923c"];

export interface Candidate {
  id: number;
  label: string;
  opts: SimOptions;
  starting: number;
}

interface Props {
  /** Snapshot of the currently configured setup (sidebar). */
  snapshot: () => { label: string; opts: SimOptions; starting: number };
  mcRuns: number;
  mcIterations: number;
  seedLock: boolean;
  seed: number;
}

function describe(opts: SimOptions): string {
  const prog = PROGRESSIONS.find(p => p.value === opts.progression)?.label ?? opts.progression;
  const bet = BET_OPTIONS.find(b => b.value === opts.betKind)?.label ?? opts.betKind;
  return `${prog} · ${bet} · $${opts.baseStake} base · ${opts.wheelType === "american" ? "US" : "EU"} wheel`;
}

function formatSpin(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return v.toFixed(0);
}

// Minimal uPlot mounter for the overlay charts (self-contained).
function OverlayChart({ series, mode }: {
  series: { label: string; color: string; spins: number[]; values: number[] }[];
  mode: "percent" | "money";
}) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const plotRef = React.useRef<uPlot | null>(null);

  React.useEffect(() => {
    const el = hostRef.current;
    if (!el || !series.length) return;
    // Align all series onto the longest spin axis (they share checkpoints when
    // run with the same iterations; tolerate differing lengths anyway).
    const xs = series.reduce((best, s) => (s.spins.length > best.length ? s.spins : best), series[0].spins);
    const data: uPlot.AlignedData = [
      xs,
      ...series.map(s => xs.map((_, i) => (i < s.values.length ? s.values[i] : null))),
    ] as uPlot.AlignedData;

    const make = (w: number, h: number) => new uPlot({
      width: w, height: h,
      padding: [10, 12, 4, 4],
      cursor: { drag: { x: true, y: false }, points: { size: 6 } },
      legend: { show: true, live: true },
      scales: { x: { time: false }, y: mode === "percent" ? { range: [0, 100] } : {} },
      axes: [
        { stroke: "rgba(148,160,185,0.9)", grid: { stroke: "rgba(128,140,160,0.12)" }, ticks: { stroke: "rgba(128,140,160,0.2)" }, font: '11px "JetBrains Mono", monospace', size: 36, values: (_u, ts) => ts.map(t => formatSpin(t)) },
        { stroke: "rgba(148,160,185,0.9)", grid: { stroke: "rgba(128,140,160,0.12)" }, ticks: { stroke: "rgba(128,140,160,0.2)" }, font: '11px "JetBrains Mono", monospace', size: 54, values: (_u, vs) => vs.map(v => (mode === "percent" ? `${v.toFixed(0)}%` : v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`)) },
      ],
      series: [
        { label: "Spin" },
        ...series.map(s => ({
          label: s.label,
          stroke: s.color,
          width: 2,
          points: { show: false },
          value: (_u: uPlot, v: number | null) => (v == null ? "—" : mode === "percent" ? `${v.toFixed(1)}%` : fmtMoney(v)),
        })),
      ],
    }, data, el);

    const rect = el.getBoundingClientRect();
    plotRef.current = make(Math.max(280, rect.width), 256);
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? rect.width;
      plotRef.current?.setSize({ width: Math.max(280, w), height: 256 });
    });
    ro.observe(el);
    return () => { ro.disconnect(); plotRef.current?.destroy(); plotRef.current = null; };
  }, [series, mode]);

  if (!series.length) return <div className="chart-empty-block">Run the comparison to see overlaid curves</div>;
  return <div ref={hostRef} className="chart-uplot" />;
}

let nextId = 1;

export function ComparePanel({ snapshot, mcRuns, mcIterations, seedLock, seed }: Props) {
  const [candidates, setCandidates] = React.useState<Candidate[]>([]);
  const [results, setResults] = React.useState<Map<number, MonteCarloSummary>>(new Map());
  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] = React.useState<{ idx: number; frac: number } | null>(null);
  const [overlayMode, setOverlayMode] = React.useState<"survival" | "median">("survival");
  const abortRef = React.useRef<AbortController | null>(null);

  const addCurrent = () => {
    if (candidates.length >= 6) return;
    const snap = snapshot();
    setCandidates(prev => [...prev, { id: nextId++, label: snap.label, opts: snap.opts, starting: snap.starting }]);
  };

  const remove = (id: number) => {
    setCandidates(prev => prev.filter(c => c.id !== id));
    setResults(prev => { const m = new Map(prev); m.delete(id); return m; });
  };

  const rename = (id: number, label: string) =>
    setCandidates(prev => prev.map(c => (c.id === id ? { ...c, label } : c)));

  const runAll = async () => {
    if (!candidates.length || running) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    setResults(new Map());
    // One seed for the whole comparison → every candidate faces the same RNG stream.
    const batchSeed = seedLock ? seed : ((Math.random() * 2 ** 31) | 0);
    try {
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        setProgress({ idx: i, frac: 0 });
        const res = await runMonteCarloInWorker({
          runs: mcRuns, iterations: mcIterations, starting: c.starting,
          opts: c.opts, seed: batchSeed,
          onProgress: f => setProgress({ idx: i, frac: f }),
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        setResults(prev => new Map(prev).set(c.id, res));
      }
    } catch (err) {
      if ((err as { name?: string }).name !== "AbortError") console.error("Compare failed:", err);
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setRunning(false);
      setProgress(null);
    }
  };

  React.useEffect(() => () => abortRef.current?.abort(), []);

  const overlaySeries = React.useMemo(() => candidates
    .map((c, i) => {
      const r = results.get(c.id);
      if (!r) return null;
      return overlayMode === "survival"
        ? { label: c.label, color: COMPARE_COLORS[i % COMPARE_COLORS.length], spins: r.survival.spins, values: r.survival.alive.map(a => a * 100) }
        : { label: c.label, color: COMPARE_COLORS[i % COMPARE_COLORS.length], spins: r.fan.spins, values: r.fan.p50 };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null), [candidates, results, overlayMode]);

  const anyTarget = candidates.some(c => results.get(c.id)?.targetHitRate !== null && results.get(c.id) !== undefined);

  return (
    <>
      <div className="panel">
        <div className="chart-header">
          <div>
            <span className="eyebrow"><GitCompareArrows size={14} /> Strategy comparison</span>
            <h2>Same bankroll, same luck — different systems</h2>
          </div>
          <div className="action-row">
            <button className="btn" onClick={addCurrent} disabled={candidates.length >= 6}>
              <Plus size={14} /> Add current setup
            </button>
            <button className="btn primary" onClick={runAll} disabled={!candidates.length || running}>
              <Play size={14} /> {running ? "Comparing…" : `Run all (${mcRuns.toLocaleString()} × ${formatSpin(mcIterations)})`}
            </button>
          </div>
        </div>

        {candidates.length === 0 ? (
          <p className="empty-state">
            Configure a strategy in the sidebar, then press <strong>Add current setup</strong>.
            Repeat with different progressions, bets, or wheels (up to 6) and run them all through the
            same Monte Carlo batch — with identical random seeds, so every system faces the same luck.
          </p>
        ) : (
          <div className="cand-list">
            {candidates.map((c, i) => (
              <div className="cand-row" key={c.id}>
                <span className="cand-dot" style={{ background: COMPARE_COLORS[i % COMPARE_COLORS.length] }} />
                <input
                  className="cand-name"
                  value={c.label}
                  onChange={e => rename(c.id, e.target.value)}
                  aria-label="Candidate name"
                />
                <span className="cand-desc">{describe(c.opts)} · start {fmtMoney(c.starting)}</span>
                {progress && candidates[progress.idx]?.id === c.id && (
                  <span className="cand-progress">{Math.round(progress.frac * 100)}%</span>
                )}
                <button className="btn icon" onClick={() => remove(c.id)} title="Remove"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {results.size > 0 && (
        <>
          <div className="panel">
            <div className="chart-header">
              <div>
                <span className="eyebrow">Overlay</span>
                <h2>{overlayMode === "survival" ? "Survival curves" : "Median bankroll path"}</h2>
              </div>
              <div className="mode-tabs">
                <button className={overlayMode === "survival" ? "active" : ""} onClick={() => setOverlayMode("survival")}>Survival</button>
                <button className={overlayMode === "median" ? "active" : ""} onClick={() => setOverlayMode("median")}>Median bankroll</button>
              </div>
            </div>
            <div className="chart-uplot-wrap small">
              <OverlayChart series={overlaySeries} mode={overlayMode === "survival" ? "percent" : "money"} />
            </div>
          </div>

          <div className="panel">
            <div className="section-title">Results table</div>
            <div className="compare-table-wrap">
              <table className="compare-table">
                <thead>
                  <tr>
                    <th>Strategy</th>
                    <th>Ruin</th>
                    <th>Profitable</th>
                    {anyTarget && <th>Hit target</th>}
                    <th>Median final</th>
                    <th>Avg final</th>
                    <th>Worst</th>
                    <th>Realized edge</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c, i) => {
                    const r = results.get(c.id);
                    if (!r) return null;
                    return (
                      <tr key={c.id}>
                        <td><span className="cand-dot inline" style={{ background: COMPARE_COLORS[i % COMPARE_COLORS.length] }} />{c.label}</td>
                        <td className={r.ruinRate > 50 ? "bad" : ""}>{r.ruinRate.toFixed(1)}%</td>
                        <td className={r.profitableRate >= 50 ? "good" : "bad"}>{r.profitableRate.toFixed(1)}%</td>
                        {anyTarget && <td>{r.targetHitRate === null ? "—" : `${r.targetHitRate.toFixed(1)}%`}</td>}
                        <td>{fmtMoney(r.medianEnding)}</td>
                        <td>{fmtMoney(r.avgEnding)}</td>
                        <td>{fmtMoney(r.worstEnding)}</td>
                        <td className={r.realizedEdge >= 0 ? "good" : "bad"}>{fmtPct(r.realizedEdge * 100)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="insight-sub" style={{ marginTop: 10 }}>
              Every system's realized edge converges to the wheel's house edge. What changes between rows is the
              <em> shape</em> of the outcome: how fast ruin arrives, how often a session ends ahead, and how ugly the
              worst case gets.
            </p>
          </div>
        </>
      )}
    </>
  );
}
