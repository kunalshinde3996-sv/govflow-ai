/**
 * OCR SERVICE  (extraction + confidence scoring + manual-review fallback)
 * ------------------------------------------------------------------
 * Pipeline per document:
 *   1. Obtain text: Tesseract.js for images, text-layer extraction for PDFs.
 *   2. Parse expected fields with config-driven regex patterns.
 *   3. Score confidence per field (mean Tesseract word confidence of the words
 *      that make up the value) and per document.
 *   4. Decide whether a human must look: blurry/short text, missing required
 *      field, low field confidence, low overall confidence, or any engine error.
 *
 * Design rule: this module NEVER guesses and NEVER fails silently. Anything it
 * cannot read with confidence comes back as needs_review=true with explicit
 * reasons, which the pipeline turns into a "Manual Review Required" flag.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = path.resolve(root, '../../uploads');
const CACHE_DIR = path.resolve(root, '../../.tessdata');

let workerPromise = null;
async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      return createWorker('eng', 1, { cachePath: CACHE_DIR });
    })();
    workerPromise.catch(() => { workerPromise = null; }); // allow retry next time
  }
  return workerPromise;
}

/** Flatten Tesseract output across versions (data.words or data.blocks tree). */
function collectWords(data) {
  if (Array.isArray(data.words) && data.words.length) return data.words;
  const out = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) out.push(w);
  return out;
}

async function readText(filePath, mime) {
  if (mime === 'application/pdf') {
    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
    const parsed = await pdfParse(fs.readFileSync(filePath));
    const text = (parsed.text || '').trim();
    // Embedded text layer: characters are exact, so word confidence is high.
    return { text, overall: text ? 96 : 0, words: [], source: 'pdf-text-layer' };
  }
  if (!/^image\//.test(mime || '')) throw new Error(`Unsupported file type: ${mime}`);
  const worker = await getWorker();
  const { data } = await worker.recognize(filePath, {}, { blocks: true });
  return { text: data.text || '', overall: Number(data.confidence) || 0, words: collectWords(data), source: 'tesseract' };
}

// ------------------------------ normalizers --------------------------------
const NORMALIZERS = {
  compact: (v) => v.replace(/\s+/g, '').toUpperCase(),
  area_sqm: (v, m, spec) => {
    const n = parseFloat(String(v).replace(/,/g, ''));
    if (!Number.isFinite(n)) return null;
    const unit = (m[spec.unit_group] || '').toLowerCase();
    return /^h/.test(unit) ? Math.round(n * 10000 * 100) / 100 : n;
  },
  classification: (v, _m, _s, config) => {
    const known = config.ocr.classifications || [];
    const hit = known.find((k) => v.toLowerCase().includes(k.toLowerCase().slice(0, 5)));
    return hit || v.trim();
  },
};

function parseField(text, field, config) {
  const spec = config.ocr.patterns?.[field];
  if (!spec) return null;
  const m = new RegExp(spec.regex, 'im').exec(text);
  if (!m) return null;
  let value = (m[spec.group || 1] || '').replace(/\s+/g, ' ').trim();
  if (spec.normalize && NORMALIZERS[spec.normalize]) value = NORMALIZERS[spec.normalize](value, m, spec, config);
  if (value === null || value === '') return null;
  return { value, matched: m[0] };
}

/** Confidence of a field = mean confidence of the OCR words that spell it. */
function fieldConfidence(value, matched, ocr) {
  if (ocr.source === 'pdf-text-layer') return 96;
  const tokens = new Set(String(matched).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const hits = ocr.words.filter((w) => tokens.has(String(w.text).toLowerCase().replace(/[^a-z0-9]/g, '')));
  if (!hits.length) return Math.round(ocr.overall * 0.7); // text found but cannot be tied to words
  return Math.round(hits.reduce((s, w) => s + (Number(w.confidence) || 0), 0) / hits.length);
}

// -------------------------------- main API ---------------------------------
/**
 * @returns {{ocr_status, ocr_text, extracted, overall_confidence, needs_review, review_reasons}}
 */
export async function processDocument(doc, config) {
  const expected = config.ocr?.document_fields?.[doc.doc_type];
  if (!expected) {
    // Document types with no extractable fields (e.g. damage photographs): nothing to read.
    return { ocr_status: 'skipped', ocr_text: null, extracted: {}, overall_confidence: null, needs_review: false, review_reasons: [] };
  }
  const reasons = [];
  const filePath = path.join(UPLOAD_DIR, doc.stored_name);
  let ocr;
  try {
    ocr = await readText(filePath, doc.mime);
  } catch (err) {
    return {
      ocr_status: 'failed', ocr_text: null, extracted: {}, overall_confidence: 0, needs_review: true,
      review_reasons: [`Could not process document automatically (${err.message}). Manual verification required.`],
    };
  }

  const minOverall = config.ocr.min_overall_confidence ?? 70;
  const minField = config.ocr.min_field_confidence ?? 60;
  const minLen = config.ocr.min_text_length ?? 25;

  if (ocr.text.replace(/\s/g, '').length < minLen) {
    reasons.push('Document appears blurry, blank or unreadable (almost no text recognised).');
  } else if (ocr.overall < 45) {
    reasons.push(`Document image quality is very poor (OCR confidence ${Math.round(ocr.overall)}%).`);
  }

  const extracted = {};
  const confs = [];
  for (const field of expected) {
    const hit = parseField(ocr.text, field, config);
    if (!hit) {
      extracted[field] = { value: null, confidence: 0, source: 'ocr' };
      confs.push(0);
      reasons.push(`Required field "${field}" could not be extracted.`);
      continue;
    }
    const confidence = fieldConfidence(hit.value, hit.matched, ocr);
    extracted[field] = { value: hit.value, confidence, source: 'ocr' };
    confs.push(confidence);
    if (confidence < minField) reasons.push(`Low confidence (${confidence}%) reading "${field}": "${hit.value}".`);
  }

  const overall = Math.round(confs.reduce((a, b) => a + b, 0) / (confs.length || 1));
  if (overall < minOverall && !reasons.some((r) => /Low confidence|blurry|poor/.test(r))) {
    reasons.push(`Overall extraction confidence ${overall}% is below the ${minOverall}% threshold.`);
  }

  return {
    ocr_status: 'done',
    ocr_text: ocr.text,
    extracted,
    overall_confidence: overall,
    needs_review: reasons.length > 0,
    review_reasons: reasons,
  };
}

/** Case-level view: which unresolved documents force a manual review? */
export function manualReviewReasons(docs, config) {
  const out = [];
  const label = Object.fromEntries((config.required_documents || []).map((d) => [d.type, d.label]));
  for (const d of docs) {
    if (d.superseded || d.verified_at || !d.needs_review) continue;
    for (const r of d.review_reasons || []) out.push(`${label[d.doc_type] || d.doc_type}: ${r}`);
  }
  return out;
}

export async function shutdownOcr() {
  if (workerPromise) { try { (await workerPromise).terminate(); } catch { /* ignore */ } }
}
