/**
 * DEMO DATA SEED
 * Builds 14 cases (12 land acquisition, 2 disaster relief) across every
 * milestone stage so the demo tells a story:
 *   - 2 cases flagged "Manual Review Required" (blurry scan / low-confidence field)
 *   - 1 case where an officer fixed an OCR error and resumed processing
 *   - 1 approved case with an officer compensation override (justification logged)
 *   - 1 duplicate application rejected, 1 case awaiting citizen information
 * Timestamps are backdated and every event goes through the real audit service,
 * so the hash chain verifies exactly as it would for live traffic.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { query, one, j } from './db/db.js';
import * as engine from './engine/caseEngine.js';
import { getActiveConfig } from './rules/configStore.js';
import { evaluateEligibility, calculateCompensation, round2 } from './rules/ruleEngine.js';
import { buildContext } from './services/pipeline.js';
import { record, runAs } from './audit/auditService.js';
import { UPLOAD_DIR } from './ocr/ocrService.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(here, '../seed-assets');
export const DEMO_PASSWORD = 'Demo@1234';
const SYSTEM = { id: null, name: 'System (AI)', role: 'system' };
const H = 3600e3;

const LAND_DOCS = ['land_title', 'id_proof', 'survey_extract', 'ownership_papers'];
const DR_DOCS = ['id_proof', 'residence_proof'];

// Deterministic "realistic" confidence 88-98 per field.
const conf = (s) => 88 + (crypto.createHash('md5').update(s).digest()[0] % 11);

function extractionFor(p, docType, config) {
  const vals = { owner_name: p.name, survey_number: p.survey, land_area: p.area, land_classification: p.cls, id_number: p.aadhaar?.replace(/\s/g, '') };
  const fields = config.ocr.document_fields[docType] || [];
  const extracted = Object.fromEntries(fields.map((f) => [f, { value: vals[f] ?? null, confidence: conf(p.key + docType + f), source: 'ocr' }]));
  const cs = Object.values(extracted).map((f) => f.confidence);
  return { extracted, overall: Math.round(cs.reduce((a, b) => a + b, 0) / cs.length), needs_review: false, reasons: [] };
}

/** Inject the edge cases that should be flagged for manual review. */
function applyFlags(p, docType, ex) {
  if (p.flag === 'blurry_survey' && docType === 'survey_extract') {
    const reasons = ['Document appears blurry, blank or unreadable (almost no text recognised).', ...Object.keys(ex.extracted).map((f) => `Required field "${f}" could not be extracted.`)];
    Object.keys(ex.extracted).forEach((f) => (ex.extracted[f] = { value: null, confidence: 0, source: 'ocr' }));
    return { ...ex, overall: 0, needs_review: true, reasons };
  }
  if (p.flag === 'low_title_survey' && docType === 'land_title') {
    ex.extracted.survey_number = { value: '116/3', confidence: 41, source: 'ocr' };
    return { ...ex, overall: 67, needs_review: true, reasons: ['Low confidence (41%) reading "survey_number": "116/3".'] };
  }
  if (p.manualResolved && docType === 'survey_extract') {
    ex.extracted.land_area = { value: p.area + 10, confidence: 48, source: 'ocr' };
    return { ...ex, overall: 71, needs_review: true, reasons: [`Low confidence (48%) reading "land_area": "${p.area + 10}".`] };
  }
  return ex;
}

export async function seedDemoData() {
  if (await one('SELECT id FROM users LIMIT 1')) return;
  const pw = await bcrypt.hash(DEMO_PASSWORD, 8);
  const mk = async (name, email, role) => {
    const u = { id: crypto.randomUUID(), name, email, role };
    await query('INSERT INTO users (id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,$5)', [u.id, name, email, pw, role]);
    return u;
  };
  await mk('Collector Office Admin', 'admin@govflow.demo', 'admin');
  const officer = await mk('Priya Kamat', 'officer@govflow.demo', 'officer');
  await mk('Rahul Prabhu', 'officer2@govflow.demo', 'officer');
  await mk('Demo Citizen', 'citizen@govflow.demo', 'citizen');

  // Make sample documents available to the uploads directory.
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const docsDir = path.join(ASSETS, 'docs');
  if (fs.existsSync(docsDir)) for (const f of fs.readdirSync(docsDir)) {
    const dest = path.join(UPLOAD_DIR, 'seed_' + f);
    if (fs.existsSync(dest)) continue; // idempotent; also safe when two processes seed at once
    try { fs.copyFileSync(path.join(docsDir, f), dest); } catch { /* another process is writing the same file */ }
  }

  const personas = JSON.parse(fs.readFileSync(path.join(ASSETS, 'personas.json'), 'utf8')).sort((a, b) => b.daysAgo - a.daysAgo);
  const numbers = {};
  const NOW = Date.now();

  for (const p of personas) {
    const config = await getActiveConfig(p.scheme);
    const user = await mk(p.name, `${p.key}@example.in`, 'citizen');
    const cit = { id: user.id, name: user.name, role: 'citizen' };
    const off = { id: officer.id, name: officer.name, role: 'officer' };
    const as = (actor, fn) => runAs(actor, fn);
    let t = new Date(NOW - p.daysAgo * 24 * H);
    const adv = (hours) => (t = new Date(t.getTime() + hours * H));

    const land = p.scheme === 'land_acquisition';
    const submitAt = new Date(t.getTime() + 1.7 * H);
    const form = land
      ? { owner_name: p.name, survey_number: p.survey, village: p.village, taluka: p.taluka, land_area: p.area, land_classification: p.cls, structure_value: p.structure, crop_value: p.crop }
      : { owner_name: p.name, village: p.village, incident_type: p.incident_type, incident_date: new Date(submitAt - p.incident_days_before * 24 * H).toISOString().slice(0, 10), damage_category: p.damage, crop_area_ha: p.crop_ha, crop_loss_percent: p.crop_loss, livelihood_loss: p.livelihood };

    let c = await as(cit, () => engine.createCase({ schemeType: p.scheme, applicantId: user.id, formData: form, ruleVersion: config._version, now: t }));
    numbers[p.key] = c.case_number;
    const id = c.id;
    const docTypes = p.docs && p.docs.length === 0 ? [] : land ? LAND_DOCS : DR_DOCS;

    // Uploaded documents (OCR pending until the pipeline "runs").
    const ocr = {};
    for (const dt of docTypes) {
      const docId = crypto.randomUUID();
      const stored = `seed_${p.key}_${dt}.png`;
      const ex = applyFlags(p, dt, extractionFor(p, dt, config));
      ocr[dt] = { docId, ...ex };
      await query(
        'INSERT INTO documents (id, case_id, doc_type, original_name, stored_name, mime, size, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [docId, id, dt, `${dt}.png`, stored, 'image/png', 48000, adv(0.05)],
      );
      await as(cit, () => record({ caseId: id, caseNumber: c.case_number, action: 'DOCUMENT_UPLOADED', entity: 'document', entityId: docId, after: { doc_type: dt, file: `${dt}.png` }, ts: t }));
    }
    if (p.reach === 'DRAFT') continue;

    await as(cit, () => engine.transition(id, 'SUBMITTED', { at: adv(1.6), note: 'Application submitted by applicant', actorName: p.name }));
    if (p.reach === 'SUBMITTED') continue; // OCR not yet run: shows the "just submitted" state

    await as(SYSTEM, () => engine.transition(id, 'DOC_VERIFICATION', { at: adv(0.02), note: 'Automated document verification started' }));
    const flagged = [];
    for (const dt of docTypes) {
      const o = ocr[dt];
      adv(0.004);
      await query('UPDATE documents SET ocr_status=$1, extracted=$2, overall_confidence=$3, needs_review=$4, review_reasons=$5 WHERE id=$6', ['done', j(o.extracted), o.overall, o.needs_review, j(o.reasons), o.docId]);
      await as(SYSTEM, () => record({
        caseId: id, caseNumber: c.case_number, action: 'OCR_EXTRACTION', entity: 'document', entityId: o.docId, ts: t,
        after: { doc_type: dt, status: 'done', overall_confidence: o.overall, extracted: o.extracted, needs_review: o.needs_review },
        reason: o.needs_review ? o.reasons.join(' | ') : 'Extraction completed with acceptable confidence',
      }));
      if (o.needs_review) flagged.push(...o.reasons.map((r) => `${config.required_documents.find((d) => d.type === dt).label}: ${r}`));
    }

    if (flagged.length) {
      await engine.saveCaseFields(id, { needs_manual_review: true, manual_review_reasons: flagged });
      await as(SYSTEM, () => record({ caseId: id, caseNumber: c.case_number, action: 'MANUAL_REVIEW_FLAGGED', entity: 'case', entityId: id, before: { needs_manual_review: false }, after: { needs_manual_review: true, reasons: flagged }, reason: 'OCR confidence insufficient for automated processing; routed to an officer instead of guessing.', ts: t }));
      if (p.manualResolved) {
        // Officer corrects the misread field, then resumes the pipeline.
        adv(26);
        const sv = ocr.survey_extract;
        const fixed = { ...sv.extracted, land_area: { value: p.area, confidence: 100, source: 'officer', ocr_value: p.area + 10, ocr_confidence: 48 } };
        await query('UPDATE documents SET extracted=$1, verified_by=$2, verified_at=$3 WHERE id=$4', [j(fixed), 'officer', t, sv.docId]);
        await as(off, () => record({ caseId: id, caseNumber: c.case_number, action: 'OCR_FIELD_CORRECTED', entity: 'document', entityId: sv.docId, before: { field: 'land_area', value: p.area + 10, confidence: 48 }, after: { field: 'land_area', value: p.area, confidence: 100 }, reason: 'Compared with the original 7/12 extract: area reads 450 sq m, OCR misread the final digit.', ts: t }));
        await engine.saveCaseFields(id, { needs_manual_review: false });
        await as(off, () => record({ caseId: id, caseNumber: c.case_number, action: 'MANUAL_REVIEW_RESOLVED', entity: 'case', entityId: id, before: { needs_manual_review: true }, after: { needs_manual_review: false }, reason: 'Officer verified low-confidence field against the original document.', ts: t }));
      } else {
        continue; // stays flagged in DOC_VERIFICATION
      }
    }

    // Eligibility + compensation through the real rule engine.
    c = await as(SYSTEM, () => engine.transition(id, 'ELIGIBILITY_CHECK', { at: adv(0.03), note: 'Rule-based eligibility evaluation' }));
    const ctx = await buildContext(c, config, t);
    const elig = evaluateEligibility(config, ctx);
    await engine.saveCaseFields(id, { eligibility: elig });
    await as(SYSTEM, () => record({ caseId: id, caseNumber: c.case_number, action: 'ELIGIBILITY_DECISION', entity: 'case', entityId: id, after: { outcome: elig.outcome, recommendation: elig.recommendation, rule_config_version: config._version }, reason: elig.explanation, ts: t }));
    let comp = null;
    if (elig.eligible && config.compensation) {
      await as(SYSTEM, () => engine.transition(id, 'COMPENSATION_CALCULATED', { at: adv(0.01), note: 'Compensation computed from rule-set' }));
      comp = calculateCompensation(config, ctx);
      await engine.saveCaseFields(id, { compensation: comp });
      await as(SYSTEM, () => record({ caseId: id, caseNumber: c.case_number, action: 'COMPENSATION_CALCULATED', entity: 'case', entityId: id, after: { total: comp.calculated_total, line_items: comp.line_items }, reason: comp.formula, ts: t }));
    }
    await as(SYSTEM, () => engine.transition(id, 'OFFICER_REVIEW', { at: adv(0.01), note: elig.eligible ? 'Ready for officer decision (recommended: approve)' : 'Ready for officer decision (recommended: reject)' }));
    if (p.reach === 'REVIEW') continue;

    // Officer decisions.
    adv(p.reviewHours);
    if (p.override && comp) {
      const before = JSON.parse(JSON.stringify(comp));
      const item = comp.line_items.find((i) => i.id === p.override.item);
      const from = item.amount;
      Object.assign(item, { overridden: true, original_amount: from, amount: p.override.to });
      comp.final_total = round2(comp.line_items.reduce((s, i) => s + i.amount, 0));
      comp.override = { by: off.name, at: t.toISOString(), justification: p.override.justification, changes: [{ id: item.id, label: item.label, from, to: p.override.to }], original_total: comp.calculated_total, new_total: comp.final_total };
      await engine.saveCaseFields(id, { compensation: comp });
      await as(off, () => record({ caseId: id, caseNumber: c.case_number, action: 'COMPENSATION_OVERRIDE', entity: 'compensation', entityId: id, before: { final_total: before.final_total, line_items: before.line_items.map((i) => ({ id: i.id, amount: i.amount })) }, after: { final_total: comp.final_total, changes: comp.override.changes }, reason: p.override.justification, ts: t }));
      adv(0.5);
    }
    const decision = { officer_id: off.id, officer_name: off.name, at: t.toISOString() };
    if (p.reach === 'APPROVED') {
      await engine.saveCaseFields(id, { decision: { ...decision, action: 'approve', reason: p.override ? 'Approved with revised crop valuation' : 'Approved as recommended' } });
      await as(off, () => engine.transition(id, 'APPROVED', { at: t, reason: p.override ? 'Approved with revised crop valuation' : 'Approved as recommended', note: 'Approved', actorName: off.name }));
    } else if (p.reach === 'REJECTED') {
      const reason = p.rejectReason.replace('{dup}', numbers.savita);
      await engine.saveCaseFields(id, { decision: { ...decision, action: 'reject', reason } });
      await as(off, () => engine.transition(id, 'REJECTED', { at: t, reason, note: 'Rejected', actorName: off.name }));
    } else if (p.reach === 'INFO') {
      await engine.saveCaseFields(id, { decision: { ...decision, action: 'request_info', reason: p.infoReason, pending: true } });
      await as(off, () => engine.transition(id, 'INFO_REQUESTED', { at: t, reason: p.infoReason, note: `Officer request: ${p.infoReason}`, actorName: off.name }));
    }
  }
  console.log(`Seeded demo data: ${personas.length} cases. Demo password for all accounts: ${DEMO_PASSWORD}`);
}
