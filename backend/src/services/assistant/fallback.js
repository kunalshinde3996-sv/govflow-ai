/**
 * Deterministic "Basic mode" answers, built directly from the grounding context.
 * Used when no API key is configured or the LLM call fails/times out, so the demo
 * never breaks. Same data as the LLM sees; no inference, only templates.
 */
const inr = (n) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const date = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'n/a');

export function detectIntent(msg) {
  const m = msg.toLowerCase();
  if (/compensat|amount|calculat|breakdown|how much|payment|solatium|override/.test(m)) return 'compensation';
  if (/document|upload|missing|required|paper/.test(m)) return 'documents';
  if (/flag|reject|why|manual|denied|declin|not eligible|ineligible/.test(m)) return 'why';
  if (/next|what happens|after this|what now|timeline|how long/.test(m)) return 'next';
  if (/where|status|progress|track|stage|update/.test(m)) return 'status';
  return 'unknown';
}

const brief = (arr, n = 2) => arr.slice(0, n).join(' ') + (arr.length > n ? ` (and ${arr.length - n} more detail(s) listed on the case page)` : '');

const NEXT = {
  DRAFT: 'Complete the form, upload all required documents and submit the application.',
  SUBMITTED: 'The system will start reading your documents automatically.',
  DOC_VERIFICATION: 'Your documents are being read. If any is unclear, an officer will verify it manually.',
  ELIGIBILITY_CHECK: 'The eligibility rules are being applied to your verified documents.',
  COMPENSATION_CALCULATED: 'The compensation has been calculated and will go to an officer for review.',
  OFFICER_REVIEW: 'An officer will review the documents, eligibility result and compensation, then approve, reject or ask for more information.',
  INFO_REQUESTED: 'Please provide the information the officer asked for, then resubmit the application.',
  APPROVED: 'Your application is approved. You can download the approval letter from the case page.',
  REJECTED: 'The application was rejected. The reason is recorded on the case; contact the Collectorate office if you wish to discuss it.',
};

function caseAnswer(intent, ctx) {
  const c = ctx.case;
  switch (intent) {
    case 'status': {
      const last = ctx.milestones[ctx.milestones.length - 1];
      return `Case ${c.case_number} (${c.scheme}) is at "${c.status_label}"${last ? `, since ${date(last.entered_at)}` : ''}.${c.needs_manual_review ? ' It is flagged for manual review by an officer.' : ''} ${NEXT[c.status] || ''}`;
    }
    case 'documents': {
      const miss = ctx.documents.required.filter((d) => !d.uploaded).map((d) => d.label);
      const lines = ctx.documents.uploaded.map((d) => `${ctx.documents.required.find((r) => r.type === d.type)?.label || d.type}: ${d.ocr_status === 'pending' ? 'awaiting reading' : d.overall_confidence == null ? 'no reading needed' : `read with ${d.overall_confidence}% confidence`}${d.flagged ? ' (flagged for manual review)' : ''}${d.verified_by_officer ? ' (verified by an officer)' : ''}`);
      return `${miss.length ? `Missing documents: ${miss.join(', ')}.` : 'All required documents have been uploaded.'}${lines.length ? ` Uploaded: ${lines.join('; ')}.` : ''}`;
    }
    case 'why': {
      if (c.needs_manual_review) return `Case ${c.case_number} was flagged for manual review because: ${brief(c.manual_review_reasons)} No automated decision has been made; an officer will check the original documents.`;
      if (c.status === 'REJECTED') return `Case ${c.case_number} was rejected. ${c.decision?.reason ? `Reason recorded by the officer: ${c.decision.reason}` : ''}${ctx.eligibility && !ctx.eligibility.checks.every((k) => k.passed) ? ` Checks that failed: ${ctx.eligibility.checks.filter((k) => !k.passed).map((k) => k.message).join(' ')}` : ''}`;
      if (ctx.eligibility && ctx.eligibility.outcome === 'NOT_ELIGIBLE') return `The eligibility check found this case not eligible. ${ctx.eligibility.checks.filter((k) => !k.passed).map((k) => k.message).join(' ')} An officer makes the final decision.`;
      if (c.status === 'INFO_REQUESTED') return `An officer asked for more information: ${c.decision?.reason || 'see the case page'}.`;
      return `Case ${c.case_number} is not flagged or rejected. It is at "${c.status_label}".${ctx.eligibility ? ` Eligibility result: ${ctx.eligibility.explanation}` : ''}`;
    }
    case 'compensation': {
      const k = ctx.compensation;
      if (!k) return ctx.eligibility && ctx.eligibility.outcome === 'NOT_ELIGIBLE' ? 'No compensation was calculated because the eligibility check was not passed.' : 'Compensation has not been calculated yet. It is calculated after your documents are verified and eligibility is confirmed.';
      return `Formula: ${k.formula} Your breakdown: ${k.line_items.map((i) => `${i.label} ${inr(i.amount)}${i.overridden ? ` (revised by officer from ${inr(i.original_amount)})` : ''}`).join('; ')}. Total: ${inr(k.final_total)}.${k.override ? ` An officer revised the total from ${inr(k.override.original_total)}; justification on record: ${k.override.justification}` : ''}${c.status === 'APPROVED' ? '' : ' This amount is not final until an officer approves the case.'}`;
    }
    case 'next':
      return `${NEXT[c.status] || 'Please check the case page for the latest status.'}`;
    default:
      return null;
  }
}

export function staffAnswer(msg, ctx) {
  const m = msg.toLowerCase();
  const a = ctx.analytics;
  if (/(how many|number of|count|list|which cases).*(manual|flagged)|^(manual|flagged)/.test(m)) return `${ctx.queue.in_manual_review} case(s) are in manual review${ctx.queue.flagged_cases.length ? `: ${ctx.queue.flagged_cases.map((f) => `${f.case_number} (${f.applicant})`).join(', ')}` : ''}.`;
  if (/bottleneck|which stage|slowest|longest stage/.test(m)) return a.bottleneck ? `The bottleneck is ${a.bottleneck.stage}, averaging ${a.bottleneck.avg_hours} hours per case. Stage averages: ${a.stage_avg_hours.filter((s) => s.avg_hours > 0).map((s) => `${s.stage} ${s.avg_hours}h`).join(', ')}.` : 'There is not enough data to identify a bottleneck yet.';
  if (/(how many|number of|count|which|list).*(awaiting|pending|review)|queue/.test(m)) return `${ctx.queue.awaiting_officer_review} case(s) await officer review${ctx.queue.pending_cases.length ? `: ${ctx.queue.pending_cases.map((p) => `${p.case_number} (${p.applicant}${p.recommendation ? `, recommended ${p.recommendation.toLowerCase()}` : ''})`).join(', ')}` : ''}.`;
  if (/approval rate|rejection rate|how many.*(approved|rejected)/.test(m)) return `${a.totals.approved} approved and ${a.totals.rejected} rejected${a.totals.approval_rate != null ? ` (approval rate ${a.totals.approval_rate}%)` : ''}.`;
  if (/disburs|total compensation|paid/.test(m)) return `Total compensation approved so far: ${inr(a.totals.total_disbursed)}.`;
  if (/how many cases|total cases|number of cases/.test(m)) return `${a.totals.cases} cases submitted: ${a.totals.active} active, ${a.totals.approved} approved, ${a.totals.rejected} rejected.`;
  return null;
}

export function summaryBrief(ctx) {
  const c = ctx.case;
  const docs = ctx.documents.uploaded.map((d) => `${ctx.documents.required.find((r) => r.type === d.type)?.label || d.type} ${d.overall_confidence == null ? 'n/a' : d.overall_confidence + '%'}${d.flagged ? ' (flagged)' : ''}${d.verified_by_officer ? ' (officer verified)' : ''}`);
  const missing = ctx.documents.required.filter((d) => !d.uploaded).map((d) => d.label);
  const verify = [];
  if (c.needs_manual_review) verify.push('Resolve the manual-review flag against the original documents.');
  ctx.documents.uploaded.filter((d) => d.overall_confidence != null && d.overall_confidence < 85 && !d.verified_by_officer).forEach((d) => verify.push(`Check the ${d.type.replace(/_/g, ' ')}: OCR confidence ${d.overall_confidence}%.`));
  if (ctx.eligibility) ctx.eligibility.checks.filter((k) => !k.passed).forEach((k) => verify.push(`${k.severity === 'blocking' ? 'Failed' : 'Advisory'}: ${k.message}`));
  if (ctx.compensation?.override) verify.push('Compensation was already overridden; review the recorded justification.');
  if (!verify.length) verify.push('No exceptions found; confirm key fields against the documents as usual.');
  return [
    `Applicant: ${c.applicant_name}. Scheme: ${c.scheme}. Case ${c.case_number}, status ${c.status_label}.`,
    `Documents: ${docs.join('; ') || 'none uploaded'}${missing.length ? `. Missing: ${missing.join(', ')}` : ''}.`,
    ctx.eligibility ? `Eligibility: ${ctx.eligibility.outcome.replace(/_/g, ' ')} (recommend ${ctx.eligibility.recommendation.toLowerCase()}). ${ctx.eligibility.checks.filter((k) => k.passed).length}/${ctx.eligibility.checks.length} checks passed.` : 'Eligibility: not yet evaluated.',
    ctx.compensation ? `Compensation: ${inr(ctx.compensation.final_total)}${ctx.compensation.override ? ` (overridden from ${inr(ctx.compensation.override.original_total)})` : ''}.` : 'Compensation: not calculated.',
    `Open flags: ${c.needs_manual_review ? c.manual_review_reasons.join(' ') : 'none'}.`,
    `Points to verify: ${verify.join(' ')}`,
  ].join('\n');
}

export const UNKNOWN_REPLY = 'I can only answer from this platform’s records, and I could not find that information. For anything else, please contact the Office of the Collector, North Goa District.';

/** Main entry: returns answer text from context (never throws on unknown intent). */
export function fallbackAnswer({ message, task, ctx, staff }) {
  if (task === 'summary') return ctx.case ? summaryBrief(ctx) : 'Open a case to generate a summary.';
  if (staff) {
    const s = staffAnswer(message, ctx);
    if (s) return s;
  }
  if (ctx.case) return caseAnswer(detectIntent(message), ctx) || UNKNOWN_REPLY;
  if (ctx.my_cases) {
    if (!ctx.my_cases.length) return 'You have no applications yet. Choose "New Application" to start one.';
    return `Your applications: ${ctx.my_cases.map((c) => `${c.case_number} is at "${c.status_label}"${c.needs_manual_review ? ' (flagged for manual review)' : ''}`).join('; ')}. Open a case and ask again for details about its documents, eligibility or compensation.`;
  }
  return UNKNOWN_REPLY;
}
