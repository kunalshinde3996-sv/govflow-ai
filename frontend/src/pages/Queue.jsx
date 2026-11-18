import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { StatusBadge, FlagBadge, PendingBadge, RecommendationBadge, SCHEME_LABEL, STATUS_LABEL, Spinner, ErrorBox, ago, day, inr } from '../ui.jsx';

const PRIORITY_TONE = { high: 'text-red-800 bg-red-50 border-red-300', medium: 'text-amber-800 bg-amber-50 border-amber-300', normal: 'text-slate-600 bg-slate-50 border-slate-200' };
const EMPTY = { status: '', scheme: '', from: '', to: '', flagged: false, q: '', sort: 'priority' };

/** Officer queue: priority-sorted (flagged, then oldest) with filters. */
export default function Queue() {
  const nav = useNavigate();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState(EMPTY);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const filtered = JSON.stringify(f) !== JSON.stringify(EMPTY);

  useEffect(() => {
    const p = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => v && p.set(k, v));
    api('/cases?' + p).then((r) => { setRows(r); setErr(''); }).catch((e) => setErr(e.message));
  }, [f]);

  const pending = rows?.filter((c) => c.status === 'OFFICER_REVIEW' || c.needs_manual_review).length;
  return (
    <div>
      <div className="mb-3">
        <h1 className="text-xl font-semibold">Case Queue</h1>
        {rows && <div className="text-sm text-muted">{rows.length} cases shown, {pending} awaiting officer action</div>}
      </div>
      <div className="card card-b grid sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <div><label className="label">Search</label><input className="input" placeholder="Case no. or name" value={f.q} onChange={set('q')} /></div>
        <div><label className="label">Status</label>
          <select className="input" value={f.status} onChange={set('status')}><option value="">All</option>{Object.entries(STATUS_LABEL).filter(([k]) => k !== 'DRAFT').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label className="label">Scheme</label>
          <select className="input" value={f.scheme} onChange={set('scheme')}><option value="">All</option>{['land_acquisition', 'disaster_relief'].map((k) => <option key={k} value={k}>{SCHEME_LABEL[k]}</option>)}</select></div>
        <div><label className="label">From</label><input type="date" className="input" value={f.from} onChange={set('from')} /></div>
        <div><label className="label">To</label><input type="date" className="input" value={f.to} onChange={set('to')} /></div>
        <div><label className="label">Sort</label>
          <select className="input" value={f.sort} onChange={set('sort')}><option value="priority">Priority</option><option value="age">Oldest first</option><option value="newest">Newest first</option></select>
          <label className="flex items-center gap-1.5 text-xs mt-1.5"><input type="checkbox" checked={f.flagged} onChange={set('flagged')} /> Flagged only</label></div>
      </div>
      <ErrorBox error={err} />
      {!rows ? (err ? null : <Spinner />) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead><tr><th className="th">Priority</th><th className="th">Case</th><th className="th">Applicant</th><th className="th">Scheme</th><th className="th">Status</th><th className="th">Age</th><th className="th">Recommendation</th><th className="th text-right">Compensation</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-panel cursor-pointer" onClick={() => nav(`/case/${c.id}`)}>
                  <td className="td">{['APPROVED', 'REJECTED'].includes(c.status) ? <span className="text-xs text-muted">Closed</span> : <span className={`text-xs border rounded px-1.5 py-0.5 capitalize ${PRIORITY_TONE[c.priority.level]}`} title={c.priority.reason}>{c.priority.level}</span>}</td>
                  <td className="td whitespace-nowrap"><Link className="text-navy underline font-medium" to={`/case/${c.id}`} onClick={(e) => e.stopPropagation()}>{c.case_number}</Link></td>
                  <td className="td">{c.applicant_name}</td>
                  <td className="td">{SCHEME_LABEL[c.scheme_type]}</td>
                  <td className="td"><div className="flex flex-col gap-1 items-start"><StatusBadge status={c.status} />{c.needs_manual_review && <FlagBadge />}</div></td>
                  <td className="td text-muted whitespace-nowrap">{['APPROVED', 'REJECTED'].includes(c.status) ? day(c.submitted_at) : ago(c.submitted_at || c.created_at)}</td>
                  <td className="td"><RecommendationBadge outcome={c.eligibility_outcome} /></td>
                  <td className="td text-right tabular-nums whitespace-nowrap">{c.final_total != null ? inr(c.final_total) : <PendingBadge />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="p-10 text-center">
              <div className="font-medium">No cases match these filters</div>
              <div className="text-sm text-muted mt-1">Try widening the date range or removing a filter.</div>
              {filtered && <button className="btn btn-ghost mt-3" onClick={() => setF(EMPTY)}>Clear all filters</button>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
