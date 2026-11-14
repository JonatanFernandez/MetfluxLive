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
  { id: "no", group: "other", rxn: "MAR09381", max: true, cellType: true }, // nitric oxide: endothelium, macrophage
  { id: "heme", group: "other", rxn: "MAR09107", max: true, cellType: true }, // erythroid precursor
  { id: "creatine", group: "other", rxn: "MAR09290", max: true, cellType: true }, // creatine synthesis (liver, kidney)
];
export const OBJECTIVE_GROUPS = ["general", "liver", "neuro", "other"];

/** Reaction index of a built-in objective in a model, or -1 when the model lacks it. */
export function objectiveIndex(model, index, o) {
  if (o.rxn === null) return index.biomassRxn;
  const j = model.rxns.findIndex((r) => r.id === o.rxn);
  return j >= 0 && !model.rxns[j].removed ? j : -1;
}
