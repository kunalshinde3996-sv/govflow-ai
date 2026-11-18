/**
 * CASE ENGINE  (generic state machine + case CRUD)
 * ------------------------------------------------------------------
 * Scheme-agnostic: the same lifecycle serves land acquisition, disaster relief
 * and any future module. Every transition
 *   - is validated against TRANSITIONS (illegal jumps throw),
 *   - closes the previous milestone and opens the next (timeline + analytics),
 *   - writes an audit record automatically, so no code path can skip auditing.
 */
import crypto from 'node:crypto';
import { query, one, j } from '../db/db.js';
import { record } from '../audit/auditService.js';

export const STATUS = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  DOC_VERIFICATION: 'DOC_VERIFICATION',
  ELIGIBILITY_CHECK: 'ELIGIBILITY_CHECK',
  COMPENSATION_CALCULATED: 'COMPENSATION_CALCULATED',
  OFFICER_REVIEW: 'OFFICER_REVIEW',
  INFO_REQUESTED: 'INFO_REQUESTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
};

export const STATUS_LABEL = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  DOC_VERIFICATION: 'Document Verification',
  ELIGIBILITY_CHECK: 'Eligibility Check',
  COMPENSATION_CALCULATED: 'Compensation Calculated',
  OFFICER_REVIEW: 'Officer Review',
  INFO_REQUESTED: 'More Information Requested',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

/** Legal edges of the case lifecycle. */
export const TRANSITIONS = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['DOC_VERIFICATION'],
  DOC_VERIFICATION: ['ELIGIBILITY_CHECK', 'INFO_REQUESTED', 'REJECTED'],
  ELIGIBILITY_CHECK: ['COMPENSATION_CALCULATED', 'OFFICER_REVIEW'],
  COMPENSATION_CALCULATED: ['OFFICER_REVIEW'],
  OFFICER_REVIEW: ['APPROVED', 'REJECTED', 'INFO_REQUESTED'],
  INFO_REQUESTED: ['SUBMITTED'],
  APPROVED: [],
  REJECTED: [],
};
export const TERMINAL = ['APPROVED', 'REJECTED'];

const PREFIX = { land_acquisition: 'LA', disaster_relief: 'DR', revenue_administration: 'RA', scheme_implementation: 'SI' };

export class EngineError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

// ------------------------------- CRUD --------------------------------------
export async function createCase({ schemeType, applicantId, formData, ruleVersion, now = new Date() }) {
  const id = crypto.randomUUID();
  const year = now.getFullYear();
  const prefix = `${PREFIX[schemeType] || 'GC'}-${year}-`;
  const n = (await query('SELECT case_number FROM cases WHERE scheme_type=$1', [schemeType])).length + 1;
  const caseNumber = prefix + String(n).padStart(4, '0');
  await query(
    `INSERT INTO cases (id, case_number, scheme_type, applicant_id, status, form_data, rule_config_version, created_at, updated_at, status_entered_at)
     VALUES ($1,$2,$3,$4,'DRAFT',$5,$6,$7,$7,$7)`,
    [id, caseNumber, schemeType, applicantId, j(formData || {}), ruleVersion, now],
  );
  await query('INSERT INTO case_milestones (case_id, status, entered_at) VALUES ($1,$2,$3)', [id, 'DRAFT', now]);
  await record({ caseId: id, caseNumber, action: 'CASE_CREATED', after: { status: 'DRAFT', scheme_type: schemeType }, ts: now });
  return getCase(id);
}

export async function getCase(id) {
  return one(
    `SELECT c.*, u.name AS applicant_name, u.email AS applicant_email
       FROM cases c JOIN users u ON u.id = c.applicant_id WHERE c.id=$1`,
    [id],
  );
}

export async function updateFormData(caseId, formData, reason = 'Applicant edited application form') {
  const c = await getCase(caseId);
  if (!['DRAFT', 'INFO_REQUESTED'].includes(c.status)) throw new EngineError('Application can only be edited while in Draft or when more information is requested.', 409);
  await query('UPDATE cases SET form_data=$1, updated_at=now() WHERE id=$2', [j(formData), caseId]);
  await record({ caseId, caseNumber: c.case_number, action: 'FORM_UPDATED', entity: 'case', entityId: caseId, before: c.form_data, after: formData, reason });
}

/** Persist arbitrary case JSON columns (eligibility, compensation, decision...). */
export async function saveCaseFields(caseId, fields) {
  const jsonCols = ['eligibility', 'compensation', 'decision', 'manual_review_reasons', 'form_data'];
  const sets = [], vals = [];
  for (const [k, v] of Object.entries(fields)) {
    vals.push(jsonCols.includes(k) ? j(v) : v);
    sets.push(`${k}=$${vals.length}`);
  }
  vals.push(caseId);
  await query(`UPDATE cases SET ${sets.join(', ')}, updated_at=now() WHERE id=$${vals.length}`, vals);
}

// ------------------------------ state machine ------------------------------
/**
 * Move a case to a new status.
 * @param opts.reason  free text recorded in the audit log ("why")
 * @param opts.note    short text shown on the citizen-facing timeline
 * @param opts.at      override timestamp (seeding only)
 */
export async function transition(caseId, to, { reason, note, actorName, at } = {}) {
  const c = await getCase(caseId);
  if (!c) throw new EngineError('Case not found', 404);
  if (!(TRANSITIONS[c.status] || []).includes(to)) {
    throw new EngineError(`Illegal transition ${c.status} -> ${to}`, 409);
  }
  const now = at || new Date();
  await query('UPDATE case_milestones SET exited_at=$1 WHERE case_id=$2 AND exited_at IS NULL', [now, caseId]);
  await query('INSERT INTO case_milestones (case_id, status, entered_at, actor_name, note) VALUES ($1,$2,$3,$4,$5)', [caseId, to, now, actorName || null, note || null]);
  const submitted = to === 'SUBMITTED' && !c.submitted_at ? now : c.submitted_at;
  await query('UPDATE cases SET status=$1, status_entered_at=$2, updated_at=$2, submitted_at=$3 WHERE id=$4', [to, now, submitted, caseId]);
  await record({
    caseId, caseNumber: c.case_number, action: 'STATE_CHANGE', entity: 'case', entityId: caseId,
    before: { status: c.status }, after: { status: to }, reason: reason || note || null, ts: at,
  });
  return getCase(caseId);
}

export async function getMilestones(caseId) {
  return query('SELECT * FROM case_milestones WHERE case_id=$1 ORDER BY id ASC', [caseId]);
}

/** Queue priority: flagged first, then SLA-breaching age, then oldest. */
export function priorityOf(c, now = new Date()) {
  const ageDays = (now - new Date(c.submitted_at || c.created_at)) / 86400000;
  if (c.needs_manual_review) return { level: 'high', reason: 'Flagged for manual review', ageDays };
  if (ageDays > 14) return { level: 'high', reason: 'Older than 14 days', ageDays };
  if (ageDays > 7) return { level: 'medium', reason: 'Older than 7 days', ageDays };
  return { level: 'normal', reason: '', ageDays };
}
