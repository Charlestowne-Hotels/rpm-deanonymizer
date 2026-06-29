import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function AppHeader() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const isAdmin = profile?.role === 'admin';

  const onSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '');

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link to="/app" className="brand">
          <span className="brand-mark"><i /><i /></span>
          <span className="brand-name">RPM De-Anonymizer</span>
        </Link>

        <nav className="nav">
          <NavLink to="/app" end className={navClass}>Dashboard</NavLink>
          <NavLink to="/app/properties" className={navClass}>Properties</NavLink>
          {isAdmin && <NavLink to="/app/admin" className={navClass}>Admin</NavLink>}
        </nav>

        <div className="header-user">
          <div className="header-user-text">
            <span className="header-user-name">{profile?.displayName || profile?.email}</span>
            <span className={`role-badge role-${profile?.role || 'none'}`}>{profile?.role}</span>
          </div>
          <button className="btn sign-out" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    </header>
  );
}
