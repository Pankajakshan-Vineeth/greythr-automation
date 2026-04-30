'use strict';

const { createLogger, format, transports } = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// Custom console format with color coding and icons
const consoleFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.printf(({ timestamp, level, message, workflow, ...meta }) => {
    const icons = {
      error:   '✖',
      warn:    '⚠',
      info:    '●',
      debug:   '○',
      verbose: '◌',
    };
    const colors = {
      error:   '\x1b[31m',   // red
      warn:    '\x1b[33m',   // yellow
      info:    '\x1b[36m',   // cyan
      debug:   '\x1b[90m',   // gray
      verbose: '\x1b[90m',   // gray
    };
    const reset = '\x1b[0m';
    const bold  = '\x1b[1m';
    const dim   = '\x1b[2m';

    const icon  = icons[level]  || '•';
    const color = colors[level] || '';
    const wf    = workflow ? ` ${dim}[${workflow}]${reset}` : '';
    const extra = Object.keys(meta).length ? `\n  ${dim}${JSON.stringify(meta)}${reset}` : '';

    return `${dim}${timestamp}${reset} ${color}${bold}${icon} ${level.toUpperCase().padEnd(7)}${reset}${wf} ${message}${extra}`;
  })
);

const fileFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  format.json()
);

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta: { service: 'automation-agent' },
  transports: [
    // Rotating daily log file
    new transports.File({
      filename: path.join(logsDir, 'agent.log'),
      format: fileFormat,
      maxsize: 10 * 1024 * 1024,   // 10 MB
      maxFiles: 7,
      tailable: true,
    }),
    // Separate error log
    new transports.File({
      filename: path.join(logsDir, 'errors.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
    }),
  ],
});

// Add console transport unless --silent flag passed
if (!process.argv.includes('--silent')) {
  logger.add(new transports.Console({ format: consoleFormat }));
}

/**
 * Create a child logger scoped to a specific workflow
 */
logger.workflow = (name) => logger.child({ workflow: name });

/**
 * Log a visual section separator
 */
logger.section = (title) => {
  const line = '─'.repeat(50);
  logger.info(`\n  ${line}\n  ${title}\n  ${line}`);
};

module.exports = logger;
