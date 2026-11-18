import jwt from 'jsonwebtoken';
import { setAuditActor } from '../audit/auditService.js';

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-in-production';
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') console.warn('WARNING: JWT_SECRET not set');

export const signToken = (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, email: u.email }, SECRET, { expiresIn: '12h' });

/** Verifies the bearer token and registers the actor for audit logging. */
export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token; // ?token= allows <img>/PDF links
  try {
    req.user = jwt.verify(token, SECRET);
    setAuditActor({ id: req.user.id, name: req.user.name, role: req.user.role });
    next();
  } catch {
    res.status(401).json({ error: 'Authentication required' });
  }
}

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'You do not have permission for this action' });

export const isStaff = (u) => u.role === 'officer' || u.role === 'admin';
