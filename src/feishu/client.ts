import * as lark from '@larksuiteoapi/node-sdk';
import { config } from '../config';

const domain = config.larkDomain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu;

/** REST API client (used to send/reply messages). */
export const client = new lark.Client({
  appId: config.appId,
  appSecret: config.appSecret,
  appType: lark.AppType.SelfBuild,
  domain,
});

/** Long-lived WebSocket client — no public callback URL needed. */
export const wsClient = new lark.WSClient({
  appId: config.appId,
  appSecret: config.appSecret,
  domain,
});

/** Reply to a message with plain text. */
export async function replyText(messageId: string, text: string): Promise<void> {
  await client.im.message.reply({
    path: { message_id: messageId },
    data: {
      content: JSON.stringify({ text }),
      msg_type: 'text',
    },
  });
}
