// Built-in cellular objectives. Display names and notes are in js/i18n.js under obj.name.<id> / obj.note.<id>,
// group labels under obj.group.<group>.
// Reactions are given by their Human-GEM / Mouse-GEM identifier (shared by both models); `rxn: null` is the
// model's own biomass reaction. Every objective is written in the direction of the reaction as it stands in
// the model; exchanges are written "X[e] ->", so maximising one asks for net release (the simulator closes
// the uptake of the objective's own metabolite, see Simulator._solve).
//
// Besides growth, the objectives are cell functions of the kind used as "metabolic tasks" (HepatoNet1,
// Gille et al. 2010; Richelle et al. 2021): making a product that a given cell type exports. Each one was
// checked in both models to give a finite, non-trivial optimum in the standard medium. Rejected: glutathione
// synthetase (MAR04326, a futile synthesis/cleavage cycle with MAR04175), glutathione reductase (unbounded
// loop), lipid droplet formation (MAR00031, its product has no sink: 0), L-lactate release (not a goal of
// the cell, only a by-product).
//
// cellType: the function of a specialised, usually non-proliferating cell. The NCI-60 measured rates
// (proliferating tumour cells) do not fit it, and the app suggests setting them to "None".

export const OBJECTIVES = [
  { id: "biomass", group: "general", rxn: null, max: true },
  // Mouse-GEM only: its own objective (MAR00021) takes one unit of each of 33 precursors, so its value is not a
  // growth rate. MAR13082, the generic cell biomass reaction it inherits from Human-GEM (same composition per gDW),
  // is closed in the published Mouse-GEM; the simulator opens it only while it is the objective (OPEN_AS_OBJECTIVE).
  { id: "biomassGeneric", group: "general", rxn: "MAR13082", max: true, notDefault: true },
  // the same without the cofactor pool (vitamins, heme, CoQ, carnitine, retinoid and vitamin D/E metabolites): cofactors
  // are catalytic and their stocks outlast weeks without synthesis, so for gene essentiality they are better left out
  // (DepMap validation, docs section 4). Added at build time (tools/build_all.sh), closed except as objective.
  { id: "biomassNoCof", group: "general", rxn: "MFL_biomass_nocof", max: true },
  { id: "atp", group: "general", rxn: "MAR03964", max: true }, // ATP + H2O -> ADP + Pi + H+ (cytosolic ATP hydrolysis)
  { id: "gsh", group: "general", rxn: "MAR09351", max: true }, // GSH release: net glutathione synthesis
  { id: "urea", group: "liver", rxn: "MAR09438", max: true, cellType: true }, // urea cycle, ammonia disposal
  { id: "glucose", group: "liver", rxn: "MAR09034", max: true, cellType: true }, // gluconeogenesis (liver, kidney)
  { id: "bhb", group: "liver", rxn: "MAR09134", max: true, cellType: true }, // ketogenesis: (R)-3-hydroxybutanoate
  { id: "bile", group: "liver", rxn: "MAR09281", max: true, cellType: true }, // bile acid synthesis: glycocholate
  { id: "cholesterol", group: "liver", rxn: "MAR09285", max: true, cellType: true }, // cholesterol synthesis and release
  { id: "palmitate", group: "liver", rxn: "MAR00611", max: true, cellType: true }, // de novo lipogenesis (liver, adipocyte)
  { id: "glutamate", group: "neuro", rxn: "MAR09071", max: true, cellType: true }, // glutamatergic neuron
  { id: "gaba", group: "neuro", rxn: "MAR09091", max: true, cellType: true }, // GABAergic neuron
  { id: "dopamine", group: "neuro", rxn: "MAR09092", max: true, cellType: true }, // dopaminergic neuron
  { id: "cortisol", group: "neuro", rxn: "MAR09293", max: true, cellType: true }, // adrenal cortex
  // kidney (proximal tubule)
  { id: "ammonia", group: "kidney", rxn: "MAR11420", max: true, cellType: true }, // ammoniagenesis from glutamine (acid excretion)
  { id: "gaa", group: "kidney", rxn: "MAR09852", max: true, cellType: true }, // guanidinoacetate: first step of creatine synthesis (AGAT)
  { id: "arginine", group: "kidney", rxn: "MAR09066", max: true, cellType: true }, // arginine synthesis from citrulline
  // muscle
  { id: "glnRelease", group: "muscle", rxn: "MAR09063", max: true, cellType: true }, // skeletal muscle: main source of plasma glutamine
  { id: "alaRelease", group: "muscle", rxn: "MAR09061", max: true, cellType: true }, // skeletal muscle: glucose-alanine cycle
  { id: "oxATP", group: "muscle", rxn: "MAR06916", max: true, cellType: true }, // cardiomyocyte: ATP from mitochondrial ATP synthase
  // blood, bone marrow and immune cells
  { id: "heme", group: "immune", rxn: "MAR09107", max: true, cellType: true }, // erythroid precursor (bone marrow)
  { id: "txa2", group: "immune", rxn: "MAR09433", max: true, cellType: true }, // platelets (megakaryocyte lineage)
  { id: "no", group: "immune", rxn: "MAR09381", max: true, cellType: true }, // nitric oxide: macrophage, endothelium
  { id: "itaconate", group: "immune", rxn: "MAR09451", max: true, cellType: true }, // activated macrophage (ACOD1/IRG1)
  { id: "pge2", group: "immune", rxn: "MAR09397", max: true, cellType: true }, // macrophage (COX-2)
  { id: "ltb4", group: "immune", rxn: "MAR09365", max: true, cellType: true }, // neutrophil (5-lipoxygenase)
  { id: "histamine", group: "immune", rxn: "MAR00619", max: true, cellType: true }, // mast cell, basophil
  { id: "protein", group: "immune", rxn: "MFL_DM_protein", max: true, cellType: true }, // plasma cell: antibody secretion
  { id: "spermidine", group: "immune", rxn: "MAR11427", max: true, cellType: true }, // activated T lymphocyte (polyamines)
  { id: "creatine", group: "other", rxn: "MAR09290", max: true, cellType: true }, // creatine synthesis (liver, kidney)
  // microbes: maximum ATP (the maintenance reaction, its upper bound opened while it is the objective) and the release
  // of fermentation products and biotechnology targets, given by metabolite name (`met`, the exchange of that metabolite)
  { id: "atpMicro", group: "general", rxn: ["ATPM", "r_4046"], max: true, orgs: ["ecoli-gem", "yeast-gem"] },
  { id: "ethanol", group: "microbe", met: "ethanol", max: true, orgs: ["yeast-gem", "ecoli-gem"] },
  { id: "glycerol", group: "microbe", met: "glycerol", max: true, orgs: ["yeast-gem"] },
  { id: "acetate", group: "microbe", met: "acetate", max: true, orgs: ["ecoli-gem", "yeast-gem"] },
  { id: "succinate", group: "microbe", met: "succinate", max: true, orgs: ["ecoli-gem", "yeast-gem"] },
  { id: "dlactate", group: "microbe", met: "D-lactate", max: true, orgs: ["ecoli-gem"] },
  { id: "formate", group: "microbe", met: "formate", max: true, orgs: ["ecoli-gem"] },
  { id: "butanediol", group: "microbe", met: "(R,R)-2,3-butanediol", max: true, orgs: ["yeast-gem"] },
  { id: "isobutanol", group: "microbe", met: "isobutanol", max: true, orgs: ["yeast-gem"] },
  { id: "phenylethanol", group: "microbe", met: "2-phenylethanol", max: true, orgs: ["yeast-gem"] },
  { id: "isoamylol", group: "microbe", met: "isoamylol", max: true, orgs: ["yeast-gem"] },
  { id: "lysineProd", group: "microbe", met: "lysine", max: true, orgs: ["ecoli-gem"] },
];
export const OBJECTIVE_GROUPS = ["general", "microbe", "liver", "kidney", "muscle", "neuro", "immune", "other"];
// ATP maintenance reactions of microbial models: fixed (yeast-GEM 0.7) or bounded below (iML1515 6.86); as objective their
// upper bound is opened
export const MAINT_AS_OBJECTIVE = new Set(["ATPM", "r_4046"]);

/** Reactions closed in a published model (lb = ub = 0) that are opened (0 .. 1000) only while they are the objective. */
export const OPEN_AS_OBJECTIVE = new Set(["MAR13082", "MFL_DM_protein", "MFL_biomass_nocof"]); // MFL_*: added at build time (tools/build_all.sh)

/** A growth reaction: its flux is a growth rate in h⁻¹ (the model's own biomass objective, MAR13082 or its variant). */
export const isGrowthRxn = (r) => !!r && (!!r.obj || r.id === "MAR13082" || r.id === "MFL_biomass_nocof");

/** Reaction index of a built-in objective in a model, or -1 when the model lacks it. */
export function objectiveIndex(model, index, o) {
  if (o.orgs && !o.orgs.includes(model.meta?.slug)) return -1;
  if (o.rxn === null) return index.biomassRxn;
  if (o.met) { // the exchange of an extracellular metabolite of that name
    const n = o.met.toLowerCase();
    return model.rxns.findIndex((r) => !r.removed && r.m.length === 1 && model.mets[r.m[0]].c === "e" && model.bases[model.mets[r.m[0]].b].n.toLowerCase() === n);
  }
  const ids = Array.isArray(o.rxn) ? o.rxn : [o.rxn];
  const j = model.rxns.findIndex((r) => ids.includes(r.id));
  if (o.notDefault && j === index.biomassRxn) return -1; // already the model's own objective (Human-GEM)
  return j >= 0 && !model.rxns[j].removed ? j : -1;
}
