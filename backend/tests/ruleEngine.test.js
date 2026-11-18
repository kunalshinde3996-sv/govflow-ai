import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateEligibility, calculateCompensation, similarity } from '../src/rules/ruleEngine.js';

const load = (n) => JSON.parse(fs.readFileSync(new URL(`../src/rules/configs/${n}.json`, import.meta.url)));
const LA = load('land_acquisition');
const DR = load('disaster_relief');

const doc = (doc_type, fields, conf = 92, verified = false) => ({
  doc_type, overall_confidence: conf, verified,
  extracted: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { value: v, confidence: conf }])),
});
const goodCtx = () => ({
  form: { owner_name: 'Ramesh Naik', survey_number: '112/1', land_area: 1200, land_classification: 'Agricultural', structure_value: 0, crop_value: 40000 },
  documents: [
    doc('land_title', { owner_name: 'Ramesh Naik', survey_number: '112/1' }),
    doc('id_proof', { owner_name: 'Ramesh Naik' }),
    doc('survey_extract', { owner_name: 'Ramesh S Naik', survey_number: '112/1' }),
    doc('ownership_papers', { owner_name: 'Ramesh Naik' }),
  ],
  duplicates: [],
  now: new Date('2026-06-01'),
});

test('similarity ignores order/case/punctuation', () => {
  assert.equal(similarity('Naik, Ramesh', 'ramesh naik'), 1);
  assert.ok(similarity('Ramesh Naik', 'Suresh Kamat') < 0.5);
});

test('eligible case yields explanation naming every passed check', () => {
  const r = evaluateEligibility(LA, goodCtx());
  assert.equal(r.outcome, 'ELIGIBLE');
  assert.match(r.explanation, /^Eligible\. Reasons: \(1\)/);
  assert.match(r.explanation, /No duplicate application found/);
  assert.match(r.explanation, /Agricultural.*matches the acquisition notification/);
  assert.equal(r.results.every((x) => x.passed), true);
});

test('missing document -> not eligible with reason', () => {
  const c = goodCtx(); c.documents.pop();
  const r = evaluateEligibility(LA, c);
  assert.equal(r.eligible, false);
  assert.match(r.explanation, /Ownership papers/);
});

test('classification not in notification -> blocking failure', () => {
  const c = goodCtx(); c.form.land_classification = 'Commercial';
  const r = evaluateEligibility(LA, c);
  assert.equal(r.outcome, 'NOT_ELIGIBLE');
  assert.match(r.explanation, /Commercial.*not eligible/);
});

test('owner name mismatch is caught', () => {
  const c = goodCtx(); c.documents[1].extracted.owner_name.value = 'Prakash Dessai';
  const r = evaluateEligibility(LA, c);
  assert.equal(r.results.find((x) => x.id === 'owner_match').passed, false);
});

test('duplicate application blocks eligibility', () => {
  const c = goodCtx(); c.duplicates = ['LA-2026-0003'];
  const r = evaluateEligibility(LA, c);
  assert.match(r.explanation, /LA-2026-0003/);
  assert.equal(r.eligible, false);
});

test('low OCR confidence fails unless officer verified', () => {
  const c = goodCtx(); c.documents[0].overall_confidence = 40;
  assert.equal(evaluateEligibility(LA, c).results.find((x) => x.id === 'ocr_quality').passed, false);
  c.documents[0].verified = true;
  const ok = evaluateEligibility(LA, c).results.find((x) => x.id === 'ocr_quality');
  assert.equal(ok.passed, true);
  assert.match(ok.message, /verified manually/);
});

test('advisory failure keeps eligibility but flags it', () => {
  const c = goodCtx(); c.form.land_area = 900000;
  assert.equal(evaluateEligibility(LA, c).outcome, 'ELIGIBLE_WITH_FLAGS');
});

test('LARR compensation: land value + 100% solatium + additional items', () => {
  const r = calculateCompensation(LA, goodCtx());
  const by = Object.fromEntries(r.line_items.map((i) => [i.id, i.amount]));
  assert.equal(by.land_value, 1850 * 1200);
  assert.equal(by.crops, 40000);
  assert.equal(by.solatium, 1850 * 1200 + 40000);
  assert.equal(r.calculated_total, 2 * (1850 * 1200 + 40000));
  assert.equal(by.rehab, undefined); // residential-only item skipped
});

test('residential land adds resettlement allowance', () => {
  const c = goodCtx(); c.form.land_classification = 'Residential'; c.form.land_area = 100;
  const r = calculateCompensation(LA, c);
  assert.equal(r.line_items.find((i) => i.id === 'rehab').amount, 50000);
});

test('same engine, different config: disaster relief', () => {
  const ctx = {
    form: { owner_name: 'Anita Gaonkar', incident_type: 'Flood', incident_date: '2026-05-10', damage_category: 'Major', crop_area_ha: 2, crop_loss_percent: 50, livelihood_loss: 'Yes' },
    documents: [doc('id_proof', { owner_name: 'Anita Gaonkar' }), doc('residence_proof', { owner_name: 'Anita Gaonkar' })],
    duplicates: [], now: new Date('2026-06-01'),
  };
  assert.equal(evaluateEligibility(DR, ctx).outcome, 'ELIGIBLE');
  const c = calculateCompensation(DR, ctx);
  assert.equal(c.calculated_total, 25000 + 18000 + 10000);
  ctx.form.incident_date = '2026-01-01';
  assert.match(evaluateEligibility(DR, ctx).explanation, /outside the 90-day window/);
});
