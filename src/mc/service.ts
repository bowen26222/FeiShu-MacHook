import { config } from '../config';
import { logger } from '../logger';
import {
  pkillByScript,
  quitSession,
  sendStuff,
  sessionExists,
  startSession,
  waitUntilGone,
  waitUntilUp,
} from './screen';

export type Action = 'status' | 'stop' | 'kill' | 'restart';

export interface ActionResult {
  ok: boolean;
  /** Human-friendly summary, sent back to the Feishu chat. */
  message: string;
}

// ---------- A simple async mutex so commands run serially ----------
let chain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  // swallow rejections on the chain so a previous failure doesn't poison future calls
  chain = next.catch(() => undefined);
  return next;
}

// ---------- Public API ----------

export function runAction(action: Action): Promise<ActionResult> {
  return withLock(() => {
    switch (action) {
      case 'status':
        return statusAction();
      case 'stop':
        return stopAction();
      case 'kill':
        return killAction();
      case 'restart':
        return restartAction();
    }
  });
}

// ---------- Implementations ----------

async function statusAction(): Promise<ActionResult> {
  const up = await sessionExists(config.screenSession);
  return {
    ok: true,
    message: up
      ? `🟢 MC 服务器运行中（screen 会话: ${config.screenSession}）`
      : `⚪ MC 服务器已停止（无 screen 会话: ${config.screenSession}）`,
  };
}

async function stopAction(): Promise<ActionResult> {
  if (!(await sessionExists(config.screenSession))) {
    return { ok: true, message: 'ℹ️ MC 服务器本就未运行，无需 stop。' };
  }
  logger.info('Sending `stop` to MC console...');
  await sendStuff(config.screenSession, 'stop\n');
  const gone = await waitUntilGone(config.screenSession, config.mcGracefulTimeoutMs);
  if (gone) {
    return { ok: true, message: '✅ MC 服务器已优雅停止。' };
  }
  return {
    ok: false,
    message: `⚠️ 在 ${Math.round(config.mcGracefulTimeoutMs / 1000)}s 内未优雅退出，请改用 \`/mc kill\` 强制结束。`,
  };
}

async function killAction(): Promise<ActionResult> {
  const wasUp = await sessionExists(config.screenSession);
  if (wasUp) {
    logger.warn('Force-quitting screen session...');
    try {
      await quitSession(config.screenSession);
    } catch (err) {
      logger.warn({ err }, 'screen quit failed, will try pkill fallback');
    }
  }
  // pkill fallback for any java process still bound to the start script path
  await pkillByScript(config.mcStartScript);
  const gone = await waitUntilGone(config.screenSession, 5_000, 250);
  if (gone) {
    return {
      ok: true,
      message: wasUp
        ? '✅ 已强制终止 MC 服务器（screen quit + pkill 兜底）。'
        : 'ℹ️ MC 服务器本就未运行，已做一次清理兜底。',
    };
  }
  return { ok: false, message: '❌ kill 后 screen 会话仍存在，请登录 Mac 手动检查。' };
}

async function startAction(): Promise<ActionResult> {
  if (await sessionExists(config.screenSession)) {
    return { ok: true, message: '⚠️ MC 服务器已在运行，跳过启动。' };
  }
  if (!config.mcStartScriptExists) {
    return {
      ok: false,
      message: `❌ 启动脚本不存在：${config.mcStartScript}`,
    };
  }
  logger.info({ script: config.mcStartScript }, 'Starting MC via screen...');
  await startSession(config.screenSession, config.mcStartScript, config.mcStartScriptDir);
  const up = await waitUntilUp(config.screenSession, config.mcStartupTimeoutMs);
  if (up) {
    return { ok: true, message: '✅ MC 服务器已启动（screen 会话已建立，载入世界可能仍需数十秒）。' };
  }
  return { ok: false, message: '❌ 启动后未检测到 screen 会话，请到 Mac 上排查启动脚本。' };
}

async function restartAction(): Promise<ActionResult> {
  const startedRunning = await sessionExists(config.screenSession);
  if (startedRunning) {
    const stopRes = await stopAction();
    if (!stopRes.ok) {
      // graceful failed -> escalate to kill
      logger.warn('Graceful stop failed during restart, escalating to kill');
      const killRes = await killAction();
      if (!killRes.ok) {
        return { ok: false, message: `❌ restart 失败：${killRes.message}` };
      }
    }
  }
  const startRes = await startAction();
  if (!startRes.ok) {
    return { ok: false, message: `❌ restart 失败：${startRes.message}` };
  }
  return {
    ok: true,
    message: startedRunning
      ? '🔄 MC 服务器已重启完成。'
      : '🔄 MC 服务器原本未运行，已直接启动。',
  };
}
