import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import { Spinner, ErrorBox, WarningIcon, inr, SCHEME_LABEL } from '../ui.jsx';

// Validated categorical slots 1 and 2 (scripts/validate_palette.js: all checks pass).
const BLUE = '#2a78d6';
const ORANGE = '#eb6834';
const GRID = '#e3e7ec';
const AXIS = { fontSize: 12, fill: '#5b6675' };
const wk = (w) => new Date(w).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });
const crore = (n) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : inr(n));

function Tile({ label, value, sub }) {
  return (
    <div className="card card-b">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
      {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function ChartCard({ title, note, data, columns, children }) {
  const [table, setTable] = useState(false);
  return (
    <div className="card">
      <div className="card-h">
        <span>{title}{note && <span className="block text-xs font-normal text-muted">{note}</span>}</span>
        <button className="text-xs underline text-navy shrink-0" onClick={() => setTable(!table)}>{table ? 'Chart view' : 'Table view'}</button>
      </div>
      <div className="card-b">
        {table ? (
          <table className="w-full text-sm"><thead><tr>{columns.map(([, h]) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>{data.map((r, i) => <tr key={i}>{columns.map(([k, h, fmt]) => <td key={h} className="td tabular-nums">{r[k] == null ? '-' : fmt ? fmt(r[k]) : r[k]}</td>)}</tr>)}</tbody></table>
        ) : <div style={{ height: 240 }}>{children}</div>}
      </div>
    </div>
  );
}

const tip = { contentStyle: { fontSize: 12, borderRadius: 4, border: '1px solid #d9dee5' }, cursor: { fill: 'rgba(31,58,95,0.06)' } };

/** Heatmap: stage x week, value = average hours a case spent in that stage. Single-hue sequential ramp. */
function Heatmap({ h }) {
  const vals = h.rows.flatMap((r) => r.cells).filter((v) => v != null);
  const max = Math.max(1, ...vals);
  const shade = (v) => {
    if (v == null) return { background: '#f5f7fa', color: '#9aa4b1' };
    const t = Math.sqrt(v / max); // perceptual-ish: keeps small values visible
    const L = 0.96 - t * 0.5; // light -> dark
    return { background: `oklch(${L} ${0.02 + t * 0.12} 255)`, color: L < 0.62 ? '#fff' : '#1b2430' };
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-separate" style={{ borderSpacing: 2 }}>
        <thead><tr><th className="text-left font-medium text-muted pr-2">Stage</th>{h.weeks.map((w) => <th key={w} className="font-medium text-muted">{wk(w)}</th>)}</tr></thead>
        <tbody>
          {h.rows.map((r) => (
            <tr key={r.stage}>
              <td className="pr-2 whitespace-nowrap">{r.label}</td>
              {r.cells.map((v, i) => (
                <td key={i} className="text-center rounded h-8 min-w-12 tabular-nums" style={shade(v)} title={v == null ? 'No cases' : `${r.label}, week of ${wk(h.weeks[i])}: ${v} hours average`}>{v == null ? '' : v < 10 ? v.toFixed(1) : Math.round(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-2 mt-2 text-xs text-muted">Fewer hours<span className="h-2 w-28 rounded" style={{ background: 'linear-gradient(90deg, oklch(0.96 0.02 255), oklch(0.46 0.14 255))' }} />More hours (max {Math.round(max)}h)</div>
    </div>
  );
}

export default function Analytics() {
  const [a, setA] = useState(null);
  const [scheme, setScheme] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    const load = () => api('/analytics' + (scheme ? `?scheme=${scheme}` : '')).then((d) => { setA(d); setErr(''); }).catch((e) => setErr(e.message));
    load();
    const t = setInterval(load, 15000); // live refresh
    return () => clearInterval(t);
  }, [scheme]);
  if (!a) return err ? <ErrorBox error={err} /> : <Spinner />;
  const t = a.totals;
  const decided = t.approved + t.rejected;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div><h1 className="text-xl font-semibold">Analytics</h1><p className="text-sm text-muted">Live view; refreshes every 15 seconds.</p></div>
        <div className="w-56"><label className="label">Scheme</label>
          <select className="input" value={scheme} onChange={(e) => setScheme(e.target.value)}><option value="">All schemes</option>{['land_acquisition', 'disaster_relief'].map((k) => <option key={k} value={k}>{SCHEME_LABEL[k]}</option>)}</select></div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Total cases" value={t.cases} sub={`${t.active} active, ${decided} decided`} />
        <Tile label="Approval rate" value={t.approval_rate == null ? '-' : t.approval_rate + '%'} sub={`${t.approved} approved, ${t.rejected} rejected`} />
        <Tile label="Total compensation disbursed" value={crore(t.total_disbursed)} sub={`${t.overrides} officer override(s)`} />
        <Tile label="Average time to decision" value={t.avg_decision_days == null ? '-' : t.avg_decision_days + ' days'} sub={`${t.flagged} case(s) in manual review`} />
      </div>

      {a.bottleneck && (
        <div className="card card-b text-sm flex gap-3 items-start border-l-4 border-l-amber-500 bg-amber-50/60" role="note">
          <WarningIcon className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">Key insight</div>
            <div className="mt-0.5">Cases spend the longest in <b>{a.bottleneck.stage}</b>, averaging <b>{a.bottleneck.avg_hours} hours</b> per case.
              {a.applicant_wait_hours > 0 && <span className="text-muted"> Waiting on applicants for requested information averages {a.applicant_wait_hours} hours (excluded as it is outside departmental control).</span>}</div>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <ChartCard title="Case volume over time" note="Applications submitted per week" data={a.volume} columns={[['week', 'Week of', wk], ['submitted', 'Submitted']]}>
          <ResponsiveContainer><BarChart data={a.volume} margin={{ left: -10, top: 8 }}><CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="week" tickFormatter={wk} tick={AXIS} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} /><Tooltip {...tip} labelFormatter={(w) => 'Week of ' + wk(w)} /><Bar isAnimationActive={false} dataKey="submitted" name="Submitted" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={28} /></BarChart></ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Processing-time trend" note="Average days from submission to decision, by week of decision" data={a.processing_trend} columns={[['week', 'Week of', wk], ['avg_days', 'Avg days'], ['decided', 'Cases decided']]}>
          <ResponsiveContainer><LineChart data={a.processing_trend} margin={{ left: -10, top: 8 }}><CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="week" tickFormatter={wk} tick={AXIS} axisLine={false} tickLine={false} /><YAxis tick={AXIS} axisLine={false} tickLine={false} unit=" d" /><Tooltip {...tip} labelFormatter={(w) => 'Week of ' + wk(w)} formatter={(v) => [v + ' days', 'Average']} /><Line isAnimationActive={false} type="monotone" dataKey="avg_days" stroke={BLUE} strokeWidth={2} dot={{ r: 4, fill: BLUE, stroke: '#fff', strokeWidth: 2 }} connectNulls /></LineChart></ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Average time per stage" note="Hours a case spends in each stage (open cases included)" data={a.stage_avg_hours} columns={[['label', 'Stage'], ['avg_hours', 'Avg hours'], ['count', 'Cases']]}>
          <ResponsiveContainer><BarChart data={a.stage_avg_hours} layout="vertical" margin={{ left: 40, right: 16 }}><CartesianGrid stroke={GRID} horizontal={false} /><XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} unit=" h" /><YAxis type="category" dataKey="label" tick={AXIS} width={140} axisLine={false} tickLine={false} /><Tooltip {...tip} formatter={(v) => [v + ' hours', 'Average']} /><Bar isAnimationActive={false} dataKey="avg_hours" fill={BLUE} radius={[0, 4, 4, 0]} maxBarSize={22} /></BarChart></ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Compensation distribution" note="Approved cases by total compensation (L = lakh, Cr = crore)" data={a.compensation_distribution} columns={[['bucket', 'Range'], ['count', 'Approved cases']]}>
          <ResponsiveContainer><BarChart data={a.compensation_distribution} margin={{ left: -10, top: 8 }}><CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="bucket" tick={AXIS} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} /><Tooltip {...tip} /><Bar isAnimationActive={false} dataKey="count" name="Approved cases" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={40} /></BarChart></ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="card">
        <div className="card-h">Approval versus rejection</div>
        <div className="card-b">
          {decided === 0 ? <div className="text-muted text-sm">No decided cases yet.</div> : (
            <>
              <div className="flex h-7 rounded overflow-hidden gap-0.5" role="img" aria-label={`${t.approved} approved, ${t.rejected} rejected`}>
                {t.approved > 0 && <div style={{ flex: t.approved, background: BLUE }} className="text-white text-xs flex items-center justify-center" title={`Approved: ${t.approved}`}>{t.approved}</div>}
                {t.rejected > 0 && <div style={{ flex: t.rejected, background: ORANGE }} className="text-white text-xs flex items-center justify-center" title={`Rejected: ${t.rejected}`}>{t.rejected}</div>}
              </div>
              <div className="flex gap-4 mt-2 text-xs text-muted">
                <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: BLUE }} />Approved ({t.approved})</span>
                <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: ORANGE }} />Rejected ({t.rejected})</span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-h">Bottleneck heatmap <span className="text-xs font-normal text-muted">Average hours in stage, by week the case entered it</span></div>
        <div className="card-b"><Heatmap h={a.heatmap} /></div>
      </div>
    </div>
  );
}
