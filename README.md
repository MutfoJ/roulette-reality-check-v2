# Roulette Reality Check V2 — Strategy Lab

**Live demo:** [roulette-reality-check-v2.vercel.app](https://roulette-reality-check-v2.vercel.app)

> A browser-based roulette lab for stress-testing betting systems, bankroll risk, and the house edge — now with strategy comparison, session goals, a custom progression builder, and deep session insights.

**Predecessor:** [roulette-reality-check](https://github.com/MutfoJ/roulette-reality-check) — V2 is a ground-up layout rebuild on the same engine, kept as a separate project for testing.

![Built with React](https://img.shields.io/badge/React-18-61dafb?logo=react)
![Vite](https://img.shields.io/badge/Vite-5-646cff?logo=vite)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript)
![Deployed on Vercel](https://img.shields.io/badge/Vercel-deployed-black?logo=vercel)

Pick a European or American wheel, choose a classic progression — or build your own — set bankroll, table limits and session goals, then watch the system play out with live charts, Monte Carlo analysis, side-by-side strategy comparison, and statistical insights.

The point is not to find a magic progression. It is to make the tradeoff visible: strategies reshape variance, streaks, and ruin timing, but they do not remove the negative expected return.

## What's new in V2

- **Reworked layout.** App bar with four workspaces — **Play**, **Monte Carlo**, **Compare**, **Insights** — a collapsible settings sidebar (drawer on mobile), and a light/dark theme toggle. Fully responsive.
- **Session goals.** Take-profit and stop-loss targets end a session automatically; Monte Carlo then reports the probability of walking away a winner, average spins to target, and stop-out rate.
- **Custom strategy builder.** Define your own progression: what happens to the stake after a loss and after a win (multiply / add units / reset / keep), a stake cap, and a circuit-breaker reset after N consecutive losses.
- **Strategy comparison.** Queue up to six setups and run them through identical Monte Carlo batches — same seed, same luck — with overlaid survival curves, median bankroll paths, and a results table.
- **Session insights.** Pocket heatmap (hot/cold vs expectation), red/black–odd/even–high/low distribution checks, win/loss streak anatomy, and a measured gambler's-fallacy table: your actual win rate after N straight losses next to the constant true probability.
- **Presets & sharing.** Save named setups locally, export/import JSON configs, or copy a share link that encodes the whole configuration in the URL.
- **Reproducibility.** Lock the RNG seed to replay identical sessions and make Monte Carlo runs repeatable.
- **CSV export.** Download the full spin-by-spin session or the Monte Carlo summary (including fan-chart percentiles and the survival curve).

## Carried over from V1

- European single-zero (37 pockets, edge `1/37 ≈ 2.70%`) and American double-zero (38 pockets, edge `2/38 ≈ 5.26%`) wheels with correct renders and math; `00` is pocket `37` internally.
- Flat, Martingale, Reverse Martingale (Paroli), D'Alembert, Fibonacci, Oscar's Grind, and Labouchère progressions with in-app explanations.
- Live animated spin engine with speed presets, quick-run batches, and stop-on-bust.
- Manual casino-table mode: place chips on numbers, zeros, columns, dozens, red/black, odd/even, high/low; the chosen progression scales the whole layout.
- Bankroll chart modes (raw $, profit, % return, drawdown, stake size) with drag-to-zoom, plus Monte Carlo ruin histogram, survival curve, final-bankroll distribution, and percentile fan chart — computed in a Web Worker.

## Architecture

```text
src/
|-- engine.ts        Pure simulation engine: PRNG (seedable), wheel modes,
|                    bet evaluation, progressions + custom rules,
|                    stop conditions, Monte Carlo kernel.
|-- mc.worker.ts     Web Worker wrapper around the MC kernel.
|-- mcClient.ts      Promise/AbortSignal client for the worker.
|-- App.tsx          App shell: app bar, tabs, sidebar, Play + Monte Carlo.
|-- Compare.tsx      Multi-strategy comparison with overlaid uPlot charts.
|-- Insights.tsx     Heatmap, distribution checks, streaks, fallacy table.
|-- presets.ts       Presets, share-link encoding, JSON import/export, theme.
|-- exports.ts       CSV exports (session + Monte Carlo).
|-- Wheel.tsx        SVG European/American wheel and ball orbit.
|-- CasinoTable.tsx  Manual-mode casino felt with 0/00 support.
|-- Chart.tsx        Bankroll canvas chart + uPlot MC charts.
`-- styles.css       Hand-rolled styling, dark + light themes, no UI framework.
```

## Local development

```bash
npm install
npm run dev      # http://localhost:5173
npm run test     # vitest (engine + V2 feature tests)
npm run build    # outputs to dist/
```

## The math

Every standard roulette bet carries the wheel's house edge: expected player return is `-1/37 ≈ -2.70%` (European) or `-2/38 ≈ -5.26%` (American) per unit staked. Progressions — including anything you build in the custom builder — change variance, bet sizing, streak behavior, and ruin timing. They do not change the expected return per dollar wagered. The Compare tab makes this concrete: every system's realized edge converges to the wheel's edge; only the shape of the outcome distribution differs.

## License

MIT
