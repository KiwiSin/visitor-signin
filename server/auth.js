import { resolveBusiness } from './business.js';
import { config } from './config.js';
import { one, query } from './db.js';
import { randomToken, sha256 } from './security.js';

export const SESSION_COOKIE = 'vs_session';
const SESSION_DAYS = 7;

export async function createSession(reply, userId) {
  const token = randomToken();
  await query(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [sha256(token), userId, String(SESSION_DAYS)],
  );
  await query('UPDATE admin_users SET last_login_at = now() WHERE id = $1', [userId]);
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge: SESSION_DAYS * 24 * 3600,
  });
}

export async function destroySession(request, reply) {
  const token = request.cookies[SESSION_COOKIE];
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** The signed-in admin (business admin or Host Admin), or null. */
export async function currentUser(request) {
  if (request.userLoaded) return request.currentUser;
  request.userLoaded = true;
  const token = request.cookies[SESSION_COOKIE];
  request.currentUser = token
    ? await one(
      `SELECT u.id, u.name, u.email, u.role, u.business_id, u.is_host, b.slug AS business_slug, b.name AS business_name
         FROM sessions s JOIN admin_users u ON u.id = s.user_id LEFT JOIN businesses b ON b.id = u.business_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sha256(token)],
    )
    : null;
  return request.currentUser;
}

/** Can this user manage this business? Host Admins can manage every business. */
export const canManage = (user, business) => !!(user && business && (user.is_host || user.business_id === business.id));

/** preHandler: an admin of the business this request is for. Sets request.user and request.business. */
export async function requireAdmin(request, reply) {
  const user = await currentUser(request);
  if (!user) return reply.code(401).send({ error: 'Please sign in.' });
  const business = await resolveBusiness(request);
  if (!business) return reply.code(404).send({ error: 'Business not found.', code: 'no-business' });
  if (!canManage(user, business)) return reply.code(403).send({ error: 'Your account is for a different business.', code: 'wrong-business' });
  if (business.status !== 'active' && !user.is_host) return reply.code(403).send({ error: 'This business is paused. Contact your provider.', code: 'suspended' });
  request.user = user;
}

/** preHandler: Host Admins only (the platform console). */
export async function requireHost(request, reply) {
  const user = await currentUser(request);
  if (!user) return reply.code(401).send({ error: 'Please sign in.' });
  if (!user.is_host) return reply.code(403).send({ error: 'Host Admins only.' });
  request.user = user;
}

/** preHandler: only a paired kiosk tablet (X-Kiosk-Token header). The tablet decides the business. */
export async function requireKiosk(request, reply) {
  const token = request.headers['x-kiosk-token'];
  if (!token) return reply.code(401).send({ error: 'This tablet is not paired.', code: 'unpaired' });
  const kiosk = await one(
    `UPDATE kiosks k SET last_seen_at = now() FROM businesses b
      WHERE k.token_hash = $1 AND b.id = k.business_id
     RETURNING k.id, k.site_id, k.name, k.default_type, k.business_id, b.status AS business_status, b.slug AS business_slug`,
    [sha256(String(token))],
  );
  if (!kiosk) return reply.code(401).send({ error: 'This tablet is no longer paired.', code: 'unpaired' });
  if (kiosk.business_status !== 'active') return reply.code(403).send({ error: 'Sign-in is paused for this business.', code: 'suspended' });
  request.kiosk = kiosk;
  request.business = { id: kiosk.business_id, slug: kiosk.business_slug };
}

export async function audit(userId, action, detail, businessId = null) {
  await query('INSERT INTO audit_log (user_id, action, detail, business_id) VALUES ($1, $2, $3, $4)',
    [userId ?? null, action, detail ? JSON.stringify(detail) : null, businessId]);
}
