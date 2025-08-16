import * as fs from 'fs';
import path from 'path';
import { argv } from 'process';

/**
 * @class DebugConfig
 * @description Manages CLI/env debug config, ANSI colors, log types, and logging with security features.
 */
class DebugConfig {
	constructor() {
		// Debug config
		this.enabled = false;
		this.categories = ['all'];
		this.level = 'info'; 
		this.showStack = false;
		this.showTimestamp = true;
		this.showCaller = true;
		this.outputFile = null;
		this.debugStream = null;
		this.sanitizeData = true; // New security feature
		this.maxDataLength = 1000; // Limit data output length

		this.sensitiveKeys = [
			'token', 'key', 'secret', 'password', 'pass', 'auth', 'api',
			'credential', 'private', 'id', 'channel', 'guild', 'user',
			'email', 'phone', 'address', 'ip', 'host', 'url', 'webhook'
		];

		this.ansiColors = {
		Reset: "\x1b[0m",
		Bright: "\x1b[1m",
		Dim: "\x1b[2m",
		Underscore: "\x1b[4m",
		Blink: "\x1b[5m",
		Reverse: "\x1b[7m",
		Hidden: "\x1b[8m",

		FgBlack: "\x1b[30m",
		FgRed: "\x1b[31m",
		FgGreen: "\x1b[32m",
		FgYellow: "\x1b[33m",
		FgBlue: "\x1b[34m",
		FgMagenta: "\x1b[35m",
		FgCyan: "\x1b[36m",
		FgWhite: "\x1b[37m",
		FgGray: "\x1b[90m",

		BgBlack: "\x1b[40m",
		BgRed: "\x1b[41m",
		BgGreen: "\x1b[42m",
		BgYellow: "\x1b[43m",
		BgBlue: "\x1b[44m",
		BgMagenta: "\x1b[45m",
		BgCyan: "\x1b[46m",
		BgWhite: "\x1b[47m",
		BgGray: "\x1b[100m",
		};

		// Registered log types with colorized prefixes
		this.logTypes = {
			info: `${this.ansiColors.FgCyan}[INFO]${this.ansiColors.Reset}`,
			error: `${this.ansiColors.FgRed}[ERROR]${this.ansiColors.Reset}`,
			warn: `${this.ansiColors.FgYellow}[WARN]${this.ansiColors.Reset}`,
			success: `${this.ansiColors.FgGreen}[SUCCESS]${this.ansiColors.Reset}`,
		};
		
		this.registerLogType('scheduler', this.ansiColors.FgMagenta, 'SCHEDULER');
		this.registerLogType('scraper', this.ansiColors.FgMagenta, 'SCRAPER');

		this._parseArgs();

		if (this.outputFile) {
		this.debugStream = fs.createWriteStream(this.outputFile, { flags: 'a' });
		}
	}

	/**
	 * Register or override a log type with custom color and label.
	 * @param {string} typeName
	 * @param {string} colorCode ANSI color code string
	 * @param {string} [label] Optional label, defaults to uppercase typeName
	 */
	registerLogType(typeName, colorCode, label = null) {
		this.logTypes[typeName] = `${colorCode}[${label || typeName.toUpperCase()}]${this.ansiColors.Reset}`;
	}

	/**
	 * Add custom sensitive keys to be redacted from logs
	 * @param {string[]} keys Array of sensitive key patterns
	 */
	addSensitiveKeys(keys) {
		this.sensitiveKeys.push(...keys);
	}

	/**
	 * Sanitize sensitive data from objects before logging
	 * @param {any} data Data to sanitize
	 * @returns {any} Sanitized data
	 */
	_sanitizeData(data) {
		if (!this.sanitizeData || data === null || data === undefined) {
			return data;
		}

		// Handle different data types
		if (typeof data === 'string') {
			// Check if string looks like sensitive data (long alphanumeric, IDs, etc.)
			if (data.length > 20 && /^[a-zA-Z0-9_-]+$/.test(data)) {
				return `***REDACTED_ID(${data.length})***`;
			}
			return data;
		}

		if (typeof data === 'number' || typeof data === 'boolean') {
			return data;
		}

		if (Array.isArray(data)) {
			return data.map(item => this._sanitizeData(item));
		}

		if (typeof data === 'object') {
			const sanitized = {};
			for (const [key, value] of Object.entries(data)) {
				const lowerKey = key.toLowerCase();
				const isSensitive = this.sensitiveKeys.some(sensitiveKey => 
					lowerKey.includes(sensitiveKey.toLowerCase())
				);

				if (isSensitive) {
					if (typeof value === 'string') {
						if (value.length <= 4) {
							sanitized[key] = '***';
						} else {
							sanitized[key] = `${value.substring(0, 2)}***${value.slice(-2)}`;
						}
					} else {
						sanitized[key] = '***REDACTED***';
					}
				} else {
					sanitized[key] = this._sanitizeData(value);
				}
			}
			return sanitized;
		}

		return data;
	}

	/**
	 * Force sanitize sensitive data from objects before logging, regardless of global settings.
	 * @param {any} data Data to sanitize
	 * @returns {any} Sanitized data
	 */
	_forceSanitizeData(data) {
		if (data === null || data === undefined) {
			return data;
		}
		// List of sensitive keys to always redact (add more as needed)
		const sensitivePatterns = [
			'password', 'secret', 'token', 'key', 'api', 'auth', 'session', 'credential', 'env', 'BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID'
		];
		const redact = (obj) => {
			if (typeof obj !== 'object' || obj === null) return obj;
			if (Array.isArray(obj)) return obj.map(redact);
			const result = {};
			for (const k of Object.keys(obj)) {
				const lowerK = k.toLowerCase();
				if (sensitivePatterns.some(pattern => lowerK.includes(pattern))) {
					result[k] = '[REDACTED]';
				} else if (typeof obj[k] === 'object' && obj[k] !== null) {
					result[k] = redact(obj[k]);
				} else {
					result[k] = obj[k];
				}
			}
			return result;
		};
		// If the data is process.env or contains process.env, redact all values
		if (
			(typeof process !== 'undefined' && data === process.env) ||
			(data && typeof data === 'object' && Object.keys(process.env || {}).some(envKey => Object.prototype.hasOwnProperty.call(data, envKey)))
		) {
			return '[REDACTED: process.env]';
		}
		return redact(data);
	}

	/**
	 * Limit data output length to prevent log flooding
	 * @param {any} data Data to limit
	 * @returns {any} Limited data
	 */
	_limitDataLength(data) {
		const jsonString = JSON.stringify(data, null, 2);
		if (jsonString.length > this.maxDataLength) {
			return {
				...data,
				'__DEBUG_NOTE__': `Data truncated (${jsonString.length} > ${this.maxDataLength} chars)`
			};
		}
		return data;
	}

	_parseArgs() {
		const args = argv.slice(2);

		for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		switch (arg) {
			case '--debug':
			case '-d':
			this.enabled = true;
			if (args[i + 1] && !args[i + 1].startsWith('-')) {
				this.categories = args[++i].split(',');
			}
			break;
			case '--debug-level':
			case '-dl':
			if (args[i + 1] && !args[i + 1].startsWith('-')) {
				this.level = args[++i] || 'info';
			}
			break;
			case '--debug-stack':
			case '-ds':
			this.showStack = true;
			break;
			case '--debug-no-timestamp':
			case '-dnt':
			this.showTimestamp = false;
			break;
			case '--debug-no-caller':
			case '-dnc':
			this.showCaller = false;
			break;
			case '--debug-file':
			case '-df':
			if (args[i + 1] && !args[i + 1].startsWith('-')) {
				this.outputFile = args[++i];
			}
			break;
			case '--debug-no-sanitize':
			case '-dns':
			this.sanitizeData = false;
			console.warn('⚠️  WARNING: Data sanitization disabled. Sensitive data may be logged!');
			break;
			case '--debug-max-length':
			case '-dml':
			if (args[i + 1] && !args[i + 1].startsWith('-')) {
				this.maxDataLength = parseInt(args[++i]) || 1000;
			}
			break;
			case '--help-debug':
			this._showHelp();
			process.exit(0);
			break;
		}
		}

		if (!this.enabled && process.env.DEBUG_MODE === 'true') {
		this.enabled = true;
		if (process.env.DEBUG_CATEGORIES) {
			this.categories = process.env.DEBUG_CATEGORIES.split(',');
		}
		}
	}

	_showHelp() {
		console.log(`
Debug Options:
--debug, -d [categories]     Enable debug mode with optional comma-separated categories.
--debug-level, -dl <level>   Set debug level: info, verbose, trace.
--debug-stack, -ds           Show stack traces for errors.
--debug-no-timestamp, -dnt   Don't show timestamps.
--debug-no-caller, -dnc      Don't show caller info.
--debug-file, -df <file>     Output debug to a specified file.
--debug-no-sanitize, -dns    Disable data sanitization (SECURITY RISK).
--debug-max-length, -dml <n> Maximum data length to log (default: 1000).
--help-debug                 Show this help message.

Security Features:
- Automatic sanitization of sensitive data (IDs, tokens, keys, etc.)
- Data length limiting to prevent log flooding
- Partial masking of sensitive values for debugging context

Categories: all, init, command, event, client, interaction, scraper (and any custom categories)

Examples:
node your_script.js --debug                          # Enable all debug logs (secure)
node your_script.js -d command                       # Only debug commands
node your_script.js --debug --debug-level verbose    # Verbose debugging for all categories
node your_script.js -d command -ds                   # Debug commands with stack traces
node your_script.js -d --debug-file debug.log        # Debug all to file
node your_script.js -d --debug-no-sanitize          # Disable sanitization (NOT RECOMMENDED)
		`);
		process.exit(0);
	}

	/**
	 * Log a message with optional category, data, error and level.
	 * @param {string} message
	 * @param {string} category
	 * @param {any} data
	 * @param {Error} error
	 * @param {string} level
	 */
	log(message, category = 'general', data = null, error = null, level = 'info') {
		if (!this.enabled) return;
		if (!this.categories.includes('all') && !this.categories.includes(category)) return;

		const levels = { info: 0, verbose: 1, trace: 2 };
		const currentLevel = levels[this.level] ?? 0;
		const messageLevel = levels[level] ?? 0;
		if (messageLevel > currentLevel) return;

		let callerInfo = {};
		if (this.showCaller) {
		const stack = new Error().stack;
		const callerLine = stack.split('\n')[4];
		callerInfo = this._parseCallerInfo(callerLine);
		}

		let prefix = this.logTypes[category] || this.logTypes[level] || this.logTypes['info'];
		if (!prefix) {
		prefix = `[${category.toUpperCase()}]`;
		}

		let debugMsg = '';
		debugMsg += prefix;
		if (level !== 'info' && level !== category && prefix !== this.logTypes[level]) debugMsg += `[${level.toUpperCase()}]`;
		if (this.showCaller && callerInfo.functionName) debugMsg += `[${callerInfo.functionName}]`;
		if (this.showCaller && callerInfo.fileName) debugMsg += `(${callerInfo.fileName}:${callerInfo.lineNumber})`;
		debugMsg += ` ${message}`;

		this._outputDebug(debugMsg);

		// Always sanitize and limit data before logging, regardless of log level
		if (data !== null) {
			const sanitizedData = this._sanitizeData(data);
			const limitedData = this._limitDataLength(sanitizedData);
			this._outputDebug(`[DATA]`, limitedData);
		}

		if (error) {
		this._outputDebug(`[ERROR] ${error.message}`);
		if (this.showStack || level === 'trace') {
			// Sanitize stack traces as they might contain file paths or sensitive info
			const sanitizedStack = this.sanitizeData ? 
				error.stack.replace(/\/[^\s]+\//g, '/***PATH***/') : 
				error.stack;
			this._outputDebug(`[STACK]`, sanitizedStack);
		}
		}
	}

	/**
	 * Log sensitive data with explicit warning (use sparingly for debugging)
	 * @param {string} message
	 * @param {string} category
	 * @param {any} sensitiveData
	 * @param {string} level
	 */
	logSensitive(message, category = 'general', sensitiveData = null, level = 'trace') {
		if (!this.enabled) return;
		
		console.warn('⚠️  SECURITY WARNING: Logging potentially sensitive data');
		this.log(`${message} [SENSITIVE DATA FOLLOWS]`, category, null, null, level);
		
		if (sensitiveData !== null) {
			// Force sanitization even if disabled globally
			const sanitizedData = this._sanitizeData(sensitiveData);
			this._outputDebug(`[SENSITIVE_DATA]`, sanitizedData);
		}
	}

	_outputDebug(message, data = null) {
		const sanitizedMessage = typeof message === 'string' ?
		message.replace(/[\u001b\u009b][[()#;?]*.?[0-9]{1,4}(?:;[0-9]{0,4})*.?[0-9A-ORZcf-nqry=><]/g, '') :
		message;

		if (typeof sanitizedMessage === 'string') {
		console.log(message); 
		if (this.debugStream) this.debugStream.write(sanitizedMessage + '\n');
		}
		if (data !== null) {
		// Always force sanitization of data before logging, regardless of global settings
		const forceSanitizedData = this._forceSanitizeData(data);
		const formattedData = JSON.stringify(forceSanitizedData, null, 2);
		console.log(formattedData);
		if (this.debugStream) this.debugStream.write(formattedData + '\n');
		}
	}

	_parseCallerInfo(callerLine) {
		const info = { functionName: 'anonymous', fileName: 'unknown', lineNumber: '0' };
		if (!callerLine) return info;
		try {
		const match = callerLine.match(/at\s+(?:new\s)?(?:.*\.)?(.+?)\s+\((?:file:\/\/\/)?(.+?):(\d+):\d+\)/) ||
			callerLine.match(/at\s+(?:file:\/\/\/)?(.+?):(\d+):\d+/);
		if (match) {
			info.functionName = match[1] && !match[1].includes(path.sep) ? match[1] : 'anonymous';
			info.fileName = match[2] ? path.basename(match[2]) : path.basename(match[1]);
			info.lineNumber = match[3] || match[2];
		} else {
			const plainMatch = callerLine.match(/at\s+(.*)/);
			if (plainMatch) info.functionName = plainMatch[1];
		}
		} catch {
		}
		return info;
	}

	/**
	 * Safely log environment variables (useful for debugging config issues)
	 * @param {string[]} allowedKeys Array of environment variable keys that are safe to log
	 */
	logSafeEnvVars(allowedKeys = []) {
		if (!this.enabled) return;
		
		const safeEnvVars = {};
		allowedKeys.forEach(key => {
			if (process.env[key] !== undefined) {
				const value = process.env[key];
				if (value.length > 50 || /^[a-zA-Z0-9_-]{20,}$/.test(value)) {
					safeEnvVars[key] = `${value.substring(0, 4)}***${value.slice(-4)}`;
				} else {
					safeEnvVars[key] = value;
				}
			}
		});
		
		this.log('Safe environment variables', 'config', safeEnvVars, null, 'verbose');
	}

	/**
	 * Clean shutdown - close file streams
	 */
	shutdown() {
		if (this.debugStream) {
			this.debugStream.end();
		}
	}
}

export const debugConfig = new DebugConfig();
export const log = debugConfig.log.bind(debugConfig);

process.on('SIGINT', () => debugConfig.shutdown());
process.on('SIGTERM', () => debugConfig.shutdown());