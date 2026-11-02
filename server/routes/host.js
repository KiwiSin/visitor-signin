// Host Admin console: the businesses on this platform.
import { audit, requireHost } from '../auth.js';
import { businessUrl, createBusiness, freeSlug, slugify, validSlug } from '../business.js';
import { many, one, query, tx } from '../db.js';
import { hashPassword, randomToken, sha256 } from '../security.js';
import { getPlatformSettings, savePlatformSetting } from '../settings.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bad = (reply, error) => reply.code(400).send({ error });
const SETUP_DAYS = 14;

async function newSetupLink(business) {
  const token = randomToken(24);
  await query(`UPDATE businesses SET setup_token_hash = $2, setup_expires = now() + ($3 || ' days')::interval WHERE id = $1`,
    [business.id, sha256(token), String(SETUP_DAYS)]);
  return `${businessUrl(business, '/setup')}?token=${token}`;
}

export default async function hostRoutes(app) {
  app.register(async (h) => {
    h.addHook('preHandler', requireHost);

    h.get('/api/host/businesses', async () => {
      const rows = await many(
        `SELECT b.id, b.slug, b.name, b.status, b.created_at, b.setup_expires,
                (b.setup_token_hash IS NOT NULL AND b.setup_expires > now()) AS setup_pending,
                (SELECT count(*)::int FROM admin_users u WHERE u.business_id = b.id) AS admins,
                (SELECT count(*)::int FROM staff s WHERE s.business_id = b.id AND s.active) AS staff,
                (SELECT count(*)::int FROM kiosks k WHERE k.business_id = b.id AND k.token_hash IS NOT NULL) AS tablets,
                (SELECT count(*)::int FROM visits v WHERE v.business_id = b.id AND v.signed_in_at > now() - interval '30 days') AS visits_30d,
                (SELECT max(v.signed_in_at) FROM visits v WHERE v.business_id = b.id) AS last_visit
           FROM businesses b ORDER BY b.name`,
      );
      return rows.map((b) => ({ ...b, adminUrl: businessUrl(b, '/admin'), kioskUrl: businessUrl(b, '/kiosk') }));
    });

    // Suggest a web address while the Host Admin types a name.
    h.get('/api/host/slug', async (request) => {
      const name = str(request.query.name, 80);
      return { slug: name ? await freeSlug(name) : '' };
    });

    h.post('/api/host/businesses', async (request, reply) => {
      const name = str(request.body?.name, 80);
      if (!name) return bad(reply, 'Enter the company name.');
      let slug = str(request.body?.slug, 48).toLowerCase();
      if (slug) {
        slug = slugify(slug);
        if (!validSlug(slug)) return bad(reply, 'Use only letters, numbers and dashes for the web address.');
        if (await one('SELECT 1 FROM businesses WHERE slug = $1', [slug])) return bad(reply, `The web address "${slug}" is already taken.`);
      }
      const business = await createBusiness({ name, slug: slug || null });
      const setupUrl = await newSetupLink(business);
      await audit(request.user.id, 'host.business.create', { id: business.id, slug: business.slug });
      return { business, setupUrl, adminUrl: businessUrl(business, '/admin') };
    });

    h.post('/api/host/businesses/:id/setup-link', async (request, reply) => {
      const b = await one('SELECT id, slug, name FROM businesses WHERE id = $1', [Number(request.params.id)]);
      if (!b) return reply.code(404).send({ error: 'Business not found.' });
      const setupUrl = await newSetupLink(b);
      await audit(request.user.id, 'host.business.setup_link', { id: b.id });
      return { setupUrl, expiresInDays: SETUP_DAYS };
    });

    h.put('/api/host/businesses/:id', async (request, reply) => {
      const id = Number(request.params.id);
      const b = await one('SELECT * FROM businesses WHERE id = $1', [id]);
      if (!b) return reply.code(404).send({ error: 'Business not found.' });
      const name = str(request.body?.name, 80) || b.name;
      const status = ['active', 'suspended'].includes(request.body?.status) ? request.body.status : b.status;
      let slug = b.slug;
      if (request.body?.slug !== undefined && str(request.body.slug, 48).toLowerCase() !== b.slug) {
        slug = slugify(str(request.body.slug, 48));
        if (!validSlug(slug)) return bad(reply, 'Use only letters, numbers and dashes for the web address.');
        if (await one('SELECT 1 FROM businesses WHERE slug = $1 AND id <> $2', [slug, id])) return bad(reply, `The web address "${slug}" is already taken.`);
      }
      await query('UPDATE businesses SET name = $2, slug = $3, status = $4 WHERE id = $1', [id, name, slug, status]);
      await audit(request.user.id, 'host.business.update', { id, name, slug, status });
      return one('SELECT id, slug, name, status FROM businesses WHERE id = $1', [id]);
    });

    h.delete('/api/host/businesses/:id', async (request, reply) => {
      const id = Number(request.params.id);
      const b = await one('SELECT id, slug FROM businesses WHERE id = $1', [id]);
      if (!b) return reply.code(404).send({ error: 'Business not found.' });
      if (str(request.body?.confirm, 60) !== b.slug) return bad(reply, `Type ${b.slug} to confirm.`);
      const { n } = await one('SELECT count(*)::int AS n FROM businesses');
      if (n <= 1) return bad(reply, 'You can’t delete the only business. Create another one first.');
      await tx(async (c) => {
        // Host Admins attached to this business keep their accounts.
        await c.query('UPDATE admin_users SET business_id = NULL WHERE business_id = $1 AND is_host', [id]);
        await c.query('DELETE FROM businesses WHERE id = $1', [id]);
      });
      await audit(request.user.id, 'host.business.delete', { id, slug: b.slug });
      return { ok: true };
    });

    // ---- Defaults new businesses start with ----
    h.get('/api/host/settings', async () => getPlatformSettings());

    h.put('/api/host/settings', async (request, reply) => {
      const b = request.body || {};
      if (typeof b.defaultSafetyText === 'string') {
        const text = b.defaultSafetyText.trim().slice(0, 8000);
        if (!text) return bad(reply, 'The default Health & Safety text can’t be empty.');
        await savePlatformSetting('defaultSafetyText', text);
      }
      if (Array.isArray(b.defaultQuestions)) {
        const qs = b.defaultQuestions.map((q) => ({ text: str(q.text, 200), flag_answer: q.flag_answer === 'no' ? 'no' : 'yes' })).filter((q) => q.text).slice(0, 20);
        await savePlatformSetting('defaultQuestions', qs);
      }
      await audit(request.user.id, 'host.settings');
      return getPlatformSettings();
    });

    // ---- Host Admin accounts ----
    h.get('/api/host/admins', async () => many(
      `SELECT u.id, u.name, u.email, u.last_login_at, b.name AS business FROM admin_users u LEFT JOIN businesses b ON b.id = u.business_id
        WHERE u.is_host ORDER BY u.name`,
    ));

    h.post('/api/host/admins', async (request, reply) => {
      const { name, email, password } = request.body || {};
      if (!str(name) || !EMAIL_RE.test(email || '')) return bad(reply, 'Enter a name and a valid email.');
      if (!password || password.length < 10) return bad(reply, 'Use a password of at least 10 characters.');
      try {
        const row = await one('INSERT INTO admin_users (name, email, password_hash, is_host) VALUES ($1, lower($2), $3, true) RETURNING id, name, email',
          [str(name, 120), String(email).trim(), await hashPassword(password)]);
        await audit(request.user.id, 'host.admin.add', { id: row.id });
        return row;
      } catch (e) {
        if (e.code === '23505') return bad(reply, 'That email already has an account.');
        throw e;
      }
    });

    h.delete('/api/host/admins/:id', async (request, reply) => {
      const id = Number(request.params.id);
      if (id === request.user.id) return bad(reply, 'You can’t remove your own Host Admin access.');
      const { n } = await one('SELECT count(*)::int AS n FROM admin_users WHERE is_host');
      if (n <= 1) return bad(reply, 'There must be at least one Host Admin.');
      // Someone who is also a business admin keeps that; otherwise the account is removed.
      await query('UPDATE admin_users SET is_host = false WHERE id = $1 AND business_id IS NOT NULL', [id]);
      await query('DELETE FROM admin_users WHERE id = $1 AND business_id IS NULL', [id]);
      await audit(request.user.id, 'host.admin.remove', { id });
      return { ok: true };
    });
  });
}
