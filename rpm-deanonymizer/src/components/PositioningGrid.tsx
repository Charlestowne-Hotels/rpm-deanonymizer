import { useState } from 'react';
import type { Rows } from '../../lib/rpm/types';
import { idxRange, clamp } from '../../lib/rpm/solver';

interface Props { rows: Rows; zoom: number; }

interface Tip { x: number; y: number; name: string; occ: number; adr: number; revpar: number; below: boolean; }

export default function PositioningGrid({ rows, zoom }: Props) {
  const [tip, setTip] = useState<Tip | null>(null);

  const R = idxRange(rows);
  const z = zoom > 0 ? zoom : 0.7;
  const hx = R.hx / z, hy = R.hy / z;
  const px = (v: number) => clamp((v - R.sx) / (2 * hx) + 0.5, 0, 1) * 100;
  const py = (v: number) => (1 - clamp((v - R.sy) / (2 * hy) + 0.5, 0, 1)) * 100;

  return (
    <div className="card">
      <div className="section-title">Positioning grid · relational (your property = center)</div>
      <div className="grid-row">
        <div className="ylab">ADR Index →</div>
        <div className="grid-col">
          <div className="grid-area">
            <div className="gl glh cross" style={{ top: '50%' }} />
            <div className="gl glv cross" style={{ left: '50%' }} />
            {rows.hs.map((h) => {
              if (!isFinite(h.occIdx) || !isFinite(h.adrIdx)) return null;
              const lx = px(h.occIdx), ly = py(h.adrIdx);
              return (
                <div
                  key={h.id}
                  className="dot"
                  style={{
                    left: `${lx}%`, top: `${ly}%`,
                    background: h.isSubject ? 'var(--grey)' : 'var(--purple)',
                  }}
                  onMouseEnter={() => setTip({ x: lx, y: ly, name: h.name, occ: h.occ, adr: h.adr, revpar: h.revpar, below: ly < 18 })}
                  onMouseLeave={() => setTip(null)}
                >
                  {h.rgiRk}
                </div>
              );
            })}
            {tip && (
              <div
                className="grid-tip on"
                style={{
                  left: `${tip.x}%`, top: `${tip.y}%`,
                  transform: tip.below ? 'translate(-50%,35%)' : 'translate(-50%,-135%)',
                }}
              >
                <b>{tip.name}</b><br />
                <span>Occ {tip.occ.toFixed(1)}%  ·  ADR ${tip.adr.toFixed(2)}  ·  RevPAR ${tip.revpar.toFixed(2)}</span>
              </div>
            )}
          </div>
          <div className="xlab">Occupancy Index →</div>
        </div>
      </div>
      <div className="legend">
        <span><i style={{ background: 'var(--grey)' }} />your property</span>
        <span><i style={{ background: 'var(--purple)' }} />comp set members</span>
      </div>
    </div>
  );
}
