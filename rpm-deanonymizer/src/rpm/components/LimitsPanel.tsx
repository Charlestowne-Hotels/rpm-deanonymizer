import type { Bounds } from '../../lib/rpm/types';

interface Props {
  bounds: Bounds;
  zoom: number;
  disabled: boolean;
  onBounds: (b: Bounds) => void;
  onZoom: (z: number) => void;
}

export default function LimitsPanel({ bounds, zoom, disabled, onBounds, onZoom }: Props) {
  const set = (k: keyof Bounds) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onBounds({ ...bounds, [k]: +e.target.value || 0 });

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="section-title">Limits</div>
      <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>
        Hard walls the unlocked hotels can't cross. Grid zoom controls how tight the matrix renders
        (1.0 = auto-fit; lower = zoomed out).
      </p>
      <div className="limits-row">
        <div className="limit-group">
          <span className="mini-label">Solver Occ %</span>
          <div className="limit-range">
            <input type="number" value={bounds.oLo} disabled={disabled} onChange={set('oLo')} />
            <span>to</span>
            <input type="number" value={bounds.oHi} disabled={disabled} onChange={set('oHi')} />
          </div>
        </div>
        <div className="limit-group">
          <span className="mini-label">Solver ADR $</span>
          <div className="limit-range">
            <input type="number" value={bounds.aLo} disabled={disabled} onChange={set('aLo')} />
            <span>to</span>
            <input type="number" value={bounds.aHi} disabled={disabled} onChange={set('aHi')} />
          </div>
        </div>
        <div className="limit-group">
          <span className="mini-label">Grid zoom</span>
          <div className="limit-range">
            <input type="number" step="0.1" min="0.3" max="3" value={zoom} onChange={(e) => onZoom(+e.target.value || 0.7)} />
          </div>
        </div>
      </div>
    </div>
  );
}
