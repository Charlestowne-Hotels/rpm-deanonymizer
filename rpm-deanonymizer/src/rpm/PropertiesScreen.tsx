import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { listAccessibleProperties } from '../lib/rpm/persistence';
import type { Property } from '../lib/types';

export default function PropertiesScreen() {
  const { profile } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    if (!profile) return;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const list = await listAccessibleProperties(profile);
        if (live) setProperties(list);
      } catch (e) {
        if (live) setErr(e instanceof Error ? e.message : 'Failed to load properties');
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [profile]);

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Properties</h1>
        <p className="page-sub">
          {profile?.role === 'admin'
            ? 'All properties in the organization.'
            : 'Properties assigned to your account.'}
        </p>
      </div>

      {err && <div className="admin-err">{err}</div>}

      {loading ? (
        <p className="muted">Loading properties…</p>
      ) : properties.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            {profile?.role === 'admin'
              ? 'No properties yet. Create one in the Admin panel.'
              : "You don't have any properties assigned yet. Ask an administrator for access."}
          </p>
        </div>
      ) : (
        <div className="card-grid">
          {properties.map((p) => (
            <Link className="tile" key={p.id} to={`/app/properties/${p.id}`}>
              <p className="tile-title">{p.name}</p>
              <p className="tile-desc">Open the RPM tool →</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
