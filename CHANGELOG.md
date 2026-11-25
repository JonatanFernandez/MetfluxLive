# Changelog

All notable changes to **MetfluxLive** are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses `vMAJOR.MINOR` versioning.

---

## [1.2] - 2026-11-25

### Added
- **Three-tab analysis workspace (*Simulate · Compare · Interpret*)**: reorganised the left panel into three dedicated workspaces separating single-condition setup, two-condition comparison and experimental omics interpretation.
- **DepMap-calibrated default biomass & medium**:
  - New objective **Growth without the cofactor pool** (`MFL_biomass_nocof`, appended to all 6 animal models) removing artificial catalytic-cofactor synthesis essentiality while keeping the exact same growth rate.
  - New medium **Standard + serum lipids** (`defaultSerum`) supplying carnitine, cholesterol and serum fatty acids present in 10 % FBS.
  - Together, these raise single-gene essentiality precision on 730 DepMap 26Q3 cell lines from 53 % to 72.5 % (MCC 0.33 → 0.38–0.41).
- **Conditional vulnerability screens (*Compare*)**:
  - **Conditional nutrients (auxotrophy screen)**: removes every shared medium nutrient in Condition A and Condition B to uncover acquired auxotrophies specific to B.
  - **Conditional genes (synthetic lethality screen)**: knocks out every metabolic gene in A and B to identify synthetic lethal pairs (gene×gene, gene×context and gene×medium).
- **Spent-medium exometabolomics importer & LP consistency fitter (*Interpret*)** (`js/core/exodata.js`, `js/core/fitexchange.js`):
  - Parses long-format TSV/CSV concentration time courses with biomass columns (`cells`, `protein_ug`, `protein_mg` or `gdw`) and optional `blank` rows for abiotic decay correction.
  - Computes specific uptake/secretion rates (mmol/gDW/h) and growth rate, maps metabolites via a 4-layer matcher with persistent manual overrides, solves an L1 LP consistency check against the GEM, reports respiratory quotient (CO₂/O₂), carbon closure and charge-imbalance diagnostics, and applies fitted rates directly to the simulation.
- **Intracellular metabolomics contrast & live map overlay (*Interpret*)** (`js/core/metcontrast.js`):
  - Imports wide abundance matrices (metabolites × samples) with optional `group` row or pattern splitting, automatic sample-median normalisation check, Welch *t*-tests with Benjamini–Hochberg FDR, and diagnostic energy/redox ratios valid for relative data (`ATP/AMP`, `ATP/ADP`, `LAC/PYR`, `GSH/GSSG`, `NADPH/NADP+`, `GLU/AKG`).
  - Scores substrate↑/product↓ candidate bottleneck reactions with a whole-sample permutation null test and partial reaction Δ(ΔG′) shifts, projects a live log₂FC + observability + bottleneck overlay onto the network map, and provides one-click **Test block in model** perturbations.
- **Transcription-factor (TF) regulatory inference from differential RNA-seq (*Interpret*)** (`js/core/reginfer.js`):
  - Sparse exact Univariate Linear Model (ULM, equivalent to decoupleR) scoring differential RNA-seq (`gene`, `log2FC`, optional `stat`/`t`, `padj`) against bundled signed regulons for **Human-GEM** (917 TFs, CollecTRI via OmniPath, CC BY-SA 4.0), **Mouse-GEM** (838 TFs, CollecTRI orthology, CC BY-SA 4.0), and ***E. coli* iML1515** (239 TFs, RegulonDB v14.5.1, academic licence).
  - Highlights TF-regulated metabolic reactions directly on the map, tests TF-driven enzyme knockdowns in FBA, and — when paired with intracellular metabolomics — classifies bottlenecks into **transcriptional** vs. **post-transcriptional / allosteric** and traces 3-step `TF → mRNA → metabolite` causal chains.
- **Six worked examples with step-by-step walkthroughs (*Examples*)** (`js/ui/demos.js`):
  - Aligned one-to-one with every analysis workflow in the documentation (with direct links to the corresponding Docs section) and each equipped with a dedicated walkthrough covering where to enter data, the required table format, and how to read results inside dialogs and on the live map:
    1. `SDHB` knockout, A→B flux comparison & conditional vulnerabilities (Cardaci et al. 2015).
    2. `[U-13C6]glucose` isotope tracing: Normoxia vs. Hypoxia paired citrate MIDs & tracer designer.
    3. HEK293 spent-medium exometabolomics rates & LP consistency fit (Dietmair et al. 2012, Table 2).
    4. HEK293 producer vs. parent intracellular metabolomics contrast, Δ(ΔG′) & live map overlay (Dietmair et al. 2012, Table S3).
    5. Custom cell-type context from HCT116 RNA-seq TPM with 57-task rescue (DepMap 26Q3).
    6. *E. coli* `ΔarcA` vs. WT differential RNA-seq TF inference & regulon highlight (Pal et al. 2020, `GSE153906`).

### Changed
- **Redesigned general walkthrough** (`js/ui/tour.js`): covers all active sections in top-to-bottom order on both desktop (31 steps) and mobile (28 steps), starting with an overview of the three main analysis tabs and alternating each input workspace with its corresponding results view (`#map`, `#details`, comparison controls, and omics overlays).
- **Documentation & localisation across all 7 languages** (`en`, `es`, `de`, `el`, `fr`, `it`, `pt`): updated `docs.html`, `docs/{de,el,fr,it,pt}.html`, `js/i18n.js`, `js/i18n/{de,el,fr,it,pt}.js`, and `README.md` (EN/ES), including attribution and licences for CollecTRI and RegulonDB.
- **Comprehensive validation benchmarks** (in companion repository [MetfluxTools](https://github.com/JonatanFernandez/MetfluxTools)): added end-to-end validation suites for human CollecTRI & *E. coli* RegulonDB TF inference, conditional auxotrophy & synthetic lethality screens, DepMap 26Q3 matched RNA-seq 50-line × 4-TPM-cutoff context building, *E. coli* iML1515 100 % COBRApy equivalence across 1,503 genes, optimal tracer experiment design, real experimental exometabolomics datasets (`ST003960`, `ST001609` and 5 multi-organism panels), and 8-GEM performance & mass-balance benchmarks.

### Fixed
- **Walkthrough spotlight over `<dialog>` modals** (`js/ui/tour.js`): mounted `.tour-shade` dynamically inside the active top-layer `dialog[open]` so walkthrough highlights and popovers render cleanly above modal dialogs instead of behind them, and automatically expand collapsible sections and table-format guides (`.rna-how`).
- **Non-destructive modal navigation & multi-omic state sync** (`js/app.js`): stepping Back/Next through example walkthroughs preserves computed tables/results inside dialogs, and `Clear` cleanly synchronises intracellular metabolomics and TF regulatory highlights.

---

## [1.1] - 2026-11-21

### Fixed
- Fixed bugs in two-condition scenario comparisons (`b636b66`).

---

## [1.0] - 2026-11-19

### Added
- Initial public release of **MetfluxLive**: zero-build browser application running HiGHS and RDKit in WebAssembly with no backend required.
- Eight preprocessed genome-scale metabolic models: **Human-GEM 2.1.1**, **Mouse-GEM 1.8.0**, **Rat-GEM 1.8.0**, **Zebrafish-GEM 1.6.0**, **Fruitfly-GEM 1.7.0**, **Worm-GEM 1.8.0**, **yeast-GEM 9.1.1**, and ***E. coli* iML1515**.
- Steady-state FBA/pFBA, cycle-free FVA (reaction and pathway flexibility maps), reduced costs, shadow prices, cofactor balances, phase planes, secondary objectives (epsilon-constraint Pareto curves), and dynamic mode with scheduled pulse/chase events.
- Heavy-atom isotope tracing (¹³C, ¹⁵N, ¹⁸O, ³⁴S), 40 built-in commercial tracers, Monte-Carlo mass isotopologue distributions (with natural abundance option), and automated tracer experiment design.
- 1,400+ prebuilt cell-type and tissue expression contexts (Human Protein Atlas 26.0 + Cellosaurus 57.0, Bgee 15.2) and local custom RNA-seq context builder with 57-task metabolic rescue.
- Interactive global layouts (cascade, cell compartments, pathways), pathway sub-maps, ΔG′m thermodynamic overlay, right-click focus menu, appearance customiser, interactive model editor, session/CSV/SVG/PNG/ZIP export, mobile touch interface, and full UI + documentation in 7 languages (`en`, `es`, `de`, `el`, `fr`, `it`, `pt`).

[1.2]: https://github.com/JonatanFernandez/MetfluxLive/compare/v.1.1...v1.2
[1.1]: https://github.com/JonatanFernandez/MetfluxLive/compare/v1.0...v.1.1
[1.0]: https://github.com/JonatanFernandez/MetfluxLive/releases/tag/v1.0
