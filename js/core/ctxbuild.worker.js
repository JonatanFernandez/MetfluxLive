// Module worker: builds a cell-type context from the user's expression data (js/core/ctxbuild.js), with the same
// metabolic-task rescue as the built-in catalogue, without blocking the page.
// in:  { model, levels: [[gene symbol, value]], thr, tasksText }
// out: { type: "progress", i, n } ... then { type: "done", off, nOff0, rescued, failed, nBlocked } or { type: "error" }
import loadHighs from "../../vendor/highs/highs.mjs";
import { parseTasks, TaskRunner } from "./tasks.js";
import { ContextBuilder } from "./ctxbuild.js";

self.onmessage = async (ev) => {
  const { model, levels, thr, tasksText } = ev.data;
  try {
    const highs = await loadHighs({ locateFile: (f) => new URL(`../../vendor/highs/${f}`, import.meta.url).href, print: () => {}, printErr: () => {} });
    const tr = new TaskRunner(highs, model, parseTasks(tasksText));
    const cb = new ContextBuilder(tr, model);
    const tasks = tr.tasks.filter((t) => !t.shouldFail && !t.bad);
    const r = cb.build(new Map(levels), thr, tasks, (i, n) => self.postMessage({ type: "progress", i, n }));
    self.postMessage({ type: "done", off: [...r.off], nOff0: r.nOff0, rescued: r.rescued, failed: r.failed, nBlocked: r.nBlocked });
  } catch (err) {
    self.postMessage({ type: "error", message: String(err?.message || err) });
  }
};
