import { config } from './config';
import { wsClient } from './feishu/client';
import { eventDispatcher } from './feishu/handler';
import { logger } from './logger';

async function main(): Promise<void> {
  logger.info(
    {
      domain: config.larkDomain,
      session: config.screenSession,
      script: config.mcStartScript,
      scriptExists: config.mcStartScriptExists,
      chats: config.allowedChatIds.length,
      admins: config.adminUserIds.length,
    },
    'Starting feishu-mc-bot',
  );

  if (!config.mcStartScriptExists) {
    logger.warn(
      { script: config.mcStartScript },
      'MC_START_SCRIPT does not exist yet — /mc restart will fail until you create it.',
    );
  }

  // WSClient.start() returns a promise that resolves only when the client is stopped.
  // It internally handles reconnection.
  wsClient.start({ eventDispatcher });
  logger.info('WSClient started, awaiting Feishu events...');

  installShutdownHandlers();
}

function installShutdownHandlers(): void {
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down gracefully...');
    try {
      // SDK exposes no public stop in some versions; closing the process is fine.
      // We just let pending HTTP replies flush.
    } finally {
      setTimeout(() => process.exit(0), 250).unref();
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'uncaughtException');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal during startup');
  process.exit(1);
});
