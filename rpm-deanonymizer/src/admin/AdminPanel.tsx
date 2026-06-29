import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  collection, getDocs, doc, addDoc, updateDoc, arrayUnion, arrayRemove,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../auth/AuthContext';
import type { UserProfile, Property, Role } from '../lib/types';
import '../styles/admin.css';

const ORG_ID = 'charlestowne';
const ROLES: Role[] = ['none', 'viewer', 'manager', 'admin'];

export default function AdminPanel() {
  const { profile } = useAuth();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [newPropName, setNewPropName] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => { loadAll(); }, []);

  // All hooks are declared above this guard.
  if (profile && profile.role !== 'admin') return <Navigate to="/app" replace />;

  async function loadAll() {
    setLoading(true);
    setErr('');
    try {
      const [uSnap, pSnap] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'properties')),
      ]);
      const u = uSnap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) }));
      const p = pSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Property, 'id'>) }));
      u.sort((a, b) => (a.email || '').localeCompare(b.email || ''));
      p.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setUsers(u);
      setProperties(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  }

  async function addProperty() {
    const name = newPropName.trim();
    if (!name) return;
    setBusy('add-prop');
    setErr('');
    try {
      const createdAt = Date.now();
      const ref = await addDoc(collection(db, 'properties'), { orgId: ORG_ID, name, createdAt });
      setProperties((prev) =>
        [...prev, { id: ref.id, orgId: ORG_ID, name, createdAt }]
          .sort((a, b) => a.name.localeCompare(b.name)));
      setNewPropName('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create property');
    } finally {
      setBusy('');
    }
  }

  async function changeRole(u: UserProfile, role: Role) {
    setBusy('role-' + u.uid);
    setErr('');
    try {
      await updateDoc(doc(db, 'users', u.uid), { role });
      setUsers((prev) => prev.map((x) => (x.uid === u.uid ? { ...x, role } : x)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update role');
    } finally {
      setBusy('');
    }
  }

  async function toggleProperty(u: UserProfile, pid: string, assign: boolean) {
    setBusy('prop-' + u.uid + '-' + pid);
    setErr('');
    try {
      await updateDoc(doc(db, 'users', u.uid), {
        properties: assign ? arrayUnion(pid) : arrayRemove(pid),
      });
      setUsers((prev) => prev.map((x) => {
        if (x.uid !== u.uid) return x;
        const set = new Set(x.properties || []);
        if (assign) set.add(pid); else set.delete(pid);
        return { ...x, properties: [...set] };
      }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update access');
    } finally {
      setBusy('');
    }
  }

  if (loading) {
    return <div className="page"><p className="muted">Loading admin data…</p></div>;
  }

  const propName = (id: string) => properties.find((p) => p.id === id)?.name || id;

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Admin</h1>
        <p className="page-sub">Create properties, set roles, and assign property access.</p>
      </div>

      {err && <div className="admin-err">{err}</div>}

      <section className="card" style={{ marginBottom: 18 }}>
        <h2 className="section-title">Properties</h2>
        <div className="add-row">
          <input
            className="text-input"
            placeholder="New property name (e.g. Surfside Beach Oceanfront)"
            value={newPropName}
            onChange={(e) => setNewPropName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addProperty(); }}
          />
          <button className="btn btn-primary" onClick={addProperty} disabled={busy === 'add-prop' || !newPropName.trim()}>
            {busy === 'add-prop' ? 'Adding…' : 'Add property'}
          </button>
        </div>
        {properties.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>No properties yet. Add one above.</p>
        ) : (
          <ul className="prop-list">
            {properties.map((p) => <li key={p.id}><span className="prop-dot" />{p.name}</li>)}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="section-title">Users &amp; access</h2>
        {users.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>No users yet.</p>
        ) : (
          <div className="user-rows">
            {users.map((u) => {
              const isSelf = u.uid === profile?.uid;
              const isAdminUser = u.role === 'admin';
              const assigned = u.properties || [];
              return (
                <div className="user-row" key={u.uid}>
                  <div className="user-main">
                    <div className="user-id">
                      <span className="user-name">
                        {u.displayName || u.email}{isSelf && <span className="you-tag"> (you)</span>}
                      </span>
                      <span className="user-email">{u.email}</span>
                    </div>
                    <div className="user-role">
                      <label className="mini-label">Role</label>
                      <select
                        className="role-select"
                        value={u.role}
                        disabled={isSelf || busy === 'role-' + u.uid}
                        title={isSelf ? "You can't change your own role" : ''}
                        onChange={(e) => changeRole(u, e.target.value as Role)}
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div className="user-access-summary">
                      {isAdminUser ? (
                        <span className="muted">All properties (admin)</span>
                      ) : (
                        <>
                          <span className="muted">{assigned.length} assigned</span>
                          <button className="btn link-btn" onClick={() => setExpanded(expanded === u.uid ? null : u.uid)}>
                            {expanded === u.uid ? 'Done' : 'Manage access'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {!isAdminUser && assigned.length > 0 && expanded !== u.uid && (
                    <div className="chips">
                      {assigned.map((pid) => <span className="chip" key={pid}>{propName(pid)}</span>)}
                    </div>
                  )}

                  {!isAdminUser && expanded === u.uid && (
                    <div className="access-editor">
                      {properties.length === 0 ? (
                        <span className="muted">Create a property first.</span>
                      ) : properties.map((p) => {
                        const on = assigned.includes(p.id);
                        const key = 'prop-' + u.uid + '-' + p.id;
                        return (
                          <label className={`access-opt ${on ? 'on' : ''}`} key={p.id}>
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={busy === key}
                              onChange={(e) => toggleProperty(u, p.id, e.target.checked)}
                            />
                            {p.name}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
