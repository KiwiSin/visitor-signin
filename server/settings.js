import { many, query } from './db.js';

export const DEFAULT_HS_TEXT = `Emergencies: on a continuous alarm, leave by the nearest exit and go to the assembly point. Do not leave until your name has been checked off.

Stay with your host: visitors must be accompanied beyond reception at all times.

PPE: hi-vis and safety footwear are required in the warehouse and yard. Your host will provide hi-vis.

Hazards: forklifts operate in marked areas. Use the pedestrian walkways only.

Report it: tell your host about any injury, near miss or hazard straight away.

Unwell? If you are feeling unwell, please reschedule your visit.`;

export const DEFAULTS = {
  branding: {
    appName: 'Visitor Sign-In',
    companyName: 'Your Company',
    accent: '#0F766E',
    welcome: 'Kia ora, welcome',
    subtitle: "Please sign in so we know you're here and can let your host know.",
    locationName: 'Main Reception',
    assemblyPoint: 'the front car park',
    logo: null,                        // uploaded file URL, or null for the built-in logo
    wallpapers: ['/wallpapers/mountains.jpg', '/wallpapers/coast.jpg', '/wallpapers/bush.jpg'],
    wallpaper: 0,                      // index into wallpapers
    rotateWallpapers: false,
    scrim: 0.35,
  },
  email: {
    method: 'none',                    // none | relay | smtp
    host: '',
    port: 25,
    security: 'none',                  // none | starttls | tls
    allowSelfSigned: true,
    user: '',
    passEnc: '',
    from: '',
    fromName: 'Reception',
    replyTo: '',
  },
  notify: {
    hostOnSignIn: true,
    hostOnSignOut: false,
    receptionMailbox: '',
    copyReception: true,
    flaggedTo: '',
  },
  safety: {
    text: DEFAULT_HS_TEXT,
    version: 1,
  },
  privacy: {
    notice: 'We collect your details to keep everyone on site safe and to let your host know you have arrived. They are kept for 12 months, then deleted. Ask reception if you would like a copy or a correction.',
    retentionMonths: 12,
  },
};

function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] !== null ? merge(base[k], v) : v;
  }
  return out;
}

export async function getSettings() {
  const rows = await many('SELECT key, value FROM settings');
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const out = {};
  for (const key of Object.keys(DEFAULTS)) out[key] = merge(DEFAULTS[key], stored[key]);
  return out;
}

export async function getSetting(key) {
  return (await getSettings())[key];
}

export async function saveSetting(key, value) {
  if (!(key in DEFAULTS)) throw new Error(`Unknown settings section ${key}`);
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}
