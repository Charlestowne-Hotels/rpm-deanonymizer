/* =====================================================================
   Find the dots in a pasted RevPAR Positioning Matrix screenshot.
   Pure function over RGBA pixels so it runs (and tests) without a DOM.

   1. Classify pixels as comp-purple or subject-grey.
   2. Erode with a box filter so 1-px gridlines, text and the crosshair
      drop out while the solid discs survive.
   3. Connected components → keep disc-sized, roughly square blobs.
   ===================================================================== */

export interface Rect { x: number; y: number; w: number; h: number; }

export interface DetectedDot {
  x: number; y: number;        // centre, natural image pixels
  size: number;                // approx. diameter in px
  kind: 'comp' | 'subject';
  merged: boolean;             // blob looks like two overlapping dots
}

export interface PixelImage { data: Uint8ClampedArray; width: number; height: number; }

const isPurple = (r: number, g: number, b: number) =>
  b > r + 25 && b > g + 50 && r < 170 && g < 120;
const isGrey = (r: number, g: number, b: number) =>
  Math.abs(r - g) < 14 && Math.abs(g - b) < 14 && r >= 85 && r <= 155;

export function detectDots(img: PixelImage, crop?: Rect | null): DetectedDot[] {
  const W = img.width, H = img.height, d = img.data;
  const x0 = Math.max(0, Math.floor(crop?.x ?? 0)), y0 = Math.max(0, Math.floor(crop?.y ?? 0));
  const x1 = Math.min(W, Math.ceil(crop ? crop.x + crop.w : W)), y1 = Math.min(H, Math.ceil(crop ? crop.y + crop.h : H));
  const w = x1 - x0, h = y1 - y0;
  if (w < 10 || h < 10) return [];

  // Scale the erosion window with image size (retina screenshots are 2×).
  const k = Math.max(3, Math.round(Math.min(W, H) / 220) | 1);
  const out: DetectedDot[] = [];

  for (const kind of ['comp', 'subject'] as const) {
    const test = kind === 'comp' ? isPurple : isGrey;
    // Summed-area table of the colour mask.
    const sat = new Int32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        const i = ((y + y0) * W + (x + x0)) * 4;
        row += test(d[i], d[i + 1], d[i + 2]) ? 1 : 0;
        sat[(y + 1) * (w + 1) + (x + 1)] = sat[y * (w + 1) + (x + 1)] + row;
      }
    }
    const half = k >> 1, need = Math.ceil(k * k * 0.75);
    const core = new Uint8Array(w * h);
    for (let y = half; y < h - half; y++)
      for (let x = half; x < w - half; x++) {
        const a = (y - half) * (w + 1) + (x - half), b = a + k, c = a + k * (w + 1), e = c + k;
        if (sat[e] - sat[b] - sat[c] + sat[a] >= need) core[y * w + x] = 1;
      }

    // Connected components (4-neighbour flood fill) on the eroded core.
    const seen = new Uint8Array(w * h), stack: number[] = [];
    const blobs: { minX: number; maxX: number; minY: number; maxY: number; n: number }[] = [];
    for (let p = 0; p < w * h; p++) {
      if (!core[p] || seen[p]) continue;
      let minX = w, maxX = 0, minY = h, maxY = 0, n = 0;
      stack.push(p); seen[p] = 1;
      while (stack.length) {
        const q = stack.pop()!, qx = q % w, qy = (q / w) | 0;
        n++;
        if (qx < minX) minX = qx; if (qx > maxX) maxX = qx;
        if (qy < minY) minY = qy; if (qy > maxY) maxY = qy;
        for (const nb of [q - 1, q + 1, q - w, q + w]) {
          if (nb < 0 || nb >= w * h || seen[nb] || !core[nb]) continue;
          if ((nb === q - 1 && qx === 0) || (nb === q + 1 && qx === w - 1)) continue;
          seen[nb] = 1; stack.push(nb);
        }
      }
      blobs.push({ minX, maxX, minY, maxY, n });
    }

    // Keep disc-like blobs; size relative to the biggest single-dot blob.
    const sized = blobs
      .map((b) => ({ ...b, bw: b.maxX - b.minX + 1 + 2 * half, bh: b.maxY - b.minY + 1 + 2 * half }))
      .filter((b) => b.bw >= 6 && b.bh >= 6 && b.n >= 12);
    const squareish = sized.filter((b) => b.bw / b.bh < 1.4 && b.bh / b.bw < 1.4);
    const ref = squareish.length ? Math.max(...squareish.map((b) => Math.min(b.bw, b.bh))) : 0;
    if (!ref) continue;
    for (const b of sized) {
      const small = Math.min(b.bw, b.bh), big = Math.max(b.bw, b.bh);
      if (small < ref * 0.6) continue;               // legend swatches, icons
      out.push({
        x: x0 + (b.minX + b.maxX) / 2, y: y0 + (b.minY + b.maxY) / 2,
        size: small, kind, merged: big > ref * 1.35,
      });
    }
  }

  // Subjects: grey blobs the same size as the purple dots (one per matrix panel).
  const comps = out.filter((o) => o.kind === 'comp');
  const ref = comps.length ? comps.reduce((s, c) => s + c.size, 0) / comps.length : 0;
  const subjects = out.filter((o) => o.kind === 'subject' && (!ref || (o.size > ref * 0.75 && o.size < ref * 1.33)));
  return [...comps, ...subjects];
}

export interface Panel { rect: Rect; dots: DetectedDot[]; }

/** A CoStar screenshot often holds two matrices side by side (this year / last year).
 *  Split at the midpoints between subject dots; each panel gets the dots in its column. */
export function splitPanels(dots: DetectedDot[], imgW: number, imgH: number): Panel[] {
  const subs = dots.filter((d) => d.kind === 'subject').sort((a, b) => a.x - b.x);
  if (subs.length <= 1) return [{ rect: { x: 0, y: 0, w: imgW, h: imgH }, dots }];
  const cuts = [0, ...subs.slice(1).map((s, i) => (s.x + subs[i].x) / 2), imgW];
  return subs.map((_, i) => {
    const lo = cuts[i], hi = cuts[i + 1];
    return { rect: { x: lo, y: 0, w: hi - lo, h: imgH }, dots: dots.filter((d) => d.x >= lo && d.x < hi) };
  });
}
