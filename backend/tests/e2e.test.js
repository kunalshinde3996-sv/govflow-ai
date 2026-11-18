// End-to-end test: boots the real app (in-memory DB, real Tesseract OCR) and walks
// the full citizen -> OCR -> eligibility -> compensation -> officer -> PDF journey,
// plus the manual-review edge case and audit-chain integrity.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.js';
import { shutdownOcr } from '../src/ocr/ocrService.js';

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../seed-assets/docs');
let server, base;
const api = async (method, url, { token, body, form } = {}) => {
  const res = await fetch(base + url, {
    method,
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, data: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
};
const login = async (email) => (await api('POST', '/api/auth/login', { body: { email, password: 'Demo@1234' } })).data.token;
const upload = async (token, caseId, type, file) => {
  const form = new FormData();
  form.append('doc_type', type);
  form.append('file', new Blob([fs.readFileSync(path.join(docs, file))], { type: 'image/png' }), file);
  return api('POST', `/api/cases/${caseId}/documents`, { token, form });
};
async function waitFor(token, id, pred, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const c = (await api('GET', `/api/cases/${id}`, { token })).data;
    if (pred(c)) return c;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('timeout waiting for case state');
}

before(async () => {
  const app = await createApp();
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://localhost:${server.address().port}`;
});
after(async () => { server.close(); await shutdownOcr(); });

test('auth: roles are enforced', async () => {
  const cit = await login('citizen@govflow.demo');
  assert.equal((await api('GET', '/api/analytics', { token: cit })).status, 403);
  assert.equal((await api('GET', '/api/cases')).status, 401);
  assert.equal((await api('POST', '/api/auth/login', { body: { email: 'citizen@govflow.demo', password: 'wrong' } })).status, 401);
});

test('seed: demo story is present and audit chain verifies', async () => {
  const off = await login('officer@govflow.demo');
  const cases = (await api('GET', '/api/cases', { token: off })).data;
  assert.ok(cases.length >= 12);
  assert.ok(cases.filter((c) => c.needs_manual_review).length >= 2, 'manual-review flagged cases');
  assert.ok(cases.some((c) => c.status === 'APPROVED'), 'approved');
  assert.equal(cases[0].needs_manual_review, true, 'flagged cases sorted first in queue');
  const v = (await api('GET', '/api/audit/verify', { token: off })).data;
  assert.equal(v.valid, true);
  assert.ok(v.checked > 100);
});

test('full journey: register -> apply -> OCR -> eligible -> compensation -> approve -> letter', async () => {
  const reg = await api('POST', '/api/auth/register', { body: { name: 'Maria Fernandes', email: 'maria.live@example.in', password: 'Passw0rd!' } });
  assert.equal(reg.status, 201);
  const tok = reg.data.token;
  const c = (await api('POST', '/api/cases', { token: tok, body: { scheme_type: 'land_acquisition', form_data: {
    owner_name: 'Maria Fernandes', survey_number: '113/4', village: 'Pirna', taluka: 'Bardez', land_area: 850, land_classification: 'Agricultural', crop_value: 0, structure_value: 0 } } })).data;
  // Submitting with nothing uploaded must be rejected with a clear list.
  const early = await api('POST', `/api/cases/${c.id}/submit`, { token: tok });
  assert.equal(early.status, 422);
  assert.equal(early.data.missing_documents.length, 4);
  for (const t of ['land_title', 'id_proof', 'survey_extract', 'ownership_papers']) assert.equal((await upload(tok, c.id, t, `maria_${t}.png`)).status, 201);
  assert.equal((await api('POST', `/api/cases/${c.id}/submit`, { token: tok })).status, 200);

  const done = await waitFor(tok, c.id, (x) => x.status === 'OFFICER_REVIEW' || x.needs_manual_review);
  assert.equal(done.needs_manual_review, false, 'clear documents must not be flagged');
  assert.equal(done.eligibility.outcome, 'ELIGIBLE');
  assert.match(done.eligibility.explanation, /^Eligible\. Reasons: \(1\)/);
  assert.equal(done.compensation.calculated_total, 2 * 1850 * 850);
  assert.ok(done.documents.every((d) => d.overall_confidence >= 70));

  const off = await login('officer@govflow.demo');
  // Mandatory justification is enforced.
  assert.equal((await api('POST', `/api/cases/${c.id}/override`, { token: off, body: { adjustments: { land_value: 1 }, justification: 'x' } })).status, 400);
  assert.equal((await api('POST', `/api/cases/${c.id}/decision`, { token: off, body: { action: 'reject', reason: '' } })).status, 400);
  const ok = await api('POST', `/api/cases/${c.id}/decision`, { token: off, body: { action: 'approve', reason: 'Verified against survey records' } });
  assert.equal(ok.data.status, 'APPROVED');

  const pdf = await api('GET', `/api/cases/${c.id}/letter`, { token: tok });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');

  // Citizens cannot see other people's cases.
  const other = (await api('POST', '/api/auth/register', { body: { name: 'Other Person', email: 'other@example.in', password: 'Passw0rd!' } })).data.token;
  assert.equal((await api('GET', `/api/cases/${c.id}`, { token: other })).status, 404);

  // Audit trail captured who/what/why for this case, and the chain still verifies.
  const trail = (await api('GET', `/api/cases/${c.id}/audit`, { token: off })).data;
  const actions = trail.map((a) => a.action);
  for (const a of ['CASE_CREATED', 'DOCUMENT_UPLOADED', 'OCR_EXTRACTION', 'ELIGIBILITY_DECISION', 'COMPENSATION_CALCULATED', 'STATE_CHANGE']) assert.ok(actions.includes(a), a);
  assert.ok(trail.some((a) => a.actor_name === 'Priya Kamat' && a.reason));
  assert.equal((await api('GET', '/api/audit/verify', { token: off })).data.valid, true);
});

test('edge case: blurry document is flagged for manual review, not guessed', async () => {
  const tok = (await api('POST', '/api/auth/register', { body: { name: 'Suresh Gaonkar', email: 'suresh.live@example.in', password: 'Passw0rd!' } })).data.token;
  const c = (await api('POST', '/api/cases', { token: tok, body: { scheme_type: 'land_acquisition', form_data: {
    owner_name: 'Suresh Gaonkar', survey_number: '121/1', village: 'X', taluka: 'Y', land_area: 2200, land_classification: 'Agricultural' } } })).data;
  await upload(tok, c.id, 'land_title', 'ramesh_land_title.png');
  await upload(tok, c.id, 'id_proof', 'ramesh_id_proof.png');
  await upload(tok, c.id, 'survey_extract', 'suresh_survey_extract.png'); // blurry
  await upload(tok, c.id, 'ownership_papers', 'ramesh_ownership_papers.png');
  await api('POST', `/api/cases/${c.id}/submit`, { token: tok });
  const flagged = await waitFor(tok, c.id, (x) => x.needs_manual_review);
  assert.equal(flagged.status, 'DOC_VERIFICATION', 'must stop, not advance');
  assert.equal(flagged.eligibility, null, 'no automated decision was made');
  assert.ok(flagged.manual_review_reasons.some((r) => /blurry|unreadable/i.test(r)));

  // Officer fixes fields (reason mandatory), resolves, pipeline resumes and records the manual verification.
  const off = await login('officer@govflow.demo');
  const doc = flagged.documents.find((d) => d.doc_type === 'survey_extract');
  assert.equal((await api('PATCH', `/api/documents/${doc.id}/fields`, { token: off, body: { field: 'owner_name', value: 'Suresh Gaonkar' } })).status, 400);
  for (const [field, value] of [['owner_name', 'Suresh Gaonkar'], ['survey_number', '121/1'], ['land_area', 2200], ['land_classification', 'Agricultural']]) {
    assert.equal((await api('PATCH', `/api/documents/${doc.id}/fields`, { token: off, body: { field, value, reason: 'Read from original paper document at counter' } })).status, 200);
  }
  await api('POST', `/api/cases/${c.id}/resolve-review`, { token: off, body: { note: 'Original verified in person' } });
  const after = await waitFor(tok, c.id, (x) => x.status === 'OFFICER_REVIEW' || x.status === 'COMPENSATION_CALCULATED');
  assert.equal(after.needs_manual_review, false);
  assert.ok(after.eligibility, 'eligibility now evaluated');
});
