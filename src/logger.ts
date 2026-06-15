import pino from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';

export const logger = pino({
  level,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['APP_SECRET', 'appSecret', 'app_secret'],
    censor: '***',
  },
});

export type Logger = typeof logger;
