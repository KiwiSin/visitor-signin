// Colour themes for the kiosk, roll call and admin.

export const DEFAULT_COLORS = {
  accentText: '#FFFFFF',
  barBg: '#FFFFFF', barText: '#111827',
  cardBg: '#FFFFFF', cardText: '#111827',
  homeText: '#FFFFFF',
  bannerBg: '#FEF3C7', bannerText: '#78350F',
  navBg: '#111827', navText: '#E5E7EB',
};

/** Ready-made themes. Each sets the button colour and every block's colours. */
export const PRESETS = [
  { id: 'teal', name: 'Teal', accent: '#0F766E', colors: { ...DEFAULT_COLORS } },
  { id: 'ocean', name: 'Ocean', accent: '#1D4ED8', colors: { ...DEFAULT_COLORS, navBg: '#0B1F4D' } },
  { id: 'sunshine', name: 'Sunshine', accent: '#FACC15', colors: { ...DEFAULT_COLORS, accentText: '#111827', barBg: '#111827', barText: '#FFFFFF', navBg: '#111827' } },
  { id: 'dark', name: 'Dark', accent: '#FACC15', colors: { accentText: '#111827', barBg: '#111827', barText: '#F9FAFB', cardBg: '#1F2937', cardText: '#F9FAFB', homeText: '#FFFFFF', bannerBg: '#FACC15', bannerText: '#111827', navBg: '#030712', navText: '#E5E7EB' } },
  { id: 'forest', name: 'Forest', accent: '#166534', colors: { ...DEFAULT_COLORS, barBg: '#F0FDF4', navBg: '#052E16', navText: '#DCFCE7' } },
  { id: 'berry', name: 'Berry', accent: '#7C3AED', colors: { ...DEFAULT_COLORS, navBg: '#2E1065', navText: '#EDE9FE' } },
  { id: 'ember', name: 'Ember', accent: '#C2410C', colors: { ...DEFAULT_COLORS, barBg: '#1C1917', barText: '#FAFAF9', navBg: '#1C1917' } },
  { id: 'mono', name: 'Mono', accent: '#111827', colors: { ...DEFAULT_COLORS, bannerBg: '#E5E7EB', bannerText: '#111827' } },
];

const hex = (h) => /^#[0-9a-f]{6}$/i.test(h || '');

function luminance(h) {
  const n = parseInt(h.slice(1), 16);
  const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** WCAG contrast ratio between two colours (1 to 21). */
export function contrast(a, b) {
  if (!hex(a) || !hex(b)) return 21;
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** True when light text / a light logo belongs on this colour. */
export const isDark = (h) => (hex(h) ? luminance(h) < 0.179 : true);

/** Black or white, whichever reads better on the colour. */
export const readableOn = (h) => (isDark(h) ? '#FFFFFF' : '#111827');

export const colorsOf = (b) => ({ ...DEFAULT_COLORS, ...(b?.colors || {}) });

/**
 * The right logo for a background colour: the "dark backgrounds" logo on dark colours,
 * the "light backgrounds" logo on light ones. Falls back to whichever was uploaded, then the built-in logo.
 */
export function logoFor(b, bg) {
  if (isDark(bg)) return b?.logo || b?.logoOnLight || '/logo-white.svg';
  return b?.logoOnLight || b?.logo || '/logo.svg';
}

/** Put the theme into CSS variables on the page. */
export function applyTheme(b, el = document.documentElement) {
  if (!b) return;
  const c = colorsOf(b);
  const set = (k, v) => el.style.setProperty(k, v);
  if (hex(b.accent)) set('--accent', b.accent);
  set('--accent-ink', c.accentText);
  set('--bar-bg', c.barBg);
  set('--bar-ink', c.barText);
  set('--card-bg', c.cardBg);
  set('--card-ink', c.cardText);
  set('--home-ink', c.homeText);
  set('--banner-bg', c.bannerBg);
  set('--banner-ink', c.bannerText);
  set('--nav-bg', c.navBg);
  set('--nav-ink', c.navText);
}
