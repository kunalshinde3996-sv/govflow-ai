import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fileUrl } from '../api.js';
import { useAuth } from '../auth.jsx';
import { StatusBadge, FlagBadge, SCHEME_LABEL, Spinner, ErrorBox, inr, dt, day } from '../ui.jsx';
import Timeline from '../components/Timeline.jsx';
import DocReview from '../components/DocReview.jsx';
import AuditTable from '../components/AuditTable.jsx';

const PROCESSING = ['SUBMITTED', 'DOC_VERIFICATION', 'ELIGIBILITY_CHECK', 'COMPENSATION_CALCULATED'];

export default function CaseView() {
  const { id } = useParams();
  const { user } = useAuth();
  const staff = user.role !== 'citizen';
  const [c, setC] = useState(null);
  const [audit, setAudit] = useState([]);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      setC(await api(`/cases/${id}`));
      setAudit(await api(`/cases/${id}/audit`));
    } catch (e) { setErr(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // "Real-time" tracking: poll while the engine is still working on the case (and not parked for manual review).
  useEffect(() => {
    if (!c || c.needs_manual_review || !PROCESSING.includes(c.status)) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [c, load]);

  if (err) return <ErrorBox error={err} />;
  if (!c) return <Spinner />;

  const canReview = staff && c.status === 'OFFICER_REVIEW' && !c.needs_manual_review;
  const canEditDocs = staff && !['APPROVED', 'REJECTED'].includes(c.status);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <Link to={staff ? '/queue' : '/cases'} className="text-xs text-navy underline">Back to {staff ? 'queue' : 'my applications'}</Link>
          <h1 className="text-xl font-semibold mt-1">{c.case_number} <span className="text-muted font-normal text-base">- {SCHEME_LABEL[c.scheme_type]}</span></h1>
          <div className="text-sm text-muted">Applicant: {c.applicant_name} &middot; Submitted {day(c.submitted_at)} &middot; Rule-set v{c.rule_config_version}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={c.status} />{c.needs_manual_review && <FlagBadge />}
          {c.compensation && c.status !== 'APPROVED' && (
            <a className="btn btn-ghost" href={fileUrl(`/cases/${c.id}/letter`)} target="_blank" rel="noreferrer">
              {c.status === 'APPROVED' ? 'Download approval letter (PDF)' : 'Download compensation statement (PDF)'}
            </a>
          )}
        </div>
      </div>

      <Banners c={c} staff={staff} />
      {c.status === 'APPROVED' && c.compensation && (
        <div className="border border-emerald-300 bg-emerald-50 rounded p-3 mb-4 flex items-center justify-between gap-3 flex-wrap text-sm">
          <div><b>Approved.</b> Total compensation {inr(c.compensation.final_total)}. The approval letter includes the full breakdown.</div>
          <a className="btn" href={fileUrl(`/cases/${c.id}/letter`)} target="_blank" rel="noreferrer">Download approval letter (PDF)</a>
        </div>
      )}
      {staff && <OfficerSummary c={c} />}
      <nav className="flex flex-wrap gap-2 mb-4 text-xs" aria-label="Jump to section">
        {[['progress', 'Progress'], ['documents', 'Documents'], ['eligibility', 'Eligibility'], ['compensation', 'Compensation'], ['audit', 'Audit trail']].map(([id, l]) => (
          <a key={id} href={'#' + id} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className="border border-line bg-white rounded-full px-3 py-1 hover:bg-panel">{l}</a>
        ))}
      </nav>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="card">
            <div className="card-h">Application details</div>
            <dl className="card-b grid sm:grid-cols-2 gap-x-6 gap-y-2">
              {c.scheme.form_fields.map((f) => (
                <div key={f.key}><dt className="text-xs text-muted">{f.label}</dt><dd className="font-medium">{c.form_data[f.key] === '' || c.form_data[f.key] == null ? '-' : String(c.form_data[f.key])}</dd></div>
              ))}
            </dl>
          </div>

          <div className="card scroll-mt-4" id="documents">
            <div className="card-h">Document verification <span className="text-xs font-normal text-muted">Minimum accepted confidence: {c.scheme.ocr_min}%</span></div>
            <DocReview c={c} canEdit={canEditDocs} onChanged={load} />
          </div>

          <div id="eligibility" className="scroll-mt-4"><EligibilityCard c={c} /></div>
          <div id="compensation" className="scroll-mt-4"><CompensationCard c={c} canOverride={canReview} onChanged={load} /></div>
        </div>

        <div className="space-y-4">
          <div className="card scroll-mt-4" id="progress"><div className="card-h">Case progress</div><div className="card-b"><Timeline c={c} /></div></div>
          {staff && c.needs_manual_review && <ResolveReview c={c} onDone={load} />}
          {canReview && <DecisionPanel c={c} onDone={load} />}
          {c.decision && !c.decision.pending && (
            <div className="card"><div className="card-h">Decision</div>
              <div className="card-b text-sm space-y-1">
                <div><span className="text-muted">Outcome:</span> <b>{c.decision.action === 'approve' ? 'Approved' : 'Rejected'}</b> by {c.decision.officer_name}, {dt(c.decision.at)}</div>
                {c.decision.reason && <div><span className="text-muted">Reason:</span> {c.decision.reason}</div>}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card mt-4 scroll-mt-4" id="audit">
        <div className="card-h">Audit trail <span className="text-xs font-normal text-muted">Immutable record of every action on this case</span></div>
        <AuditTable rows={audit} />
      </div>
    </div>
  );
}

function Banners({ c, staff }) {
  return (
    <div className="space-y-2 mb-4">
      {c.status === 'INFO_REQUESTED' && (
        <div className="border border-amber-300 bg-amber-50 rounded p-3 text-sm flex items-center justify-between gap-3 flex-wrap">
          <div><b>More information requested.</b> {c.decision?.reason}</div>
          {!staff && <Link to={`/apply/${c.id}`} className="btn">Update and resubmit</Link>}
        </div>
      )}
      {c.needs_manual_review && (
        <div className="border border-amber-400 bg-amber-50 rounded p-3 text-sm">
          <b>Manual review required.</b> {staff ? 'Automatic reading was not reliable enough to decide this case. Verify against the original documents below.' : 'One or more documents could not be read reliably. An officer will verify them manually; no automated decision has been made.'}
          <ul className="list-disc ml-5 mt-1 text-xs">{(c.manual_review_reasons || []).slice(0, 3).map((r, i) => <li key={i}>{r}</li>)}{(c.manual_review_reasons || []).length > 3 && <li>and {c.manual_review_reasons.length - 3} more (see the extracted fields below)</li>}</ul>
        </div>
      )}
      {PROCESSING.includes(c.status) && !c.needs_manual_review && <div className="border border-blue-200 bg-blue-50 rounded p-3 text-sm">Your application is being processed. This page updates automatically.</div>}
    </div>
  );
}

function EligibilityCard({ c }) {
  const e = c.eligibility;
  const tone = !e ? '' : e.outcome === 'NOT_ELIGIBLE' ? 'text-red-800' : 'text-emerald-800';
  return (
    <div className="card">
      <div className="card-h">Eligibility determination {e && <span className={`text-sm font-semibold ${tone}`}>{e.outcome.replace(/_/g, ' ')}</span>}</div>
      {!e ? <div className="card-b text-muted text-sm">Not yet evaluated.</div> : (
        <div className="card-b">
          <p className="text-sm leading-relaxed bg-panel border border-line rounded p-3">{e.explanation}</p>
          <ul className="mt-3 divide-y divide-slate-100">
            {e.results.map((r) => (
              <li key={r.id} className="py-2 flex gap-3 text-sm">
                <span className={`mt-0.5 shrink-0 w-12 text-center text-[11px] font-semibold rounded px-1 py-0.5 h-fit ${r.passed ? 'bg-emerald-50 text-emerald-800' : r.severity === 'blocking' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}>{r.passed ? 'PASS' : r.severity === 'blocking' ? 'FAIL' : 'NOTE'}</span>
                <div><div className="font-medium">{r.label}</div><div className="text-muted">{r.message}</div></div>
              </li>
            ))}
          </ul>
          <div className="text-xs text-muted mt-2">Evaluated {dt(e.evaluated_at)}. Stored with the case record and reproducible from rule-set v{c.rule_config_version}.</div>
        </div>
      )}
    </div>
  );
}

function CompensationCard({ c, canOverride, onChanged }) {
  const comp = c.compensation;
  const [editing, setEditing] = useState(false);
  const [vals, setVals] = useState({});
  const [just, setJust] = useState('');
  const [err, setErr] = useState('');
  if (!comp) {
    return <div className="card"><div className="card-h">Compensation</div><div className="card-b text-sm text-muted">{c.eligibility && !c.eligibility.eligible ? 'No compensation calculated because the case is not eligible.' : 'Not yet calculated.'}</div></div>;
  }
  async function save() {
    setErr('');
    const adjustments = Object.fromEntries(Object.entries(vals).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, Number(v)]));
    try { await api(`/cases/${c.id}/override`, { method: 'POST', body: { adjustments, justification: just } }); setEditing(false); setVals({}); setJust(''); onChanged(); }
    catch (e) { setErr(e.message); }
  }
  return (
    <div className="card">
      <div className="card-h">Compensation breakdown
        {canOverride && !editing && <button className="btn btn-ghost" onClick={() => setEditing(true)}>Override amounts</button>}
      </div>
      <div className="card-b">
        <p className="text-xs text-muted mb-2">{comp.formula}</p>
        <table className="w-full text-sm">
          <thead><tr><th className="th">Component</th><th className="th">Basis</th><th className="th text-right">Amount</th></tr></thead>
          <tbody>
            {comp.line_items.map((i) => (
              <tr key={i.id}>
                <td className="td">{i.label}{i.overridden && <span className="ml-1 text-[11px] border border-amber-400 bg-amber-50 text-amber-900 rounded px-1">Overridden</span>}</td>
                <td className="td text-muted text-xs">{i.basis}{i.overridden && <div>Calculated: {inr(i.original_amount)}</div>}</td>
                <td className="td text-right tabular-nums">
                  {editing ? <input type="number" className="input w-36 text-right" placeholder={String(i.amount)} value={vals[i.id] ?? ''} onChange={(e) => setVals({ ...vals, [i.id]: e.target.value })} /> : inr(i.amount)}
                </td>
              </tr>
            ))}
            <tr><td className="td font-semibold" colSpan={2}>Total compensation</td><td className="td text-right font-semibold tabular-nums">{inr(comp.final_total)}</td></tr>
          </tbody>
        </table>
        {comp.override && (
          <div className="mt-3 text-sm border border-amber-300 bg-amber-50 rounded p-3">
            <b>Officer override</b> by {comp.override.by} on {dt(comp.override.at)}: {inr(comp.override.original_total)} revised to {inr(comp.override.new_total)}.
            <div className="mt-1"><span className="text-muted">Justification:</span> {comp.override.justification}</div>
          </div>
        )}
        {editing && (
          <div className="mt-3 space-y-2">
            <div className="text-xs text-muted">Enter new amounts only for the components you wish to change.</div>
            <textarea className="input" rows={3} placeholder="Justification for override (mandatory, recorded in the audit log)" value={just} onChange={(e) => setJust(e.target.value)} />
            <ErrorBox error={err} />
            <div className="flex gap-2"><button className="btn" onClick={save}>Apply override</button><button className="btn btn-ghost" onClick={() => { setEditing(false); setErr(''); }}>Cancel</button></div>
          </div>
        )}
      </div>
    </div>
  );
}

function ResolveReview({ c, onDone }) {
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setErr('');
    try { await api(`/cases/${c.id}/resolve-review`, { method: 'POST', body: { note } }); onDone(); } catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <div className="card border-amber-400">
      <div className="card-h">Resolve manual review</div>
      <div className="card-b space-y-2 text-sm">
        <p>Compare each flagged document with the extracted fields, correct any value, then confirm. Eligibility and compensation will then run on the verified data.</p>
        <textarea className="input" rows={2} placeholder="Verification note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <ErrorBox error={err} />
        <button className="btn w-full" onClick={go} disabled={busy}>{busy ? 'Processing...' : 'Mark documents verified and continue'}</button>
      </div>
    </div>
  );
}

function DecisionPanel({ c, onDone }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const rec = c.eligibility?.recommendation;
  async function act(action) {
    setErr(''); setBusy(action);
    try { await api(`/cases/${c.id}/decision`, { method: 'POST', body: { action, reason } }); onDone(); } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }
  return (
    <div className="card">
      <div className="card-h">Officer decision</div>
      <div className="card-b space-y-2 text-sm">
        <div>System recommendation: <b className={rec === 'APPROVE' ? 'text-emerald-800' : 'text-red-800'}>{rec === 'APPROVE' ? 'Approve' : 'Reject'}</b></div>
        <textarea className="input" rows={4} placeholder="Reason / remarks. Mandatory for rejection, requesting information, or approving a case the engine marked not eligible." value={reason} onChange={(e) => setReason(e.target.value)} />
        <ErrorBox error={err} />
        <div className="grid grid-cols-1 gap-2">
          <button className="btn" disabled={!!busy} onClick={() => act('approve')}>{busy === 'approve' ? 'Working...' : 'Approve'}</button>
          <button className="btn btn-danger" disabled={!!busy} onClick={() => act('reject')}>Reject</button>
          <button className="btn btn-ghost" disabled={!!busy} onClick={() => act('request_info')}>Request more information</button>
        </div>
      </div>
    </div>
  );
}

/** Officer copilot: one-click brief. Read-only; clearly labelled so it is verified before acting. */
function OfficerSummary({ c }) {
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function go() {
    setBusy(true); setErr('');
    try { setRes(await api('/assistant/chat', { method: 'POST', body: { task: 'summary', caseId: c.id } })); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="card mb-4">
      <div className="card-h">Officer copilot
        <button className="btn btn-ghost" onClick={go} disabled={busy}>{busy ? 'Summarising...' : res ? 'Refresh summary' : 'Summarise this case'}</button>
      </div>
      {(res || err) && (
        <div className="card-b text-sm">
          <ErrorBox error={err} />
          {res && (<>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold border border-amber-400 bg-amber-50 text-amber-900 rounded px-2 py-0.5">AI summary - verify before acting</span>
              {res.mode === 'basic' && <span className="text-xs border border-slate-300 bg-white text-slate-600 rounded px-1.5 py-0.5">Basic mode</span>}
            </div>
            <div className="whitespace-pre-wrap leading-relaxed">{res.answer}</div>
          </>)}
        </div>
      )}
    </div>
  );
}
