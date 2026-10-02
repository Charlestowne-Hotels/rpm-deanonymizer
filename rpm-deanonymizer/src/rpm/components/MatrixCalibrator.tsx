import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { detectDots, splitPanels } from '../../lib/rpm/detectDots';
import type { DetectedDot, Panel } from '../../lib/rpm/detectDots';
import { calibrate } from '../../lib/rpm/calibrate';
import type { CalibCandidate, CalibHotel, CalibPrior, CalibResult, MatrixDot } from '../../lib/rpm/calibrate';
import { num } from '../../lib/rpm/solver';
import type { Hotel, MonthData } from '../../lib/rpm/types';

interface Props {
  month: MonthData;
  hotels: Hotel[];
  prior?: CalibPrior;
  onApply: (cand: CalibCandidate, dots: MatrixDot[], res: CalibResult) => void;
  onClose: () => void;
}

interface Shot { url: string; w: number; h: number; panels: Panel[]; }

const CONF_TEXT: Record<string, string> = {
  high: 'Clear match',
  medium: 'Likely match — check the hotels',
  low: 'Several matches fit — match a hotel or two to its dot',
  none: 'No match',
};

export default function MatrixCalibrator({ month, hotels, prior, onApply, onClose }: Props) {
  const [shot, setShot] = useState<Shot | null>(null);
  const [panelIdx, setPanelIdx] = useState(0);
  const [marks, setMarks] = useState<MatrixDot[]>([]);
  const [fixed, setFixed] = useState<Record<number, number>>({});
  const [pick, setPick] = useState(0);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const comps = useMemo(() => hotels.filter((h) => !h.isSubject), [hotels]);
  const N = comps.length + 1;
  const panel = shot?.panels[panelIdx] ?? null;
  const starRank = month.revpar.subjectRank;
  const greyDot = panel?.dots.find((d) => d.kind === 'subject');

  /* ---------- load an image (paste or file) ---------- */
  const load = useCallback((file: File) => {
    setErr('');
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const ctx = c.getContext('2d');
      if (!ctx) { setErr('This browser cannot read images.'); return; }
      ctx.drawImage(im, 0, 0);
      const px = ctx.getImageData(0, 0, c.width, c.height);
      const found = detectDots({ data: px.data, width: c.width, height: c.height });
      const panels = splitPanels(found, c.width, c.height);
      setShot((prev) => { if (prev) URL.revokeObjectURL(prev.url); return { url, w: c.width, h: c.height, panels }; });
      setPanelIdx(0);
      setFixed({});
      setPick(0);
    };
    im.onerror = () => setErr('That file is not an image. Paste a screenshot or choose a PNG/JPG.');
    im.src = url;
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith('image/'));
      const f = item?.getAsFile();
      if (f) { e.preventDefault(); load(f); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [load]);

  /* ---------- pre-number the subject when we can see it ---------- */
  useEffect(() => {
    setFixed({}); setPick(0);
    const subj = panel?.dots.find((d) => d.kind === 'subject');
    setMarks(subj && starRank > 0 ? [{ x: subj.x, y: subj.y, label: starRank }] : []);
  }, [panel, starRank]);

  // Subject label: STAR's RevPAR rank, else whichever numbered dot sits on the grey dot.
  const subjectLabel = starRank > 0 ? starRank
    : (greyDot && marks.find((m) => Math.hypot(m.x - greyDot.x, m.y - greyDot.y) < 3)?.label) || 0;

  const used = new Set(marks.map((m) => m.label));
  let nextLabel = 1;
  while (used.has(nextLabel)) nextLabel++;
  const complete = marks.length === N;

  /* ---------- click to number a dot (or place one detection missed) ---------- */
  const onImgClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!shot || !panel || complete || !imgRef.current) return;
    const r = imgRef.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * shot.w, y = (e.clientY - r.top) / r.height * shot.h;
    const pr = panel.rect;
    if (x < pr.x || x > pr.x + pr.w || y < pr.y || y > pr.y + pr.h) return;
    const near = (d: { x: number; y: number }, rad: number) => Math.hypot(d.x - x, d.y - y) <= rad;
    const dotSize = panel.dots[0]?.size ?? 18;
    if (marks.some((m) => near(m, dotSize * 0.7))) return;
    const hit = panel.dots
      .filter((d: DetectedDot) => near(d, dotSize * 0.9))
      .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    setMarks((prev) => [...prev, { x: hit ? hit.x : x, y: hit ? hit.y : y, label: nextLabel }]);
    setFixed({}); setPick(0);
  };

  const undo = () => {
    setMarks((prev) => {
      const keepSubject = prev.length > 0 && starRank > 0 && prev[0].label === starRank && !!greyDot;
      return prev.length > (keepSubject ? 1 : 0) ? prev.slice(0, -1) : prev;
    });
    setFixed({}); setPick(0);
  };

  /* ---------- solve ---------- */
  const calibHotels: CalibHotel[] = useMemo(() => comps.map((h) => ({
    id: h.id, name: h.name, rooms: Number(h.rooms) || 0, rankOcc: num(h.rankOcc), rankAdr: num(h.rankAdr),
  })), [comps]);

  const res: CalibResult | null = useMemo(() => {
    if (!complete) return null;
    return calibrate({ dots: marks, month, hotels: calibHotels, subjectLabel, prior, fixed });
  }, [complete, marks, month, calibHotels, subjectLabel, prior, fixed]);

  const cand = res?.candidates[Math.min(pick, (res?.candidates.length || 1) - 1)] ?? null;
  const hotelForLabel = (label: number) => {
    if (!cand) return null;
    const id = Object.keys(cand.assign).map(Number).find((hid) => cand.assign[hid] === label);
    return comps.find((h) => h.id === id) ?? null;
  };

  const matchDot = (label: number, hotelId: number) => {
    setFixed((prev) => {
      const next: Record<number, number> = {};
      Object.entries(prev).forEach(([hid, l]) => { if (+hid !== hotelId && l !== label) next[+hid] = l; });
      next[hotelId] = label;
      return next;
    });
    setPick(0);
  };

  const fmtPm = (perPx: number) => `±${(perPx * 2).toFixed(1)}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal calib-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Read the positioning matrix · {month.key}</h3>
          <p>
            Paste a screenshot of the CoStar matrix for this month (Ctrl/⌘+V), then click the dots in number order.
            {starRank > 0 && <> Your property is dot {starRank} and is numbered for you.</>}
          </p>
        </div>

        <div className="modal-body calib-body">
          {!shot ? (
            <button className="calib-drop" onClick={() => fileRef.current?.click()}>
              <strong>Paste a screenshot</strong>
              <span>or click to choose an image file</span>
            </button>
          ) : (
            <>
              {shot.panels.length > 1 && (
                <div className="calib-panels">
                  <span className="mini-label">Which matrix is {month.key}?</span>
                  {shot.panels.map((_, i) => (
                    <button key={i} className={`access-opt ${i === panelIdx ? 'on' : ''}`} onClick={() => setPanelIdx(i)}>
                      {i === 0 ? 'Left' : i === shot.panels.length - 1 ? 'Right' : `Panel ${i + 1}`}
                    </button>
                  ))}
                </div>
              )}

              <div className="calib-stage" onClick={onImgClick} style={{ cursor: complete ? 'default' : 'crosshair' }}>
                <img ref={imgRef} src={shot.url} alt="Pasted positioning matrix" draggable={false} />
                {panel && shot.panels.length > 1 && shot.panels.map((p, i) => i === panelIdx ? null : (
                  <div key={i} className="calib-dim" style={{
                    left: `${p.rect.x / shot.w * 100}%`, top: 0, width: `${p.rect.w / shot.w * 100}%`, height: '100%',
                  }} />
                ))}
                {panel?.dots.filter((d) => !marks.some((m) => Math.hypot(m.x - d.x, m.y - d.y) < 2)).map((d, i) => (
                  <span key={'d' + i} className="calib-ring" style={{ left: `${d.x / shot.w * 100}%`, top: `${d.y / shot.h * 100}%` }} />
                ))}
                {marks.map((m) => (
                  <span key={'m' + m.label} className={`calib-mark ${m.label === subjectLabel ? 'subj' : ''}`}
                    style={{ left: `${m.x / shot.w * 100}%`, top: `${m.y / shot.h * 100}%` }}>{m.label}</span>
                ))}
              </div>

              <div className="calib-bar">
                <span className="calib-status">
                  {complete ? `All ${N} dots numbered.` : `Click dot ${nextLabel} (${marks.length} of ${N} numbered).`}
                  {panel && panel.dots.length !== N && !complete &&
                    ` Found ${panel.dots.length} dots automatically — click any that were missed.`}
                </span>
                <button className="btn" onClick={undo} disabled={!marks.length}>Undo</button>
                <button className="btn" onClick={() => fileRef.current?.click()}>New screenshot</button>
              </div>
            </>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) load(f); }} />
          {err && <div className="admin-err" style={{ marginTop: 10 }}>{err}</div>}

          {res && (
            <div className="calib-results">
              {res.errors.map((m, i) => <div className="admin-err" key={'e' + i}>{m}</div>)}
              {cand && (
                <>
                  <div className="calib-head">
                    <span className={`calib-conf ${res.confidence}`}>{CONF_TEXT[res.confidence]}</span>
                    <span className="muted">
                      {res.feasible.toLocaleString()} of {res.considered.toLocaleString()} combinations tie out
                    </span>
                    {res.candidates.length > 1 && (
                      <span className="calib-opts">
                        {res.candidates.slice(0, 3).map((_, i) => (
                          <button key={i} className={`access-opt ${i === pick ? 'on' : ''}`} onClick={() => setPick(i)}>
                            {i === 0 ? 'Best fit' : `Option ${i + 1}`}
                          </button>
                        ))}
                      </span>
                    )}
                  </div>

                  <div className="table-scroll" style={{ maxHeight: 320 }}>
                    <table className="rpm-table">
                      <thead><tr><th>Dot</th><th>Hotel</th><th>Keys</th><th>Occ %</th><th>ADR $</th><th>Occ Idx</th><th>ADR Idx</th></tr></thead>
                      <tbody>
                        {cand.placements.slice().sort((a, b) => a.label - b.label).map((p) => {
                          const h = hotelForLabel(p.label);
                          return (
                            <tr key={p.label}>
                              <td><b>{p.label}</b></td>
                              <td>
                                <select className={`role-select ${h && fixed[h.id] === p.label ? 'calib-fixed' : ''}`}
                                  value={h?.id ?? ''} onChange={(e) => matchDot(p.label, +e.target.value)}
                                  title="Choose the hotel this dot belongs to">
                                  {comps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                              </td>
                              <td className="faint">{h?.rooms}</td>
                              <td>{p.occ.toFixed(1)}</td>
                              <td>{p.adr.toFixed(2)}</td>
                              <td className="mut">{p.occIdx.toFixed(1)}</td>
                              <td className="mut">{p.adrIdx.toFixed(1)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {res.sensitivity && (
                    <p className="calib-note">
                      Reading precision: {fmtPm(res.sensitivity.occIdxPerPx)} Occ index and {fmtPm(res.sensitivity.adrIdxPerPx)} ADR index points
                      for a 2-pixel error.
                    </p>
                  )}
                </>
              )}
              {res.notes.map((m, i) => <div className="warn" key={'n' + i}>⚠ {m}</div>)}
              {cand && res.confidence === 'low' && !Object.keys(fixed).length && (
                <p className="calib-note">
                  The geometry fixes where every dot sits, but not which hotel is which. Pick the hotel for any dot you
                  recognize and the rest will re-solve — or enter rough ranks in the table / Comp Base.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!cand || !res} onClick={() => cand && res && onApply(cand, marks, res)}>
            Apply as pins
          </button>
        </div>
      </div>
    </div>
  );
}
