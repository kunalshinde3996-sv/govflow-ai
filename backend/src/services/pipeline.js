/**
 * PIPELINE  (orchestrates engine + OCR + rule engine + audit)
 * ------------------------------------------------------------------
 *   SUBMITTED -> DOC_VERIFICATION (OCR each document)
 *        |-- any doc low-confidence/missing fields -> flag "Manual Review Required", STOP
 *        '-- otherwise -> ELIGIBILITY_CHECK -> COMPENSATION_CALCULATED -> OFFICER_REVIEW
 *
 * The pipeline is the only place that wires the independent modules together;
 * each module (engine, rules, OCR, audit) stays unaware of the others.
 */
import { query, one, j } from '../db/db.js';
import * as engine from '../engine/caseEngine.js';
import { evaluateEligibility, calculateCompensation, getPath } from '../rules/ruleEngine.js';
import { getActiveConfig } from '../rules/configStore.js';
import { processDocument, manualReviewReasons } from '../ocr/ocrService.js';
import { record } from '../audit/auditService.js';

const parseDoc = (d) => d; // jsonb already parsed by driver

export async function getDocuments(caseId, { includeSuperseded = false } = {}) {
  const rows = await query('SELECT * FROM documents WHERE case_id=$1 ORDER BY created_at ASC', [caseId]);
  return includeSuperseded ? rows : rows.filter((d) => !d.superseded).map(parseDoc);
}

/** Live cases (not draft/rejected) in the same scheme that share the duplicate key. */
async function findDuplicates(c, config) {
  const spec = config.duplicate_check;
  if (!spec) return [];
  const ctxOf = (x) => ({ form: x.form_data });
  const mine = spec.keys.map((k) => String(getPath(ctxOf(c), k) ?? '').toLowerCase().replace(/\s/g, ''));
  if (mine.every((v) => !v)) return [];
  const others = await query(`SELECT * FROM cases WHERE scheme_type=$1 AND id<>$2 AND status NOT IN ('DRAFT','REJECTED')`, [c.scheme_type, c.id]);
  return others
    .filter((o) => (spec.scope === 'same_applicant' ? o.applicant_id === c.applicant_id : true))
    .filter((o) => spec.keys.map((k) => String(getPath(ctxOf(o), k) ?? '').toLowerCase().replace(/\s/g, '')).every((v, i) => v === mine[i]))
    .map((o) => o.case_number);
}

/** Build the DB-free context the rule engine evaluates. */
export async function buildContext(c, config, now = new Date()) {
  const docs = await getDocuments(c.id);
  return {
    form: c.form_data,
    documents: docs.map((d) => ({
      doc_type: d.doc_type,
      extracted: d.extracted || {},
      overall_confidence: d.overall_confidence == null ? null : Number(d.overall_confidence),
      verified: !!d.verified_at,
    })),
    duplicates: await findDuplicates(c, config),
    now,
  };
}

/** Entry point after the citizen submits. Safe to call fire-and-forget. */
export async function runPipeline(caseId) {
  let c = await engine.getCase(caseId);
  const config = await getActiveConfig(c.scheme_type);
  if (c.status === 'SUBMITTED') c = await engine.transition(caseId, 'DOC_VERIFICATION', { note: 'Automated document verification started' });

  // 1. OCR every document that has not been processed.
  const docs = await getDocuments(caseId);
  for (const d of docs.filter((x) => x.ocr_status === 'pending')) {
    const r = await processDocument(d, config);
    await query(
      `UPDATE documents SET ocr_status=$1, ocr_text=$2, extracted=$3, overall_confidence=$4, needs_review=$5, review_reasons=$6 WHERE id=$7`,
      [r.ocr_status, r.ocr_text, j(r.extracted), r.overall_confidence, r.needs_review, j(r.review_reasons), d.id],
    );
    await record({
      caseId, caseNumber: c.case_number, action: 'OCR_EXTRACTION', entity: 'document', entityId: d.id,
      after: { doc_type: d.doc_type, status: r.ocr_status, overall_confidence: r.overall_confidence, extracted: r.extracted, needs_review: r.needs_review },
      reason: r.needs_review ? r.review_reasons.join(' | ') : 'Extraction completed with acceptable confidence',
    });
  }

  // 2. Edge case: anything unreadable/low-confidence => flag, do not guess.
  const reasons = manualReviewReasons(await getDocuments(caseId), config);
  if (reasons.length) {
    await engine.saveCaseFields(caseId, { needs_manual_review: true, manual_review_reasons: reasons });
    await record({
      caseId, caseNumber: c.case_number, action: 'MANUAL_REVIEW_FLAGGED', entity: 'case', entityId: caseId,
      before: { needs_manual_review: false }, after: { needs_manual_review: true, reasons },
      reason: 'OCR confidence insufficient for automated processing; routed to an officer instead of guessing.',
    });
    return engine.getCase(caseId);
  }
  return advanceToEligibility(caseId);
}

/** Officer has verified/edited documents: clear the flag and resume. */
export async function resolveManualReview(caseId, { note }) {
  const c = await engine.getCase(caseId);
  if (!c.needs_manual_review) throw new engine.EngineError('Case is not flagged for manual review', 409);
  const docs = await getDocuments(caseId);
  const now = new Date();
  for (const d of docs.filter((x) => x.needs_review && !x.verified_at)) {
    await query('UPDATE documents SET verified_by=$1, verified_at=$2 WHERE id=$3', ['officer', now, d.id]);
  }
  await engine.saveCaseFields(caseId, { needs_manual_review: false });
  await record({
    caseId, caseNumber: c.case_number, action: 'MANUAL_REVIEW_RESOLVED', entity: 'case', entityId: caseId,
    before: { needs_manual_review: true }, after: { needs_manual_review: false }, reason: note,
  });
  return advanceToEligibility(caseId);
}

/** ELIGIBILITY_CHECK -> (COMPENSATION_CALCULATED) -> OFFICER_REVIEW. */
export async function advanceToEligibility(caseId) {
  let c = await engine.getCase(caseId);
  const config = await getActiveConfig(c.scheme_type);
  c = await engine.transition(caseId, 'ELIGIBILITY_CHECK', { note: 'Rule-based eligibility evaluation' });

  const ctx = await buildContext(c, config);
  const elig = evaluateEligibility(config, ctx);
  await engine.saveCaseFields(caseId, { eligibility: elig, rule_config_version: config._version });
  await record({
    caseId, caseNumber: c.case_number, action: 'ELIGIBILITY_DECISION', entity: 'case', entityId: caseId,
    after: { outcome: elig.outcome, recommendation: elig.recommendation, rule_config_version: config._version },
    reason: elig.explanation,
  });

  if (elig.eligible && config.compensation) {
    await engine.transition(caseId, 'COMPENSATION_CALCULATED', { note: 'Compensation computed from rule-set' });
    const comp = calculateCompensation(config, ctx);
    await engine.saveCaseFields(caseId, { compensation: comp });
    await record({
      caseId, caseNumber: c.case_number, action: 'COMPENSATION_CALCULATED', entity: 'case', entityId: caseId,
      after: { total: comp.calculated_total, line_items: comp.line_items }, reason: comp.formula,
    });
  }
  return engine.transition(caseId, 'OFFICER_REVIEW', {
    note: elig.eligible ? 'Ready for officer decision (recommended: approve)' : 'Ready for officer decision (recommended: reject)',
  });
}
