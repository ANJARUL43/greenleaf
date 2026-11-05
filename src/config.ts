export interface Config {
  port: number;
  env: string;
  databasePath: string;
  anthropicKey: string | undefined;
  anthropicModel: string;
  anthropicBase: string;
  secureCookies: boolean;
  trustProxy: boolean;
}

export function loadConfig(e: NodeJS.ProcessEnv = process.env): Config {
  const env = e.NODE_ENV ?? 'development';
  return {
    port: Number(e.PORT ?? 3000),
    env,
    databasePath: e.DATABASE_PATH ?? './data/greenleaf.db',
    anthropicKey: e.ANTHROPIC_API_KEY || undefined,
    anthropicModel: e.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5',
    anthropicBase: e.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
    secureCookies: env === 'production',
    trustProxy: e.TRUST_PROXY === 'true',
  };
}
