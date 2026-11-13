# MetfluxLive

Visualizador local de flujos metabólicos y trazado isotópico sobre modelos metabólicos de escala
genómica (Human-GEM 2.1.1 y Mouse-GEM 1.8.0 incluidos). Todo se ejecuta en el navegador.

## Abrir

Abre `index.html` con **Five Server** (o cualquier servidor estático; no funciona con `file://`
porque usa módulos ES, un Web Worker y WebAssembly). No necesita conexión.

## Uso

- **Idioma** — selector ES / EN arriba a la derecha (los nombres de metabolitos, reacciones y rutas vienen
  del modelo y no se traducen). Los textos están en `js/i18n.js`.
- **Mapa global** — «Agrupar: rutas» dibuja una burbuja por ruta; «Agrupar: célula» reparte las reacciones
  por compartimento en un esquema de célula (citosol, mitocondria, retículo, Golgi, lisosoma, peroxisoma,
  núcleo, medio extracelular) y coloca sobre cada membrana las reacciones que la cruzan. Las líneas son el
  carbono que un grupo produce y otro consume. Doble clic en un grupo abre el mapa de su ruta
  (○ metabolito, ◆ reacción, cofactores ocultos).
- **Buscador** (`Ctrl+K`) — metabolitos (nombre, fórmula, KEGG/HMDB/ChEBI), reacciones (nombre, ID, EC),
  genes/enzimas y rutas.
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
- **Estacionario / Dinámico** — el botón `?` explica ambos métodos.

## Estructura

```
index.html, css/, js/        aplicación (sin dependencias de compilación)
js/core/                     FBA/pFBA (fba.js), medio (medium.js), trazado isotópico (tracer.js), reglas GPR (gpr.js), worker
js/celllayout.js, js/i18n.js disposición de la vista celular; textos ES/EN
vendor/highs/                solver LP HiGHS compilado a WebAssembly (MIT)
data/<modelo>/               model.json, structures.json, atommaps.json, layout.json
tools/                       preprocesado (Python) y pruebas (Node)
```

## Regenerar los datos o añadir otro modelo

El preprocesado convierte un repositorio en formato [standard-GEM](https://github.com/MetabolicAtlas/standard-GEM)
(`model/*.yml` + `model/*.tsv`) en los JSON que lee la app.

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

## Mapas átomo a átomo

`build_atommaps.py` asigna transiciones de átomos pesados a cada reacción:

1. identidad para el mismo metabolito a ambos lados (transportes);
2. pares de cofactores (ATP/ADP, NAD⁺/NADH, 2-oxoglutarato/glutamato…) por subestructura común o regla explícita;
3. [RXNMapper](https://github.com/rxn4chemistry/rxnmapper) para el resto;
4. subestructura común máxima para reacciones con grupos R o demasiado largas (baja confianza);
5. `tools/atommap_overrides.json`: correcciones manuales (transcetolasa, transaldolasa, 6-fosfogluconato
   deshidrogenasa, aconitasa, transaminasas), comprobadas con `tools/inspect_map.py`.

Cobertura en Human-GEM: 10 551 de 11 094 reacciones no de intercambio. Donde no hay mapa, la marca se
reparte entre los productos y el metabolito se dibuja con borde discontinuo.

## Pruebas

```bash
node tools/test_fba.mjs    [human-gem|mouse-gem]   # FBA/pFBA con el medio por defecto
node tools/test_tracer.mjs [human-gem|mouse-gem]   # destinos de marca en metabolismo central
node tools/diag_medium.mjs [human-gem|mouse-gem]   # qué componentes del medio limitan el objetivo
tools/.venv/bin/python tools/inspect_map.py human-gem MAR04145   # ver el mapa atómico de una reacción
```

## Limitaciones

- FBA no usa concentraciones ni cinéticas: la concentración solo fija la captación máxima. Los valores
  `Vmax`/`Km` por defecto (`js/core/medium.js`) son órdenes de magnitud para células de mamífero en cultivo.
- El modo dinámico supone un tamaño de pool intracelular uniforme: los tiempos de marcaje son orientativos.
- Se calcula el enriquecimiento posicional de cada átomo, no la distribución de isotopólogos (M+0, M+1…).
- No se traza hidrógeno (²H).
- FBA tiene soluciones alternativas: al comparar con la referencia pueden aparecer cambios de flujo que no
  se deben a la perturbación. Con pFBA activado la comparación es más estable.
- El knockdown parcial de una reacción sin flujo en la referencia no la restringe; en modo dinámico los
  límites de knockdown se toman del primer instante de la referencia.
- Mouse-GEM 1.8.0 trae como objetivo `MAR00021`, cuya escala difiere de la biomasa de Human-GEM: el
  crecimiento absoluto sale muy bajo con el medio por defecto. Se puede elegir otro objetivo en la app.
