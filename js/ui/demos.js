// A library of worked examples. Each one sets the application up from published data and then walks through
// it: what was chosen in every input, and how to read what comes out.
//
// A demo is DATA, not code. `actions` is an ordered list that is replayed through the application's own
// functions — the same code paths a person clicking would take, so a demo cannot drift from the real
// behaviour. `steps` are then handed to the walkthrough in js/ui/tour.js, which already highlights an
// element, switches to its task tab and restores the tab afterwards. Step prose lives in the i18n files
// under `tour.demo.<id>.<n>.t` and `.b`, exactly like the ordinary walkthrough.
//
// Adding an example means adding an entry here and its texts. Nothing else.
//
// Every demo names the work its data comes from. Where a table is quoted it is small, attributed, and from
// an open-access paper.

/** The actions a demo may ask for. Everything goes through the application, nothing is faked. */
export const ACTIONS = ["model", "medium", "measured", "context", "objective", "perturb", "clearPerturb",
  "run", "saveScenario", "compare", "task", "open", "fill", "click", "wait"];

// A 48 h course of HEK293 in a 20 mL flask, built from the rates Dietmair et al. published in their
// Table 2 (glucose 528 and lactate 695 µmol/gDW/h) with their own dry mass of 514 pg/cell (Table S1) and
// growth of 0.028 1/h. Feeding it back through the importer has to return those rates: it is the same
// arithmetic the application does, run in reverse.
export const EXO_TABLE = `condition\treplicate\ttime_h\tmetabolite\tconc_mM\tvolume_mL\tcells
hek293\t1\t0\tglucose\t25\t20\t10000000
hek293\t1\t48\tglucose\t11.26\t20\t38133000
hek293\t1\t0\tL-lactate\t0\t20\t10000000
hek293\t1\t48\tL-lactate\t18.09\t20\t38133000
hek293\t1\t0\tglutamine\t4\t20\t10000000
hek293\t1\t48\tglutamine\t3.24\t20\t38133000`;

// Ten metabolites of the intracellular panel of Dietmair et al. 2012, Table S3 (CC BY 4.0): the producer
// line against its non-producing parent, the four time points of each as the four columns. Relative
// concentrations, which is all this comparison needs. Generated from
// tools/validation/dietmair2012_intracellular.json, never transcribed by hand: the first attempt at copying
// these numbers got 7 of 9 wrong, and a worked example with wrong data teaches the wrong thing.
export const MTB_TABLE = `metabolite	prod_1	prod_2	prod_3	prod_4	parent_1	parent_2	parent_3	parent_4
group	producer	producer	producer	producer	parent	parent	parent	parent
ATP	5.141	5.14	5.254	5.514	5.93	6.373	6.472	6.752
ADP	0.8376	0.7557	0.7758	0.8128	0.8718	0.8941	0.9633	0.9754
AMP	0.09645	0.07658	0.07737	0.08284	0.05676	0.04029	0.05184	0.03875
GTP	1.288	1.299	1.348	1.397	1.503	1.593	1.569	1.619
NAD	0.6868	0.6902	0.7206	0.7943	0.7016	0.7403	0.7726	0.8582
LAC	0.9633	0.9151	0.8719	0.8764	1.084	1.005	1.015	1.124
PYR	1.104	0.9598	0.774	1.379	1.056	0.873	0.876	1.178
GLN	8	8.152	8.759	10.73	10.18	11.73	13.72	18.68
GLU	30.01	28.14	29.13	31.88	31.99	31.59	35.2	36.65
CIT	0.7867	0.9905	0.6835	2.485	1.204	1.101	1.415	2.778`;

export const DEMOS = [
  {
    id: "ko",
    needs: { model: "human-gem" },
    cite: "The perturbation of Cardaci et al., Nature Cell Biology 17 (2015), doi 10.1038/ncb3233: cells without succinate dehydrogenase.",
    actions: [
      ["task", "sim"],
      ["medium", "defaultSerum"],
      ["measured", "none"],
      ["objective", "biomassNoCof"],
      ["clearPerturb"],
      ["run"],
      ["saveScenario", "WT"],
      ["perturb", "gene", "SDHB", 0],
      ["run"],
      ["compare", "last"],
      ["task", "cmp"],
    ],
    steps: [
      { id: "demo.ko.1", sel: "#secObjective", task: "sim" },
      { id: "demo.ko.2", sel: "#secMedium", task: "sim" },
      { id: "demo.ko.3", sel: "#secPerturb", task: "sim" },
      { id: "demo.ko.4", sel: "#secCompare", task: "cmp" },
      { id: "demo.ko.5", sel: "#cmpViews" },
      { id: "demo.ko.6", sel: "#secDiffScreens", task: "cmp" },
    ],
  },
  {
    id: "exo",
    needs: { model: "human-gem" },
    cite: "Built from the exchange rates of Dietmair et al., PLoS ONE 7:e43394 (2012), Table 2, with their own dry mass per cell.",
    actions: [
      ["task", "sim"],
      ["medium", "dmem"],
      ["objective", "biomassNoCof"],
      ["clearPerturb"],
      ["run"],
      ["task", "data"],
      ["open", "exo"],
      ["fill", "exoText", EXO_TABLE],
      ["fill", "exoGdw", "514"],
      ["click", "exoParse"],
    ],
    steps: [
      { id: "demo.exo.1", sel: "#exoText" },
      { id: "demo.exo.2", sel: "#exoGdw" },
      { id: "demo.exo.3", sel: "#exoRates" },
      { id: "demo.exo.4", sel: "#exoMu" },
      { id: "demo.exo.5", sel: "#exoCheck" },
    ],
  },
  {
    id: "mtb",
    needs: { model: "human-gem" },
    cite: "Nine metabolites of Table S3 of Dietmair et al., PLoS ONE 7:e43394 (2012), CC BY 4.0: the recombinant-protein producer line against its parent.",
    actions: [
      ["task", "sim"],
      ["medium", "defaultSerum"],
      ["objective", "biomassNoCof"],
      ["clearPerturb"],
      ["run"],
      ["task", "data"],
      ["open", "mtb"],
      ["fill", "mtbText", MTB_TABLE],
      ["fill", "mtbPatA", "producer"],
      ["fill", "mtbPatB", "parent"],
      ["click", "mtbRun"],
    ],
    steps: [
      { id: "demo.mtb.1", sel: "#mtbText" },
      { id: "demo.mtb.2", sel: "#mtbPatA" },
      { id: "demo.mtb.3", sel: "#mtbOut" },
      { id: "demo.mtb.4", sel: "#mtbOut" },
      { id: "demo.mtb.5", sel: "#mtbUnmappedBox" },
    ],
  },
];

export const demoById = (id) => DEMOS.find((d) => d.id === id);

/**
 * Replay a demo's actions through the application, then walk through it.
 * @param demo one entry of DEMOS
 * @param api { model, medium, measured, context, objective, perturb, clearPerturb, run, saveScenario,
 *              compare, task, open, fill, click, tour, note }
 *        Each one is the application's own function; this module never touches the DOM except through
 *        `fill` and `click`, which the application provides.
 */
export async function runDemo(demo, api) {
  for (const [what, ...args] of demo.actions) {
    const fn = api[what];
    if (!fn) { api.note?.(`demo ${demo.id}: no handler for "${what}"`); continue; }
    // every step is awaited: a demo must not race the solver
    await fn(...args);
  }
  api.tour(demo.steps);
}
