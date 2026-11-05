import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { openDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { importPlants, parseCsv } from '../src/import-plants.js';

async function start(env: NodeJS.ProcessEnv = {}) {
  const db = openDb(':memory:');
  migrate(db);
  const server = createApp(db, loadConfig(env)).listen(0);
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    db,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      }),
  };
}
const cookieOf = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
const json = { 'content-type': 'application/json' };

test('migrations apply once and are idempotent', () => {
  const db = openDb(':memory:');
  assert.deepEqual(migrate(db), ['001_init.sql', '002_plants.sql']);
  assert.deepEqual(migrate(db), []);
});

test('plant CSV parser handles BOM, quoted commas, doubled quotes and CRLF', () => {
  const rows = parseCsv(
    '\uFEFF"Symbol","Synonym Symbol","Scientific Name with Author","Common Name","Family"\r\n' +
      '"ABAL3","","Abies alba Mill.","silver, ""true"" fir","Pinaceae"\r\n' +
      '"ABAM","ABAM2","Abies amabilis Douglas ex Forbes","","Pinaceae"\r\n',
  );
  assert.deepEqual(rows[0], [
    'Symbol',
    'Synonym Symbol',
    'Scientific Name with Author',
    'Common Name',
    'Family',
  ]);
  assert.deepEqual(rows[1], ['ABAL3', '', 'Abies alba Mill.', 'silver, "true" fir', 'Pinaceae']);
  assert.deepEqual(rows[2], ['ABAM', 'ABAM2', 'Abies amabilis Douglas ex Forbes', '', 'Pinaceae']);
});

test('plant CSV import replaces the catalogue and records accepted status', () => {
  const db = openDb(':memory:');
  migrate(db);
  const rows = parseCsv(
    'Symbol,Synonym Symbol,Scientific Name with Author,Common Name,Family\n' +
      'ROSA,,Rosa rubiginosa L.,sweetbriar rose,Rosaceae\n' +
      'ROSY,ROSA,Rosa canina L.,,Rosaceae\n' +
      'BROKEN,,,,\n',
  );
  const result = importPlants(db, rows);
  assert.deepEqual(result, { parsed: 3, inserted: 2, skipped: 1, accepted: 1, synonyms: 1 });
  const count = (db.prepare('SELECT COUNT(*) AS n FROM plants').get() as { n: number }).n;
  assert.equal(count, 2);
  importPlants(db, rows);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM plants').get() as { n: number }).n, 2);
});

test('plant search validates input, escapes wildcards and returns names', async () => {
  const s = await start();
  try {
    const insert = s.db.prepare(
      `INSERT INTO plants (symbol, synonym_symbol, scientific_name, common_name, family, accepted)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insert.run('ROSA', '', 'Rosa rubiginosa L.', 'sweetbriar rose', 'Rosaceae', 1);
    insert.run('MANG', '', 'Mangifera indica L.', 'mango', 'Anacardiaceae', 1);
    insert.run('ROSY', 'ROSA', 'Rosa canina L.', '', 'Rosaceae', 0);

    const res = await fetch(`${s.url}/api/plants?q=rose`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      total: number;
      limit: number;
      offset: number;
      items: {
        symbol: string;
        synonymSymbol: string;
        scientificName: string;
        commonName: string;
        family: string;
        accepted: boolean;
      }[];
    };
    assert.equal(body.total, 1);
    assert.equal(body.limit, 20);
    assert.equal(body.offset, 0);
    assert.deepEqual(body.items[0], {
      symbol: 'ROSA',
      synonymSymbol: '',
      scientificName: 'Rosa rubiginosa L.',
      commonName: 'sweetbriar rose',
      family: 'Rosaceae',
      accepted: true,
    });

    const synonym = (await (await fetch(`${s.url}/api/plants?q=canina`)).json()) as {
      items: { accepted: boolean }[];
    };
    assert.equal(synonym.items[0]?.accepted, false);

    const family = (await (await fetch(`${s.url}/api/plants?q=Rosaceae`)).json()) as { total: number };
    assert.equal(family.total, 2);

    assert.equal((await fetch(`${s.url}/api/plants?q=a`)).status, 400);
    assert.equal((await fetch(`${s.url}/api/plants`)).status, 400);
    assert.equal((await fetch(`${s.url}/api/plants?q=rose&limit=51`)).status, 400);
    const wildcard = (await (await fetch(`${s.url}/api/plants?q=%25%25`)).json()) as { total: number };
    assert.equal(wildcard.total, 0);
  } finally {
    await s.close();
  }
});

test('health endpoint reports AI status', async () => {
  const s = await start();
  try {
    const body = (await (await fetch(`${s.url}/api/health`)).json()) as { ok: boolean; ai: boolean };
    assert.deepEqual(body, { ok: true, ai: false });
  } finally {
    await s.close();
  }
});

test('data round trip is per user', async () => {
  const s = await start();
  try {
    const c = cookieOf(await fetch(`${s.url}/api/data`));
    assert.match(c, /^gl_uid=[a-f0-9]{48}$/);
    const put = await fetch(`${s.url}/api/data/gl_garden`, { method: 'PUT', headers: { ...json, cookie: c }, body: JSON.stringify({ value: [{ id: 1 }] }) });
    assert.equal(put.status, 200);
    const mine = (await (await fetch(`${s.url}/api/data`, { headers: { cookie: c } })).json()) as { data: Record<string, unknown> };
    assert.deepEqual(mine.data.gl_garden, [{ id: 1 }]);
    const other = (await (await fetch(`${s.url}/api/data`)).json()) as { data: object };
    assert.deepEqual(other.data, {});
  } finally {
    await s.close();
  }
});

test('rejects unknown keys and malformed bodies', async () => {
  const s = await start();
  try {
    const bad = await fetch(`${s.url}/api/data/not_allowed`, { method: 'PUT', headers: json, body: JSON.stringify({ value: 1 }) });
    assert.equal(bad.status, 400);
    const empty = await fetch(`${s.url}/api/data/gl_fav`, { method: 'PUT', headers: json, body: '{}' });
    assert.equal(empty.status, 400);
  } finally {
    await s.close();
  }
});

test('AI endpoint says it is unavailable without a key', async () => {
  const s = await start();
  try {
    const r = await fetch(`${s.url}/api/ai/messages`, { method: 'POST', headers: json, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
    assert.equal(r.status, 503);
  } finally {
    await s.close();
  }
});

test('AI proxy adds the key server-side and ignores client model overrides', async () => {
  let seen: { headers: http.IncomingHttpHeaders; body: Record<string, unknown> } | undefined;
  const upstream = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d: Buffer) => (raw += d.toString()));
    req.on('end', () => {
      seen = { headers: req.headers, body: JSON.parse(raw) as Record<string, unknown> };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ content: [{ type: 'text', text: 'hello' }], stop_reason: 'end_turn' }));
    });
  });
  await new Promise<void>((r) => upstream.listen(0, r));
  const base = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  const s = await start({ ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: base, ANTHROPIC_MODEL: 'model-x' });
  try {
    const r = await fetch(`${s.url}/api/ai/messages`, { method: 'POST', headers: json, body: JSON.stringify({ model: 'evil', max_tokens: 99999, messages: [{ role: 'user', content: 'hi' }] }) });
    assert.equal(r.status, 200);
    const out = (await r.json()) as { content: { text: string }[] };
    assert.equal(out.content[0]?.text, 'hello');
    assert.equal(seen?.headers['x-api-key'], 'test-key');
    assert.equal(seen?.body.model, 'model-x');
    assert.equal(seen?.body.max_tokens, 1500);
    const bad = await fetch(`${s.url}/api/ai/messages`, { method: 'POST', headers: json, body: JSON.stringify({ messages: [] }) });
    assert.equal(bad.status, 400);
  } finally {
    await s.close();
    upstream.closeAllConnections();
    upstream.close();
  }
});
