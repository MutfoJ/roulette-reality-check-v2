import React from "react";
import { createPortal } from "react-dom";
import {
  Activity, BarChart3, CircleDollarSign, Dice5, Download, FlaskConical, Gauge,
  GitCompareArrows, LineChart, Link2, Menu, Moon, Pause, Play, Plus, RotateCcw,
  Save, Sun, Target, Trash2, Upload, X, Zap, ChevronRight, Flame,
} from "lucide-react";
import {
  BET_OPTIONS, PROGRESSIONS, SPEEDS, DEFAULT_CUSTOM_RULES,
  fmtMoney, fmtPct, getNumberColor, calculateSummary, makeStrategyState,
  spinOnce, getPayout, coverageOf, expectedEdgeOf, checkStopCondition, reseed,
  pocketLabel,
  type Bet, type BetKind, type Progression, type ChartMode, type CustomRules,
  type SpinResult, type SimOptions, type StrategyState, type StopReason,
  type MonteCarloSummary, type WheelType, type CustomAction,
} from "./engine";
import { runMonteCarloInWorker } from "./mcClient";
import { RouletteWheel } from "./Wheel";
import { BankrollChart, HistogramChart, SurvivalChart, FanChart, type BankrollView } from "./Chart";
import { CasinoTable } from "./CasinoTable";
import { InsightsPanel } from "./Insights";
import { ComparePanel } from "./Compare";
import {
  sanitizeConfig, listPresets, savePreset, deletePreset, loadTheme, storeTheme,
  encodeShareHash, decodeShareHash, exportConfigFile, readConfigFile,
  type AppConfig, type Preset, type Theme,
} from "./presets";
import { downloadSessionCsv, downloadMcCsv } from "./exports";

const BANKROLL_PRESETS = [100, 500, 1000, 5000, 10000];

type Tab = "play" | "monte" | "compare" | "insights";

const TABS: { value: Tab; label: string; icon: React.ReactNode }[] = [
  { value: "play", label: "Play", icon: <Gauge size={15} /> },
  { value: "monte", label: "Monte Carlo", icon: <BarChart3 size={15} /> },
  { value: "compare", label: "Compare", icon: <GitCompareArrows size={15} /> },
  { value: "insights", label: "Insights", icon: <Flame size={15} /> },
];

function Help({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLElement | null>(null);
  const [tip, setTip] = React.useState<{ left: number; top: number; place: "top" | "bottom" } | null>(null);

  const show = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 24);
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2));
    const place = rect.top < 130 ? "bottom" : "top";
    const top = place === "bottom" ? rect.bottom + 10 : rect.top - 10;
    setTip({ left, top, place });
  }, []);

  React.useEffect(() => {
    if (!tip) return undefined;
    const hide = () => setTip(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [tip]);

  return (
    <>
      <i
        ref={ref}
        className="help"
        tabIndex={0}
        onMouseEnter={show}
        onMouseLeave={() => setTip(null)}
        onFocus={show}
        onBlur={() => setTip(null)}
      >
        !
      </i>
      {tip && createPortal(
        <div
          className={`floating-tip ${tip.place}`}
          style={{ left: tip.left, top: tip.top, width: "min(280px, calc(100vw - 24px))" }}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}

const CUSTOM_ACTIONS: { value: CustomAction; label: string }[] = [
  { value: "multiply", label: "Multiply stake by" },
  { value: "add", label: "Add base units" },
  { value: "reset", label: "Reset to base" },
  { value: "keep", label: "Keep stake" },
];

export default function App() {
  // ---------- core sim state ----------
  const [startingBalance, setStartingBalance] = React.useState(10000);
  const [balance, setBalance] = React.useState(10000);

  const [wheelType, setWheelType] = React.useState<WheelType>("european");
  const [progression, setProgression] = React.useState<Progression>("martingale");
  const [betKind, setBetKind] = React.useState<BetKind>("red");
  const [baseStake, setBaseStake] = React.useState(100);
  const [straightNumber, setStraightNumber] = React.useState(17);
  const [tableMax, setTableMax] = React.useState(5000);
  const [targetSpins, setTargetSpins] = React.useState(10000);
  const [speed, setSpeed] = React.useState<number>(8);
  const [stopOnBust, setStopOnBust] = React.useState(true);

  // ---------- new: session stop conditions ----------
  const [stopProfit, setStopProfit] = React.useState(0); // 0 = off
  const [stopLoss, setStopLoss] = React.useState(0);     // 0 = off
  const [sessionStop, setSessionStop] = React.useState<StopReason>(null);

  // ---------- new: custom strategy builder ----------
  const [customRules, setCustomRules] = React.useState<CustomRules>(DEFAULT_CUSTOM_RULES);

  // ---------- new: reproducibility ----------
  const [seedLock, setSeedLock] = React.useState(false);
  const [seed, setSeed] = React.useState(12345);

  // ---------- UI shell ----------
  const [tab, setTab] = React.useState<Tab>("play");
  const [theme, setTheme] = React.useState<Theme>(() => loadTheme());
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [presetsOpen, setPresetsOpen] = React.useState(false);

  const [isRunning, setIsRunning] = React.useState(false);
  const [history, setHistory] = React.useState<number[]>([10000]);
  const [results, setResults] = React.useState<SpinResult[]>([]);
  const [lastResult, setLastResult] = React.useState<SpinResult | null>(null);
  const [strategyState, setStrategyState] = React.useState<StrategyState>(makeStrategyState(100));
  const [chartMode, setChartMode] = React.useState<ChartMode>("money");

  const [manualBets, setManualBets] = React.useState<Bet[]>([]);
  const [chipSize, setChipSize] = React.useState(10);

  const [mcRuns, setMcRuns] = React.useState(2000);
  const [mcIterations, setMcIterations] = React.useState(10000);
  const [mcProgress, setMcProgress] = React.useState(0);
  const [mcRunning, setMcRunning] = React.useState(false);
  const [monteCarlo, setMonteCarlo] = React.useState<MonteCarloSummary | null>(null);
  type McChartMode = "ruin" | "survival" | "final" | "fan";
  const [mcChartMode, setMcChartMode] = React.useState<McChartMode>("ruin");

  const [flashKey, setFlashKey] = React.useState(0);
  const [singleSpinning, setSingleSpinning] = React.useState(false);
  const singleSpinTimer = React.useRef<number | null>(null);

  // ---------- theme ----------
  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
    storeTheme(theme);
  }, [theme]);

  const options: SimOptions = React.useMemo(
    () => ({
      baseStake, progression, betKind, straightNumber, tableMax, manualBets, wheelType,
      customRules: progression === "custom" ? customRules : undefined,
      stopProfit: stopProfit > 0 ? stopProfit : undefined,
      stopLoss: stopLoss > 0 ? stopLoss : undefined,
    }),
    [baseStake, progression, betKind, straightNumber, tableMax, manualBets, wheelType, customRules, stopProfit, stopLoss],
  );
  const summary = React.useMemo(
    () => calculateSummary(history, results, startingBalance),
    [history, results, startingBalance],
  );
  const expectedEdge = React.useMemo(
    () => expectedEdgeOf(betKind, wheelType),
    [betKind, wheelType],
  );
  const expectedStake = React.useMemo(
    () => betKind === "manual"
      ? manualBets.reduce((s, b) => s + b.amount, 0)
      : baseStake,
    [baseStake, manualBets, betKind],
  );
  const wheelCopy = wheelType === "american"
    ? { name: "American double-zero", pockets: "38 pockets", edge: "5.26%" }
    : { name: "European single-zero", pockets: "37 pockets", edge: "2.70%" };

  const computeStrategyBase = React.useCallback(() => {
    if (betKind === "manual") {
      const total = manualBets.reduce((s, b) => s + b.amount, 0);
      return total || baseStake;
    }
    return baseStake;
  }, [betKind, manualBets, baseStake]);

  const reset = React.useCallback(() => {
    setIsRunning(false);
    setBalance(startingBalance);
    setHistory([startingBalance]);
    setResults([]);
    setLastResult(null);
    setSessionStop(null);
    setStrategyState(makeStrategyState(computeStrategyBase()));
    setMonteCarlo(null);
    setMcProgress(0);
    if (seedLock) reseed(seed);
  }, [computeStrategyBase, startingBalance, seedLock, seed]);

  const updateStarting = (v: number) => {
    const value = Math.max(1, Math.floor(v));
    setStartingBalance(value);
    setBalance(value);
    setHistory([value]);
    setResults([]);
    setLastResult(null);
    setSessionStop(null);
    setStrategyState(makeStrategyState(computeStrategyBase()));
  };

  const changeWheel = (next: WheelType) => {
    if (next === wheelType) return;
    setIsRunning(false);
    setWheelType(next);
    setMonteCarlo(null);
    setMcProgress(0);
    setLastResult(null);
    if (next === "european" && straightNumber === 37) setStraightNumber(0);
    if (next === "european") {
      setManualBets(prev => prev.filter(b => b.kind !== "straight" || b.number !== 37));
    }
  };

  const runBatch = React.useCallback((count: number) => {
    if (sessionStop) return false;
    let bal = balance;
    let st = strategyState;
    const histAdd: number[] = [];
    const resAdd: SpinResult[] = [];
    let last: SpinResult | null = null;
    let stopped: StopReason = null;
    for (let i = 0; i < count; i++) {
      if (results.length + resAdd.length >= targetSpins) break;
      if (stopOnBust && bal <= 0) break;
      const next = spinOnce(bal, st, options);
      if (!next.result) break;
      st = next.state; bal = next.balance;
      histAdd.push(bal);
      resAdd.push(next.result);
      last = next.result;
      const reason = checkStopCondition(bal, startingBalance, options);
      if (reason) { stopped = reason; break; }
    }
    if (!resAdd.length) { setIsRunning(false); return false; }
    setBalance(bal);
    setStrategyState(st);
    setHistory(prev => [...prev, ...histAdd]);
    setResults(prev => [...prev, ...resAdd]);
    setLastResult(last);
    setFlashKey(k => k + 1);
    if (stopped) {
      setSessionStop(stopped);
      setIsRunning(false);
      return false;
    }
    if (results.length + resAdd.length >= targetSpins || (stopOnBust && bal <= 0)) {
      setIsRunning(false);
      return false;
    }
    return true;
  }, [balance, strategyState, results.length, targetSpins, options, stopOnBust, sessionStop, startingBalance]);

  React.useEffect(() => {
    if (!isRunning) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const step = (t: number) => {
      const dt = t - last; last = t;
      acc += (dt / 1400) * speed;
      const n = Math.min(2000, Math.floor(acc));
      if (n > 0) { acc -= n; if (!runBatch(n)) return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [isRunning, speed, runBatch]);

  const quickRun = (n: number) => runBatch(n);

  const singleSpin = () => {
    if (singleSpinTimer.current !== null) window.clearTimeout(singleSpinTimer.current);
    setSingleSpinning(true);
    runBatch(1);
    singleSpinTimer.current = window.setTimeout(() => {
      setSingleSpinning(false);
      singleSpinTimer.current = null;
    }, 1150);
  };

  React.useEffect(() => () => {
    if (singleSpinTimer.current !== null) window.clearTimeout(singleSpinTimer.current);
  }, []);

  const manualTotal = React.useMemo(
    () => manualBets.reduce((s, b) => s + b.amount, 0),
    [manualBets],
  );
  const strategyBase = betKind === "manual" ? (manualTotal || baseStake) : baseStake;
  React.useEffect(() => {
    setStrategyState(makeStrategyState(strategyBase));
  }, [strategyBase, progression]);

  const mcAbortRef = React.useRef<AbortController | null>(null);
  const computeMC = async () => {
    if (mcAbortRef.current) mcAbortRef.current.abort();
    const ac = new AbortController();
    mcAbortRef.current = ac;
    setMcRunning(true);
    setMcProgress(0);
    try {
      const res = await runMonteCarloInWorker({
        runs: mcRuns,
        iterations: mcIterations,
        starting: startingBalance,
        opts: options,
        seed: seedLock ? seed : undefined,
        onProgress: p => setMcProgress(p),
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      setMonteCarlo(res);
      setMcProgress(1);
    } catch (err) {
      if ((err as { name?: string }).name !== "AbortError") {
        console.error("Monte Carlo failed:", err);
      }
    } finally {
      if (mcAbortRef.current === ac) mcAbortRef.current = null;
      setMcRunning(false);
    }
  };
  const cancelMC = () => mcAbortRef.current?.abort();
  React.useEffect(() => () => { mcAbortRef.current?.abort(); }, []);

  const placeBet = (b: Bet) => setManualBets(prev => [...prev, b]);
  const clearBets = () => setManualBets([]);

  // ---------- config snapshot / apply (presets, share, import/export) ----------
  const buildConfig = React.useCallback((): AppConfig => ({
    v: 3, wheelType, progression, betKind, baseStake, straightNumber, tableMax,
    targetSpins, startingBalance, stopProfit, stopLoss, customRules, manualBets,
    mcRuns, mcIterations, seedLock, seed,
  }), [wheelType, progression, betKind, baseStake, straightNumber, tableMax, targetSpins,
    startingBalance, stopProfit, stopLoss, customRules, manualBets, mcRuns, mcIterations, seedLock, seed]);

  const applyConfig = React.useCallback((cfg: AppConfig) => {
    setIsRunning(false);
    setWheelType(cfg.wheelType);
    setProgression(cfg.progression);
    setBetKind(cfg.betKind);
    setBaseStake(cfg.baseStake);
    setStraightNumber(cfg.straightNumber);
    setTableMax(cfg.tableMax);
    setTargetSpins(cfg.targetSpins);
    setStopProfit(cfg.stopProfit);
    setStopLoss(cfg.stopLoss);
    setCustomRules(cfg.customRules);
    setManualBets(cfg.manualBets);
    setMcRuns(cfg.mcRuns);
    setMcIterations(cfg.mcIterations);
    setSeedLock(cfg.seedLock);
    setSeed(cfg.seed);
    setStartingBalance(cfg.startingBalance);
    setBalance(cfg.startingBalance);
    setHistory([cfg.startingBalance]);
    setResults([]);
    setLastResult(null);
    setSessionStop(null);
    setMonteCarlo(null);
    setMcProgress(0);
  }, []);

  // Load config from a share link once on mount.
  const sharedLoaded = React.useRef(false);
  React.useEffect(() => {
    if (sharedLoaded.current) return;
    sharedLoaded.current = true;
    const cfg = decodeShareHash(window.location.hash);
    if (cfg) {
      applyConfig(cfg);
      // Clean the hash so refreshes don't re-apply over user tweaks.
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, [applyConfig]);

  const compareSnapshot = React.useCallback(() => ({
    label: `${PROGRESSIONS.find(p => p.value === progression)?.label.split(" (")[0] ?? progression} / ${BET_OPTIONS.find(b => b.value === betKind)?.label ?? betKind}`,
    opts: { ...options, manualBets: [...manualBets] },
    starting: startingBalance,
  }), [options, manualBets, startingBalance, progression, betKind]);

  const balanceTone = balance >= startingBalance ? "positive" : "negative";
  const lastNumbers = results.slice(-18).reverse();

  const deferredHistory = React.useDeferredValue(history);
  const deferredResults = React.useDeferredValue(results);

  const [bankrollView, setBankrollView] = React.useState<BankrollView | null>(null);
  const sharedXRange = bankrollView ? { min: bankrollView.start, max: bankrollView.end } : null;

  const statusLine = sessionStop === "target"
    ? `Take-profit hit at spin ${results.length.toLocaleString()} — walked away ${fmtMoney(balance - startingBalance)} up`
    : sessionStop === "stoploss"
      ? `Stop-loss hit at spin ${results.length.toLocaleString()} — capped the damage at ${fmtMoney(balance - startingBalance)}`
      : summary.bustSpin
        ? `Busted at spin ${summary.bustSpin}`
        : isRunning ? "running…" : "paused";

  // ============================================================
  //  Render
  // ============================================================
  return (
    <div className="app-shell">
      <header className="appbar">
        <div className="brand">
          <FlaskConical size={18} className="brand-icon" />
          <span className="brand-name">Roulette Reality Check</span>
          <span className="brand-tag">LAB</span>
        </div>

        <div className="wheel-toggle" aria-label="Wheel type" title={`${wheelCopy.name} · ${wheelCopy.pockets} · house edge ${wheelCopy.edge}`}>
          <button className={wheelType === "european" ? "active" : ""} onClick={() => changeWheel("european")}>European</button>
          <button className={wheelType === "american" ? "active" : ""} onClick={() => changeWheel("american")}>American</button>
        </div>

        <nav className="tab-nav" aria-label="Workspace">
          {TABS.map(t => (
            <button key={t.value} className={tab === t.value ? "active" : ""} onClick={() => setTab(t.value)}>
              {t.icon}<span>{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="appbar-right">
          <div className={`bankroll-mini ${balanceTone}`} title="Current bankroll">
            <span className="bm-amount">{fmtMoney(balance)}</span>
            <span className="bm-delta">{balance >= startingBalance ? "+" : ""}{fmtMoney(balance - startingBalance)} · {fmtPct(summary.roi)}</span>
          </div>
          <button className="btn icon" onClick={() => setPresetsOpen(true)} title="Presets, share & export"><Save size={16} /></button>
          <button className="btn icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Toggle theme">
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className="btn icon sidebar-toggle" onClick={() => setSidebarOpen(v => !v)} title="Settings">
            {sidebarOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </header>

      <div className="workspace">
        {sidebarOpen && <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />}
        <aside className={`controls ${sidebarOpen ? "open" : ""}`}>
          <div className="panel">
            <div className="section-title"><CircleDollarSign size={14} /> Bankroll setup</div>
            <label className="field">
              <span className="label-row">Starting cash <Help>The money you sit down with. Reset is automatic when you change this.</Help></span>
              <input type="number" min={1} value={startingBalance} onChange={e => updateStarting(Number(e.target.value))} />
              <div className="chip-row">
                {BANKROLL_PRESETS.map(v => (
                  <button key={v} className={startingBalance === v ? "active" : ""} onClick={() => updateStarting(v)}>
                    ${v.toLocaleString()}
                  </button>
                ))}
              </div>
            </label>
            <label className="field" style={{ marginTop: 10 }}>
              <span className="label-row">Base stake <Help>The unit chip size used by every progression. Manual mode ignores this; use the chip selector on the table instead.</Help></span>
              <input type="number" min={1} value={baseStake}
                onChange={e => { const v = Math.max(1, Number(e.target.value)); setBaseStake(v); }} />
            </label>
            <label className="field" style={{ marginTop: 10 }}>
              <span className="label-row">Table maximum <Help>Casino-imposed cap on a single bet. Critical for Martingale-style systems: once capped, a win may not recover prior losses.</Help></span>
              <input type="number" min={1} value={tableMax} onChange={e => setTableMax(Math.max(1, Number(e.target.value)))} />
            </label>
            <label className="field" style={{ marginTop: 10 }}>
              <span className="label-row">Repetitions (target spins) <Help>How many spins to play before auto-stopping.</Help></span>
              <input type="number" min={1} value={targetSpins} onChange={e => setTargetSpins(Math.max(1, Number(e.target.value)))} />
            </label>
            <label className="field check-field" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={stopOnBust} onChange={e => setStopOnBust(e.target.checked)} />
              <span className="label-row" style={{ fontSize: 12 }}>Stop on bust <Help>If on, the simulation stops when the bankroll cannot cover the next stake.</Help></span>
            </label>
          </div>

          <div className="panel">
            <div className="section-title"><Target size={14} /> Session goals</div>
            <label className="field">
              <span className="label-row">Take-profit (+$) <Help>Walk away once the bankroll is this many dollars above the start. 0 = no target. Monte Carlo reports how often this target is reached before ruin.</Help></span>
              <input type="number" min={0} value={stopProfit} onChange={e => { setStopProfit(Math.max(0, Number(e.target.value))); setSessionStop(null); }} />
              <div className="chip-row">
                {[0.1, 0.25, 0.5, 1].map(f => (
                  <button key={f} className={stopProfit === Math.round(startingBalance * f) ? "active" : ""}
                    onClick={() => { setStopProfit(Math.round(startingBalance * f)); setSessionStop(null); }}>
                    +{Math.round(f * 100)}%
                  </button>
                ))}
                <button className={stopProfit === 0 ? "active" : ""} onClick={() => { setStopProfit(0); setSessionStop(null); }}>off</button>
              </div>
            </label>
            <label className="field" style={{ marginTop: 10 }}>
              <span className="label-row">Stop-loss (−$) <Help>Walk away once the bankroll is this many dollars below the start. 0 = play until bust or target.</Help></span>
              <input type="number" min={0} value={stopLoss} onChange={e => { setStopLoss(Math.max(0, Number(e.target.value))); setSessionStop(null); }} />
              <div className="chip-row">
                {[0.25, 0.5].map(f => (
                  <button key={f} className={stopLoss === Math.round(startingBalance * f) ? "active" : ""}
                    onClick={() => { setStopLoss(Math.round(startingBalance * f)); setSessionStop(null); }}>
                    −{Math.round(f * 100)}%
                  </button>
                ))}
                <button className={stopLoss === 0 ? "active" : ""} onClick={() => { setStopLoss(0); setSessionStop(null); }}>off</button>
              </div>
            </label>
            {(stopProfit > 0 || stopLoss > 0) && (
              <p className="wheel-sub" style={{ marginTop: 8 }}>
                {stopProfit > 0 && <>Quit at {fmtMoney(startingBalance + stopProfit)}. </>}
                {stopLoss > 0 && <>Bail at {fmtMoney(startingBalance - stopLoss)}.</>}
              </p>
            )}
          </div>

          <div className="panel">
            <div className="section-title"><Zap size={14} /> Strategy</div>
            <label className="field">
              <span className="label-row">Progression <Help>How the stake size changes from spin to spin. Flat keeps it constant; the others scale up after losses (or wins) to chase recovery. Pick Custom to build your own rules.</Help></span>
              <select value={progression} onChange={e => setProgression(e.target.value as Progression)}>
                {PROGRESSIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </label>
            <div className="strategy-note" style={{ marginTop: 8 }}>
              <strong>How {PROGRESSIONS.find(p => p.value === progression)!.label} works</strong>
              {PROGRESSIONS.find(p => p.value === progression)!.help}
            </div>

            {progression === "custom" && (
              <div className="custom-builder">
                <div className="cb-row">
                  <span className="cb-when bad">After a loss</span>
                  <select value={customRules.onLossAction}
                    onChange={e => setCustomRules(r => ({ ...r, onLossAction: e.target.value as CustomAction }))}>
                    {CUSTOM_ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                  {(customRules.onLossAction === "multiply" || customRules.onLossAction === "add") && (
                    <input type="number" min={0.1} step={0.1} value={customRules.onLossValue}
                      onChange={e => setCustomRules(r => ({ ...r, onLossValue: Math.max(0.1, Number(e.target.value)) }))} />
                  )}
                </div>
                <div className="cb-row">
                  <span className="cb-when good">After a win</span>
                  <select value={customRules.onWinAction}
                    onChange={e => setCustomRules(r => ({ ...r, onWinAction: e.target.value as CustomAction }))}>
                    {CUSTOM_ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                  {(customRules.onWinAction === "multiply" || customRules.onWinAction === "add") && (
                    <input type="number" min={0.1} step={0.1} value={customRules.onWinValue}
                      onChange={e => setCustomRules(r => ({ ...r, onWinValue: Math.max(0.1, Number(e.target.value)) }))} />
                  )}
                </div>
                <div className="cb-row">
                  <span className="cb-when">Stake cap <Help>Maximum stake as a multiple of the base stake. 0 = no cap (table max still applies).</Help></span>
                  <input type="number" min={0} value={customRules.maxUnits}
                    onChange={e => setCustomRules(r => ({ ...r, maxUnits: Math.max(0, Number(e.target.value)) }))} />
                  <span className="cb-unit">× base</span>
                </div>
                <div className="cb-row">
                  <span className="cb-when">Reset after <Help>Force the stake back to base after this many consecutive losses. 0 = never. A circuit-breaker against runaway doubling.</Help></span>
                  <input type="number" min={0} value={customRules.resetAfterLosses}
                    onChange={e => setCustomRules(r => ({ ...r, resetAfterLosses: Math.max(0, Number(e.target.value)) }))} />
                  <span className="cb-unit">losses</span>
                </div>
              </div>
            )}

            <label className="field" style={{ marginTop: 10 }}>
              <span className="label-row">Bet target <Help>What the progression bets on each spin. Straight numbers pay 35:1 but hit only one pocket. Manual lets you place chips on the casino table to define a custom layout.</Help></span>
              <select value={betKind} onChange={e => setBetKind(e.target.value as BetKind)}>
                {BET_OPTIONS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
              </select>
            </label>
            <div className="strategy-note" style={{ marginTop: 8 }}>
              <strong>
                {BET_OPTIONS.find(b => b.value === betKind)!.label}
                {betKind === "manual" ? "" : ` - ${getPayout(betKind)}:1`}
              </strong>
              {BET_OPTIONS.find(b => b.value === betKind)!.help}
              <em>
                {betKind === "manual"
                  ? `Place chips on the Play tab — those amounts are the bet unit. The progression multiplies every chip by the same factor each spin. House edge: -${wheelCopy.edge}`
                  : `Coverage: ${(coverageOf(betKind, wheelType) * 100).toFixed(2)}% of pockets - House edge: -${wheelCopy.edge}`}
              </em>
            </div>
            {betKind === "straight" && (
              <label className="field" style={{ marginTop: 8 }}>
                <span className="label-row">Straight pocket <Help>Pick a single pocket. American mode adds 00 as a separate green pocket.</Help></span>
                <select value={straightNumber} onChange={e => setStraightNumber(Number(e.target.value))}>
                  <option value={0}>0</option>
                  {wheelType === "american" && <option value={37}>00</option>}
                  {Array.from({ length: 36 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}

            <div className="edge-box" style={{ marginTop: 12 }}>
              <span className="label-line">{betKind === "manual" ? "Expected loss on current layout" : "Expected loss per base bet"}</span>
              <strong>{fmtMoney(expectedStake * expectedEdge)}</strong>
              <em>Every {wheelCopy.name.toLowerCase()} standard bet averages -{wheelCopy.edge} per unit staked, regardless of progression.</em>
            </div>
          </div>

          <div className="panel">
            <div className="section-title"><Dice5 size={14} /> Reproducibility</div>
            <label className="field check-field">
              <input type="checkbox" checked={seedLock} onChange={e => setSeedLock(e.target.checked)} />
              <span className="label-row" style={{ fontSize: 12 }}>Lock random seed <Help>With the seed locked, Reset replays the exact same spin sequence, and Monte Carlo / Compare runs become reproducible. Comparisons always share one seed so every strategy faces identical luck.</Help></span>
            </label>
            {seedLock && (
              <div className="seed-row">
                <input type="number" min={0} value={seed} onChange={e => setSeed(Math.max(0, Math.floor(Number(e.target.value))))} />
                <button className="btn" onClick={() => setSeed((Math.random() * 2 ** 31) | 0)} title="New random seed"><Dice5 size={14} /></button>
              </div>
            )}
          </div>
        </aside>

        <section className="sim-column">
          {tab === "play" && (
            <>
              <div className="panel">
                <div className="sim-topline">
                  <div>
                    <span className="eyebrow"><Gauge size={14} /> Spin engine</span>
                    <h2>{results.length.toLocaleString()} / {targetSpins.toLocaleString()} spins</h2>
                    <span className={`progress-mini ${sessionStop === "target" ? "good" : sessionStop ? "bad" : ""}`}>{statusLine}</span>
                  </div>
                  <div className="action-row">
                    <button className="btn primary" onClick={() => setIsRunning(v => !v)} disabled={!!sessionStop} title={isRunning ? "Pause" : "Run continuously"}>
                      {isRunning ? <><Pause size={16} /> Pause</> : <><Play size={16} /> Run</>}
                    </button>
                    <button className="btn" onClick={singleSpin} disabled={isRunning || singleSpinning || !!sessionStop} title="Single spin">
                      <ChevronRight size={16} /> Spin
                    </button>
                    <button className="btn icon" onClick={reset} title="Reset bankroll & history"><RotateCcw size={16} /></button>
                  </div>
                </div>

                <div className="wheel-shell">
                  <RouletteWheel result={lastResult} spinning={isRunning || singleSpinning} wheelType={wheelType} />
                  <div className="wheel-info">
                    <div className="last-result">
                      <span
                        key={flashKey}
                        className={`result-chip ${lastResult ? getNumberColor(lastResult.number) : ""} ${lastResult ? "flash" : ""}`}
                      >
                        {lastResult ? pocketLabel(lastResult.number) : "-"}
                      </span>
                      <div>
                        <strong>{lastResult ? (lastResult.won ? "Win" : "Loss") : "Ready"}</strong>
                        <span>
                          {lastResult
                            ? `${lastResult.profit >= 0 ? "+" : ""}${fmtMoney(lastResult.profit)} on ${fmtMoney(lastResult.stake)} stake`
                            : `${wheelCopy.name} - ${wheelCopy.pockets}`}
                        </span>
                      </div>
                    </div>

                    <div>
                      <div className="mini-label">Last 18 outcomes</div>
                      <div className="last-numbers">
                        {lastNumbers.length ? lastNumbers.map((r, i) => (
                          <div key={i} className={`ln ${getNumberColor(r.number)}`}>{pocketLabel(r.number)}</div>
                        )) : <span style={{ color: "var(--muted)", fontSize: 12 }}>No spins yet.</span>}
                      </div>
                    </div>

                    <div className="speed-row">
                      <span className="label">Speed</span>
                      <Help>Spins per second multiplier. Higher speeds batch spins per frame for throughput.</Help>
                      <div className="speed-grid">
                        {SPEEDS.map(v => (
                          <button key={v} className={speed === v ? "active" : ""} onClick={() => setSpeed(v)}>{v}x</button>
                        ))}
                      </div>
                    </div>

                    <div className="action-row">
                      <span className="mini-label" style={{ marginBottom: 0 }}>Quick run</span>
                      <Help>Run a fixed batch of spins instantly without animation.</Help>
                      {[10, 100, 1000, 5000, 10000].map(n => (
                        <button key={n} className="btn" onClick={() => quickRun(n)} disabled={isRunning || !!sessionStop}>+{n.toLocaleString()}</button>
                      ))}
                    </div>
                  </div>
                </div>

                {betKind === "manual" && (
                  <CasinoTable bets={manualBets} chipSize={chipSize} setChipSize={setChipSize} onPlace={placeBet} onClear={clearBets} wheelType={wheelType} />
                )}
              </div>

              <div className="panel">
                <div className="chart-header">
                  <div>
                    <span className="eyebrow"><LineChart size={14} /> Bankroll evolution</span>
                    <h2>Money over iterations</h2>
                  </div>
                  <div className="action-row">
                    <div className="mode-tabs">
                      {([
                        ["money", "Raw $"],
                        ["profit", "Profit"],
                        ["percent", "% of start"],
                        ["drawdown", "Drawdown"],
                        ["stake", "Stake size"],
                      ] as [ChartMode, string][]).map(([v, l]) => (
                        <button key={v} className={chartMode === v ? "active" : ""} onClick={() => setChartMode(v)}>{l}</button>
                      ))}
                    </div>
                    <button className="btn icon" onClick={() => downloadSessionCsv(results, startingBalance)}
                      disabled={!results.length} title="Export session as CSV">
                      <Download size={14} />
                    </button>
                  </div>
                </div>
                <BankrollChart
                  history={deferredHistory}
                  results={deferredResults}
                  mode={chartMode}
                  startingBalance={startingBalance}
                  view={bankrollView}
                  onViewChange={setBankrollView}
                />

                <div className="summary-grid">
                  <Metric label="Ending bankroll" value={fmtMoney(summary.endingBalance)} tone={summary.profit >= 0 ? "good" : "bad"} />
                  <Metric label="Profit / loss" value={fmtMoney(summary.profit)} tone={summary.profit >= 0 ? "good" : "bad"} />
                  <Metric label="ROI" value={fmtPct(summary.roi)} tone={summary.roi >= 0 ? "good" : "bad"} />
                  <Metric label="Max drawdown" value={fmtMoney(summary.maxDrawdown)} tone="bad" />
                  <Metric label="Lowest balance" value={fmtMoney(summary.lowestBalance)} tone={summary.lowestBalance > 0 ? undefined : "bad"} />
                  <Metric label="Peak balance" value={fmtMoney(summary.maxBalance)} tone="good" />
                  <Metric label="Hit rate" value={`${summary.hitRate.toFixed(1)}%`} sub={`${summary.spins} spins`} />
                  <Metric label="Avg / spin" value={fmtMoney(summary.avgChangePerSpin)} tone={summary.avgChangePerSpin >= 0 ? "good" : "bad"} />
                  <Metric label="Avg stake" value={fmtMoney(summary.avgStake)} sub={`total staked ${fmtMoney(summary.totalStaked)}`} />
                  <Metric label="Longest streaks" value={`${summary.longestWinStreak}W / ${summary.longestLossStreak}L`} />
                  <Metric label="Std dev / spin" value={fmtMoney(summary.stdDev)} />
                  <Metric label="Ruin spin" value={summary.bustSpin ? `#${summary.bustSpin.toLocaleString()}` : "-"} tone={summary.bustSpin ? "bad" : "good"} />
                </div>
              </div>

              <div className="footer-note">
                <strong>Why this exists.</strong> European roulette has a flat house edge of 1/37 ~= 2.70%;
                American double-zero roulette has 2/38 ~= 5.26%. Doubling-up systems trade many tiny wins
                for rare catastrophic losses; gentler systems trade fast ruin for slow erosion. The math
                does not change.
              </div>
            </>
          )}

          {tab === "monte" && (
            <div className="panel">
              <div className="chart-header">
                <div>
                  <span className="eyebrow"><BarChart3 size={14} /> Monte Carlo - multi-run analysis</span>
                  <h2>Average ruin & ending outcomes</h2>
                </div>
                <div className="action-row">
                  <label className="field" style={{ width: 110 }}>
                    <span className="label-row" style={{ fontSize: 11 }}>Runs <Help>Number of independent simulations to play.</Help></span>
                    <input type="number" min={10} max={20000} value={mcRuns} onChange={e => setMcRuns(Math.max(10, Number(e.target.value)))} />
                  </label>
                  <label className="field" style={{ width: 130 }}>
                    <span className="label-row" style={{ fontSize: 11 }}>Spins / run <Help>How long each simulated session lasts. If the bankroll busts before this many spins, the run ends early and is counted as ruin.</Help></span>
                    <input type="number" min={10} max={50000} value={mcIterations} onChange={e => setMcIterations(Math.max(10, Number(e.target.value)))} />
                  </label>
                  <button className="btn primary" onClick={computeMC} disabled={mcRunning}>
                    <Activity size={14} /> {mcRunning ? "Running..." : "Run analysis"}
                  </button>
                  {mcRunning && (
                    <button className="btn danger" onClick={cancelMC} title="Cancel running analysis">
                      Cancel
                    </button>
                  )}
                  <button className="btn icon" onClick={() => monteCarlo && downloadMcCsv(monteCarlo)} disabled={!monteCarlo} title="Export Monte Carlo results as CSV">
                    <Download size={14} />
                  </button>
                </div>
              </div>
              {mcRunning || mcProgress > 0 ? (
                <div className="mc-progress"><div style={{ width: `${mcProgress * 100}%` }} /></div>
              ) : null}

              {(stopProfit > 0 || stopLoss > 0) && (
                <p className="insight-sub" style={{ marginBottom: 10 }}>
                  Session goals are active: runs walk away at {stopProfit > 0 ? `+${fmtMoney(stopProfit)}` : "no target"}
                  {" / "}{stopLoss > 0 ? `−${fmtMoney(stopLoss)} stop-loss` : "no stop-loss"}. Goal stats appear below.
                </p>
              )}

              <div className="mode-tabs" style={{ marginBottom: 10 }}>
                {([
                  ["ruin", "Spins until ruin"],
                  ["survival", "Survival curve"],
                  ["final", "Final bankroll"],
                  ["fan", "Bankroll fan"],
                ] as [McChartMode, string][]).map(([v, l]) => (
                  <button key={v} className={mcChartMode === v ? "active" : ""} onClick={() => setMcChartMode(v)}>{l}</button>
                ))}
                <Help>
                  <strong>Spins until ruin:</strong> histogram of how long busted runs lasted.
                  <br /><strong>Survival curve:</strong> % of runs still solvent at each spin.
                  <br /><strong>Final bankroll:</strong> distribution of where every run ended.
                  <br /><strong>Bankroll fan:</strong> p10/p25/median/p75/p90 bands at each checkpoint.
                </Help>
              </div>

              <div className="analytics-grid">
                <div>
                  {mcChartMode === "ruin" && (
                    <HistogramChart
                      data={monteCarlo?.ruinHistogram ?? { labels: [], counts: [] }}
                      xLabel="Spins until ruin"
                      yLabel="# of busted runs"
                    />
                  )}
                  {mcChartMode === "survival" && (
                    <SurvivalChart
                      spins={monteCarlo?.survival.spins ?? []}
                      alive={monteCarlo?.survival.alive ?? []}
                      xRange={sharedXRange}
                    />
                  )}
                  {mcChartMode === "final" && (
                    <HistogramChart
                      data={monteCarlo?.finalHistogram ?? { labels: [], counts: [] }}
                      color="#4cc9f0"
                      xLabel="Final bankroll ($)"
                      yLabel="# of runs"
                    />
                  )}
                  {mcChartMode === "fan" && monteCarlo && (
                    <FanChart
                      spins={monteCarlo.fan.spins}
                      p1={monteCarlo.fan.p1}
                      p10={monteCarlo.fan.p10}
                      p25={monteCarlo.fan.p25}
                      p50={monteCarlo.fan.p50}
                      p75={monteCarlo.fan.p75}
                      p90={monteCarlo.fan.p90}
                      p99={monteCarlo.fan.p99}
                      mean={monteCarlo.fan.mean}
                      startingBalance={monteCarlo.startingBalance}
                      xRange={sharedXRange}
                    />
                  )}
                  {mcChartMode === "fan" && !monteCarlo && (
                    <FanChart spins={[]} p1={[]} p10={[]} p25={[]} p50={[]} p75={[]} p90={[]} p99={[]} mean={[]} startingBalance={startingBalance} xRange={null} />
                  )}
                </div>
                <div>
                  {monteCarlo ? (
                    <div className="summary-grid" style={{ marginTop: 0 }}>
                      <Metric label="Ruin probability" value={`${monteCarlo.ruinRate.toFixed(1)}%`} tone="bad" />
                      <Metric label="Avg spins to ruin" value={monteCarlo.avgRuinSpin ? monteCarlo.avgRuinSpin.toFixed(0) : "-"} sub={`median ${monteCarlo.medianRuinSpin ?? "-"}`} />
                      <Metric label="Profitable runs" value={`${monteCarlo.profitableRate.toFixed(1)}%`} tone={monteCarlo.profitableRate >= 50 ? "good" : "bad"} />
                      {monteCarlo.targetHitRate !== null && (
                        <Metric label="Hit take-profit" value={`${monteCarlo.targetHitRate.toFixed(1)}%`} tone={monteCarlo.targetHitRate >= 50 ? "good" : "bad"}
                          sub={monteCarlo.avgSpinsToTarget ? `avg ${monteCarlo.avgSpinsToTarget.toFixed(0)} spins (median ${monteCarlo.medianSpinsToTarget})` : undefined} />
                      )}
                      {monteCarlo.stopLossRate !== null && (
                        <Metric label="Stopped out" value={`${monteCarlo.stopLossRate.toFixed(1)}%`} tone="bad" sub="hit the stop-loss" />
                      )}
                      <Metric label="Avg final" value={fmtMoney(monteCarlo.avgEnding)} tone={monteCarlo.avgEnding >= startingBalance ? "good" : "bad"} />
                      <Metric label="Median final" value={fmtMoney(monteCarlo.medianEnding)} />
                      <Metric label="Best / worst" value={`${fmtMoney(monteCarlo.bestEnding)} / ${fmtMoney(monteCarlo.worstEnding)}`} />
                      <Metric label="Avg $ / spin" value={fmtMoney(monteCarlo.avgChangePerSpin)} tone={monteCarlo.avgChangePerSpin >= 0 ? "good" : "bad"} />
                      <Metric label="Realized edge" value={fmtPct(monteCarlo.realizedEdge * 100)} tone={monteCarlo.realizedEdge >= 0 ? "good" : "bad"} sub={`target ~= -${wheelCopy.edge}`} />
                      <Metric label="Trials x spins" value={`${monteCarlo.runs.toLocaleString()} x ${monteCarlo.iterations.toLocaleString()}`} />
                    </div>
                  ) : (
                    <p className="empty-state">
                      Run a Monte Carlo to estimate how often this exact setup reaches ruin and where the bankroll
                      typically finishes after many independent sessions. Set a take-profit / stop-loss in the
                      sidebar to also measure the probability of walking away a winner.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Compare stays mounted so queued candidates and results survive tab switches. */}
          <div style={{ display: tab === "compare" ? "contents" : "none" }}>
            <ComparePanel
              snapshot={compareSnapshot}
              mcRuns={mcRuns}
              mcIterations={mcIterations}
              seedLock={seedLock}
              seed={seed}
            />
          </div>

          {tab === "insights" && (
            <InsightsPanel results={results} wheelType={wheelType} betKind={betKind} />
          )}
        </section>
      </div>

      {presetsOpen && (
        <PresetsModal
          onClose={() => setPresetsOpen(false)}
          buildConfig={buildConfig}
          applyConfig={applyConfig}
        />
      )}
    </div>
  );
}

// ============================================================
//  Presets / share / import-export modal
// ============================================================
function PresetsModal({ onClose, buildConfig, applyConfig }: {
  onClose: () => void;
  buildConfig: () => AppConfig;
  applyConfig: (cfg: AppConfig) => void;
}) {
  const [presets, setPresets] = React.useState<Preset[]>(() => listPresets());
  const [name, setName] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const save = () => {
    const n = name.trim() || `Preset ${new Date().toLocaleString()}`;
    setPresets(savePreset(n, buildConfig()));
    setName("");
  };

  const share = async () => {
    const url = window.location.origin + window.location.pathname + encodeShareHash(buildConfig());
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this link:", url);
    }
  };

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const cfg = await readConfigFile(f);
    if (cfg) { applyConfig(cfg); onClose(); }
    else window.alert("That file doesn't look like a Roulette Lab config.");
    e.target.value = "";
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Presets and sharing" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3><Save size={16} /> Presets & sharing</h3>
          <button className="btn icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-section">
          <div className="seed-row">
            <input type="text" placeholder="Name this setup…" value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") save(); }} />
            <button className="btn primary" onClick={save}><Plus size={14} /> Save</button>
          </div>
        </div>

        {presets.length > 0 && (
          <div className="modal-section preset-list">
            {presets.map(p => (
              <div className="preset-row" key={p.name}>
                <button className="preset-load" onClick={() => { const c = sanitizeConfig(p.config); if (c) { applyConfig(c); onClose(); } }} title="Load preset">
                  <strong>{p.name}</strong>
                  <span>{new Date(p.savedAt).toLocaleDateString()}</span>
                </button>
                <button className="btn icon" onClick={() => setPresets(deletePreset(p.name))} title="Delete preset">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="modal-section action-row">
          <button className="btn" onClick={share}><Link2 size={14} /> {copied ? "Link copied!" : "Copy share link"}</button>
          <button className="btn" onClick={() => exportConfigFile(buildConfig())}><Download size={14} /> Export JSON</button>
          <button className="btn" onClick={() => fileRef.current?.click()}><Upload size={14} /> Import JSON</button>
          <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={onImport} />
        </div>
        <p className="insight-sub" style={{ margin: "0 0 4px" }}>
          Share links encode the full setup (strategy, bankroll, goals, seed) in the URL — anyone opening the link
          gets your exact configuration. Presets are stored in this browser only.
        </p>
      </div>
    </div>,
    document.body,
  );
}

function Metric({ label, value, tone, sub }: { label: string; value: string; tone?: "good" | "bad"; sub?: string }) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <div className="m-label">{label}</div>
      <div className="m-value">{value}</div>
      {sub ? <div className="m-sub">{sub}</div> : null}
    </div>
  );
}
