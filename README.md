# MetfluxLive

**[English](#english)** · **[Español](#español)**

---

## English

Local viewer for metabolic fluxes and isotope tracing on genome-scale metabolic models
(Human-GEM 2.1.1, Mouse-GEM 1.8.0 and Rat-GEM 1.8.0 included, already preprocessed). Everything runs in the browser.

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
  only made costlier in pFBA. Genes that the 57 essential metabolic tasks of Human-GEM need are switched back
  on. Off by default. Sources, cut-off and preprocessing: Docs › Cell types.
  Your own RNA-seq table (TPM or similar, one row per gene) can be turned into a cell type with the same
  procedure, in the browser; the data never leave the computer (Docs › Cell types › Your own RNA-seq data).
- **Reading the result** — a plain-language summary, what limits the objective (reduced costs), the value of
  each metabolite (shadow prices), the ATP/NADH/NADPH balance by pathway, phase planes of a nutrient, flux ranges
  (FVA) of a reaction and of a whole pathway (cycle-free, with "what can replace it"), an essential-gene screen,
  and a comparator of two cell types in the catalogue. Docs › Flux balance analysis.
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
  dissipated by each group. In a pathway map, ΔG′m colours each reaction. Details in Docs › The interface.
- **Compare** — save the current situation as a scenario, change anything (medium, pulse, knockout, tracer,
  model edits) and pick the scenario: the map ("Changed flux" / "Changed label"), the summary (exchanges,
  pathways, labelling) and the metabolite panel (paired isotopologue bars) show scenario → now.
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
- **Cellular objective** — built-in objectives (growth, maximum ATP, glutathione, and cell functions: urea, gluconeogenesis, ketone bodies, bile acids, lipogenesis, neurotransmitters, cortisol, NO, heme, creatine), any
  reaction from the search box, and objectives you save yourself. Docs › Flux balance analysis › Choosing the objective.
- **Light / dark mode** — the moon/sun button at the top right (dark by default; also applies to the Docs).

### Structure

```
index.html, css/, js/        application (no build dependencies)
js/core/                     FBA/pFBA (fba.js), medium (medium.js), isotope tracing (tracer.js), GPR rules (gpr.js), worker
js/core/isotopologues.js     isotopologue distributions (Monte-Carlo over atom maps)
js/core/measured.js          measured exchange fluxes (NCI-60, HEK293, fibroblasts, liver) and ATP maintenance
js/core/contexts.js          cell-type contexts: genes off, blocked reactions, search
js/core/edits.js, chem.js    model edits (apply, validate, layout) and chemistry (SMILES, atom maps via RDKit)
js/ui/editor.js, compare.js  model editor dialogs; scenarios and comparison
js/celllayout.js, js/cascade.js, js/i18n.js   cell and cascade layouts; EN/ES texts
js/export/                   results download: datasets, SVG charts, zip writer
docs.html                    documentation (EN/ES)
vendor/highs/                HiGHS LP solver compiled to WebAssembly (MIT)
vendor/rdkit/                RDKit MinimalLib 2026.03.6, WebAssembly (BSD-3), used only by the model editor
data/<model>/                model.json, structures.json, atommaps.json, layout.json, thermo.json, contexts.json
tools/                       preprocessing (Python) and tests (Node)
```

**Licence of the cell-type data.** `data/human-gem/contexts.json` is derived from the Human Protein Atlas
(version 26.0, CC BY-SA 4.0) and is distributed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), with attribution to the Human Protein Atlas;
its cell line descriptions come from Cellosaurus 57.0 (CC BY 4.0). `data/mouse-gem/contexts.json` is derived
from Bgee 15.2 and is CC0. The licence is also written inside each file (`meta.license`).
`data/tasks/metabolicTasks_Essential.txt` is copied unchanged from Human-GEM 2.1.1 (CC BY 4.0, Robinson et al. 2020);
it is used to build cell types from the user's RNA-seq data in the browser.

To share or host the app you only need `index.html`, `docs.html`, `css/`, `js/`, `vendor/` and `data/` (about 31 MB, 7 MB of it RDKit).
Python is used only for preprocessing, never at run time.

### Rebuilding the data or adding another model

Preprocessing converts a repository in [standard-GEM](https://github.com/MetabolicAtlas/standard-GEM)
format (`model/*.yml` + `model/*.tsv`) into the JSON files the app reads. The source zips are not in this
repository: download `Human-GEM-2.1.1.zip`, `Mouse-GEM-1.8.0.zip` and `Rat-GEM-1.8.0.zip` from the
[Human-GEM](https://github.com/SysBioChalmers/Human-GEM),
[Mouse-GEM](https://github.com/SysBioChalmers/Mouse-GEM) and [Rat-GEM](https://github.com/SysBioChalmers/Rat-GEM) releases and put them in the project root.

```bash
python3 -m venv --without-pip tools/.venv
python3 -m pip --python tools/.venv/bin/python install rdkit pyyaml igraph rxnmapper \
    torch --extra-index-url https://download.pytorch.org/whl/cpu

tools/build_all.sh                      # Human-GEM, Mouse-GEM, Rat-GEM

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

---

## Español

Visualizador local de flujos metabólicos y trazado isotópico sobre modelos metabólicos de escala
genómica (Human-GEM 2.1.1, Mouse-GEM 1.8.0 y Rat-GEM 1.8.0 incluidos, ya preprocesados). Todo se ejecuta en el navegador.

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
  bloquean o, como opción, sólo se encarecen en el pFBA. Los genes que necesitan las 57 tareas metabólicas
  esenciales de Human-GEM se vuelven a encender. Desactivado por defecto. Fuentes, umbral y preprocesado:
  Docs › Tipos celulares.
  Tu propia tabla de RNA-seq (TPM o similar, una fila por gen) se puede convertir en un tipo celular con el
  mismo procedimiento, en el navegador; los datos no salen del ordenador (Docs › Tipos celulares › Tus propios datos).
- **Leer el resultado** — un resumen en frases, qué limita el objetivo (costes reducidos), el valor de cada
  metabolito (precios sombra), el balance de ATP/NADH/NADPH por ruta, planos de fase de un nutriente, rangos de
  flujo (FVA) de una reacción y de una ruta entera (sin ciclos, con «qué puede sustituirla»), un cribado de
  genes esenciales y un comparador de dos tipos celulares en el catálogo. Docs › Análisis de balance de flujos.
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
  energía libre (ΔG′m) que disipa cada grupo. En el mapa de una ruta, ΔG′m colorea cada reacción. Detalles en
  Docs › La interfaz.
- **Comparar** — guarda la situación actual como escenario, cambia lo que quieras (medio, pulso, knockout,
  trazador, ediciones del modelo) y elige el escenario: el mapa («Flujo cambiado» / «Marcaje cambiado»), el
  resumen (intercambios, rutas, marcaje) y la ficha del metabolito (barras pareadas de isotopólogos) muestran
  escenario → ahora.
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
- **Objetivo celular** — objetivos predefinidos (crecimiento, máximo ATP, glutatión y funciones celulares: urea, gluconeogénesis, cuerpos cetónicos, ácidos biliares, lipogénesis, neurotransmisores, cortisol, NO, hemo, creatina),
  cualquier reacción del buscador y objetivos que guardes tú. Docs › Balance de flujos › Elegir el objetivo.
- **Modo claro / oscuro** — el botón de luna/sol arriba a la derecha (oscuro por defecto; también se aplica a los Docs).

### Estructura

```
index.html, css/, js/        aplicación (sin dependencias de compilación)
js/core/                     FBA/pFBA (fba.js), medio (medium.js), trazado isotópico (tracer.js), reglas GPR (gpr.js), worker
js/core/isotopologues.js     distribuciones de isotopólogos (Monte Carlo sobre los mapas atómicos)
js/core/measured.js          flujos de intercambio medidos (NCI-60, HEK293, fibroblastos, hígado) y ATP de mantenimiento
js/core/contexts.js          tipos celulares: genes apagados, reacciones bloqueadas, búsqueda
js/core/edits.js, chem.js    ediciones del modelo (aplicar, validar, disposición) y química (SMILES, mapas de átomos con RDKit)
js/ui/editor.js, compare.js  diálogos del editor del modelo; escenarios y comparación
js/celllayout.js, js/cascade.js, js/i18n.js   disposición celular y en cascada; textos EN/ES
js/export/                   descarga de resultados: tablas, gráficas SVG, escritor de zip
docs.html                    documentación (EN/ES)
vendor/highs/                solver LP HiGHS compilado a WebAssembly (MIT)
vendor/rdkit/                RDKit MinimalLib 2026.03.6, WebAssembly (BSD-3), sólo para el editor del modelo
data/<modelo>/               model.json, structures.json, atommaps.json, layout.json, thermo.json, contexts.json
tools/                       preprocesado (Python) y pruebas (Node)
```

**Licencia de los datos de tipos celulares.** `data/human-gem/contexts.json` deriva del Human Protein Atlas
(versión 26.0, CC BY-SA 4.0) y se distribuye bajo
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), con atribución al Human Protein Atlas; la
descripción de las líneas celulares sale de Cellosaurus 57.0 (CC BY 4.0). `data/mouse-gem/contexts.json`
deriva de Bgee 15.2 y es CC0. La licencia también va escrita dentro de cada archivo (`meta.license`).
`data/tasks/metabolicTasks_Essential.txt` se copia sin cambios de Human-GEM 2.1.1 (CC BY 4.0, Robinson et al. 2020);
se usa para construir tipos celulares a partir del RNA-seq del usuario en el navegador.

Para compartir o alojar la app basta con `index.html`, `docs.html`, `css/`, `js/`, `vendor/` y `data/` (unos 31 MB, 7 de ellos RDKit).
Python solo se usa en el preprocesado, nunca en ejecución.

### Regenerar los datos o añadir otro modelo

El preprocesado convierte un repositorio en formato [standard-GEM](https://github.com/MetabolicAtlas/standard-GEM)
(`model/*.yml` + `model/*.tsv`) en los JSON que lee la app. Los zip de origen no están en este
repositorio: descarga `Human-GEM-2.1.1.zip`, `Mouse-GEM-1.8.0.zip` y `Rat-GEM-1.8.0.zip` de las publicaciones de
[Human-GEM](https://github.com/SysBioChalmers/Human-GEM) y
[Mouse-GEM](https://github.com/SysBioChalmers/Mouse-GEM) y [Rat-GEM](https://github.com/SysBioChalmers/Rat-GEM) y ponlos en la raíz del proyecto.

```bash
python3 -m venv --without-pip tools/.venv
python3 -m pip --python tools/.venv/bin/python install rdkit pyyaml igraph rxnmapper \
    torch --extra-index-url https://download.pytorch.org/whl/cpu

tools/build_all.sh                      # Human-GEM, Mouse-GEM, Rat-GEM

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
