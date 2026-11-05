import crypto from 'node:crypto';
import path from 'node:path';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import type { Config } from './config.js';
import { ROOT } from './paths.js';

export const DATA_KEYS = ['gl_garden', 'gl_fav', 'gl_exp', 'gl_chats', 'gl_cam'];

const block = z.object({ type: z.enum(['text', 'image', 'tool_use', 'tool_result']) }).passthrough();
const aiBody = z.object({
  system: z.string().max(8000).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.union([z.string().max(20000), z.array(block).max(20)]),
      }),
    )
    .min(1)
    .max(40),
  tools: z
    .array(
      z.object({
        name: z.string().max(64),
        description: z.string().max(1000),
        input_schema: z.record(z.unknown()),
      }),
    )
    .max(5)
    .optional(),
});

function identify(db: Database.Database, cfg: Config): RequestHandler {
  const insert = db.prepare('INSERT OR IGNORE INTO users (id) VALUES (?)');
  return (req, res, next) => {
    let uid = /(?:^|;\s*)gl_uid=([a-f0-9]{48})/.exec(req.headers.cookie ?? '')?.[1];
    if (!uid) {
      uid = crypto.randomBytes(24).toString('hex');
      res.append(
        'Set-Cookie',
        `gl_uid=${uid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${cfg.secureCookies ? '; Secure' : ''}`,
      );
    }
    insert.run(uid);
    res.locals.uid = uid;
    next();
  };
}

export function createApp(db: Database.Database, cfg: Config): express.Express {
  const app = express();
  app.disable('x-powered-by');
  if (cfg.trustProxy) app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ['https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          'upgrade-insecure-requests': null,
        },
      },
    }),
  );

  app.get('/api/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, ai: Boolean(cfg.anthropicKey) });
  });

  const api = express.Router();
  api.use(identify(db, cfg));

  api.get('/data', (_req, res) => {
    const rows = db.prepare('SELECT key, value FROM user_data WHERE user_id = ?').all(res.locals.uid) as {
      key: string;
      value: string;
    }[];
    res.json({ data: Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value) as unknown])) });
  });

  api.put('/data/:key', express.json({ limit: '8mb' }), (req, res) => {
    const key = String(req.params.key);
    const parsed = z.object({ value: z.unknown().refine((v) => v !== undefined) }).safeParse(req.body);
    if (!DATA_KEYS.includes(key) || !parsed.success) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    db.prepare(
      `INSERT INTO user_data (user_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(res.locals.uid, key, JSON.stringify(parsed.data.value));
    res.json({ ok: true });
  });

  api.delete('/data/:key', (req, res) => {
    db.prepare('DELETE FROM user_data WHERE user_id = ? AND key = ?').run(res.locals.uid, String(req.params.key));
    res.json({ ok: true });
  });

  const aiLimit = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
  api.post('/ai/messages', aiLimit, express.json({ limit: '12mb' }), async (req, res) => {
    if (!cfg.anthropicKey) {
      res.status(503).json({ error: 'ai_not_configured' });
      return;
    }
    const parsed = aiBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    try {
      const upstream = await fetch(`${cfg.anthropicBase}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': cfg.anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model: cfg.anthropicModel, max_tokens: 1500, ...parsed.data }),
        signal: AbortSignal.timeout(60_000),
      });
      const text = await upstream.text();
      if (!upstream.ok) {
        console.error('AI upstream error', upstream.status);
        res.status(upstream.status === 429 ? 429 : 502).json({ error: 'upstream_error' });
        return;
      }
      res.type('json').send(text);
    } catch {
      res.status(502).json({ error: 'upstream_unreachable' });
    }
  });

  app.use('/api', api);
  app.use(
    express.static(path.join(ROOT, 'public'), {
      setHeaders: (res, file) => {
        if (/(sw\.js|index\.html)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: status === 413 ? 'too_large' : 'server_error' });
  });
  return app;
}
