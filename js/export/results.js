// Result datasets for the download dialog: tables (CSV), charts (SVG), the map (PNG) and the settings (JSON).
// File contents are always in English so that they can be shared and parsed regardless of the UI language.
import { barChart, lineChart, midChart, num } from "./charts.js";

const q = (x) => {
  if (x === null || x === undefined) return "";
  if (typeof x === "number") return Number.isFinite(x) ? String(+x.toPrecision(8)) : "";
  const s = String(x);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (head, rows) => [head, ...rows].map((r) => r.map(q).join(",")).join("\n") + "\n";
const pause = () => new Promise((r) => setTimeout(r, 0));

const metRow = (c, m) => { const met = c.model.mets[m], b = c.model.bases[met.b]; return [met.id, b.n, met.c]; };
/** Medium components of a dynamic run, including those that only appear through a scheduled event. */
const mediumMets = (c) => (c.result.instant ? [...c.result.instant] : c.supplies.filter((it) => !it.unlimited && !it.hold).map((it) => it.met));
const hasRef = (c) => !!c.frame.ref;
const hasTracer = (c) => !!c.frame.e;
const isDynamic = (c) => c.result.frames.length > 1;

/** Metabolites worth an isotopologue distribution: labelled, produced, with a structure; busiest first. */
async function mids(c, onProgress) {
  if (c._mids) return c._mids;
  const { model, index, frame: f } = c, turnover = index.turnover(f.v);
  const cand = [];
  for (let m = 0; m < model.mets.length; m++) {
    if (!(f.metE[m] > 0.01) || !(turnover[m] > 1e-7) || index.currency[model.mets[m].b]) continue;
    if (!c.structures[model.bases[model.mets[m].b].id]) continue;
    cand.push(m);
  }
  cand.sort((a, b) => turnover[b] - turnover[a]);
  const out = [];
  const list = cand.slice(0, 150);
  for (let i = 0; i < list.length; i++) {
    const r = c.sampler.mid(list[i], 1500, 60);
    if (r) out.push({ met: list[i], ...r });
    if (i % 5 === 4) { onProgress?.(i / list.length); await pause(); }
  }
  return (c._mids = out);
}

const editTag = (r) => (r.user ? "added" : r.removed ? "removed" : r.edited ? "edited" : "");
const comparing = (c) => !!c.compare;

export const DATASETS = [
  {
    id: "session", kind: "session", file: "session.json", anytime: true,
    build: (c) => JSON.stringify(c.session, null, 1),
  },
  {
    id: "modelEdits", kind: "session", file: "model_edits.json", anytime: true, when: (c) => c.edits.length > 0,
    build: (c) => JSON.stringify(c.session.model_edits, null, 1),
  },
  {
    id: "editLog", kind: "session", file: "model_edits_report.csv", anytime: true, when: (c) => c.edits.length > 0,
    build: (c) => {
      const E = c.editedModel, rows = [];
      c.edits.forEach((op, i) => {
        const res = E.results[i];
        const eq = op.mets ? op.mets.map(([id, k]) => `${k} ${id}`).join(" ") : "";
        rows.push([i + 1, op.op, op.id || (op.base ? op.base + op.comp : op.name + " [" + op.comp + "]"), op.name || "", eq, op.lb ?? "", op.ub ?? "", op.gpr ?? "", op.atommap ? op.atommap.k : "", op.smiles || "", res.ok ? "applied" : "rejected", res.issues.map((x) => `${x.level}:${x.key}${Object.keys(x.args).length ? " " + JSON.stringify(x.args) : ""}`).join(" | ")]);
      });
      return csv(["order", "operation", "id", "name", "stoichiometry", "lower_bound", "upper_bound", "gpr", "atom_map", "smiles", "status", "checks"], rows);
    },
  },
  {
    id: "settings", kind: "other", file: "settings.json",
    build: (c) => JSON.stringify({
      app: "MetfluxLive", exported: new Date().toISOString(),
      model: { ...c.model.meta }, mode: c.mode, time_h: isDynamic(c) ? c.frame.t : null,
      objective: { reaction: c.model.rxns[c.cfg.objective].id, name: c.model.rxns[c.cfg.objective].n, sense: c.cfg.maximize ? "max" : "min", parsimonious: c.cfg.parsimonious, value: c.frame.objective, status: c.frame.status },
      dynamic: c.mode === "dynamic" ? c.dyn : null,
      scheduled_events: c.mode === "dynamic" ? c.events : [],
      measured_exchanges: c.measured,
      cell_type: c.context || null,
      medium: { name: c.mediumName, components: c.supplies.map((it) => { const [id, name, comp] = metRow(c, it.met); return { id, name, compartment: comp, concentration_mM: it.unlimited ? null : it.conc, unlimited: !!it.unlimited, vmax: it.vmax, km: it.km, held_constant: !!it.hold, injection: !c.sim.exchanges.has(it.met) }; }) },
      tracers: c.supplies.filter((it) => it.label && it.label.some((x) => x > 0)).map((it) => { const [id, name, comp] = metRow(c, it.met); return { id, name, compartment: comp, labelled_atoms: Array.from(it.label, (x, a) => (x > 0 ? a : -1)).filter((a) => a >= 0), fraction: it.fraction }; }),
      perturbations: c.perturb.map((p) => ({ type: p.type, target: p.name, residual_activity: p.a })),
      perturbed_reactions: [...c.pert].map(([j, a]) => ({ reaction: c.model.rxns[j].id, residual_activity: a })),
    }, null, 2),
  },
  {
    id: "fluxes", kind: "table", file: "fluxes.csv",
    build: (c) => {
      const f = c.frame, ref = f.ref?.v;
      const th = c.thermo, dg = (j) => (th && Number.isFinite(th.dG[j]) ? [th.dG[j], th.sd[j], f.v[j] * th.dG[j]] : th ? ["", "", ""] : []);
      return csv(["reaction_id", "name", "pathway", "equation", "genes", "ec", "lower_bound", "upper_bound", "flux_mmol_gDW_h", ...(ref ? [f.ref.scen ? "flux_in_" + f.ref.scen.name : "reference_flux", "change"] : []), ...(th ? ["dGm_kJ_mol_forward", "dGm_sd_kJ_mol", "flux_x_dGm_J_gDW_h"] : []), "model_edit"],
        c.model.rxns.map((r, j) => [r.id, r.n, c.model.subsystems[r.ss], c.index.equation(j, f.v[j]), r.g || "", (r.ec || []).join(";"), r.lb, r.ub, f.v[j], ...(ref ? [ref[j], f.v[j] - ref[j]] : []), ...dg(j), editTag(r)]));
    },
  },
  {
    id: "exchanges", kind: "table", file: "exchange_fluxes.csv",
    build: (c) => {
      const f = c.frame, conc = new Map(c.supplies.map((it) => [it.met, it])), rows = [];
      for (const [met, ex] of c.sim.exchanges) {
        const x = f.v[ex.rxn] * ex.dir, it = conc.get(met);
        if (Math.abs(x) < 1e-12 && !it) continue;
        rows.push([...metRow(c, met), c.model.rxns[ex.rxn].id, x > 1e-12 ? "uptake" : x < -1e-12 ? "secretion" : "none", Math.abs(x), it && !it.unlimited ? (f.conc?.get(met) ?? it.conc) : "", it ? (it.unlimited ? "unlimited" : it.vmax) : "", it && !it.unlimited ? it.km : "", f.ref ? Math.abs(f.ref.v[ex.rxn]) : ""]);
      }
      f.srcItems?.forEach((it, i) => rows.push([...metRow(c, it.met), "injection", "uptake", f.sourceFlux[i], it.conc, it.vmax, it.km, ""]));
      rows.sort((a, b) => b[5] - a[5]);
      return csv(["metabolite_id", "name", "compartment", "reaction_id", "direction", "flux_mmol_gDW_h", "medium_concentration_mM", "vmax", "km_mM", "reference_flux_abs"], rows);
    },
  },
  {
    id: "pathways", kind: "table", file: "pathways.csv",
    build: (c) => {
      const f = c.frame, n = c.model.subsystems.length;
      const tot = new Float64Array(n), ref = new Float64Array(n), act = new Int32Array(n), cnt = new Int32Array(n), lab = new Float64Array(n);
      c.model.rxns.forEach((r, j) => {
        cnt[r.ss]++;
        const a = Math.abs(f.v[j]);
        if (f.ref) ref[r.ss] += Math.abs(f.ref.v[j]);
        if (!a) return;
        tot[r.ss] += a; act[r.ss]++;
        if (f.metE) { let s = 0, k = 0; for (const m of r.m) if (!c.index.currency[c.model.mets[m].b]) { s += f.metE[m]; k++; } if (k) lab[r.ss] += (a * s) / k; }
      });
      return csv(["pathway", "reactions", "active_reactions", "total_abs_flux", ...(f.ref ? ["reference_total_abs_flux"] : []), ...(f.metE ? ["flux_weighted_enrichment"] : [])],
        c.model.subsystems.map((s, i) => [s, cnt[i], act[i], tot[i], ...(f.ref ? [ref[i]] : []), ...(f.metE ? [tot[i] ? lab[i] / tot[i] : 0] : [])]).sort((a, b) => b[3] - a[3]));
    },
  },
  {
    id: "pathwayFlows", kind: "table", file: "pathway_flows.csv",
    build: (c) => {
      const rows = [], units = { carbon: "mmol C/gDW/h", nitrogen: "mmol N/gDW/h", redox: "mmol electron pairs/gDW/h", nadh: "mmol/gDW/h", nadph: "mmol/gDW/h", qh2: "mmol/gDW/h", atp: "mmol/gDW/h" };
      for (const kind of Object.keys(units)) {
        for (const o of c.flowsFor(kind).flows) rows.push([kind, c.model.subsystems[o.a], c.model.subsystems[o.b], o.flow, units[kind], o.top != null ? c.model.bases[o.top].n : ""]);
      }
      if (c.thermo) {
        const en = c.flowsFor("dg").energy;
        c.model.subsystems.forEach((s, g) => { if (en.diss[g] || en.up[g]) rows.push(["dissipation", s, "", en.diss[g], "J/gDW/h", ""], ["uphill_at_1mM", s, "", en.up[g], "J/gDW/h", ""], ["dG_coverage", s, "", en.cover[g], "fraction of flux", ""]); });
      }
      return csv(["quantity", "from_pathway", "to_pathway", "value", "unit", "largest_carrier_metabolite"], rows);
    },
  },
  {
    id: "metabolites", kind: "table", file: "metabolites.csv",
    build: (c) => {
      const f = c.frame, turnover = c.index.turnover(f.v);
      return csv(["metabolite_id", "name", "compartment", "formula", "turnover_mmol_gDW_h", "steps_from_medium", ...(f.metE ? ["mean_enrichment", "position_uncertain"] : [])],
        c.model.mets.map((met, m) => [...metRow(c, m), c.model.bases[met.b].f || "", turnover[m], c.depth.depth[m] >= 0 ? c.depth.depth[m] : "", ...(f.metE ? [f.metE[m], f.uncertain[m] ? 1 : 0] : [])]));
    },
  },
  {
    id: "changes", kind: "table", file: "flux_changes_vs_reference.csv", when: hasRef,
    build: (c) => {
      const f = c.frame, rows = [];
      c.model.rxns.forEach((r, j) => {
        const a = f.v[j], b = f.ref.v[j];
        if (Math.abs(a - b) <= 1e-7 + 0.02 * Math.max(Math.abs(a), Math.abs(b))) return;
        rows.push([r.id, r.n, c.model.subsystems[r.ss], b, a, a - b, Math.abs(b) > 1e-12 ? a / b : "", c.pert.has(j) ? c.pert.get(j) : ""]);
      });
      rows.sort((x, y) => Math.abs(y[5]) - Math.abs(x[5]));
      return csv(["reaction_id", "name", "pathway", "reference_flux", "flux", "difference", "ratio", "imposed_residual_activity"], rows);
    },
  },
  {
    id: "enrichment", kind: "table", file: "atom_enrichment.csv", when: hasTracer,
    build: (c) => {
      const f = c.frame, tr = c.sim.tracer, rows = [];
      for (let m = 0; m < c.model.mets.length; m++) {
        if (!(f.metE[m] > 1e-4)) continue;
        const st = c.structures[c.model.bases[c.model.mets[m].b].id], o = tr.off[m];
        if (!st) { rows.push([...metRow(c, m), "", "whole molecule", f.e[o]]); continue; }
        for (let a = 0; a < st.e.length; a++) if (f.e[o + a] > 1e-6) rows.push([...metRow(c, m), a, st.e[a], f.e[o + a]]);
      }
      return csv(["metabolite_id", "name", "compartment", "atom_index", "element", "enrichment"], rows);
    },
  },
  {
    id: "isotopologues", kind: "table", file: "isotopologues.csv", when: (c) => !!c.sampler, slow: true,
    build: async (c, onProgress) => {
      const rows = [];
      for (const r of await mids(c, onProgress)) r.dist.forEach((p, k) => rows.push([...metRow(c, r.met), r.atoms, "M+" + k, p, r.n, r.approx]));
      return csv(["metabolite_id", "name", "compartment", "labelled_element_atoms", "isotopologue", "fraction", "molecules_sampled", "share_without_atom_map"], rows);
    },
  },
  {
    id: "cmpExchanges", kind: "table", file: "comparison_exchanges.csv", when: comparing,
    build: (c) => csv(["metabolite_id", "name", "compartment", `uptake_in_${c.compare.name}`, "uptake_current", "difference"],
      c.compare.exchanges.map((r) => [...metRow(c, r.met), r.a, r.b, r.d])),
  },
  {
    id: "cmpPathways", kind: "table", file: "comparison_pathways.csv", when: comparing,
    build: (c) => csv(["pathway", `total_abs_flux_in_${c.compare.name}`, "total_abs_flux_current", "relative_change"],
      c.compare.pathways.map((r) => [c.model.subsystems[r.ss], r.a, r.b, r.d])),
  },
  {
    id: "cmpLabel", kind: "table", file: "comparison_enrichment.csv", when: (c) => comparing(c) && c.compare.label.length > 0,
    build: (c) => csv(["metabolite_id", "name", "compartment", `mean_enrichment_in_${c.compare.name}`, "mean_enrichment_current", "difference"],
      c.compare.label.map((r) => [...metRow(c, r.met), r.a, r.b, r.d])),
  },
  {
    id: "cmpMids", kind: "table", file: "comparison_isotopologues.csv", when: (c) => comparing(c) && c.compare.label.length > 0 && (!!c.sampler || !c.frame.e), slow: true,
    build: async (c, onProgress) => {
      const list = c.compare.label.slice(0, 60).filter((r) => c.structures[c.model.bases[c.model.mets[r.met].b].id]), rows = [];
      for (let i = 0; i < list.length; i++) {
        const m = list[i].met, a = c.compare.refMid(m), b = c.sampler ? c.sampler.mid(m, 1500, 60) : null;
        const da = a && !a.missing ? a.dist : null, db = b ? b.dist : null, len = Math.max(da?.length || 0, db?.length || 0);
        for (let k = 0; k < len; k++) rows.push([...metRow(c, m), "M+" + k, da ? da[k] || 0 : k ? 0 : 1, db ? db[k] || 0 : k ? 0 : 1]);
        if (i % 4 === 3) { onProgress?.(i / list.length); await pause(); }
      }
      return csv(["metabolite_id", "name", "compartment", "isotopologue", `fraction_in_${c.compare.name}`, "fraction_current"], rows);
    },
  },
  {
    id: "timecourse", kind: "table", file: "timecourse.csv", when: isDynamic,
    build: (c) => {
      const frames = c.result.frames, mets = mediumMets(c);
      const exch = [...c.sim.exchanges].filter(([, ex]) => frames.some((f) => Math.abs(f.v[ex.rxn]) > 1e-9));
      return csv(["time_h", "biomass_gDW_L", "objective", "status", ...mets.map((m) => `conc_mM:${c.index.metName(m)}`), ...exch.map(([m]) => `uptake_mmol_gDW_h:${c.index.metName(m)}`)],
        frames.map((f) => [f.t, f.biomass, f.objective, f.status, ...mets.map((m) => f.conc.get(m) || 0), ...exch.map(([, ex]) => f.v[ex.rxn] * ex.dir)]));
    },
  },
  {
    id: "timecourseLabel", kind: "table", file: "timecourse_enrichment.csv", when: (c) => isDynamic(c) && c.result.frames.some((f) => f.metE),
    build: (c) => {
      const frames = c.result.frames, last = frames[frames.length - 1], turnover = c.index.turnover(last.v);
      const mets = [];
      for (let m = 0; m < c.model.mets.length; m++) if (last.metE?.[m] > 0.01 && turnover[m] > 1e-7 && !c.index.currency[c.model.mets[m].b]) mets.push(m);
      mets.sort((a, b) => turnover[b] - turnover[a]);
      const pick = mets.slice(0, 200);
      return csv(["time_h", ...pick.map((m) => c.index.metName(m))], frames.map((f) => [f.t, ...pick.map((m) => (f.metE ? f.metE[m] : 0))]));
    },
  },
  {
    id: "chartExchange", kind: "chart", file: "chart_uptake_secretion.svg",
    build: (c) => {
      const f = c.frame, up = [], out = [];
      for (const [met, ex] of c.sim.exchanges) {
        const x = f.v[ex.rxn] * ex.dir;
        if (Math.abs(x) < 1e-9 || c.index.currency[c.model.mets[met].b]) continue;
        (x > 0 ? up : out).push({ label: c.model.bases[c.model.mets[met].b].n, values: [Math.abs(x)] });
      }
      const top = (a) => a.sort((x, y) => y.values[0] - x.values[0]).slice(0, 18);
      return [
        { name: "chart_uptake.svg", data: barChart({ title: "Uptake from the medium", subtitle: c.caption, rows: top(up), unit: "mmol/gDW/h" }) },
        { name: "chart_secretion.svg", data: barChart({ title: "Secretion to the medium", subtitle: c.caption, rows: top(out), unit: "mmol/gDW/h", colors: ["#eb6834"] }) },
      ];
    },
  },
  {
    id: "chartPathways", kind: "chart", file: "chart_pathway_activity.svg",
    build: (c) => {
      const f = c.frame, n = c.model.subsystems.length, tot = new Float64Array(n), ref = new Float64Array(n);
      c.model.rxns.forEach((r, j) => { tot[r.ss] += Math.abs(f.v[j]); if (f.ref) ref[r.ss] += Math.abs(f.ref.v[j]); });
      const rows = c.model.subsystems.map((s, i) => ({ label: s, values: f.ref ? [ref[i], tot[i]] : [tot[i]] }))
        .filter((r, i) => !c.index.isTransportSub[i] && !c.index.isExchangeSub[i]).sort((a, b) => Math.max(...b.values) - Math.max(...a.values)).slice(0, 25);
      return barChart({ title: "Pathway activity (sum of absolute fluxes)", subtitle: c.caption + " · transport and exchange pathways left out", rows, series: f.ref ? ["Reference", "Perturbed"] : null, unit: "mmol/gDW/h" });
    },
  },
  {
    id: "chartChanges", kind: "chart", file: "chart_flux_changes.svg", when: hasRef,
    build: (c) => {
      const f = c.frame, rows = [];
      c.model.rxns.forEach((r, j) => {
        const a = f.v[j], b = f.ref.v[j];
        if (Math.abs(a - b) > 1e-7 + 0.02 * Math.max(Math.abs(a), Math.abs(b))) rows.push({ label: r.n, values: [Math.abs(b), Math.abs(a)], d: Math.abs(a - b) });
      });
      rows.sort((x, y) => y.d - x.d);
      if (!rows.length) return null;
      return barChart({ title: "Most changed reactions", subtitle: c.caption + " · absolute flux, reference vs perturbed", rows: rows.slice(0, 25), series: ["Reference", "Perturbed"], unit: "mmol/gDW/h" });
    },
  },
  {
    id: "chartFate", kind: "chart", file: "chart_label_fate.svg", when: (c) => !!c.fate,
    build: (c) => barChart({ title: "Where the label ends up", subtitle: c.caption + " · share of the labelled atoms taken up", rows: [...c.fate.rows.slice(0, 18).map(([n, v]) => ({ label: n, values: [(100 * v) / c.fate.total] })), ...(c.fate.rest > c.fate.total * 0.005 ? [{ label: "Rest (other pools)", values: [(100 * c.fate.rest) / c.fate.total] }] : [])], unit: "% of label", format: (x) => x.toFixed(x >= 10 ? 0 : 1) }),
  },
  {
    id: "chartMid", kind: "chart", file: "chart_isotopologues.svg", when: (c) => !!c.sampler, slow: true,
    build: async (c, onProgress) => {
      const all = await mids(c, onProgress);
      // one compartment per metabolite, small molecules first: these are the ones measured in practice
      const seen = new Set(), panels = [];
      const want = c.selectedMet != null ? all.filter((r) => r.met === c.selectedMet) : [];
      for (const r of [...want, ...all]) {
        const b = c.model.mets[r.met].b;
        if (seen.has(b) || r.dist.length > 25 || r.approx > 0.5) continue;
        seen.add(b);
        panels.push({ name: c.index.metName(r.met), dist: r.dist, note: r.approx > 0.1 ? `${Math.round(100 * r.approx)} % of atoms without atom map` : "" });
        if (panels.length >= 15) break;
      }
      if (!panels.length) return null;
      return midChart({ title: "Mass isotopologue distributions", subtitle: c.caption + " · % of molecules with k heavy atoms; the top line is 100 %", panels });
    },
  },
  {
    id: "midTimecourse", kind: "table", file: "isotopologues_over_time.csv", when: (c) => !!c.midSeries && c.selectedMet != null, slow: true,
    build: async (c) => {
      const ts = await c.midSeries(c.selectedMet), frames = c.result.frames, name = c.index.metName(c.selectedMet);
      // only isotopologues that are ever seen
      const keep = Array.from({ length: ts.len }, (_, k) => k).filter((k) => ts.dists.some((d) => (d[k] || 0) > 0.002));
      const top = [...keep].sort((a, b) => Math.max(...ts.dists.map((d) => d[b] || 0)) - Math.max(...ts.dists.map((d) => d[a] || 0))).slice(0, 8).sort((a, b) => a - b);
      return [
        { name: "isotopologues_over_time.csv", data: csv(["time_h", "metabolite", ...keep.map((k) => "M+" + k)], ts.idx.map((fi, q) => [frames[fi].t, name, ...keep.map((k) => ts.dists[q][k] || 0)])) },
        { name: "chart_isotopologues_over_time.svg", data: lineChart({ title: `Isotopologues of ${name} over time`, subtitle: c.caption.replace(/, t = .*$/, "") + " · fraction of molecules", x: ts.idx.map((fi) => frames[fi].t), logX: true, xLabel: "time (h, log scale)", yLabel: "fraction of molecules", yMax: 1, series: top.map((k) => ({ name: "M+" + k, y: ts.dists.map((d) => d[k] || 0) })) }) },
      ];
    },
  },
  {
    id: "chartTime", kind: "chart", file: "chart_timecourse.svg", when: isDynamic,
    build: (c) => {
      const frames = c.result.frames, n = frames.length, x = frames.map((f) => f.t);
      const added = new Set(c.events.filter((ev) => ev.type === "add").map((ev) => ev.metabolite));
      const items = mediumMets(c).map((met) => {
        let mx = 0;
        for (const f of frames) mx = Math.max(mx, f.conc?.get(met) || 0);
        return { met, mx, end: mx ? (frames[n - 1].conc?.get(met) || 0) / mx : 1, added: added.has(c.index.metName(met)) ? 1 : 0 };
      }).filter((o) => o.mx > 0).sort((a, b) => b.added - a.added || a.end - b.end).slice(0, 8);
      const out = [{ name: "chart_medium_depletion.svg", data: lineChart({ title: "Medium over time", subtitle: c.caption + " · components added by an event, then the most depleted", x, logX: true, xLabel: "time (h, log scale)", yLabel: "fraction of each component's maximum concentration", yMax: 1, series: items.map((o) => ({ name: c.model.bases[c.model.mets[o.met].b].n, y: frames.map((f) => (f.conc?.get(o.met) || 0) / o.mx) })) }) }];
      if (frames.every((f) => f.biomass)) out.push({ name: "chart_biomass.svg", data: lineChart({ title: "Biomass", subtitle: c.caption, x, logX: true, xLabel: "time (h, log scale)", yLabel: "gDW/L", series: [{ name: "biomass", y: frames.map((f) => f.biomass) }] }) });
      return out;
    },
  },
  {
    id: "map", kind: "chart", file: "map.png", when: (c) => !!c.canvas,
    build: (c) => new Promise((resolve) => c.canvas.toBlob(async (b) => resolve(b ? new Uint8Array(await b.arrayBuffer()) : null), "image/png")),
  },

  // ---------------------------------------------------------------- the Interpret tab ----
  // These come from data the user supplied, so none of them needs a flux solution (`anytime: true`) and
  // every one declares `when`: a session with no omics loaded sees nothing new in the dialog.
  {
    id: "exoRates", kind: "table", file: "exometabolomics_rates.csv", anytime: true, when: (c) => !!c.exo,
    build: (c) => {
      const g = c.exo.growth;
      const rows = c.exo.rates.map((r) => [
        r.name, r.met !== undefined ? c.model.mets[r.met].id : "", r.met !== undefined ? c.model.bases[c.model.mets[r.met].b].n : "",
        r.via || "", r.rate > 0 ? "uptake" : r.rate < 0 ? "secretion" : "none", r.rate, r.sd ?? "",
        r.n ?? "", (r.flags || []).join(";"),
      ]);
      if (g) rows.push(["(growth rate)", "", "", "", "growth", g.mu, g.sd ?? "", g.n ?? "", ""]);
      return csv(["label", "metabolite_id", "metabolite_name", "resolved_by", "direction",
        "rate_mmol_gDW_h", "sd", "n_replicates", "flags"], rows);
    },
  },
  {
    id: "exoFit", kind: "table", file: "exometabolomics_fit.csv", anytime: true, when: (c) => !!c.exo?.fit,
    build: (c) => {
      const f = c.exo.fit, b = f.balance || {};
      const name = (m) => (m === -1 ? "(growth)" : c.model.bases[c.model.mets[m].b].n);
      const rows = (f.residuals || []).map((r) => [
        name(r.met), r.met === -1 ? "" : c.model.mets[r.met].id, r.observed, r.fitted, r.residual, r.share,
      ]);
      // the diagnostics belong with the residuals: a small deviation with an absurd respiratory quotient is
      // not a good fit, and reading one without the other is how that gets missed
      const diag = [
        ["condition", f.condition], ["measurements", f.nMeasurements], ["total_deviation", f.deviation],
        ["objective", f.objective], ["growth_observed_per_h", f.growthObserved], ["growth_sd", f.growthSd],
        ["growth_fitted_per_h", f.growthFitted], ["respiratory_quotient", b.rq],
        ["carbon_closure", b.closure?.C], ["nitrogen_closure", b.closure?.N],
        ["electron_balance", b.electrons], ["proton_flux", b.proton],
        ...(b.warnings || []).map((w, i) => [`warning_${i + 1}`, w]),
      ];
      return csv(["metabolite", "metabolite_id", "observed_mmol_gDW_h", "fitted_mmol_gDW_h", "residual", "share_of_deviation"], rows)
        + "\n" + csv(["diagnostic", "value"], diag);
    },
  },
  {
    id: "mtbContrast", kind: "table", file: "metabolomics_contrast.csv", anytime: true, when: (c) => !!c.mtb,
    build: (c) => {
      const r = c.mtb, mapped = new Map();
      for (const row of r.rows) for (const b of row.bases || []) mapped.set(row.label, b);
      const rows = r.rows.map((x) => [
        x.label, mapped.has(x.label) ? c.model.bases[mapped.get(x.label)].id : "",
        mapped.has(x.label) ? c.model.bases[mapped.get(x.label)].n : "", x.via || "",
        x.log2fc, 2 ** x.log2fc, x.t, x.df, x.p, x.q, x.n, x.q < 0.05 ? "yes" : "no",
      ]);
      const unres = (r.unmapped || []).map((x) => [x.label, "", "", x.via || "unresolved", x.log2fc, 2 ** x.log2fc, x.t, x.df, x.p, x.q, x.n, ""]);
      return csv(["label", "metabolite_id", "metabolite_name", "resolved_by", "log2FC", "fold_change",
        "t", "df", "p", "q_BH", "n_samples", "significant_q_lt_0.05"], rows.concat(unres));
    },
  },
  {
    id: "mtbSteps", kind: "table", file: "metabolomics_candidate_steps.csv", anytime: true, when: (c) => !!c.mtb?.steps?.length,
    build: (c) => {
      const r = c.mtb, perm = r.perm || {};
      const rows = r.steps.map((x, k) => [
        k + 1, x.id, x.name, c.model.subsystems[x.ss] ?? "", x.score, x.raw, x.subUp, x.prodDown,
        x.direction ?? "", x.support ?? "", x.oppositeSigns ? "yes" : "no", x.couldBeReversal ? "yes" : "no",
        x.carriesFlux ? "yes" : "no", r.shifts?.get?.(x.rxn) ?? "",
      ]);
      const head = csv(["rank", "reaction_id", "reaction_name", "pathway", "score", "raw_score", "substrates_up",
        "products_down", "flux_direction", "support", "opposite_signs", "could_be_reversal", "carries_flux",
        "partial_ddG_kJ_mol"], rows);
      // the permutation line is what says whether the top of this list means anything at all
      return head + "\n" + csv(["calibration", "value"], [
        ["permutation_p", perm.p], ["permutation_rounds", perm.rounds], ["best_observed_score", perm.observed],
        ["panel_median_log2FC", r.rawMedian], ["median_normalisation_applied", r.norm ? "yes" : "no"],
      ]);
    },
  },
  {
    id: "mtbRatios", kind: "table", file: "metabolomics_ratios.csv", anytime: true, when: (c) => !!c.mtb?.ratios?.length,
    build: (c) => csv(["numerator", "denominator", "meaning", "delta_log2", "fold_change"],
      c.mtb.ratios.map((x) => [x.a, x.b, x.what || "", x.dlog2, x.fold])),
  },
  {
    id: "tfTable", kind: "table", file: "tf_activities.csv", anytime: true, when: (c) => !!c.reg?.tfs?.length,
    build: (c) => {
      const r = c.reg, joint = r.joint || new Map(), fx = r.flux;
      const rows = r.tfs.map((e, k) => {
        const jt = joint.get?.(e.tf);
        return [
          k + 1, e.tf, e.dir > 0 ? "up" : "down", e.zRna, e.pRna, e.qRna, e.nObsRna, e.nTotalRna,
          e.nMetTargets, e.metGenes.length, e.metRxns.size,
          e.concordant.length, e.rnaOnly.length, e.discordant.length,
          ...(fx ? [e.fluxAgree, e.fluxDisagree, e.fluxIdle, jt?.p ?? "", jt?.reason ?? ""] : []),
          Number.isFinite(e.zMet) ? e.zMet : "", Number.isFinite(e.qMet) ? e.qMet : "", e.combinedScore,
        ];
      });
      const head = ["rank", "tf", "activity", "ulm_t", "p", "q_BH", "targets_observed", "targets_total",
        "metabolic_targets", "metabolic_targets_confirmed_by_mRNA", "reactions",
        "chains_concordant", "chains_rna_only", "chains_discordant",
        ...(fx ? ["flux_agree", "flux_disagree", "flux_unchanged", "joint_p", "joint_declined_because"] : []),
        "metabolomics_t", "metabolomics_q", "combined_score"];
      const meta = [["regulon_source", r.regulons?.source], ["regulon_organism", r.regulons?.organism],
        ["regulon_built", r.regulons?.built], ["regulon_licence", r.regulons?.license],
        ["flux_change_source", fx?.source ?? "none"],
        ["flux_independent_of_transcriptome", fx ? (fx.independent ? "yes" : "no") : ""],
        ["reactions_whose_flux_moved", fx?.nChanged ?? ""], ["reactions_reversed", fx?.nReversed ?? ""]];
      return csv(head, rows) + "\n" + csv(["provenance", "value"], meta);
    },
  },
  {
    id: "tfTargets", kind: "table", file: "tf_targets.csv", anytime: true, when: (c) => !!c.reg?.tfs?.length,
    build: (c) => {
      const r = c.reg, fx = r.flux, rows = [];
      for (const e of r.tfs.slice(0, 40)) {
        for (const g of e.metGenes) rows.push([
          e.tf, e.dir > 0 ? "up" : "down", e.qRna, g.gene,
          g.regSign > 0 ? "activates" : "represses", g.expected > 0 ? "up" : "down",
          g.log2fc, g.q ?? "", g.rxns.length,
          ...(fx ? [g.fluxDir === null ? "" : g.fluxDir > 0 ? "up" : g.fluxDir < 0 ? "down" : "unchanged",
            g.fluxAgree === 1 ? "agree" : g.fluxAgree === -1 ? "disagree" : g.fluxAgree === 0 ? "unchanged" : ""] : []),
        ]);
      }
      return csv(["tf", "tf_activity", "tf_q", "target_gene", "edge", "expected_enzyme_change",
        "mRNA_log2FC", "mRNA_q", "reactions",
        ...(fx ? ["flux_direction", "flux_vs_prediction"] : [])], rows);
    },
  },
  {
    id: "tfRegulon", kind: "table", file: "tf_marked_regulon.csv", anytime: true,
    when: (c) => !!c.reg?.markedTf,
    build: (c) => {
      const r = c.reg, e = r.tfs.find((x) => x.tf === r.markedTf);
      if (!e) return null;
      const v = c.frame?.v || null;
      const rows = [...e.metRxns].map((j) => {
        const d = e.metRxnDir?.get(j) ?? 0;
        const drivers = (e.rxnDrivers?.get(j) || []).map((g) => `${g.gene}${g.regSign > 0 ? "+" : "-"}`).join(";");
        const rx = c.model.rxns[j];
        return [rx.id, rx.n, c.model.subsystems[rx.ss] ?? "", d > 0 ? "up" : d < 0 ? "down" : "unclear",
          drivers, v ? v[j] : "", rx.g || ""];
      });
      rows.sort((a, b) => Math.abs(+b[5] || 0) - Math.abs(+a[5] || 0));
      return csv(["reaction_id", "reaction_name", "pathway", "pushed", "regulating_genes",
        "flux_mmol_gDW_h", "gpr"], rows);
    },
  },
  {
    id: "metMap", kind: "other", file: "metabolite_mapping.json", anytime: true,
    when: (c) => (c.metMap?.exo?.length || 0) + (c.metMap?.mtb?.length || 0) > 0,
    // Hand mapping is curated work that otherwise lives only in this browser's localStorage. Writing it out
    // lets it be reviewed, shared, kept with the paper, and loaded on another machine.
    build: (c) => JSON.stringify({
      model: c.model.meta?.slug || "", exported: new Date().toISOString(),
      note: "label -> metabolite base id; an empty value means the label was deliberately ignored",
      mapping: Object.fromEntries([...c.metMap.exo, ...c.metMap.mtb]),
    }, null, 2) + "\n",
  },
];

const README = {
  "exometabolomics_rates.csv": "Uptake (+) and secretion (-) computed from the spent-medium table, with the growth rate as the last row. `flags` names what limits a rate: only two time points, no cell-free control, a metabolite that ran out.",
  "exometabolomics_fit.csv": "Whether one flux distribution can satisfy all those rates at once. The residuals come first, then the diagnostics after a blank line. Read the deviation together with the respiratory quotient and the carbon closure: a small deviation with an absurd quotient is not a good fit.",
  "metabolomics_contrast.csv": "Each measured metabolite between the two conditions, with the model metabolite it resolved to and how. Labels nothing resolved are listed at the end with an empty metabolite_id.",
  "metabolomics_candidate_steps.csv": "Reactions whose measured substrates rose while their products fell, best first, with the permutation calibration after a blank line. These order hypotheses for an experiment to settle; they do not identify a cause.",
  "metabolomics_ratios.csv": "The diagnostic energy and redox ratios, reported only as changes between the conditions because ionisation response factors cancel in relative data.",
  "tf_activities.csv": "Transcription factors ranked by ULM activity, with their targets, the three-step chains and, when a flux change was supplied, how many of their enzymes move the way they predict. `joint_p` is filled only when the flux came from measured exchange rates; otherwise `joint_declined_because` says why no p-value is honest.",
  "tf_targets.csv": "One row per regulator and metabolic target gene: the sign of the edge, the direction that predicts for the enzyme, the measured mRNA change and, when available, whether the reaction flux agreed.",
  "tf_marked_regulon.csv": "Every reaction of the regulon highlighted on the map, which way its regulator pushes it, and the target genes responsible with their sign.",
  "metabolite_mapping.json": "The labels you mapped by hand, so the same table resolves the same way on another machine. An empty value means a label you chose to ignore.",
  "session.json": "The whole session: model edits, medium, tracers, measured fluxes, perturbations, events, objective and saved scenarios. Load it with the Import button to repeat these calculations.",
  "model_edits.json": "Only the model edits (added / removed reactions and metabolites, changed bounds and GPR rules), to import into another session.",
  "model_edits_report.csv": "Every model edit with its validation result (applied or rejected) and the checks that were raised.",
  "comparison_exchanges.csv": "Uptake (+) and secretion (-) in the compared scenario and in the current situation.",
  "comparison_pathways.csv": "Sum of absolute fluxes per pathway in the compared scenario and now, with the relative change (-1 .. 1).",
  "comparison_enrichment.csv": "Mean label enrichment of the metabolites whose labelling differs by more than 0.5 percentage points.",
  "comparison_isotopologues.csv": "Mass isotopologue distributions (M+0, M+1, ...) of those metabolites in the compared scenario and now.",
  "settings.json": "Everything needed to repeat the run: model, mode, objective, medium, measured exchange fluxes, cell type (genes switched off, genes rescued for metabolic tasks and the reactions they block; derived from the Human Protein Atlas, CC BY-SA 4.0, or Bgee, CC0), tracers and perturbations.",
  "fluxes.csv": "Flux of every reaction (mmol/gDW/h), with bounds, pathway, genes and, when there is a perturbation, the reference flux. dGm: transformed Gibbs energy of the forward reaction with every reactant at 1 mM (eQuilibrator / component contribution), its standard error, and flux x dGm (negative = energy dissipated).",
  "pathway_flows.csv": "Flows between pathways (compartments merged, transport ignored) for every quantity of the map selector: transferable carbon and nitrogen atoms, NADH, NADPH, ubiquinol and nucleoside triphosphates; then, per pathway, the free energy dissipated, the uphill part at 1 mM and the share of flux with a known dGm.",
  "exchange_fluxes.csv": "Uptake and secretion of every exchanged metabolite, with its medium concentration and kinetic parameters.",
  "pathways.csv": "Per pathway: reactions, active reactions, sum of absolute fluxes, and flux-weighted enrichment when a tracer is used.",
  "metabolites.csv": "Per metabolite: turnover (sum of producing fluxes), steps from the medium (cascade depth) and mean enrichment.",
  "flux_changes_vs_reference.csv": "Reactions whose flux changed by more than 2 % against the reference: the unperturbed cell, or the compared scenario when one is selected.",
  "atom_enrichment.csv": "Positional enrichment (0-1) of every labelled atom. Atom indices follow the structure shown in the app.",
  "isotopologues.csv": "Mass isotopologue distributions (M+0, M+1, ...) of the busiest labelled metabolites, by Monte-Carlo sampling (isotopic steady state, or the selected time point of a dynamic run). 'share_without_atom_map' is the share of atoms that had to fall back to positional enrichment.",
  "timecourse.csv": "Dynamic run: time, biomass, objective, medium concentrations and exchange fluxes at every time point.",
  "timecourse_enrichment.csv": "Dynamic run: mean enrichment of the busiest labelled metabolites at every time point.",
  "isotopologues_over_time.csv": "Dynamic run: isotopologue fractions of the selected metabolite at up to 30 time points.",
  "chart_isotopologues_over_time.svg": "The same, as lines (up to eight isotopologues).",
  "chart_uptake.svg": "Largest uptake fluxes.", "chart_secretion.svg": "Largest secretion fluxes.",
  "chart_pathway_activity.svg": "Most active pathways.", "chart_flux_changes.svg": "Most changed reactions, reference vs perturbed.",
  "chart_label_fate.svg": "Share of the label that leaves in each product.", "chart_isotopologues.svg": "Isotopologue distributions of up to 15 metabolites.",
  "chart_medium_depletion.svg": "Medium components over time, each as a fraction of its own maximum concentration.", "chart_biomass.svg": "Biomass over time.",
  "map.png": "The map exactly as it was on screen.",
};

/**
 * Build the selected datasets.
 * @returns [{ name, data }] ready for makeZip (a README.txt is added)
 */
export async function buildResults(c, ids, onProgress) {
  const files = [];
  const chosen = DATASETS.filter((d) => ids.includes(d.id) && (!d.when || d.when(c)));
  for (let i = 0; i < chosen.length; i++) {
    const d = chosen[i];
    onProgress?.(i / chosen.length, d.id);
    await pause();
    const out = await d.build(c, (p) => onProgress?.((i + p) / chosen.length, d.id));
    if (!out) continue;
    if (Array.isArray(out)) files.push(...out); else files.push({ name: d.file, data: out });
  }
  const lines = [`MetfluxLive results - ${c.caption || "session"}`, `Exported ${new Date().toISOString()}`, "", "Fluxes are in mmol per gram dry weight per hour; concentrations in mM; enrichments are fractions (0-1).", "These are model predictions, not measurements. See the Docs page of the app for methods and limitations.", "", ...files.map((f) => `${f.name}\n    ${README[f.name] || ""}`)];
  files.unshift({ name: "README.txt", data: lines.join("\n") + "\n" });
  return files;
}
