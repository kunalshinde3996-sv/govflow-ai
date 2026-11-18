import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { chat, AssistantError } from '../services/assistant/index.js';
import { getProvider } from '../services/assistant/provider.js';

const r = Router();
r.use(requireAuth);

// Which mode will be used (lets the UI show "Basic mode" before the first question).
r.get('/status', (_req, res) => res.json({ mode: getProvider() ? 'ai' : 'basic' }));

r.post('/chat', async (req, res) => {
  try {
    const { message, caseId, language, task, history } = req.body || {};
    res.json(await chat({ user: req.user, message, caseId, language, task, history }));
  } catch (e) {
    if (e instanceof AssistantError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

export default r;
