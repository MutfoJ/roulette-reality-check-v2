/// <reference lib="webworker" />
import { runMonteCarloSync, type SimOptions, type MonteCarloSummary, type MonteCarloProgress } from "./engine";

export type McRequest = {
  type: "run";
  runs: number;
  iterations: number;
  starting: number;
  opts: SimOptions;
  seed?: number;
};

export type McResponse =
  | { type: "progress"; progress: MonteCarloProgress }
  | { type: "done"; result: MonteCarloSummary }
  | { type: "error"; message: string };

self.onmessage = (e: MessageEvent<McRequest>) => {
  const msg = e.data;
  if (msg.type !== "run") return;
  try {
    const result = runMonteCarloSync(msg.runs, msg.iterations, msg.starting, msg.opts, p => {
      const out: McResponse = { type: "progress", progress: p };
      (self as unknown as Worker).postMessage(out);
    }, msg.seed);
    const out: McResponse = { type: "done", result };
    (self as unknown as Worker).postMessage(out);
  } catch (err) {
    const out: McResponse = { type: "error", message: err instanceof Error ? err.message : String(err) };
    (self as unknown as Worker).postMessage(out);
  }
};

export {};
