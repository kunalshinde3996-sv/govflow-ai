import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { query, one } from '../db/db.js';
import * as engine from '../engine/caseEngine.js';
import { requireAuth, requireRole, isStaff } from '../middleware/auth.js';
import { getActiveConfig } from '../rules/configStore.js';
import { getDocuments, runPipeline, resolveManualReview } from '../services/pipeline.js';
import { decide, overrideCompensation, correctExtractedField } from '../services/officerActions.js';
import { record, listAudit, runAs } from '../audit/auditService.js';
import { buildLetter } from '../services/pdfService.js';
import { UPLOAD_DIR } from '../ocr/ocrService.js';

const r = Router();
r.use(requireAuth);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const ALLOWED = ['image/png', 'image/jpeg', 'application/pdf'];
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(ALLOWED.includes(file.mimetype) ? null : new engine.EngineError('Only PNG, JPEG or PDF files are accepted'), ALLOWED.includes(file.mimetype)),
});

/** Load a case and enforce ownership for citizens. */
async function loadCase(req) {
  const c = await engine.getCase(req.params.id);
  if (!c) throw new engine.EngineError('Case not found', 404);
  if (!isStaff(req.user) && c.applicant_id !== req.user.id) throw new engine.EngineError('Case not found', 404);
  return c;
}
const withPriority = (c) => ({ ...c, priority: engine.priorityOf(c) });

// ----------------------------- list / create -------------------------------
r.get('/', async (req, res) => {
  const { status, scheme, from, to, flagged, q, sort = 'priority' } = req.query;
  let rows = await query('SELECT c.*, u.name AS applicant_name FROM cases c JOIN users u ON u.id=c.applicant_id');
  if (!isStaff(req.user)) rows = rows.filter((c) => c.applicant_id === req.user.id);
  else rows = rows.filter((c) => c.status !== 'DRAFT'); // staff do not see unsubmitted drafts
  if (status) rows = rows.filter((c) => status.split(',').includes(c.status));
  if (scheme) rows = rows.filter((c) => c.scheme_type === scheme);
  if (flagged === 'true') rows = rows.filter((c) => c.needs_manual_review);
  if (from) rows = rows.filter((c) => new Date(c.submitted_at || c.created_at) >= new Date(from));
  if (to) rows = rows.filter((c) => new Date(c.submitted_at || c.created_at) <= new Date(to + 'T23:59:59'));
  if (q) rows = rows.filter((c) => (c.case_number + c.applicant_name + JSON.stringify(c.form_data)).toLowerCase().includes(String(q).toLowerCase()));
  const out = rows.map((c) => {
    const { eligibility, compensation, ...rest } = c;
    return { ...withPriority(rest), eligibility_outcome: eligibility?.outcome || null, final_total: compensation?.final_total ?? null };
  });
  const rank = { high: 0, medium: 1, normal: 2 };
  const active = (s) => (['APPROVED', 'REJECTED', 'DRAFT'].includes(s) ? 1 : 0);
  if (sort === 'age') out.sort((a, b) => b.priority.ageDays - a.priority.ageDays);
  else if (sort === 'newest') out.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  else out.sort((a, b) => active(a.status) - active(b.status) || rank[a.priority.level] - rank[b.priority.level] || b.priority.ageDays - a.priority.ageDays);
  res.json(out);
});

r.post('/', requireRole('citizen'), async (req, res) => {
  const { scheme_type, form_data } = req.body || {};
  const config = await getActiveConfig(scheme_type);
  if (!config || config.status !== 'live') throw new engine.EngineError('This service is not available for applications');
  const c = await engine.createCase({ schemeType: scheme_type, applicantId: req.user.id, formData: form_data, ruleVersion: config._version });
  res.status(201).json(c);
});

// -------------------------------- detail -----------------------------------
r.get('/:id', async (req, res) => {
  const c = await loadCase(req);
  const config = await getActiveConfig(c.scheme_type);
  const docs = await getDocuments(c.id);
  res.json({
    ...withPriority(c),
    documents: docs.map(({ ocr_text, ...d }) => ({ ...d, has_text: !!ocr_text })),
    milestones: await engine.getMilestones(c.id),
    scheme: { name: config.name, form_fields: config.form_fields, required_documents: config.required_documents, workflow: config.workflow, formula: config.compensation?.formula_description, ocr_min: config.ocr?.min_overall_confidence },
  });
});

r.patch('/:id', requireRole('citizen'), async (req, res) => {
  const c = await loadCase(req);
  await engine.updateFormData(c.id, { ...c.form_data, ...(req.body.form_data || {}) });
  res.json(await engine.getCase(c.id));
});

// ------------------------------- documents ---------------------------------
r.post('/:id/documents', requireRole('citizen'), upload.single('file'), async (req, res) => {
  const c = await loadCase(req);
  if (!['DRAFT', 'INFO_REQUESTED'].includes(c.status)) throw new engine.EngineError('Documents can only be added while the application is in draft or more information is requested', 409);
  const config = await getActiveConfig(c.scheme_type);
  const { doc_type } = req.body;
  if (!req.file) throw new engine.EngineError('No file received');
  if (!config.required_documents.some((d) => d.type === doc_type)) throw new engine.EngineError('Unknown document type');
  // Replacing a document keeps the old row (superseded) so history is preserved.
  await query('UPDATE documents SET superseded=true WHERE case_id=$1 AND doc_type=$2 AND superseded=false', [c.id, doc_type]);
  const id = crypto.randomUUID();
  await query(
    'INSERT INTO documents (id, case_id, doc_type, original_name, stored_name, mime, size) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, c.id, doc_type, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size],
  );
  await record({ caseId: c.id, caseNumber: c.case_number, action: 'DOCUMENT_UPLOADED', entity: 'document', entityId: id, after: { doc_type, file: req.file.originalname, size: req.file.size } });
  res.status(201).json(await getDocuments(c.id));
});

r.get('/:id/documents/:docId/file', async (req, res) => {
  const c = await loadCase(req);
  const d = await one('SELECT * FROM documents WHERE id=$1 AND case_id=$2', [req.params.docId, c.id]);
  if (!d) throw new engine.EngineError('Document not found', 404);
  const file = path.join(UPLOAD_DIR, d.stored_name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'File is no longer available' });
  res.type(d.mime || 'application/octet-stream').sendFile(file);
});

// -------------------------------- submit -----------------------------------
r.post('/:id/submit', requireRole('citizen'), async (req, res) => {
  const c = await loadCase(req);
  const config = await getActiveConfig(c.scheme_type);
  const missingFields = config.form_fields.filter((f) => f.required && (c.form_data[f.key] === undefined || c.form_data[f.key] === '')).map((f) => f.label);
  const have = new Set((await getDocuments(c.id)).map((d) => d.doc_type));
  const missingDocs = config.required_documents.filter((d) => !have.has(d.type)).map((d) => d.label);
  if (missingFields.length || missingDocs.length) {
    return res.status(422).json({ error: 'Application is incomplete', missing_fields: missingFields, missing_documents: missingDocs });
  }
  const resubmission = c.status === 'INFO_REQUESTED';
  if (resubmission) await engine.saveCaseFields(c.id, { eligibility: null, compensation: null, needs_manual_review: false, manual_review_reasons: null });
  const s = await engine.transition(c.id, 'SUBMITTED', { note: resubmission ? 'Applicant resubmitted with requested information' : 'Application submitted by applicant', actorName: req.user.name });
  // Run OCR/eligibility in the background so the citizen gets an immediate response and can watch the tracker.
  runAs({ id: null, name: 'System (AI)', role: 'system' }, () => runPipeline(c.id)).catch((e) => console.error('PIPELINE FAILED', c.id, e));
  res.json(s);
});

// ------------------------------- audit / pdf -------------------------------
r.get('/:id/audit', async (req, res) => {
  const c = await loadCase(req);
  res.json((await listAudit({ caseId: c.id, limit: 500 })).rows);
});

r.get('/:id/letter', async (req, res) => {
  const c = await loadCase(req);
  if (!c.compensation) throw new engine.EngineError('No compensation has been calculated for this case yet', 409);
  const config = await getActiveConfig(c.scheme_type);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${c.case_number}-${c.status === 'APPROVED' ? 'approval-letter' : 'compensation-statement'}.pdf"`);
  buildLetter(c, config, res);
});

// ----------------------------- officer actions -----------------------------
const officer = requireRole('officer', 'admin');

r.post('/:id/resolve-review', officer, async (req, res) => {
  const c = await loadCase(req);
  res.json(await resolveManualReview(c.id, { note: req.body.note?.trim() || 'Officer verified documents manually' }));
});

r.post('/:id/decision', officer, async (req, res) => {
  const c = await loadCase(req);
  res.json(await decide(c.id, req.body.action, req.body.reason, req.user));
});

r.post('/:id/override', officer, async (req, res) => {
  const c = await loadCase(req);
  res.json(await overrideCompensation(c.id, req.body.adjustments, req.body.justification, req.user));
});

export const documentRouter = Router();
documentRouter.use(requireAuth, officer);
documentRouter.patch('/:docId/fields', async (req, res) => {
  const { field, value, reason } = req.body || {};
  if (!field) throw new engine.EngineError('field is required');
  await correctExtractedField(req.params.docId, field, value, reason, req.user);
  const d = await one('SELECT * FROM documents WHERE id=$1', [req.params.docId]);
  res.json(d);
});

export default r;
