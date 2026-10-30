import { audit, createSession, currentUser, destroySession } from '../auth.js';
import { config } from '../config.js';
import { one } from '../db.js';
import { hashPassword, makeLimiter, randomToken, verifyPassword } from '../security.js';
import { getSettings, saveSetting } from '../settings.js';
import { publicBranding } from './kiosk.js';

const loginLimit = makeLimiter({ max: 10, windowMs: 15 * 60 * 1000 });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let setupToken = null;

/** Called on start: if nobody can log in yet, print a one-time setup link. */
export async function prepareSetup(log) {
  const { n } = await one('SELECT count(*)::int AS n FROM admin_users');
  if (n > 0) return;
  setupToken = randomToken(18);
  const link = `${config.appUrl}/admin/setup?token=${setupToken}`;
  // Plain text (not JSON) so it is easy to read and copy in Portainer's log view.
  console.log(`\n================================================================\n First-time setup: open this link to create the admin account\n ${link}\n================================================================\n`);
  log.info({ setupLink: link }, 'Waiting for first-time setup');
}

export default async function authRoutes(app) {
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/public/branding', async () => publicBranding((await getSettings()).branding));

  app.get('/api/auth/status', async (request) => {
    const { n } = await one('SELECT count(*)::int AS n FROM admin_users');
    return { needsSetup: n === 0, user: n === 0 ? null : await currentUser(request) };
  });

  app.post('/api/auth/setup', async (request, reply) => {
    const { n } = await one('SELECT count(*)::int AS n FROM admin_users');
    if (n > 0) return reply.code(400).send({ error: 'Setup is already done. Please sign in.' });
    const { token, name, email, password, companyName } = request.body || {};
    if (!setupToken || token !== setupToken) {
      return reply.code(403).send({ error: 'The setup link is missing or out of date. Use the link printed in the app container log.' });
    }
    if (!name?.trim() || !EMAIL_RE.test(email || '')) return reply.code(400).send({ error: 'Enter your name and a valid email.' });
    if (!password || password.length < 10) return reply.code(400).send({ error: 'Use a password of at least 10 characters.' });
    const user = await one(
      'INSERT INTO admin_users (name, email, password_hash, role) VALUES ($1, lower($2), $3, $4) RETURNING id',
      [name.trim(), email.trim(), await hashPassword(password), 'admin'],
    );
    if (companyName?.trim()) {
      const { branding } = await getSettings();
      await saveSetting('branding', { ...branding, companyName: companyName.trim().slice(0, 80) });
    }
    setupToken = null;
    await audit(user.id, 'setup.complete');
    await createSession(reply, user.id);
    return { ok: true };
  });

  app.post('/api/auth/login', async (request, reply) => {
    if (!loginLimit(request.ip)) return reply.code(429).send({ error: 'Too many attempts. Try again in 15 minutes.' });
    const { email, password } = request.body || {};
    const user = await one('SELECT id, password_hash FROM admin_users WHERE email = lower($1)', [String(email || '').trim()]);
    if (!user || !(await verifyPassword(String(password || ''), user.password_hash))) {
      return reply.code(401).send({ error: 'Email or password is wrong.' });
    }
    await createSession(reply, user.id);
    await audit(user.id, 'login');
    return { ok: true };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    await destroySession(request, reply);
    return { ok: true };
  });
}
