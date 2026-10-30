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

export async function currentUser(request) {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;
  return one(
    `SELECT u.id, u.name, u.email, u.role FROM sessions s JOIN admin_users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
}

/** preHandler: only signed-in admin users. */
export async function requireAdmin(request, reply) {
  const user = await currentUser(request);
  if (!user) return reply.code(401).send({ error: 'Please sign in.' });
  request.user = user;
}

/** preHandler: only a paired kiosk tablet (X-Kiosk-Token header). */
export async function requireKiosk(request, reply) {
  const token = request.headers['x-kiosk-token'];
  if (!token) return reply.code(401).send({ error: 'This tablet is not paired.', code: 'unpaired' });
  const kiosk = await one(
    `UPDATE kiosks SET last_seen_at = now() WHERE token_hash = $1
     RETURNING id, site_id, name, default_type`,
    [sha256(String(token))],
  );
  if (!kiosk) return reply.code(401).send({ error: 'This tablet is no longer paired.', code: 'unpaired' });
  request.kiosk = kiosk;
}

export async function audit(userId, action, detail) {
  await query('INSERT INTO audit_log (user_id, action, detail) VALUES ($1, $2, $3)', [userId ?? null, action, detail ? JSON.stringify(detail) : null]);
}
