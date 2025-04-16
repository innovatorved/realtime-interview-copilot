import winston from 'winston';

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
);

// Detect if we're running in an edge runtime
// In Next.js Edge Runtime, process should be undefined
const isEdgeRuntime = typeof process === 'undefined' || !!(process.env.NEXT_RUNTIME === 'edge');

// Configure logger based on environment
let logger: winston.Logger;

// In Edge Runtime, only use Console transport
if (isEdgeRuntime) {
  logger = winston.createLogger({
    level: 'info',
    format: logFormat,
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          logFormat
        )
      })
    ]
  });
} else {
  // In Node.js environment, use all transports
  logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          logFormat
        )
      }),
      new winston.transports.File({
        filename: 'app.log',
        maxsize: 5242880,
        maxFiles: 5,
      })
    ],
    exceptionHandlers: [
      new winston.transports.File({
        filename: 'exceptions.log',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.json()
        )
      })
    ],
    rejectionHandlers: [
      new winston.transports.File({
        filename: 'rejections.log',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.errors({ stack: true }),
          winston.format.json()
        )
      })
    ],
    exitOnError: false
  });
}

export default logger; 