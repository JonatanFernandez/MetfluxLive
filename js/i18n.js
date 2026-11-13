// Interface strings (Spanish / English). Model content (metabolite, reaction and pathway names)
// comes from the GEM itself and is not translated.

const es = {
  // static page
  "h.model": "Modelo metabólico",
  "h.lang": "Idioma de la interfaz",
  "h.search": "Buscar metabolito, enzima, gen o ruta…  (Ctrl+K)",
  "h.modeAria": "Método de simulación",
  "h.steady": "Estacionario",
  "h.dynamic": "Dinámico",
  "h.methodsTitle": "¿Qué hace cada método?",
  "h.run": "▶ Simular",
  "h.medium": "Medio y fuentes",
  "h.reset": "restaurar",
  "h.resetTitle": "Restaurar el medio por defecto",
  "h.mediumHint": "Concentración (mM) de cada metabolito disponible. Los extracelulares entran por su reacción de intercambio; los intracelulares se inyectan en su compartimento. Pulsa <b>⚛</b> para marcar átomos.",
  "h.addSupply": "Añadir metabolito…",
  "h.perturb": "Knockout / knockdown",
  "h.clearPerturb": "quitar todo",
  "h.perturbHint": "Actividad residual de un gen/enzima o de una reacción: 0 % = knockout. Se compara con la misma simulación sin perturbar (referencia).",
  "h.addPerturb": "Añadir gen, enzima o reacción…",
  "h.objective": "Objetivo celular",
  "h.max": "Maximizar",
  "h.min": "Minimizar",
  "h.objInput": "reacción objetivo…",
  "h.pfba": "Flujo parsimonioso (pFBA): la solución con menor flujo total",
  "h.dynParams": "Parámetros dinámicos",
  "h.dynHours": "Duración",
  "h.dynBiomass": "Densidad celular inicial",
  "h.dynPool": "Tamaño de pool intracelular",
  "h.dynHint": "Los tamaños de pool son supuestos uniformes: la velocidad de marcaje es orientativa.",
  "h.inactive": "inactivas",
  "h.inactiveTitle": "Mostrar reacciones y metabolitos sin flujo",
  "h.particles": "animación",
  "h.fit": "Encajar mapa",
  "h.groupTitle": "Cómo se agrupan las reacciones en el mapa global",
  "h.filterTitle": "Mostrar solo lo afectado por el trazador o por el knockout/knockdown",
  "group.pathway": "Agrupar: rutas",
  "group.cell": "Agrupar: célula",
  "filter.all": "Mostrar: todo",
  "filter.label": "Solo con marca",
  "filter.delta": "Solo flujo alterado",
  "h.close": "Cerrar",
  "h.molAllC": "Todos los C",
  "h.molAllN": "Todos los N",
  "h.molClear": "Limpiar",
  "h.molFraction": "Fracción marcada",
  "h.cancel": "Cancelar",
  "h.molApply": "Aplicar marcaje",
  "h.methods": "Métodos de simulación",
  "h.ok": "Entendido",
  "methods.steady": `<h4>Estacionario <small>FBA + estado estacionario isotópico</small></h4>
    <p>Un modelo de escala genómica no contiene concentraciones ni cinéticas: describe qué reacciones existen y su estequiometría. El análisis de balance de flujos (FBA) busca la distribución de flujos que cumple el balance de masa y maximiza el objetivo celular (por defecto, el crecimiento).</p>
    <ul><li>La concentración de cada metabolito del medio fija su <b>captación máxima</b>: <code>Vmax·C / (Km + C)</code>.</li>
    <li>La marca se propaga átomo a átomo hasta el equilibrio isotópico: ves <b>qué fracción de cada átomo</b> procede del trazador.</li>
    <li>Resultado en pocos segundos y reproducible. No hay eje temporal.</li></ul>
    <p class="when">Úsalo para saber <i>a dónde va</i> la marca y cuánto contribuye el trazador a cada ruta.</p>`,
  "methods.dynamic": `<h4>Dinámico <small>FBA dinámico aproximado</small></h4>
    <p>Añade tiempo: el medio se consume, la captación cae al agotarse los nutrientes, el FBA se recalcula cuando cambia la disponibilidad y la marca rellena pools de tamaño finito.</p>
    <ul><li>Muestra <b>el orden y la velocidad</b> con que se marcan los metabolitos y cómo cambian los flujos al agotarse el medio.</li>
    <li>Línea temporal animada, con concentraciones extracelulares y biomasa.</li>
    <li>Los tamaños de pool intracelulares son supuestos (no medidos): los tiempos son orientativos, no cuantitativos.</li></ul>
    <p class="when">Úsalo para ver la <i>secuencia</i> del marcaje o el efecto de agotar un nutriente.</p>`,
  "methods.tracerH": "Trazado isotópico",
  "methods.tracer": "Cada reacción lleva un mapa átomo a átomo (RXNMapper, subestructura común para grupos R y curación manual del metabolismo central). Donde no existe mapa, los átomos del producto reciben la marca media de los sustratos no asignados y el metabolito se dibuja con borde discontinuo: su posición de marca es incierta. Los átomos equivalentes por simetría rotacional (succinato, fumarato) se promedian; los proquirales (citrato) no. El hidrógeno no se traza.",
  "methods.perturbH": "Knockout / knockdown",
  "methods.perturb": "Un <b>knockout</b> (0 %) fija a cero el flujo de la reacción. Para un gen se evalúa la regla gen-proteína-reacción: un complejo (<code>and</code>) queda limitado por su subunidad más escasa y las isoenzimas (<code>or</code>) se compensan entre sí, de modo que anular un gen con isoenzimas no tiene efecto. Un <b>knockdown</b> (p. ej. 30 %) limita el flujo a esa fracción del flujo de la simulación de referencia sin perturbar; si la reacción no llevaba flujo en la referencia, el knockdown no la restringe. El filtro «Solo flujo alterado» muestra las reacciones cuyo flujo cambia más de un 2 % respecto a la referencia (naranja: aumenta; azul: disminuye). El FBA admite soluciones alternativas, así que conviene dejar activado pFBA para que la comparación sea estable.",

  // boot / loading
  "load.missing": "No se encuentra data/models.json. Ejecuta tools/build_all.sh y abre la app con un servidor local (Five Server).",
  "load.model": "Cargando modelo…",
  "load.solver": "Preparando solver…",
  "load.error": "Error al cargar el modelo: {msg}",

  // navigation
  "crumb.global": "Mapa global",
  "crumb.cell": "Célula",
  "list.hint": "Esta ruta es demasiado grande para dibujarla como mapa; se muestran sus reacciones ordenadas por flujo ({k} de {n}).",
  "th.rxn": "Reacción", "th.eq": "Ecuación", "th.flux": "Flujo", "th.ref": "Referencia",
  "empty.filter": "Nada de lo que hay en esta vista está afectado. Cambia el filtro a «Mostrar: todo» para verla completa.",

  // tooltips
  "tip.turnover": "recambio {x} mmol/gDW/h",
  "tip.label": " · marca {x} %",
  "tip.uncertain": " (posición incierta)",
  "tip.flux": "flujo {x}",
  "tip.ref": " · referencia {x}",
  "tip.activity": " · actividad {x} %",
  "tip.group": "{n} reacciones · flujo total {x}",
  "tip.open": "doble clic para abrir",

  // status
  "status.fba": "Resolviendo balance de flujos…",
  "status.ref": "Calculando la referencia sin perturbar…",
  "status.dyn": "Simulación dinámica {p} % · t = {t}",
  "status.dynRef": "Referencia sin perturbar {p} %",
  "status.nosol": "Sin solución ({why})",
  "status.steady": "Estacionario",
  "status.dynamic": "Dinámico · {n} FBA",
  "status.done": "{mode} · óptimo · {s} s",
  "status.notconv": " · marcaje no convergido",
  "status.changed": "Parámetros modificados: pulsa Simular para recalcular",
  "status.error": "Error: {msg}",
  "st.infeasible": "infactible: con este medio y estas perturbaciones no se puede cumplir el balance de masa",
  "st.unbounded": "no acotado",
  "st.unboundedOrInfeasible": "infactible o no acotado",

  // legend
  "legend.carbon": "Flujo de carbono entre grupos",
  "legend.rxnflux": "Flujo de reacción",
  "legend.scale": " — grosor y velocidad (escala log)",
  "legend.enrich": "Enriquecimiento isotópico",
  "legend.uncertain": "borde discontinuo = posición de marca incierta",
  "legend.delta": "Cambio de flujo frente a la referencia",
  "legend.down": "disminuye", "legend.same": "igual", "legend.up": "aumenta",
  "legend.lost": "línea discontinua = flujo que desaparece",
  "legend.pert": "anillo rojo = reacción perturbada",
  "legend.globalHint": "doble clic en un grupo para abrir su ruta",
  "legend.subHint": "○ metabolito · ◆ reacción · cofactores ocultos",
  "legend.cellHint": "los nodos sobre una membrana son reacciones que la cruzan (transporte)",

  // supplies
  "supply.marked": "{p} % marcado",
  "supply.edit": "editar", "supply.remove": "quitar",
  "supply.injection": " (inyección intracelular)",
  "supply.hold": " · concentración constante (se repone, p. ej. intercambio gaseoso)",
  "supply.unlimited": "sin límite",
  "supply.cap": "captación máx. {x} mmol/gDW/h (Vmax {vmax}, Km {km} mM)",
  "supply.labelTitle": "Marcar átomos (trazador isotópico)",
  "supply.removeTitle": "Quitar del medio",

  // molecule editor
  "mol.hint": "Haz clic en los átomos para marcarlos con su isótopo estable (¹³C, ¹⁵N, ¹⁸O, ³⁴S). El hidrógeno no se traza.",
  "mol.noStruct": "Este metabolito no tiene estructura en el modelo: solo puede marcarse entero y su marca se propaga sin posiciones atómicas.",
  "mol.whole": "Marcar el metabolito completo",
  "mol.labelled": "marcado",
  "mol.atomEnrich": "{a}: {x} % marcado",
  "mol.atomAdd": "{a} — clic para poner {iso}",
  "mol.atomRemove": "{a} — clic para quitar {iso}",

  // perturbations
  "pert.ko": "KO",
  "pert.gene": "gen", "pert.rxn": "reacción",
  "pert.geneTitle": "{sym}: {n} de {total} reacciones dependen de este gen (el resto tiene isoenzimas)",
  "pert.noEffect": "Sin efecto: todas sus reacciones tienen isoenzimas que lo compensan",
  "pert.activity": "Actividad residual",
  "pert.removeTitle": "Quitar perturbación",
  "pert.button": "✂ Knockout / knockdown",
  "pert.active": "Perturbada: actividad residual {x} %",
  "pert.kdNoRef": "Esta reacción no lleva flujo en la referencia: un knockdown parcial no la restringe (solo el knockout).",

  // details: summary
  "sum.title": "Resumen",
  "sum.computing": "Calculando flujos…",
  "sum.growth": "Crecimiento", "sum.objective": "Objetivo",
  "sum.active": "Reacciones activas", "sum.of": "de {n}",
  "sum.biomass": "Biomasa",
  "sum.vsref": "frente a la referencia ({x})",
  "sum.nosol": "El solver no encontró solución: {why}. Revisa el medio (¿falta un nutriente esencial?), las perturbaciones o el objetivo.",
  "sum.zero": "El objetivo vale 0: con este medio y estas perturbaciones la célula no puede cumplirlo.",
  "sum.fate": "Destino de la marca", "sum.fateUnit": "% de átomos marcados captados",
  "sum.excreted": "{n} (excretado)", "sum.biomassFate": "Biomasa (incorporado)",
  "sum.rest": "otros destinos / acumulado en pools",
  "sum.noTracer": "Sin trazador. Pulsa <b>⚛</b> junto a un metabolito del medio (p. ej. glucosa) para marcar átomos y seguir su destino.",
  "sum.tracerIdle": "El trazador no se está consumiendo en esta solución (captación nula).",
  "sum.uptake": "Captación", "sum.secretion": "Excreción",
  "sum.injection": "{n} (inyección)",
  "sum.changed": "Reacciones más alteradas", "sum.changedUnit": "referencia → perturbado · {n} cambian",
  "sum.noChange": "Las perturbaciones no cambian ningún flujo en esta solución.",
  "sum.medium": "Medio a lo largo del tiempo", "sum.mediumUnit": "% de la concentración inicial",
  "sum.logAxis": "eje temporal logarítmico ({a} → {b})",

  // details: metabolite
  "met.kind": "Metabolito", "met.noFormula": "sin fórmula",
  "met.meanEnrich": "Enriquecimiento medio: {x} · pasa el cursor por un átomo para ver su valor",
  "met.uncertain": "Parte de la marca llega por reacciones sin mapa atómico: las posiciones son aproximadas.",
  "met.noStruct": "Sin estructura en el modelo: se traza como metabolito completo",
  "met.noStructLabel": " (marca {x} %)",
  "met.addSupply": "＋ Añadir al medio / inyectar", "met.label": "⚛ Marcar átomos",
  "met.producedBy": "Producido por", "met.consumedBy": "Consumido por",
  "met.rxns": "Reacciones ({n})", "met.noFlux": "sin flujo en esta solución",

  // details: reaction
  "rxn.kind": "Reacción", "rxn.flux": "Flujo", "rxn.bounds": "Límites", "rxn.ref": "Referencia",
  "rxn.reversible": "reversible", "rxn.irreversible": "irreversible",
  "rxn.genes": "Genes", "rxn.atommap": "Mapa atómico",
  "rxn.mapNone": "sin mapa: la marca se reparte entre los productos",
  "rxn.mapExchange": "intercambio con el exterior",
  "rxn.mapCurated": "curado manualmente",
  "rxn.mapId": "identidad (transporte)", "rxn.mapMcs": "subestructura común (baja confianza)", "rxn.mapPart": "parcial",
  "rxn.mapConf": " · confianza {x}", "rxn.mapIncomplete": " · incompleto",
  "rxn.useObjective": "◎ Usar como objetivo",

  // details: pathway / group / gene
  "sub.kind": "Ruta metabólica",
  "sub.meta": "{n} reacciones · {a} activas",
  "sub.listOnly": " · sin mapa (lista)",
  "sub.open": "Abrir mapa de la ruta",
  "sub.top": "Reacciones con más flujo",
  "sub.none": "Ninguna reacción activa en esta solución.",
  "gene.kind": "Gen / enzima",
  "gene.rxns": "Reacciones catalizadas ({n})",
  "back": "← resumen",

  // search
  "search.met": "Metabolito", "search.rxn": "Reacción", "search.gene": "Gen / enzima", "search.sub": "Ruta",
  "search.nRxns": "{n} reacciones", "search.comps": "compartimentos: {c}",

  // compartments and membranes
  "comp.cyt": "Citosol", "comp.ext": "Extracelular", "comp.mito": "Mitocondria", "comp.inner": "Espacio intermembrana",
  "comp.nuc": "Núcleo", "comp.er": "Retículo endoplásmico", "comp.golgi": "Aparato de Golgi", "comp.lyso": "Lisosoma", "comp.perox": "Peroxisoma",
  "loc.plasma": "Membrana plasmática",
  "loc.mitoInner": "Membrana mitocondrial interna",
  "loc.membrane": "Membrana · {c}",
  "err.worker": "Error en el worker del solver",
};

const en = {
  "h.model": "Metabolic model",
  "h.lang": "Interface language",
  "h.search": "Search metabolite, enzyme, gene or pathway…  (Ctrl+K)",
  "h.modeAria": "Simulation method",
  "h.steady": "Steady state",
  "h.dynamic": "Dynamic",
  "h.methodsTitle": "What does each method do?",
  "h.run": "▶ Simulate",
  "h.medium": "Medium and sources",
  "h.reset": "reset",
  "h.resetTitle": "Restore the default medium",
  "h.mediumHint": "Concentration (mM) of each available metabolite. Extracellular ones enter through their exchange reaction; intracellular ones are injected into their compartment. Press <b>⚛</b> to label atoms.",
  "h.addSupply": "Add metabolite…",
  "h.perturb": "Knockout / knockdown",
  "h.clearPerturb": "remove all",
  "h.perturbHint": "Residual activity of a gene/enzyme or a reaction: 0 % = knockout. Compared against the same simulation without perturbations (reference).",
  "h.addPerturb": "Add gene, enzyme or reaction…",
  "h.objective": "Cellular objective",
  "h.max": "Maximise",
  "h.min": "Minimise",
  "h.objInput": "objective reaction…",
  "h.pfba": "Parsimonious flux (pFBA): the solution with the lowest total flux",
  "h.dynParams": "Dynamic parameters",
  "h.dynHours": "Duration",
  "h.dynBiomass": "Initial cell density",
  "h.dynPool": "Intracellular pool size",
  "h.dynHint": "Pool sizes are assumed uniform: labelling speed is indicative only.",
  "h.inactive": "inactive",
  "h.inactiveTitle": "Show reactions and metabolites carrying no flux",
  "h.particles": "animation",
  "h.fit": "Fit map",
  "h.groupTitle": "How reactions are grouped on the global map",
  "h.filterTitle": "Show only what is affected by the tracer or by the knockout/knockdown",
  "group.pathway": "Group: pathways",
  "group.cell": "Group: cell",
  "filter.all": "Show: everything",
  "filter.label": "Labelled only",
  "filter.delta": "Changed flux only",
  "h.close": "Close",
  "h.molAllC": "All C",
  "h.molAllN": "All N",
  "h.molClear": "Clear",
  "h.molFraction": "Labelled fraction",
  "h.cancel": "Cancel",
  "h.molApply": "Apply labelling",
  "h.methods": "Simulation methods",
  "h.ok": "Got it",
  "methods.steady": `<h4>Steady state <small>FBA + isotopic steady state</small></h4>
    <p>A genome-scale model holds no concentrations or kinetics: it describes which reactions exist and their stoichiometry. Flux balance analysis (FBA) finds the flux distribution that satisfies mass balance and maximises the cellular objective (growth by default).</p>
    <ul><li>The concentration of each medium metabolite sets its <b>maximum uptake</b>: <code>Vmax·C / (Km + C)</code>.</li>
    <li>Label is propagated atom by atom to isotopic equilibrium: you see <b>what fraction of each atom</b> comes from the tracer.</li>
    <li>Result within seconds and reproducible. No time axis.</li></ul>
    <p class="when">Use it to learn <i>where</i> the label goes and how much the tracer contributes to each pathway.</p>`,
  "methods.dynamic": `<h4>Dynamic <small>approximate dynamic FBA</small></h4>
    <p>Adds time: the medium is consumed, uptake falls as nutrients run out, FBA is re-solved when availability changes and label fills pools of finite size.</p>
    <ul><li>Shows <b>the order and speed</b> at which metabolites become labelled and how fluxes shift as the medium is depleted.</li>
    <li>Animated timeline, with extracellular concentrations and biomass.</li>
    <li>Intracellular pool sizes are assumed (not measured): times are indicative, not quantitative.</li></ul>
    <p class="when">Use it to see the labelling <i>sequence</i> or the effect of exhausting a nutrient.</p>`,
  "methods.tracerH": "Isotope tracing",
  "methods.tracer": "Each reaction carries an atom-to-atom map (RXNMapper, maximum common substructure for R groups and manual curation of central metabolism). Where no map exists, product atoms receive the mean label of the unassigned substrates and the metabolite is drawn with a dashed outline: its label position is uncertain. Atoms equivalent by rotational symmetry (succinate, fumarate) are averaged; prochiral ones (citrate) are not. Hydrogen is not traced.",
  "methods.perturbH": "Knockout / knockdown",
  "methods.perturb": "A <b>knockout</b> (0 %) fixes the reaction flux at zero. For a gene the gene-protein-reaction rule is evaluated: a complex (<code>and</code>) is limited by its scarcest subunit and isoenzymes (<code>or</code>) compensate for one another, so knocking out a gene that has isoenzymes has no effect. A <b>knockdown</b> (e.g. 30 %) caps the flux at that fraction of the flux in the unperturbed reference simulation; if the reaction carried no flux in the reference, the knockdown does not constrain it. The “Changed flux only” filter shows reactions whose flux moves by more than 2 % against the reference (orange: up; blue: down). FBA has alternative optima, so keep pFBA on for a stable comparison.",

  "load.missing": "data/models.json not found. Run tools/build_all.sh and open the app through a local server (Five Server).",
  "load.model": "Loading model…",
  "load.solver": "Preparing solver…",
  "load.error": "Error loading the model: {msg}",

  "crumb.global": "Global map",
  "crumb.cell": "Cell",
  "list.hint": "This pathway is too large to draw as a map; its reactions are listed by flux ({k} of {n}).",
  "th.rxn": "Reaction", "th.eq": "Equation", "th.flux": "Flux", "th.ref": "Reference",
  "empty.filter": "Nothing in this view is affected. Switch the filter to “Show: everything” to see it in full.",

  "tip.turnover": "turnover {x} mmol/gDW/h",
  "tip.label": " · label {x} %",
  "tip.uncertain": " (uncertain position)",
  "tip.flux": "flux {x}",
  "tip.ref": " · reference {x}",
  "tip.activity": " · activity {x} %",
  "tip.group": "{n} reactions · total flux {x}",
  "tip.open": "double-click to open",

  "status.fba": "Solving flux balance…",
  "status.ref": "Computing the unperturbed reference…",
  "status.dyn": "Dynamic simulation {p} % · t = {t}",
  "status.dynRef": "Unperturbed reference {p} %",
  "status.nosol": "No solution ({why})",
  "status.steady": "Steady state",
  "status.dynamic": "Dynamic · {n} FBA",
  "status.done": "{mode} · optimal · {s} s",
  "status.notconv": " · labelling not converged",
  "status.changed": "Parameters changed: press Simulate to recompute",
  "status.error": "Error: {msg}",
  "st.infeasible": "infeasible: mass balance cannot be met with this medium and these perturbations",
  "st.unbounded": "unbounded",
  "st.unboundedOrInfeasible": "infeasible or unbounded",

  "legend.carbon": "Carbon flow between groups",
  "legend.rxnflux": "Reaction flux",
  "legend.scale": " — width and speed (log scale)",
  "legend.enrich": "Isotopic enrichment",
  "legend.uncertain": "dashed outline = uncertain label position",
  "legend.delta": "Flux change against the reference",
  "legend.down": "down", "legend.same": "same", "legend.up": "up",
  "legend.lost": "dashed line = flux that disappears",
  "legend.pert": "red ring = perturbed reaction",
  "legend.globalHint": "double-click a group to open its pathway",
  "legend.subHint": "○ metabolite · ◆ reaction · cofactors hidden",
  "legend.cellHint": "nodes sitting on a membrane are reactions that cross it (transport)",

  "supply.marked": "{p} % labelled",
  "supply.edit": "edit", "supply.remove": "remove",
  "supply.injection": " (intracellular injection)",
  "supply.hold": " · constant concentration (replenished, e.g. gas exchange)",
  "supply.unlimited": "unlimited",
  "supply.cap": "max uptake {x} mmol/gDW/h (Vmax {vmax}, Km {km} mM)",
  "supply.labelTitle": "Label atoms (isotope tracer)",
  "supply.removeTitle": "Remove from medium",

  "mol.hint": "Click atoms to label them with their stable isotope (¹³C, ¹⁵N, ¹⁸O, ³⁴S). Hydrogen is not traced.",
  "mol.noStruct": "This metabolite has no structure in the model: it can only be labelled as a whole and its label propagates without atom positions.",
  "mol.whole": "Label the whole metabolite",
  "mol.labelled": "labelled",
  "mol.atomEnrich": "{a}: {x} % labelled",
  "mol.atomAdd": "{a} — click to add {iso}",
  "mol.atomRemove": "{a} — click to remove {iso}",

  "pert.ko": "KO",
  "pert.gene": "gene", "pert.rxn": "reaction",
  "pert.geneTitle": "{sym}: {n} of {total} reactions depend on this gene (the rest have isoenzymes)",
  "pert.noEffect": "No effect: all its reactions have isoenzymes that compensate",
  "pert.activity": "Residual activity",
  "pert.removeTitle": "Remove perturbation",
  "pert.button": "✂ Knockout / knockdown",
  "pert.active": "Perturbed: residual activity {x} %",
  "pert.kdNoRef": "This reaction carries no flux in the reference: a partial knockdown does not constrain it (only a knockout does).",

  "sum.title": "Summary",
  "sum.computing": "Computing fluxes…",
  "sum.growth": "Growth", "sum.objective": "Objective",
  "sum.active": "Active reactions", "sum.of": "of {n}",
  "sum.biomass": "Biomass",
  "sum.vsref": "against the reference ({x})",
  "sum.nosol": "The solver found no solution: {why}. Check the medium (is an essential nutrient missing?), the perturbations or the objective.",
  "sum.zero": "The objective is 0: the cell cannot fulfil it with this medium and these perturbations.",
  "sum.fate": "Label fate", "sum.fateUnit": "% of labelled atoms taken up",
  "sum.excreted": "{n} (secreted)", "sum.biomassFate": "Biomass (incorporated)",
  "sum.rest": "other fates / accumulated in pools",
  "sum.noTracer": "No tracer. Press <b>⚛</b> next to a medium metabolite (e.g. glucose) to label atoms and follow their fate.",
  "sum.tracerIdle": "The tracer is not being consumed in this solution (zero uptake).",
  "sum.uptake": "Uptake", "sum.secretion": "Secretion",
  "sum.injection": "{n} (injection)",
  "sum.changed": "Most changed reactions", "sum.changedUnit": "reference → perturbed · {n} change",
  "sum.noChange": "The perturbations do not change any flux in this solution.",
  "sum.medium": "Medium over time", "sum.mediumUnit": "% of the initial concentration",
  "sum.logAxis": "logarithmic time axis ({a} → {b})",

  "met.kind": "Metabolite", "met.noFormula": "no formula",
  "met.meanEnrich": "Mean enrichment: {x} · hover an atom to see its value",
  "met.uncertain": "Part of the label arrives through reactions without an atom map: positions are approximate.",
  "met.noStruct": "No structure in the model: traced as a whole metabolite",
  "met.noStructLabel": " (label {x} %)",
  "met.addSupply": "＋ Add to medium / inject", "met.label": "⚛ Label atoms",
  "met.producedBy": "Produced by", "met.consumedBy": "Consumed by",
  "met.rxns": "Reactions ({n})", "met.noFlux": "no flux in this solution",

  "rxn.kind": "Reaction", "rxn.flux": "Flux", "rxn.bounds": "Bounds", "rxn.ref": "Reference",
  "rxn.reversible": "reversible", "rxn.irreversible": "irreversible",
  "rxn.genes": "Genes", "rxn.atommap": "Atom map",
  "rxn.mapNone": "no map: label is shared among the products",
  "rxn.mapExchange": "exchange with the environment",
  "rxn.mapCurated": "manually curated",
  "rxn.mapId": "identity (transport)", "rxn.mapMcs": "common substructure (low confidence)", "rxn.mapPart": "partial",
  "rxn.mapConf": " · confidence {x}", "rxn.mapIncomplete": " · incomplete",
  "rxn.useObjective": "◎ Use as objective",

  "sub.kind": "Metabolic pathway",
  "sub.meta": "{n} reactions · {a} active",
  "sub.listOnly": " · no map (list)",
  "sub.open": "Open pathway map",
  "sub.top": "Reactions with most flux",
  "sub.none": "No active reaction in this solution.",
  "gene.kind": "Gene / enzyme",
  "gene.rxns": "Catalysed reactions ({n})",
  "back": "← summary",

  "search.met": "Metabolite", "search.rxn": "Reaction", "search.gene": "Gene / enzyme", "search.sub": "Pathway",
  "search.nRxns": "{n} reactions", "search.comps": "compartments: {c}",

  "comp.cyt": "Cytosol", "comp.ext": "Extracellular", "comp.mito": "Mitochondrion", "comp.inner": "Intermembrane space",
  "comp.nuc": "Nucleus", "comp.er": "Endoplasmic reticulum", "comp.golgi": "Golgi apparatus", "comp.lyso": "Lysosome", "comp.perox": "Peroxisome",
  "loc.plasma": "Plasma membrane",
  "loc.mitoInner": "Inner mitochondrial membrane",
  "loc.membrane": "Membrane · {c}",
  "err.worker": "Solver worker error",
};

export const DICT = { es, en };
export const LANGS = [["es", "Español"], ["en", "English"]];
let lang = "es";

export const getLang = () => lang;

export function setLang(l) {
  lang = DICT[l] ? l : "es";
  try { localStorage.setItem("metflux.lang", lang); } catch { /* storage unavailable */ }
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}

export function initLang() {
  let l = "es";
  try { l = localStorage.getItem("metflux.lang") || l; } catch { /* storage unavailable */ }
  lang = DICT[l] ? l : "es";
  document.documentElement.lang = lang;
}

export function t(key, vars) {
  let s = DICT[lang][key] ?? es[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}

/** Fill every element carrying a data-i18n* attribute. */
export function applyDom(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
}
