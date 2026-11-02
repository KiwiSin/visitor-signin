import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { many, one, query, tx } from './db.js';
import { getSettings } from './settings.js';
import { arrivalEmail } from './templates.js';

const clean = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class InputError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 400;
  }
}

async function saveSignature(dataUrl) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 600_000) throw new InputError('Signature image is too large.');
  const dir = path.join(config.uploadDir, 'private');
  await fs.mkdir(dir, { recursive: true });
  const name = `sig-${crypto.randomUUID()}.png`;
  await fs.writeFile(path.join(dir, name), buf);
  return name;
}

/** Create a visit from a kiosk sign-in and queue the alert emails. The kiosk decides the business. */
export async function signIn(body, kiosk) {
  const bid = kiosk.business_id;
  const name = clean(body.name, 120);
  if (!name) throw new InputError('Please enter your name.');
  const mobile = clean(body.mobile, 40);
  const company = clean(body.company, 120);
  const email = clean(body.email, 160);
  if (email && !EMAIL_RE.test(email)) throw new InputError('That email address doesn’t look right.');

  const type = await one('SELECT * FROM visitor_types WHERE business_id = $1 AND key = $2 AND active', [bid, clean(body.type, 40)]);
  if (!type) throw new InputError('Please choose a visit type.');

  let host = null;
  if (body.hostId) {
    host = await one('SELECT s.*, t.email AS team_email FROM staff s LEFT JOIN teams t ON t.id = s.team_id WHERE s.business_id = $1 AND s.id = $2 AND s.active', [bid, Number(body.hostId)]);
    if (!host) throw new InputError('Please choose who you are visiting.');
  } else if (type.require_host && !body.noHost) {
    throw new InputError('Please choose who you are visiting.');
  }

  const settings = await getSettings(bid);
  const questions = await many('SELECT * FROM safety_questions WHERE business_id = $1 AND active ORDER BY sort, id', [bid]);
  const given = new Map((Array.isArray(body.answers) ? body.answers : []).map((a) => [Number(a.questionId), a.answer]));
  const answers = [];
  if (type.require_signature) {
    for (const q of questions) {
      const ans = given.get(q.id);
      if (ans !== 'yes' && ans !== 'no') throw new InputError('Please answer every safety question.');
      answers.push({ questionId: q.id, question: q.text, answer: ans, flagged: ans === q.flag_answer });
    }
    if (!body.agreed) throw new InputError('Please agree to the Health & Safety rules.');
  }
  const flagged = answers.some((a) => a.flagged);
  const signatureFile = type.require_signature ? await saveSignature(body.signature) : null;
  if (type.require_signature && !signatureFile) throw new InputError('Please sign in the box.');

  const clientId = clean(body.clientId, 80) || null;
  if (clientId) {
    const existing = await one('SELECT id FROM visits WHERE client_id = $1 AND business_id = $2', [clientId, bid]);
    if (existing) return { id: existing.id, duplicate: true };
  }

  const signedInAt = body.signedInAt && !Number.isNaN(Date.parse(body.signedInAt)) && Date.now() - Date.parse(body.signedInAt) < 7 * 864e5
    ? new Date(Math.min(Date.parse(body.signedInAt), Date.now()))
    : new Date();
  const extra = {};
  if (clean(body.rego, 20)) extra.rego = clean(body.rego, 20).toUpperCase();
  if (clean(body.inductionNo, 60)) extra.inductionNo = clean(body.inductionNo, 60);

  const visit = await tx(async (c) => {
    let visitor = (await c.query(
      'SELECT id FROM visitors WHERE business_id = $3 AND lower(name) = lower($1) AND coalesce(mobile, \'\') = $2 ORDER BY id DESC LIMIT 1',
      [name, mobile, bid],
    )).rows[0];
    if (visitor) {
      await c.query('UPDATE visitors SET company = $2, email = coalesce(nullif($3, \'\'), email), updated_at = now() WHERE id = $1', [visitor.id, company, email]);
    } else {
      visitor = (await c.query('INSERT INTO visitors (business_id, name, company, mobile, email) VALUES ($5,$1,$2,$3,$4) RETURNING id', [name, company, mobile, email, bid])).rows[0];
    }
    const { rows } = await c.query(
      `INSERT INTO visits (client_id, site_id, visitor_id, type_id, host_staff_id, host_name, kiosk_id, signed_in_at,
                           answers, flagged, agreed_hs, hs_version, signature_file, extra, business_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id, signed_in_at`,
      [clientId, kiosk?.site_id ?? null, visitor.id, type.id, host?.id ?? null, host?.name ?? null, kiosk?.id ?? null, signedInAt,
        JSON.stringify(answers), flagged, !!type.require_signature, type.require_signature ? settings.safety.version : null, signatureFile, JSON.stringify(extra), bid],
    );
    return rows[0];
  });

  const summary = {
    visitorName: name, company, mobile, typeName: type.name, hostName: host?.name ?? null,
    signedInAt: visit.signed_in_at, agreedHs: !!type.require_signature, answers, extra,
  };
  await queueArrivalEmails(bid, visit.id, summary, host, settings);
  return { id: visit.id, hostName: host?.name ?? null, flagged };
}

async function queueArrivalEmails(bid, visitId, summary, host, settings) {
  const { notify, branding, email, hours } = settings;
  if (email.method === 'none') return;
  const queue = async (kind, recipient) => {
    if (!recipient || !EMAIL_RE.test(recipient)) return;
    const msg = arrivalEmail({ branding, visit: summary, kind, tz: hours.timezone });
    await query(
      `INSERT INTO notifications (business_id, visit_id, kind, recipient, subject, body_html, body_text) VALUES ($7,$1,$2,$3,$4,$5,$6)`,
      [visitId, kind, recipient, msg.subject, msg.html, msg.text, bid],
    );
  };
  // Host's own email first; if they have none, their team's shared mailbox.
  const hostEmail = host?.email || host?.team_email;
  if (notify.hostOnSignIn && hostEmail) await queue(host?.email ? 'host' : 'team', hostEmail);
  if (notify.receptionMailbox && (notify.copyReception || !hostEmail)) {
    if (notify.receptionMailbox.toLowerCase() !== (hostEmail || '').toLowerCase()) await queue('reception', notify.receptionMailbox);
  }
  if (summary.answers.some((a) => a.flagged) && notify.flaggedTo) await queue('flagged', notify.flaggedTo);
}

export async function signOut(businessId, visitId, by) {
  if (!/^[0-9a-f-]{36}$/i.test(String(visitId))) return false;
  const v = await one(
    `UPDATE visits SET signed_out_at = now(), signed_out_by = $2 WHERE id = $1 AND business_id = $3 AND signed_out_at IS NULL RETURNING id`,
    [visitId, by, businessId],
  );
  return !!v;
}

export async function onSite(businessId) {
  return many(
    `SELECT v.id, vi.name, vi.company, t.name AS type, t.key AS type_key, v.host_name, v.signed_in_at, v.flagged
       FROM visits v JOIN visitors vi ON vi.id = v.visitor_id JOIN visitor_types t ON t.id = v.type_id
      WHERE v.business_id = $1 AND v.signed_out_at IS NULL
        AND v.signed_in_at > now() - interval '7 days'
      ORDER BY vi.name`,
    [businessId],
  );
}
