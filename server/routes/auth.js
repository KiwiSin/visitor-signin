import { audit, canManage, createSession, currentUser, destroySession } from '../auth.js';
import { businessUrl, freeSlug, resolveBusiness } from '../business.js';
import { config } from '../config.js';
import { one, query, tx } from '../db.js';
import { hashPassword, makeLimiter, randomToken, sha256, verifyPassword } from '../security.js';
import { getSettings, saveSetting } from '../settings.js';
import { publicBranding } from './kiosk.js';

const loginLimit = makeLimiter({ max: 10, windowMs: 15 * 60 * 1000 });
const setupLimit = makeLimiter({ max: 20, windowMs: 15 * 60 * 1000 });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let setupToken = null;

/** Called on start: if nobody can log in yet, print a one-time setup link for the Host Admin. */
export async function prepareSetup(log) {
  const { n } = await one('SELECT count(*)::int AS n FROM admin_users');
  if (n > 0) return;
  setupToken = randomToken(18);
  const link = `${config.appUrl}/admin/setup?token=${setupToken}`;
  // Plain text (not JSON) so it is easy to read and copy in Portainer's log view.
  console.log(`\n================================================================\n First-time setup: open this link to create the Host Admin account\n ${link}\n================================================================\n`);
  log.info({ setupLink: link }, 'Waiting for first-time setup');
}

const userView = (u) => (u ? { id: u.id, name: u.name, email: u.email, isHost: u.is_host, businessSlug: u.business_slug, businessName: u.business_name } : null);

function checkNewAdmin(reply, { name, email, password }) {
  if (!String(name || '').trim() || !EMAIL_RE.test(email || '')) return reply.code(400).send({ error: 'Enter your name and a valid email.' });
  if (!password || password.length < 10) return reply.code(400).send({ error: 'Use a password of at least 10 characters.' });
  return null;
}

export default async function authRoutes(app) {
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/public/branding', async (request, reply) => {
    const b = await resolveBusiness(request);
    if (!b) return reply.code(404).send({ error: 'Business not found.', code: 'no-business' });
    return { ...publicBranding((await getSettings(b.id)).branding), businessSlug: b.slug, businessStatus: b.status };
  });

  // Home-screen app details, so "Add to Home Screen" opens this business's kiosk or roll call.
  app.get('/api/public/manifest/:app', async (request, reply) => {
    const b = await resolveBusiness(request);
    const kind = request.params.app === 'rollcall' ? 'rollcall' : 'kiosk';
    const branding = b ? (await getSettings(b.id)).branding : null;
    const base = b && request.headers['x-vs-business'] ? `/b/${b.slug}` : '';
    const name = branding?.companyName || 'Visitor Sign-In';
    const manifest = kind === 'rollcall'
      ? {
        id: `${base}/rollcall`, name: `Roll call · ${name}`, short_name: 'Roll call', start_url: `${base}/rollcall`, scope: '/',
        display: 'standalone', orientation: 'portrait', background_color: '#F5F6F8', theme_color: '#B91C1C',
        icons: [{ src: '/icons/rollcall-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icons/rollcall-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
      }
      : {
        id: `${base}/kiosk`, name: `Sign in · ${name}`, short_name: 'Sign In', start_url: `${base}/kiosk`, scope: '/',
        display: 'fullscreen', display_override: ['fullscreen', 'standalone'], orientation: 'any', background_color: '#1F2937', theme_color: branding?.accent || '#0F766E',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }],
      };
    reply.header('Content-Type', 'application/manifest+json').header('Cache-Control', 'no-cache');
    return JSON.stringify(manifest);
  });

  app.get('/api/auth/status', async (request) => {
    const { n } = await one('SELECT count(*)::int AS n FROM admin_users');
    if (n === 0) return { needsSetup: true, user: null };
    const [user, business] = await Promise.all([currentUser(request), resolveBusiness(request)]);
    return {
      needsSetup: false,
      user: userView(user),
      business: business ? { slug: business.slug, name: business.name, status: business.status } : null,
      canManage: canManage(user, business),
    };
  });

  // First run: create the Host Admin, and name the first business.
  app.post('/api/auth/setup', async (request, reply) => {
    const { n } = await one('SELECT count(*)::int AS n FROM admin_users');
    if (n > 0) return reply.code(400).send({ error: 'Setup is already done. Please sign in.' });
    const { token, name, email, password, companyName } = request.body || {};
    if (!setupToken || token !== setupToken) {
      return reply.code(403).send({ error: 'The setup link is missing or out of date. Use the link printed in the app container log.' });
    }
    if (checkNewAdmin(reply, { name, email, password })) return reply;
    const first = await one('SELECT id FROM businesses ORDER BY id LIMIT 1');
    const company = String(companyName || '').trim().slice(0, 80);
    const user = await tx(async (c) => {
      if (company) {
        const slug = await freeSlug(company, c);
        await c.query('UPDATE businesses SET name = $2, slug = $3 WHERE id = $1', [first.id, company, slug]);
      }
      return (await c.query(
        'INSERT INTO admin_users (name, email, password_hash, role, business_id, is_host) VALUES ($1, lower($2), $3, $4, $5, true) RETURNING id',
        [name.trim(), email.trim(), await hashPassword(password), 'admin', first.id],
      )).rows[0];
    });
    if (company) {
      const { branding } = await getSettings(first.id);
      await saveSetting(first.id, 'branding', { ...branding, companyName: company });
    }
    setupToken = null;
    await audit(user.id, 'setup.complete', null, first.id);
    await createSession(reply, user.id);
    return { ok: true };
  });

  // A company opening the setup link the Host Admin sent them.
  app.get('/api/business-setup', async (request, reply) => {
    if (!setupLimit(request.ip)) return reply.code(429).send({ error: 'Too many attempts. Try again later.' });
    const token = String(request.query.token || '');
    const b = token && await one('SELECT id, slug, name, setup_expires > now() AS valid FROM businesses WHERE setup_token_hash = $1', [sha256(token)]);
    if (!b) return reply.code(404).send({ error: 'This setup link has already been used or was replaced. Ask your provider for a new one.' });
    if (!b.valid) return reply.code(410).send({ error: 'This setup link has expired. Ask your provider for a new one.' });
    return { name: b.name, slug: b.slug };
  });

  app.post('/api/business-setup', async (request, reply) => {
    if (!setupLimit(request.ip)) return reply.code(429).send({ error: 'Too many attempts. Try again later.' });
    const { token, name, email, password } = request.body || {};
    const b = token && await one(`SELECT id, slug, name FROM businesses WHERE setup_token_hash = $1 AND setup_expires > now()`, [sha256(String(token))]);
    if (!b) return reply.code(400).send({ error: 'This setup link is no longer valid. Ask your provider for a new one.' });
    if (checkNewAdmin(reply, { name, email, password })) return reply;
    try {
      const user = await one(
        'INSERT INTO admin_users (name, email, password_hash, role, business_id) VALUES ($1, lower($2), $3, $4, $5) RETURNING id',
        [String(name).trim(), String(email).trim(), await hashPassword(password), 'admin', b.id],
      );
      await query('UPDATE businesses SET setup_token_hash = NULL, setup_expires = NULL WHERE id = $1', [b.id]);
      await audit(user.id, 'business.setup', null, b.id);
      await createSession(reply, user.id);
      return { ok: true, slug: b.slug, adminUrl: businessUrl(b, '/admin') };
    } catch (e) {
      if (e.code === '23505') return reply.code(400).send({ error: 'That email already has an account. Sign in instead, or use another email.' });
      throw e;
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    if (!loginLimit(request.ip)) return reply.code(429).send({ error: 'Too many attempts. Try again in 15 minutes.' });
    const { email, password } = request.body || {};
    const user = await one(
      `SELECT u.id, u.password_hash, u.is_host, b.slug FROM admin_users u LEFT JOIN businesses b ON b.id = u.business_id WHERE u.email = lower($1)`,
      [String(email || '').trim()],
    );
    if (!user || !(await verifyPassword(String(password || ''), user.password_hash))) {
      return reply.code(401).send({ error: 'Email or password is wrong.' });
    }
    await createSession(reply, user.id);
    await audit(user.id, 'login');
    return { ok: true, isHost: user.is_host, businessSlug: user.slug };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    await destroySession(request, reply);
    return { ok: true };
  });
}
