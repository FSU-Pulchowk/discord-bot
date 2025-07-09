import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import * as verifyCmd from './src/commands/slash/verify.js';
import * as confirmOtpCmd from './src/commands/slash/confirmotp.js';

dotenv.config(); 

const { BOT_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

// Ensure critical environment variables are set
if (!BOT_TOKEN) {
    console.error("❌ BOT_TOKEN is not set in .env. Commands cannot be deployed.");
    process.exit(1);
}
if (!CLIENT_ID) {
    console.error("❌ CLIENT_ID is not set in .env. Commands cannot be deployed.");
    process.exit(1);
}

const commands = [
    verifyCmd.data.toJSON(),
    confirmOtpCmd.data.toJSON(),
];

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

/**
 * Deploys slash commands to a specific guild (server).
 * This is faster for testing as changes propagate quickly.
 */
async function deployGuildCommands() {
    if (!GUILD_ID) {
        console.error("❌ GUILD_ID is not set in .env. Guild commands cannot be deployed.");
        process.exit(1);
    }
    try {
        console.log(`Started refreshing ${commands.length} application (/) commands for guild ${GUILD_ID}.`);

        // The put method is used to fully refresh all commands in the guild with the current set
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

/**
 * Deploys slash commands globally.
 * This can take up to an hour for changes to propagate across all guilds.
 * Use for production deployment.
 */
async function deployGlobalCommands() {
    try {
        console.log(`Started refreshing ${commands.length} application (/) commands globally.`);

        // The put method is used to fully refresh all commands globally with the current set
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
        // And of course, make sure you catch and log any errors!
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