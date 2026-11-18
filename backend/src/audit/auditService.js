/**
 * AUDIT SERVICE
 * ------------------------------------------------------------------
 * Append-only, hash-chained log of every state change, AI decision and
 * officer override: who, what, when, why, and before/after values.
 *
 * Integrity layers
 *   1. API: this module exposes record() and read functions only; there is no
 *      update/delete code path anywhere in the application.
 *   2. Database: on real PostgreSQL a trigger rejects UPDATE/DELETE
 *      (db/audit_immutable.sql).
 *   3. Tamper evidence: each row stores hash = SHA-256(prev_hash || canonical
 *      row content). verifyChain() recomputes the chain; any edited, removed or
 *      reordered row breaks every subsequent hash.
 *
 * Actor resolution: HTTP requests run inside an AsyncLocalStorage context
 * (auditContext middleware). Deep services (engine, OCR, pipeline) therefore
 * never need the actor passed down; if none is set the actor is "System (AI)".
 */
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { query, one, j } from '../db/db.js';

const als = new AsyncLocalStorage();

/** Express middleware: opens a per-request context that auth later fills in. */
export function auditContext(req, _res, next) {
  als.run({ actor: null, ip: req.ip }, next);
}
export function setAuditActor(user) {
  const store = als.getStore();
  if (store) store.actor = user;
}
/** Run a function as a given actor (used by background pipeline & seeding). */
export function runAs(actor, fn) {
  return als.run({ actor }, fn);
}
const SYSTEM = { id: null, name: 'System (AI)', role: 'system' };
const currentActor = () => als.getStore()?.actor || SYSTEM;

/** Key-sorted JSON so hashes survive jsonb key re-ordering in PostgreSQL. */
function canon(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const payload = (r) =>
  canon([new Date(r.ts).toISOString(), r.case_id || null, r.actor_id || null, r.actor_name, r.actor_role, r.action, r.entity || null, r.entity_id || null, r.before ?? null, r.after ?? null, r.reason || null]);

// Writes are serialised so the hash chain order is deterministic.
let chain = Promise.resolve();

/**
 * Record an audit event.
 * @param {{caseId?, caseNumber?, action:string, entity?, entityId?, before?, after?, reason?, actor?, ts?:Date}} e
 */
export function record(e) {
  const run = chain.then(async () => {
    const a = e.actor || currentActor();
    const row = {
      ts: e.ts || new Date(),
      case_id: e.caseId || null,
      actor_id: a.id ? String(a.id) : null,
      actor_name: a.name,
      actor_role: a.role,
      action: e.action,
      entity: e.entity || 'case',
      entity_id: e.entityId ? String(e.entityId) : null,
      before: e.before ?? null,
      after: e.after ?? null,
      reason: e.reason || null,
    };
    const last = await one('SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1');
    const prev = last?.hash || 'GENESIS';
    const hash = sha(prev + payload(row));
    await query(
      `INSERT INTO audit_logs (ts, case_id, case_number, actor_id, actor_name, actor_role, action, entity, entity_id, before, after, reason, prev_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [row.ts, row.case_id, e.caseNumber || null, row.actor_id, row.actor_name, row.actor_role, row.action, row.entity, row.entity_id, j(row.before), j(row.after), row.reason, prev, hash],
    );
  });
  chain = run.catch((err) => console.error('AUDIT WRITE FAILED', err));
  return run;
}

export async function listAudit({ caseId, action, actor, exclude, limit = 200, offset = 0 } = {}) {
  let rows = await query('SELECT * FROM audit_logs');
  rows.sort((x, y) => new Date(y.ts) - new Date(x.ts) || y.id - x.id); // newest first by event time
  if (caseId) rows = rows.filter((r) => r.case_id === caseId);
  if (action) rows = rows.filter((r) => r.action === action);
  if (exclude) rows = rows.filter((r) => !exclude.split(',').includes(r.action));
  if (actor) rows = rows.filter((r) => r.actor_name.toLowerCase().includes(actor.toLowerCase()));
  return { total: rows.length, rows: rows.slice(offset, offset + limit) };
}

/** Recompute the whole chain; returns the first broken row id if tampered. */
export async function verifyChain() {
  const rows = await query('SELECT * FROM audit_logs ORDER BY id ASC');
  let prev = 'GENESIS';
  for (const r of rows) {
    if (r.prev_hash !== prev || sha(prev + payload(r)) !== r.hash) {
      return { valid: false, checked: rows.length, broken_at: r.id };
    }
    prev = r.hash;
  }
  return { valid: true, checked: rows.length, head: prev };
}
