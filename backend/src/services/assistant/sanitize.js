/**
 * Treat all document-derived text as DATA. Values that came from OCR or from an
 * applicant (names, field values) could contain text crafted to look like
 * instructions to the model ("ignore previous instructions ..."). Before anything
 * goes into the prompt context we cap its length, drop control characters and
 * remove lines/phrases that read like instructions or prompt markup.
 */
const INSTRUCTION_PATTERNS = [
  /ignore (all |any |the )?(previous|prior|above|earlier) (instructions?|prompts?|rules?)/i,
  /disregard (all |any |the )?(previous|prior|above|earlier)/i,
  /\b(system|assistant|developer)\s*(prompt|message|instruction)s?\b/i,
  /\byou (are|must|should|will) now\b/i,
  /\b(act as|pretend to be|new instructions?|override (the )?(rules?|policy))\b/i,
  /\b(approve|reject) (this|the) (case|application)\b/i,
  /<\/?\s*(system|assistant|user|context|instructions?)\s*>/i,
  /```/,
];

export function sanitizeText(value, max = 160) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  let t = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (INSTRUCTION_PATTERNS.some((re) => re.test(t))) return '[removed: text resembling instructions]';
  return t.length > max ? t.slice(0, max) + '...' : t;
}

/** Deep-sanitise every string in a structure (used for extracted OCR fields). */
export function sanitizeDeep(v, max = 160) {
  if (typeof v === 'string') return sanitizeText(v, max);
  if (Array.isArray(v)) return v.map((x) => sanitizeDeep(x, max));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sanitizeDeep(x, max)]));
  return v;
}
