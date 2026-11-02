import { requireKiosk } from '../auth.js';
import { many, one, query } from '../db.js';
import { makeLimiter, randomToken, sha256 } from '../security.js';
import { getSettings } from '../settings.js';
import { onSite, signIn, signOut } from '../visits.js';

const pairLimit = makeLimiter({ max: 10, windowMs: 10 * 60 * 1000 });

export function publicBranding(branding) {
  const { appName, companyName, accent, welcome, subtitle, locationName, assemblyPoint, logo, logoOnLight, theme, colors, wallpapers, wallpaper, rotateWallpapers, scrim } = branding;
  return { appName, companyName, accent, welcome, subtitle, locationName, assemblyPoint, logo, logoOnLight, theme, colors, wallpapers, wallpaper, rotateWallpapers, scrim };
}

export default async function kioskRoutes(app) {
  app.post('/api/kiosk/pair', async (request, reply) => {
    if (!pairLimit(request.ip)) return reply.code(429).send({ error: 'Too many attempts. Wait a few minutes and try again.' });
    const code = String(request.body?.code || '').replace(/\D/g, '');
    if (code.length !== 6) return reply.code(400).send({ error: 'Enter the 6-digit code shown in Admin.' });
    const token = randomToken();
    const kiosk = await one(
      `UPDATE kiosks k SET token_hash = $2, pairing_code = NULL, pairing_expires = NULL, paired_at = now(), last_seen_at = now()
        FROM businesses b
        WHERE k.pairing_code = $1 AND k.pairing_expires > now() AND b.id = k.business_id AND b.status = 'active'
        RETURNING k.id, k.name, b.slug AS business_slug`,
      [code, sha256(token)],
    );
    if (!kiosk) return reply.code(400).send({ error: 'That code is wrong or has expired. Make a new one in Admin › Tablets.' });
    request.log.info({ kiosk: kiosk.name }, 'Tablet paired');
    return { token, kiosk: { id: kiosk.id, name: kiosk.name }, businessSlug: kiosk.business_slug };
  });

  app.register(async (k) => {
    k.addHook('preHandler', requireKiosk);

    k.get('/api/kiosk/bootstrap', async (request) => {
      const bid = request.kiosk.business_id;
      const settings = await getSettings(bid);
      const [types, questions, staff] = await Promise.all([
        many('SELECT key, name, ask_company, ask_email, ask_rego, ask_induction_no, require_host, require_signature FROM visitor_types WHERE business_id = $1 AND active ORDER BY sort, id', [bid]),
        many('SELECT id, text FROM safety_questions WHERE business_id = $1 AND active ORDER BY sort, id', [bid]),
        many(`SELECT s.id, s.name, t.name AS team FROM staff s LEFT JOIN teams t ON t.id = s.team_id
               WHERE s.business_id = $1 AND s.active AND s.show_on_kiosk ORDER BY s.name`, [bid]),
      ]);
      return {
        kiosk: { id: request.kiosk.id, name: request.kiosk.name, default_type: request.kiosk.default_type },
        businessSlug: request.kiosk.business_slug,
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
      const rows = await onSite(request.kiosk.business_id);
      return rows.map((r) => ({ id: r.id, name: r.name, company: r.company, type: r.type, host: r.host_name, signedInAt: r.signed_in_at }));
    });

    k.post('/api/kiosk/visits/:id/signout', async (request, reply) => {
      const ok = await signOut(request.kiosk.business_id, request.params.id, 'kiosk');
      if (!ok) return reply.code(404).send({ error: 'Already signed out.' });
      return { ok: true };
    });

    k.get('/api/kiosk/staff', async (request) => many(
      `SELECT s.id, s.name, t.name AS team, s.presence, s.presence_at FROM staff s LEFT JOIN teams t ON t.id = s.team_id
        WHERE s.business_id = $1 AND s.active ORDER BY s.name`,
      [request.kiosk.business_id],
    ));

    k.post('/api/kiosk/staff/:id/presence', async (request, reply) => {
      const state = request.body?.state === 'in' ? 'in' : 'out';
      const s = await one('UPDATE staff SET presence = $2, presence_at = now() WHERE id = $1 AND business_id = $3 AND active RETURNING id, presence, presence_at', [Number(request.params.id), state, request.kiosk.business_id]);
      if (!s) return reply.code(404).send({ error: 'Staff member not found.' });
      await query('INSERT INTO staff_presence (staff_id, state, kiosk_id, changed_by, business_id) VALUES ($1, $2, $3, $4, $5)', [s.id, state, request.kiosk.id, `Tablet: ${request.kiosk.name}`, request.kiosk.business_id]);
      return s;
    });
  });
}
