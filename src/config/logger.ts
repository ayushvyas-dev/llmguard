import pino from 'pino';
import { config } from './env.js';

const logger = pino({
  level: config.LOG_LEVEL || 'info',

  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers.set-cookie',
    ],
    censor: '[REDACTED]',
  },

  ...(config.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  }),
});

export default logger;
