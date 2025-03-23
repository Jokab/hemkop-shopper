// Logging levels
export enum LogLevel {
  NONE = 0,      // No logs at all
  ERROR = 1,     // Only errors
  INFO = 2,      // Important information (default)
  DEBUG = 3,     // Detailed information for debugging
}

class Logger {
  private logLevel: LogLevel = LogLevel.INFO;

  constructor() {
    // Check for verbosity flag
    const isVerbose = process.argv.includes('-v') || process.argv.includes('--verbose');
    if (isVerbose) {
      this.logLevel = LogLevel.DEBUG;
      this.debug('Verbose logging enabled');
    }
  }

  // Set the log level
  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  // Check if debug logging is enabled
  isDebugEnabled(): boolean {
    return this.logLevel >= LogLevel.DEBUG;
  }

  // Check if info logging is enabled
  isInfoEnabled(): boolean {
    return this.logLevel >= LogLevel.INFO;
  }

  // Error logs - always shown unless logging is completely disabled
  error(message: string): void {
    if (this.logLevel >= LogLevel.ERROR) {
      console.error(`❌ ${message}`);
    }
  }

  // Info logs - important information that should be shown by default
  info(message: string): void {
    if (this.logLevel >= LogLevel.INFO) {
      console.log(`ℹ️ ${message}`);
    }
  }

  // Debug logs - only shown in verbose mode
  debug(message: string): void {
    if (this.logLevel >= LogLevel.DEBUG) {
      console.log(`🔍 ${message}`);
    }
  }

  // LLM logs - specific to LLM interactions, always shown with emphasis
  llm(message: string): void {
    if (this.logLevel >= LogLevel.INFO) {
      console.log(`\n🤖 ${message}\n`);
    }
  }

  // Product logs - specific to product selection, always shown with emphasis
  product(message: string): void {
    if (this.logLevel >= LogLevel.INFO) {
      console.log(`\n🛒 ${message}\n`);
    }
  }

  // Decision logs - specific to automated decisions, always shown with emphasis
  decision(message: string): void {
    if (this.logLevel >= LogLevel.INFO) {
      console.log(`\n✅ ${message}\n`);
    }
  }
}

// Export a singleton instance of the logger
export const logger = new Logger(); 