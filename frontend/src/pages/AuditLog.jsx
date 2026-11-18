import { useEffect, useState } from 'react';
import { api } from '../api.js';
import AuditTable from '../components/AuditTable.jsx';
import { Spinner, ErrorBox } from '../ui.jsx';

/** System-wide, read-only audit log with chain-integrity verification. Opens on case actions (sign-ins hidden). */
export default function AuditLog() {
  const [data, setData] = useState(null);
  const [actions, setActions] = useState([]);
  const [f, setF] = useState({ action: '', actor: '' });
  const [showLogins, setShowLogins] = useState(false);
  const [page, setPage] = useState(0);
  const [verify, setVerify] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [err, setErr] = useState('');
  const PAGE = 50;

  useEffect(() => { api('/audit/actions').then(setActions).catch(() => {}); }, []);
  useEffect(() => {
    const p = new URLSearchParams({ limit: PAGE, offset: page * PAGE });
    Object.entries(f).forEach(([k, v]) => v && p.set(k, v));
    if (!showLogins && !f.action) p.set('exclude', 'USER_LOGIN');
    api('/audit?' + p).then((d) => { setData(d); setErr(''); }).catch((e) => setErr(e.message));
  }, [f, page, showLogins]);

  async function runVerify() {
    setVerifying(true); setVerify(null);
    try { setVerify(await api('/audit/verify')); } catch (e) { setErr(e.message); } finally { setVerifying(false); }
  }
  const reset = (patch) => { setPage(0); setF({ ...f, ...patch }); };

  return (
    <div>
      <div className="flex items-end justify-between flex-wrap gap-2 mb-3">
        <div><h1 className="text-xl font-semibold">Audit Log</h1>
          <p className="text-sm text-muted">Append-only. Each entry is cryptographically chained to the previous one, so any alteration is detectable.</p></div>
        <button className="btn" onClick={runVerify} disabled={verifying}>{verifying ? 'Verifying...' : 'Verify integrity'}</button>
      </div>

      {verify && (verify.valid ? (
        <div className="border border-emerald-300 bg-emerald-50 text-emerald-900 rounded p-3 mb-3 text-sm" role="status">
          <b>Chain verified:</b> {verify.checked} entries, no tampering detected.
        </div>
      ) : (
        <div className="border border-red-300 bg-red-50 text-red-900 rounded p-3 mb-3 text-sm" role="alert">
          <b>Chain broken.</b> The first entry that does not match its hash is #{verify.broken_at} (of {verify.checked} checked). Entries from that point on cannot be trusted.
        </div>
      ))}
      <ErrorBox error={err} />

      <div className="card card-b grid sm:grid-cols-3 gap-3 mb-4 items-end">
        <div><label className="label">Action</label>
          <select className="input" value={f.action} onChange={(e) => reset({ action: e.target.value })}><option value="">All case actions</option>{actions.map((a) => <option key={a}>{a}</option>)}</select></div>
        <div><label className="label">Actor name</label><input className="input" value={f.actor} onChange={(e) => reset({ actor: e.target.value })} /></div>
        <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" checked={showLogins} onChange={(e) => { setPage(0); setShowLogins(e.target.checked); }} /> Show sign-in events</label>
      </div>
      {!data ? (err ? null : <Spinner />) : (
        <div className="card">
          <AuditTable rows={data.rows} showCase />
          <div className="flex items-center justify-between p-3 text-sm text-muted">
            <span>{data.total} entries{!showLogins && !f.action ? ' (sign-in events hidden)' : ''}</span>
            <div className="flex gap-2">
              <button className="btn btn-ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
              <button className="btn btn-ghost" disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
