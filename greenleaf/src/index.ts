import 'dotenv/config';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { migrate } from './migrate.js';
import { createApp } from './server.js';

const cfg = loadConfig();
const db = openDb(cfg.databasePath);
const ran = migrate(db);
if (ran.length) console.log('Applied migrations:', ran.join(', '));
createApp(db, cfg).listen(cfg.port, () => {
  console.log(`GreenLeaf running on http://localhost:${cfg.port} (AI ${cfg.anthropicKey ? 'configured' : 'not configured'})`);
});
