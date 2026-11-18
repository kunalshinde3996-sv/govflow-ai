/**
 * OFFICER ACTIONS: approve / reject / request info / override / correct OCR.
 * Every action demands a reason (min length enforced) and is audited with
 * before/after values.
 */
import { query, one, j } from '../db/db.js';
import * as engine from '../engine/caseEngine.js';
import { record } from '../audit/auditService.js';
import { round2 } from '../rules/ruleEngine.js';

const MIN_REASON = 10;
function needReason(reason, what) {
  if (!reason || reason.trim().length < MIN_REASON) {
    throw new engine.EngineError(`${what} requires a written justification (at least ${MIN_REASON} characters).`);
  }
  return reason.trim();
}

export async function decide(caseId, action, reason, officer) {
  const c = await engine.getCase(caseId);
  if (c.status !== 'OFFICER_REVIEW') throw new engine.EngineError('Case is not awaiting officer review', 409);
  if (c.needs_manual_review) throw new engine.EngineError('Resolve the manual-review flag before deciding', 409);
  const decision = { action, reason: reason?.trim() || null, officer_id: officer.id, officer_name: officer.name, at: new Date().toISOString() };

  if (action === 'approve') {
    // Approving a case the engine judged ineligible is allowed only with an explicit reason.
    if (c.eligibility && !c.eligibility.eligible) needReason(reason, 'Approving a case the rule engine marked NOT eligible');
    await engine.saveCaseFields(c.id, { decision });
    return engine.transition(caseId, 'APPROVED', { reason: reason || 'Approved as recommended', note: 'Approved', actorName: officer.name });
  }
  if (action === 'reject') {
    needReason(reason, 'Rejection');
    await engine.saveCaseFields(c.id, { decision });
    return engine.transition(caseId, 'REJECTED', { reason, note: 'Rejected', actorName: officer.name });
  }
  if (action === 'request_info') {
    needReason(reason, 'Requesting more information');
    await engine.saveCaseFields(c.id, { decision: { ...decision, pending: true } });
    return engine.transition(caseId, 'INFO_REQUESTED', { reason, note: `Officer request: ${reason}`, actorName: officer.name });
  }
  throw new engine.EngineError('Unknown action');
}

/** Override individual compensation line items. Justification is mandatory and logged. */
export async function overrideCompensation(caseId, adjustments, justification, officer) {
  const c = await engine.getCase(caseId);
  if (c.status !== 'OFFICER_REVIEW') throw new engine.EngineError('Compensation can only be overridden during officer review', 409);
  if (!c.compensation) throw new engine.EngineError('No compensation calculated for this case', 409);
  needReason(justification, 'Overriding compensation');

  const before = JSON.parse(JSON.stringify(c.compensation));
  const comp = JSON.parse(JSON.stringify(c.compensation));
  const changes = [];
  for (const [id, raw] of Object.entries(adjustments || {})) {
    const item = comp.line_items.find((i) => i.id === id);
    const amount = round2(raw);
    if (!item || !Number.isFinite(amount) || amount < 0) throw new engine.EngineError(`Invalid override for "${id}"`);
    if (amount !== item.amount) {
      changes.push({ id, label: item.label, from: item.amount, to: amount });
      item.overridden = true;
      item.original_amount = item.original_amount ?? item.amount;
      item.amount = amount;
    }
  }
  if (!changes.length) throw new engine.EngineError('No line item was changed');
  comp.final_total = round2(comp.line_items.reduce((s, i) => s + i.amount, 0));
  comp.override = { by: officer.name, at: new Date().toISOString(), justification: justification.trim(), changes, original_total: comp.calculated_total, new_total: comp.final_total };
  await engine.saveCaseFields(caseId, { compensation: comp });
  await record({
    caseId, caseNumber: c.case_number, action: 'COMPENSATION_OVERRIDE', entity: 'compensation', entityId: caseId,
    before: { final_total: before.final_total, line_items: before.line_items.map((i) => ({ id: i.id, amount: i.amount })) },
    after: { final_total: comp.final_total, changes }, reason: justification.trim(),
  });
  return engine.getCase(caseId);
}

/** Officer corrects an OCR-extracted field (side-by-side review screen). */
export async function correctExtractedField(docId, field, value, reason, officer) {
  const d = await one('SELECT * FROM documents WHERE id=$1', [docId]);
  if (!d) throw new engine.EngineError('Document not found', 404);
  needReason(reason, 'Correcting an extracted field');
  const extracted = { ...(d.extracted || {}) };
  const prev = extracted[field] || { value: null, confidence: 0 };
  extracted[field] = { value, confidence: 100, source: 'officer', ocr_value: prev.source === 'officer' ? prev.ocr_value : prev.value, ocr_confidence: prev.source === 'officer' ? prev.ocr_confidence : prev.confidence };
  await query('UPDATE documents SET extracted=$1 WHERE id=$2', [j(extracted), docId]);
  const c = await engine.getCase(d.case_id);
  await record({
    caseId: d.case_id, caseNumber: c.case_number, action: 'OCR_FIELD_CORRECTED', entity: 'document', entityId: docId,
    before: { field, value: prev.value, confidence: prev.confidence }, after: { field, value, confidence: 100 }, reason,
  });
}
