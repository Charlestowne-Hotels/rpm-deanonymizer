/* =====================================================================
   Matrix calibration
   ---------------------------------------------------------------------
   The CoStar RevPAR Positioning Matrix has unlabeled but LINEAR axes,
   with the crosshair through the subject. Given pixel positions of every
   dot, the subject's actual Occ/ADR (offset) and the comp-set tie-out
   (scale), each axis has a closed-form solution for any dot→hotel
   assignment:

     occ_i = occS + (x_i - xS)·kx     kx = (OCC - occS)·Σr / Σ r_i(x_i - xS)
     adr_i = adrS + (yS - y_i)·ky     ky = (ADR - adrS)·Σs / Σ s_i(yS - y_i)
                                      s_i = r_i·occ_i/100 (rooms sold)

   The only unknown is the assignment. We enumerate every permutation,
   reject impossible ones (negative scale, Occ outside 0–100, ADR ≤ 0,
   RevPAR order contradicting the dot labels) and rank the survivors by
   agreement with user-entered ranks and with last month's positions.
   Comp-set figures are COMPETITORS ONLY (subject excluded), matching STR.
   ===================================================================== */
import type { MonthData } from './types';

export interface MatrixDot {
  x: number;            // natural image pixels, origin top-left
  y: number;
  label: number;        // RevPAR rank printed on the dot (1 = best)
}

export interface CalibHotel {
  id: number;
  name: string;
  rooms: number;
  rankOcc: number | null;   // user's "rank vs you" entries, used as soft priors
  rankAdr: number | null;
}

/** Last month's indexes per hotel id, used to prefer stable assignments. */
export type CalibPrior = Record<number, { occIdx: number; adrIdx: number }>;

export interface CalibPlacement {
  hotelId: number;
  label: number;
  occ: number;
  adr: number;
  occIdx: number;
  adrIdx: number;
  revpar: number;
}

export interface CalibCandidate {
  assign: Record<number, number>;   // hotelId → dot label
  placements: CalibPlacement[];
  kx: number;                       // occupancy points per pixel
  ky: number;                       // ADR dollars per pixel
  score: number;                    // lower is better
  penalties: { revparOrder: number; userRanks: number; prior: number };
}

export type Confidence = 'high' | 'medium' | 'low' | 'none';

export interface CalibResult {
  candidates: CalibCandidate[];     // best first
  considered: number;
  feasible: number;
  confidence: Confidence;
  errors: string[];                 // blocking problems with the input
  notes: string[];                  // non-blocking warnings
  /** ± index points per ±1 px of click/detection error, for the best candidate. */
  sensitivity?: { occIdxPerPx: number; adrIdxPerPx: number };
}

export interface CalibInput {
  dots: MatrixDot[];
  month: MonthData;
  hotels: CalibHotel[];      // competitors only
  subjectLabel: number;      // which dot label is the subject
  prior?: CalibPrior;
  /** Hard constraints the user set: hotelId → dot label ("dot 1 is the Ritz"). */
  fixed?: Record<number, number>;
  maxResults?: number;
}

const MAX_COMPS = 10;        // 10! = 3.6M permutations; beyond that we stop
const OCC_CAP = 100.3;       // small tolerance for pixel noise at the 100% wall
const ORDER_HARD = 0.03;     // reject if a RevPAR order violation exceeds 3% of comp RevPAR
const PX_TIE = 2;            // dots within this many px are treated as tied for rank checks

/* ---------- input validation (assignment-independent) ---------- */
function validate(inp: CalibInput, errors: string[], notes: string[]) {
  const { dots, month, hotels, subjectLabel } = inp;
  const N = dots.length;
  const labels = dots.map((d) => d.label).sort((a, b) => a - b);
  if (labels.some((l, i) => l !== i + 1))
    errors.push(`Dot numbers must run 1–${N} with no gaps or repeats.`);
  if (N - 1 !== hotels.length)
    errors.push(`The matrix shows ${N - 1} competitors but the table has ${hotels.length}. Add or remove hotels so they match.`);
  if (month.occ.setSize > 0 && month.occ.setSize !== N)
    errors.push(`STAR says the set has ${month.occ.setSize} hotels, but ${N} dots were marked. Check you selected the right matrix.`);
  if (hotels.length > MAX_COMPS)
    errors.push(`More than ${MAX_COMPS} competitors is too many to test every combination.`);
  const missing = hotels.filter((h) => !(h.rooms > 0)).map((h) => h.name);
  if (missing.length) errors.push(`Enter Keys for: ${missing.join(', ')}.`);

  const subj = dots.find((d) => d.label === subjectLabel);
  if (!subj) { errors.push(`No dot is numbered ${subjectLabel} (your property's RevPAR rank).`); return; }

  // Geometry must agree with the subject's STAR ranks, whatever the assignment.
  const checkRank = (rank: number, better: (d: MatrixDot) => number, axis: string) => {
    if (!(rank > 0)) return;
    const others = dots.filter((d) => d !== subj);
    const sure = others.filter((d) => better(d) > PX_TIE).length;
    const maybe = others.filter((d) => Math.abs(better(d)) <= PX_TIE).length;
    if (rank - 1 < sure || rank - 1 > sure + maybe)
      notes.push(`${axis}: the dots put you at rank ${sure + 1}${maybe ? `–${sure + 1 + maybe}` : ''}, but STAR says ${rank}. Is this the right month, and is dot ${subjectLabel} your property?`);
  };
  checkRank(month.occ.subjectRank, (d) => d.x - subj.x, 'Occupancy');
  checkRank(month.adr.subjectRank, (d) => subj.y - d.y, 'ADR');

  if (Math.abs(month.occ.compSet - month.occ.subject) < 0.5)
    notes.push('Your occupancy is within 0.5 pts of the comp set, so the occupancy scale is poorly determined this month. Treat Occ estimates as rough.');
  if (Math.abs(month.adr.compSet - month.adr.subject) < Math.max(1, month.adr.compSet * 0.01))
    notes.push('Your ADR is within 1% of the comp set, so the ADR scale is poorly determined this month. Treat ADR estimates as rough.');
}

/* ---------- one assignment ---------- */
interface Ctx {
  subj: MatrixDot; compDots: MatrixDot[]; month: MonthData;
  hotels: CalibHotel[]; prior?: CalibPrior; fixedLabel: (number | null)[];
}

function evaluate(ctx: Ctx, perm: number[]): CalibCandidate | null {
  const { subj, compDots, month, hotels } = ctx;
  const occS = month.occ.subject, adrS = month.adr.subject;
  const OCC = month.occ.compSet, ADR = month.adr.compSet;
  const n = hotels.length;
  for (let k = 0; k < n; k++) {
    const f = ctx.fixedLabel[k];
    if (f != null && compDots[perm[k]].label !== f) return null;
  }

  // perm[k] = index into compDots assigned to hotels[k]
  let W = 0, dx = 0;
  for (let k = 0; k < n; k++) {
    const r = hotels[k].rooms, d = compDots[perm[k]];
    W += r; dx += r * (d.x - subj.x);
  }
  if (Math.abs(dx) < 1e-9) return null;
  const kx = (OCC - occS) * W / dx;
  if (!(kx > 0)) return null;

  const occ = new Array<number>(n), sold = new Array<number>(n);
  let S = 0, dy = 0;
  for (let k = 0; k < n; k++) {
    const d = compDots[perm[k]];
    const o = occS + (d.x - subj.x) * kx;
    if (!(o > 0) || o > OCC_CAP) return null;
    occ[k] = Math.min(o, 100);
    sold[k] = hotels[k].rooms * occ[k] / 100;
    S += sold[k]; dy += sold[k] * (subj.y - d.y);
  }
  if (Math.abs(dy) < 1e-9) return null;
  const ky = (ADR - adrS) * S / dy;
  if (!(ky > 0)) return null;

  const placements: CalibPlacement[] = new Array(n);
  for (let k = 0; k < n; k++) {
    const d = compDots[perm[k]];
    const a = adrS + (subj.y - d.y) * ky;
    if (!(a > 0)) return null;
    placements[k] = {
      hotelId: hotels[k].id, label: d.label, occ: occ[k], adr: a,
      occIdx: occ[k] / OCC * 100, adrIdx: a / ADR * 100, revpar: occ[k] / 100 * a,
    };
  }

  // RevPAR order must match the dot labels (label 1 = highest RevPAR).
  const RP = (OCC / 100) * ADR || 1;
  const rpByLabel: number[] = [];
  rpByLabel[subj.label] = (occS / 100) * adrS;
  placements.forEach((p) => { rpByLabel[p.label] = p.revpar; });
  let orderPen = 0;
  for (let l = 1; l < rpByLabel.length - 1; l++) {
    const viol = (rpByLabel[l + 1] - rpByLabel[l]) / RP;   // next label should not beat this one
    if (viol > ORDER_HARD) return null;
    if (viol > 0) orderPen += viol;
  }

  // Soft prior 1: the user's entered "rank vs you" per hotel (ranks include the subject).
  const occAll = [occS, ...placements.map((p) => p.occ)];
  const adrAll = [adrS, ...placements.map((p) => p.adr)];
  const rankOf = (v: number, all: number[]) => 1 + all.filter((w) => w > v + 1e-9).length;
  let userPen = 0;
  hotels.forEach((h, k) => {
    if (h.rankOcc != null) userPen += Math.abs(rankOf(placements[k].occ, occAll) - h.rankOcc);
    if (h.rankAdr != null) userPen += Math.abs(rankOf(placements[k].adr, adrAll) - h.rankAdr);
  });

  // Soft prior 2: stay close to last month's positions (index points², 5 pts ≈ 1 unit).
  let priorPen = 0, priorN = 0;
  if (ctx.prior) {
    hotels.forEach((h, k) => {
      const p = ctx.prior![h.id];
      if (!p) return;
      const a = placements[k].occIdx - p.occIdx, b = placements[k].adrIdx - p.adrIdx;
      priorPen += (a * a + b * b) / 25; priorN++;
    });
    if (priorN) priorPen /= priorN;
  }

  const assign: Record<number, number> = {};
  placements.forEach((p) => { assign[p.hotelId] = p.label; });
  return {
    assign, placements, kx, ky,
    score: 100 * orderPen + 2 * userPen + priorPen,
    penalties: { revparOrder: orderPen, userRanks: userPen, prior: priorPen },
  };
}

/* ---------- permutations (Heap's algorithm, iterative) ---------- */
function forEachPermutation(n: number, fn: (p: number[]) => void) {
  const a = Array.from({ length: n }, (_, i) => i), c = new Array(n).fill(0);
  fn(a);
  let i = 0;
  while (i < n) {
    if (c[i] < i) {
      const j = i % 2 === 0 ? 0 : c[i];
      [a[j], a[i]] = [a[i], a[j]];
      fn(a);
      c[i]++; i = 0;
    } else { c[i] = 0; i++; }
  }
}

/* ---------- public entry point ---------- */
export function calibrate(inp: CalibInput): CalibResult {
  const errors: string[] = [], notes: string[] = [];
  validate(inp, errors, notes);
  if (errors.length) return { candidates: [], considered: 0, feasible: 0, confidence: 'none', errors, notes };

  const subj = inp.dots.find((d) => d.label === inp.subjectLabel)!;
  const compDots = inp.dots.filter((d) => d !== subj);
  const ctx: Ctx = {
    subj, compDots, month: inp.month, hotels: inp.hotels, prior: inp.prior,
    fixedLabel: inp.hotels.map((h) => inp.fixed?.[h.id] ?? null),
  };
  const K = inp.maxResults ?? 5;
  const top: CalibCandidate[] = [];
  let considered = 0, feasible = 0;

  forEachPermutation(inp.hotels.length, (perm) => {
    considered++;
    const c = evaluate(ctx, perm);
    if (!c) return;
    feasible++;
    if (top.length < K || c.score < top[top.length - 1].score) {
      top.push(c);
      top.sort((a, b) => a.score - b.score);
      if (top.length > K) top.pop();
    }
  });

  if (!feasible) {
    errors.push(inp.fixed && Object.keys(inp.fixed).length
      ? 'No assignment ties out with the hotels you matched to dots. Undo one of your matches.'
      : 'No assignment of hotels to dots ties out. Check the Keys, the dot numbers, and that the screenshot matches this month.');
    return { candidates: [], considered, feasible, confidence: 'none', errors, notes };
  }

  const best = top[0];
  // Hotels with identical key counts are interchangeable to the math.
  const byRooms = new Map<number, string[]>();
  inp.hotels.forEach((h) => byRooms.set(h.rooms, [...(byRooms.get(h.rooms) || []), h.name]));
  byRooms.forEach((names) => {
    if (names.length > 1)
      notes.push(`${names.join(' and ')} have the same key count, so only your ranks or last month's positions can tell them apart.`);
  });

  const gap = top.length > 1 ? top[1].score - best.score : Infinity;
  const confidence: Confidence =
    feasible === 1 || gap >= 2 ? 'high' : gap >= 0.5 ? 'medium' : 'low';

  return {
    candidates: top, considered, feasible, confidence, errors, notes,
    sensitivity: {
      occIdxPerPx: best.kx / inp.month.occ.compSet * 100,
      adrIdxPerPx: best.ky / inp.month.adr.compSet * 100,
    },
  };
}
