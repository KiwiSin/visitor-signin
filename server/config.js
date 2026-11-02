import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    console.error(`Missing required environment variable ${name}`);
    process.exit(1);
  }
  return v;
}

const appUrl = (process.env.APP_URL || 'http://localhost:8080').replace(/\/+$/, '');

export const config = {
  root,
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  databaseUrl: required('DATABASE_URL'),
  secretKey: required('SECRET_KEY', process.env.NODE_ENV === 'production' ? undefined : 'dev-secret-key-change-me'),
  appUrl,
  secureCookies: appUrl.startsWith('https://'),
  trustProxy: (process.env.TRUST_PROXY ?? 'true') !== 'false',
  uploadDir: process.env.UPLOAD_DIR || path.join(root, 'data', 'uploads'),
  webDist: path.join(root, 'web', 'dist'),
  migrationsDir: path.join(root, 'migrations'),
  timeZone: process.env.TZ || 'Pacific/Auckland',
  // Optional: serve each business on its own subdomain, e.g. BASE_DOMAIN=signin.example.com -> acme.signin.example.com
  baseDomain: (process.env.BASE_DOMAIN || '').toLowerCase().replace(/^\.+|\.+$/g, ''),
  // Optional: which business opens at the plain addresses (/admin, /kiosk). Defaults to the first one.
  defaultBusiness: (process.env.DEFAULT_BUSINESS || '').toLowerCase(),
};
