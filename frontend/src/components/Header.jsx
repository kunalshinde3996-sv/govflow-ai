import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

const ROLE_LABEL = { citizen: 'Citizen', officer: 'Officer', admin: 'Admin' };

/** Simple government-style emblem placeholder: a shield with a column motif. */
export function Emblem({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M20 2.5 34 7.5v10.2c0 9-5.6 15.2-14 19.8C11.6 32.900 6 26.700 6 17.700V7.500L20 2.500Z" fill="rgba(255,255,255,0.12)" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12.500 15 20 11l7.500 4" stroke="#e0a526" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 17.500v8M20 17.500v8M26 17.500v8M12 27.500h16" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const LogoutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 3H4.500A1.500 1.500 0 0 0 3 4.500v11A1.500 1.500 0 0 0 4.500 17H8" />
    <path d="M13 6.500 16.500 10 13 13.500M16.500 10H8" />
  </svg>
);

/** Sticky app header shared by the citizen, officer and admin portals. */
export default function Header({ links }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  return (
    <header className="gov-header text-white sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-4 pt-2.5 flex items-center justify-between gap-3">
        <Link to="/" className="flex items-center gap-3 min-w-0 rounded-lg focus-visible:outline-2 focus-visible:outline-white">
          <Emblem />
          <span className="min-w-0 leading-tight">
            <span className="block text-[10px] sm:text-[11px] tracking-widest uppercase text-blue-200 truncate">Government of Goa &middot; Office of the Collector, North Goa</span>
            <span className="block text-lg font-semibold truncate">GovFlow Case Management</span>
          </span>
        </Link>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-sm font-medium max-w-[110px] min-[500px]:max-w-[210px] truncate">{user.name}</span>
          {/* Role badge and divider collapse below 769px: name and button only */}
          <span className="role-pill hidden min-[769px]:inline-block">{ROLE_LABEL[user.role] || user.role}</span>
          <span className="hidden min-[769px]:block h-6 w-px bg-white/30" aria-hidden="true" />
          <button className="signout-btn" onClick={() => { logout(); nav('/login'); }}>
            <LogoutIcon /><span>Sign out</span>
          </button>
        </div>
      </div>
      <nav className="max-w-6xl mx-auto px-4 pt-2 pb-2 flex gap-1 overflow-x-auto nav-scroll" aria-label="Main">
        {links.map(([to, label]) => <NavLink key={to} to={to} className="nav-pill">{label}</NavLink>)}
      </nav>
    </header>
  );
}
