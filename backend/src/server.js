import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initDb, usingRealPostgres } from './db/db.js';
import { seedRuleConfigs } from './rules/configStore.js';
import { auditContext } from './audit/auditService.js';
import { EngineError } from './engine/caseEngine.js';
import authRoutes from './routes/authRoutes.js';
import caseRoutes, { documentRouter } from './routes/caseRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import assistantRoutes from './routes/assistantRoutes.js';
import { seedDemoData } from './seed.js';

export async function createApp() {
  await initDb();
  await seedRuleConfigs();
  if (process.env.SEED_DEMO !== 'false') await seedDemoData();

  const app = express();
  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(auditContext); // per-request audit actor context

  app.get('/api/health', (_req, res) => res.json({ ok: true, db: usingRealPostgres ? 'postgresql' : 'in-memory (dev)' }));
  app.use('/api/auth', authRoutes);
  app.use('/api/cases', caseRoutes);
  app.use('/api/documents', documentRouter);
  app.use('/api/assistant', assistantRoutes);
  app.use('/api', adminRoutes);

  // Central error handler: engine errors are user-facing (4xx), anything else is a 500.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof EngineError) return res.status(err.status).json({ error: err.message });
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File exceeds the 10 MB limit' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('server.js')) {
  const port = process.env.PORT || 4000;
  createApp().then((app) => app.listen(port, () => console.log(`GovFlow API listening on :${port} (${usingRealPostgres ? 'PostgreSQL' : 'in-memory dev DB'})`)));
}
