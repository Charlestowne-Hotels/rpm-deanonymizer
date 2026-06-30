import { jsPDF } from 'jspdf';
import type { Rows, MonthData } from './types';
import { idxRange, money } from './solver';

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function drawPdf(rows: Rows, m: MonthData, zoom: number, subjectName: string): void {
  const doc = new jsPDF('l', 'mm', 'a4');
  const ML = 12, PW = 297, w = PW - ML * 2;
  let y = 14;
  const prop = subjectName || 'Comp set';

  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(30, 41, 59);
  doc.text(prop + ' — ' + m.key, ML, y); y += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(110, 116, 128);
  doc.text('Clarity · competitor estimates · comp set incl. you', ML, y); y += 7;
  doc.setTextColor(30, 41, 59); doc.setFontSize(9.5);
  doc.text('You: ' + m.occ.subject.toFixed(1) + '%  $' + m.adr.subject.toFixed(2) +
    '       Comp set (STR, incl. you): ' + m.occ.compSet.toFixed(1) + '%  $' +
    m.adr.compSet.toFixed(2) + '  RevPAR $' + m.revpar.compSet.toFixed(2), ML, y); y += 7;

  const R = idxRange(rows), z = zoom > 0 ? zoom : 0.7, hx = R.hx / z, hy = R.hy / z;
  const gw = 86, gx = ML + 8, gy = y, gh = 61;
  const px = (v: number) => clampN((v - R.sx) / (2 * hx) + 0.5, 0, 1);
  const py = (v: number) => 1 - clampN((v - R.sy) / (2 * hy) + 0.5, 0, 1);
  doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.3); doc.rect(gx, gy, gw, gh);
  doc.setDrawColor(140, 150, 168); doc.setLineWidth(0.4);
  doc.line(gx, gy + gh * 0.5, gx + gw, gy + gh * 0.5);
  doc.line(gx + gw * 0.5, gy, gx + gw * 0.5, gy + gh);
  doc.setFontSize(7.5); doc.setTextColor(148, 163, 184);
  doc.text('Occupancy Index ->', gx + gw / 2, gy + gh + 4, { align: 'center' });
  doc.text('ADR Index ->', gx - 3, gy + gh / 2, { align: 'center', angle: 90 });
  rows.hs.forEach((h) => {
    if (!isFinite(h.occIdx) || !isFinite(h.adrIdx)) return;
    const cx = gx + px(h.occIdx) * gw, cy = gy + py(h.adrIdx) * gh;
    const col = h.isSubject ? [100, 116, 139] : [107, 33, 168];
    doc.setFillColor(col[0], col[1], col[2]); doc.circle(cx, cy, 3, 'F');
    doc.setTextColor(255, 255, 255); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
    doc.text(String(h.rgiRk), cx, cy + 0.2, { align: 'center', baseline: 'middle' });
  });
  y = Math.max(y + gh + 12, gy + gh + 9);

  const cols = [
    { t: '#', w: 8, a: 'c' }, { t: 'Hotel', w: 98, a: 'l' }, { t: 'Keys', w: 13, a: 'r' },
    { t: 'Avail', w: 17, a: 'r' }, { t: 'Occ%', w: 14, a: 'r' }, { t: 'OccIdx', w: 15, a: 'r' },
    { t: 'Sold', w: 16, a: 'r' }, { t: 'ADR', w: 17, a: 'r' }, { t: 'ADRIdx', w: 15, a: 'r' },
    { t: 'Revenue', w: 23, a: 'r' }, { t: 'RevPAR', w: 17, a: 'r' }, { t: 'RPI', w: 14, a: 'r' },
  ];
  let x = ML;
  const lay = cols.map((c) => { const o = { x, c }; x += c.w; return o; });
  const rh = 7.5;

  const align = (a: string): 'left' | 'center' | 'right' => (a === 'l' ? 'left' : a === 'c' ? 'center' : 'right');

  const row = (vals: (string | number)[], opt: { fill?: number[]; bold?: boolean; color?: number[] } = {}) => {
    if (y > 196) { doc.addPage(); y = 14; }
    if (opt.fill) { doc.setFillColor(opt.fill[0], opt.fill[1], opt.fill[2]); doc.rect(ML, y, w, rh, 'F'); }
    doc.setDrawColor(225, 232, 240); doc.setLineWidth(0.2); doc.line(ML, y + rh, ML + w, y + rh);
    doc.setFont('helvetica', opt.bold ? 'bold' : 'normal'); doc.setFontSize(8.5);
    const col = opt.color || [30, 41, 59]; doc.setTextColor(col[0], col[1], col[2]);
    lay.forEach((L, i) => {
      const a = L.c.a, tx = a === 'l' ? L.x + 1.5 : a === 'c' ? L.x + L.c.w / 2 : L.x + L.c.w - 1.5;
      doc.text(String(vals[i] == null ? '' : vals[i]), tx, y + rh / 2, { align: align(a), baseline: 'middle' });
    });
    y += rh;
  };

  doc.setFillColor(30, 41, 59); doc.rect(ML, y, w, rh, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
  lay.forEach((L) => {
    const a = L.c.a, tx = a === 'l' ? L.x + 1.5 : a === 'c' ? L.x + L.c.w / 2 : L.x + L.c.w - 1.5;
    doc.text(L.c.t, tx, y + rh / 2, { align: align(a), baseline: 'middle' });
  });
  y += rh;

  const ix = (n: number) => (isFinite(n) ? n.toFixed(1) : '');
  rows.hs.slice().sort((a, b) => b.revpar - a.revpar).forEach((h) => {
    const safeName = h.name && h.name.length > 65 ? h.name.substring(0, 62) + '...' : (h.name || '');
    row([h.rgiRk, safeName, h.rooms, Math.round(h.avail).toLocaleString(), h.occ.toFixed(1),
      ix(h.occIdx), Math.round(h.sold).toLocaleString(), '$' + h.adr.toFixed(2), ix(h.adrIdx),
      money(h.rev), '$' + h.revpar.toFixed(2), ix(h.rpi)],
      { fill: h.isSubject ? [243, 239, 254] : undefined, bold: h.isSubject });
  });

  const sR = rows.strRow;
  row(['', sR.label, sR.rooms, Math.round(sR.avail).toLocaleString(), sR.occ.toFixed(1), '100',
    Math.round(sR.sold).toLocaleString(), '$' + sR.adr.toFixed(2), '100', money(sR.rev),
    '$' + sR.revpar.toFixed(2), '100'], { fill: [238, 246, 241], bold: true });

  doc.save((prop + '_' + m.key).replace(/\s+/g, '_') + '.pdf');
}
