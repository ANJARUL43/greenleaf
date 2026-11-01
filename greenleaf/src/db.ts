import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export function openDb(file: string): Database.Database {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
