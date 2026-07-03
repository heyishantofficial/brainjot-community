const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: ['req.headers.cookie', 'req.headers.authorization', '*.passwordHash', '*.token'],
});

module.exports = logger;
