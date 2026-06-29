import { Routes, Route, Navigate, Link, useParams } from 'react-router-dom';
import type { ReactNode } from 'react';

// TODO (Phase 1): replace with real auth check from AuthContext.
function ProtectedRoute({ children }: { children: ReactNode }) {
  const authed = true; // placeholder
  return authed ? <>{children}</> : <Navigate to="/login" replace />;
}

function Landing() {
  return (
    <div className="wrap" style={{ paddingTop: 80 }}>
      <h1 style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-.02em' }}>
        RPM De-Anonymizer
      </h1>
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
  return (
    <div className="wrap" style={{ paddingTop: 80, maxWidth: 420 }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Sign in</h2>
        <p style={{ color: 'var(--mut)' }}>Google sign-in arrives in Phase 1.</p>
        <Link className="btn btn-primary" to="/app" style={{ textDecoration: 'none', display: 'inline-block' }}>
          Continue (stub)
        </Link>
      </div>
    </div>
  );
}

function Dashboard() {
  return (
    <div className="wrap" style={{ paddingTop: 40 }}>
      <h2>Dashboard</h2>
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
      <Route path="/app" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/app/properties" element={<ProtectedRoute><PropertySelect /></ProtectedRoute>} />
      <Route path="/app/properties/:propertyId" element={<ProtectedRoute><Tool /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}