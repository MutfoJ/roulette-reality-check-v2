import McWorker from "./mc.worker.ts?worker";
import type { SimOptions, MonteCarloSummary } from "./engine";
import type { McRequest, McResponse } from "./mc.worker";

export interface RunMcArgs {
  runs: number;
  iterations: number;
  starting: number;
  opts: SimOptions;
  seed?: number;
  onProgress?: (frac: number) => void;
  signal?: AbortSignal;
}

/**
 * Runs a Monte Carlo job in a Web Worker. Returns a promise resolving to
 * the summary, or rejects on error / abort. The main thread stays
 * responsive even for huge runs because:
 *   1. The hot loop runs off-thread.
 *   2. We removed the `setTimeout(0)` yield that used to clamp at 4 ms in
 *      browsers — for runs=10 000 that yield burned ~1.6 s of pure waiting.
 *   3. Percentile picks use quickselect instead of full sort, so the wrap-up
 *      no longer scales with `runs * log(runs)` per checkpoint.
 */
export function runMonteCarloInWorker({ runs, iterations, starting, opts, seed, onProgress, signal }: RunMcArgs): Promise<MonteCarloSummary> {
  return new Promise<MonteCarloSummary>((resolve, reject) => {
    const worker = new McWorker();

    const cleanup = () => {
      worker.terminate();
      if (signal) signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => { cleanup(); reject(new DOMException("Aborted", "AbortError")); };
    if (signal) {
      if (signal.aborted) { cleanup(); reject(new DOMException("Aborted", "AbortError")); return; }
      signal.addEventListener("abort", onAbort);
    }

    worker.onmessage = (e: MessageEvent<McResponse>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        if (onProgress) onProgress(msg.progress.done / Math.max(1, msg.progress.total));
      } else if (msg.type === "done") {
        cleanup();
        resolve(msg.result);
      } else if (msg.type === "error") {
        cleanup();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (ev) => {
      cleanup();
      reject(new Error(ev.message || "Monte Carlo worker error"));
    };

    const req: McRequest = { type: "run", runs, iterations, starting, opts, seed };
    worker.postMessage(req);
  });
}
