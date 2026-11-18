import { Routes, Route, Navigate, NavLink, Link, useNavigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import { MyCases, NewApplication } from './pages/Citizen.jsx';
import CaseView from './pages/CaseView.jsx';
import Queue from './pages/Queue.jsx';
import AuditLog from './pages/AuditLog.jsx';
import Analytics from './pages/Analytics.jsx';
import Modules from './pages/Modules.jsx';
import Assistant from './components/Assistant.jsx';

function Shell({ children }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const staff = user.role !== 'citizen';
  const links = staff
    ? [['/queue', 'Case Queue'], ['/analytics', 'Analytics'], ['/audit', 'Audit Log'], ...(user.role === 'admin' ? [['/modules', 'Modules & Rules']] : [])]
    : [['/cases', 'My Applications'], ['/apply', 'New Application']];
  const cls = ({ isActive }) => `px-3 py-2 text-sm ${isActive ? 'text-white border-b-2 border-white' : 'text-blue-100 hover:text-white border-b-2 border-transparent'}`;
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-navy text-white">
        <div className="max-w-6xl mx-auto px-4 pt-3 flex items-center justify-between gap-4 flex-wrap">
          <Link to="/" className="block">
            <div className="text-[11px] tracking-widest uppercase text-blue-200">Government of Goa &middot; Office of the Collector, North Goa District</div>
            <div className="text-lg font-semibold">GovFlow Case Management</div>
          </Link>
          <div className="text-sm text-right">
            <div>{user.name} <span className="text-blue-200">({user.role})</span></div>
            <button className="text-blue-200 hover:text-white underline text-xs" onClick={() => { logout(); nav('/login'); }}>Sign out</button>
          </div>
        </div>
        <nav className="max-w-6xl mx-auto px-4 flex flex-wrap gap-x-1 mt-2">
          {links.map(([to, label]) => <NavLink key={to} to={to} className={cls}>{label}</NavLink>)}
        </nav>
      </header>
      <main className="max-w-6xl w-full mx-auto px-4 pt-5 pb-20 flex-1 min-w-0">{children}</main>
      <Assistant />
      <footer className="text-center text-xs text-muted py-4">Every action on this platform is recorded in a tamper-evident audit trail.</footer>
    </div>
  );
}

export default function App() {
  const { user } = useAuth();
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Login register />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  const staff = user.role !== 'citizen';
  const home = staff ? '/queue' : '/cases';
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Navigate to={home} replace />} />
        <Route path="/login" element={<Navigate to={home} replace />} />
        <Route path="/cases" element={<MyCases />} />
        <Route path="/apply" element={<NewApplication />} />
        <Route path="/apply/:id" element={<NewApplication />} />
        <Route path="/case/:id" element={<CaseView />} />
        <Route path="/queue" element={staff ? <Queue /> : <Navigate to={home} />} />
        <Route path="/analytics" element={staff ? <Analytics /> : <Navigate to={home} />} />
        <Route path="/audit" element={staff ? <AuditLog /> : <Navigate to={home} />} />
        <Route path="/modules" element={user.role === 'admin' ? <Modules /> : <Navigate to={home} />} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </Shell>
  );
}
