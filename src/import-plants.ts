import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type Database from 'better-sqlite3';

export interface PlantCsvResult {
  parsed: number;
  inserted: number;
  skipped: number;
  accepted: number;
  synonyms: number;
}

/** Parse a CSV file, including quoted fields, doubled quotes, a BOM and CRLF line endings. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const c = src.charAt(i);
    if (quoted) {
      if (c === '"') {
        if (src.charAt(i + 1) === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function importPlants(db: Database.Database, rows: string[][]): PlantCsvResult {
  const header = rows[0];
  if (!header) throw new Error('The CSV file is empty.');

  const index = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const columns = {
    symbol: index('symbol'),
    synonym: index('synonym symbol'),
    scientific: index('scientific name with author'),
    common: index('common name'),
    family: index('family'),
  };
  if (Object.values(columns).some((i) => i < 0)) {
    throw new Error(
      'Unexpected CSV columns. Expected Symbol, Synonym Symbol, Scientific Name with Author, Common Name and Family.',
    );
  }

  const value = (row: string[], column: number) => (row[column] ?? '').trim();
  const records = rows
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim() !== ''))
    .map((row) => {
      const synonym = value(row, columns.synonym);
      return {
        symbol: value(row, columns.symbol),
        synonym,
        scientific: value(row, columns.scientific),
        common: value(row, columns.common),
        family: value(row, columns.family),
        accepted: synonym === '' ? 1 : 0,
      };
    });

  let skipped = 0;
  let accepted = 0;
  let synonyms = 0;
  const insert = db.prepare(
    `INSERT INTO plants (symbol, synonym_symbol, scientific_name, common_name, family, accepted)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  let inserted = 0;

  db.transaction(() => {
    db.prepare('DELETE FROM plants').run();
    for (const record of records) {
      if (!record.symbol || !record.scientific) {
        skipped++;
        continue;
      }
      insert.run(
        record.symbol,
        record.synonym,
        record.scientific,
        record.common,
        record.family,
        record.accepted,
      );
      inserted++;
      if (record.accepted) accepted++;
      else synonyms++;
    }
  })();

  return { parsed: records.length, inserted, skipped, accepted, synonyms };
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: npm run import:plants -- <path-to-plantlst.csv>');
    process.exitCode = 1;
    return;
  }

  const full = path.resolve(file);
  if (!fs.existsSync(full)) {
    console.error(`File not found: ${full}`);
    process.exitCode = 1;
    return;
  }

  const [{ loadConfig }, { openDb }, { migrate }] = await Promise.all([
    import('./config.js'),
    import('./db.js'),
    import('./migrate.js'),
  ]);
  const cfg = loadConfig();
  const db = openDb(cfg.databasePath);
  try {
    const ran = migrate(db);
    if (ran.length) console.log(`Applied migrations: ${ran.join(', ')}`);
    const rows = parseCsv(fs.readFileSync(full, 'utf8'));
    const result = importPlants(db, rows);
    console.log(`Read ${result.parsed.toLocaleString()} rows from ${full}`);
    console.log(
      `Imported ${result.inserted.toLocaleString()} plant names into ${cfg.databasePath} ` +
        `(${result.accepted.toLocaleString()} accepted, ${result.synonyms.toLocaleString()} synonyms` +
        `${result.skipped ? `, ${result.skipped.toLocaleString()} skipped` : ''}).`,
    );
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
