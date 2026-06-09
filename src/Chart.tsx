import React from "react";
import uPlot from "uplot";
import { fmtMoney, type ChartMode, type SpinResult } from "./engine";

export interface BankrollView { start: number; end: number }

interface BankrollProps {
  history: number[];
  results: SpinResult[];
  mode: ChartMode;
  startingBalance: number;
  /** Controlled zoom range (absolute spin indices). Null = full range. */
  view: BankrollView | null;
  onViewChange: (v: BankrollView | null) => void;
}

// "nice" tick step — standard 1/2/5×10^n picker for axis ticks
function niceTicks(min: number, max: number, target = 6): number[] {
  if (max <= min) { max = min + 1; }
  const span = max - min;
  const rough = span / target;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.abs(rough) || 1)));
  const norm = rough / pow;
  let step: number;
  if (norm < 1.5) step = 1;
  else if (norm < 3) step = 2;
  else if (norm < 7) step = 5;
  else step = 10;
  step *= pow;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step * 0.5; v += step) ticks.push(v);
  return ticks;
}

function formatTick(v: number, mode: ChartMode | "money"): string {
  if (mode === "percent") return `${v.toFixed(0)}%`;
  const a = Math.abs(v);
  if (a >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `$${(v / 1_000).toFixed(a >= 10_000 ? 0 : 1)}k`;
  return `$${v.toFixed(0)}`;
}

function formatSpin(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return v.toFixed(0);
}

const Y_AXIS_TITLE: Record<ChartMode, string> = {
  money: "Bankroll ($)",
  profit: "Profit / loss ($)",
  percent: "Return vs start (%)",
  drawdown: "Drawdown from peak ($)",
  stake: "Stake size ($)",
};

// ============================================================
//  Bankroll chart — canvas (preserves existing visual style)
//  Adds hover crosshair tooltip, wheel-zoom, drag-pan, dbl-click reset.
// ============================================================
export function BankrollChart({ history, results, mode, startingBalance, view, onViewChange }: BankrollProps) {
  const setView = onViewChange;
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const baseRef = React.useRef<HTMLCanvasElement | null>(null);
  const overlayRef = React.useRef<HTMLCanvasElement | null>(null);

  // Series derived from current mode
  const values = React.useMemo<number[]>(() => {
    let runningPeak = startingBalance;
    if (mode === "money") return history.slice();
    if (mode === "profit") return history.map(b => b - startingBalance);
    if (mode === "percent") return history.map(b => startingBalance ? ((b - startingBalance) / startingBalance) * 100 : 0);
    if (mode === "drawdown") return history.map(b => { runningPeak = Math.max(runningPeak, b); return runningPeak - b; });
    return [0, ...results.map(r => r.stake)];
  }, [history, results, mode, startingBalance]);

  // Reset zoom when the bankroll resets (different startingBalance =
  // simulation was reset). Mode changes preserve the zoom — switching
  // between Raw $ / Profit / % is exactly when you'd want to keep it.
  React.useEffect(() => {
    setView(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startingBalance]);
  // If values shrunk (e.g. user reset), drop a stale window.
  React.useEffect(() => {
    if (view && view.end >= values.length) setView(null);
  }, [values.length, view, setView]);

  const xMaxAbs = Math.max(0, values.length - 1);
  const start = view ? Math.max(0, Math.min(view.start, xMaxAbs)) : 0;
  const end = view ? Math.max(start + 1, Math.min(view.end, xMaxAbs)) : xMaxAbs;
  const window = values.slice(start, end + 1);

  // Padding info needed for hit-testing in mouse handlers; recomputed in draw.
  const layoutRef = React.useRef({ padL: 0, padR: 0, padT: 0, padB: 0, W: 0, H: 0, plotW: 0, plotH: 0, dpr: 1, yMin: 0, yMax: 1, ySpan: 1 });

  // Base draw — same logic as before, just operating on the windowed slice.
  React.useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window === undefined ? 1 : (typeof globalThis !== "undefined" ? (globalThis.devicePixelRatio || 1) : 1);
    const W = canvas.clientWidth * dpr;
    const H = canvas.clientHeight * dpr;
    canvas.width = W;
    canvas.height = H;
    ctx.clearRect(0, 0, W, H);

    const padL = 70 * dpr;
    const padR = 24 * dpr;
    const padT = 20 * dpr;
    const padB = 50 * dpr;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    if (window.length < 2) {
      ctx.fillStyle = "rgba(139, 149, 173, 0.6)";
      ctx.font = `${14 * dpr}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("No spins yet — press Run to start", W / 2, H / 2);
      layoutRef.current = { padL, padR, padT, padB, W, H, plotW, plotH, dpr, yMin: 0, yMax: 1, ySpan: 1 };
      return;
    }

    let minV = Math.min(...window);
    let maxV = Math.max(...window);
    if (mode === "money") {
      minV = Math.min(minV, startingBalance);
      maxV = Math.max(maxV, startingBalance);
    } else if (mode === "drawdown" || mode === "stake") {
      minV = 0;
    }
    if (maxV - minV < 1e-6) maxV = minV + 1;

    const yTicks = niceTicks(minV, maxV, 6);
    const yMin = yTicks[0];
    const yMax = yTicks[yTicks.length - 1];
    const ySpan = yMax - yMin || 1;
    const xMaxLocal = window.length - 1;

    const x2px = (i: number) => padL + (i / Math.max(1, xMaxLocal)) * plotW;
    const y2px = (v: number) => padT + (1 - (v - yMin) / ySpan) * plotH;

    // Y grid + tick labels
    ctx.font = `${11 * dpr}px "JetBrains Mono", monospace`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    yTicks.forEach((t) => {
      const y = y2px(t);
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillStyle = "rgba(203, 213, 225, 0.8)";
      ctx.fillText(formatTick(t, mode), padL - 8 * dpr, y);
    });

    // X axis ticks — labels show absolute spin numbers (start + local index)
    const localXTicks = niceTicks(0, xMaxLocal, Math.min(8, Math.max(2, Math.floor(plotW / (90 * dpr)))));
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    localXTicks.forEach((t) => {
      if (t < 0 || t > xMaxLocal) return;
      const x = x2px(t);
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke();
      ctx.strokeStyle = "rgba(203, 213, 225, 0.4)";
      ctx.beginPath(); ctx.moveTo(x, H - padB); ctx.lineTo(x, H - padB + 4 * dpr); ctx.stroke();
      ctx.fillStyle = "rgba(203, 213, 225, 0.8)";
      ctx.fillText(formatSpin(t + start), x, H - padB + 7 * dpr);
    });

    // axis frame
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = 1.2 * dpr;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, H - padB);
    ctx.lineTo(W - padR, H - padB);
    ctx.stroke();

    // baseline (start bankroll / zero)
    if (mode === "money" || mode === "profit" || mode === "percent") {
      const baselineV = mode === "money" ? startingBalance : 0;
      if (baselineV >= yMin && baselineV <= yMax) {
        const y = y2px(baselineV);
        ctx.strokeStyle = "rgba(244, 199, 98, 0.7)";
        ctx.setLineDash([6 * dpr, 6 * dpr]);
        ctx.lineWidth = 1.2 * dpr;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(244, 199, 98, 0.85)";
        ctx.font = `${10 * dpr}px Inter, sans-serif`;
        ctx.textAlign = "left"; ctx.textBaseline = "bottom";
        ctx.fillText("baseline", padL + 6 * dpr, y - 2 * dpr);
      }
    }

    // area + line
    const finalUp = window[window.length - 1] >= window[0];
    const lineColor =
      mode === "drawdown" ? "#fb7185" :
      mode === "stake" ? "#f4c762" :
      finalUp ? "#4ade80" : "#fb7185";
    const fillTop =
      mode === "drawdown" ? "rgba(251, 113, 133, 0.30)" :
      mode === "stake" ? "rgba(244, 199, 98, 0.26)" :
      finalUp ? "rgba(74, 222, 128, 0.26)" : "rgba(251, 113, 133, 0.26)";

    ctx.save();
    ctx.beginPath();
    ctx.rect(padL, padT, plotW, plotH);
    ctx.clip();

    ctx.beginPath();
    window.forEach((v, i) => {
      const x = x2px(i), y = y2px(v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineTo(x2px(xMaxLocal), H - padB);
    ctx.lineTo(x2px(0), H - padB);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padT, 0, H - padB);
    grad.addColorStop(0, fillTop);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.lineWidth = 2.2 * dpr;
    ctx.strokeStyle = lineColor;
    window.forEach((v, i) => {
      const x = x2px(i), y = y2px(v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();

    // last-point dot
    const lx = x2px(window.length - 1);
    const ly = y2px(window[window.length - 1]);
    ctx.fillStyle = lineColor;
    ctx.beginPath(); ctx.arc(lx, ly, 4 * dpr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();

    // axis titles
    ctx.fillStyle = "rgba(244, 199, 98, 0.95)";
    ctx.font = `700 ${11 * dpr}px Inter, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillText("Spin #", padL + plotW / 2, H - 8 * dpr);
    ctx.save();
    ctx.translate(16 * dpr, padT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(Y_AXIS_TITLE[mode], 0, 0);
    ctx.restore();

    layoutRef.current = { padL, padR, padT, padB, W, H, plotW, plotH, dpr, yMin, yMax, ySpan };
  }, [window, mode, startingBalance, start]);

  // ----- Hover crosshair + drag-to-zoom selection on the overlay canvas -----
  const [hover, setHover] = React.useState<{ x: number; y: number; idx: number } | null>(null);
  // selection: client-space x range while the user is drag-selecting a zoom region.
  const [selection, setSelection] = React.useState<{ startX: number; endX: number } | null>(null);

  // Redraw overlay when hover or selection changes.
  React.useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { W, H, padL, padR, padT, padB, plotW, plotH, dpr, yMin, ySpan } = layoutRef.current;
    canvas.width = W;
    canvas.height = H;
    ctx.clearRect(0, 0, W, H);

    // Draw the drag-zoom selection rectangle, if any.
    if (selection && wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect();
      const x1Css = Math.max(padL / dpr, Math.min(rect.width - padR / dpr, selection.startX - rect.left));
      const x2Css = Math.max(padL / dpr, Math.min(rect.width - padR / dpr, selection.endX - rect.left));
      const xa = Math.min(x1Css, x2Css) * dpr;
      const xb = Math.max(x1Css, x2Css) * dpr;
      if (xb - xa > 1) {
        ctx.fillStyle = "rgba(244, 199, 98, 0.12)";
        ctx.strokeStyle = "rgba(244, 199, 98, 0.55)";
        ctx.lineWidth = 1 * dpr;
        ctx.fillRect(xa, padT, xb - xa, plotH);
        ctx.strokeRect(xa, padT, xb - xa, plotH);
      }
    }

    if (!hover || window.length < 2 || selection) return;
    const xMaxLocal = window.length - 1;
    const localIdx = hover.idx - start;
    if (localIdx < 0 || localIdx > xMaxLocal) return;
    const v = window[localIdx];
    const x = padL + (localIdx / Math.max(1, xMaxLocal)) * plotW;
    const y = padT + (1 - (v - yMin) / ySpan) * plotH;

    // crosshair
    ctx.save();
    ctx.beginPath();
    ctx.rect(padL, padT, plotW, plotH);
    ctx.clip();
    ctx.strokeStyle = "rgba(244, 199, 98, 0.45)";
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH);
    ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // dot
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(x, y, 4 * dpr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();

    // tooltip box
    const lines = [
      `Spin ${formatSpin(hover.idx)}`,
      mode === "percent" ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` :
      mode === "stake" ? `${fmtMoney(v)} stake` :
      mode === "profit" ? `${v >= 0 ? "+" : ""}${fmtMoney(v)}` :
      mode === "drawdown" ? `−${fmtMoney(v)}` :
      fmtMoney(v),
    ];
    ctx.font = `${11 * dpr}px "JetBrains Mono", monospace`;
    const tw = Math.max(...lines.map(l => ctx.measureText(l).width)) + 16 * dpr;
    const th = lines.length * 16 * dpr + 10 * dpr;
    let tx = x + 12 * dpr;
    if (tx + tw > padL + plotW) tx = x - tw - 12 * dpr;
    let ty = y - th - 8 * dpr;
    if (ty < padT + 4 * dpr) ty = y + 12 * dpr;
    ctx.fillStyle = "rgba(5,7,9,0.92)";
    ctx.strokeStyle = "rgba(244, 199, 98, 0.5)";
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    const r = 6 * dpr;
    ctx.moveTo(tx + r, ty);
    ctx.lineTo(tx + tw - r, ty);
    ctx.quadraticCurveTo(tx + tw, ty, tx + tw, ty + r);
    ctx.lineTo(tx + tw, ty + th - r);
    ctx.quadraticCurveTo(tx + tw, ty + th, tx + tw - r, ty + th);
    ctx.lineTo(tx + r, ty + th);
    ctx.quadraticCurveTo(tx, ty + th, tx, ty + th - r);
    ctx.lineTo(tx, ty + r);
    ctx.quadraticCurveTo(tx, ty, tx + r, ty);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#f1f5f9";
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    lines.forEach((l, i) => {
      ctx.fillStyle = i === 0 ? "rgba(244,199,98,0.95)" : "#f1f5f9";
      ctx.fillText(l, tx + 8 * dpr, ty + 6 * dpr + i * 16 * dpr);
    });
  }, [hover, selection, window, mode, start]);

  // Mouse handlers — translate clientX to absolute spin index, manage view window.
  // Drag-to-zoom: same UX as the uPlot Monte Carlo charts. Drag horizontally
  // across a region; release to zoom that span. Double-click to reset.
  const dragRef = React.useRef<{ startX: number; startIdx: number } | null>(null);

  const indexAtClientX = (clientX: number): number | null => {
    const wrap = wrapRef.current;
    if (!wrap || window.length < 2) return null;
    const rect = wrap.getBoundingClientRect();
    const { padL, padR, dpr } = layoutRef.current;
    const cssPadL = padL / dpr;
    const cssPadR = padR / dpr;
    const plotW = rect.width - cssPadL - cssPadR;
    const px = Math.max(0, Math.min(plotW, clientX - rect.left - cssPadL));
    const xMaxLocal = window.length - 1;
    const local = Math.round((px / plotW) * xMaxLocal);
    return Math.max(0, Math.min(xMaxLocal, local)) + start;
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (dragRef.current) {
      setSelection({ startX: dragRef.current.startX, endX: e.clientX });
      setHover(null);
      return;
    }
    const idx = indexAtClientX(e.clientX);
    if (idx === null) { setHover(null); return; }
    setHover({ x: e.clientX, y: e.clientY, idx });
  };
  const onMouseLeave = () => {
    setHover(null);
    // Cancel an in-progress selection without zooming when the cursor exits.
    dragRef.current = null;
    setSelection(null);
  };
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || xMaxAbs < 2) return;
    const idx = indexAtClientX(e.clientX);
    if (idx === null) return;
    dragRef.current = { startX: e.clientX, startIdx: idx };
    setSelection({ startX: e.clientX, endX: e.clientX });
    setHover(null);
  };
  const onMouseUp = (e: React.MouseEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    const dx = Math.abs(e.clientX - drag.startX);
    setSelection(null);
    // < 5px counts as a click, not a drag — preserve hover behaviour.
    if (dx < 5) return;
    const endIdx = indexAtClientX(e.clientX);
    if (endIdx === null) return;
    const s = Math.min(drag.startIdx, endIdx);
    const en = Math.max(drag.startIdx, endIdx);
    if (en - s < 2) return;
    if (s <= 0 && en >= xMaxAbs) setView(null);
    else setView({ start: s, end: en });
  };
  const onDoubleClick = () => setView(null);

  const zoomed = view !== null;
  return (
    <div
      ref={wrapRef}
      className="chart-wrap"
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onDoubleClick={onDoubleClick}
    >
      <canvas className="chart-canvas" ref={baseRef} />
      <canvas className="chart-overlay" ref={overlayRef} />
      {zoomed && (
        <button className="chart-reset-btn" onClick={() => setView(null)} title="Reset zoom">
          Reset zoom
        </button>
      )}
      <div className="chart-hint">drag to select a range to zoom • dbl-click to reset</div>
    </div>
  );
}

// ============================================================
//  Shared uPlot React wrapper
// ============================================================
type UplotData = uPlot.AlignedData;

interface UplotMounterProps {
  innerRef: React.RefObject<HTMLDivElement>;
  buildOpts: (w: number, h: number) => uPlot.Options;
  data: UplotData;
  height: number;
  deps: React.DependencyList;
  /** Apply an explicit X-scale range. Null = auto-fit to data. */
  xRange?: { min: number; max: number } | null;
}
// A small wrapper component that owns the uPlot instance lifecycle.
// Mounts only when the parent decides it should — i.e. never in the
// empty state, so we don't get stray axes / 0-baseline marks.
function UplotMounter({ innerRef, buildOpts, data, height, deps, xRange }: UplotMounterProps) {
  const plotRef = React.useRef<uPlot | null>(null);

  React.useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const initW = Math.max(120, el.clientWidth || 600);
    const opts = buildOpts(initW, height);
    // uPlot creates one .u-cursor-pt per series; even with
    // cursor.points.show=false they linger in the DOM at translate(0,0),
    // which is the plot-area origin = the speck the user kept seeing
    // top-left of the fan chart. Remove the nodes outright, and re-run
    // the sweep on every redraw in case uPlot re-creates them.
    const stripPts = (u: uPlot) => {
      u.root.querySelectorAll<HTMLElement>(".u-cursor-pt").forEach(el => el.remove());
    };
    const prevReady = opts.hooks?.ready ?? [];
    const prevDraw = opts.hooks?.draw ?? [];
    opts.hooks = {
      ...opts.hooks,
      ready: [...(Array.isArray(prevReady) ? prevReady : [prevReady]), stripPts],
      draw: [...(Array.isArray(prevDraw) ? prevDraw : [prevDraw]), stripPts],
    };
    const u = new uPlot(opts, data, el);
    plotRef.current = u;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = Math.max(120, Math.floor(entry.contentRect.width));
        u.setSize({ width: w, height });
      }
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      u.destroy();
      plotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  React.useEffect(() => {
    plotRef.current?.setData(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Apply / release the externally-driven X scale.
  React.useEffect(() => {
    const u = plotRef.current;
    if (!u) return;
    if (xRange) {
      u.setScale("x", { min: xRange.min, max: xRange.max });
    } else {
      const xs = u.data[0] as number[] | undefined;
      if (xs && xs.length) u.setScale("x", { min: xs[0], max: xs[xs.length - 1] });
    }
  }, [xRange?.min, xRange?.max, data]);

  return <div ref={innerRef} className="chart-uplot" />;
}

// Centered empty-state for the MC charts. Matches the BankrollChart's
// "No spins yet — press Run to start" look. Prefer rendering this alone
// (no uPlot, no axes, no stub series) so we never see a stray baseline,
// dot, or bar at y=0 in the empty state.
function EmptyChart({ message }: { message: string }) {
  return <div className="chart-empty-block">{message}</div>;
}

// ============================================================
//  Survival curve — uPlot
// ============================================================
export function SurvivalChart({ spins, alive, xRange }: { spins: number[]; alive: number[]; xRange?: { min: number; max: number } | null }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const empty = !spins.length;
  const data: UplotData = React.useMemo(
    () => (empty ? [[0], [0]] : [spins, alive.map(a => a * 100)]),
    [spins, alive, empty],
  );

  const buildOpts = React.useCallback((w: number, h: number): uPlot.Options => ({
    width: w,
    height: h,
    padding: [10, 12, 4, 4],
    cursor: { drag: { x: true, y: false }, lock: false, points: { size: 6 } },
    legend: { show: true, live: true },
    scales: { x: { time: false }, y: { range: [0, 100] } },
    axes: [
      { stroke: "rgba(203,213,225,0.8)", grid: { stroke: "rgba(255,255,255,0.06)" }, ticks: { stroke: "rgba(255,255,255,0.18)" }, font: '11px "JetBrains Mono", monospace', size: 36, values: (_u, ts) => ts.map(t => formatSpin(t)) },
      { stroke: "rgba(203,213,225,0.8)", grid: { stroke: "rgba(255,255,255,0.06)" }, ticks: { stroke: "rgba(255,255,255,0.18)" }, font: '11px "JetBrains Mono", monospace', size: 50, values: (_u, vs) => vs.map(v => `${v.toFixed(0)}%`) },
    ],
    series: [
      { label: "Spin" },
      {
        label: "Solvent",
        stroke: "#4ade80",
        width: 2,
        fill: "rgba(74,222,128,0.18)",
        points: { show: false },
        value: (_u, v) => (v == null ? "—" : `${v.toFixed(1)}%`),
      },
    ],
  }), []);

  // Don't mount uPlot at all when empty — avoids the stray "0% at spin 0"
  // green dot the user pointed out.
  if (empty) {
    return (
      <div className="chart-uplot-wrap small">
        <EmptyChart message="Run Monte Carlo to see survival curve" />
      </div>
    );
  }
  return (
    <div className="chart-uplot-wrap small">
      <UplotMounter innerRef={ref} buildOpts={buildOpts} data={data} height={260} deps={[]} xRange={xRange ?? null} />
    </div>
  );
}

// ============================================================
//  Fan chart — uPlot with bands between percentile pairs
// ============================================================
export function FanChart({
  spins, p1, p10, p25, p50, p75, p90, p99, mean: _mean, startingBalance, xRange,
}: {
  spins: number[]; p1: number[]; p10: number[]; p25: number[]; p50: number[];
  p75: number[]; p90: number[]; p99: number[]; mean: number[]; startingBalance: number;
  xRange?: { min: number; max: number } | null;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const empty = !spins.length;

  const data: UplotData = React.useMemo(
    () => (empty ? [[0]] as UplotData : [spins, p1, p99, p10, p90, p25, p75, p50] as UplotData),
    [spins, p1, p99, p10, p90, p25, p75, p50, empty],
  );

  const buildOpts = React.useCallback((w: number, h: number): uPlot.Options => ({
    width: w,
    height: h,
    padding: [12, 16, 4, 4],
    // Custom cursor: hide hover-point markers entirely. Those were the
    // chunky white "bubble" dots visible when zoomed in to a few spins.
    cursor: { drag: { x: true, y: false }, lock: false, points: { show: false } },
    legend: { show: true, live: true },
    scales: { x: { time: false }, y: {} },
    axes: [
      { stroke: "rgba(203,213,225,0.8)", grid: { stroke: "rgba(255,255,255,0.06)" }, ticks: { stroke: "rgba(255,255,255,0.18)" }, font: '11px "JetBrains Mono", monospace', size: 36, values: (_u, ts) => ts.map(t => formatSpin(t)) },
      { stroke: "rgba(203,213,225,0.8)", grid: { stroke: "rgba(255,255,255,0.06)" }, ticks: { stroke: "rgba(255,255,255,0.18)" }, font: '11px "JetBrains Mono", monospace', size: 64, values: (_u, vs) => vs.map(v => formatTick(v, "money")) },
    ],
    // points: { show: false } on every series suppresses the per-data
    // marker dots that uPlot draws when the X spacing is wide enough.
    series: [
      { label: "Spin" },
      { label: "p1",  stroke: "transparent", points: { show: false }, value: (_u, v) => v == null ? "—" : formatTick(v, "money") },
      { label: "p99", stroke: "transparent", points: { show: false }, value: (_u, v) => v == null ? "—" : formatTick(v, "money") },
      { label: "p10", stroke: "transparent", points: { show: false }, value: (_u, v) => v == null ? "—" : formatTick(v, "money") },
      { label: "p90", stroke: "transparent", points: { show: false }, value: (_u, v) => v == null ? "—" : formatTick(v, "money") },
      { label: "p25", stroke: "transparent", points: { show: false }, value: (_u, v) => v == null ? "—" : formatTick(v, "money") },
      { label: "p75", stroke: "transparent", points: { show: false }, value: (_u, v) => v == null ? "—" : formatTick(v, "money") },
      { label: "median", stroke: "#f4c762", width: 2.2, points: { show: false }, value: (_u, v) => v == null ? "—" : formatTick(v, "money") },
    ],
    bands: [
      { series: [2, 1], fill: "rgba(76, 201, 240, 0.10)" }, // p1..p99 outermost
      { series: [4, 3], fill: "rgba(76, 201, 240, 0.18)" }, // p10..p90
      { series: [6, 5], fill: "rgba(76, 201, 240, 0.30)" }, // p25..p75
    ],
    hooks: {
      draw: [
        (u) => {
          // Dashed gold baseline at starting bankroll, only if it's in y-range.
          const yScale = u.scales.y;
          if (yScale.min == null || yScale.max == null) return;
          if (startingBalance < yScale.min || startingBalance > yScale.max) return;
          const ctx = u.ctx;
          const y = u.valToPos(startingBalance, "y", true);
          const left = u.bbox.left;
          const right = u.bbox.left + u.bbox.width;
          ctx.save();
          ctx.strokeStyle = "rgba(244, 199, 98, 0.7)";
          ctx.setLineDash([6, 6]);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        },
      ],
    },
  }), [startingBalance]);

  if (empty) {
    return (
      <div className="chart-uplot-wrap small">
        <EmptyChart message="Run Monte Carlo to see bankroll fan chart" />
      </div>
    );
  }
  return (
    <div className="chart-uplot-wrap small">
      <UplotMounter innerRef={ref} buildOpts={buildOpts} data={data} height={320} deps={[startingBalance]} xRange={xRange ?? null} />
    </div>
  );
}

// ============================================================
//  Histogram — uPlot bars
// ============================================================
export function HistogramChart({
  data: histData,
  color = "#f4c762",
  xLabel: _xLabel = "Spins until ruin",
  yLabel: _yLabel = "# of trials",
}: {
  data: { labels: number[]; counts: number[] };
  color?: string;
  xLabel?: string;
  yLabel?: string;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const empty = !histData.counts.length || histData.counts.every(c => c === 0);

  const data: UplotData = React.useMemo(
    () => (empty ? [[0]] as UplotData : [histData.labels, histData.counts] as UplotData),
    [histData, empty],
  );

  const buildOpts = React.useCallback((w: number, h: number): uPlot.Options => {
    const barW = histData.labels.length > 1 ? 0.85 : 0.6;
    return {
      width: w,
      height: h,
      padding: [10, 12, 4, 4],
      cursor: { drag: { x: true, y: false }, lock: false, points: { show: false } },
      legend: { show: true, live: true },
      scales: { x: { time: false }, y: {} },
      axes: [
        { stroke: "rgba(203,213,225,0.8)", grid: { stroke: "rgba(255,255,255,0.06)" }, ticks: { stroke: "rgba(255,255,255,0.18)" }, font: '11px "JetBrains Mono", monospace', size: 36, values: (_u, ts) => ts.map(t => formatSpin(t)) },
        { stroke: "rgba(203,213,225,0.8)", grid: { stroke: "rgba(255,255,255,0.06)" }, ticks: { stroke: "rgba(255,255,255,0.18)" }, font: '11px "JetBrains Mono", monospace', size: 44 },
      ],
      series: [
        { label: "Bin start" },
        {
          label: "Count",
          stroke: color,
          fill: color,
          paths: uPlot.paths.bars!({ size: [barW, Infinity] }),
          points: { show: false },
          value: (_u, v) => v == null ? "—" : String(v),
        },
      ],
    };
  }, [color, histData.labels.length]);

  if (empty) {
    return (
      <div className="chart-uplot-wrap small">
        <EmptyChart message="Run Monte Carlo to see distribution" />
      </div>
    );
  }
  return (
    <div className="chart-uplot-wrap small">
      <UplotMounter innerRef={ref} buildOpts={buildOpts} data={data} height={260} deps={[color]} />
    </div>
  );
}
