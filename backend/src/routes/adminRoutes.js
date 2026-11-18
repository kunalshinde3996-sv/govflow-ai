import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { listActiveConfigs, getActiveConfig, publishConfig } from '../rules/configStore.js';
import { evaluateEligibility, calculateCompensation } from '../rules/ruleEngine.js';
import { listAudit, verifyChain, record } from '../audit/auditService.js';
import { computeAnalytics } from '../services/analytics.js';
import { EngineError } from '../engine/caseEngine.js';
import { query } from '../db/db.js';

const r = Router();
r.use(requireAuth);

// Service catalogue: citizens need form fields + document lists to render the application form.
r.get('/schemes', async (_req, res) => {
  res.json((await listActiveConfigs()).map((c) => ({
    scheme_type: c.scheme_type, name: c.name, status: c.status, department: c.department, description: c.description,
    form_fields: c.form_fields, required_documents: c.required_documents, notification: c.notification, version: c._version,
  })));
});

const staff = requireRole('officer', 'admin');
r.get('/audit', staff, async (req, res) => {
  const { action, actor, case_id, exclude, limit = 100, offset = 0 } = req.query;
  res.json(await listAudit({ action, actor, exclude, caseId: case_id, limit: Number(limit), offset: Number(offset) }));
});
r.get('/audit/verify', staff, async (_req, res) => res.json(await verifyChain()));
r.get('/audit/actions', staff, async (_req, res) => res.json([...new Set((await query('SELECT action FROM audit_logs')).map((a) => a.action))].sort()));

r.get('/analytics', staff, async (req, res) => res.json(await computeAnalytics({ scheme: req.query.scheme })));

// ------------------------------ admin: rule configs ------------------------
const admin = requireRole('admin');
r.get('/admin/modules', admin, async (_req, res) => res.json(await listActiveConfigs()));

r.put('/admin/rules/:scheme', admin, async (req, res) => {
  const { config } = req.body || {};
  const cur = await getActiveConfig(req.params.scheme);
  if (!cur) throw new EngineError('Unknown scheme', 404);
  if (!config || config.scheme_type !== req.params.scheme) throw new EngineError('Config must be a JSON object whose scheme_type matches');
  // Dry-run against an empty context: surfaces unknown rule/item types before publishing.
  try {
    evaluateEligibility(config, { form: {}, documents: [], duplicates: [], now: new Date() });
    calculateCompensation(config, { form: {}, documents: [] });
  } catch (e) { throw new EngineError('Rule-set failed validation: ' + e.message); }
  const version = await publishConfig(req.params.scheme, config, req.user.name);
  await record({ action: 'RULESET_PUBLISHED', entity: 'rule_config', entityId: req.params.scheme, before: { version: cur._version }, after: { version }, reason: req.body.reason || 'Rule-set updated by administrator' });
  res.json({ version });
});

export default r;
