import { dt, STATUS_LABEL } from '../ui.jsx';

const STEPS = ['DRAFT', 'SUBMITTED', 'DOC_VERIFICATION', 'ELIGIBILITY_CHECK', 'COMPENSATION_CALCULATED', 'OFFICER_REVIEW'];

/** Milestone tracker: Draft > Submitted > Doc Verification > Eligibility > Compensation > Officer Review > Decision. */
export default function Timeline({ c }) {
  const last = (s) => [...c.milestones].reverse().find((m) => m.status === s);
  const terminal = ['APPROVED', 'REJECTED'].includes(c.status);
  const items = STEPS.map((s) => ({ key: s, label: STATUS_LABEL[s], m: last(s) }));
  items.push({ key: 'FINAL', label: c.status === 'REJECTED' ? 'Rejected' : 'Approved', m: terminal ? last(c.status) : null });

  const rows = items.map((it) => {
    let state = 'pending';
    if (it.key === 'FINAL') state = terminal ? (c.status === 'REJECTED' ? 'rejected' : 'done') : 'pending';
    else if (c.status === it.key) state = 'current';
    else if (it.m) state = 'done';
    const skipped = it.key === 'COMPENSATION_CALCULATED' && !it.m && ['OFFICER_REVIEW', 'APPROVED', 'REJECTED', 'INFO_REQUESTED'].includes(c.status);
    if (skipped) state = 'skipped';
    return { ...it, state };
  });
  if (c.status === 'INFO_REQUESTED') rows.splice(6, 0, { key: 'INFO', label: 'More information requested', m: last('INFO_REQUESTED'), state: 'current' });

  const dot = {
    done: 'bg-navy border-navy', current: 'bg-white border-navy ring-4 ring-blue-100', pending: 'bg-white border-slate-300',
    skipped: 'bg-slate-200 border-slate-300', rejected: 'bg-red-700 border-red-700',
  };
  return (
    <ol className="relative">
      {rows.map((r, i) => (
        <li key={r.key} className="flex gap-3 pb-4 last:pb-0 relative">
          {i < rows.length - 1 && <span className="absolute left-[7px] top-4 bottom-0 w-px bg-slate-300" />}
          <span className={`mt-1 w-[15px] h-[15px] rounded-full border-2 shrink-0 z-10 ${dot[r.state]}`} />
          <div className="min-w-0">
            <div className={`text-sm ${r.state === 'pending' || r.state === 'skipped' ? 'text-muted' : 'font-medium'}`}>
              {r.label}{r.state === 'current' && <span className="ml-2 text-xs text-navy font-semibold">In progress</span>}
              {r.state === 'skipped' && <span className="ml-2 text-xs">Not applicable</span>}
            </div>
            {r.m && r.state !== 'skipped' && <div className="text-xs text-muted">{dt(r.m.entered_at)}{r.m.note ? ` - ${r.m.note}` : ''}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
