/**
 * Grounding context builder. READ-ONLY: nothing here (or anywhere in the assistant
 * module) writes to case data. Access control is enforced here, on the server:
 * a citizen can only ever receive context about cases they own.
 */
import { query } from '../../db/db.js';
import * as engine from '../../engine/caseEngine.js';
import { getActiveConfig } from '../../rules/configStore.js';
import { getDocuments } from '../pipeline.js';
import { computeAnalytics } from '../analytics.js';
import { sanitizeDeep, sanitizeText } from './sanitize.js';

export class AssistantError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}
export const isStaff = (u) => u.role === 'officer' || u.role === 'admin';

/** Load a case the user is allowed to see, or throw 403/404. */
export async function authorisedCase(user, caseId) {
  const c = await engine.getCase(caseId);
  if (!c) throw new AssistantError('Case not found', 404);
  if (!isStaff(user) && c.applicant_id !== user.id) throw new AssistantError('You do not have access to this case', 403);
  return c;
}

/** Everything the model may know about one case. */
export async function buildCaseContext(c) {
  const config = await getActiveConfig(c.scheme_type);
  const docs = await getDocuments(c.id);
  const milestones = await engine.getMilestones(c.id);
  const have = new Set(docs.map((d) => d.doc_type));
  return {
    case: {
      case_number: c.case_number,
      scheme: config.name,
      status: c.status,
      status_label: engine.STATUS_LABEL[c.status],
      needs_manual_review: c.needs_manual_review,
      manual_review_reasons: sanitizeDeep(c.manual_review_reasons || []),
      submitted_at: c.submitted_at,
      applicant_name: sanitizeText(c.applicant_name),
      form_data: sanitizeDeep(c.form_data),
      decision: c.decision ? { action: c.decision.action, reason: sanitizeText(c.decision.reason, 400), officer: c.decision.officer_name, at: c.decision.at, pending_info_request: !!c.decision.pending } : null,
    },
    milestones: milestones.map((m) => ({ stage: engine.STATUS_LABEL[m.status], entered_at: m.entered_at, note: sanitizeText(m.note) })),
    documents: {
      required: (config.required_documents || []).map((d) => ({ type: d.type, label: d.label, uploaded: have.has(d.type) })),
      uploaded: docs.map((d) => ({
        type: d.doc_type, ocr_status: d.ocr_status, overall_confidence: d.overall_confidence == null ? null : Number(d.overall_confidence),
        flagged: d.needs_review && !d.verified_at, verified_by_officer: !!d.verified_at, review_reasons: sanitizeDeep(d.review_reasons || []),
        // Extracted values originate from OCR: sanitised and treated purely as data.
        extracted: Object.fromEntries(Object.entries(d.extracted || {}).map(([k, f]) => [k, { value: sanitizeDeep(f.value), confidence: f.confidence, corrected_by_officer: f.source === 'officer' }])),
      })),
    },
    eligibility: c.eligibility ? {
      outcome: c.eligibility.outcome, recommendation: c.eligibility.recommendation, explanation: c.eligibility.explanation,
      checks: c.eligibility.results.map((r) => ({ label: r.label, passed: r.passed, severity: r.severity, message: r.message })),
    } : null,
    compensation: c.compensation ? {
      formula: c.compensation.formula, line_items: c.compensation.line_items.map((i) => ({ label: i.label, basis: i.basis, amount: i.amount, overridden: !!i.overridden, original_amount: i.original_amount })),
      calculated_total: c.compensation.calculated_total, final_total: c.compensation.final_total,
      override: c.compensation.override ? { by: c.compensation.override.by, justification: sanitizeText(c.compensation.override.justification, 400), original_total: c.compensation.override.original_total, new_total: c.compensation.override.new_total } : null,
    } : null,
    rule_set: {
      version: c.rule_config_version, required_documents: (config.required_documents || []).map((d) => d.label),
      eligibility_rules: (config.eligibility?.rules || []).map((r) => ({ label: r.label, severity: r.severity })),
      compensation_formula: config.compensation?.formula_description || null,
      ocr_min_confidence: config.ocr?.min_overall_confidence,
    },
  };
}

/** A citizen with no case selected: only their own applications, briefly. */
export async function buildCitizenOverview(user) {
  const rows = (await query('SELECT * FROM cases WHERE applicant_id=$1', [user.id])).filter((c) => c.status !== undefined);
  return {
    my_cases: rows.map((c) => ({ case_number: c.case_number, scheme_type: c.scheme_type, status_label: engine.STATUS_LABEL[c.status], needs_manual_review: c.needs_manual_review })),
    note: 'Open a case page to ask about its documents, eligibility or compensation.',
  };
}

/** Queue + analytics for officers/admins (numbers computed by the backend, never by the model). */
export async function buildStaffContext() {
  const a = await computeAnalytics({});
  const cases = (await query('SELECT c.*, u.name AS applicant_name FROM cases c JOIN users u ON u.id=c.applicant_id')).filter((c) => c.status !== 'DRAFT');
  return {
    analytics: { totals: a.totals, bottleneck: a.bottleneck, stage_avg_hours: a.stage_avg_hours.map((s) => ({ stage: s.label, avg_hours: s.avg_hours })), by_status: a.by_status.map((s) => ({ status: s.label, count: s.count })), applicant_wait_hours: a.applicant_wait_hours },
    queue: {
      awaiting_officer_review: cases.filter((c) => c.status === 'OFFICER_REVIEW' && !c.needs_manual_review).length,
      in_manual_review: cases.filter((c) => c.needs_manual_review).length,
      flagged_cases: cases.filter((c) => c.needs_manual_review).map((c) => ({ case_number: c.case_number, applicant: sanitizeText(c.applicant_name), status: engine.STATUS_LABEL[c.status] })),
      pending_cases: cases.filter((c) => c.status === 'OFFICER_REVIEW').map((c) => ({ case_number: c.case_number, applicant: sanitizeText(c.applicant_name), recommendation: c.eligibility?.recommendation || null })).slice(0, 20),
    },
  };
}
