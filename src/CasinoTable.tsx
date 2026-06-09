import React from "react";
import { type Bet, type BetKind, type WheelType, REDS, ZERO_DOUBLE, pocketLabel } from "./engine";

interface Props {
  bets: Bet[];
  chipSize: number;
  setChipSize: (v: number) => void;
  onPlace: (bet: Bet) => void;
  onClear: () => void;
  wheelType: WheelType;
}

const CHIPS = [5, 10, 25, 100, 500, 1000];

// 12 columns × 3 rows: top row 3,6,9,...,36; mid row 2,5,...,35; bottom row 1,4,...,34
function buildGrid(): number[][] {
  const top: number[] = [], mid: number[] = [], bot: number[] = [];
  for (let c = 0; c < 12; c++) {
    top.push(3 + c * 3);
    mid.push(2 + c * 3);
    bot.push(1 + c * 3);
  }
  return [top, mid, bot];
}
const GRID = buildGrid();

function totalsByKey(bets: Bet[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of bets) {
    const k = b.kind === "straight" ? `straight:${b.number}` : b.kind;
    m.set(k, (m.get(k) ?? 0) + b.amount);
  }
  return m;
}

export function CasinoTable({ bets, chipSize, setChipSize, onPlace, onClear, wheelType }: Props) {
  const totals = React.useMemo(() => totalsByKey(bets), [bets]);
  const sumStake = bets.reduce((s, b) => s + b.amount, 0);

  const place = (kind: BetKind, number?: number) => onPlace({ kind, amount: chipSize, number });

  const cell = (n: number) => {
    const key = `straight:${n}`;
    const stake = totals.get(key);
    const color = n === 0 ? "zero" : REDS.has(n) ? "red" : "black";
    return (
      <div key={n} className={`cell ${color}`} onClick={() => place("straight", n)} title={`Straight ${n} — pays 35:1`}>
        {n}
        {stake ? <div className="chip-stack">${stake}</div> : null}
      </div>
    );
  };
  const outsideCell = (label: string, kind: BetKind, hint: string) => {
    const stake = totals.get(kind);
    const colorCls = kind === "red" ? "red" : kind === "black" ? "black" : "outside";
    return (
      <div className={`cell ${colorCls}`} onClick={() => place(kind)} title={hint}>
        {label}
        {stake ? <div className="chip-stack">${stake}</div> : null}
      </div>
    );
  };

  return (
    <div>
      <div className="casino-table">
        <div className="numbers-wrap">
          {/* zeros span full height on left — 0 always; 00 only on American */}
          <div className="zero-stack">
            <div className="cell zero" onClick={() => place("straight", 0)} title="Straight 0 — pays 35:1">
              0
              {totals.get("straight:0") ? <div className="chip-stack">${totals.get("straight:0")}</div> : null}
            </div>
            {wheelType === "american" && (
              <div className="cell zero" onClick={() => place("straight", ZERO_DOUBLE)} title="Straight 00 — pays 35:1">
                {pocketLabel(ZERO_DOUBLE)}
                {totals.get(`straight:${ZERO_DOUBLE}`) ? <div className="chip-stack">${totals.get(`straight:${ZERO_DOUBLE}`)}</div> : null}
              </div>
            )}
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
            <div className="numbers-grid">
              {GRID[0].map(cell)}
              {GRID[1].map(cell)}
              {GRID[2].map(cell)}
            </div>
          </div>
          <div className="column-bets">
            {outsideCell("2:1", "column3", "Column 3 (top row, 3,6...36) — pays 2:1")}
            {outsideCell("2:1", "column2", "Column 2 (middle row, 2,5...35) — pays 2:1")}
            {outsideCell("2:1", "column1", "Column 1 (bottom row, 1,4...34) — pays 2:1")}
          </div>
        </div>
        <div className="dozen-row">
          {outsideCell("1st 12", "dozen1", "Dozen 1 (1-12) — pays 2:1")}
          {outsideCell("2nd 12", "dozen2", "Dozen 2 (13-24) — pays 2:1")}
          {outsideCell("3rd 12", "dozen3", "Dozen 3 (25-36) — pays 2:1")}
        </div>
        <div className="outside-row">
          {outsideCell("1-18", "low", "Low (1-18) — pays 1:1")}
          {outsideCell("Even", "even", "Even — pays 1:1 (zero loses)")}
          {outsideCell("Red", "red", "Red — pays 1:1")}
          {outsideCell("Black", "black", "Black — pays 1:1")}
          {outsideCell("Odd", "odd", "Odd — pays 1:1")}
          {outsideCell("19-36", "high", "High (19-36) — pays 1:1")}
        </div>
      </div>
      <div className="bet-summary">
        <div>
          <strong>Total stake: ${sumStake.toFixed(0)}</strong>
          <span style={{ marginLeft: 8 }}>{bets.length} chip placement(s)</span>
        </div>
        <div className="chip-selector">
          <span className="label">Chip:</span>
          {CHIPS.map(c => (
            <button
              key={c}
              className={`chip-btn c${c} ${chipSize === c ? "active" : ""}`}
              onClick={() => setChipSize(c)}
              title={`Set chip size to $${c}`}
            >
              {c >= 1000 ? `${c / 1000}K` : c}
            </button>
          ))}
          <button className="btn danger" style={{ marginLeft: 8 }} onClick={onClear}>Clear bets</button>
        </div>
      </div>
    </div>
  );
}
