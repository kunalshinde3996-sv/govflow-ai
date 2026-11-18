import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { ErrorBox } from '../ui.jsx';
import { Emblem } from '../components/Header.jsx';

const DEMO = [
  ['Citizen', 'citizen@govflow.demo'],
  ['Citizen (case in review)', 'ramesh@example.in'],
  ['Officer', 'officer@govflow.demo'],
  ['Administrator', 'admin@govflow.demo'],
];

export default function Login({ register }) {
  const { login, register: reg } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!f.email.trim() || !f.password || (register && !f.name.trim())) return setErr('Please fill in all the fields.');
    setBusy(true);
    try {
      const u = register ? await reg(f.name, f.email, f.password) : await login(f.email, f.password);
      nav(u.role === 'citizen' ? '/cases' : '/queue');
    } catch (ex) {
      setErr(ex.message === 'Invalid email or password' ? 'The email or password is incorrect. Please check and try again.' : ex.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="gov-header text-white py-7 text-center px-4 flex flex-col items-center">
        <Emblem size={48} />
        <div className="text-[11px] tracking-widest uppercase text-blue-200 mt-2">Government of Goa &middot; Office of the Collector, North Goa District</div>
        <h1 className="text-2xl font-semibold mt-1">GovFlow Case Management</h1>
        <p className="text-blue-100 text-sm mt-1">Document verification, eligibility and compensation, tracked end to end.</p>
      </div>
      <div className="page-fade max-w-md w-full mx-auto mt-8 px-4 flex-1">
        <form onSubmit={submit} className="card card-b space-y-3" noValidate>
          <h2 className="text-lg font-semibold">{register ? 'Create a citizen account' : 'Sign in'}</h2>
          {register && <div><label className="label" htmlFor="name">Full name</label><input id="name" className="input" value={f.name} onChange={set('name')} autoComplete="name" /></div>}
          <div><label className="label" htmlFor="email">Email</label><input id="email" className="input" type="email" value={f.email} onChange={set('email')} autoComplete="email" /></div>
          <div><label className="label" htmlFor="pw">Password {register && '(minimum 8 characters)'}</label><input id="pw" className="input" type="password" value={f.password} onChange={set('password')} autoComplete={register ? 'new-password' : 'current-password'} /></div>
          <ErrorBox error={err} />
          <button className="btn w-full" disabled={busy}>{busy ? 'Please wait...' : register ? 'Register' : 'Sign in'}</button>
          <p className="text-sm text-muted text-center">
            {register ? <>Already registered? <Link className="underline text-navy" to="/login">Sign in</Link></> : <>New applicant? <Link className="underline text-navy" to="/register">Create an account</Link></>}
          </p>
        </form>
        {!register && (
          <details className="card mt-4 group">
            <summary className="card-h cursor-pointer list-none select-none !p-4 items-center">
              <span className="leading-5">Demo access</span><span className="text-xs font-normal text-muted leading-5 group-open:hidden">Show</span><span className="text-xs font-normal text-muted leading-5 hidden group-open:inline">Hide</span>
            </summary>
            <div className="p-4">
              <div className="text-xs text-muted mb-3 text-center">Fills the form with a demonstration account (password: Demo@1234).</div>
              <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-3">
                {DEMO.map(([label, email]) => (
                  <button key={email} type="button" className="btn btn-ghost w-full h-11 text-center" onClick={() => setF({ ...f, email, password: 'Demo@1234' })}>{label}</button>
                ))}
              </div>
            </div>
          </details>
        )}
      </div>
      <footer className="text-center text-xs text-muted py-5">Prototype by Team NullCoders &middot; Goa AI Hackathon</footer>
    </div>
  );
}
