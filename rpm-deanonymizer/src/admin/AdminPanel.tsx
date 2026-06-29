import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  collection, getDocs, doc, addDoc, updateDoc, arrayUnion, arrayRemove,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../auth/AuthContext';
import { listAccessibleProperties, saveUploadedReport } from '../lib/rpm/persistence';
import UploadStar from '../rpm/components/UploadStar';
import type { UserProfile, Property, Role } from '../lib/types';
import type { ParsedStar, RosterEntry } from '../lib/rpm/types';
import '../styles/admin.css';

const ORG_ID = 'charlestowne';
const OWNER_EMAIL = 'jryan@charlestownehotels.com';
const ROLES: Role[] = ['none', 'viewer', 'manager', 'admin'];

function PropertyUploadRow({ property }: { property: Property }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const handle = async (parsed: ParsedStar, roster: RosterEntry[]) => {
    setErr(''); setInfo(null);
    try {
      const r = await saveUploadedReport(property.id, parsed, roster);
      const parts: string[] = [];
      if (r.added.length) parts.push(`${r.added.length} new`);
      if (r.unchanged.length) parts.push(`${r.unchanged.length} unchanged`);
      if (r.conflicts.length) parts.push(`${r.conflicts.length} flagged`);
      setInfo(parts.join(' · ') || 'No months found in file.');
      setSummary(`${parsed.subjectName || 'Report'} · ${parsed.order.length} months`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    }
  };

  return (
    <div className="settings-prop-row">
      <div className="settings-prop-name"><span className="prop-dot" />{property.name}</div>
      <UploadStar onLoaded={handle} summary={summary} />
      {info && <div className="upload-info">{info}</div>}
      {err && <div className="admin-err" style={{ marginBottom: 0 }}>{err}</div>}
    </div>
  );
}

export default function AdminPanel() {
  const { profile } = useAuth();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [newPropName, setNewPropName] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const isAdmin = profile?.role === 'admin';
  const meIsOwner = profile?.email === OWNER_EMAIL;

  useEffect(() => { if (profile) loadAll(); /* eslint-disable-next-line */ }, [profile]);

  // Viewers (and unassigned) don't get Settings.
  if (profile && profile.role !== 'admin' && profile.role !== 'manager') {
    return <Navigate to="/app" replace />;
  }

  async function loadAll() {
    if (!profile) return;
    setLoading(true); setErr('');
    try {
      const props = await listAccessibleProperties(profile);
      setProperties(props);
      if (profile.role === 'admin') {
        const uSnap = await getDocs(collection(db, 'users'));
        const u = uSnap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) }));
        u.sort((a, b) => (a.email || '').localeCompare(b.email || ''));
        setUsers(u);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  async function addProperty() {
    const name = newPropName.trim();
    if (!name) return;
    setBusy('add-prop'); setErr('');
    try {
      const createdAt = Date.now();
      const ref = await addDoc(collection(db, 'properties'), { orgId: ORG_ID, name, createdAt });
      setProperties((prev) => [...prev, { id: ref.id, orgId: ORG_ID, name, createdAt }]
        .sort((a, b) => a.name.localeCompare(b.name)));
      setNewPropName('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create property');
    } finally { setBusy(''); }
  }

  async function changeRole(u: UserProfile, role: Role) {
    setBusy('role-' + u.uid); setErr('');
    try {
      await updateDoc(doc(db, 'users', u.uid), { role });
      setUsers((prev) => prev.map((x) => (x.uid === u.uid ? { ...x, role } : x)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update role');
    } finally { setBusy(''); }
  }

  async function toggleProperty(u: UserProfile, pid: string, assign: boolean) {
    setBusy('prop-' + u.uid + '-' + pid); setErr('');
    try {
      await updateDoc(doc(db, 'users', u.uid), { properties: assign ? arrayUnion(pid) : arrayRemove(pid) });
      setUsers((prev) => prev.map((x) => {
        if (x.uid !== u.uid) return x;
        const set = new Set(x.properties || []);
        if (assign) set.add(pid); else set.delete(pid);
        return { ...x, properties: [...set] };
      }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update access');
    } finally { setBusy(''); }
  }

  if (loading) return <div className="page"><p className="muted">Loading settings…</p></div>;

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Settings</h1>
        <p className="page-sub">
          {isAdmin ? 'Properties, users, access, and STR uploads.' : 'Upload STR reports for your assigned properties.'}
        </p>
      </div>

      {err && <div className="admin-err">{err}</div>}

      {/* Upload / Properties */}
      <section className="card" style={{ marginBottom: 18 }}>
        <h2 className="section-title">{isAdmin ? 'Properties & uploads' : 'Upload STR reports'}</h2>

        {isAdmin && (
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
        )}

        {properties.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            {isAdmin ? 'No properties yet. Add one above.' : 'No properties assigned to you yet.'}
          </p>
        ) : (
          properties.map((p) => <PropertyUploadRow key={p.id} property={p} />)
        )}
      </section>

      {/* Users & access — admins only */}
      {isAdmin && (
        <section className="card">
          <h2 className="section-title">Users &amp; access</h2>
          {users.length === 0 ? (
            <p className="muted" style={{ marginBottom: 0 }}>No users yet.</p>
          ) : (
            <div className="user-rows">
              {users.map((u) => {
                const isSelf = u.uid === profile?.uid;
                const isOwnerDoc = u.email === OWNER_EMAIL;
                const isAdminUser = u.role === 'admin';
                const assigned = u.properties || [];
                const locked = isSelf || (isOwnerDoc && !meIsOwner);
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
                        <select
                          className="role-select"
                          value={u.role}
                          disabled={locked || busy === 'role-' + u.uid}
                          title={locked ? "This account's role can't be changed here" : ''}
                          onChange={(e) => changeRole(u, e.target.value as Role)}
                        >
                          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                      <div className="user-access-summary">
                        {isAdminUser ? (
                          <span className="muted">All properties</span>
                        ) : (
                          <>
                            {assigned.length > 0 && <span className="assigned-count">{assigned.length}</span>}
                            <button
                              className="pencil"
                              title="Manage property access"
                              disabled={locked}
                              onClick={() => setExpanded(expanded === u.uid ? null : u.uid)}
                            >✎</button>
                          </>
                        )}
                      </div>
                    </div>

                    {!isAdminUser && expanded === u.uid && (
                      <div className="access-editor">
                        {properties.length === 0 ? (
                          <span className="muted">Create a property first.</span>
                        ) : properties.map((p) => {
                          const on = assigned.includes(p.id);
                          const key = 'prop-' + u.uid + '-' + p.id;
                          return (
                            <label className={`access-opt ${on ? 'on' : ''}`} key={p.id}>
                              <input type="checkbox" checked={on} disabled={busy === key}
                                onChange={(e) => toggleProperty(u, p.id, e.target.checked)} />
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
      )}
    </div>
  );
}
