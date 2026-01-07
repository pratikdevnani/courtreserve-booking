/**
 * Configurable Logger with Multiple Log Levels
 *
 * Log levels (in order of verbosity):
 * - TRACE (0): Most verbose, for detailed debugging
 * - DEBUG (1): Debugging information
 * - INFO  (2): General information
 * - WARN  (3): Warnings
 * - ERROR (4): Errors only
 * - SILENT (5): No logging
 *
 * Set via LOG_LEVEL environment variable (default: INFO)
 */

export enum LogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
  SILENT = 5,
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.TRACE]: 'TRACE',
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.SILENT]: 'SILENT',
};

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  [LogLevel.TRACE]: '\x1b[90m', // Gray
  [LogLevel.DEBUG]: '\x1b[36m', // Cyan
  [LogLevel.INFO]: '\x1b[32m', // Green
  [LogLevel.WARN]: '\x1b[33m', // Yellow
  [LogLevel.ERROR]: '\x1b[31m', // Red
  [LogLevel.SILENT]: '',
};

const RESET_COLOR = '\x1b[0m';

function parseLogLevel(level: string | undefined): LogLevel {
  if (!level) return LogLevel.INFO;

  const upperLevel = level.toUpperCase();
  switch (upperLevel) {
    case 'TRACE':
      return LogLevel.TRACE;
    case 'DEBUG':
      return LogLevel.DEBUG;
    case 'INFO':
      return LogLevel.INFO;
    case 'WARN':
    case 'WARNING':
      return LogLevel.WARN;
    case 'ERROR':
      return LogLevel.ERROR;
    case 'SILENT':
    case 'NONE':
      return LogLevel.SILENT;
    default:
      return LogLevel.INFO;
  }
}

export class Logger {
  private module: string;
  private static globalLevel: LogLevel = parseLogLevel(process.env.LOG_LEVEL);

  constructor(module: string) {
    this.module = module;
  }

  private formatTimestamp(): string {
    const now = new Date();
    return now.toISOString();
  }

  private formatMessage(level: LogLevel, message: string, data?: any): string {
    const timestamp = this.formatTimestamp();
    const levelName = LOG_LEVEL_NAMES[level].padEnd(5);
    const color = LOG_LEVEL_COLORS[level];

    let formattedMessage = `${color}[${timestamp}] [${levelName}] [${this.module}]${RESET_COLOR} ${message}`;

    if (data !== undefined) {
      if (typeof data === 'object') {
        formattedMessage += '\n' + JSON.stringify(data, null, 2);
      } else {
        formattedMessage += ` ${data}`;
      }
    }

    return formattedMessage;
  }

  private log(level: LogLevel, message: string, data?: any): void {
    if (level < Logger.globalLevel) return;

    const formatted = this.formatMessage(level, message, data);

    switch (level) {
      case LogLevel.ERROR:
        console.error(formatted);
        break;
      case LogLevel.WARN:
        console.warn(formatted);
        break;
      default:
        console.log(formatted);
    }
  }

  /**
   * TRACE - Most verbose logging for detailed debugging
   * Use for: Function entry/exit, variable values, loop iterations
   */
  trace(message: string, data?: any): void {
    this.log(LogLevel.TRACE, message, data);
  }

  /**
   * DEBUG - Debugging information
   * Use for: Important state changes, API calls, decisions
   */
  debug(message: string, data?: any): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  /**
   * INFO - General information
   * Use for: Start/end of operations, successful completions
   */
  info(message: string, data?: any): void {
    this.log(LogLevel.INFO, message, data);
  }

  /**
   * WARN - Warnings (non-fatal issues)
   * Use for: Retries, missing optional data, degraded operation
   */
  warn(message: string, data?: any): void {
    this.log(LogLevel.WARN, message, data);
  }

  /**
   * ERROR - Errors
   * Use for: Failures, exceptions, unrecoverable issues
   */
  error(message: string, data?: any): void {
    this.log(LogLevel.ERROR, message, data);
  }

  /**
   * Set the global log level programmatically
   */
  static setLevel(level: LogLevel): void {
    Logger.globalLevel = level;
    console.log(`Log level set to: ${LOG_LEVEL_NAMES[level]}`);
  }

  /**
   * Get the current global log level
   */
  static getLevel(): LogLevel {
    return Logger.globalLevel;
  }

  /**
   * Create a child logger with a sub-module name
   */
  child(subModule: string): Logger {
    return new Logger(`${this.module}:${subModule}`);
  }
}

// Pre-configured loggers for each module
export const loggers = {
  courtreserve: new Logger('CourtReserve'),
  scheduler: new Logger('Scheduler'),
  noonMode: new Logger('NoonMode'),
  pollingMode: new Logger('PollingMode'),
  lockManager: new Logger('LockManager'),
  api: new Logger('API'),
  auth: new Logger('Auth'),
};

// Convenience function to create a new logger
export function createLogger(module: string): Logger {
  return new Logger(module);
}

// Export for use
export default Logger;
