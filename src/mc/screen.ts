import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../logger';

const execFileP = promisify(execFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Run a command without spawning a shell. Never throws on non-zero exit. */
async function run(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileP(cmd, args, {
      cwd: opts.cwd,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { stdout: stdout.toString(), stderr: stderr.toString(), code: 0 };
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { stdout?: Buffer | string; stderr?: Buffer | string; code?: number | string };
    return {
      stdout: e.stdout ? e.stdout.toString() : '',
      stderr: e.stderr ? e.stderr.toString() : String(e.message ?? e),
      code: typeof e.code === 'number' ? e.code : 1,
    };
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Quote and validate a screen session name (defensive). */
function assertSession(name: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(`Illegal screen session name: ${name}`);
  }
}

/**
 * Check if a screen session with the given name exists.
 * `screen -ls` exits 1 when there are no sessions, which is fine — we only look at stdout.
 */
export async function sessionExists(name: string): Promise<boolean> {
  assertSession(name);
  const { stdout } = await run('screen', ['-ls']);
  // Lines look like:  "\t12345.mc\t(Detached)"
  const re = new RegExp(`\\b\\d+\\.${name}\\b`);
  return re.test(stdout);
}

/**
 * Send raw keystrokes to the screen session's window 0.
 * The text is passed verbatim; include "\n" to submit a command.
 */
export async function sendStuff(name: string, text: string): Promise<void> {
  assertSession(name);
  const { code, stderr } = await run('screen', ['-S', name, '-p', '0', '-X', 'stuff', text]);
  if (code !== 0) {
    throw new Error(`screen stuff failed (code ${code}): ${stderr.trim()}`);
  }
}

/** Force-quit the entire screen session (does NOT gracefully stop MC). */
export async function quitSession(name: string): Promise<void> {
  assertSession(name);
  const { code, stderr } = await run('screen', ['-S', name, '-X', 'quit']);
  if (code !== 0 && !/No screen session found/i.test(stderr)) {
    throw new Error(`screen quit failed (code ${code}): ${stderr.trim()}`);
  }
}

/**
 * Start a fresh detached screen session that runs the given script via bash.
 * `cwd` defaults to the script's directory.
 */
export async function startSession(name: string, scriptAbsPath: string, cwd: string): Promise<void> {
  assertSession(name);
  const { code, stderr } = await run('screen', ['-dmS', name, 'bash', scriptAbsPath], { cwd });
  if (code !== 0) {
    throw new Error(`screen start failed (code ${code}): ${stderr.trim()}`);
  }
}

/** Poll until the session disappears or timeout. */
export async function waitUntilGone(name: string, timeoutMs: number, intervalMs = 500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await sessionExists(name))) return true;
    await sleep(intervalMs);
  }
  return false;
}

/** Poll until the session appears or timeout. */
export async function waitUntilUp(name: string, timeoutMs: number, intervalMs = 500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await sessionExists(name)) return true;
    await sleep(intervalMs);
  }
  return false;
}

/**
 * Best-effort: kill lingering java processes whose command line references the start script.
 * Used only as a fallback in `kill` and never as the primary path.
 */
export async function pkillByScript(scriptAbsPath: string): Promise<void> {
  // -f matches the full command line; -9 SIGKILL.
  const { code, stderr } = await run('pkill', ['-9', '-f', scriptAbsPath]);
  // pkill exits 1 when nothing matched — that's success for us.
  if (code !== 0 && code !== 1) {
    logger.warn({ code, stderr: stderr.trim() }, 'pkill fallback exited unexpectedly');
  }
}
