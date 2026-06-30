import type { Hotel, Rows, MonthData } from '../../lib/rpm/types';
import { money } from '../../lib/rpm/solver';

interface Props {
  hotels: Hotel[];
  rows: Rows | null;
  month: MonthData;
  monthLocked: boolean;
  blendOcc?: number;
  blendAdr?: number;
  onField: (id: number, field: keyof Hotel, value: string) => void;
  onRooms: (id: number, value: string) => void;
  onName: (id: number, value: string) => void;
  onToggleLock: (id: number) => void;
  onDelete: (id: number) => void;
}

const COLS = ['', '#', 'Hotel', 'Keys', 'Avail', 'Occ %', 'Occ Rk', 'Occ Idx', 'Sold', 'ADR $', 'ADR Rk', 'ADR Idx', 'Revenue', 'RevPAR', 'RPI'];
const f1 = (n: number) => (isFinite(n) ? n.toFixed(1) : '–');

const TOL = 0.15;
function cue(current: number | undefined, target: number, kind: 'pct' | 'usd') {
  if (current == null || !isFinite(current) || !isFinite(target) || Math.abs(current - target) <= TOL) return null;
  const low = current < target; // current below target → needs to come up
  const txt = kind === 'pct' ? `${current.toFixed(1)}%` : `$${current.toFixed(2)}`;
  return <div className="tie-cue">{low ? '▲' : '▼'} {txt}</div>;
}

export default function HotelTable({
  hotels, rows, month, monthLocked, blendOcc, blendAdr, onField, onRooms, onName, onToggleLock, onDelete,
}: Props) {
  const rowFor = (id: number) => rows?.hs.find((r) => r.id === id);
  const blendRevpar = (blendOcc != null && blendAdr != null && isFinite(blendOcc) && isFinite(blendAdr))
    ? (blendOcc / 100) * blendAdr : undefined;

  return (
    <div className="card">
      <div className="section-title">Interactive Solved Breakdown</div>
      <div className="table-scroll">
        <table className="rpm-table">
          <thead><tr>{COLS.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
          <tbody>
            {hotels.map((h) => {
              const r = rowFor(h.id);
              const disabled = h.isSubject || monthLocked;
              const sRkO = h.isSubject ? (month.occ.subjectRank || '') : '';
              const sRkA = h.isSubject ? (month.adr.subjectRank || '') : '';
              return (
                <tr key={h.id} className={h.isSubject ? 'subj' : h.locked ? 'locked' : ''}>
                  <td>
                    {h.isSubject ? (
                      <span className="iconbtn lk" title="Your property — centered" style={{ cursor: 'default' }}>🔒</span>
                    ) : (
                      <>
                        <button className="iconbtn lk" disabled={monthLocked} title={h.locked ? 'Unlock' : 'Lock estimate'} onClick={() => onToggleLock(h.id)}>
                          {h.locked ? '🔒' : '🔓'}
                        </button>
                        <button className="iconbtn del" disabled={monthLocked} title="Remove" onClick={() => onDelete(h.id)}>✕</button>
                      </>
                    )}
                  </td>
                  <td><b>{r?.rgiRk ?? ''}</b></td>
                  <td>
                    <input
                      className="tb-input" style={{ width: 240, textAlign: 'left' }}
                      value={h.name} disabled={disabled || h.locked} title={h.name}
                      onChange={(e) => onName(h.id, e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="number" className="tb-input" style={{ width: 66 }} placeholder="Keys"
                      value={h.rooms} disabled={h.isSubject || monthLocked}
                      onChange={(e) => onRooms(h.id, e.target.value)}
                    />
                  </td>
                  <td className="faint">{r ? Math.round(r.avail).toLocaleString() : ''}</td>
                  <td>
                    {h.isSubject ? (
                      <input className="tb-input ro" disabled value={r ? f1(r.occ) + '%' : ''} />
                    ) : h.locked ? (
                      <input className="tb-input ro" disabled value={h.lockOcc != null ? h.lockOcc + '%' : ''} />
                    ) : (
                      <input
                        type="number" className={`tb-input ${h.pinOcc !== '' ? 'pinned' : ''}`}
                        value={h.pinOcc} placeholder={r ? f1(r.occ) + '%' : ''} disabled={disabled}
                        title="Pin exact Occ %" onChange={(e) => onField(h.id, 'pinOcc', e.target.value)}
                      />
                    )}
                  </td>
                  <td>
                    {h.isSubject ? (
                      <input className="tb-input ro" disabled value={sRkO} />
                    ) : h.locked ? (
                      <input className="tb-input ro" disabled value={h.rankOcc || ''} />
                    ) : (
                      <input type="number" className="tb-input" style={{ width: 62 }} placeholder="Rk"
                        value={h.rankOcc} disabled={disabled} title="Rank vs you on occupancy"
                        onChange={(e) => onField(h.id, 'rankOcc', e.target.value)} />
                    )}
                  </td>
                  <td className="mut">{r ? f1(r.occIdx) : ''}</td>
                  <td className="faint">{r ? Math.round(r.sold).toLocaleString() : ''}</td>
                  <td>
                    {h.isSubject ? (
                      <input className="tb-input ro" disabled value={r ? '$' + r.adr.toFixed(2) : ''} />
                    ) : h.locked ? (
                      <input className="tb-input ro" disabled value={h.lockAdr != null ? '$' + h.lockAdr : ''} />
                    ) : (
                      <input
                        type="number" className={`tb-input ${h.pinAdr !== '' ? 'pinned' : ''}`}
                        value={h.pinAdr} placeholder={r ? '$' + r.adr.toFixed(2) : ''} disabled={disabled}
                        title="Pin exact ADR $" onChange={(e) => onField(h.id, 'pinAdr', e.target.value)}
                      />
                    )}
                  </td>
                  <td>
                    {h.isSubject ? (
                      <input className="tb-input ro" disabled value={sRkA} />
                    ) : h.locked ? (
                      <input className="tb-input ro" disabled value={h.rankAdr || ''} />
                    ) : (
                      <input type="number" className="tb-input" style={{ width: 62 }} placeholder="Rk"
                        value={h.rankAdr} disabled={disabled} title="Rank vs you on ADR"
                        onChange={(e) => onField(h.id, 'rankAdr', e.target.value)} />
                    )}
                  </td>
                  <td className="mut">{r ? f1(r.adrIdx) : ''}</td>
                  <td className="faint">{r ? money(r.rev) : ''}</td>
                  <td style={{ fontWeight: 700 }}>{r ? '$' + r.revpar.toFixed(2) : ''}</td>
                  <td className="mut">{r ? f1(r.rpi) : ''}</td>
                </tr>
              );
            })}
            {rows && (
              <tr className="tot str">
                <td /><td /><td style={{ textAlign: 'left' }}>{rows.strRow.label}</td>
                <td>{rows.strRow.rooms}</td>
                <td>{Math.round(rows.strRow.avail).toLocaleString()}</td>
                <td>{rows.strRow.occ.toFixed(1)}%{cue(blendOcc, rows.strRow.occ, 'pct')}</td>
                <td /><td>100</td>
                <td>{Math.round(rows.strRow.sold).toLocaleString()}</td>
                <td>${rows.strRow.adr.toFixed(2)}{cue(blendAdr, rows.strRow.adr, 'usd')}</td>
                <td /><td>100</td>
                <td>{money(rows.strRow.rev)}</td>
                <td>${rows.strRow.revpar.toFixed(2)}{cue(blendRevpar, rows.strRow.revpar, 'usd')}</td>
                <td>100</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
