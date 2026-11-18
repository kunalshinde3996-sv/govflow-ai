import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { query, one } from '../db/db.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { record, runAs } from '../audit/auditService.js';

const r = Router();
const pub = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

// Self-registration creates Citizen accounts only; staff accounts are provisioned by an admin.
r.post('/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name?.trim() || !/^\S+@\S+\.\S+$/.test(email || '') || (password || '').length < 8) {
    return res.status(400).json({ error: 'Name, a valid email and a password of at least 8 characters are required' });
  }
  if (await one('SELECT id FROM users WHERE email=$1', [email.toLowerCase()])) return res.status(409).json({ error: 'An account with this email already exists' });
  const u = { id: crypto.randomUUID(), name: name.trim(), email: email.toLowerCase(), role: 'citizen' };
  await query('INSERT INTO users (id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,$5)', [u.id, u.name, u.email, await bcrypt.hash(password, 10), u.role]);
  await runAs(u, () => record({ action: 'USER_REGISTERED', entity: 'user', entityId: u.id, after: { email: u.email, role: u.role } }));
  res.status(201).json({ token: signToken(u), user: pub(u) });
});

r.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const u = await one('SELECT * FROM users WHERE email=$1', [(email || '').toLowerCase()]);
  if (!u || !(await bcrypt.compare(password || '', u.password_hash))) return res.status(401).json({ error: 'Invalid email or password' });
  await runAs(pub(u), () => record({ action: 'USER_LOGIN', entity: 'user', entityId: u.id }));
  res.json({ token: signToken(u), user: pub(u) });
});

r.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

export default r;
