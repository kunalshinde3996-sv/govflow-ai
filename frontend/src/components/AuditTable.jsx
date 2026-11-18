import { Link } from 'react-router-dom';
import { dt, inr, STATUS_LABEL } from '../ui.jsx';

const ROLE_TONE = { system: 'bg-slate-100 text-slate-700', officer: 'bg-indigo-50 text-indigo-800', admin: 'bg-purple-50 text-purple-800', citizen: 'bg-sky-50 text-sky-800' };
const human = (k) => k.replace(/_/g, ' ');
const isMoney = (k) => /total|amount|compensation/i.test(k);
const val = (k, v) => (v == null ? 'none' : typeof v === 'number' && isMoney(k) ? inr(v) : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));

/** Turn an audit entry's before/after into short readable lines, e.g. "Compensation: ₹48,00,000 -> ₹45,20,000". */
export function diffLines(r) {
  const b = r.before || {}, a = r.after || {};
  const out = [];
  switch (r.action) {
    case 'STATE_CHANGE':
      return [`Status: ${STATUS_LABEL[b.status] || b.status} → ${STATUS_LABEL[a.status] || a.status}`];
    case 'COMPENSATION_OVERRIDE':
      out.push(`Compensation: ${inr(b.final_total)} → ${inr(a.final_total)}`);
      (a.changes || []).forEach((c) => out.push(`${c.label}: ${inr(c.from)} → ${inr(c.to)}`));
      return out;
    case 'COMPENSATION_CALCULATED':
      return [`Calculated total: ${inr(a.total)}`, ...(a.line_items || []).map((i) => `${i.label}: ${inr(i.amount)}`)];
    case 'OCR_FIELD_CORRECTED':
      return [`${human(a.field || b.field)}: ${val('', b.value)} (${b.confidence}% confidence) → ${val('', a.value)} (verified by officer)`];
    case 'OCR_EXTRACTION':
      return [`${human(a.doc_type || '')}: ${a.status}, overall confidence ${a.overall_confidence ?? 'n/a'}%${a.needs_review ? ', flagged for manual review' : ''}`];
    case 'MANUAL_REVIEW_FLAGGED':
    case 'MANUAL_REVIEW_RESOLVED':
      return [`Manual review flag: ${val('', b.needs_manual_review)} → ${val('', a.needs_manual_review)}`];
    case 'ELIGIBILITY_DECISION':
      return [`Outcome: ${human(a.outcome || '')}`, `Recommendation: ${(a.recommendation || '').toLowerCase()} (rule-set v${a.rule_config_version})`];
    case 'RULESET_PUBLISHED':
      return [`Rule-set version: ${b.version} → ${a.version}`];
    case 'ASSISTANT_QUERY':
      return [`Mode: ${a.mode === 'ai' ? 'AI' : 'Basic'}; language ${a.language}`, `Question: ${a.question}`, `Answer (preview): ${a.answer_preview}`];
    case 'FORM_UPDATED': {
      const keys = Object.keys({ ...b, ...a }).filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
      return keys.map((k) => `${human(k)}: ${val(k, b[k])} → ${val(k, a[k])}`);
    }
    default: {
      const keys = Object.keys({ ...b, ...a }).filter((k) => ['string', 'number', 'boolean'].includes(typeof (a[k] ?? b[k])));
      return keys.map((k) => (k in b ? `${human(k)}: ${val(k, b[k])} → ${val(k, a[k])}` : `${human(k)}: ${val(k, a[k])}`));
    }
  }
}

/** Read-only audit view: timestamp, actor, action, readable change, reason. Raw JSON is one click away. */
export default function AuditTable({ rows, showCase = false }) {
  if (!rows.length) return <div className="card-b text-muted">No audit entries match.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] min-w-[820px]">
        <thead><tr>
          <th className="th whitespace-nowrap">Timestamp</th><th className="th">Actor</th><th className="th">Action</th>
          {showCase && <th className="th">Case</th>}<th className="th">Change</th><th className="th">Reason</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => {
            const lines = diffLines(r);
            return (
              <tr key={r.id} className="hover:bg-panel">
                <td className="td whitespace-nowrap text-muted">{dt(r.ts)}</td>
                <td className="td whitespace-nowrap">{r.actor_name}<span className={`ml-1.5 text-[11px] px-1.5 py-0.5 rounded ${ROLE_TONE[r.actor_role] || ''}`}>{r.actor_role}</span></td>
                <td className="td whitespace-nowrap font-mono text-xs">{r.action}</td>
                {showCase && <td className="td whitespace-nowrap">{r.case_id ? <Link className="underline text-navy" to={`/case/${r.case_id}`}>{r.case_number || 'open'}</Link> : '-'}</td>}
                <td className="td max-w-sm">
                  {lines.length ? <ul className="space-y-0.5">{lines.slice(0, 6).map((l, i) => <li key={i}>{l}</li>)}{lines.length > 6 && <li className="text-muted">and {lines.length - 6} more</li>}</ul> : <span className="text-muted">-</span>}
                  {(r.before || r.after) && (
                    <details className="mt-1"><summary className="cursor-pointer text-xs text-muted">raw record</summary>
                      <pre className="whitespace-pre-wrap text-[11px] bg-panel border border-line rounded p-2 mt-1 max-h-48 overflow-auto">{JSON.stringify({ before: r.before, after: r.after, hash: r.hash?.slice(0, 16) }, null, 1)}</pre>
                    </details>
                  )}
                </td>
                <td className="td max-w-md">{r.reason || <span className="text-muted">-</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
