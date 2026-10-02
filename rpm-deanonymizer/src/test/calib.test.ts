import { calibrate } from '../src/lib/rpm/calibrate.ts';
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function trial(n: number, noise: number, usePrior: boolean, useRanks = false) {
  const rooms = Array.from({ length: n }, () => 80 + Math.round(rnd() * 240));
  const occ = rooms.map(() => 55 + rnd() * 38), adr = rooms.map(() => 140 + rnd() * 200);
  const subjRooms = 150, occS = 55 + rnd() * 38, adrS = 140 + rnd() * 200;
  const W = rooms.reduce((a, b) => a + b, 0);
  const sold = rooms.map((r, i) => r * occ[i] / 100), S = sold.reduce((a, b) => a + b, 0);
  const OCC = S / W * 100, ADR = sold.reduce((a, s, i) => a + s * adr[i], 0) / S;
  const all = [{ o: occS, a: adrS, subj: true, i: -1 }, ...occ.map((o, i) => ({ o, a: adr[i], subj: false, i }))];
  const rp = all.map((h) => h.o * h.a);
  const order = rp.map((_, i) => i).sort((a, b) => rp[b] - rp[a]);
  const label = new Array(all.length); order.forEach((idx, k) => { label[idx] = k + 1; });
  const oMin = Math.min(...all.map((h) => h.o)), oMax = Math.max(...all.map((h) => h.o));
  const aMin = Math.min(...all.map((h) => h.a)), aMax = Math.max(...all.map((h) => h.a));
  const dots = all.map((h, k) => ({
    x: 70 + (h.o - oMin) / (oMax - oMin) * 640 + (rnd() * 2 - 1) * noise,
    y: 510 - (h.a - aMin) / (aMax - aMin) * 340 + (rnd() * 2 - 1) * noise, label: label[k] }));
  const month: any = { key: 'Aug 2026', month: 'Aug', year: 2026,
    occ: { subject: occS, compSet: OCC, index: occS / OCC * 100, subjectRank: 1 + occ.filter((o) => o > occS).length, setSize: n + 1 },
    adr: { subject: adrS, compSet: ADR, index: adrS / ADR * 100, subjectRank: 1 + adr.filter((a) => a > adrS).length, setSize: n + 1 },
    revpar: { subject: occS * adrS / 100, compSet: OCC * ADR / 100, index: 0, subjectRank: label[0], setSize: n + 1 } };
  const rk = (v: number, arr: number[]) => 1 + arr.filter((w) => w > v).length;
  const occAll = [occS, ...occ], adrAll = [adrS, ...adr];
  const jit = () => (rnd() < 0.3 ? (rnd() < 0.5 ? -1 : 1) : 0);
  const hotels = rooms.map((r, i) => ({ id: 10 + i, name: 'H' + i, rooms: r,
    rankOcc: useRanks ? rk(occ[i], occAll) + jit() : null, rankAdr: useRanks ? rk(adr[i], adrAll) + jit() : null }));
  // shuffle dot order so enumeration order can't leak the answer
  for (let i = dots.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [dots[i], dots[j]] = [dots[j], dots[i]]; }
  const prior = usePrior ? Object.fromEntries(hotels.map((h, i) => [h.id, { occIdx: occ[i] / OCC * 100 + (rnd() * 2 - 1) * 6, adrIdx: adr[i] / ADR * 100 + (rnd() * 2 - 1) * 6 }])) : undefined;
  const t0 = performance.now();
  const res = calibrate({ dots, month, hotels, subjectLabel: label[0], prior });
  const ms = performance.now() - t0;
  const best = res.candidates[0];
  const top3 = res.candidates.slice(0, 3).some((c) => hotels.every((h, i) => c.assign[h.id] === label[i + 1]));
  if (!best) return { top3, ok: false, feasible: res.feasible, err: 0, conf: res.confidence, ms, errs: res.errors };
  const ok = hotels.every((h, i) => best.assign[h.id] === label[i + 1]);
  const err = Math.max(...hotels.map((h, i) => { const p = best.placements.find((q) => q.hotelId === h.id)!; return ok ? Math.max(Math.abs(p.occ - occ[i]), Math.abs(p.adr - adr[i]) / adr[i] * 100) : 0; }));
  return { top3, ok, feasible: res.feasible, considered: res.considered, err, conf: res.confidence, ms, notes: res.notes.length };
}

const errs: number[] = [];
for (const [n, prior, ranks] of [[5, false, false], [5, false, true], [5, true, false], [5, true, true], [7, false, true], [7, true, true], [8, true, true]] as [number, boolean, boolean][]) {
  let ok = 0, top3 = 0, confHi = 0, hiOk = 0, ms = 0; const T = n >= 7 ? 40 : 300;
  for (let t = 0; t < T; t++) { const r: any = trial(n, 1.5, prior, ranks); ok += +r.ok; top3 += +r.top3; if (r.ok) errs.push(r.err); ms += r.ms; if (r.conf === 'high') { confHi++; hiOk += +r.ok; } }
  console.log(`n=${n} lastMonth=${prior} ranks=${ranks}: best correct ${(ok / T * 100).toFixed(0)}%  in top-3 ${(top3 / T * 100).toFixed(0)}%  high-conf ${confHi}/${T} (${hiOk} correct)  ${(ms / T).toFixed(0)}ms`);
}
errs.sort((a, b) => a - b);
console.log('error when assignment correct (max of occ pts, adr %): median', errs[errs.length >> 1].toFixed(2), ' p90', errs[Math.floor(errs.length * 0.9)].toFixed(2));
