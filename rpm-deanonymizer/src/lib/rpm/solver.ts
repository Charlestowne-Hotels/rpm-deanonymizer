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

/* ---------- distribution helpers ----------
   tieSpread is mean-preserving: the offset amp*(score - sbar) keeps the
   weighted mean on target for ANY amplitude. `reach` (0..1) controls how
   far the extreme scores stretch toward the limit walls. */
interface SpreadItem { w: number; score: number; }
function tieSpread(targetMean: number, items: SpreadItem[], lo: number, hi: number, reach = 0.06): number[] {
  const n = items.length;
  if (!n) return [];
  targetMean = clamp(targetMean, lo, hi);
  if (n === 1) return [targetMean];
  const W = items.reduce((a, it) => a + (it.w || 0), 0) || n;
  const sbar = items.reduce((a, it) => a + (it.w || 0) * it.score, 0) / W;
  // Largest amplitude that keeps every value inside [lo, hi].
  let maxAmp = 0;
  items.forEach((it) => {
    const d = it.score - sbar;
    if (d > 1e-9) maxAmp = Math.max(maxAmp, (hi - targetMean) / d);
    else if (d < -1e-9) maxAmp = Math.max(maxAmp, (lo - targetMean) / d);
  });
  const span = hi - lo;
  // reach=0.06 → gentle cluster (old default); reach≈1 → extremes near the walls.
  const wantAmp = span * Math.max(0.06, reach);
  const amp = Math.min(wantAmp, maxAmp > 0 ? maxAmp : wantAmp);
  return items.map((it) => clamp(targetMean + amp * (it.score - sbar), lo, hi));
}
/* Even score ramp from +1 (first) to -1 (last). */
function scores(n: number): number[] {
  if (n === 1) return [0];
  return Array.from({ length: n }, (_, k) => (n - 1 - 2 * k) / (n - 1));
}
/* Rank-anchored scores: min entered rank → +1 (high wall), max entered rank → -1 (low wall),
   the rest placed proportionally by their rank between those ends. Items without a usable
   rank get score 0 (sit near the mean). Returns null if fewer than 2 distinct ranks exist. */
function rankScores(ranks: (number | null)[]): number[] | null {
  const valid = ranks.filter((r): r is number => r != null && isFinite(r));
  if (valid.length < 2) return null;
  const lo = Math.min(...valid), hi = Math.max(...valid);
  if (hi === lo) return null;
  return ranks.map((r) => {
    if (r == null || !isFinite(r)) return 0;
    // rank lo (best) → +1, rank hi (worst) → -1
    return 1 - 2 * (r - lo) / (hi - lo);
  });
}

/* ---------- per-axis competitor placement ---------- */
function anchoredAxis(
  Vs: number, subjRank: number, comps: Hotel[],
  fixedVal: (h: Hotel) => number | null, getRank: (h: Hotel) => number | null,
  w: (h: Hotel) => number, freeMean: number, lo: number, hi: number,
  warn: string[], axis: string,
): Record<number, number> {
  const out: Record<number, number> = {};
  const fixed = comps.filter((h) => fixedVal(h) != null);
  fixed.forEach((h) => { out[h.id] = fixedVal(h) as number; });
  const movable = comps.filter((h) => fixedVal(h) == null);
  if (!movable.length) return out;
  const Wmov = movable.reduce((s, h) => s + (w(h) || 0), 0);
  if (Wmov <= 0) { movable.forEach((h) => { out[h.id] = clamp(freeMean, lo, hi); }); return out; }

  const anchor = subjRank >= 1;
  const above = anchor ? movable.filter((h) => getRank(h) != null && (getRank(h) as number) < subjRank) : [];
  const below = anchor ? movable.filter((h) => getRank(h) != null && (getRank(h) as number) > subjRank) : [];
  const rest = movable.filter((h) => above.indexOf(h) < 0 && below.indexOf(h) < 0);
  above.sort((a, b) => (getRank(a) as number) - (getRank(b) as number));
  below.sort((a, b) => (getRank(a) as number) - (getRank(b) as number));
  const remGroup = below.concat(rest);

  // How wide to spread: if the movable group carries a real rank range,
  // stretch the extremes toward the walls; otherwise keep the gentle cluster.
  const movRanks = movable.map((h) => getRank(h));
  const reach = rankScores(movRanks) ? 0.92 : 0.06;

  if (above.length && !remGroup.length) {
    const rs = rankScores(above.map((h) => getRank(h)));
    const sc0 = rs || scores(above.length);
    const v0 = tieSpread(freeMean, above.map((h, i) => ({ w: w(h) || 1, score: sc0[i] })), lo, hi, reach);
    above.forEach((h, i) => { out[h.id] = v0[i]; });
    if (freeMean < Vs - 0.05)
      warn.push('Everything is ranked above you on ' + axis +
        ", but the totals need a lower average — they can't all stay above you and still tie out.");
    return out;
  }

  const step = Math.max(Vs * 0.04, 0.8), nA = above.length;
  above.forEach((h, i) => { out[h.id] = clamp(Vs + step * (nA - i), Vs + 1e-6, hi); });
  const sumAboveWV = above.reduce((s, h) => s + (w(h) || 0) * out[h.id], 0);
  const Wabove = above.reduce((s, h) => s + (w(h) || 0), 0);
  const Wrem = Wmov - Wabove;
  const remMean = Wrem > 0 ? (freeMean * Wmov - sumAboveWV) / Wrem : freeMean;

  const ordered = below.concat(rest);
  const rsOrd = rankScores(ordered.map((h) => getRank(h)));
  const sc = rsOrd || scores(ordered.length);
  const vals = tieSpread(remMean, ordered.map((h, i) => ({ w: w(h) || 1, score: sc[i] })), lo, hi, reach);
  ordered.forEach((h, i) => { out[h.id] = vals[i]; });

  below.forEach((h) => {
    if (out[h.id] >= Vs) {
      out[h.id] = Math.max(lo, Vs - 1e-6);
      warn.push('A hotel ranked below you on ' + axis +
        " can't stay below while tying out — rank held; totals may not tie.");
    }
  });

  if (Wrem > 0 && (remMean < lo - 0.1 || remMean > hi + 0.1))
    warn.push(axis + " can't tie out within limits — adjust pins/ranks or loosen the limits.");
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
