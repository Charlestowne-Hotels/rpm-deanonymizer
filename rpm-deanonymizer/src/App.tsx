import { Routes, Route, Navigate, Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth, hasAccess } from './auth/AuthContext';

function Landing() {
  return (
    <div className="wrap" style={{ paddingTop: 80 }}>
      <h1 style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-.02em' }}>RPM De-Anonymizer</h1>
      <p style={{ color: 'var(--mut)', maxWidth: '52ch' }}>
        Reverse-engineer competitor performance from your Monthly STAR report.
      </p>
      <Link className="btn btn-primary" to="/login" style={{ display: 'inline-block', marginTop: 16, textDecoration: 'none' }}>
        Sign in
      </Link>
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
    <div className="wrap" style={{ paddingTop: 80, maxWidth: 420 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Sign in</h2>
        <p style={{ color: 'var(--mut)' }}>Use your Google account to continue.</p>
        <button className="btn btn-primary" onClick={onSignIn} disabled={loading}>
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
    <div className="wrap" style={{ paddingTop: 80, maxWidth: 460 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>No access yet</h2>
        <p style={{ color: 'var(--mut)' }}>
          You're signed in{profile?.email ? ` as ${profile.email}` : ''}, but no properties have been
          assigned to your account. Ask an administrator to grant you access.
        </p>
        <button className="btn" onClick={() => signOut()}>Sign out</button>
      </div>
    </div>
  );
}

function Dashboard() {
  const { profile, signOut } = useAuth();
  return (
    <div className="wrap" style={{ paddingTop: 40 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Dashboard</h2>
        <button className="btn" onClick={() => signOut()}>Sign out</button>
      </div>
      <p style={{ color: 'var(--mut)' }}>
        Signed in as {profile?.displayName || profile?.email} · role: <b>{profile?.role}</b>
      </p>
      <Link className="btn" to="/app/properties">Select a property →</Link>
    </div>
  );
}

function PropertySelect() {
  return (
    <div className="wrap" style={{ paddingTop: 40 }}>
      <h2>Properties</h2>
      <Link className="btn" to="/app/properties/demo">Open demo property →</Link>
    </div>
  );
}

function Tool() {
  const { propertyId } = useParams();
  return (
    <div className="wrap" style={{ paddingTop: 40 }}>
      <h2>RPM Tool</h2>
      <p style={{ color: 'var(--mut)' }}>Property: {propertyId}. The ported tool lands in Phase 4.</p>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/no-access" element={<NoAccess />} />
      <Route path="/app" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/app/properties" element={<ProtectedRoute><PropertySelect /></ProtectedRoute>} />
      <Route path="/app/properties/:propertyId" element={<ProtectedRoute><Tool /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
