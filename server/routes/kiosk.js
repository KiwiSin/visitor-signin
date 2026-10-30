import { requireKiosk } from '../auth.js';
import { many, one, query } from '../db.js';
import { makeLimiter, randomToken, sha256 } from '../security.js';
import { getSettings } from '../settings.js';
import { onSite, signIn, signOut } from '../visits.js';

const pairLimit = makeLimiter({ max: 10, windowMs: 10 * 60 * 1000 });

export function publicBranding(branding) {
  const { appName, companyName, accent, welcome, subtitle, locationName, assemblyPoint, logo, wallpapers, wallpaper, rotateWallpapers, scrim } = branding;
  return { appName, companyName, accent, welcome, subtitle, locationName, assemblyPoint, logo, wallpapers, wallpaper, rotateWallpapers, scrim };
}

export default async function kioskRoutes(app) {
  app.post('/api/kiosk/pair', async (request, reply) => {
    if (!pairLimit(request.ip)) return reply.code(429).send({ error: 'Too many attempts. Wait a few minutes and try again.' });
    const code = String(request.body?.code || '').replace(/\D/g, '');
    if (code.length !== 6) return reply.code(400).send({ error: 'Enter the 6-digit code shown in Admin.' });
    const token = randomToken();
    const kiosk = await one(
      `UPDATE kiosks SET token_hash = $2, pairing_code = NULL, pairing_expires = NULL, paired_at = now(), last_seen_at = now()
        WHERE pairing_code = $1 AND pairing_expires > now() RETURNING id, name`,
      [code, sha256(token)],
    );
    if (!kiosk) return reply.code(400).send({ error: 'That code is wrong or has expired. Make a new one in Admin › Tablets.' });
    request.log.info({ kiosk: kiosk.name }, 'Tablet paired');
    return { token, kiosk };
  });

  app.register(async (k) => {
    k.addHook('preHandler', requireKiosk);

    k.get('/api/kiosk/bootstrap', async (request) => {
      const settings = await getSettings();
      const [types, questions, staff] = await Promise.all([
        many('SELECT key, name, ask_company, ask_email, ask_rego, ask_induction_no, require_host, require_signature FROM visitor_types WHERE active ORDER BY sort, id'),
        many('SELECT id, text FROM safety_questions WHERE active ORDER BY sort, id'),
        many(`SELECT s.id, s.name, t.name AS team FROM staff s LEFT JOIN teams t ON t.id = s.team_id
               WHERE s.active AND s.show_on_kiosk ORDER BY s.name`),
      ]);
      return {
        kiosk: request.kiosk,
        branding: publicBranding(settings.branding),
        safety: settings.safety,
        privacyNotice: settings.privacy.notice,
        types,
        questions,
        staff,
        serverTime: new Date().toISOString(),
      };
    });

    k.post('/api/kiosk/visits', async (request) => signIn(request.body || {}, request.kiosk));

    k.get('/api/kiosk/onsite', async (request) => {
      const rows = await onSite(request.kiosk.site_id);
      return rows.map((r) => ({ id: r.id, name: r.name, company: r.company, type: r.type, host: r.host_name, signedInAt: r.signed_in_at }));
    });

    k.post('/api/kiosk/visits/:id/signout', async (request, reply) => {
      const ok = await signOut(request.params.id, 'kiosk');
      if (!ok) return reply.code(404).send({ error: 'Already signed out.' });
      return { ok: true };
    });

    k.get('/api/kiosk/staff', async () => many(
      `SELECT s.id, s.name, t.name AS team, s.presence, s.presence_at FROM staff s LEFT JOIN teams t ON t.id = s.team_id
        WHERE s.active ORDER BY s.name`,
    ));

    k.post('/api/kiosk/staff/:id/presence', async (request, reply) => {
      const state = request.body?.state === 'in' ? 'in' : 'out';
      const s = await one('UPDATE staff SET presence = $2, presence_at = now() WHERE id = $1 AND active RETURNING id, presence, presence_at', [Number(request.params.id), state]);
      if (!s) return reply.code(404).send({ error: 'Staff member not found.' });
      await query('INSERT INTO staff_presence (staff_id, state, kiosk_id) VALUES ($1, $2, $3)', [s.id, state, request.kiosk.id]);
      return s;
    });
  });
}
