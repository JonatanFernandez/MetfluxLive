// Module worker: owns the HiGHS runtime and the LP so the UI thread never blocks.
import loadHighs from "../../vendor/highs/highs.mjs";
import { FbaProblem } from "./fba.js";

let highsPromise = null;
let problem = null;

function runtime() {
  if (!highsPromise) {
    highsPromise = loadHighs({
      locateFile: (file) => new URL(`../../vendor/highs/${file}`, import.meta.url).href,
      print: () => {},
      printErr: () => {},
    });
  }
  return highsPromise;
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === "init") {
      const highs = await runtime();
      if (problem) problem.dispose();
      problem = new FbaProblem(highs, msg.net);
      self.postMessage({ id: msg.id, ok: true });
    } else if (msg.type === "solve") {
      const t0 = performance.now();
      const res = problem.solve(msg.params);
      res.ms = performance.now() - t0;
      self.postMessage({ id: msg.id, ok: true, result: res }, [res.v.buffer, res.sourceFlux.buffer]);
    }
  } catch (err) {
    // a failed solve can leave the LP in an undefined state: rebuild on next call
    if (problem) { try { problem.dispose(); } catch { /* ignore */ } problem.sourceKey = null; }
    self.postMessage({ id: msg.id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
