// ============================================================
//  Presets, share links, and config import/export
// ============================================================
import type { Bet, BetKind, CustomRules, Progression, WheelType } from "./engine";
import { DEFAULT_CUSTOM_RULES } from "./engine";

export interface AppConfig {
  v: 3;
  wheelType: WheelType;
  progression: Progression;
  betKind: BetKind;
  baseStake: number;
  straightNumber: number;
  tableMax: number;
  targetSpins: number;
  startingBalance: number;
  stopProfit: number;
  stopLoss: number;
  customRules: CustomRules;
  manualBets: Bet[];
  mcRuns: number;
  mcIterations: number;
  seedLock: boolean;
  seed: number;
}

export interface Preset { name: string; savedAt: number; config: AppConfig; }

const LS_KEY = "roulette-lab.presets.v3";
const LS_THEME = "roulette-lab.theme";

// ---------- validation ----------
const PROGRESSIONS_SET = new Set(["flat", "martingale", "reverse-martingale", "dalembert", "fibonacci", "oscars", "labouchere", "custom"]);
const BETS_SET = new Set(["red", "black", "even", "odd", "low", "high", "dozen1", "dozen2", "dozen3", "column1", "column2", "column3", "straight", "manual"]);

function num(v: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function sanitizeConfig(raw: unknown): AppConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const cr = (o.customRules ?? {}) as Record<string, unknown>;
  const actions = new Set(["multiply", "add", "reset", "keep"]);
  try {
    return {
      v: 3,
      wheelType: o.wheelType === "american" ? "american" : "european",
      progression: PROGRESSIONS_SET.has(String(o.progression)) ? (o.progression as Progression) : "martingale",
      betKind: BETS_SET.has(String(o.betKind)) ? (o.betKind as BetKind) : "red",
      baseStake: num(o.baseStake, 100, 1),
      straightNumber: num(o.straightNumber, 17, 0, 37),
      tableMax: num(o.tableMax, 5000, 1),
      targetSpins: num(o.targetSpins, 10000, 1, 1_000_000),
      startingBalance: num(o.startingBalance, 10000, 1),
      stopProfit: num(o.stopProfit, 0, 0),
      stopLoss: num(o.stopLoss, 0, 0),
      customRules: {
        onLossAction: actions.has(String(cr.onLossAction)) ? (cr.onLossAction as CustomRules["onLossAction"]) : DEFAULT_CUSTOM_RULES.onLossAction,
        onLossValue: num(cr.onLossValue, DEFAULT_CUSTOM_RULES.onLossValue, 0.1, 100),
        onWinAction: actions.has(String(cr.onWinAction)) ? (cr.onWinAction as CustomRules["onWinAction"]) : DEFAULT_CUSTOM_RULES.onWinAction,
        onWinValue: num(cr.onWinValue, DEFAULT_CUSTOM_RULES.onWinValue, 0.1, 100),
        maxUnits: num(cr.maxUnits, 0, 0, 100000),
        resetAfterLosses: num(cr.resetAfterLosses, 0, 0, 1000),
      },
      manualBets: Array.isArray(o.manualBets)
        ? (o.manualBets as Bet[]).filter(b => b && BETS_SET.has(String(b.kind)) && Number.isFinite(Number(b.amount))).slice(0, 200)
        : [],
      mcRuns: num(o.mcRuns, 2000, 10, 20000),
      mcIterations: num(o.mcIterations, 10000, 10, 50000),
      seedLock: !!o.seedLock,
      seed: num(o.seed, 12345, 0, 2 ** 31),
    };
  } catch {
    return null;
  }
}

// ---------- localStorage presets ----------
export function listPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(p => p && p.name && p.config) : [];
  } catch { return []; }
}

export function savePreset(name: string, config: AppConfig): Preset[] {
  const presets = listPresets().filter(p => p.name !== name);
  presets.unshift({ name, savedAt: Date.now(), config });
  try { localStorage.setItem(LS_KEY, JSON.stringify(presets.slice(0, 30))); } catch { /* full */ }
  return listPresets();
}

export function deletePreset(name: string): Preset[] {
  const presets = listPresets().filter(p => p.name !== name);
  try { localStorage.setItem(LS_KEY, JSON.stringify(presets)); } catch { /* ignore */ }
  return presets;
}

// ---------- theme ----------
export type Theme = "dark" | "light";
export function loadTheme(): Theme {
  try { return localStorage.getItem(LS_THEME) === "light" ? "light" : "dark"; } catch { return "dark"; }
}
export function storeTheme(t: Theme) {
  try { localStorage.setItem(LS_THEME, t); } catch { /* ignore */ }
}

// ---------- share links ----------
export function encodeShareHash(config: AppConfig): string {
  const json = JSON.stringify(config);
  return "#cfg=" + btoa(unescape(encodeURIComponent(json)));
}

export function decodeShareHash(hash: string): AppConfig | null {
  const m = hash.match(/#cfg=([A-Za-z0-9+/=]+)/);
  if (!m) return null;
  try {
    const json = decodeURIComponent(escape(atob(m[1])));
    return sanitizeConfig(JSON.parse(json));
  } catch { return null; }
}

// ---------- file download / upload ----------
export function downloadText(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function exportConfigFile(config: AppConfig) {
  downloadText("roulette-lab-config.json", JSON.stringify(config, null, 2), "application/json");
}

export function readConfigFile(file: File): Promise<AppConfig | null> {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => {
      try { resolve(sanitizeConfig(JSON.parse(String(reader.result)))); }
      catch { resolve(null); }
    };
    reader.onerror = () => resolve(null);
    reader.readAsText(file);
  });
}
