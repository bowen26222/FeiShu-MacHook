import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/** Expand a leading `~` to the user's home directory. */
function expandHome(p: string): string {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

const csv = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const schema = z.object({
  APP_ID: z.string().min(1, 'APP_ID is required'),
  APP_SECRET: z.string().min(1, 'APP_SECRET is required'),
  LARK_DOMAIN: z.enum(['feishu', 'lark']).default('feishu'),

  ALLOWED_CHAT_IDS: z.string().optional(),
  ADMIN_USER_IDS: z.string().optional(),

  SCREEN_SESSION: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/, 'SCREEN_SESSION must match [A-Za-z0-9_-]+')
    .default('mc'),
  MC_START_SCRIPT: z.string().min(1, 'MC_START_SCRIPT is required'),
  MC_GRACEFUL_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  MC_STARTUP_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),
});

const parsed = schema.parse(process.env);

const startScriptAbs = path.resolve(expandHome(parsed.MC_START_SCRIPT));

// Soft-check: warn but don't crash if the script does not (yet) exist; user may
// create it later. We do however require the directory to be resolvable.
const scriptDir = path.dirname(startScriptAbs);

const allowedChatIds = csv(parsed.ALLOWED_CHAT_IDS);
const adminUserIds = csv(parsed.ADMIN_USER_IDS);

if (allowedChatIds.length === 0) {
  // eslint-disable-next-line no-console
  console.warn(
    '[config] ALLOWED_CHAT_IDS is empty — the bot will ignore ALL messages. Set it in .env to enable.',
  );
}
if (adminUserIds.length === 0) {
  // eslint-disable-next-line no-console
  console.warn(
    '[config] ADMIN_USER_IDS is empty — no user will be authorised to run commands.',
  );
}

export const config = {
  appId: parsed.APP_ID,
  appSecret: parsed.APP_SECRET,
  larkDomain: parsed.LARK_DOMAIN,

  allowedChatIds,
  adminUserIds,

  screenSession: parsed.SCREEN_SESSION,
  mcStartScript: startScriptAbs,
  mcStartScriptDir: scriptDir,
  mcStartScriptExists: fs.existsSync(startScriptAbs),
  mcGracefulTimeoutMs: parsed.MC_GRACEFUL_TIMEOUT_MS,
  mcStartupTimeoutMs: parsed.MC_STARTUP_TIMEOUT_MS,

  logLevel: parsed.LOG_LEVEL,
} as const;

export type AppConfig = typeof config;
