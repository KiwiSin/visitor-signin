// Businesses: each one is a separate company with its own staff, tablets, settings and records.
import { config } from './config.js';
import { one, query, tx } from './db.js';
import { DEFAULTS, getPlatformSettings } from './settings.js';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const RESERVED = new Set(['admin', 'api', 'host', 'kiosk', 'rollcall', 'setup', 'assets', 'uploads', 'icons', 'wallpapers', 'www', 'b']);

/** "Acme Ltd (Auckland)" -> "acme-ltd-auckland" */
export function slugify(name) {
  return String(name || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 48).replace(/-+$/g, '');
}

export function validSlug(slug) {
  return SLUG_RE.test(slug) && !RESERVED.has(slug);
}

/** A free slug based on the name: acme-ltd, acme-ltd-2, … */
export async function freeSlug(name, client = null) {
  const q = client ? client.query.bind(client) : query;
  let base = slugify(name) || 'business';
  if (RESERVED.has(base)) base = `${base}-co`;
  for (let i = 1; i < 1000; i++) {
    const candidate = i === 1 ? base : `${base.slice(0, 44)}-${i}`;
    const { rows } = await q('SELECT 1 FROM businesses WHERE slug = $1', [candidate]);
    if (!rows.length) return candidate;
  }
  throw new Error('Could not find a free web address for that name.');
}

const COLS = 'id, slug, name, status, created_at';

export const businessById = (id) => one(`SELECT ${COLS} FROM businesses WHERE id = $1`, [id]);
export const businessBySlug = (slug) => one(`SELECT ${COLS} FROM businesses WHERE slug = $1`, [String(slug || '').toLowerCase()]);

/** The business at the plain addresses (/admin, /kiosk): DEFAULT_BUSINESS, else the first one. */
export async function defaultBusiness() {
  if (config.defaultBusiness) {
    const b = await businessBySlug(config.defaultBusiness);
    if (b) return b;
  }
  return one(`SELECT ${COLS} FROM businesses ORDER BY id LIMIT 1`);
}

/**
 * Which business a request is for:
 *  1. /api/b/<slug>/… (the web app adds this for /b/<slug>/ pages)
 *  2. <slug>.BASE_DOMAIN, when BASE_DOMAIN is set (subdomain per business)
 *  3. the default business
 */
export async function resolveBusiness(request) {
  if (request.businessResolved) return request.business;
  request.businessResolved = true;
  const slug = request.headers['x-vs-business'];
  let b = null;
  if (slug) b = await businessBySlug(slug);
  else if (config.baseDomain) {
    const host = String(request.hostname || '').toLowerCase().split(':')[0];
    if (host.endsWith(`.${config.baseDomain}`)) {
      const sub = host.slice(0, -(config.baseDomain.length + 1));
      if (sub && !sub.includes('.') && sub !== 'www') b = await businessBySlug(sub);
    }
  }
  if (!b && !slug) b = await defaultBusiness();
  request.business = b;
  return b;
}

/** Full web address of a page for a business, e.g. businessUrl(b, '/kiosk'). */
export function businessUrl(business, path = '') {
  if (config.baseDomain) {
    const proto = config.appUrl.startsWith('https://') ? 'https' : 'http';
    return `${proto}://${business.slug}.${config.baseDomain}${path}`;
  }
  return `${config.appUrl}/b/${business.slug}${path}`;
}

/**
 * Create a business with everything it needs to start: a site, visit types, safety questions,
 * and settings copied from the platform defaults (H&S text).
 */
export async function createBusiness({ name, slug }) {
  const platform = await getPlatformSettings();
  return tx(async (c) => {
    const finalSlug = slug || (await freeSlug(name, c));
    const b = (await c.query(`INSERT INTO businesses (slug, name) VALUES ($1, $2) RETURNING ${COLS}`, [finalSlug, name])).rows[0];
    await c.query('INSERT INTO sites (business_id, name) VALUES ($1, $2)', [b.id, 'Main site']);
    const types = [
      ['visitor', 'Visitor / Meeting', 1, false, true, true],
      ['contractor', 'Contractor', 2, true, true, true],
      ['delivery', 'Courier / Delivery', 3, false, false, false],
      ['interview', 'Interview', 4, false, true, true],
    ];
    for (const [key, tname, sort, induction, host, sig] of types) {
      await c.query(
        `INSERT INTO visitor_types (business_id, key, name, sort, ask_induction_no, require_host, require_signature) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [b.id, key, tname, sort, induction, host, sig],
      );
    }
    for (const [i, q] of (platform.defaultQuestions || []).entries()) {
      await c.query('INSERT INTO safety_questions (business_id, text, flag_answer, sort) VALUES ($1,$2,$3,$4)', [b.id, q.text, q.flag_answer === 'no' ? 'no' : 'yes', i + 1]);
    }
    const settings = {
      branding: { ...DEFAULTS.branding, companyName: name },
      safety: { text: platform.defaultSafetyText || DEFAULTS.safety.text, version: 1 },
    };
    for (const [key, value] of Object.entries(settings)) {
      await c.query('INSERT INTO settings (business_id, key, value) VALUES ($1, $2, $3)', [b.id, key, JSON.stringify(value)]);
    }
    return b;
  });
}
