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

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

async function deployGuildCommands() {
    if (!GUILD_ID) {
        console.error("❌ GUILD_ID is not set in .env. Guild commands cannot be deployed.");
        process.exit(1);
    }
    await loadCommands(); 
    try {
        console.log(`Started refreshing ${commands.length} application (/) commands for guild ${GUILD_ID}.`);

        const data = await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands },
        );

        console.log(`Successfully reloaded ${data.length} application (/) commands for guild ${GUILD_ID}.`);
        if (data.length > 0) {
            console.log("✅ Slash commands deployed to this guild.");
        } else {
            console.log("⚠️ No slash commands were deployed (commands array is empty).");
        }
    } catch (error) {
        console.error('Error deploying guild commands:', error);
    }
}

async function deployGlobalCommands() {
    await loadCommands();
    try {
        console.log(`Started refreshing ${commands.length} application (/) commands globally.`);

        const data = await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands },
        );

        console.log(`Successfully reloaded ${data.length} application (/) commands globally.`);
        if (data.length > 0) {
            console.log("✅ Slash commands deployed globally.");
        } else {
            console.log("⚠️ No slash commands were deployed globally (commands array is empty).");
        }
    } catch (error) {
        console.error('Error deploying global commands:', error);
    }
}

const args = process.argv.slice(2);
if (args.includes('--guild')) {
    deployGuildCommands();
} else if (args.includes('--global')) {
    deployGlobalCommands();
} else {
    console.log("Usage: node deploy-commands.js [--guild | --global]");
    console.log("  --guild: Deploy commands to the guild specified by GUILD_ID in .env (for testing)");
    console.log("  --global: Deploy commands globally (for production, takes up to 1 hour to propagate)");
    console.log("\nTo deploy commands, ensure the 'commands' array in this file contains the commands you want, then run:");
    console.log("  node deploy-commands.js --guild  (to deploy to your test guild)");
    console.log("  node deploy-commands.js --global (to deploy globally)");
}
