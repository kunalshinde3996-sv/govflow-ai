/**
 * RULE ENGINE  (standalone, pure, unit-testable)
 * ------------------------------------------------------------------
 * Two public functions:
 *   evaluateEligibility(config, ctx)  -> { outcome, eligible, results[], explanation }
 *   calculateCompensation(config, ctx) -> { line_items[], total, ... }
 *
 * All scheme-specific behaviour comes from the JSON `config`; nothing in this
 * file knows about land, floods or any particular scheme. To support a new
 * service, add a config (and, only if truly new logic is needed, register a new
 * rule type below).
 *
 * ctx shape (built by services/context.js, kept DB-free so this is pure):
 *   {
 *     form:        { ...applicant-entered fields },
 *     documents:   [{ doc_type, extracted:{field:{value,confidence}}, overall_confidence, verified }],
 *     duplicates:  [ 'LA-2026-0003', ... ]   // case numbers of matching live cases
 *     now:         Date                       // injected for deterministic tests
 *   }
 */

// ----------------------------- helpers -------------------------------------
/** Resolve "form.survey_number" / "notification.allowed_classifications" etc. */
export function getPath(obj, p) {
  return p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Replace {placeholders} in explanation templates. */
function fill(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined || vars[k] === null ? '?' : vars[k]));
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Normalised Levenshtein similarity in [0,1]; token-order-insensitive for names. */
export function similarity(a, b) {
  const sortTokens = (s) => norm(s).split(' ').sort().join(' ');
  const x = sortTokens(a), y = sortTokens(b);
  if (!x.length && !y.length) return 1;
  if (!x.length || !y.length) return 0;
  const dp = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]);
  for (let j = 1; j <= y.length; j++) dp[0][j] = j;
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
  return 1 - dp[x.length][y.length] / Math.max(x.length, y.length);
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const inr = (n) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** Latest non-superseded value of `field` across documents, with provenance. */
function fieldValues(ctx, field) {
  const out = [];
  for (const d of ctx.documents || []) {
    const f = d.extracted?.[field];
    if (f && f.value !== null && f.value !== undefined && f.value !== '') {
      out.push({ doc_type: d.doc_type, value: f.value, confidence: f.confidence ?? 0 });
    }
  }
  return out;
}

// ------------------------- eligibility rule types --------------------------
// Each handler returns { passed, vars } where vars fill the pass/fail template.
export const RULE_TYPES = {
  /** Every required document type has been supplied. */
  documents_complete(rule, ctx, config) {
    const have = new Set((ctx.documents || []).map((d) => d.doc_type));
    const missing = (config.required_documents || []).filter((d) => !have.has(d.type)).map((d) => d.label);
    return { passed: missing.length === 0, vars: { count: have.size, missing: missing.join(', ') } };
  },

  /** OCR confidence (or manual verification) is acceptable on every document. */
  ocr_confidence(rule, ctx) {
    const docs = (ctx.documents || []).filter((d) => d.overall_confidence != null);
    if (!docs.length) return { passed: false, vars: { avg: 0, low: 'none processed' } };
    // A document an officer verified by hand counts as 100% confidence.
    const eff = docs.map((d) => (d.verified ? 100 : Number(d.overall_confidence)));
    const avg = eff.reduce((a, b) => a + b, 0) / eff.length;
    const low = docs.filter((d, i) => eff[i] < rule.min).map((d) => d.doc_type);
    const manual = docs.filter((d) => d.verified).length;
    return {
      passed: low.length === 0,
      vars: { avg: Math.round(avg), min: rule.min, low: low.join(', '), manual: manual ? ` (${manual} document(s) verified manually by an officer)` : '' },
    };
  },

  /** The same field extracted from different documents must agree with the form. */
  field_consistency(rule, ctx) {
    const formVal = ctx.form?.[rule.field];
    const vals = fieldValues(ctx, rule.field);
    const cmp = rule.fuzzy ? (a, b) => similarity(a, b) >= rule.min_similarity : (a, b) => norm(a).replace(/ /g, '') === norm(b).replace(/ /g, '');
    const mismatches = vals.filter((v) => !cmp(v.value, formVal));
    return {
      passed: vals.length > 0 && mismatches.length === 0,
      vars: {
        value: formVal,
        count: vals.length,
        docs: vals.map((v) => v.doc_type).join(', '),
        mismatches: mismatches.map((m) => `${m.doc_type}: "${m.value}"`).join('; ') || 'no readable value in any document',
      },
    };
  },

  /** A value must be a member of a configured list (e.g. notified classifications). */
  value_in_list(rule, ctx, config) {
    const value = getPath({ form: ctx.form, ...config }, rule.source);
    const list = getPath({ form: ctx.form, ...config }, rule.list) || [];
    const ok = list.some((x) => norm(x) === norm(value));
    return { passed: ok, vars: { value, list: list.join(', ') } };
  },

  numeric_range(rule, ctx) {
    const value = Number(getPath({ form: ctx.form }, rule.source));
    const ok = Number.isFinite(value) && value >= (rule.min ?? -Infinity) && value <= (rule.max ?? Infinity);
    return { passed: ok, vars: { value, min: rule.min, max: rule.max } };
  },

  /** Date in the form must fall within N days before the application date. */
  date_within(rule, ctx) {
    const d = new Date(getPath({ form: ctx.form }, rule.source));
    const now = ctx.now || new Date();
    const days = (now - d) / 86400000;
    const ok = !isNaN(d) && days >= 0 && days <= rule.max_days;
    return { passed: ok, vars: { value: isNaN(d) ? 'invalid date' : d.toISOString().slice(0, 10), days: isNaN(d) ? '?' : Math.floor(days), max: rule.max_days } };
  },

  /** No other live application with the same duplicate key(s). */
  no_duplicate(rule, ctx) {
    const dups = ctx.duplicates || [];
    return { passed: dups.length === 0, vars: { dups: dups.join(', ') } };
  },
};

/** Register an extra rule type at runtime (extension point for new modules). */
export function registerRule(name, handler) {
  RULE_TYPES[name] = handler;
}

// ----------------------------- eligibility ---------------------------------
export function evaluateEligibility(config, ctx) {
  const rules = config.eligibility?.rules || [];
  const results = rules.map((rule) => {
    const handler = RULE_TYPES[rule.type];
    if (!handler) throw new Error(`Unknown rule type "${rule.type}" in rule "${rule.id}"`);
    const { passed, vars } = handler(rule, ctx, config);
    const v = { ...vars, ...(rule.params || {}) };
    return {
      id: rule.id,
      label: rule.label,
      severity: rule.severity || 'blocking', // blocking | advisory
      passed,
      message: fill(passed ? rule.pass : rule.fail, v),
    };
  });

  const failedBlocking = results.filter((r) => !r.passed && r.severity === 'blocking');
  const failedAdvisory = results.filter((r) => !r.passed && r.severity === 'advisory');
  const eligible = failedBlocking.length === 0;
  const outcome = eligible ? (failedAdvisory.length ? 'ELIGIBLE_WITH_FLAGS' : 'ELIGIBLE') : 'NOT_ELIGIBLE';

  // Human-readable explanation trail, stored with the case record.
  const passedList = results.filter((r) => r.passed);
  let explanation;
  if (eligible) {
    explanation = `Eligible. Reasons: ${passedList.map((r, i) => `(${i + 1}) ${r.message}`).join(' ')}`;
    if (failedAdvisory.length) explanation += ` Advisory notes for the reviewing officer: ${failedAdvisory.map((r) => r.message).join(' ')}`;
  } else {
    explanation = `Not eligible. Failed checks: ${failedBlocking.map((r, i) => `(${i + 1}) ${r.message}`).join(' ')}`;
    if (passedList.length) explanation += ` Checks passed: ${passedList.map((r) => r.label).join('; ')}.`;
  }

  return {
    outcome,
    eligible,
    recommendation: eligible ? 'APPROVE' : 'REJECT',
    results,
    explanation,
    evaluated_at: (ctx.now || new Date()).toISOString(),
  };
}

// ----------------------------- compensation --------------------------------
/** Resolve a factor: number literal, "form.x", or "$market_value". */
function resolveFactor(f, scope) {
  if (typeof f === 'number') return f;
  if (f.startsWith('$')) return Number(scope.vars[f.slice(1)]) || 0;
  return Number(getPath(scope.ctx, f)) || 0;
}

function conditionMet(cond, ctx) {
  if (!cond) return true;
  const v = getPath(ctx, cond.field);
  if (cond.equals !== undefined) return norm(v) === norm(cond.equals);
  if (cond.in) return cond.in.some((x) => norm(x) === norm(v));
  if (cond.gt !== undefined) return Number(v) > cond.gt;
  return true;
}

export function calculateCompensation(config, ctx) {
  const spec = config.compensation;
  if (!spec) return null;
  const scope = { ctx, vars: {} };
  const warnings = [];

  // Market-value lookup (rate per unit by a classification key).
  if (spec.market_value_table) {
    const key = getPath(ctx, spec.market_value_table.by);
    const hit = Object.entries(spec.market_value_table.rates).find(([k]) => norm(k) === norm(key));
    scope.vars.market_value = hit ? hit[1] : spec.market_value_table.default ?? 0;
    if (!hit) warnings.push(`No market-value rate configured for "${key}"; default rate used.`);
  }

  const items = [];
  const byId = {};
  for (const li of spec.line_items) {
    if (!conditionMet(li.condition, ctx)) continue;
    let amount = 0, basis = '';
    switch (li.type) {
      case 'product': {
        const factors = li.factors.map((f) => resolveFactor(f, scope));
        amount = factors.reduce((a, b) => a * b, 1) * (li.scale ?? 1);
        basis = li.basis_template ? fill(li.basis_template, { ...scope.vars, ...ctx.form }) : '';
        break;
      }
      case 'percent_of': {
        const base = li.of.reduce((s, id) => s + (byId[id] || 0), 0);
        amount = (base * li.percent) / 100;
        basis = `${li.percent}% of ${inr(round2(base))}`;
        break;
      }
      case 'input':
        amount = Number(getPath(ctx, li.source)) || 0;
        basis = 'As assessed / declared by applicant (subject to verification)';
        break;
      case 'lookup': {
        const key = getPath(ctx, li.key);
        const hit = Object.entries(li.table).find(([k]) => norm(k) === norm(key));
        amount = hit ? hit[1] : 0;
        basis = `Schedule rate for "${key}"`;
        break;
      }
      case 'fixed':
        amount = li.amount;
        basis = 'Fixed statutory amount';
        break;
      default:
        throw new Error(`Unknown compensation item type "${li.type}"`);
    }
    amount = round2(amount);
    if (li.skip_if_zero && amount === 0) continue;
    byId[li.id] = amount;
    items.push({ id: li.id, label: li.label, basis: li.basis || basis, amount });
  }

  const total = round2(items.reduce((s, i) => s + i.amount, 0));
  return {
    formula: spec.formula_description,
    market_value_rate: scope.vars.market_value ?? null,
    line_items: items,
    calculated_total: total,
    final_total: total, // changed only by an officer override
    warnings,
    currency: 'INR',
  };
}
