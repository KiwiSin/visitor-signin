// Which business this page is for. Business pages live under /b/<slug>/ (kiosk, admin, roll call, setup).
// Pages without /b/<slug> are for the default business (or, with BASE_DOMAIN, the business in the subdomain).
const m = /^\/b\/([a-z0-9-]{1,48})(?=\/|$)/.exec(window.location.pathname);

export const slug = m ? m[1] : null;

/** Router base path for this page. */
export const basename = slug ? `/b/${slug}` : '';

/** Address of a page in this business: appPath('/kiosk') -> /b/acme/kiosk */
export const appPath = (p) => `${basename}${p}`;

/** Address of an API call for this business: apiUrl('/api/admin/visits.csv') -> /api/b/acme/admin/visits.csv */
export const apiUrl = (p) => (slug && p.startsWith('/api/') && !p.startsWith('/api/host/') ? `/api/b/${slug}/${p.slice(5)}` : p);
