// Loads/stores versioned rule-sets in the rule_configs table.
// JSON files in ./configs are the seed source; after that the DB is authoritative
// and admins can publish new versions (old versions kept for audit/reproducibility).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { query, one, j } from '../db/db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'configs');

export async function seedRuleConfigs() {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const config = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const exists = await one('SELECT id FROM rule_configs WHERE scheme_type=$1', [config.scheme_type]);
    if (!exists) {
      await query(
        'INSERT INTO rule_configs (id, scheme_type, version, name, config, is_active, created_by) VALUES ($1,$2,1,$3,$4,true,$5)',
        [crypto.randomUUID(), config.scheme_type, config.name, j(config), 'system'],
      );
    }
  }
}

export async function getActiveConfig(schemeType) {
  const r = await one('SELECT * FROM rule_configs WHERE scheme_type=$1 AND is_active=true ORDER BY version DESC LIMIT 1', [schemeType]);
  return r ? { ...r.config, _version: r.version } : null;
}

export async function listActiveConfigs() {
  const rows = await query('SELECT * FROM rule_configs WHERE is_active=true ORDER BY scheme_type');
  return rows.map((r) => ({ ...r.config, _version: r.version }));
}

/** Publish a new version; previous version is retained but deactivated. */
export async function publishConfig(schemeType, config, by) {
  const cur = await one('SELECT version FROM rule_configs WHERE scheme_type=$1 ORDER BY version DESC LIMIT 1', [schemeType]);
  const version = (cur?.version || 0) + 1;
  await query('UPDATE rule_configs SET is_active=false WHERE scheme_type=$1', [schemeType]);
  await query(
    'INSERT INTO rule_configs (id, scheme_type, version, name, config, is_active, created_by) VALUES ($1,$2,$3,$4,$5,true,$6)',
    [crypto.randomUUID(), schemeType, version, config.name, j(config), by],
  );
  return version;
}
