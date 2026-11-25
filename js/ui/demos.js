// Worked examples that the application replays through its own controls (no separate code path, no hidden
// shortcuts). Each demo is a list of actions and a step-by-step walkthrough explaining:
//   1. Where to open/paste the data or configure the perturbation,
//   2. What input format is expected (expanding the built-in format guide where applicable), and
//   3. How to inspect the resulting outputs both inside the analysis dialog and on the map / results panel.
//
// The 6 examples mirror the core analysis types documented in docs.html:
//   ko    — Knockout, scenario comparison & conditional auxotrophy/SL screens (Cardaci et al. 2015; Docs §11–12, §15.O)
//   trace — 13C isotope tracing & Normoxia vs. Hypoxia MID comparison (Docs §10, §15.L)
//   exo   — Spent-medium exometabolomics rate estimation & LP fit (Dietmair et al. 2012, Table 2; Docs §5)
//   mtb   — Intracellular metabolomics contrast, Δ(ΔG′) & map overlay (Dietmair et al. 2012, Table S3; Docs §5)
//   rna   — Custom cell-type context from your own RNA-seq TPM table (DepMap 26Q3 HCT116; Docs §6)
//   reg   — Transcription-factor inference (ULM) from differential RNA-seq (Pal et al. 2020, GSE153906; Docs §5)

// Allowed actions. test_demos.mjs checks that every demo uses only actions listed here.
export const ACTIONS = [
  "model", "medium", "measured", "context", "objective", "perturb", "clearPerturb",
  "tracer", "setConc", "selectMet", "run", "saveScenario", "compare",
  "task", "open", "closeDialogs", "fill", "click", "loadRnaText", "setOverlay", "markTopTf",
];

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
// tools/validation/dietmair2012_intracellular.json, never transcribed by hand.
export const MTB_TABLE = `metabolite\tprod_1\tprod_2\tprod_3\tprod_4\tparent_1\tparent_2\tparent_3\tparent_4
group\tproducer\tproducer\tproducer\tproducer\tparent\tparent\tparent\tparent
ATP\t5.141\t5.14\t5.254\t5.514\t5.93\t6.373\t6.472\t6.752
ADP\t0.8376\t0.7557\t0.7758\t0.8128\t0.8718\t0.8941\t0.9633\t0.9754
AMP\t0.09645\t0.07658\t0.07737\t0.08284\t0.05676\t0.04029\t0.05184\t0.03875
GTP\t1.288\t1.299\t1.348\t1.397\t1.503\t1.593\t1.569\t1.619
NAD\t0.6868\t0.6902\t0.7206\t0.7943\t0.7016\t0.7403\t0.7726\t0.8582
LAC\t0.9633\t0.9151\t0.8719\t0.8764\t1.084\t1.005\t1.015\t1.124
PYR\t1.104\t0.9598\t0.774\t1.379\t1.056\t0.873\t0.876\t1.178
GLN\t8\t8.152\t8.759\t10.73\t10.18\t11.73\t13.72\t18.68
GLU\t30.01\t28.14\t29.13\t31.88\t31.99\t31.59\t35.2\t36.65
CIT\t0.7867\t0.9905\t0.6835\t2.485\t1.204\t1.101\t1.415\t2.778`;

// Real DepMap Public 26Q3 RNA-seq TPM values for HCT116 colon carcinoma (ACH-000971; CC BY 4.0):
// 30 core expressed Human-GEM enzymes (>= 1 TPM) + 10 tissue-specific enzymes silenced (< 1 TPM) in HCT116.
export const RNA_TABLE = `gene\tHCT116_TPM
HK1\t33.45
HK2\t30.33
GPI\t500.00
PFKM\t119.67
ALDOA\t1314.63
GAPDH\t5381.70
PGK1\t323.73
ENO1\t2205.68
ENO2\t36.38
PKM\t2249.05
LDHA\t1450.99
LDHB\t2101.62
G6PD\t96.48
PGD\t186.81
TKT\t386.47
CS\t228.22
ACO2\t66.01
IDH1\t101.66
IDH2\t15.06
OGDH\t35.66
SDHA\t108.57
SDHB\t200.43
FH\t90.99
MDH2\t242.68
GLS\t104.30
GLUD1\t162.35
ASNS\t77.97
ASS1\t26.16
PHGDH\t63.56
ACLY\t133.79
FASN\t243.88
GCLC\t71.44
PC\t5.34
GLS2\t0.00
GCK\t0.26
PCK1\t0.00
FBP1\t0.12
OTC\t0.00
ARG1\t0.18
MAT1A\t0.48
G6PC1\t0.00
ALDOB\t0.00
ADH1B\t0.00`;

// Unbiased 1-in-10 genomic stride of expressed genes in E. coli ΔarcA vs WT (GSE153906, Pal et al. 2020):
// CPM log2FC and empirical-Bayes moderated t-stat; ULM on RegulonDB ranks ArcA #1 (t = -5.03, q = 2.5e-5).
export const REG_TABLE = "gene\tlog2FC\tstat\n" + "thrL\t-1.08\t-1.23\nyaaW\t0.02\t0.05\nyaaY\t0.33\t0.94\ncaiF\t0.49\t1.63\nyaaU\t-0.46\t-0.70\ndjlA\t-0.24\t-0.93\nyabI\t1.28\t3.76\nleuA\t0.16\t0.63\nftsI\t-0.28\t-0.34\nftsA\t-0.11\t-0.37\nguaC\t-0.59\t-1.23\naceF\t-1.29\t-3.27\nhpt\t0.12\t0.34\nyadC\t0.71\t1.45\nsfsA\t-0.17\t-0.68\nerpA\t-0.82\t-2.46\nglnD\t0.15\t0.54\nbamA\t0.11\t0.45\nyaeR\t-0.21\t-0.39\nrcsF\t-0.27\t-0.58\ngloB\t-0.05\t-0.16\nivy\t-0.24\t-0.60\nlafU\t-0.32\t-0.94\ninsB9\t0.07\t0.13\ninsN-1\t0.36\t0.94\ninsX\t0.46\t0.88\nyagJ\t0.47\t1.68\npaoA\t0.52\t1.69\nykgO\t0.52\t1.31\nykgE\t1.84\t2.25\nyahB\t0.43\t0.80\nyahN\t0.29\t1.09\ncynT\t-0.79\t-1.66\nmhpC\t1.23\t2.99\nyaiX_1\t0.66\t2.18\nampH\t0.81\t1.18\nproC\t-0.03\t-0.11\nsbcC\t-0.09\t-0.23\nyajC\t-0.32\t-1.21\nthiL\t0.28\t0.75\nyajR\t-0.52\t-1.88\nclpP\t-0.19\t-0.58\ndecR\t-0.03\t-0.09\nylaC\t0.92\t2.23\nybaN\t0.01\t0.02\nybaL\t-0.05\t-0.18\nybbJ\t-0.10\t-0.35\nybbC\t0.57\t1.28\nhyi\t0.63\t1.32\nylbE\t-0.48\t-0.77\nfolD\t-0.35\t-1.40\nybcK\t0.91\t2.80\nybcW\t0.42\t1.20\nnfrA\t-0.23\t-0.88\nnfsB\t-0.54\t-1.30\nentF\t-1.33\t-2.76\nentA\t-0.77\t-1.76\nahpC\t-0.40\t-1.41\ndpiB\t0.04\t0.09\nybeF\t0.18\t0.45\nnadD\t0.50\t1.92\ndjlC\t0.28\t0.73\nybeY\t-0.38\t-1.21\nglnS\t-0.40\t-1.58\nybfP\t0.27\t0.96\nrhsC\t-1.16\t-2.69\nybgI\t-0.43\t-1.35\ngltA\t2.23\t6.92\nmngR\t-0.52\t-2.08\ntolA\t-0.04\t-0.14\ngalM\t0.09\t0.20\nybhA\t-0.77\t-2.33\nbioC\t0.69\t1.00\nybhL\t-0.25\t-0.88\ncecR\t0.09\t0.17\nmcbA\t-0.52\t-1.52\nyliL\t-0.39\t-0.51\nmoeB\t-0.35\t-1.27\nbssR\t0.65\t2.15\nrcdA\t0.24\t0.65\npotH\t0.69\t2.21\nybjQ\t-0.23\t-0.79\nybjD\t0.11\t0.42\ncydD\t-1.32\t-3.71\nycaC\t-0.45\t-0.85\nserC\t-0.62\t-2.41\nycaR\t0.37\t1.20\ngloC\t0.19\t0.57\nssuE\t0.47\t1.20\nycbX\t-0.14\t-0.36\nompA\t-0.24\t-0.90\nrlmI\t-0.57\t-1.46\nappC\t-2.67\t-9.32\ngfcA\t-0.32\t-1.26\ntorC\t-0.60\t-1.85\nymdF\t-0.18\t-0.56\nefeB\t-0.02\t-0.05\nycdY\t0.07\t0.22\nclsC\t0.43\t1.60\nyceJ\t0.82\t2.23\nyceM\t0.09\t0.29\nflgJ\t0.10\t0.37\nfabH\t0.20\t0.71\nptsG\t0.47\t1.87\ncomR\t-0.17\t-0.52\nycfZ\t-0.70\t-1.75\npurB\t-0.47\t-0.98\nintE\t0.76\t2.32\nymfQ\t-0.29\t-0.64\nbluR\t0.29\t0.82\nymgD\t-0.44\t-1.09\nycgL\t-0.14\t-0.33\ndadA\t1.43\t2.41\ndhaL\t1.69\t3.00\nlolB\t-0.41\t-1.60\nchaA\t-0.01\t-0.05\nnarJ\t1.05\t4.09\nychG_2\t-0.26\t-0.85\nyciU\t0.10\t0.41\nyciE\t1.13\t1.42\nyciO\t-0.01\t-0.04\nyciX\t1.57\t1.60\nyciZ\t-0.13\t-0.36\nsapA\t-0.15\t-0.43\npspA\t-1.80\t-2.04\nycjR\t0.01\t0.03\nycjG\t0.33\t0.85\nfnr\t0.27\t0.95\ndbpA\t0.12\t0.44\nracR\t0.76\t1.78\ninsH-5\t-0.28\t-0.72\nydbJ\t0.44\t0.73\npaaA\t0.34\t0.78\npaaY\t0.27\t0.89\nhrpA\t0.05\t0.19\nydcJ\t2.50\t3.22\nydcO\t0.12\t0.32\nydcV\t0.69\t2.78\nyncE\t-2.36\t-5.78\nyddH\t0.98\t1.77\nfdnH\t0.35\t0.93\nddpD\t1.07\t4.15\npqqL\t-1.37\t-2.38\nydeT\t0.21\t0.59\nlsrB\t-0.09\t-0.20\nyneJ\t-0.10\t-0.21\nydeI\t0.66\t2.59\ntfaQ\t0.31\t0.94\nydfR\t0.95\t2.73\nydfV\t-0.32\t-0.74\nydfE\t1.05\t2.46\nynfE\t0.85\t2.48\nasr\t0.55\t1.29\nydgC\t0.98\t2.91\nuidA\t0.03\t0.04\nydgK\t-0.64\t-1.73\npdxY\t-0.26\t-0.97\nsodC\t0.17\t0.54\nsodB\t2.57\t9.61\nydhR\t-0.06\t-0.10\nlpp\t-0.54\t-1.51\nydiJ\t0.88\t2.54\nydiQ\t0.54\t1.40\nnlpC\t-0.36\t-0.83\ninfC\t-0.31\t-0.98\nydjM\t0.37\t1.03\nchbB\t0.03\t0.12\nastC\t4.28\t6.31\nynjF\t0.18\t0.54\npncA\t-0.70\t-2.82\nmsrB\t1.94\t6.55\nyoaI\t0.26\t0.96\nyoaG\t-0.52\t-1.65\nyeaY\t0.72\t2.25\nyoaE\t0.23\t0.59\nmgrB\t0.99\t3.96\nrsmF\t-0.35\t-0.99\nptrB\t-0.03\t-0.11\nlpxM\t-0.22\t-0.60\nyebC\t-0.17\t-0.52\ncutC\t0.56\t1.49\ncheR\t0.13\t0.25\notsA\t0.63\t2.31\nftnA\t0.10\t0.15\ntcyL\t0.93\t2.89\nyedF\t0.33\t0.93\nrcsA\t0.81\t2.71\nyedJ\t-0.38\t-1.26\nmsrQ\t0.13\t0.35\nyeeO\t0.46\t1.71\nyoeA_1\t0.42\t0.88\nyeeA\t0.58\t1.39\nyoeB\t0.17\t0.64\nhisI\t-0.23\t-0.88\nwbbH\t1.22\t1.96\nwcaK\t0.21\t0.70\nwcaC\t0.49\t1.97\nyegI\t-0.05\t-0.16\nbaeR\t0.15\t0.42\ngatC\t2.13\t6.60\nyegX\t-0.17\t-0.67\nyehE\t1.05\t2.09\nyehR\t0.39\t1.44\nbglX\t-0.75\t-2.97\nyohK\t-0.79\t-2.79\nyeiB\t0.23\t0.60\nrihB\t-0.69\t-1.98\nyeiP\t-0.34\t-0.91\nyejG\t2.20\t3.88\nnarP\t0.22\t0.68\nnapB\t0.17\t0.38\nada\t0.11\t0.35\natoE\t0.66\t1.65\nypaB\t0.62\t1.41\nglpC\t0.21\t0.38\nais\t0.54\t0.89\nmenC\t0.08\t0.24\nyfbM\t-0.20\t-0.55\nnuoH\t2.10\t5.73\nyfbS\t0.52\t1.35\nyfcG\t-0.30\t-0.85\npurF\t-0.73\t-1.20\nyfcJ\t-0.22\t-0.50\nyfcO\t-0.25\t-0.97\nfadL\t2.16\t3.98\nyfdL\t0.03\t0.10\nevgA\t0.77\t2.60\ntpke70\t1.25\t1.67\nglk\t0.46\t1.12\nxapR\t0.39\t0.97\ncysK\t0.78\t1.00\ncysU\t1.81\t1.58\nypeA\t-0.38\t-0.86\nyffM\t0.17\t0.37\neutJ\t-0.60\t-1.54\ntktB\t0.25\t0.92\nypfH\t-0.19\t-0.66\nhyfE\t-0.17\t-0.59\nyfgD\t-0.02\t-0.07\nyfgH\t0.45\t1.34\nispG\t0.11\t0.40\npepB\t-0.41\t-1.05\nsuhB\t-1.05\t-3.05\nyphA\t-0.06\t-0.19\nglnB\t-0.71\t-2.38\nryfB\t0.25\t0.48\nrseA\t1.17\t3.07\nyfiF\t-0.77\t-1.95\nbamD\t-0.35\t-1.38\nrplS\t-0.43\t-1.65\nbamE\t0.30\t0.64\nabpA\t0.39\t1.14\nypjM_2\t0.33\t0.61\nlhgO\t0.26\t0.70\nalaE\t0.15\t0.22\nygaY_1\t-0.03\t-0.04\nyqaB\t-0.37\t-1.00\nsrlR\t0.27\t0.81\nhycI\t0.51\t0.93\nhypB\t0.98\t1.97\nygbK\t-0.00\t-0.01\nispD\t0.43\t1.68\ncasD\t-0.39\t-1.59\nygcP\t0.01\t0.03\neno\t-0.16\t-0.53\ngudP\t-0.26\t-0.53\nfucO\t0.63\t1.48\nygdI\t0.59\t1.40\nrecC\t0.21\t0.73\nmutH\t0.48\t1.03\naraE\t0.17\t0.39\nygeH\t1.08\t2.57\nxdhB\t-0.28\t-0.86\nmocA\t1.94\t4.94\nuacT\t-0.81\t-1.08\nygfZ\t-0.09\t-0.19\npepP\t0.09\t0.34\nargK\t0.07\t0.22\nyggC\t0.43\t1.61\nyqgD\t0.36\t1.28\nyggS\t0.00\t0.01\nmutY\t-0.19\t-0.50\nyghJ\t-0.34\t-0.87\ninsH-9\t0.63\t1.68\nhybE\t0.04\t0.13\nyqhA\t-0.14\t-0.46\nyqhG\t-0.27\t-0.60\nygiW\t-0.28\t-0.45\nnudF\t0.07\t0.24\nygiL\t0.56\t1.88\nygiF\t-0.01\t-0.04\ntsaD\t-0.52\t-1.17\nebgR\t-0.33\t-1.02\nygjP\t0.14\t0.32\nexuR\t0.12\t0.46\nyhaI\t0.66\t2.11\ntdcC\t-0.29\t-0.75\nprlF\t-0.12\t-0.35\nyraH\t0.41\t1.38\nyhbO\t-0.13\t-0.39\nyrbN\t-0.36\t-0.82\nyhbX\t-0.25\t-0.79\nyhbE\t0.20\t0.59\nmlaE\t0.13\t0.50\nptsN\t0.52\t1.84\ngltF\t0.95\t2.61\nnanE\t-0.06\t-0.18\nyhcB\t-0.04\t-0.11\naaeR\t0.03\t0.12\nyrdF\t0.18\t0.52\nyhdJ\t-0.04\t-0.07\nyrdA\t-0.26\t-0.79\ntrkA\t-0.06\t-0.19\nrpmJ\t-0.21\t-0.76\nrplX\t0.07\t0.29\nrplD\t0.27\t0.98\ngspH\t0.36\t1.07\nfusA\t-0.05\t-0.18\nyheV\t0.57\t2.06\nargD\t-1.82\t-2.35\nyhfL\t0.09\t0.29\nyhfY\t0.03\t0.03\nhofP\t-0.15\t-0.24\nenvZ\t-0.21\t-0.73\nnfuA\t-1.18\t-2.79\nglpE\t0.57\t1.18\ngntU\t-0.27\t-0.77\nggt\t-0.35\t-1.26\nlivH\t-0.22\t-0.57\nyhhM\t-0.70\t-1.50\nnikB\t0.50\t1.25\nrbbA\t-0.22\t-0.37\ndtpB\t0.33\t0.91\ninsH-11\t0.43\t1.29\nmdtF\t-1.22\t-3.66\nyhjG\t-0.15\t-0.45\nbcsQ\t0.91\t3.04\ndppB\t1.14\t3.17\nyiaF\t-0.33\t-1.24\nxylA\t-0.32\t-0.81\nyiaK\t0.62\t1.34\nyiaV\t-0.27\t-0.63\nyibG\t0.09\t0.35\nyibL\t-0.45\t-1.48\ngpmM\t0.04\t0.11\nwaaL\t1.08\t1.29\nwaaQ\t0.24\t0.94\npyrE\t-0.21\t-0.58\nrecG\t-0.49\t-1.15\nnepI\t0.19\t0.36\nivbL\t0.14\t0.11\nysdC\t-0.07\t-0.24\ndgoT\t-0.03\t-0.07\ndnaN\t-0.14\t-0.46\nmdtL\t-0.08\t-0.26\nbglH\t-0.07\t-0.21\nglmU\t-0.00\t-0.00\nrsmG\t0.01\t0.02\nrbsC\t1.08\t2.66\nilvX\t0.87\t2.42\nyifO\t0.76\t2.51\nwecB\t0.26\t0.99\nyifK\t0.17\t0.67\nyifL\t0.31\t0.77\nyigI\t1.60\t4.43\nysgA\t0.46\t1.60\nrfaH\t0.97\t3.12\nmobA\t-0.04\t-0.15\nyshB\t-0.24\t-0.69\nyihP\t0.25\t0.55\ndtd\t0.08\t0.28\nfrvX\t-0.58\t-1.44\ncpxA\t0.02\t0.06\nyiiS\t0.26\t0.69\nhslV\t-0.45\t-0.84\nkatG\t1.35\t4.75\nfrwD\t0.34\t0.63\nfabR\t0.28\t0.80\nnusG\t-0.02\t-0.06\nthiS\t0.35\t1.19\nyjaH\t0.30\t0.57\naceA\t0.30\t1.00\npgi\t-0.10\t-0.30\nlamB\t2.81\t6.70\nzur\t0.41\t1.45\nyjbR\t-0.23\t-0.85\nactP\t2.59\t8.51\ngltP\t-1.18\t-3.42\nalsB\t-0.16\t-0.22\nyjdM\t-0.47\t-1.54\nadiA\t-0.76\t-1.22\nyjdJ\t0.10\t0.33\ncutA\t0.02\t0.06\nefp\t-0.78\t-2.08\nepmA\t-0.10\t-0.30\nyjeF\t0.12\t0.32\npurA\t-0.41\t-1.05\nyjfN\t1.68\t2.15\nyjfY\t-0.58\t-1.11\nytfE\t-0.56\t-1.94\nmsrA\t-0.24\t-0.66\nytfT\t0.41\t1.45\ntreB\t1.22\t1.18\nbdcA\t0.23\t0.56\npepA\t-0.29\t-0.96\nintB\t0.08\t0.23\ninsN-2\t0.45\t1.36\ninsA-7\t-0.35\t-0.85\nsgcA\t0.30\t1.22\nnanS\t0.33\t0.85\nfimG\t0.16\t0.26\nhypT\t0.32\t0.86\nyjiN\t0.16\t0.47\nsymE\t0.09\t0.28\nlgoR\t1.32\t4.41\nfhuF\t-0.38\t-1.04\nyjjV\t-0.95\t-2.71\nserB\t-0.25\t-0.67\ncreB\t-0.07\t-0.26";

export const DEMOS = [
  {
    id: "ko",
    docs: "screen-nutrients",
    needs: { model: "human-gem" },
    cite: "The perturbation of Cardaci et al., Nature Cell Biology 17 (2015), doi 10.1038/ncb3233: cells without succinate dehydrogenase.",
    actions: [
      ["closeDialogs"],
      ["task", "sim"],
      ["context", null, "complex"],
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
      { id: "demo.ko.1", sel: "#secObjective", task: "sim", open: "" },
      { id: "demo.ko.2", sel: "#secMedium", task: "sim", open: "" },
      { id: "demo.ko.3", sel: "#secPerturb", task: "sim", open: "" },
      { id: "demo.ko.4", sel: "#secCompare", task: "cmp", open: "" },
      { id: "demo.ko.5", sel: "#cmpViews", task: "cmp", open: "" },
      { id: "demo.ko.6", sel: "#details", task: "cmp", open: "" },
      { id: "demo.ko.7", sel: "#secDiffScreens", task: "cmp", open: "" },
    ],
  },
  {
    id: "trace",
    docs: "tracing",
    needs: { model: "human-gem" },
    cite: "Worked experiment L of the Docs (Human-GEM with NCI-60 median exchanges, Jain et al. 2012): [U-13C6]glucose in normoxia versus hypoxia.",
    actions: [
      ["closeDialogs"],
      ["task", "sim"],
      ["context", null, "complex"],
      ["medium", "defaultSerum"],
      ["measured", "nci60"],
      ["objective", "biomassNoCof"],
      ["clearPerturb"],
      ["tracer", "glc_u"],
      ["run"],
      ["saveScenario", "Normoxia"],
      ["setConc", "O2", 0.005],
      ["run"],
      ["compare", "last"],
      ["selectMet", "citrate"],
      ["task", "cmp"],
    ],
    steps: [
      { id: "demo.trace.1", sel: "#trLib", task: "sim", open: "" },
      { id: "demo.trace.2", sel: "#secMedium", task: "sim", open: "" },
      { id: "demo.trace.3", sel: "#secCompare", task: "cmp", open: "" },
      { id: "demo.trace.4", sel: "#map", task: "cmp", open: "" },
      { id: "demo.trace.5", sel: "#details", task: "cmp", open: "" },
      { id: "demo.trace.6", sel: "#secDesign", task: "cmp", open: "" },
    ],
  },
  {
    id: "exo",
    docs: "exometabolomics",
    needs: { model: "human-gem" },
    cite: "Built from the exchange rates of Dietmair et al., PLoS ONE 7:e43394 (2012), Table 2, with their own dry mass per cell (514 pg/cell).",
    actions: [
      ["closeDialogs"],
      ["task", "sim"],
      ["context", null, "complex"],
      ["medium", "dmem"],
      ["measured", "none"],
      ["objective", "biomassNoCof"],
      ["clearPerturb"],
      ["run"],
      ["task", "data"],
      ["open", "exo"],
      ["fill", "exoText", EXO_TABLE],
      ["fill", "exoGdw", "514"],
      ["click", "exoParse"],
      ["click", "exoCheck"],
    ],
    steps: [
      { id: "demo.exo.0", sel: "#exoOpen", task: "data", open: "" },
      { id: "demo.exo.1", sel: "#exoDialog .rna-how", open: "exo", expand: "#exoDialog .rna-how" },
      { id: "demo.exo.2", sel: "#exoText", open: "exo" },
      { id: "demo.exo.3", sel: "#exoGdw", open: "exo" },
      { id: "demo.exo.4", sel: "#exoRates", open: "exo" },
      { id: "demo.exo.5", sel: "#exoMu", open: "exo" },
      { id: "demo.exo.6", sel: "#exoFit", open: "exo" },
      { id: "demo.exo.7", sel: "#exoApply", open: "exo" },
    ],
  },
  {
    id: "mtb",
    docs: "metabolomics",
    needs: { model: "human-gem" },
    cite: "Ten metabolites of Table S3 of Dietmair et al., PLoS ONE 7:e43394 (2012), CC BY 4.0: the recombinant-protein producer line against its parent.",
    actions: [
      ["closeDialogs"],
      ["task", "sim"],
      ["context", null, "complex"],
      ["medium", "defaultSerum"],
      ["measured", "hek293"],
      ["objective", "biomassNoCof"],
      ["clearPerturb"],
      ["run"],
      ["task", "data"],
      ["open", "mtb"],
      ["fill", "mtbText", MTB_TABLE],
      ["fill", "mtbPatA", "producer"],
      ["fill", "mtbPatB", "parent"],
      ["click", "mtbRun"],
      ["setOverlay", true],
    ],
    steps: [
      { id: "demo.mtb.0", sel: "#mtbOpen", task: "data", open: "" },
      { id: "demo.mtb.1", sel: "#mtbDialog .rna-how", open: "mtb", expand: "#mtbDialog .rna-how" },
      { id: "demo.mtb.2", sel: "#mtbText", open: "mtb" },
      { id: "demo.mtb.3", sel: "#mtbPatA", open: "mtb" },
      { id: "demo.mtb.4", sel: "#mtbOut", open: "mtb" },
      { id: "demo.mtb.5", sel: "#mtbUnmappedBox", open: "mtb", expand: "#mtbUnmappedBox" },
      { id: "demo.mtb.6", sel: "#map", task: "data", open: "" },
      { id: "demo.mtb.7", sel: "#secMtb", task: "data", open: "" },
    ],
  },
  {
    id: "rna",
    docs: "userdata",
    needs: { model: "human-gem" },
    cite: "DepMap Public 26Q3 RNA-seq TPM (CC BY 4.0) for HCT116 colon carcinoma (ACH-000971): 33 expressed core enzymes and 10 silenced tissue-specific genes.",
    actions: [
      ["closeDialogs"],
      ["task", "sim"],
      ["context", null, "complex"],
      ["medium", "defaultSerum"],
      ["measured", "none"],
      ["objective", "biomassNoCof"],
      ["clearPerturb"],
      ["run"],
      ["task", "data"],
      ["open", "rna"],
      ["loadRnaText", RNA_TABLE, "HCT116_DepMap26Q3.tsv"],
    ],
    steps: [
      { id: "demo.rna.0", sel: "#rnaOpen", task: "data", open: "" },
      { id: "demo.rna.1", sel: "#rnaDialog .rna-how", open: "rna", expand: "#rnaDialog .rna-how" },
      { id: "demo.rna.2", sel: "#rnaParsed", open: "rna" },
      { id: "demo.rna.3", sel: "#rnaInfo", open: "rna" },
      { id: "demo.rna.4", sel: "#rnaBuild", open: "rna" },
      { id: "demo.rna.5", sel: "#secContext", task: "sim", open: "" },
    ],
  },
  {
    id: "reg",
    docs: "regulators",
    needs: { model: "ecoli-gem" },
    cite: "Unbiased 1-in-10 genomic stride of ΔarcA vs WT RNA-seq in E. coli K-12 MG1655 (Pal et al., NCBI GEO GSE153906) scored against RegulonDB v14.5.1.",
    actions: [
      ["closeDialogs"],
      ["model", "ecoli-gem"],
      ["task", "sim"],
      ["context", null, "complex"],
      ["medium", "m9glcAnaer"],
      ["measured", "ecoliGlcAnaer"],
      ["objective", "biomass"],
      ["clearPerturb"],
      ["run"],
      ["task", "data"],
      ["open", "reg"],
      ["fill", "regText", REG_TABLE],
      ["click", "regRun"],
      ["markTopTf"],
    ],
    steps: [
      { id: "demo.reg.0", sel: "#regOpen", task: "data", open: "" },
      { id: "demo.reg.1", sel: "#regDialog .rna-how", open: "reg", expand: "#regDialog .rna-how" },
      { id: "demo.reg.2", sel: "#regText", open: "reg" },
      { id: "demo.reg.3", sel: "#regMeta", open: "reg" },
      { id: "demo.reg.4", sel: "#regOut", open: "reg" },
      { id: "demo.reg.5", sel: "#map", task: "data", open: "" },
      { id: "demo.reg.6", sel: "#secRna", task: "data", open: "" },
    ],
  },
];

export const demoById = (id) => DEMOS.find((d) => d.id === id);

/**
 * Replay a demo's actions through the application, then walk through it.
 */
export async function runDemo(demo, api) {
  // `needs.model` is a promise to the reader, so the runner keeps it rather than trusting each example to
  // carry a "model" action of its own. Only the E. coli one ever did, so after running it every other example
  // would have replayed on E. coli: the picker asks whether to switch organism but cannot switch it by itself.
  // When the model is already loaded this costs nothing (the handler compares the slug first).
  if (demo.needs?.model) await api.model(demo.needs.model);
  for (const [what, ...args] of demo.actions) {
    const fn = api[what];
    if (!fn) { api.note?.(`demo ${demo.id}: no handler for "${what}"`); continue; }
    await fn(...args);
  }
  api.tour(demo.steps);
}
