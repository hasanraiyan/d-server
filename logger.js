const { createLogger, format, transports } = require('winston');
const { v4: uuidv4 } = require('uuid');

const enumerateErrorFormat = format((info) => {
  if (info instanceof Error) {
    Object.assign(info, { message: info.message, stack: info.stack });
  }
  return info;
});

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    enumerateErrorFormat(),
    format.timestamp(),
    format.errors({ stack: true }),
    format.splat(),
    format.json()
  ),
  defaultMeta: { service: 'dostify-backend' },
  transports: [
    new transports.Console(),
    // Add a file transport if needed
    // new transports.File({ filename: 'logs/error.log', level: 'error' })
  ],
});

module.exports = logger;
