// Shared presentational helpers. Palette is deliberately restrained: navy + neutral greys,
// with muted semantic colours reserved for status.
export const inr = (n) => (n == null ? '-' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
export const dt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
export const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
export const ago = (d) => {
  const h = (Date.now() - new Date(d)) / 3600000;
  return h < 1 ? 'under 1 hour' : h < 2 ? '1 hour' : h < 48 ? `${Math.round(h)} hours` : `${Math.round(h / 24)} days`;
};

export const STATUS_LABEL = {
  DRAFT: 'Draft', SUBMITTED: 'Submitted', DOC_VERIFICATION: 'Document Verification', ELIGIBILITY_CHECK: 'Eligibility Check',
  COMPENSATION_CALCULATED: 'Compensation Calculated', OFFICER_REVIEW: 'Officer Review', INFO_REQUESTED: 'More Information Requested',
  APPROVED: 'Approved', REJECTED: 'Rejected',
};
const TONE = {
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-300',
  APPROVED: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  REJECTED: 'bg-red-50 text-red-800 border-red-300',
  INFO_REQUESTED: 'bg-amber-50 text-amber-800 border-amber-300',
  OFFICER_REVIEW: 'bg-indigo-50 text-indigo-800 border-indigo-300',
};
export const StatusBadge = ({ status }) => (
  <span className={`inline-block border rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONE[status] || 'bg-blue-50 text-blue-800 border-blue-200'}`}>{STATUS_LABEL[status] || status}</span>
);
export const FlagBadge = () => (
  <span className="inline-block border rounded px-2 py-0.5 text-xs font-semibold bg-amber-50 text-amber-900 border-amber-400 whitespace-nowrap">Manual Review Required</span>
);
export const SCHEME_LABEL = { land_acquisition: 'Land Acquisition', disaster_relief: 'Disaster Relief', revenue_administration: 'Revenue Administration', scheme_implementation: 'Scheme Implementation' };

export function Confidence({ value }) {
  if (value == null) return <span className="text-muted text-xs">n/a</span>;
  const v = Math.round(value);
  const color = v >= 85 ? 'bg-emerald-600' : v >= 60 ? 'bg-amber-500' : 'bg-red-600';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs tabular-nums" title={`Confidence ${v}%`}>
      <span className="w-14 h-1.5 bg-slate-200 rounded overflow-hidden"><span className={`block h-full ${color}`} style={{ width: v + '%' }} /></span>{v}%
    </span>
  );
}

export const Spinner = () => <div className="p-8 text-center text-muted">Loading...</div>;
export const ErrorBox = ({ error }) => (error ? <div className="border border-red-300 bg-red-50 text-red-800 rounded p-3 text-sm my-2">{error}</div> : null);

export const PendingBadge = () => <span className="inline-block border rounded px-2 py-0.5 text-xs bg-slate-100 text-slate-500 border-slate-200">Pending</span>;
const REC = { ELIGIBLE: ['Eligible', 'bg-emerald-50 text-emerald-800 border-emerald-300'], ELIGIBLE_WITH_FLAGS: ['Eligible, with notes', 'bg-emerald-50 text-emerald-800 border-emerald-300'], NOT_ELIGIBLE: ['Not eligible', 'bg-red-50 text-red-800 border-red-300'] };
export const RecommendationBadge = ({ outcome }) => {
  if (!outcome) return <PendingBadge />;
  const [label, tone] = REC[outcome] || [outcome, ''];
  return <span className={`inline-block border rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ${tone}`}>{label}</span>;
};
export const WarningIcon = (p) => (
  <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" {...p}><path d="M10 2.5 18 16.5H2L10 2.5Z" strokeLinejoin="round" /><path d="M10 8v4M10 14.2v.1" strokeLinecap="round" /></svg>
);
