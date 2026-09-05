import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fsPromises } from 'fs';

dotenv.config(); 

const { BOT_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!BOT_TOKEN) {
    console.error("❌ BOT_TOKEN is not set in .env. Commands cannot be deployed.");
    process.exit(1);
}
if (!CLIENT_ID) {
    console.error("❌ CLIENT_ID is not set in .env. Commands cannot be deployed.");
    process.exit(1);
}

const commands = [];
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const commandsPath = path.join(__dirname, 'src', 'commands', 'slash');

async function loadCommands() {
    const commandFiles = await fsPromises.readdir(commandsPath).catch(e => {
        console.error(`Error reading commands directory ${commandsPath}:`, e);
        return [];
    });

    for (const file of commandFiles) {
        if (!file.endsWith('.js')) continue;
        const filePath = path.join(commandsPath, file);
        try {
            const command = await import(filePath);
            if ('data' in command && 'execute' in command) {
                commands.push(command.data.toJSON());
            } else {
                console.warn(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
            }
        } catch (error) {
            console.error(`Error loading command from ${filePath}:`, error);
        }
    }
}

const args = process.argv.slice(2);
const isDebug = args.includes('--debug') || args.includes('-v') || args.includes('--verbose');
const showBody = args.includes('--show-body') || args.includes('--body');

// Configure REST client
const rest = new REST({ version: '10', timeout: 60_000, retries: 1 }).setToken(BOT_TOKEN);

// Attach REST event listeners for complete API visibility
rest.on('restDebug', (info) => {
    if (isDebug) {
        console.log(`🔍 [REST DEBUG] ${info}`);
    }
});

rest.on('rateLimited', (rateLimitInfo) => {
    const seconds = (rateLimitInfo.retryAfter / 1000).toFixed(1);
    console.warn('\n⚠️  [REST RATE LIMITED]');
    console.warn(`   Route:         ${rateLimitInfo.route}`);
    console.warn(`   Retry After:   ${rateLimitInfo.retryAfter}ms (${seconds}s)`);
    console.warn(`   Time to Reset: ${rateLimitInfo.timeToReset}ms`);
    console.warn(`   Global Limit:  ${rateLimitInfo.global}`);
    console.warn(`   Method:        ${rateLimitInfo.method}`);
    console.warn(`   Limit:         ${rateLimitInfo.limit}`);
    console.warn(`⏳ The client is pausing for ${seconds}s to respect Discord's rate limit. It will retry automatically when the timer expires...\n`);
});

rest.on('invalidRequestWarning', (data) => {
    console.warn(`⚠️  [INVALID REQUEST WARNING] Count: ${data.count}, Remaining Time: ${data.remainingTime}ms`);
});

rest.on('response', (request, response) => {
    console.log('\n📥 [API RESPONSE RECEIVED]');
    console.log(`   Endpoint:  ${request.method} ${request.path}`);
    console.log(`   Status:    ${response.status} ${response.statusText}${response.status === 429 ? ' (Rate Limited)' : ''}`);

    const rlLimit = response.headers.get('x-ratelimit-limit');
    const rlRemaining = response.headers.get('x-ratelimit-remaining');
    const rlResetAfter = response.headers.get('x-ratelimit-reset-after');
    const rlBucket = response.headers.get('x-ratelimit-bucket');
    const rlScope = response.headers.get('x-ratelimit-scope');

    if (rlLimit !== null || rlRemaining !== null) {
        console.log(`   RateLimit: remaining ${rlRemaining}/${rlLimit} | resets in ${rlResetAfter}s | scope: ${rlScope || 'route'} | bucket: ${rlBucket || 'n/a'}`);
    }
});

// Helper to log outgoing request details
function logRequest(route, method, payload) {
    const endpointUrl = `https://discord.com/api/v10${route}`;
    const payloadStr = JSON.stringify(payload);
    const payloadBytes = Buffer.byteLength(payloadStr, 'utf8');

    console.log('\n======================================================');
    console.log(`🚀 [DISCORD API REQUEST: ${method}]`);
    console.log(`   URL:          ${endpointUrl}`);
    console.log(`   Method:       ${method}`);
    console.log(`   Total Items:  ${Array.isArray(payload) ? payload.length : 'N/A'}`);
    console.log(`   Payload Size: ${(payloadBytes / 1024).toFixed(2)} KB (${payloadBytes} bytes)`);

    if (Array.isArray(payload) && payload.length > 0) {
        const names = payload.map(c => c.name).filter(Boolean);
        if (names.length > 0) {
            console.log(`   Commands (${names.length}): ${names.join(', ')}`);
        }
    }

    if (showBody) {
        console.log('\n📦 [FULL REQUEST BODY]');
        console.log(JSON.stringify(payload, null, 2));
    } else {
        console.log('   Tip: Pass --show-body to view the full request JSON payload');
    }
    console.log('======================================================');
    console.log('⏳ Awaiting Discord API response...');
}

// Helper to log detailed errors
function logApiError(context, error) {
    console.error(`\n❌ [ERROR] ${context}`);
    console.error(`   Name:               ${error.name || 'Error'}`);
    console.error(`   Message:            ${error.message}`);
    console.error(`   HTTP Status:        ${error.status || 'N/A'}`);
    console.error(`   Discord Error Code: ${error.code || 'N/A'}`);
    if (error.url) console.error(`   URL:                ${error.url}`);
    if (error.method) console.error(`   Method:             ${error.method}`);

    if (error.rawError) {
        console.error('\n📋 [DISCORD VALIDATION / RAW ERROR DETAILS]');
        console.error(JSON.stringify(error.rawError, null, 2));
    }

    if (error.requestData?.body) {
        console.error('\n📦 [FAILED REQUEST DATA]');
        const bodyStr = typeof error.requestData.body === 'string'
            ? error.requestData.body
            : JSON.stringify(error.requestData.body, null, 2);
        console.error(bodyStr.length > 1500 ? bodyStr.slice(0, 1500) + '\n... (truncated)' : bodyStr);
    }
    console.error('======================================================\n');
}

// Ensure Ctrl+C (SIGINT) or SIGTERM terminates immediately regardless of pending promises
process.on('SIGINT', () => {
    console.log('\n🛑 Process interrupted (SIGINT). Terminating immediately...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Process terminated (SIGTERM). Terminating immediately...');
    process.exit(0);
});

async function deployGuildCommands() {
    if (!GUILD_ID) {
        console.error("❌ GUILD_ID is not set in .env. Guild commands cannot be deployed.");
        process.exit(1);
    }
    await loadCommands(); 

    const route = Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID);
    logRequest(route, 'PUT', commands);

    const startTime = Date.now();
    try {
        const data = await rest.put(route, { body: commands });
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        console.log(`\n🎉 [SUCCESS] Reloaded ${data.length} application (/) commands for guild ${GUILD_ID} in ${duration}s.`);
        if (data.length > 0) {
            console.log("✅ Slash commands successfully deployed to guild.");
        } else {
            console.log("⚠️ No slash commands were deployed (commands array is empty).");
        }
    } catch (error) {
        logApiError(`Failed deploying guild commands to ${GUILD_ID}`, error);
    }
}

async function deployGlobalCommands() {
    await loadCommands();

    const route = Routes.applicationCommands(CLIENT_ID);
    logRequest(route, 'PUT', commands);

    const startTime = Date.now();
    try {
        const data = await rest.put(route, { body: commands });
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        console.log(`\n🎉 [SUCCESS] Reloaded ${data.length} application (/) commands globally in ${duration}s.`);
        if (data.length > 0) {
            console.log("✅ Slash commands deployed globally.");
            console.log("⏰ Note: Discord global commands can take up to an hour to propagate across all guilds.");
        } else {
            console.log("⚠️ No slash commands were deployed globally (commands array is empty).");
        }
    } catch (error) {
        logApiError('Failed deploying global commands', error);
    }
}

async function removeAllCommands() {
    const globalRoute = Routes.applicationCommands(CLIENT_ID);
    console.log('\n🗑️ Removing all global commands...');
    logRequest(globalRoute, 'PUT', []);

    try {
        await rest.put(globalRoute, { body: [] });
        console.log('✅ All global commands removed.');

        if (GUILD_ID) {
            const guildRoute = Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID);
            console.log(`\n🗑️ Removing all commands in guild ${GUILD_ID}...`);
            logRequest(guildRoute, 'PUT', []);
            await rest.put(guildRoute, { body: [] });
            console.log(`✅ All guild commands removed from guild ${GUILD_ID}.`);
        } else {
            console.log('⚠️ No GUILD_ID set, skipping guild commands removal.');
        }
    } catch (error) {
        logApiError('Failed removing commands', error);
    }
}

(async () => {
    if (args.includes('--guild')) {
        await deployGuildCommands();
        process.exit(0);
    } else if (args.includes('--global')) {
        await deployGlobalCommands();
        process.exit(0);
    } else if (args.includes('--remove-slash')) {
        await removeAllCommands();
        process.exit(0);
    } else {
        console.log("Usage: node deploy-commands.js [--guild | --global | --remove-slash] [--show-body] [--debug]");
        console.log("  --guild:        Deploy commands to the guild specified by GUILD_ID in .env (instant, recommended for testing)");
        console.log("  --global:       Deploy commands globally (takes up to 1 hour to propagate)");
        console.log("  --remove-slash: Remove all global and guild commands");
        console.log("  --show-body:    Print the full JSON payload of commands being sent");
        console.log("  --debug:        Display internal Discord REST debug logs");
        process.exit(0);
    }
})();
