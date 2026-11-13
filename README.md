# MetfluxLive

**[English](#english)** · **[Español](#español)**

---

## English

Local viewer for metabolic fluxes and isotope tracing on genome-scale metabolic models
(Human-GEM 2.1.1 and Mouse-GEM 1.8.0 included, already preprocessed). Everything runs in the browser.

### Open

Open `index.html` with **Five Server** (or any static server; it does not work from `file://`
because it uses ES modules, a Web Worker and WebAssembly). No internet connection is needed.

### Usage

- **Docs** — the "Docs" button opens `docs.html`: methods explained for non-specialists (FBA, steady state
  vs dynamic, isotope tracing), data sources, limitations and a set of worked in-silico experiments.
- **Language** — EN / ES selector at the top right, English by default (metabolite, reaction and pathway names come from the
  model and are not translated). The texts live in `js/i18n.js`.
- **Global map** — "Group: cell" (default) distributes the reactions
  by compartment in a cell diagram (cytosol, mitochondrion, ER, Golgi, lysosome, peroxisome, nucleus,
  extracellular medium) and places the reactions that cross a membrane on that membrane; "Group: pathways"
  draws one bubble per pathway; "Group: cascade" orders pathways (and, inside a pathway map, metabolites)
  top to bottom by their number of reaction steps from the medium. Lines are the
  carbon one group produces and another consumes. Double-click a group to open its pathway map
  (○ metabolite, ◆ reaction, cofactors hidden).
- **Search** (`Ctrl+K`) — metabolites (name, formula, KEGG/HMDB/ChEBI), reactions (name, ID, EC),
  genes/enzymes and pathways.
- **Culture medium** — the selector at the top of "Medium and sources" switches between a standard
  DMEM/F-12-like medium, **Plasmax** and **HPLM** (physiological media; concentrations from Table S1 of
  [Vande Voorde et al. 2019](https://pubmed.ncbi.nlm.nih.gov/30613774/)). "save…" stores the current medium
  with your changes under a name (in the browser's localStorage, shared by both models); "reset" discards
  the changes. The sections of the left panel collapse by clicking their title.
- **Medium and sources** — concentration (mM) of each metabolite. Extracellular ones limit their uptake
  (`Vmax·C/(Km+C)`); any other metabolite is injected into its compartment. In steady-state mode the
  fluxes are recomputed automatically when a value changes.
- **⚛ Tracer** — opens the molecule editor: click atoms to label them (¹³C, ¹⁵N, ¹⁸O, ³⁴S) and choose the
  labelled fraction. Colour then shows enrichment; selecting a metabolite shows its label atom by atom,
  and the summary shows where the label ends up.
- **Knockout / knockdown** — add a gene or a reaction and set its residual activity (0 % = knockout).
  Genes are evaluated with the gene-protein-reaction rule (`and` = minimum, `or` = maximum: isoenzymes
  compensate). A knockdown limits the flux to that fraction of the flux in the unperturbed reference
  simulation, which is computed automatically with the same medium and objective.
- **Filter** — "Labelled only" hides whatever receives no labelled atoms; "Changed flux only" hides the
  reactions whose flux does not change (±2 %) against the reference and colours by increase/decrease.
- **Isotopologues** — with a tracer in steady-state mode, the metabolite panel shows the mass isotopologue
  distribution (M+0, M+1…), obtained by sampling single molecules backwards through the atom maps.
- **Download** — tables (CSV), charts (SVG), the map (PNG) and the settings (JSON) of the current result,
  chosen with checkboxes and delivered as one `.zip`.
- **Panels** — drag the border of a side panel to resize it (double-click restores it).
- **Steady state / Dynamic** — the `?` button explains both methods.

### Structure

```
index.html, css/, js/        application (no build dependencies)
js/core/                     FBA/pFBA (fba.js), medium (medium.js), isotope tracing (tracer.js), GPR rules (gpr.js), worker
js/core/isotopologues.js     isotopologue distributions (Monte-Carlo over atom maps)
js/celllayout.js, js/cascade.js, js/i18n.js   cell and cascade layouts; EN/ES texts
js/export/                   results download: datasets, SVG charts, zip writer
docs.html                    documentation (EN/ES)
vendor/highs/                HiGHS LP solver compiled to WebAssembly (MIT)
data/<model>/                model.json, structures.json, atommaps.json, layout.json
tools/                       preprocessing (Python) and tests (Node)
```

To share or host the app you only need `index.html`, `docs.html`, `css/`, `js/`, `vendor/` and `data/` (about 23 MB).
Python is used only for preprocessing, never at run time.

### Rebuilding the data or adding another model

Preprocessing converts a repository in [standard-GEM](https://github.com/MetabolicAtlas/standard-GEM)
format (`model/*.yml` + `model/*.tsv`) into the JSON files the app reads. The source zips are not in this
repository: download `Human-GEM-2.1.1.zip` and `Mouse-GEM-1.8.0.zip` from the
[Human-GEM](https://github.com/SysBioChalmers/Human-GEM) and
[Mouse-GEM](https://github.com/SysBioChalmers/Mouse-GEM) releases and put them in the project root.

```bash
python3 -m venv --without-pip tools/.venv
python3 -m pip --python tools/.venv/bin/python install rdkit pyyaml igraph rxnmapper \
    torch --extra-index-url https://download.pytorch.org/whl/cpu

tools/build_all.sh                      # Human-GEM + Mouse-GEM

# another model (zip or folder):
tools/.venv/bin/python tools/build_model.py   Other-GEM.zip other-gem [--structures-from human-gem]
tools/.venv/bin/python tools/build_atommaps.py other-gem
tools/.venv/bin/python tools/build_layout.py   other-gem
tools/.venv/bin/python tools/write_manifest.py
```

`--structures-from` reuses the SMILES of another model that is already built when the new one lacks them
(the case of Mouse-GEM, which shares identifiers with Human-GEM).

### Atom-to-atom maps

`build_atommaps.py` assigns heavy-atom transitions to every reaction:

1. identity for the same metabolite on both sides (transports);
2. cofactor pairs (ATP/ADP, NAD⁺/NADH, 2-oxoglutarate/glutamate…) by common substructure or explicit rule;
3. [RXNMapper](https://github.com/rxn4chemistry/rxnmapper) for the rest;
4. maximum common substructure for reactions with R groups or that are too long (low confidence);
5. `tools/atommap_overrides.json`: manual corrections (transketolase, transaldolase, 6-phosphogluconate
   dehydrogenase, aconitase, transaminases), checked with `tools/inspect_map.py`.

Coverage in Human-GEM: 10,551 of 11,094 non-exchange reactions. Where there is no map, the label is
spread over the products and the metabolite is drawn with a dashed border.

### Tests

```bash
node tools/test_fba.mjs    [human-gem|mouse-gem] [default|plasmax|hplm]   # FBA/pFBA on a built-in medium
node tools/test_tracer.mjs [human-gem|mouse-gem]   # label fates in central metabolism
node tools/test_isotopologues.mjs [human-gem|mouse-gem]   # isotopologue sampler vs positional tracer
node tools/diag_medium.mjs [human-gem|mouse-gem]   # which medium components limit the objective
tools/.venv/bin/python tools/inspect_map.py human-gem MAR04145   # show the atom map of a reaction
```

### Limitations

- FBA uses neither concentrations nor kinetics: concentration only sets the maximum uptake. The default
  `Vmax`/`Km` values (`js/core/medium.js`) are orders of magnitude for cultured mammalian cells.
- Plasmax and HPLM: components the models do not represent (selenite, manganese, vanadate, nitrate,
  p-aminobenzoate, methyl acetoacetate, phenol red) are left out; the fatty acids and fat-soluble vitamins
  that serum provides are added at the standard medium's values, and the uptake kinetics of the extra
  metabolites are generic.
- Dynamic mode assumes a uniform intracellular pool size: labelling times are indicative only.
- Isotopologue distributions are a 2,000-molecule sample at isotopic steady state (about ±1 percentage point),
  without natural abundance, and only in steady-state mode.
- Hydrogen (²H) is not traced.
- FBA has alternative optima: when comparing against the reference, flux changes may appear that are not
  caused by the perturbation. With pFBA enabled the comparison is more stable.
- A partial knockdown of a reaction with no flux in the reference does not constrain it; in dynamic mode
  the knockdown limits are taken from the first time point of the reference.
- Mouse-GEM 1.8.0 ships `MAR00021` as its objective, whose scale differs from the Human-GEM biomass:
  absolute growth comes out very low with the default medium. Another objective can be chosen in the app.

---

## Español

Visualizador local de flujos metabólicos y trazado isotópico sobre modelos metabólicos de escala
genómica (Human-GEM 2.1.1 y Mouse-GEM 1.8.0 incluidos, ya preprocesados). Todo se ejecuta en el navegador.

### Abrir

Abre `index.html` con **Five Server** (o cualquier servidor estático; no funciona con `file://`
porque usa módulos ES, un Web Worker y WebAssembly). No necesita conexión.

### Uso

- **Docs** — el botón «Docs» abre `docs.html`: métodos explicados para no especialistas (FBA, estacionario
  frente a dinámico, trazado isotópico), fuentes de datos, limitaciones y experimentos in silico resueltos.
- **Idioma** — selector EN / ES arriba a la derecha, inglés por defecto (los nombres de metabolitos, reacciones y rutas vienen
  del modelo y no se traducen). Los textos están en `js/i18n.js`.
- **Mapa global** — «Agrupar: célula» (por defecto) reparte las reacciones
  por compartimento en un esquema de célula (citosol, mitocondria, retículo, Golgi, lisosoma, peroxisoma,
  núcleo, medio extracelular) y coloca sobre cada membrana las reacciones que la cruzan; «Agrupar: rutas»
  dibuja una burbuja por ruta; «Agrupar: cascada» ordena las rutas (y, dentro del mapa de una ruta, los
  metabolitos) de arriba abajo según sus pasos de reacción desde el medio. Las líneas son el
  carbono que un grupo produce y otro consume. Doble clic en un grupo abre el mapa de su ruta
  (○ metabolito, ◆ reacción, cofactores ocultos).
- **Buscador** (`Ctrl+K`) — metabolitos (nombre, fórmula, KEGG/HMDB/ChEBI), reacciones (nombre, ID, EC),
  genes/enzimas y rutas.
- **Medio de cultivo** — el selector al principio de «Medio y fuentes» cambia entre un medio estándar tipo
  DMEM/F-12, **Plasmax** y **HPLM** (medios fisiológicos; concentraciones de la Tabla S1 de
  [Vande Voorde et al. 2019](https://pubmed.ncbi.nlm.nih.gov/30613774/)). «guardar…» almacena el medio actual
  con tus cambios bajo un nombre (en el localStorage del navegador, común a ambos modelos); «restaurar»
  descarta los cambios. Las secciones del panel izquierdo se pliegan haciendo clic en su título.
- **Medio y fuentes** — concentración (mM) de cada metabolito. Los extracelulares limitan su captación
  (`Vmax·C/(Km+C)`); cualquier otro metabolito se inyecta en su compartimento. En modo estacionario
  los flujos se recalculan solos al cambiar un valor.
- **⚛ Trazador** — abre el editor de moléculas: clic en los átomos para marcarlos (¹³C, ¹⁵N, ¹⁸O, ³⁴S)
  y elige la fracción marcada. El color pasa a indicar enriquecimiento; al seleccionar un metabolito
  se ve la marca átomo a átomo, y el resumen muestra el destino de la marca.
- **Knockout / knockdown** — añade un gen o una reacción y fija su actividad residual (0 % = knockout).
  Los genes se evalúan con la regla gen-proteína-reacción (`and` = mínimo, `or` = máximo: las isoenzimas
  compensan). Un knockdown limita el flujo a esa fracción del flujo de la simulación de referencia sin
  perturbar, que se calcula automáticamente con el mismo medio y objetivo.
- **Filtro** — «Solo con marca» oculta lo que no recibe átomos marcados; «Solo flujo alterado» oculta las
  reacciones cuyo flujo no cambia (±2 %) frente a la referencia y colorea por aumento/disminución.
- **Isotopólogos** — con un trazador en modo estacionario, la ficha del metabolito muestra la distribución de
  isotopólogos (M+0, M+1…), obtenida muestreando moléculas hacia atrás a través de los mapas atómicos.
- **Descargar** — tablas (CSV), gráficas (SVG), el mapa (PNG) y la configuración (JSON) del resultado actual,
  elegidas con casillas y entregadas en un único `.zip`.
- **Paneles** — arrastra el borde de un panel lateral para cambiar su ancho (doble clic lo restaura).
- **Estacionario / Dinámico** — el botón `?` explica ambos métodos.

### Estructura

```
index.html, css/, js/        aplicación (sin dependencias de compilación)
js/core/                     FBA/pFBA (fba.js), medio (medium.js), trazado isotópico (tracer.js), reglas GPR (gpr.js), worker
js/core/isotopologues.js     distribuciones de isotopólogos (Monte Carlo sobre los mapas atómicos)
js/celllayout.js, js/cascade.js, js/i18n.js   disposición celular y en cascada; textos EN/ES
js/export/                   descarga de resultados: tablas, gráficas SVG, escritor de zip
docs.html                    documentación (EN/ES)
vendor/highs/                solver LP HiGHS compilado a WebAssembly (MIT)
data/<modelo>/               model.json, structures.json, atommaps.json, layout.json
tools/                       preprocesado (Python) y pruebas (Node)
```

Para compartir o alojar la app basta con `index.html`, `docs.html`, `css/`, `js/`, `vendor/` y `data/` (unos 23 MB).
Python solo se usa en el preprocesado, nunca en ejecución.

### Regenerar los datos o añadir otro modelo

El preprocesado convierte un repositorio en formato [standard-GEM](https://github.com/MetabolicAtlas/standard-GEM)
(`model/*.yml` + `model/*.tsv`) en los JSON que lee la app. Los zip de origen no están en este
repositorio: descarga `Human-GEM-2.1.1.zip` y `Mouse-GEM-1.8.0.zip` de las publicaciones de
[Human-GEM](https://github.com/SysBioChalmers/Human-GEM) y
[Mouse-GEM](https://github.com/SysBioChalmers/Mouse-GEM) y ponlos en la raíz del proyecto.

```bash
python3 -m venv --without-pip tools/.venv
python3 -m pip --python tools/.venv/bin/python install rdkit pyyaml igraph rxnmapper \
    torch --extra-index-url https://download.pytorch.org/whl/cpu

tools/build_all.sh                      # Human-GEM + Mouse-GEM

# otro modelo (zip o carpeta):
tools/.venv/bin/python tools/build_model.py   Otro-GEM.zip otro-gem [--structures-from human-gem]
tools/.venv/bin/python tools/build_atommaps.py otro-gem
tools/.venv/bin/python tools/build_layout.py   otro-gem
tools/.venv/bin/python tools/write_manifest.py
```

`--structures-from` reutiliza los SMILES de otro modelo ya construido cuando el nuevo no los trae
(caso de Mouse-GEM, que comparte identificadores con Human-GEM).

### Mapas átomo a átomo

`build_atommaps.py` asigna transiciones de átomos pesados a cada reacción:

1. identidad para el mismo metabolito a ambos lados (transportes);
2. pares de cofactores (ATP/ADP, NAD⁺/NADH, 2-oxoglutarato/glutamato…) por subestructura común o regla explícita;
3. [RXNMapper](https://github.com/rxn4chemistry/rxnmapper) para el resto;
4. subestructura común máxima para reacciones con grupos R o demasiado largas (baja confianza);
5. `tools/atommap_overrides.json`: correcciones manuales (transcetolasa, transaldolasa, 6-fosfogluconato
   deshidrogenasa, aconitasa, transaminasas), comprobadas con `tools/inspect_map.py`.

Cobertura en Human-GEM: 10 551 de 11 094 reacciones no de intercambio. Donde no hay mapa, la marca se
reparte entre los productos y el metabolito se dibuja con borde discontinuo.

### Pruebas

```bash
node tools/test_fba.mjs    [human-gem|mouse-gem] [default|plasmax|hplm]   # FBA/pFBA con un medio predefinido
node tools/test_tracer.mjs [human-gem|mouse-gem]   # destinos de marca en metabolismo central
node tools/test_isotopologues.mjs [human-gem|mouse-gem]   # isotopólogos frente al trazador posicional
node tools/diag_medium.mjs [human-gem|mouse-gem]   # qué componentes del medio limitan el objetivo
tools/.venv/bin/python tools/inspect_map.py human-gem MAR04145   # ver el mapa atómico de una reacción
```

### Limitaciones

- FBA no usa concentraciones ni cinéticas: la concentración solo fija la captación máxima. Los valores
  `Vmax`/`Km` por defecto (`js/core/medium.js`) son órdenes de magnitud para células de mamífero en cultivo.
- Plasmax y HPLM: se omiten los componentes que los modelos no representan (selenito, manganeso, vanadato,
  nitrato, p-aminobenzoato, metilacetoacetato, rojo fenol); los ácidos grasos y vitaminas liposolubles que
  aporta el suero se añaden con los valores del medio estándar, y la cinética de captación de los
  metabolitos adicionales es genérica.
- El modo dinámico supone un tamaño de pool intracelular uniforme: los tiempos de marcaje son orientativos.
- Las distribuciones de isotopólogos son una muestra de 2000 moléculas en estado estacionario isotópico
  (±1 punto porcentual aprox.), sin abundancia natural y solo en modo estacionario.
- No se traza hidrógeno (²H).
- FBA tiene soluciones alternativas: al comparar con la referencia pueden aparecer cambios de flujo que no
  se deben a la perturbación. Con pFBA activado la comparación es más estable.
- El knockdown parcial de una reacción sin flujo en la referencia no la restringe; en modo dinámico los
  límites de knockdown se toman del primer instante de la referencia.
- Mouse-GEM 1.8.0 trae como objetivo `MAR00021`, cuya escala difiere de la biomasa de Human-GEM: el
  crecimiento absoluto sale muy bajo con el medio por defecto. Se puede elegir otro objetivo en la app.
