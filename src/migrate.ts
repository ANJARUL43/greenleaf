import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type Database from 'better-sqlite3';
import { ROOT } from './paths.js';

export function migrate(db: Database.Database, dir = path.join(ROOT, 'migrations')): string[] {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  );
  const done = new Set(
    (db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name),
  );
  const ran: string[] = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    db.transaction(() => {
      db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(f);
    })();
    ran.push(f);
  }
  return ran;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { loadConfig } = await import('./config.js');
  const { openDb } = await import('./db.js');
  const ran = migrate(openDb(loadConfig().databasePath));
  console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date.');
}
