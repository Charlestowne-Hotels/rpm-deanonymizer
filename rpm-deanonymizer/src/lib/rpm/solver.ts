import type {
  Hotel, Bounds, MonthData, Solution, Rows, HotelRow, StrRow, ParsedStar, RosterEntry,
} from './types';
import { MON } from './types';

/* ---------- utilities ---------- */
export const norm = (s: string | null | undefined) =>
  (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
export const money = (n: number) => '$' + Math.round(n).toLocaleString();
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const monthDays = (m: MonthData) => new Date(m.year, MON.indexOf(m.month) + 1, 0).getDate();
export const num = (v: unknown): number | null => {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};
const fixedOcc = (h: Hotel): number | null =>
  h.locked && h.lockOcc != null ? h.lockOcc : num(h.pinOcc);
const fixedAdr = (h: Hotel): number | null =>
  h.locked && h.lockAdr != null ? h.lockAdr : num(h.pinAdr);

/* ---------- rank-driven placement ----------
   Places movable competitors around the subject value Vs using their entered
   ranks, guaranteeing the room-weighted mean of the movable group lands on
   `mean` (so the STR totals tie out) before any wall clamping.

   Model: each competitor is v_i = Vs + g * S * score_i, where score_i in [-1,1]
   comes from the rank gap to the subject (subject pinned at 0), S is a base
   spread, and g is one of two side-scales (gA above the subject, gB below).
   gA, gB are the least-distorting pair (min (gA-1)^2 + (gB-1)^2) that still
   satisfies the tie-out constraint — a closed-form Lagrange solution.

   spread : how far the extreme ranks reach toward the nearest wall (0..1)
   p      : >1 makes the #1 / #N ranks stand apart from the pack ("lonely corner")
*/
function spreadByRank(
  Vs: number, subjRank: number, mean: number,
  movable: Hotel[], getRank: (h: Hotel) => number | null,
  w: (h: Hotel) => number, lo: number, hi: number,
  spread = 0.6, p = 1.5,
): Record<number, number> {
  const out: Record<number, number> = {};
  if (!movable.length) return out;

  // 1) rank -> latent score in [-1, 1], subject pinned at 0.
  //    Better rank (smaller number) than subject -> positive (placed above).
  let upGap = 1, dnGap = 1;
  movable.forEach((h) => {
    const r = getRank(h);
    if (r == null || !isFinite(r)) return;
    if (r < subjRank) upGap = Math.max(upGap, subjRank - r);
    else if (r > subjRank) dnGap = Math.max(dnGap, r - subjRank);
  });
  const score = movable.map((h) => {
    const r = getRank(h);
    if (r == null || !isFinite(r) || r === subjRank) return 0;
    return r < subjRank
      ?  Math.pow((subjRank - r) / upGap, p)
      : -Math.pow((r - subjRank) / dnGap, p);
  });

  // 2) base spread scale — symmetric room toward the nearest wall.
  const S = Math.max(1e-6, spread * Math.min(hi - Vs, Vs - lo));

  // 3) weighted score mass on each side of the subject.
  let P = 0, N = 0, W = 0;
  movable.forEach((h, i) => {
    const wi = Math.max(0, w(h) || 0);
    W += wi;
    if (score[i] > 0) P += wi * score[i];
    else if (score[i] < 0) N += wi * score[i]; // stays negative
  });
  if (W <= 0) { movable.forEach((h) => { out[h.id] = clamp(mean, lo, hi); }); return out; }

  // 4) minimal-distortion side scales s.t. weighted mean == `mean`:
  //    min (gA-1)^2 + (gB-1)^2  s.t.  gA*(S*P) + gB*(S*N) = (mean - Vs)*W
  const a = S * P, b = S * N, K = (mean - Vs) * W;
  let gA = 1, gB = 1;
  const denom = a * a + b * b;
  if (denom > 1e-9) {
    const lambda = (K - (a + b)) / denom;
    gA = 1 + lambda * a;
    gB = 1 + lambda * b;
  }
  // Keep each side on its own side of the subject. If one side must collapse to
  // the subject line, let the other absorb the remaining tie-out so the mean
  // still lands exactly.
  if (gA < 0) { gA = 0; gB = Math.abs(b) > 1e-9 ? K / b : gB; }
  if (gB < 0) { gB = 0; gA = Math.abs(a) > 1e-9 ? K / a : gA; }
  gA = Math.max(0, gA); gB = Math.max(0, gB);

  movable.forEach((h, i) => {
    out[h.id] = clamp(Vs + (score[i] >= 0 ? gA : gB) * S * score[i], lo, hi);
  });
  return out;
}

/* ---------- per-axis competitor placement ---------- */
function anchoredAxis(
  Vs: number, subjRank: number, comps: Hotel[],
  fixedVal: (h: Hotel) => number | null, getRank: (h: Hotel) => number | null,
  w: (h: Hotel) => number, freeMean: number, lo: number, hi: number,
  warn: string[], axis: string,
): Record<number, number> {
  const out: Record<number, number> = {};

  // Pinned / locked hotels take their exact values and sit out of the spread.
  const fixed = comps.filter((h) => fixedVal(h) != null);
  fixed.forEach((h) => { out[h.id] = fixedVal(h) as number; });

  const movable = comps.filter((h) => fixedVal(h) == null);
  if (!movable.length) return out;

  const Wmov = movable.reduce((s, h) => s + (w(h) || 0), 0);
  if (Wmov <= 0) { movable.forEach((h) => { out[h.id] = clamp(freeMean, lo, hi); }); return out; }

  Object.assign(out, spreadByRank(Vs, subjRank, freeMean, movable, getRank, w, lo, hi));

  // Ordering sanity vs the subject (only meaningful when the subject is ranked).
  if (subjRank >= 1) {
    let collide = false;
    movable.forEach((h) => {
      const r = getRank(h);
      if (r == null || !isFinite(r)) return;
      if (r < subjRank && out[h.id] <= Vs) collide = true;
      if (r > subjRank && out[h.id] >= Vs) collide = true;
    });
    if (collide)
      warn.push('Some ' + axis + ' ranks collide with your position while tying out — spread held; totals may drift.');
  }

  // Tie-out check: wall / anchor clamping can perturb the exact mean.
  const realizedMean = movable.reduce((s, h) => s + (w(h) || 0) * (out[h.id] || 0), 0) / Wmov;
  if (isFinite(freeMean) && Math.abs(realizedMean - freeMean) > 0.15)
    warn.push(axis + " couldn't fully tie out within the current limits — loosen them or adjust pins.");

  return out;
}

/* ---------- solver ----------
   Comp set figures represent COMPETITORS ONLY (subject excluded). */
export function solve(m: MonthData, hotels: Hotel[], B: Bounds): Solution {
  const warn: string[] = [];
  const subj = hotels.find((h) => h.isSubject);
  const comps = hotels.filter((h) => !h.isSubject);
  if (!subj) { warn.push('No subject row found.'); return { occ: {}, adr: {}, warn, tie: false }; }
  if (!comps.length) { warn.push('No competitors found in the report.'); return { occ: {}, adr: {}, warn, tie: false }; }

  const occS = m.occ.subject, adrS = m.adr.subject, OCC = m.occ.compSet, ADR = m.adr.compSet;
  const roomsComps = comps.reduce((s, h) => s + (h.rooms || 0), 0);
  if (roomsComps <= 0) warn.push('Enter competitor room counts (Keys) so the math can weight hotels.');

  const occ: Record<number, number> = {}, adr: Record<number, number> = {};
  occ[subj.id] = occS; adr[subj.id] = adrS;

  const soldFixed = comps.filter((h) => fixedOcc(h) != null)
    .reduce((s, h) => s + (h.rooms || 0) * (fixedOcc(h) as number) / 100, 0);
  const roomsMov = comps.filter((h) => fixedOcc(h) == null).reduce((s, h) => s + (h.rooms || 0), 0);
  const totalSoldTarget = OCC / 100 * roomsComps;
  const soldMovTarget = totalSoldTarget - soldFixed;
  const freeMeanOcc = roomsMov > 0 ? soldMovTarget / roomsMov * 100 : OCC;
  const occOut = anchoredAxis(occS, m.occ.subjectRank, comps, fixedOcc, (h) => num(h.rankOcc),
    (h) => (h.rooms || 0), freeMeanOcc, B.oLo, B.oHi, warn, 'Occupancy');
  comps.forEach((h) => { occ[h.id] = occOut[h.id] != null ? occOut[h.id] : freeMeanOcc; });

  const soldU = (h: Hotel) => (h.rooms || 0) * (occ[h.id] || 0) / 100;
  const compSoldU = comps.reduce((s, h) => s + soldU(h), 0);
  const revFixed = comps.filter((h) => fixedAdr(h) != null)
    .reduce((s, h) => s + soldU(h) * (fixedAdr(h) as number), 0);
  const soldMovU = comps.filter((h) => fixedAdr(h) == null).reduce((s, h) => s + soldU(h), 0);
  const totalRevTarget = ADR * compSoldU;
  const revMovTarget = totalRevTarget - revFixed;
  const freeMeanAdr = soldMovU > 0 ? revMovTarget / soldMovU : ADR;
  const adrOut = anchoredAxis(adrS, m.adr.subjectRank, comps, fixedAdr, (h) => num(h.rankAdr),
    soldU, freeMeanAdr, B.aLo, B.aHi, warn, 'ADR');
  comps.forEach((h) => { adr[h.id] = adrOut[h.id] != null ? adrOut[h.id] : freeMeanAdr; });

  const cSold = comps.reduce((s, h) => s + (h.rooms || 0) * (occ[h.id] || 0) / 100, 0);
  const cRev = comps.reduce((s, h) => s + (h.rooms || 0) * (occ[h.id] || 0) / 100 * (adr[h.id] || 0), 0);
  const blendOcc = roomsComps > 0 ? cSold / roomsComps * 100 : NaN;
  const blendAdr = cSold > 0 ? cRev / cSold : NaN;
  const tie = Math.abs(blendOcc - OCC) < 0.15 && Math.abs(blendAdr - ADR) < 0.15;
  return { occ, adr, warn, tie, blendOcc, blendAdr };
}

/* ---------- derived rows + grid range ---------- */
export function computeRows(sol: Solution, m: MonthData, hotels: Hotel[]): Rows {
  const D = monthDays(m), OCC = m.occ.compSet, ADR = m.adr.compSet, RP = m.revpar.compSet;
  const hs: HotelRow[] = hotels.map((h) => {
    const o = sol.occ[h.id] || 0, a = sol.adr[h.id] || 0;
    const av = (h.rooms || 0) * D, sold = av * o / 100, rev = sold * a, rp = o / 100 * a;
    const oi = h.isSubject && isFinite(m.occ.index) ? m.occ.index : (OCC ? o / OCC * 100 : NaN);
    const ai = h.isSubject && isFinite(m.adr.index) ? m.adr.index : (ADR ? a / ADR * 100 : NaN);
    return {
      id: h.id, name: h.name, isSubject: h.isSubject, rooms: (h.rooms || 0),
      avail: av, occ: o, sold, adr: a, rev, revpar: rp,
      occIdx: oi, adrIdx: ai, rpi: RP ? rp / RP * 100 : NaN,
      occRk: 0, adrRk: 0, rgiRk: 0,
    };
  });
  hs.slice().sort((a, b) => b.occ - a.occ).forEach((h, i) => { h.occRk = i + 1; });
  hs.slice().sort((a, b) => b.adr - a.adr).forEach((h, i) => { h.adrRk = i + 1; });
  hs.slice().sort((a, b) => b.revpar - a.revpar).forEach((h, i) => { h.rgiRk = i + 1; });

  const compRooms = hs.filter((h) => !h.isSubject).reduce((s, h) => s + h.rooms, 0);
  const strAvail = compRooms * D, strSold = strAvail * OCC / 100, strRev = strSold * ADR;
  const strRow: StrRow = {
    label: 'Competitive Set · STR (excl. you)', rooms: compRooms, avail: strAvail,
    occ: OCC, sold: strSold, adr: ADR, rev: strRev, revpar: RP, idx: true,
  };
  return { hs, strRow, D };
}

export function idxRange(rows: Rows) {
  const subj = rows.hs.find((h) => h.isSubject);
  const sx = subj && isFinite(subj.occIdx) ? subj.occIdx : 100;
  const sy = subj && isFinite(subj.adrIdx) ? subj.adrIdx : 100;
  const half = (vals: number[], center: number) => {
    const f = vals.filter(isFinite);
    const dev = f.reduce((mx, v) => Math.max(mx, Math.abs(v - center)), 0);
    return Math.max(dev * 1.18, 12);
  };
  return { hx: half(rows.hs.map((h) => h.occIdx), sx), hy: half(rows.hs.map((h) => h.adrIdx), sy), sx, sy };
}

/* ---------- initial hotel set from a parsed report ---------- */
const HOTEL_DEFAULTS = {
  pinOcc: '', pinAdr: '', rankOcc: '', rankAdr: '',
  locked: false, lockOcc: null as number | null, lockAdr: null as number | null,
};
export function buildHotels(parsed: ParsedStar | null, roster: RosterEntry[]): Hotel[] {
  const hotels: Hotel[] = [];
  const subjN = norm(parsed && parsed.subjectName);
  let id = 1;
  if (roster.length) {
    roster.forEach((r) => {
      const isSub = !!(subjN && norm(r.name) === subjN);
      hotels.push({ id: id++, name: r.name, rooms: r.rooms, isSubject: isSub, ...HOTEL_DEFAULTS });
    });
    if (!hotels.some((h) => h.isSubject) && hotels.length) {
      hotels[0].isSubject = true;
      hotels[0].name = (parsed && parsed.subjectName) || hotels[0].name;
    }
  } else {
    hotels.push({ id: id++, name: (parsed && parsed.subjectName) || 'Your property', rooms: '', isSubject: true, ...HOTEL_DEFAULTS });
    for (let k = 2; k <= 5; k++)
      hotels.push({ id: id++, name: 'Competitor ' + k, rooms: '', isSubject: false, ...HOTEL_DEFAULTS });
  }
  return hotels;
}
