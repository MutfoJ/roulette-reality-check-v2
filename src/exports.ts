// ============================================================
//  CSV exports — session history and Monte Carlo results
// ============================================================
import { pocketLabel, type MonteCarloSummary, type SpinResult } from "./engine";
import { downloadText } from "./presets";

export function sessionToCsv(results: SpinResult[], startingBalance: number): string {
  const rows = ["spin,pocket,color_won,stake,profit,balance"];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    rows.push(`${i + 1},${pocketLabel(r.number)},${r.won ? "win" : "loss"},${r.stake},${r.profit},${r.balance}`);
  }
  return `# Roulette Lab session export — starting bankroll ${startingBalance}\n` + rows.join("\n");
}

export function mcToCsv(mc: MonteCarloSummary): string {
  const head = [
    "metric,value",
    `runs,${mc.runs}`,
    `spins_per_run,${mc.iterations}`,
    `ruin_rate_pct,${mc.ruinRate.toFixed(3)}`,
    `avg_ruin_spin,${mc.avgRuinSpin ?? ""}`,
    `median_ruin_spin,${mc.medianRuinSpin ?? ""}`,
    `profitable_rate_pct,${mc.profitableRate.toFixed(3)}`,
    `avg_final,${mc.avgEnding.toFixed(2)}`,
    `median_final,${mc.medianEnding.toFixed(2)}`,
    `best_final,${mc.bestEnding.toFixed(2)}`,
    `worst_final,${mc.worstEnding.toFixed(2)}`,
    `avg_change_per_spin,${mc.avgChangePerSpin.toFixed(4)}`,
    `realized_edge,${mc.realizedEdge.toFixed(6)}`,
    `target_hit_rate_pct,${mc.targetHitRate === null ? "" : mc.targetHitRate.toFixed(3)}`,
    `avg_spins_to_target,${mc.avgSpinsToTarget === null ? "" : mc.avgSpinsToTarget.toFixed(1)}`,
    `stop_loss_rate_pct,${mc.stopLossRate === null ? "" : mc.stopLossRate.toFixed(3)}`,
  ];
  const fan = ["", "spin,p1,p10,p25,p50,p75,p90,p99,mean,survival"];
  for (let i = 0; i < mc.fan.spins.length; i++) {
    fan.push([
      mc.fan.spins[i],
      mc.fan.p1[i].toFixed(2), mc.fan.p10[i].toFixed(2), mc.fan.p25[i].toFixed(2),
      mc.fan.p50[i].toFixed(2), mc.fan.p75[i].toFixed(2), mc.fan.p90[i].toFixed(2),
      mc.fan.p99[i].toFixed(2), mc.fan.mean[i].toFixed(2),
      (mc.survival.alive[i] ?? 0).toFixed(4),
    ].join(","));
  }
  return head.concat(fan).join("\n");
}

export function downloadSessionCsv(results: SpinResult[], startingBalance: number) {
  downloadText("roulette-lab-session.csv", sessionToCsv(results, startingBalance), "text/csv");
}

export function downloadMcCsv(mc: MonteCarloSummary) {
  downloadText("roulette-lab-montecarlo.csv", mcToCsv(mc), "text/csv");
}
