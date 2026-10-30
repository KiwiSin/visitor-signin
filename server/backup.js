// Nightly backup of the database and uploaded files.
// Runs as the "backup" service in docker-compose.yml.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const BACKUP_DIR = process.env.BACKUP_DIR || '/backups';
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/uploads';
const HOUR = Math.min(23, Math.max(0, Number(process.env.BACKUP_HOUR ?? 2)));
const KEEP_DAYS = Math.max(1, Number(process.env.BACKUP_KEEP_DAYS ?? 30));
const DATABASE_URL = process.env.DATABASE_URL;

const log = (msg) => console.log(`[backup ${new Date().toISOString()}] ${msg}`);

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export async function backupOnce() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const s = stamp();
  const dbFile = path.join(BACKUP_DIR, `visitor-db-${s}.dump`);
  await run('pg_dump', ['--format=custom', `--file=${dbFile}`, DATABASE_URL], { maxBuffer: 1024 * 1024 * 64 });
  log(`Database saved to ${dbFile}`);
  const upFile = path.join(BACKUP_DIR, `visitor-uploads-${s}.tar.gz`);
  try {
    await run('tar', ['-czf', upFile, '-C', UPLOAD_DIR, '.']);
    log(`Uploads saved to ${upFile}`);
  } catch (err) {
    log(`Uploads not saved: ${err.message}`);
  }
  // Remove backups older than KEEP_DAYS.
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  for (const f of await fs.readdir(BACKUP_DIR)) {
    if (!/^visitor-(db|uploads)-/.test(f)) continue;
    const full = path.join(BACKUP_DIR, f);
    const st = await fs.stat(full);
    if (st.mtimeMs < cutoff) {
      await fs.rm(full, { force: true });
      log(`Removed old backup ${f}`);
    }
  }
}

function msUntilNextRun() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

async function loop() {
  if (!DATABASE_URL) {
    log('DATABASE_URL is not set; backups disabled.');
    return;
  }
  log(`Backups run daily at ${HOUR}:00 (${process.env.TZ || 'UTC'}), kept for ${KEEP_DAYS} days, saved in ${BACKUP_DIR}`);
  const schedule = () => {
    const wait = msUntilNextRun();
    log(`Next backup in ${Math.round(wait / 60000)} minutes`);
    setTimeout(async () => {
      try {
        await backupOnce();
      } catch (err) {
        log(`Backup FAILED: ${err.stderr || err.message}`);
      }
      schedule();
    }, wait);
  };
  schedule();
}

if (process.argv.includes('--now')) {
  backupOnce().then(() => process.exit(0), (err) => { log(`Backup FAILED: ${err.stderr || err.message}`); process.exit(1); });
} else {
  loop();
}
