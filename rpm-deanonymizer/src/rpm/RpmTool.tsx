import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import UploadStar from './components/UploadStar';
import HotelTable from './components/HotelTable';
import PositioningGrid from './components/PositioningGrid';
import LimitsPanel from './components/LimitsPanel';
import { solve, computeRows, buildHotels, norm } from '../lib/rpm/solver';
import { drawPdf } from '../lib/rpm/pdf';
import { getProperty, loadMonthState, saveMonthState } from '../lib/rpm/persistence';
import type { Hotel, Bounds, ParsedStar, RosterEntry, MonthData, MonthState } from '../lib/rpm/types';
import type { Property } from '../lib/types';

const DEFAULT_BOUNDS: Bounds = { oLo: 0, oHi: 100, aLo: 0, aHi: 1000 };

function defaultBounds(m: MonthData): Bounds {
  return {
    oLo: Math.max(0, Math.floor((Math.min(m.occ.subject, m.occ.compSet) - 30) / 5) * 5),
    oHi: Math.min(100, Math.ceil((Math.max(m.occ.subject, m.occ.compSet) + 30) / 5) * 5),
    aLo: Math.max(0, Math.floor((Math.min(m.adr.subject, m.adr.compSet) - 60) / 10) * 10),
    aHi: Math.ceil((Math.max(m.adr.subject, m.adr.compSet) * 1.9) / 10) * 10,
  };
}

function buildMonthState(hs: Hotel[], b: Bounds, z: number, locked: boolean): MonthState {
  return {
    locked,
    limits: { oLo: b.oLo, oHi: b.oHi, aLo: b.aLo, aHi: b.aHi, zoom: z },
    hotels: hs.map((h) => ({
      name: norm(h.name), rooms: h.rooms, pinOcc: h.pinOcc, pinAdr: h.pinAdr,
      rankOcc: h.rankOcc, rankAdr: h.rankAdr, locked: h.locked, lockOcc: h.lockOcc, lockAdr: h.lockAdr,
    })),
  };
}

export default function RpmTool() {
  const { propertyId } = useParams();

  const [property, setProperty] = useState<Property | null>(null);
  const [propErr, setPropErr] = useState('');
  const [loadingProp, setLoadingProp] = useState(true);

  const [parsed, setParsed] = useState<ParsedStar | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [uploadSummary, setUploadSummary] = useState<string | null>(null);

  const [monthKey, setMonthKey] = useState('');
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [bounds, setBounds] = useState<Bounds>(DEFAULT_BOUNDS);
  const [zoom, setZoom] = useState(0.7);
  const [monthLocked, setMonthLocked] = useState(false);

  const [saveLabel, setSaveLabel] = useState('Save Config');
  const [toolErr, setToolErr] = useState('');

  const month: MonthData | null = parsed && monthKey ? (parsed.byMonth[monthKey] ?? null) : null;
  const sol = useMemo(() => (month ? solve(month, hotels, bounds) : null), [month, hotels, bounds]);
  const rows = useMemo(() => (sol && month ? computeRows(sol, month, hotels) : null), [sol, month, hotels]);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!propertyId) return;
      setLoadingProp(true);
      setPropErr('');
      try {
        const p = await getProperty(propertyId);
        if (!live) return;
        if (!p) setPropErr('Property not found, or you do not have access to it.');
        setProperty(p);
      } catch (e) {
        if (live) setPropErr(e instanceof Error ? e.message : 'Failed to load property');
      } finally {
        if (live) setLoadingProp(false);
      }
    })();
    return () => { live = false; };
  }, [propertyId]);

  function applyLoaded(state: MonthState | null, fresh: Hotel[], m: MonthData) {
    if (state) {
      setBounds({ oLo: +state.limits.oLo, oHi: +state.limits.oHi, aLo: +state.limits.aLo, aHi: +state.limits.aHi });
      setZoom(state.limits.zoom || 0.7);
      setMonthLocked(!!state.locked);
      setHotels(fresh.map((h) => {
        const sh = state.hotels.find((s) => s.name === norm(h.name));
        if (!sh) return h;
        return {
          ...h,
          rooms: sh.rooms !== '' && sh.rooms != null ? sh.rooms : h.rooms,
          pinOcc: sh.pinOcc || '', pinAdr: sh.pinAdr || '',
          rankOcc: sh.rankOcc || '', rankAdr: sh.rankAdr || '',
          locked: !!sh.locked, lockOcc: sh.lockOcc ?? null, lockAdr: sh.lockAdr ?? null,
        };
      }));
    } else {
      setBounds(defaultBounds(m));
      setZoom(0.7);
      setMonthLocked(false);
      setHotels(fresh);
    }
  }

  const onLoaded = async (p: ParsedStar, r: RosterEntry[]) => {
    setToolErr('');
    setParsed(p);
    setRoster(r);
    setUploadSummary(`${p.subjectName || 'Loaded'} · ${p.order.length} months${r.length ? ` · ${r.length} hotels` : ''}`);
    const newKey = p.order[p.order.length - 1];
    const m = p.byMonth[newKey];
    const fresh = buildHotels(p, r);
    let state: MonthState | null = null;
    if (propertyId) {
      try { state = await loadMonthState(propertyId, newKey); } catch { /* none */ }
    }
    applyLoaded(state, fresh, m);
    setMonthKey(newKey);
  };

  const onMonthChange = async (newKey: string) => {
    if (!parsed || !propertyId) return;
    try { await saveMonthState(propertyId, monthKey, buildMonthState(hotels, bounds, zoom, monthLocked)); } catch { /* ignore */ }
    const m = parsed.byMonth[newKey];
    const fresh = buildHotels(parsed, roster);
    let state: MonthState | null = null;
    try { state = await loadMonthState(propertyId, newKey); } catch { /* none */ }
    applyLoaded(state, fresh, m);
    setMonthKey(newKey);
  };

  const onSave = async () => {
    if (!parsed || !monthKey || !propertyId) return;
    setSaveLabel('Saving…');
    try {
      await saveMonthState(propertyId, monthKey, buildMonthState(hotels, bounds, zoom, monthLocked));
      setSaveLabel('Saved!');
      setTimeout(() => setSaveLabel('Save Config'), 2000);
    } catch (e) {
      setToolErr(e instanceof Error ? e.message : 'Save failed');
      setSaveLabel('Save Config');
    }
  };

  const onClear = () => {
    setHotels((prev) => prev.map((h) => (h.isSubject ? h : {
      ...h, pinOcc: '', pinAdr: '', rankOcc: '', rankAdr: '', locked: false, lockOcc: null, lockAdr: null,
    })));
  };

  const toggleMonthLock = async () => {
    const next = !monthLocked;
    const nextHotels = hotels.map((h) => {
      if (h.isSubject) return h;
      if (next) {
        const rr = rows?.hs.find((x) => x.id === h.id);
        return { ...h, locked: true, lockOcc: rr ? +rr.occ.toFixed(1) : h.lockOcc, lockAdr: rr ? +rr.adr.toFixed(2) : h.lockAdr };
      }
      return { ...h, locked: false, lockOcc: null, lockAdr: null };
    });
    setHotels(nextHotels);
    setMonthLocked(next);
    if (parsed && monthKey && propertyId) {
      try { await saveMonthState(propertyId, monthKey, buildMonthState(nextHotels, bounds, zoom, next)); } catch { /* ignore */ }
    }
  };

  const onField = (id: number, field: keyof Hotel, value: string) =>
    setHotels((prev) => prev.map((h) => (h.id === id ? ({ ...h, [field]: value } as Hotel) : h)));
  const onRooms = (id: number, value: string) =>
    setHotels((prev) => prev.map((h) => (h.id === id ? { ...h, rooms: value === '' ? '' : (parseInt(value, 10) || 0) } : h)));
  const onName = (id: number, value: string) =>
    setHotels((prev) => prev.map((h) => (h.id === id ? { ...h, name: value } : h)));
  const onToggleLock = (id: number) =>
    setHotels((prev) => prev.map((h) => {
      if (h.id !== id) return h;
      if (!h.locked) {
        const rr = rows?.hs.find((x) => x.id === id);
        return { ...h, locked: true, lockOcc: rr ? +rr.occ.toFixed(1) : null, lockAdr: rr ? +rr.adr.toFixed(2) : null };
      }
      return { ...h, locked: false, lockOcc: null, lockAdr: null };
    }));
  const onDelete = (id: number) => setHotels((prev) => prev.filter((h) => h.id !== id));

  const onPdf = () => {
    if (!rows || !month) return;
    try { drawPdf(rows, month, zoom, parsed?.subjectName ?? ''); }
    catch (e) { setToolErr('PDF failed: ' + (e instanceof Error ? e.message : String(e))); }
  };

  if (!propertyId) return <div className="page"><p className="muted">No property selected.</p></div>;
  if (loadingProp) return <div className="page"><p className="muted">Loading property…</p></div>;

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">{property?.name || 'RPM Tool'}</h1>
        <p className="page-sub">
          {parsed
            ? `${parsed.subjectName || 'Report'} · ${parsed.order.length} months loaded`
            : 'Upload this property\u2019s Monthly STAR report to begin.'}
        </p>
      </div>

      {propErr && <div className="admin-err">{propErr}</div>}
      {toolErr && <div className="admin-err">{toolErr}</div>}

      <UploadStar onLoaded={onLoaded} summary={uploadSummary} />

      {parsed && month && (
        <>
          <div className="card tool-controls">
            <select className="month-select" value={monthKey} onChange={(e) => onMonthChange(e.target.value)}>
              {parsed.order.slice().reverse().map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button
              className={`lock-month ${monthLocked ? 'on' : ''}`}
              title={monthLocked ? 'Unlock month' : 'Lock month as solved'}
              onClick={toggleMonthLock}
            >
              {monthLocked ? '🔒' : '🔓'}
            </button>
            <span style={{ marginLeft: 'auto' }} />
            <button className="btn" onClick={onSave} disabled={saveLabel !== 'Save Config'}>{saveLabel}</button>
            <button className="btn" onClick={onClear} disabled={monthLocked}>Clear pins</button>
            <button className="btn" onClick={onPdf} disabled={!rows}>Export PDF</button>
          </div>

          {rows && <div style={{ marginTop: 14 }}><PositioningGrid rows={rows} zoom={zoom} /></div>}

          <div style={{ marginTop: 14 }}>
            <HotelTable
              hotels={hotels}
              rows={rows}
              month={month}
              monthLocked={monthLocked}
              onField={onField}
              onRooms={onRooms}
              onName={onName}
              onToggleLock={onToggleLock}
              onDelete={onDelete}
            />
          </div>

          {sol && (
            <>
              <div className={`recon ${sol.tie ? '' : 'off'}`}>
                {(sol.tie ? '✓ ' : '⚠ ') +
                  `Tie-out: all hotels blend to STR comp set ${month.occ.compSet.toFixed(1)}% · $${month.adr.compSet.toFixed(2)} · RevPAR $${month.revpar.compSet.toFixed(2)}` +
                  (sol.tie ? '' :
                    `  (currently ${sol.blendOcc != null && isFinite(sol.blendOcc) ? sol.blendOcc.toFixed(1) : '–'}% · $${sol.blendAdr != null && isFinite(sol.blendAdr) ? sol.blendAdr.toFixed(2) : '–'})`)}
              </div>
              {[...new Set(sol.warn)].map((w, i) => <div className="warn" key={i}>⚠ {w}</div>)}
            </>
          )}

          <LimitsPanel
            bounds={bounds}
            zoom={zoom}
            disabled={false}
            onBounds={setBounds}
            onZoom={setZoom}
          />
        </>
      )}
    </div>
  );
}
