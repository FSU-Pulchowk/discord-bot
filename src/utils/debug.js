import * as fs from 'fs';
import path from 'path';
import { argv } from 'process';

/**
 * @class DebugConfig
 * @description Manages CLI/env debug config, ANSI colors, log types, and logging.
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

		// ANSI Colors
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
--help-debug                 Show this help message.

Categories: all, init, command, event, client, interaction, scraper (and any custom categories)

Examples:
node your_script.js --debug                          # Enable all debug logs
node your_script.js -d command                       # Only debug commands
node your_script.js --debug --debug-level verbose    # Verbose debugging for all categories
node your_script.js -d command -ds                   # Debug commands with stack traces
node your_script.js -d --debug-file debug.log        # Debug all to file
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

		if (data !== null && (level === 'verbose' || level === 'trace' || this.level !== 'info')) {
		this._outputDebug(`[DATA]`, data);
		}

		if (error) {
		this._outputDebug(`[ERROR] ${error.message}`);
		if (this.showStack || level === 'trace') {
			this._outputDebug(`[STACK]`, error.stack);
		}
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
		const formattedData = JSON.stringify(data, null, 2);
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
}

export const debugConfig = new DebugConfig();
export const log = debugConfig.log.bind(debugConfig);