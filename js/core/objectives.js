// Built-in cellular objectives. Display names and notes are in js/i18n.js under obj.name.<id> / obj.note.<id>.
// Reactions are given by their Human-GEM / Mouse-GEM identifier (shared by both models); `rxn: null` is the
// model's own biomass reaction. Every objective is written in the direction of the reaction as it stands in
// the model; exchanges are written "X[e] ->", so a positive flux is secretion.
//
// Glutathione: maximising glutathione synthetase (MAR04326) itself gives a futile cycle (GSH made and at once
// cleaved again by gamma-glutamyl aminopeptidase, MAR04175, ~6.5 mmol/gDW/h of wasted ATP), so the objective
// is net GSH output, i.e. its export to the medium, which the cell can only sustain by making GSH from amino acids.

export const OBJECTIVES = [
  { id: "biomass", rxn: null, max: true },
  { id: "atp", rxn: "MAR03964", max: true }, // ATP + H2O -> ADP + Pi + H+ (cytosolic ATP hydrolysis, the maintenance reaction)
  { id: "gsh", rxn: "MAR09351", max: true }, // Exchange of GSH: net glutathione synthesis and release
];

/** Reaction index of a built-in objective in a model, or -1 when the model lacks it. */
export function objectiveIndex(model, index, o) {
  if (o.rxn === null) return index.biomassRxn;
  const j = model.rxns.findIndex((r) => r.id === o.rxn);
  return j >= 0 && !model.rxns[j].removed ? j : -1;
}
