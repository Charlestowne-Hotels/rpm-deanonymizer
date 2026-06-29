import { Routes, Route, Navigate, Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import ProtectedRoute from './components/ProtectedRoute';
import AppLayout from './components/AppLayout';
import AdminPanel from './admin/AdminPanel';
import { useAuth, hasAccess } from './auth/AuthContext';

function Landing() {
  return (
    <div className="landing">
      <div className="landing-top">
        <span className="brand-mark"><i /><i /></span>
        <span className="brand-name">RPM De-Anonymizer</span>
        <span className="spacer" />
        <Link className="btn" to="/login" style={{ textDecoration: 'none' }}>Sign in</Link>
      </div>
      <div className="landing-hero">
        <h1>See past the anonymized comp set.</h1>
        <p>
          Upload your Monthly STAR report and reverse-engineer competitor occupancy, ADR,
          and RevPAR — anchored to your property and tied out to the STR totals.
        </p>
        <Link className="btn btn-primary" to="/login" style={{ textDecoration: 'none' }}>Get started</Link>
      </div>
    </div>
  );
}

function Login() {
  const { firebaseUser, profile, loading, signIn } = useAuth();
  const [err, setErr] = useState('');

  if (!loading && firebaseUser) {
    return <Navigate to={hasAccess(profile) ? '/app' : '/no-access'} replace />;
  }

  const onSignIn = async () => {
    setErr('');
    try {
      await signIn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Sign-in failed');
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card card">
        <div className="auth-brand">
          <span className="brand-mark"><i /><i /></span>
          <span>RPM De-Anonymizer</span>
        </div>
        <h2 style={{ marginTop: 0, marginBottom: 6 }}>Sign in</h2>
        <p className="muted" style={{ marginTop: 0 }}>Use your Google account to continue.</p>
        <button className="btn btn-primary" onClick={onSignIn} disabled={loading} style={{ width: '100%' }}>
          {loading ? 'Working…' : 'Continue with Google'}
        </button>
        {err && <p style={{ color: 'var(--red)', fontSize: 13, marginTop: 12 }}>{err}</p>}
      </div>
    </div>
  );
}

function NoAccess() {
  const { firebaseUser, profile, loading, signOut } = useAuth();
  if (!loading && !firebaseUser) return <Navigate to="/login" replace />;
  if (!loading && hasAccess(profile)) return <Navigate to="/app" replace />;

  return (
    <div className="auth-shell">
      <div className="auth-card card">
        <h2 style={{ marginTop: 0 }}>No access yet</h2>
        <p className="muted">
          You're signed in{profile?.email ? ` as ${profile.email}` : ''}, but no properties have
          been assigned to your account. Ask an administrator to grant you access.
        </p>
        <button className="btn" onClick={() => signOut()}>Sign out</button>
      </div>
    </div>
  );
}

function Dashboard() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const first = (profile?.displayName || profile?.email || '').split(' ')[0];

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Welcome{first ? `, ${first}` : ''}</h1>
        <p className="page-sub">What would you like to work on?</p>
      </div>
      <div className="card-grid">
        <Link className="tile" to="/app/properties">
          <p className="tile-title">Properties →</p>
          <p className="tile-desc">Open a property and work the RPM tool for a STAR month.</p>
        </Link>
        {isAdmin && (
          <Link className="tile" to="/app/admin">
            <p className="tile-title">Admin →</p>
            <p className="tile-desc">Manage users, create properties, and assign access.</p>
          </Link>
        )}
      </div>
    </div>
  );
}

function PropertySelect() {
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Properties</h1>
        <p className="page-sub">Properties you've been assigned will appear here.</p>
      </div>
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          The property list and selection land in Phase 4. For now, the tool opens via a direct link.
        </p>
        <Link className="btn" to="/app/properties/demo" style={{ marginTop: 12, display: 'inline-block', textDecoration: 'none' }}>
          Open demo property →
        </Link>
      </div>
    </div>
  );
}

function Tool() {
  const { propertyId } = useParams();
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">RPM Tool</h1>
        <p className="page-sub">Property: {propertyId}</p>
      </div>
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>The ported RPM tool lands in Phase 4.</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/no-access" element={<NoAccess />} />

      <Route path="/app" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="properties" element={<PropertySelect />} />
        <Route path="properties/:propertyId" element={<Tool />} />
        <Route path="admin" element={<AdminPanel />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
