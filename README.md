# MetfluxLive

**[English](#english)** · **[Español](#español)** · **[Changelog (v1.2)](CHANGELOG.md)**

---

## English

Local viewer for metabolic fluxes and isotope tracing on genome-scale metabolic models
(Human-GEM 2.1.1, Mouse-GEM 1.8.0, Rat-GEM 1.8.0, Zebrafish-GEM 1.6.0, Fruitfly-GEM 1.7.0, Worm-GEM 1.8.0, yeast-GEM 9.1.1 and E. coli iML1515 included, already preprocessed). Everything runs in the browser.

### Open

Open `index.html` with **Five Server** (or any static server; it does not work from `file://`
because it uses ES modules, a Web Worker and WebAssembly). No internet connection is needed.

### Usage

- **Docs** — the "Docs" button opens `docs.html`: methods explained for non-specialists (FBA, steady state
  vs dynamic, isotope tracing), data sources, limitations and a set of worked in-silico experiments.
- **Language** — selector at the top right: English (default), Spanish, Portuguese (Brazil), Italian, French, German and
  Greek (metabolite, reaction and pathway names come from the model and are not translated). English and Spanish live in
  `js/i18n.js`, the others in `js/i18n/<code>.js`; a missing string falls back to English. The Docs exist in all seven
  languages (English and Spanish in `docs.html`, the others in `docs/<code>.html`, loaded on demand).
- **Global map** — "Group: cascade" (default) orders pathways top to bottom by reaction steps from the medium (below); "Group: cell" distributes the reactions
  by compartment in a cell diagram (cytosol, mitochondrion, ER, Golgi, lysosome, peroxisome, nucleus,
  extracellular medium) and places the reactions that cross a membrane on that membrane; "Group: pathways"
  draws one bubble per pathway; "Group: cascade" orders pathways (and, inside a pathway map, metabolites)
  top to bottom by their number of reaction steps from the medium: medium on top, transport into the cell
  as step 0, then the intracellular steps. Lines are the
  carbon one group produces and another consumes. Double-click a group to open its pathway map
  (○ metabolite, ◆ reaction, cofactors hidden).
- **Search** (`Ctrl+K`) — metabolites (name, formula, KEGG/HMDB/ChEBI), reactions (name, ID, EC),
  genes/enzymes and pathways.
- **Culture medium** — the selector at the top of "Medium and sources" switches between a standard
  DMEM/F-12-like medium, **Plasmax** and **HPLM** (physiological media; concentrations from Table S1 of
  [Vande Voorde et al. 2019](https://pubmed.ncbi.nlm.nih.gov/30613774/)), and **Williams E** as used for
  human liver slices ([Grankvist et al. 2024](https://doi.org/10.1038/s42255-024-01119-3)). "save…" stores the current medium
  with your changes under a name (in the browser's localStorage, shared by both models); "reset" discards
  the changes. The sections of the left panel collapse by clicking their title.
- **Cell type (gene expression)** — switches off the genes that are not detected in a chosen cell line
  (1,206 from the [Human Protein Atlas](https://www.proteinatlas.org) cell line atlas, cancer and non-cancer,
  described with [Cellosaurus](https://www.cellosaurus.org)), cell type (155, HPA single cell types), tissue
  (HPA tissue consensus) or the NCI-60 panel, and in Mouse-GEM in 276 tissues and cell types from
  [Bgee](https://www.bgee.org). The reactions left without a detected enzyme are blocked or, as an option,
  only made costlier in pFBA; the default mode keeps large complexes (5+ subunits) when at least 80 % of their
  subunits are detected and never switches off mitochondrial DNA genes (one undetected subunit, NDUFA6, removed
  respiratory complex I from 469 cell types). Genes that the 57 essential metabolic tasks of Human-GEM need are switched back
  on. Off by default. Sources, cut-off and preprocessing: Docs › Cell types.
  Your own RNA-seq table (TPM or similar, one row per gene) can be turned into a cell type with the same
  procedure, in the browser; the data never leave the computer (Docs › Cell types › Your own RNA-seq data).
- **Reading the result** — a plain-language summary, what limits the objective (reduced costs), the value of
  each metabolite (shadow prices), the ATP/NADH/NADPH balance by pathway, phase planes of a nutrient, flux ranges
  (FVA) of a reaction and of a whole pathway (cycle-free, with "what can replace it"), an essential-gene screen,
  and a comparator of two cell types in the catalogue. Docs › Flux balance analysis.
- **Three task tabs (*Simulate · Compare · Interpret*)** — the left panel is organised into three tabs:
  *Simulate* (medium, cell type, knockouts, tracers, model edits), *Compare* (saved scenarios, A→B flux map,
  conditional nutrient auxotrophy screen, and conditional gene essentiality / synthetic lethality screen), and
  *Interpret* (exometabolomics uptake/secretion fitter, intracellular metabolomics contrast, and transcription-factor
  regulatory inference).
- **Exometabolomics importer (*Interpret*)** — paste or drop a spent-medium concentration time course (with cell
  counts or OD600) to compute specific uptake/secretion rates (mmol/gDW/h), growth rate, respiratory quotient,
  and carbon/nitrogen closure, fit them to the GEM via L1 LP consistency check (`js/core/fitexchange.js`), and
  apply the measured rates directly to the simulation. Docs › Measured values.
- **Intracellular metabolomics (*Interpret*)** — paste a wide metabolite abundance table (metabolites × samples,
  with group labels or regex split) to compute Welch t-tests, BH FDR, diagnostic redox/energy ratios, reaction-level
  substrate/product bottleneck signals with non-parametric sample-permutation null checks, reaction $\Delta(\Delta G')$
  shifts, a live map overlay (metabolite log2FC fill, $q < 0.05$ halo, unobservable reactions and candidate bottlenecks),
  and one-click "Test block in model" perturbations. Docs › Intracellular metabolomics.
- **Regulators from differential RNA-seq (*Interpret*)** — paste a differential expression table (gene + log2FC or
  signed statistic) to score transcription factor (TF) activities using sparse exact Univariate Linear Model (ULM,
  equivalent to decoupleR; Badia-i-Mompel et al. 2022) against signed regulons bundled for **Human-GEM** (917 TFs,
  CollecTRI via OmniPath, CC BY-SA 4.0), **Mouse-GEM** (838 TFs, CollecTRI orthology, CC BY-SA 4.0),
  **Rat-GEM** (837 TFs, CollecTRI orthology, CC BY-SA 4.0; thinner coverage, 425 metabolic target genes) and
  **E. coli iML1515** (239 TFs, RegulonDB v14.5.1, academic licence). When paired with intracellular metabolomics,
  MetfluxLive separates **transcriptional** from **post-transcriptional / allosteric** metabolic bottlenecks, traces
  3-step `TF → mRNA → metabolite` chains, highlights TF-regulated reactions on the map, and tests TF-driven enzyme
  scaling directly in FBA. Docs › Regulatory hypotheses.
- **Worked examples (*Examples*)** — six reproducible guided experiments built directly from published data and
  aligned with each analysis workflow in the Docs, each with its own step-by-step walkthrough (where to enter data,
  required table format, and tour of the results): (1) `SDHB` knockout, A→B comparison and conditional screens
  (Cardaci et al. 2015), (2) `[U-13C6]glucose` normoxia vs. hypoxia isotope tracing and paired citrate MIDs,
  (3) HEK293 spent-medium exometabolomics fitting (Dietmair et al. 2012), (4) HEK293 producer vs. non-producer
  intracellular metabolomics contrast, Δ(ΔG′) and map overlay (Dietmair et al. 2012), (5) custom cell-type context
  from HCT116 RNA-seq TPM (DepMap 26Q3), and (6) *E. coli* `ΔarcA` vs. WT differential RNA-seq TF inference
  (Pal et al. 2020, GSE153906).
- **Moving around and appearance** — back/forward (‹ ›, Alt+←/→), reactions of other pathways around a selected
  metabolite, a map centred on any metabolite or reaction (right-click menu, or "adaptive" on click), and an
  Appearance dialog (backgrounds, accent, flux colour, colour scales, colour-blind safe compartments).
  Docs › The interface; units are explained in Docs › Glossary › Units.
- **Phones** — on a narrow screen the map fills the screen and a bottom bar opens Setup, Results and More
  as sliding panels; pinch to zoom, double tap to open a pathway, long press for the node menu. Can be added
  to the home screen (web app manifest) and opened full screen.
- **Tracers and experiment design** — 40 commercial tracers (Cambridge Isotope Laboratories catalogue numbers,
  grouped by use, with references) can label a nutrient with one click; "Design a tracer experiment" ranks
  tracers and measurable metabolites to tell saved scenarios apart or to resolve one flux. Natural abundance
  can be added to isotopologue distributions. Docs › Isotope tracing.
- **Measured exchange fluxes** — by default the uptake and secretion of glucose, lactate, glutamine and
  15 more metabolites are pinned (±20 %) to the median of 59 NCI-60 tumour cell lines (Jain et al. 2012),
  together with a measured ATP maintenance cost; unmeasured organic products may only leave in traces.
  Four more sets come from cells that are not tumours: HEK293 ([Dietmair et al. 2012](https://doi.org/10.1371/journal.pone.0043394)),
  primary human fibroblasts proliferating and quiescent ([Lemons et al. 2010](https://doi.org/10.1371/journal.pbio.1000514))
  and human liver slices ex vivo ([Grankvist et al. 2024](https://doi.org/10.1038/s42255-024-01119-3)).
  Choose "None" to let FBA choose freely. Values, conversion and sources: Docs › Measured values.
- **Medium and sources** — concentration (mM) of each metabolite. Extracellular ones limit their uptake
  (`Vmax·C/(Km+C)`); any other metabolite is injected into its compartment. In steady-state mode the
  fluxes are recomputed automatically when a value changes (while **Auto** is on).
- **⚛ Tracer** — opens the molecule editor: click atoms to label them (¹³C, ¹⁵N, ¹⁸O, ³⁴S) and choose the
  labelled fraction. Colour then shows enrichment; selecting a metabolite shows its label atom by atom,
  and the summary shows where the label ends up.
- **Knockout / knockdown** — add a gene or a reaction and set its residual activity (0 % = knockout).
  Genes are evaluated with the gene-protein-reaction rule (`and` = minimum, `or` = maximum: isoenzymes
  compensate). A knockdown limits the flux to that fraction of the flux in the unperturbed reference
  simulation, which is computed automatically with the same medium and objective.
- **Filter** — "Labelled only" hides whatever receives no labelled atoms; "Changed flux only" hides the
  reactions whose flux does not change (±2 %) against the reference and colours by increase/decrease.
- **Isotopologues** — with a tracer, the metabolite panel shows the mass isotopologue distribution (M+0, M+1…),
  obtained by sampling single molecules backwards through the atom maps: the final one in steady state, the
  one at the selected time (and its course over time) in dynamic mode. Without a tracer it shows natural abundance.
- **Scheduled events** (dynamic mode) — add a metabolite, labelled or not, at a given hour (a labelling pulse),
  or replace the whole medium (a chase).
- **Lines** (selector below the map, left) — what the lines between groups carry: transferable carbon or
  nitrogen atoms (carrier moieties such as CoA, UDP or thiamine diphosphate are left out by tracing them through
  the atom maps), all redox carriers together (electron pairs), NADH, NADPH, ubiquinol, ATP (with GTP/UTP/CTP), or no lines and the free energy (ΔG′m)
  dissipated by each group. In a pathway map, ΔG′m colours each reaction, and the reaction card warns when the
  only direction a reaction is allowed (or the direction of its flux) is thermodynamically impossible
  (ΔG′m above +100 kJ/mol even at the low end of the estimate). Details in Docs › The interface.
- **Compare** — save the current situation as a scenario, change anything (medium, pulse, knockout, tracer,
  model edits) and pick the scenario: the summary (exchanges, pathways, labelling) and the metabolite panel
  (paired isotopologue bars) show scenario → now. A selector on the map (keys 1, 2, 3) shows condition A,
  condition B or the change A → B: colour = fold change of the flux size (asinh scale, finite at zero),
  width = |B − A|, and reactions that reverse, switch on or switch off are marked apart.
- **✎ Edit model** — add reactions (stoichiometry, bounds, GPR, atom map) and metabolites (new compounds from a
  SMILES, or existing ones in another compartment), change bounds / GPR of published reactions, remove
  reactions and metabolites. Every edit is validated (element balance, GPR syntax, dead ends, atom-map
  sanity…); the requirements are in Docs › Editing the model. Edits are operations replayed on the published
  model and kept per model in the browser. RDKit (WebAssembly) is loaded on first use for SMILES and
  automatic atom maps; `tools/map_reaction.py` gives a RXNMapper map to paste.
- **Download / Import** — tables (CSV), charts (SVG), the map (PNG), the settings and the whole session (JSON:
  model edits, settings, scenarios), chosen with checkboxes. Import reads a `session.json`, `model_edits.json`
  or the downloaded `.zip` and recomputes the scenarios.
- **Panels** — drag the border of a side panel to resize it (double-click restores it).
- **Steady state / Dynamic** — the `?` button explains both methods.
- **Simulate / Auto** — Simulate solves the model with the current inputs; the Auto switch next to it re-runs after
  every change (on by default in Steady state, off in Dynamic, remembered per mode).
- **Cellular objective** — built-in objectives (growth, maximum ATP, glutathione, and cell functions: urea, gluconeogenesis, ketone bodies, bile acids, lipogenesis, neurotransmitters, cortisol, NO, heme, creatine;
  kidney (ammonia, guanidinoacetate, arginine), muscle (glutamine and alanine release, oxidative ATP), immune cells (protein
  secretion, nitric oxide, itaconate, prostaglandin E2, leukotriene B4, thromboxane A2, histamine, spermidine) and microbial
  products (ethanol, glycerol, acetate, succinate, lactate, formate, butanediol, fusel alcohols, lysine)), any
  reaction from the search box, and objectives you save yourself. Docs › Flux balance analysis › Choosing the objective.
- **Secondary objective** — optimise a second objective while keeping the first at a chosen fraction of its
  optimum (epsilon-constraint, no weighted sums), and draw the trade-off curve between the two (11 points).
  Docs › Flux balance analysis › Secondary objective and trade-off curve.
- **Light / dark mode** — the moon/sun button at the top right (dark by default; also applies to the Docs).

### Structure

```
index.html, css/, js/        application (no build dependencies)
js/core/                     FBA/pFBA (fba.js), medium (medium.js), isotope tracing (tracer.js), GPR rules (gpr.js), worker
js/core/isotopologues.js     isotopologue distributions (Monte-Carlo over atom maps)
js/core/measured.js          measured exchange fluxes (NCI-60, HEK293, fibroblasts, liver) and ATP maintenance
js/core/contexts.js          cell-type contexts: genes off, blocked reactions, search
js/core/exodata.js, fitexchange.js   spent-medium rate estimation, C/N/RQ balance, LP flux consistency fit
js/core/metcontrast.js       intracellular metabolomics contrast, permutation null, reaction Δ(ΔG′)
js/core/reginfer.js          sparse exact ULM TF activity inference and multi-omic bottleneck classification
js/core/edits.js, chem.js    model edits (apply, validate, layout) and chemistry (SMILES, atom maps via RDKit)
js/ui/editor.js, compare.js, demos.js  model editor dialogs; scenarios/comparison; worked examples
js/celllayout.js, js/cascade.js, js/i18n.js   cell and cascade layouts; EN/ES texts
js/export/                   results download: datasets, SVG charts, zip writer
docs.html, docs/             documentation in 7 languages
vendor/highs/                HiGHS LP solver compiled to WebAssembly (MIT)
vendor/rdkit/                RDKit MinimalLib 2026.03.6, WebAssembly (BSD-3), used only by the model editor
data/<model>/                model.json, structures.json, atommaps.json, layout.json, thermo.json, contexts.json, regulons.json
```

The preprocessing, testing and validation scripts used to generate the files in `data/` are not part of the web
application and live in a separate repository: **[MetfluxTools](https://github.com/JonatanFernandez/MetfluxTools)**.

**Licence of the cell-type and regulatory data.** `data/human-gem/contexts.json` is derived from the Human Protein Atlas
(version 26.0, CC BY-SA 4.0) and is distributed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), with attribution to the Human Protein Atlas;
its cell line descriptions come from Cellosaurus 57.0 (CC BY 4.0). `data/mouse-gem/contexts.json` is derived
from Bgee 15.2 and is CC0. `data/human-gem/regulons.json`, `data/mouse-gem/regulons.json` and
`data/rat-gem/regulons.json` are derived from CollecTRI (Müller-Dott et al. 2023) via OmniPath and distributed
under CC BY-SA 4.0; the mouse and rat networks are CollecTRI mapped by orthology, not curated in those species.
`data/ecoli-gem/regulons.json` is derived from RegulonDB v14.5.1 (Salgado et al. 2023, CCG-UNAM; academic licence).
The licence is also written inside each file (`meta.license`).
`data/tasks/metabolicTasks_Essential.txt` is copied unchanged from Human-GEM 2.1.1 (CC BY 4.0, Robinson et al. 2020);
it is used to build cell types from the user's RNA-seq data in the browser.

To share or host the app you only need `index.html`, `docs.html`, `docs/`, `css/`, `js/`, `vendor/` and `data/` (about 73 MB, 7 MB of it RDKit).
Python is used only for preprocessing, never at run time.

### Rebuilding the data or adding another model

The code used to generate the preprocessed assets in `data/` (models, atom maps, layouts, Gibbs energies,
expression contexts) and to run the tests and validations lives in
**[MetfluxTools](https://github.com/JonatanFernandez/MetfluxTools)**. Clone it into `tools/` at the root of this
repository:

```bash
git clone https://github.com/JonatanFernandez/MetfluxTools.git tools
```

Preprocessing converts a repository in [standard-GEM](https://github.com/MetabolicAtlas/standard-GEM)
format (`model/*.yml` + `model/*.tsv`) into the JSON files the app reads. The source zips are not in this
repository: download `Human-GEM-2.1.1.zip`, `Mouse-GEM-1.8.0.zip`, `Rat-GEM-1.8.0.zip`, `Zebrafish-GEM-1.6.0.zip`, `Fruitfly-GEM-1.7.0.zip` and `Worm-GEM-1.8.0.zip` from the
[Human-GEM](https://github.com/SysBioChalmers/Human-GEM),
[Mouse-GEM](https://github.com/SysBioChalmers/Mouse-GEM), [Rat-GEM](https://github.com/SysBioChalmers/Rat-GEM), [Zebrafish-GEM](https://github.com/SysBioChalmers/Zebrafish-GEM), [Fruitfly-GEM](https://github.com/SysBioChalmers/Fruitfly-GEM) and [Worm-GEM](https://github.com/SysBioChalmers/Worm-GEM) releases (plus `yeast-GEM` and `iML1515`; full provenance and checksums in `tools/DATA_SOURCES.md`) and put them in the project root.

```bash
python3 -m venv --without-pip tools/.venv
python3 -m pip --python tools/.venv/bin/python install rdkit pyyaml igraph rxnmapper \
    torch --extra-index-url https://download.pytorch.org/whl/cpu

tools/build_all.sh                      # all eight models

# another model (zip or folder):
tools/.venv/bin/python tools/build_model.py   Other-GEM.zip other-gem [--structures-from human-gem]
tools/.venv/bin/python tools/build_atommaps.py other-gem
tools/.venv/bin/python tools/build_layout.py   other-gem
tools/.venv/bin/python tools/write_manifest.py
```

`--structures-from` reuses the SMILES of another model that is already built when the new one lacks them
(the case of Mouse-GEM and Rat-GEM, which shares identifiers with Human-GEM).

Free energies of reaction (`data/<slug>/thermo.json`, optional) come from
[eQuilibrator](https://equilibrator.weizmann.ac.il/) run locally, in a separate environment because of its
dependencies. The first run downloads the eQuilibrator compound database (1.3 GB, Zenodo) into `~/.cache`:

```bash
python3 -m venv --without-pip tools/.venv-thermo
python3 -m pip --python tools/.venv-thermo/bin/python install equilibrator-api==0.8.1 rdkit
tools/.venv-thermo/bin/python tools/build_thermo.py human-gem   # and mouse-gem
```

Cell-type contexts (`data/<slug>/contexts.json`, optional) are built from the Human Protein Atlas
(`rna_celline.tsv.zip`, `rna_single_cell_type.tsv.zip`, `rna_tissue_consensus.tsv.zip`), Cellosaurus
(`cellosaurus.txt`) and Bgee (`Mus_musculus_expr_simple.tsv.gz`), downloaded into `tools/cache/expression/`.
The last step runs the 57 essential metabolic tasks for every context with HiGHS and takes hours; it can be
split into shards that run in parallel:

```bash
tools/.venv/bin/python tools/contexts/cellline_meta.py       # HPA cell lines -> Cellosaurus
tools/.venv/bin/python tools/contexts/build_expression.py    # expression of the model genes per context
node tools/contexts/build_contexts.mjs human-gem 0/2 &        # genes off, task rescue (shard 0 of 2)
node tools/contexts/build_contexts.mjs human-gem 1/2
node tools/contexts/build_contexts.mjs human-gem merge 2      # -> data/human-gem/contexts.json
node tools/contexts/build_contexts.mjs mouse-gem 0/1 && node tools/contexts/build_contexts.mjs mouse-gem merge 1
```

### Atom-to-atom maps

`build_atommaps.py` assigns heavy-atom transitions to every reaction:

1. identity for the same metabolite on both sides (transports);
2. cofactor pairs (ATP/ADP, NAD⁺/NADH…) and amino acid ↔ keto acid pairs of transaminases (pairs listed in
   `tools/atommap_overrides.json`) by common substructure or explicit rule;
3. [RXNMapper](https://github.com/rxn4chemistry/rxnmapper) for the rest;
4. maximum common substructure for reactions with R groups or that are too long (low confidence);
5. CoA moiety: in acyl transfers the CoA atoms of a product are mapped onto the CoA of a substrate;
6. `tools/atommap_overrides.json`: manual corrections (transketolase, transaldolase, 6-phosphogluconate
   dehydrogenase, aconitase), checked with `tools/inspect_map.py`.

The tracer counts CoA atoms that remain unmapped as unlabelled. Coverage in Human-GEM: 10,554 of 11,094
non-exchange reactions. Where there is no map, the label is
spread over the products and the metabolite is drawn with a dashed border.

### Tests

The test and validation scripts are in **[MetfluxTools](https://github.com/JonatanFernandez/MetfluxTools)** (cloned into `tools/`):

```bash
node tools/test_fba.mjs    [human-gem|mouse-gem] [default|plasmax|hplm]   # FBA/pFBA on a built-in medium
node tools/test_tracer.mjs [human-gem|mouse-gem]   # label fates in central metabolism
node tools/test_isotopologues.mjs [human-gem|mouse-gem]   # isotopologue sampler vs positional tracer
node tools/test_dynamic.mjs [human-gem|mouse-gem]   # scheduled events (pulse, chase) and isotopologues over time
node tools/test_edits.mjs [human-gem|mouse-gem]   # model edits: validation, SMILES, atom maps, FBA + tracing on the edited model
tools/.venv/bin/python tools/map_reaction.py "A.B>>C.D"   # RXNMapper atom map to paste into the reaction editor
node tools/diag_medium.mjs [human-gem|mouse-gem]   # which medium components limit the objective
tools/.venv/bin/python tools/inspect_map.py human-gem MAR04145   # show the atom map of a reaction
```

### Limitations

- **Regulatory networks cover four of the eight models.** Human, mouse, rat and *E. coli* have signed
  TF → target networks; *Drosophila*, *C. elegans*, zebrafish and yeast do not, and this is a limit of the
  sources rather than of the application. Everything the regulatory layer does rests on each edge carrying a
  **sign**: the predicted direction is the regulator's own change times the sign of the edge, so without it the
  direction on the map, the concordance with metabolomics and the up/down reading all collapse, and only a
  weaker "is this regulon coherently perturbed" question survives. CollecTRI, which supplies human, mouse and
  rat, serves no other organism (the API rejects 7227, 6239 and 7955). For *Drosophila* and *C. elegans* the
  available resources are REDfly (curated cis-regulatory **sequences**, whose predicted modules are not even
  linked to target genes) and modERN (ChIP-seq binding profiles, and binding is not regulation); a sign could be
  **derived** from modERN's RNAi knockdown series, which is legitimate but conflates direct with indirect
  targets and comes from one assay in whole embryos, so it would not be of comparable quality and would have to
  be labelled as such. YEASTRACT+ holds 215,398 associations for yeast, but 76.9 % rest on expression evidence
  only, which has the same indirectness problem and would need filtering by binding evidence, plus a licence
  check. For zebrafish we found nothing usable. Adding any of these is pending a source good enough to justify
  presenting it beside the curated ones.

- FBA uses neither concentrations nor kinetics: concentration only sets the maximum uptake. The default
  `Vmax`/`Km` values (`js/core/medium.js`) are orders of magnitude for cultured mammalian cells.
- Plasmax and HPLM: components the models do not represent (selenite, manganese, vanadate, nitrate,
  p-aminobenzoate, methyl acetoacetate, phenol red) are left out; the fatty acids and fat-soluble vitamins
  that serum provides are added at the standard medium's values, and the uptake kinetics of the extra
  metabolites are generic. Williams E: menadione, manganese and nitrate are left out.
- Dynamic mode assumes a uniform intracellular pool size: labelling times are indicative only.
- Isotopologue distributions are a 2,000-molecule sample at isotopic steady state (about ±1 percentage point),
  without natural abundance. In dynamic mode their timing depends on the assumed pool size.
- Hydrogen (²H) is not traced.
- FBA has alternative optima: when comparing against the reference, flux changes may appear that are not
  caused by the perturbation. With pFBA enabled the comparison is more stable.
- A partial knockdown of a reaction with no flux in the reference does not constrain it; in dynamic mode
  the knockdown limits are taken from the first time point of the reference.
- Cell types only switch off enzymes whose mRNA is not detected (a cut-off, not proof of absence); they do
  not scale fluxes with expression, and the expression was measured in each line's own medium or in vivo.
- Mouse-GEM 1.8.0 and Rat-GEM 1.8.0 ship `MAR00021` as their objective, which is not a growth rate (about 0.00016). The default
  objective, "Growth (generic biomass)", is therefore MAR13082, Human-GEM's biomass reaction, present but closed in
  both models and opened only while it is the objective: 0.0370 h⁻¹ in the standard medium, as Human-GEM.
- Zebrafish-, Fruitfly- and Worm-GEM use the human cell biomass, mammalian uptake kinetics and ΔG at 37 °C,
  with no measured fluxes and short Bgee tissue lists. Fruitfly-GEM defaults to Schneider's medium (S2 cells).
  Worm-GEM is built without 2,3-bisphosphoglycerate in the biomass metabolite pool (C. elegans lacks the mutase).
- yeast-GEM and iML1515 are read through Human-GEM names (`tools/convert_foreign.py`: MetaNetX, BiGG,
  ChEBI, KEGG, name); about half of their metabolites match. The others take their structure from the model
  or from MetaNetX 4.5 (`tools/fetch_mnx_structures.py`, only structures MNXref takes from ChEBI, SwissLipids
  or LIPID MAPS), so atom maps cover 92 % (E. coli) and 89 % (yeast) of the internal reactions. Their media
  (M9, Verduyn, YNB, SC), measured fluxes (Jouhten 2008; Zampieri 2019; Castaño-Cerezo 2009) and laboratory
  strains are in the docs. Yeast-GEM overestimates aerobic batch growth (0.66 against about 0.37 h⁻¹).
- Validation (docs › Data sources): 96.5 % of the Human-GEM atom maps agree with the 479 comparable curated
  Recon 3D mappings (Preciat Gonzalez 2017); with the fluxes of a published ¹³C flux analysis, predicted
  isotopologues of E. coli amino acids match 14 tracer experiments to 0.9 mol% (Crown 2015). In human liver
  tissue a single FBA solution does not reproduce measured labelling (unlabelled endogenous sources and
  exchange fluxes are missing): read predicted isotopologues as consequences of the model.
- The models are used as published. A few reactions can only run in a thermodynamically impossible direction
  (cytochrome P450 and CMP-Neu5Ac hydroxylase reactions written backwards in Human-GEM 2.1.1 and the animal
  models, already fixed in its development branch; a pyridoxal oxidase in yeast-GEM); the reaction card flags
  them. None carries flux in the default runs.


### Licence and citation

Copyright © 2026 Jonatan Fernández-García.

The code of MetfluxLive is free software, released under the GNU General Public License version 3 or
(at your option) any later version (GPL-3.0-or-later, see `LICENSE`).

The files in `data/` are derived from public resources and keep their licences:
- Human-GEM, Mouse-GEM, Rat-GEM, Zebrafish-GEM, Fruitfly-GEM, Worm-GEM and yeast-GEM: CC BY 4.0;
- iML1515: as distributed by [BiGG Models](http://bigg.ucsd.edu) (University of California terms;
  commercial use may need their permission);
- human cell-type contexts: CC BY-SA 4.0 (Human Protein Atlas); other animal contexts: CC0 (Bgee);
- signed TF regulons: human and mouse derived from CollecTRI (Müller-Dott et al. 2023) via OmniPath (CC BY-SA 4.0);
  *E. coli* derived from RegulonDB v14.5.1 (Salgado et al. 2023, CCG-UNAM; academic licence);
- metabolite structures from MetaNetX/MNXref: CC BY 4.0, used only when their source is ChEBI, SwissLipids
  or LIPID MAPS (CC BY 4.0).

Third-party libraries in `vendor/` keep their own licences: HiGHS (MIT) and RDKit MinimalLib (BSD-3-Clause).

To cite MetfluxLive, see `CITATION.cff` (GitHub shows it as "Cite this repository").

---

## Español

Visualizador local de flujos metabólicos y trazado isotópico sobre modelos metabólicos de escala
genómica (Human-GEM 2.1.1, Mouse-GEM 1.8.0, Rat-GEM 1.8.0, Zebrafish-GEM 1.6.0, Fruitfly-GEM 1.7.0, Worm-GEM 1.8.0, yeast-GEM 9.1.1 y E. coli iML1515 incluidos, ya preprocesados). Todo se ejecuta en el navegador.

### Abrir

Abre `index.html` con **Five Server** (o cualquier servidor estático; no funciona con `file://`
porque usa módulos ES, un Web Worker y WebAssembly). No necesita conexión.

### Uso

- **Docs** — el botón «Docs» abre `docs.html`: métodos explicados para no especialistas (FBA, estacionario
  frente a dinámico, trazado isotópico), fuentes de datos, limitaciones y experimentos in silico resueltos.
- **Idioma** — selector arriba a la derecha: inglés (por defecto), español, portugués (Brasil), italiano, francés, alemán y
  griego (los nombres de metabolitos, reacciones y rutas vienen del modelo y no se traducen). Inglés y español están en
  `js/i18n.js`, los demás en `js/i18n/<código>.js`; una cadena que falte se muestra en inglés. Los Docs existen en los siete
  idiomas (inglés y español en `docs.html`, los demás en `docs/<código>.html`, que se cargan al elegirlos).
- **Mapa global** — «Agrupar: cascada» (por defecto) ordena las rutas de arriba abajo por pasos de reacción desde el medio (ver abajo); «Agrupar: célula» reparte las reacciones
  por compartimento en un esquema de célula (citosol, mitocondria, retículo, Golgi, lisosoma, peroxisoma,
  núcleo, medio extracelular) y coloca sobre cada membrana las reacciones que la cruzan; «Agrupar: rutas»
  dibuja una burbuja por ruta; «Agrupar: cascada» ordena las rutas (y, dentro del mapa de una ruta, los
  metabolitos) de arriba abajo según sus pasos de reacción desde el medio: el medio arriba, el transporte
  hacia la célula como paso 0 y después los pasos intracelulares. Las líneas son el
  carbono que un grupo produce y otro consume. Doble clic en un grupo abre el mapa de su ruta
  (○ metabolito, ◆ reacción, cofactores ocultos).
- **Buscador** (`Ctrl+K`) — metabolitos (nombre, fórmula, KEGG/HMDB/ChEBI), reacciones (nombre, ID, EC),
  genes/enzimas y rutas.
- **Medio de cultivo** — el selector al principio de «Medio y fuentes» cambia entre un medio estándar tipo
  DMEM/F-12, **Plasmax** y **HPLM** (medios fisiológicos; concentraciones de la Tabla S1 de
  [Vande Voorde et al. 2019](https://pubmed.ncbi.nlm.nih.gov/30613774/)) y **Williams E**, el usado para
  cortes de hígado humano ([Grankvist et al. 2024](https://doi.org/10.1038/s42255-024-01119-3)). «guardar…» almacena el medio actual
  con tus cambios bajo un nombre (en el localStorage del navegador, común a ambos modelos); «restaurar»
  descarta los cambios. Las secciones del panel izquierdo se pliegan haciendo clic en su título.
- **Tipo celular (expresión génica)** — apaga los genes que no se detectan en una línea celular elegida
  (1.206 del atlas de líneas celulares del [Human Protein Atlas](https://www.proteinatlas.org), tumorales y
  no tumorales, descritas con [Cellosaurus](https://www.cellosaurus.org)), un tipo celular (155, tipos
  celulares del HPA), un tejido (consenso de tejidos del HPA) o el panel NCI-60, y en Mouse-GEM en 276 tejidos
  y tipos celulares de [Bgee](https://www.bgee.org). Las reacciones que se quedan sin enzima detectada se
  bloquean o, como opción, sólo se encarecen en el pFBA; el modo por defecto conserva los complejos grandes (5 o
  más subunidades) si se detecta al menos el 80 % de sus subunidades y nunca apaga los genes del ADN
  mitocondrial (una sola subunidad no detectada, NDUFA6, eliminaba el complejo I de 469 tipos celulares). Los genes que necesitan las 57 tareas metabólicas
  esenciales de Human-GEM se vuelven a encender. Desactivado por defecto. Fuentes, umbral y preprocesado:
  Docs › Tipos celulares.
  Tu propia tabla de RNA-seq (TPM o similar, una fila por gen) se puede convertir en un tipo celular con el
  mismo procedimiento, en el navegador; los datos no salen del ordenador (Docs › Tipos celulares › Tus propios datos).
- **Leer el resultado** — un resumen en frases, qué limita el objetivo (costes reducidos), el valor de cada
  metabolito (precios sombra), el balance de ATP/NADH/NADPH por ruta, planos de fase de un nutriente, rangos de
  flujo (FVA) de una reacción y de una ruta entera (sin ciclos, con «qué puede sustituirla»), un cribado de
  genes esenciales y un comparador de dos tipos celulares en el catálogo. Docs › Análisis de balance de flujos.
- **Tres pestañas de trabajo (*Simular · Comparar · Interpretar*)** — el panel izquierdo se organiza en tres
  pestañas: *Simular* (medio, tipo celular, knockouts, trazadores, ediciones del modelo), *Comparar* (escenarios
  guardados, mapa de cambio A→B, cribado condicional de auxotrofías por nutrientes y cribado condicional de
  esencialidad / letalidad sintética), e *Interpretar* (ajuste de exometabolómica, contraste de metabolómica
  intracelular e inferencia regulatoria de factores de transcripción).
- **Importador de exometabolómica (*Interpretar*)** — pega o arrastra una serie temporal de concentraciones en
  medio gastado (con recuento celular u OD600) para calcular tasas específicas de captación/excreción
  (mmol/gDW/h), tasa de crecimiento, cociente respiratorio y cierre de carbono/nitrógeno, comprobar su
  consistencia con el modelo mediante un ajuste LP L1 (`js/core/fitexchange.js`) y aplicar las tasas medidas
  directamente a la simulación. Docs › Valores medidos.
- **Metabolómica intracelular (*Interpretar*)** — pega una tabla ancha de abundancias (metabolitos × muestras,
  con fila de grupo o patrón de división) para calcular pruebas t de Welch, FDR de Benjamini-Hochberg, cocientes
  diagnósticos de redox/energía, señales de cuello de botella sustrato/producto con prueba nula no paramétrica por
  permutación de muestras, cambios de $\Delta(\Delta G')$ por reacción, superposición en vivo sobre el mapa
  (color por log2FC, halo en $q < 0{,}05$, reacciones no observables y cuellos de botella candidatos) y prueba
  directa en el modelo con «Probar bloqueo en el modelo». Docs › Metabolómica intracelular.
- **Reguladores a partir de RNA-seq diferencial (*Interpretar*)** — pega una tabla de expresión diferencial
  (gen + log2FC o estadístico con signo) para puntuar la actividad de factores de transcripción (TF) mediante
  modelo lineal univariante disperso exacto (ULM, equivalente a decoupleR; Badia-i-Mompel et al. 2022) frente a
  regulones con signo incluidos para **Human-GEM** (917 TFs, CollecTRI vía OmniPath, CC BY-SA 4.0), **Mouse-GEM**
  (838 TFs, ortología CollecTRI, CC BY-SA 4.0), **Rat-GEM** (837 TFs, ortología CollecTRI, CC BY-SA 4.0; cobertura
  más fina, 425 genes metabólicos diana) y **E. coli iML1515** (239 TFs, RegulonDB v14.5.1, licencia
  académica). Al combinarse con metabolómica intracelular, MetfluxLive distingue cuellos de botella
  **transcripcionales** de **postranscripcionales / alostéricos**, traza cadenas de 3 pasos
  `TF → ARNm → metabolito`, marca las reacciones reguladas en el mapa y prueba en FBA el escalado enzimático
  impulsado por un TF. Docs › Hipótesis regulatorias.
- **Ejemplos guiados (*Ejemplos*)** — seis experimentos reproducibles construidos a partir de datos publicados y
  alineados con cada tipo de análisis de la documentación, cada uno con su propio recorrido paso a paso (dónde
  pegar los datos, formato exacto de tabla y tour por los resultados): (1) knockout de `SDHB`, comparación A→B y
  cribados condicionales (Cardaci et al. 2015), (2) trazado isotópico con `[U-13C6]glucosa` en normoxia frente a
  hipoxia y barras pareadas de citrato, (3) ajuste de exometabolómica en medio gastado de HEK293 (Dietmair et al.
  2012), (4) contraste de metabolómica intracelular en HEK293 productora frente a parental, Δ(ΔG′) y capa en el mapa
  (Dietmair et al. 2012), (5) tipo celular propio desde RNA-seq TPM de HCT116 (DepMap 26Q3), y (6) inferencia de
  reguladores a partir de RNA-seq diferencial en *E. coli* `ΔarcA` frente a WT (Pal et al. 2020, GSE153906).
- **Navegación y apariencia** — atrás/adelante (‹ ›, Alt+←/→), reacciones de otras rutas alrededor de un
  metabolito seleccionado, mapa centrado en cualquier metabolito o reacción (menú del clic derecho, o
  «adaptable» al hacer clic) y un diálogo de Apariencia (fondos, acento, color del flujo, escalas de color,
  compartimentos aptos para daltonismo). Docs › La interfaz; las unidades en Docs › Glosario › Unidades.
- **Móviles** — en una pantalla estrecha el mapa ocupa toda la pantalla y una barra inferior abre Ajustes,
  Resultados y Más como paneles deslizantes; pellizco para zoom, doble toque para abrir una ruta, pulsación
  larga para el menú del nodo. Se puede añadir a la pantalla de inicio (manifiesto web) y abrir a pantalla completa.
- **Trazadores y diseño de experimentos** — 40 trazadores comerciales (números de catálogo de Cambridge Isotope
  Laboratories, agrupados por uso, con referencias) marcan un nutriente con un clic; «Diseñar un experimento con
  trazadores» ordena trazadores y metabolitos medibles para distinguir escenarios guardados o resolver un flujo.
  La abundancia natural se puede añadir a las distribuciones de isotopólogos. Docs › Trazado isotópico.
- **Flujos de intercambio medidos** — por defecto, la captación y excreción de glucosa, lactato, glutamina y
  otros 15 metabolitos se fijan (±20 %) a la mediana de 59 líneas tumorales del NCI-60 (Jain et al. 2012),
  junto con un gasto de ATP de mantenimiento medido; los productos orgánicos no medidos solo salen en trazas.
  Hay cuatro conjuntos más de células no tumorales: HEK293 ([Dietmair et al. 2012](https://doi.org/10.1371/journal.pone.0043394)),
  fibroblastos humanos primarios proliferando y quiescentes ([Lemons et al. 2010](https://doi.org/10.1371/journal.pbio.1000514))
  y cortes de hígado humano ex vivo ([Grankvist et al. 2024](https://doi.org/10.1038/s42255-024-01119-3)).
  Elige «Ninguno» para que el FBA elija libremente. Valores, conversión y fuentes: Docs › Valores medidos.
- **Medio y fuentes** — concentración (mM) de cada metabolito. Los extracelulares limitan su captación
  (`Vmax·C/(Km+C)`); cualquier otro metabolito se inyecta en su compartimento. En modo estacionario
  los flujos se recalculan solos al cambiar un valor (mientras **Auto** esté activado).
- **⚛ Trazador** — abre el editor de moléculas: clic en los átomos para marcarlos (¹³C, ¹⁵N, ¹⁸O, ³⁴S)
  y elige la fracción marcada. El color pasa a indicar enriquecimiento; al seleccionar un metabolito
  se ve la marca átomo a átomo, y el resumen muestra el destino de la marca.
- **Knockout / knockdown** — añade un gen o una reacción y fija su actividad residual (0 % = knockout).
  Los genes se evalúan con la regla gen-proteína-reacción (`and` = mínimo, `or` = máximo: las isoenzimas
  compensan). Un knockdown limita el flujo a esa fracción del flujo de la simulación de referencia sin
  perturbar, que se calcula automáticamente con el mismo medio y objetivo.
- **Filtro** — «Solo con marca» oculta lo que no recibe átomos marcados; «Solo flujo alterado» oculta las
  reacciones cuyo flujo no cambia (±2 %) frente a la referencia y colorea por aumento/disminución.
- **Isotopólogos** — con un trazador, la ficha del metabolito muestra la distribución de isotopólogos (M+0,
  M+1…), obtenida muestreando moléculas hacia atrás a través de los mapas atómicos: la final en modo
  estacionario; la del instante seleccionado (y su evolución) en modo dinámico. Sin trazador muestra la
  abundancia natural.
- **Eventos programados** (modo dinámico) — añadir un metabolito, marcado o no, a una hora dada (un pulso de
  marcaje), o sustituir el medio entero (una caza).
- **Líneas** (selector abajo a la izquierda del mapa) — qué llevan las líneas entre grupos: átomos de carbono
  o nitrógeno transferibles (los restos transportadores como CoA, UDP o tiamina difosfato se excluyen
  trazándolos por los mapas atómicos), todos los transportadores redox juntos (pares de electrones), NADH, NADPH, ubiquinol, ATP (con GTP/UTP/CTP), o ninguna línea y la
  energía libre (ΔG′m) que disipa cada grupo. En el mapa de una ruta, ΔG′m colorea cada reacción, y la ficha de
  la reacción avisa cuando el único sentido permitido (o el sentido de su flujo) es termodinámicamente imposible
  (ΔG′m por encima de +100 kJ/mol incluso en el extremo bajo de la estimación). Detalles en Docs › La interfaz.
- **Comparar** — guarda la situación actual como escenario, cambia lo que quieras (medio, pulso, knockout,
  trazador, ediciones del modelo) y elige el escenario: el resumen (intercambios, rutas, marcaje) y la ficha
  del metabolito (barras pareadas de isotopólogos) muestran escenario → ahora. Un selector en el mapa (teclas
  1, 2, 3) muestra la condición A, la B o el cambio A → B: color = cuántas veces cambia el tamaño del flujo
  (escala asinh, finita en cero), grosor = |B − A|, y las reacciones que se invierten, se encienden o se
  apagan se marcan aparte.
- **✎ Editar modelo** — añadir reacciones (estequiometría, límites, GPR, mapa de átomos) y metabolitos
  (compuestos nuevos a partir de un SMILES, o existentes en otro compartimento), cambiar límites / GPR de
  reacciones publicadas, quitar reacciones y metabolitos. Cada edición se valida (balance de elementos,
  sintaxis GPR, callejones sin salida, coherencia del mapa de átomos…); los requisitos están en Docs ›
  Editar el modelo. Las ediciones son operaciones que se reaplican sobre el modelo publicado y se guardan por
  modelo en el navegador. RDKit (WebAssembly) se carga al primer uso para los SMILES y los mapas automáticos;
  `tools/map_reaction.py` da un mapa de RXNMapper para pegar.
- **Descargar / Importar** — tablas (CSV), gráficas (SVG), el mapa (PNG), la configuración y la sesión completa
  (JSON: ediciones, ajustes, escenarios), elegidas con casillas. Importar lee un `session.json`, un
  `model_edits.json` o el `.zip` descargado y recalcula los escenarios.
- **Paneles** — arrastra el borde de un panel lateral para cambiar su ancho (doble clic lo restaura).
- **Estacionario / Dinámico** — el botón `?` explica ambos métodos.
- **Simular / Auto** — Simular resuelve el modelo con las entradas actuales; el interruptor Auto, a su lado, lo repite
  tras cada cambio (activado por defecto en Estacionario, desactivado en Dinámico, se recuerda por modo).
- **Objetivo celular** — objetivos predefinidos (crecimiento, máximo ATP, glutatión y funciones celulares: urea, gluconeogénesis, cuerpos cetónicos, ácidos biliares, lipogénesis, neurotransmisores, cortisol, NO, hemo, creatina;
  riñón (amonio, guanidinoacetato, arginina), músculo (liberación de glutamina y alanina, ATP oxidativo), células inmunes
  (secreción de proteína, óxido nítrico, itaconato, prostaglandina E2, leucotrieno B4, tromboxano A2, histamina, espermidina) y
  productos microbianos (etanol, glicerol, acetato, succinato, lactato, formiato, butanodiol, alcoholes de fusel, lisina)),
  cualquier reacción del buscador y objetivos que guardes tú. Docs › Balance de flujos › Elegir el objetivo.
- **Objetivo secundario** — optimiza un segundo objetivo manteniendo el primero en una fracción elegida de su
  óptimo (restricción épsilon, sin sumas ponderadas), y dibuja la curva de compromiso entre ambos (11 puntos).
  Docs › Balance de flujos › Objetivo secundario y curva de compromiso.
- **Modo claro / oscuro** — el botón de luna/sol arriba a la derecha (oscuro por defecto; también se aplica a los Docs).

### Estructura

```
index.html, css/, js/        aplicación (sin dependencias de compilación)
js/core/                     FBA/pFBA (fba.js), medio (medium.js), trazado isotópico (tracer.js), reglas GPR (gpr.js), worker
js/core/isotopologues.js     distribuciones de isotopólogos (Monte Carlo sobre los mapas atómicos)
js/core/measured.js          flujos de intercambio medidos (NCI-60, HEK293, fibroblastos, hígado) y ATP de mantenimiento
js/core/contexts.js          tipos celulares: genes apagados, reacciones bloqueadas, búsqueda
js/core/exodata.js, fitexchange.js   tasas en medio gastado, balance C/N/RQ, ajuste LP de consistencia de flujos
js/core/metcontrast.js       contraste de metabolómica intracelular, prueba nula por permutación, Δ(ΔG′)
js/core/reginfer.js          inferencia ULM dispersa exacta de TFs y clasificación multiómica de cuellos de botella
js/core/edits.js, chem.js    ediciones del modelo (aplicar, validar, disposición) y química (SMILES, mapas de átomos con RDKit)
js/ui/editor.js, compare.js, demos.js  diálogos del editor del modelo; escenarios/comparación; ejemplos guiados
js/celllayout.js, js/cascade.js, js/i18n.js   disposición celular y en cascada; textos EN/ES
js/export/                   descarga de resultados: tablas, gráficas SVG, escritor de zip
docs.html, docs/             documentación en 7 idiomas
vendor/highs/                solver LP HiGHS compilado a WebAssembly (MIT)
vendor/rdkit/                RDKit MinimalLib 2026.03.6, WebAssembly (BSD-3), sólo para el editor del modelo
data/<modelo>/               model.json, structures.json, atommaps.json, layout.json, thermo.json, contexts.json, regulons.json
```

Los scripts de preprocesado, pruebas y validación usados para generar los ficheros de `data/` no forman parte de la
aplicación web y están en un repositorio aparte: **[MetfluxTools](https://github.com/JonatanFernandez/MetfluxTools)**.

**Licencia de los datos de tipos celulares y regulación.** `data/human-gem/contexts.json` deriva del Human Protein Atlas
(versión 26.0, CC BY-SA 4.0) y se distribuye bajo
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), con atribución al Human Protein Atlas; la
descripción de las líneas celulares sale de Cellosaurus 57.0 (CC BY 4.0). `data/mouse-gem/contexts.json`
deriva de Bgee 15.2 y es CC0. `data/human-gem/regulons.json` y `data/mouse-gem/regulons.json` derivan de
CollecTRI (Müller-Dott et al. 2023) vía OmniPath y se distribuyen bajo CC BY-SA 4.0.
`data/ecoli-gem/regulons.json` deriva de RegulonDB v14.5.1 (Salgado et al. 2023, CCG-UNAM; licencia académica).
La licencia también va escrita dentro de cada archivo (`meta.license`).
`data/tasks/metabolicTasks_Essential.txt` se copia sin cambios de Human-GEM 2.1.1 (CC BY 4.0, Robinson et al. 2020);
se usa para construir tipos celulares a partir del RNA-seq del usuario en el navegador.

Para compartir o alojar la app basta con `index.html`, `docs.html`, `docs/`, `css/`, `js/`, `vendor/` y `data/` (unos 73 MB, 7 de ellos RDKit).
Python solo se usa en el preprocesado, nunca en ejecución.

### Regenerar los datos o añadir otro modelo

El código usado para generar los ficheros preprocesados de `data/` (modelos, mapas atómicos, disposiciones, energías
de Gibbs y contextos de expresión) y ejecutar las pruebas y validaciones está en
**[MetfluxTools](https://github.com/JonatanFernandez/MetfluxTools)**. Clónalo en la carpeta `tools/` en la raíz de
este repositorio:

```bash
git clone https://github.com/JonatanFernandez/MetfluxTools.git tools
```

El preprocesado convierte un repositorio en formato [standard-GEM](https://github.com/MetabolicAtlas/standard-GEM)
(`model/*.yml` + `model/*.tsv`) en los JSON que lee la app. Los zip de origen no están en este
repositorio: descarga `Human-GEM-2.1.1.zip`, `Mouse-GEM-1.8.0.zip`, `Rat-GEM-1.8.0.zip`, `Zebrafish-GEM-1.6.0.zip`, `Fruitfly-GEM-1.7.0.zip` y `Worm-GEM-1.8.0.zip` de las publicaciones de
[Human-GEM](https://github.com/SysBioChalmers/Human-GEM),
[Mouse-GEM](https://github.com/SysBioChalmers/Mouse-GEM), [Rat-GEM](https://github.com/SysBioChalmers/Rat-GEM), [Zebrafish-GEM](https://github.com/SysBioChalmers/Zebrafish-GEM), [Fruitfly-GEM](https://github.com/SysBioChalmers/Fruitfly-GEM) y [Worm-GEM](https://github.com/SysBioChalmers/Worm-GEM) (además de `yeast-GEM` e `iML1515`; procedencia y sumas SHA-256 en `tools/DATA_SOURCES.md`) y ponlos en la raíz del proyecto.

```bash
python3 -m venv --without-pip tools/.venv
python3 -m pip --python tools/.venv/bin/python install rdkit pyyaml igraph rxnmapper \
    torch --extra-index-url https://download.pytorch.org/whl/cpu

tools/build_all.sh                      # los ocho modelos

# otro modelo (zip o carpeta):
tools/.venv/bin/python tools/build_model.py   Otro-GEM.zip otro-gem [--structures-from human-gem]
tools/.venv/bin/python tools/build_atommaps.py otro-gem
tools/.venv/bin/python tools/build_layout.py   otro-gem
tools/.venv/bin/python tools/write_manifest.py
```

`--structures-from` reutiliza los SMILES de otro modelo ya construido cuando el nuevo no los trae
(caso de Mouse-GEM y Rat-GEM, que comparte identificadores con Human-GEM).

La energía libre de reacción (`data/<slug>/thermo.json`, opcional) sale de
[eQuilibrator](https://equilibrator.weizmann.ac.il/) ejecutado en local, en un entorno aparte por sus
dependencias. La primera vez descarga la base de compuestos de eQuilibrator (1,3 GB, Zenodo) en `~/.cache`:

```bash
python3 -m venv --without-pip tools/.venv-thermo
python3 -m pip --python tools/.venv-thermo/bin/python install equilibrator-api==0.8.1 rdkit
tools/.venv-thermo/bin/python tools/build_thermo.py human-gem   # y mouse-gem
```

Los tipos celulares (`data/<slug>/contexts.json`, opcional) se generan a partir del Human Protein Atlas
(`rna_celline.tsv.zip`, `rna_single_cell_type.tsv.zip`, `rna_tissue_consensus.tsv.zip`), Cellosaurus
(`cellosaurus.txt`) y Bgee (`Mus_musculus_expr_simple.tsv.gz`), descargados en `tools/cache/expression/`.
El último paso ejecuta las 57 tareas metabólicas esenciales en cada contexto con HiGHS y tarda horas; se
puede repartir en fragmentos que corren en paralelo:

```bash
tools/.venv/bin/python tools/contexts/cellline_meta.py       # líneas del HPA -> Cellosaurus
tools/.venv/bin/python tools/contexts/build_expression.py    # expresión de los genes del modelo por contexto
node tools/contexts/build_contexts.mjs human-gem 0/2 &        # genes apagados, rescate por tareas (fragmento 0 de 2)
node tools/contexts/build_contexts.mjs human-gem 1/2
node tools/contexts/build_contexts.mjs human-gem merge 2      # -> data/human-gem/contexts.json
node tools/contexts/build_contexts.mjs mouse-gem 0/1 && node tools/contexts/build_contexts.mjs mouse-gem merge 1
```

### Mapas átomo a átomo

`build_atommaps.py` asigna transiciones de átomos pesados a cada reacción:

1. identidad para el mismo metabolito a ambos lados (transportes);
2. pares de cofactores (ATP/ADP, NAD⁺/NADH…) y pares aminoácido ↔ cetoácido de las transaminasas (listados
   en `tools/atommap_overrides.json`) por subestructura común o regla explícita;
3. [RXNMapper](https://github.com/rxn4chemistry/rxnmapper) para el resto;
4. subestructura común máxima para reacciones con grupos R o demasiado largas (baja confianza);
5. resto CoA: en las transferencias de acilo los átomos del CoA de un producto se mapean al CoA de un sustrato;
6. `tools/atommap_overrides.json`: correcciones manuales (transcetolasa, transaldolasa, 6-fosfogluconato
   deshidrogenasa, aconitasa), comprobadas con `tools/inspect_map.py`.

El trazador cuenta como no marcados los átomos del CoA que quedan sin mapear. Cobertura en Human-GEM:
10 554 de 11 094 reacciones no de intercambio. Donde no hay mapa, la marca se
reparte entre los productos y el metabolito se dibuja con borde discontinuo.

### Pruebas

Los scripts de pruebas y validación están en **[MetfluxTools](https://github.com/JonatanFernandez/MetfluxTools)** (clonado en `tools/`):

```bash
node tools/test_fba.mjs    [human-gem|mouse-gem] [default|plasmax|hplm]   # FBA/pFBA con un medio predefinido
node tools/test_tracer.mjs [human-gem|mouse-gem]   # destinos de marca en metabolismo central
node tools/test_isotopologues.mjs [human-gem|mouse-gem]   # isotopólogos frente al trazador posicional
node tools/test_dynamic.mjs [human-gem|mouse-gem]   # eventos programados (pulso, caza) e isotopólogos en el tiempo
node tools/test_edits.mjs [human-gem|mouse-gem]   # ediciones: validación, SMILES, mapas de átomos, FBA y trazado en el modelo editado
tools/.venv/bin/python tools/map_reaction.py "A.B>>C.D"   # mapa de átomos de RXNMapper para pegar en el editor
node tools/diag_medium.mjs [human-gem|mouse-gem]   # qué componentes del medio limitan el objetivo
tools/.venv/bin/python tools/inspect_map.py human-gem MAR04145   # ver el mapa atómico de una reacción
```

### Limitaciones

- **Las redes regulatorias cubren cuatro de los ocho modelos.** Humano, ratón, rata y *E. coli* tienen redes
  factor → diana con signo; *Drosophila*, *C. elegans*, pez cebra y levadura no, y es una limitación de las
  fuentes, no de la aplicación. Todo lo que hace la capa regulatoria descansa en que cada arista lleve
  **signo**: la dirección predicha es el cambio del propio regulador por el signo de la arista, así que sin él
  se caen la dirección en el mapa, la concordancia con metabolómica y la lectura al alza o a la baja, y solo
  sobrevive la pregunta más débil de si un regulón está coherentemente alterado. CollecTRI, que surte a humano,
  ratón y rata, no sirve ningún otro organismo (la API rechaza 7227, 6239 y 7955). Para *Drosophila* y
  *C. elegans* lo disponible es REDfly (**secuencias** cis-reguladoras curadas, cuyos módulos predichos ni
  siquiera están ligados a genes diana) y modERN (perfiles de unión por ChIP-seq, y unirse no es regular); el
  signo podría **derivarse** de las series de RNAi de modERN, lo cual es legítimo pero confunde dianas directas
  con indirectas y procede de un único ensayo en embrión entero, así que no sería de calidad comparable y
  habría que etiquetarlo como tal. YEASTRACT+ tiene 215.398 asociaciones para levadura, pero el 76,9 % se apoya
  solo en evidencia de expresión, con el mismo problema de indirección, y habría que filtrarlas por evidencia de
  unión y comprobar la licencia. Para pez cebra no encontramos nada utilizable. Añadir cualquiera de estas
  queda pendiente de una fuente lo bastante buena como para presentarla junto a las curadas.

- FBA no usa concentraciones ni cinéticas: la concentración solo fija la captación máxima. Los valores
  `Vmax`/`Km` por defecto (`js/core/medium.js`) son órdenes de magnitud para células de mamífero en cultivo.
- Plasmax y HPLM: se omiten los componentes que los modelos no representan (selenito, manganeso, vanadato,
  nitrato, p-aminobenzoato, metilacetoacetato, rojo fenol); los ácidos grasos y vitaminas liposolubles que
  aporta el suero se añaden con los valores del medio estándar, y la cinética de captación de los
  metabolitos adicionales es genérica. Williams E: se omiten menadiona, manganeso y nitrato.
- El modo dinámico supone un tamaño de pool intracelular uniforme: los tiempos de marcaje son orientativos.
- Las distribuciones de isotopólogos son una muestra de 2000 moléculas en estado estacionario isotópico
  (±1 punto porcentual aprox.), sin abundancia natural. En modo dinámico sus tiempos dependen del tamaño de
  pool supuesto.
- No se traza hidrógeno (²H).
- FBA tiene soluciones alternativas: al comparar con la referencia pueden aparecer cambios de flujo que no
  se deben a la perturbación. Con pFBA activado la comparación es más estable.
- El knockdown parcial de una reacción sin flujo en la referencia no la restringe; en modo dinámico los
  límites de knockdown se toman del primer instante de la referencia.
- Los tipos celulares sólo apagan enzimas cuyo ARNm no se detecta (un umbral, no una prueba de ausencia);
  no escalan los flujos con la expresión, y la expresión se midió en el medio propio de cada línea o in vivo.
- Mouse-GEM 1.8.0 y Rat-GEM 1.8.0 traen como objetivo `MAR00021`, cuyo valor no es una tasa de crecimiento (unos 0,00016). Por eso el
  objetivo por defecto, «Crecimiento (biomasa genérica)», es MAR13082, la reacción de biomasa de Human-GEM,
  presente pero cerrada en ambos modelos y abierta sólo mientras es el objetivo: 0,0370 h⁻¹ en el medio estándar, como Human-GEM.
- Zebrafish-, Fruitfly- y Worm-GEM usan la biomasa de célula humana, cinética de captación de mamífero y ΔG a
  37 °C, sin flujos medidos y con listas cortas de tejidos de Bgee. Fruitfly-GEM usa por defecto el medio de Schneider
  (células S2). Worm-GEM se construye sin 2,3-bisfosfoglicerato en la reserva de metabolitos (a C. elegans le falta la mutasa).
- yeast-GEM e iML1515 se leen a través de los nombres de Human-GEM (`tools/convert_foreign.py`: MetaNetX,
  BiGG, ChEBI, KEGG, nombre); se emparejan cerca de la mitad de sus metabolitos. Los demás toman su estructura
  del modelo o de MetaNetX 4.5 (`tools/fetch_mnx_structures.py`, solo estructuras que MNXref toma de ChEBI,
  SwissLipids o LIPID MAPS), así que los mapas atómicos cubren el 92 % (E. coli) y el 89 % (levadura) de las
  reacciones internas. Sus medios (M9, Verduyn, YNB, SC), flujos medidos (Jouhten 2008; Zampieri 2019;
  Castaño-Cerezo 2009) y cepas de laboratorio están en la documentación. Yeast-GEM sobrestima el crecimiento en
  discontinuo aerobio (0,66 frente a unos 0,37 h⁻¹).
- Validación (documentación › Fuentes de datos): el 96,5 % de los mapas atómicos de Human-GEM coincide con los
  479 mapas curados comparables de Recon 3D (Preciat Gonzalez 2017); con los flujos de un análisis de flujos con
  ¹³C publicado, los isotopólogos predichos de aminoácidos de E. coli reproducen 14 experimentos con trazadores
  con un error de 0,9 % molar (Crown 2015). En tejido hepático humano una única solución de FBA no reproduce el
  marcaje medido (faltan fuentes endógenas sin marcar y flujos de intercambio): lee los isotopólogos predichos
  como consecuencias del modelo.
- Los modelos se usan tal como se publicaron. Algunas reacciones sólo pueden ir en un sentido termodinámicamente
  imposible (citocromos P450 y CMP-Neu5Ac hidroxilasa escritos al revés en Human-GEM 2.1.1 y los modelos animales,
  ya corregidos en su rama de desarrollo; una piridoxal oxidasa en yeast-GEM); la ficha de la reacción lo avisa.
  Ninguna lleva flujo en las ejecuciones por defecto.

### Licencia y cita

Copyright © 2026 Jonatan Fernández-García.

El código de MetfluxLive es software libre, publicado bajo la Licencia Pública General de GNU versión 3 o, a tu
elección, cualquier versión posterior (GPL-3.0-or-later, ver `LICENSE`).

Los ficheros de `data/` derivan de recursos públicos y conservan sus licencias:
- Human-GEM, Mouse-GEM, Rat-GEM, Zebrafish-GEM, Fruitfly-GEM, Worm-GEM y yeast-GEM: CC BY 4.0;
- iML1515: tal como lo distribuye [BiGG Models](http://bigg.ucsd.edu) (condiciones de la Universidad de
  California; el uso comercial puede requerir su permiso);
- contextos de tipos celulares humanos: CC BY-SA 4.0 (Human Protein Atlas); los demás contextos animales: CC0 (Bgee);
- regulones de TF con signo: humano y ratón derivados de CollecTRI (Müller-Dott et al. 2023) vía OmniPath (CC BY-SA 4.0);
  *E. coli* derivado de RegulonDB v14.5.1 (Salgado et al. 2023, CCG-UNAM; licencia académica);
- estructuras de metabolitos de MetaNetX/MNXref: CC BY 4.0, usadas solo cuando su fuente es ChEBI, SwissLipids o
  LIPID MAPS (CC BY 4.0).

Las bibliotecas de terceros en `vendor/` conservan sus licencias: HiGHS (MIT) y RDKit MinimalLib (BSD-3-Clause).

Para citar MetfluxLive, ver `CITATION.cff` (GitHub lo muestra como «Cite this repository»).
