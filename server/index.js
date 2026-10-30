import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { migrate, pool, waitForDb } from './db.js';
import adminRoutes from './routes/admin.js';
import authRoutes, { prepareSetup } from './routes/auth.js';
import kioskRoutes from './routes/kiosk.js';
import { startWorker } from './worker.js';

export async function buildApp({ logger = true } = {}) {
  const app = Fastify({
    logger: logger ? { level: process.env.LOG_LEVEL || 'info' } : false,
    trustProxy: config.trustProxy,
    bodyLimit: 2 * 1024 * 1024, // signatures + CSV imports
  });

  await app.register(cookie, { secret: config.secretKey });
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

  // Basic security headers for every response.
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    return payload;
  });

  app.setErrorHandler((err, request, reply) => {
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) request.log.error(err);
    reply.code(status).send({ error: status >= 500 ? 'Something went wrong on the server. Please try again.' : err.message });
  });

  await app.register(authRoutes);
  await app.register(kioskRoutes);
  await app.register(adminRoutes);

  // Uploaded logos and wallpapers (signatures live in a private folder and are never served here).
  const publicUploads = path.join(config.uploadDir, 'public');
  fs.mkdirSync(publicUploads, { recursive: true });
  fs.mkdirSync(path.join(config.uploadDir, 'private'), { recursive: true });
  await app.register(fastifyStatic, {
    root: publicUploads,
    prefix: '/uploads/',
    decorateReply: false,
    maxAge: '7d',
  });

  // The built web app (kiosk, admin). Unknown non-API paths fall back to index.html.
  const hasWeb = fs.existsSync(path.join(config.webDist, 'index.html'));
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      prefix: '/',
      setHeaders(res, filePath) {
        if (filePath.endsWith('index.html') || filePath.endsWith('sw.js') || filePath.endsWith('.webmanifest')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    });
  }
  app.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' && !request.url.startsWith('/api/') && !request.url.startsWith('/uploads/') && hasWeb) {
      reply.header('Cache-Control', 'no-cache');
      return reply.sendFile('index.html', config.webDist);
    }
    return reply.code(404).send({ error: 'Not found' });
  });

  return app;
}

async function main() {
  const app = await buildApp();
  await waitForDb(app.log);
  await migrate(app.log);
  await prepareSetup(app.log);
  const stopWorker = startWorker(app.log);

  const shutdown = async (signal) => {
    app.log.info(`${signal} received, shutting down`);
    stopWorker();
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Visitor Sign-In running on ${config.appUrl}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
