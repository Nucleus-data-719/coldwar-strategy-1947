import { config } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

// Load the repo-root .env (works from dist/ and when started from apps/server or the root).
for (const p of [
  resolve(__dirname, '../../../../.env'),
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../../.env'),
]) {
  config({ path: p });
}

const bool = (def: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(def)
    .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_URL_DIRECT: z.string().optional(),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  GAME_SPEED: z.coerce.number().positive().default(1),
  TICK_MS: z.coerce.number().int().min(500).default(5000),
  INACTIVITY_HOURS: z.coerce.number().positive().default(48),
  AI_INTERVAL_SECONDS: z.coerce.number().positive().default(300),
  AI_WAR_INTERVAL_SECONDS: z.coerce.number().positive().default(60),
  SCHEDULER_ENABLED: bool('true'),
  ALLOW_CAMPAIGN_CREATION: bool('true'),
  // Closed beta: when set, registering needs one of these comma-separated codes.
  BETA_INVITE_CODES: z.string().default(''),
  // Secret for GET /api/metrics (send it in the x-admin-token header). Empty = metrics off.
  ADMIN_TOKEN: z.string().default(''),
  // Rate limits per client address per minute: all requests, and sign-in/registration. Raise both only for load tests.
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(240),
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
  SLOW_REQUEST_MS: z.coerce.number().int().positive().default(500),
  // How many AI countries decide at the same time, and the most per tick.
  AI_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(4),
  AI_MAX_PER_TICK: z.coerce.number().int().min(1).default(40),
  // Set to 1 when the server sits behind a proxy (Render, Railway, nginx) so rate limits see real client addresses.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('\nInvalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\nCopy .env.example to .env in the project root and fill in the values.\n');
  process.exit(1);
}

export const env = parsed.data;
