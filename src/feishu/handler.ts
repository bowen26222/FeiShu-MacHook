import * as lark from '@larksuiteoapi/node-sdk';
import { config } from '../config';
import { logger } from '../logger';
import { runAction, type Action } from '../mc/service';
import { replyText } from './client';

const HELP_TEXT = [
  '🤖 MC 控制机器人指令：',
  '  /mc status   — 查看服务器状态',
  '  /mc stop     — 优雅停止（向控制台发送 stop）',
  '  /mc kill     — 强制结束（screen quit + pkill 兜底）',
  '  /mc restart  — 重启（stop 失败时自动 kill 再启动）',
].join('\n');

/**
 * Strip Feishu rich-text markup so we can match plain commands.
 * The text content of im.message.receive_v1 for type=text is JSON like:
 *   { "text": "@_user_1 /mc status" }
 * `@_user_1` placeholders are inserted for every `@mention`; we drop them.
 */
function extractPlainText(rawContent: string): string {
  let text = '';
  try {
    const parsed = JSON.parse(rawContent) as { text?: string };
    text = parsed.text ?? '';
  } catch {
    return '';
  }
  // Drop @_user_N / @_all etc. placeholders and any leftover angle-bracket tags.
  return text
    .replace(/@_user_\d+/g, '')
    .replace(/@_all/g, '')
    .replace(/<at[^>]*>.*?<\/at>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCommand(text: string): { action: Action | 'help'; valid: boolean } | null {
  if (!text.toLowerCase().startsWith('/mc')) return null;
  const parts = text.split(/\s+/);
  const sub = (parts[1] ?? '').toLowerCase();
  switch (sub) {
    case 'status':
    case 'stop':
    case 'kill':
    case 'restart':
      return { action: sub, valid: true };
    case '':
    case 'help':
    case '-h':
    case '--help':
      return { action: 'help', valid: true };
    default:
      return { action: 'help', valid: false };
  }
}

interface ReceiveMessageEvent {
  message: {
    message_id: string;
    chat_id: string;
    message_type: string;
    content?: string;
  };
  sender: {
    sender_id?: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
  };
}

export const eventDispatcher = new lark.EventDispatcher({}).register({
  'im.message.receive_v1': async (data: ReceiveMessageEvent) => {
    const message = data.message;
    const sender = data.sender;
    const chatId = message.chat_id;
    const senderOpenId = sender?.sender_id?.open_id ?? '';

    // 1) chat whitelist (silent on miss)
    if (!config.allowedChatIds.includes(chatId)) {
      logger.debug({ chatId }, 'Ignoring message: chat not in whitelist');
      return;
    }
    // 2) only handle text
    if (message.message_type !== 'text') {
      return;
    }

    const text = extractPlainText(message.content ?? '');
    const cmd = parseCommand(text);
    if (!cmd) return;

    // 3) admin whitelist
    if (!config.adminUserIds.includes(senderOpenId)) {
      logger.info({ senderOpenId, text }, 'Rejecting: sender not admin');
      await safeReply(message.message_id, '⛔ 你没有权限执行 MC 控制指令。');
      return;
    }

    if (cmd.action === 'help') {
      const msg = cmd.valid ? HELP_TEXT : `❓ 未知子指令。\n\n${HELP_TEXT}`;
      await safeReply(message.message_id, msg);
      return;
    }

    logger.info({ action: cmd.action, senderOpenId, chatId }, 'Executing MC action');
    try {
      const result = await runAction(cmd.action);
      await safeReply(message.message_id, result.message);
    } catch (err) {
      logger.error({ err }, 'Action execution threw');
      await safeReply(
        message.message_id,
        `💥 执行 \`/mc ${cmd.action}\` 时出现异常：${(err as Error).message ?? String(err)}`,
      );
    }
    return;
  },
});

async function safeReply(messageId: string, text: string): Promise<void> {
  try {
    await replyText(messageId, text);
  } catch (err) {
    logger.error({ err }, 'Failed to send reply');
  }
}
