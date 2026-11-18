// Analytics computed from cases + case_milestones. Aggregation is done in JS (not
// SQL) to stay portable across PostgreSQL and the in-memory dev database; the
// data volumes of a district office make this comfortably fast.
import { query } from '../db/db.js';
import { STATUS_LABEL } from '../engine/caseEngine.js';

const PIPELINE_STAGES = ['SUBMITTED', 'DOC_VERIFICATION', 'ELIGIBILITY_CHECK', 'COMPENSATION_CALCULATED', 'OFFICER_REVIEW']; // INFO_REQUESTED is applicant-side waiting, reported separately
const weekStart = (d) => { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); }; // Monday, UTC
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

export async function computeAnalytics({ scheme } = {}) {
  const now = new Date();
  let cases = await query('SELECT * FROM cases');
  if (scheme) cases = cases.filter((c) => c.scheme_type === scheme);
  const ids = new Set(cases.map((c) => c.id));
  const milestones = (await query('SELECT * FROM case_milestones')).filter((m) => ids.has(m.case_id));
  const submitted = cases.filter((c) => c.status !== 'DRAFT');
  const approved = cases.filter((c) => c.status === 'APPROVED');
  const rejected = cases.filter((c) => c.status === 'REJECTED');
  const decided = approved.length + rejected.length;

  // Decision time = submission -> terminal milestone.
  const termAt = Object.fromEntries(milestones.filter((m) => ['APPROVED', 'REJECTED'].includes(m.status)).map((m) => [m.case_id, new Date(m.entered_at)]));
  const durDays = (c) => (termAt[c.id] - new Date(c.submitted_at)) / 86400000;
  const decidedCases = cases.filter((c) => termAt[c.id] && c.submitted_at);

  // Per-stage time (open milestones count their elapsed time: that is where cases are stuck).
  const stageHours = {};
  const heat = {};
  for (const m of milestones) {
    if (!PIPELINE_STAGES.includes(m.status)) continue;
    const hrs = ((m.exited_at ? new Date(m.exited_at) : now) - new Date(m.entered_at)) / 3600000;
    (stageHours[m.status] ||= []).push(hrs);
    const w = weekStart(m.entered_at);
    ((heat[m.status] ||= {})[w] ||= []).push(hrs);
  }

  // Last 8 weeks, oldest first.
  const weeks = Array.from({ length: 8 }, (_, i) => weekStart(new Date(now.getTime() - (7 - i) * 7 * 86400000)));
  const volume = weeks.map((w) => ({ week: w, submitted: submitted.filter((c) => weekStart(c.submitted_at) === w).length }));
  const trend = weeks.map((w) => {
    const ds = decidedCases.filter((c) => weekStart(termAt[c.id]) === w).map(durDays);
    return { week: w, avg_days: ds.length ? Math.round(avg(ds) * 10) / 10 : null, decided: ds.length };
  });

  const buckets = [[0, 2500000, 'Under 25 L'], [2500000, 7500000, '25 - 75 L'], [7500000, 15000000, '75 L - 1.5 Cr'], [15000000, 1e15, 'Above 1.5 Cr']];
  const distribution = buckets.map(([lo, hi, label]) => ({
    bucket: label,
    count: approved.filter((c) => { const t = Number(c.compensation?.final_total || 0); return t >= lo && t < hi; }).length,
  }));

  const stageAvg = PIPELINE_STAGES.map((s) => ({ stage: s, label: STATUS_LABEL[s], avg_hours: Math.round(avg(stageHours[s] || []) * 10) / 10, count: (stageHours[s] || []).length }));
  const slowest = [...stageAvg].filter((s) => s.count).sort((a, b) => b.avg_hours - a.avg_hours)[0];

  return {
    totals: {
      cases: submitted.length,
      active: submitted.filter((c) => !['APPROVED', 'REJECTED'].includes(c.status)).length,
      approved: approved.length,
      rejected: rejected.length,
      flagged: cases.filter((c) => c.needs_manual_review).length,
      approval_rate: decided ? Math.round((approved.length / decided) * 100) : null,
      total_disbursed: approved.reduce((s, c) => s + Number(c.compensation?.final_total || 0), 0),
      avg_decision_days: decidedCases.length ? Math.round(avg(decidedCases.map(durDays)) * 10) / 10 : null,
      overrides: cases.filter((c) => c.compensation?.override).length,
    },
    by_status: Object.entries(cases.reduce((m, c) => ((m[c.status] = (m[c.status] || 0) + 1), m), {})).map(([status, count]) => ({ status, label: STATUS_LABEL[status], count })),
    stage_avg_hours: stageAvg,
    applicant_wait_hours: Math.round(avg(milestones.filter((m) => m.status === 'INFO_REQUESTED').map((m) => ((m.exited_at ? new Date(m.exited_at) : now) - new Date(m.entered_at)) / 3600000)) * 10) / 10,
    bottleneck: slowest ? { stage: slowest.label, avg_hours: slowest.avg_hours } : null,
    volume,
    processing_trend: trend,
    compensation_distribution: distribution,
    heatmap: {
      weeks,
      rows: PIPELINE_STAGES.map((s) => ({ stage: s, label: STATUS_LABEL[s], cells: weeks.map((w) => (heat[s]?.[w] ? Math.round(avg(heat[s][w]) * 10) / 10 : null)) })),
    },
  };
}
