// Database access. Uses real PostgreSQL when DATABASE_URL is set (Render/prod),
// otherwise an in-memory pg-mem instance so the project runs with zero setup.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { newDb } from 'pg-mem';

const dir = path.dirname(fileURLToPath(import.meta.url));
let pool;
export let usingRealPostgres = false;

export async function initDb() {
  if (process.env.DATABASE_URL) {
    usingRealPostgres = true;
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false },
    });
  } else {
    const mem = newDb();
    const { Pool } = mem.adapters.createPg();
    pool = new Pool();
  }
  // Strip "--" comments first so a ';' inside a comment cannot split a statement.
  const schema = fs.readFileSync(path.join(dir, 'schema.sql'), 'utf8').replace(/--.*$/gm, '');
  for (const stmt of schema.split(';').map((s) => s.trim()).filter(Boolean)) {
    await pool.query(stmt);
  }
  if (usingRealPostgres) {
    await pool.query(fs.readFileSync(path.join(dir, 'audit_immutable.sql'), 'utf8'));
  }
}

export async function query(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}
export async function one(text, params = []) {
  return (await query(text, params))[0] || null;
}
/** jsonb columns: always write via JSON.stringify so both backends behave alike. */
export const j = (v) => (v === undefined || v === null ? null : JSON.stringify(v));
