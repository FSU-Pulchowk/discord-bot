import {
    Client,
    Collection,
    IntentsBitField,
    EmbedBuilder,
    PermissionsBitField,
    ChannelType,
    Partials,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder,
    Events,
    MessageFlags,
    ModalBuilder, 
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v9';
import dotenv from 'dotenv';
import schedule from 'node-schedule';
import { initializeDatabase, db } from './database.js'; // Assuming 'db' is exported from database.js
import { emailService } from './services/emailService.js'; // Assuming emailService exists
import { scrapeLatestNotice } from './services/scraper.js'; // Assuming scrapeLatestNotice exists
import { initializeGoogleCalendarClient } from './commands/slash/holidays.js'; // Assuming this exists
import { fromPath } from 'pdf2pic'; // For PDF to image conversion
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'; // For PDF page count

import * as fs from 'fs';
import { promises as fsPromises, createWriteStream } from 'fs';
import path from 'path';
import axios from 'axios';
import { pollFeeds } from './services/rssService.js';
import { exit, cwd } from 'process'; 
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { debugConfig } from './utils/debug.js';

dotenv.config();

process.on('unhandledRejection', error => {
    debugConfig.log('Unhandled promise rejection (this may cause the bot to crash):', 'error', null, error, 'error');
    console.error(error);
});


/**
 * Writes the Google Service Account Key from an environment variable to a file.
 * This is necessary for Google Calendar API access.
 */
async function writeServiceAccountKey() {
    const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64;
    if (!b64) {
        debugConfig.log('No GOOGLE_SERVICE_ACCOUNT_KEY_B64 env var found. Google Calendar features might be limited.', 'init', null, null, 'warn');
        return;
    }
    const keyPath = path.resolve(process.cwd(), 'src', 'service_account_key.json'); // Save in src directory
    try {
        const decoded = Buffer.from(b64, 'base64').toString('utf-8');
        await fsPromises.writeFile(keyPath, decoded);
        debugConfig.log('Service account key saved.', 'init', 'success');
    } catch (error) {
        debugConfig.log(`Error writing service account key: ${error.message}`, 'init', null, error, 'error');
    }
}

/**
 * Main Discord Bot class.
 */
class PulchowkBot {
    /**
     * @param {string} token The Discord bot token.
     * @param {import('sqlite3').Database} dbInstance The SQLite database instance.
     */
    constructor(token, dbInstance) {
        this.token = token;
        this.db = dbInstance; // Attach the database instance to the client for easy access

        this.debugConfig = debugConfig; // Use the globally instantiated logger
        // No need for this.debugStream property here anymore, it's managed internally by DebugConfig
        this.debugConfig.log("Bot instance created. Initializing...", 'init');

        this.colors = {
            primary: 0x5865F2,
            success: 0x57F287,
            warning: 0xFEE75C,
            error: 0xED4245
        };

        this.client = new Client({
            intents: [
                IntentsBitField.Flags.Guilds, // Required for guild-related events (members, channels, roles)
                IntentsBitField.Flags.GuildMembers, // Required for guild member add/remove, member updates
                IntentsBitField.Flags.GuildMessages, // Required for message creation, updates, deletions
                IntentsBitField.Flags.MessageContent, // Required to read message content (for commands, anti-spam)
                IntentsBitField.Flags.GuildVoiceStates, // Required for voice channel activity tracking
                IntentsBitField.Flags.DirectMessages, // Required for direct messages to the bot
                IntentsBitField.Flags.GuildMessageReactions // Required for reaction roles, suggestion voting
            ],
            partials: [
                Partials.Channel, // Required for DM channels and uncached channels
                Partials.Message, // Required for uncached messages (e.g., old messages for reactions)
                Partials.Reaction, // Required for uncached reactions
                Partials.User, // Required for uncached users
                Partials.GuildMember // Required for uncached guild members
            ]
        });

        this.client.db = dbInstance; // Attach the database instance to the client for easy access
        this.client.commands = new Collection(); // Collection to store slash commands
        this.commandFiles = []; // Array to store command data for registration
        this.developers = process.env.DEVELOPER_IDS ? process.env.DEVELOPER_IDS.split(',') : []; // Bot developer IDs

        this.spamMap = new Map(); // For anti-spam tracking
        this.spamWarnings = new Map(); // For anti-spam warnings
        this.voiceStates = new Map(); // To track active voice sessions

        this._initializeCommands();
        this._registerEventListeners();
    }

    /**
     * Initializes and loads all slash commands from the commands directory.
     * Combines logic from both bot.js and index.js
     * @private
     */
    async _initializeCommands() {
        this.debugConfig.log('Starting command initialization', 'command');
        const commandsPath = path.join(__dirname, 'commands', 'slash');

        try {
            const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
            this.debugConfig.log(`Found ${commandFiles.length} command files`, 'command', { files: commandFiles }, null, 'verbose');

            const importPromises = commandFiles.map(file => {
                const filePath = path.join(commandsPath, file);
                return import(`file://${filePath}?v=${Date.now()}`).then(commandModule => {
                    if (commandModule.data && commandModule.execute) {
                        this.client.commands.set(commandModule.data.name, commandModule);
                        this.commandFiles.push(commandModule.data.toJSON());
                        this.debugConfig.log(`Loaded command: ${commandModule.data.name}`, 'command', null, null, 'verbose');
                    } else {
                        this.debugConfig.log(`Invalid command structure in file: ${file}`, 'command', { filePath }, null, 'info');
                    }
                }).catch(error => {
                    this.debugConfig.log(`Failed to load command from ${filePath}:`, 'command', null, error);
                 });
            });

            await Promise.all(importPromises);
            this.debugConfig.log(`Successfully loaded ${this.client.commands.size} commands.`, 'command');
        } catch (error) {
            this.debugConfig.log('Error reading commands directory:', 'command', null, error);
        }
    }

    /**
     * Registers all Discord.js event listeners.
     * @private
     */
    _registerEventListeners() {
        this.debugConfig.log('Registering event listeners...', 'event');
        // Client ready event: fires once when the bot successfully logs in
        this.client.once(Events.ClientReady, async c => {
            this.debugConfig.log(`Bot is ready! Logged in as ${c.user.tag}`, 'client', { userId: c.user.id });
            c.user.setActivity('for new RSS feeds', { type: 'WATCHING' }); // Set bot's activity
            this._scheduleJobs(); // Start all recurring jobs
            await this._registerSlashCommands(); // Register slash commands with Discord API
            initializeGoogleCalendarClient(); // Initialize Google Calendar client
            this._loadActiveVoiceSessions(); // Load any active voice sessions from DB
        });

        // Interaction Create event: handles all interactions (slash commands, buttons, modals, etc.)
        this.client.on(Events.InteractionCreate, this._onInteractionCreate.bind(this));
        // Voice State Update event: tracks users joining/leaving/moving voice channels
        this.client.on(Events.VoiceStateUpdate, this._onVoiceStateUpdate.bind(this));
        // Message Create event: handles new messages (for anti-spam, message stats)
        this.client.on(Events.MessageCreate, this._onMessageCreate.bind(this));
        // Guild Member Add event: handles new members joining a guild
        this.client.on(Events.GuildMemberAdd, this._onGuildMemberAdd.bind(this));
        // Guild Member Remove event: handles members leaving a guild
        this.client.on(Events.GuildMemberRemove, this._onGuildMemberRemove.bind(this));
        // Message Reaction Add event: handles users adding reactions to messages
        this.client.on(Events.MessageReactionAdd, this._onMessageReactionAdd.bind(this));
        // Message Reaction Remove event: handles users removing reactions from messages
        this.client.on(Events.MessageReactionRemove, this._onMessageReactionRemove.bind(this));

        // Discord.js Client Error event: for general client errors
        this.client.on(Events.Error, error => {
            this.debugConfig.log('Discord.js Client Error:', 'client', null, error, 'error');
        });
        // Shard Disconnect event: for when a shard disconnects
        this.client.on(Events.ShardDisconnect, (event, id) => {
            this.debugConfig.log(`Discord.js Shard ${id} Disconnected:`, 'client', { event }, null, 'warn');
        });
        // Shard Reconnecting event: for when a shard attempts to reconnect
        this.client.on(Events.ShardReconnecting, (id) => {
            this.debugConfig.log(`Discord.js Shard ${id} Reconnecting...`, 'client', null, null, 'info');
        });
        // Discord.js Client Warning event: for non-critical warnings
        this.client.on(Events.Warn, info => {
            this.debugConfig.log('Discord.js Client Warning:', 'client', { info }, null, 'warn');
        });
        this.debugConfig.log('Event listeners registered.', 'event');
    }

    /**
     * Registers slash commands with the Discord API.
     * @private
     */
    async _registerSlashCommands() {
        const token = this.token;
        const clientId = process.env.CLIENT_ID;

        if (!token || !clientId) {
            this.debugConfig.log('BOT_TOKEN or CLIENT_ID missing from environment. Cannot register commands.', 'init', null, new Error('Missing credentials'), 'error');
            return;
        }

        const rest = new REST({ version: '10' }).setToken(token);
        this.debugConfig.log('Started refreshing application (/) commands.', 'command');

        try {
            const data = await rest.put(
                Routes.applicationCommands(clientId), {
                    body: this.commandFiles
                },
            );
            this.debugConfig.log(`Successfully reloaded ${data.length} application (/) commands globally.`, 'command');
        } catch (error) {
            this.debugConfig.log('Failed to register application commands', 'command', null, error, 'error');
        }
    }

    /**
     * Loads active voice sessions from the database on bot startup.
     * @private
     */
    async _loadActiveVoiceSessions() {
        return new Promise((resolve, reject) => {
            this.client.db.all(`SELECT user_id, guild_id, channel_id, join_time FROM active_voice_sessions`, [], (err, rows) => {
                if (err) {
                    this.debugConfig.log('Error loading active voice sessions from DB:', 'client', null, err, 'error');
                    return reject(err);
                }
                rows.forEach(row => {
                    this.voiceStates.set(row.user_id, {
                        guildId: row.guild_id,
                        channelId: row.channel_id,
                        joinTime: row.join_time
                    });
                });
                this.debugConfig.log(`Loaded ${rows.length} active voice sessions from database.`, 'client', { count: rows.length }, null, 'info');
                resolve();
            });
        });
    }

    /**
     * Schedules all recurring jobs for the bot (RSS polling, notices, birthdays, etc.).
     * @private
     */
    _scheduleJobs() {
        // Daily Birthday Announcement Schedule (at 12:00 AM)
        schedule.scheduleJob('0 0 * * *', async () => {
            this.debugConfig.log('Running daily birthday announcement...', 'scheduler', null, null, 'info');
            await this._announceBirthdays();
        });
        this.debugConfig.log('Scheduled daily birthday announcements for 12 AM.', 'scheduler', null, null, 'info');

        const RSS_POLL_INTERVAL_MINUTES = parseInt(process.env.RSS_POLL_INTERVAL_MINUTES || '5');
        if (RSS_POLL_INTERVAL_MINUTES > 0) {
            this.debugConfig.log(`Initializing RSS feed polling. Interval: ${RSS_POLL_INTERVAL_MINUTES} minutes.`, 'scheduler', null, null, 'info');
            schedule.scheduleJob(`*/${RSS_POLL_INTERVAL_MINUTES} * * * *`, async () => {
                this.debugConfig.log('Running RSS feed poll...', 'scheduler', null, null, 'info');
                await pollFeeds(this.client);
            });
            this.debugConfig.log(`Scheduled RSS feed polling every ${RSS_POLL_INTERVAL_MINUTES} minutes.`, 'scheduler', null, null, 'info');
        } else {
            this.debugConfig.log('RSS_POLL_INTERVAL_MINUTES is not set or invalid. RSS polling disabled.', 'scheduler', null, null, 'warn');
        }

        // Notice Scraping and Announcement Schedule
        const NOTICE_CHECK_INTERVAL_MS = parseInt(process.env.NOTICE_CHECK_INTERVAL_MS || '1800000'); // Default to 30 minutes (1800000 ms)
        if (NOTICE_CHECK_INTERVAL_MS > 0) {
            this.debugConfig.log(`Initializing notice checking. Interval: ${NOTICE_CHECK_INTERVAL_MS / 1000} seconds.`, 'scheduler', null, null, 'info');
            this._checkAndAnnounceNotices(); // Initial call on startup
            setInterval(() => this._checkAndAnnounceNotices(), NOTICE_CHECK_INTERVAL_MS); // Recurring interval
            this.debugConfig.log(`Scheduled notice checking every ${NOTICE_CHECK_INTERVAL_MS / 60000} minutes.`, 'scheduler', null, null, 'info');
        } else {
            this.debugConfig.log('NOTICE_CHECK_INTERVAL_MS is not set or invalid. Notice scraping disabled.', 'scheduler', null, null, 'warn');
        }
        this.debugConfig.log('All scheduled jobs set up.', 'scheduler', null, null, 'info');
    }

    /**
     * Handles all incoming Discord interactions (slash commands, buttons, modals, etc.).
     * @param {import('discord.js').Interaction} interaction The interaction object.
     * @private
     */
    async _onInteractionCreate(interaction) {
        this.debugConfig.log(`Received interaction`, 'interaction', {
            type: interaction.type,
            id: interaction.id,
            user: interaction.user.tag
        }, null, 'trace');

        // --- Handle Chat Input Commands ---
        if (interaction.isChatInputCommand()) {
            const command = this.client.commands.get(interaction.commandName);

            if (!command) {
                this.debugConfig.log(`Received interaction for unknown slash command: ${interaction.commandName}`, 'command', { user: interaction.user.tag }, null, 'warn');
                await interaction.reply({
                    content: '❌ Unknown command. It might have been removed or is not deployed correctly.',
                    flags: [MessageFlags.Ephemeral]
                }).catch(e => this.debugConfig.log("Error replying to unknown command:", 'interaction', null, e, 'error'));
                return;
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                this.debugConfig.log(`Error executing slash command ${interaction.commandName}:`, 'command', { user: interaction.user.tag }, error, 'error');
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({
                        content: '❌ There was an error while executing this command!',
                        flags: [MessageFlags.Ephemeral]
                    }).catch(e => this.debugConfig.log("Error sending error follow-up:", 'interaction', null, e, 'error'));
                } else {
                    await interaction.reply({
                        content: '❌ There was an error while executing this command!',
                        flags: [MessageFlags.Ephemeral]
                    }).catch(e => this.debugConfig.log("Error sending error reply:", 'interaction', null, e, 'error'));
                }
            }
        }
        // --- Handle Button Interactions ---
        else if (interaction.isButton()) {
            const customId = interaction.customId;
            this.debugConfig.log(`Received button interaction: ${customId}`, 'interaction', { user: interaction.user.tag }, null, 'verbose');

            // --- Specific Button Handlers (that might or might not defer/reply themselves) ---
            if (customId === 'confirm_suggestion' || customId === 'cancel_suggestion') {
                // These are usually handled by collectors or specific commands.
                // For a merged bot, ensure the logic exists or route it.
                // Assuming `_handleSuggestionVote` might eventually handle `confirm_suggestion` via a vote.
                // For now, defer and return.
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.deferUpdate().catch(e => console.error("Error deferring confirm/cancel suggestion button:", e));
                }
                return;
            } else if (customId.startsWith('gotverified_')) {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                    return interaction.reply({
                        content: '❌ You do not have permission to view this list.',
                        ephemeral: true
                    }).catch(e => console.error("Error replying to gotverified permission error:", e));
                }
                await interaction.deferUpdate().catch(e => console.error("Error deferring gotverified button:", e));
                const parts = customId.split('_');
                const action = parts[1];
                let currentPage = parseInt(parts[2], 10);
                const originalUserId = parts[3];
                if (interaction.user.id !== originalUserId) {
                    return interaction.followUp({
                        content: '❌ You cannot control someone else’s verification list.',
                        ephemeral: true
                    }).catch(() => {});
                }
                interaction.client.db.all(
                    `SELECT user_id, real_name, email FROM verified_users WHERE guild_id = ? ORDER BY real_name ASC`,
                    [interaction.guild.id],
                    async (err, allRows) => {
                        if (err || !allRows) {
                            this.debugConfig.log('Error retrieving user list for gotverified button:', 'interaction', null, err, 'error');
                            return interaction.editReply({
                                content: '❌ Could not retrieve user list to change pages.',
                                components: []
                            }).catch(e => console.error("Error editing reply for gotverified DB error:", e));
                        }
                        if (action === 'next') currentPage++;
                        if (action === 'prev') currentPage--;
                        try {
                            const { renderGotVerifiedPage } = await import('./commands/slash/gotVerified.js');
                            const pageData = await renderGotVerifiedPage(interaction, allRows, currentPage, originalUserId);
                            await interaction.editReply(pageData).catch(e => console.error("Error editing reply for gotverified page:", e));
                        } catch (importError) {
                            this.debugConfig.log('Error rendering verified users page for gotverified button:', 'interaction', null, importError, 'error');
                            return interaction.editReply({
                                content: '❌ Error updating the verified users list.',
                                components: []
                            }).catch(e => console.error("Error editing reply for gotverified render error:", e));
                        }
                    }
                );
                return;
            }

            // --- General Deferral for other buttons if not already replied/deferred ---
            // This acts as a catch-all for buttons that might take longer to process,
            // ensuring the "Bot is thinking..." message appears.
            if (!interaction.replied && !interaction.deferred) {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }).catch(e => {
                    if (e.code === 10062) { // Discord API Error: Unknown Interaction
                        this.debugConfig.log(`❗ Interaction ${customId} expired before deferring.`, 'interaction', null, null, 'warn');
                    } else {
                        this.debugConfig.log("Error deferring button interaction:", 'interaction', null, e, 'error');
                    }
                    return; // Important: Return if deferring failed or expired, to prevent further actions on an invalid interaction
                });
            }

            // --- Remaining Specific Button Handlers (assuming interaction is now deferred or was handled above) ---
            if (customId.startsWith('verify_start_button_')) {
                const verifyCmd = this.client.commands.get('verify');
                if (verifyCmd && typeof verifyCmd.handleButtonInteraction === 'function') {
                    try {
                        await verifyCmd.handleButtonInteraction(interaction);
                    } catch (error) {
                        this.debugConfig.log(`Error handling verify_start_button interaction:`, 'interaction', null, error, 'error');
                        await interaction.editReply({ content: '❌ An error occurred with the verification button. Please try the `/verify` command directly.' }).catch(e => console.error("Error editing reply for verify button error:", e));
                    }
                } else {
                    this.debugConfig.log(`verify command not found or handleButtonInteraction function missing for button interaction.`, 'interaction', null, null, 'warn');
                    await interaction.editReply({ content: '❌ The verification command is misconfigured. Please contact an administrator.' }).catch(e => console.error("Error editing reply for misconfigured verify command:", e));
                }
                return;
            } else if (customId.startsWith('confirm_otp_button_')) {
                const confirmOtpCmd = this.client.commands.get('confirmotp');
                if (confirmOtpCmd && typeof confirmOtpCmd.handleButtonInteraction === 'function') {
                    try {
                        await confirmOtpCmd.handleButtonInteraction(interaction);
                    } catch (error) {
                        this.debugConfig.log(`Error handling confirm_otp_button interaction:`, 'interaction', null, error, 'error');
                        await interaction.editReply({ content: '❌ An error occurred with the OTP confirmation button. Please try the `/confirmotp` command directly.' }).catch(e => console.error("Error editing reply for confirmotp button error:", e));
                    }
                } else {
                    this.debugConfig.log(`confirmotp command not found or handleButtonInteraction function missing for button interaction.`, 'interaction', null, null, 'warn');
                    await interaction.editReply({ content: '❌ The OTP confirmation command is misconfigured. Please contact an administrator.' }).catch(e => console.error("Error editing reply for misconfigured confirmotp command:", e));
                }
                return;
            } else if (customId.startsWith('confirm_setup_fsu_') || customId.startsWith('cancel_setup_fsu_')) {
                const setupFSUCommand = this.client.commands.get('setupfsu');
                if (setupFSUCommand && typeof setupFSUCommand._performSetupLogic === 'function') {
                    if (customId.startsWith('confirm_setup_fsu_')) {
                        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                            return interaction.editReply({ content: 'You do not have permission to confirm this action.' }).catch(e => console.error("Error editing reply for FSU setup permission error:", e));
                        }
                        await interaction.editReply({ content: '🔧 Beginning FSU server setup... This may take a moment.', components: [], embeds: [] }).catch(e => console.error("Error editing reply for FSU setup initiation:", e));
                        await setupFSUCommand._performSetupLogic(interaction);
                    } else if (customId.startsWith('cancel_setup_fsu_')) {
                        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                            return interaction.editReply({ content: 'You do not have permission to cancel this action.' }).catch(e => console.error("Error editing reply for FSU cancel permission error:", e));
                        }
                        await interaction.editReply({ content: '❌ FSU server setup cancelled.', components: [], embeds: [] }).catch(e => console.error("Error editing reply for FSU setup cancellation:", e));
                    }
                } else {
                    this.debugConfig.log(`Setup command not found or is misconfigured for FSU setup button.`, 'interaction', null, null, 'warn');
                    await interaction.editReply({ content: '❌ Setup command not found or is misconfigured.' }).catch(e => console.error("Error editing reply for misconfigured FSU setup command:", e));
                }
                return;
            } else if (customId.startsWith('suggest_vote_')) {
                await this._handleSuggestionVote(interaction);
                return;
            } else if (customId.startsWith('delete_suggestion_')) {
                await this._handleSuggestionDelete(interaction);
                return;
            }

            await interaction.editReply({ content: '❌ Unknown button interaction.' }).catch(e => this.debugConfig.log("Error editing reply for unknown button:", 'interaction', null, e, 'error'));
        }
        // --- Handle Modal Submissions ---
        else if (interaction.isModalSubmit()) {
            this.debugConfig.log(`Received modal submission: ${interaction.customId}`, 'interaction', { user: interaction.user.tag }, null, 'verbose');

            if (interaction.customId === 'verifyModal') {
                const verifyCmd = this.client.commands.get('verify');
                if (verifyCmd && typeof verifyCmd.handleModalSubmit === 'function') {
                    try {
                        await verifyCmd.handleModalSubmit(interaction);
                    } catch (error) {
                        this.debugConfig.log(`Error handling verifyModal submission:`, 'interaction', null, error, 'error');
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '❌ An error occurred with the verification process.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error replying to modal error:", e));
                        } else {
                            await interaction.followUp({ content: '❌ An error occurred with the verification process.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error following up to modal error:", e));
                        }
                    }
                } else {
                    this.debugConfig.log('Verify command not found or handleModalSubmit function missing for verifyModal.', 'interaction', null, null, 'warn');
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '❌ An error occurred with the verification process.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error replying to misconfigured modal:", e));
                    } else {
                        await interaction.followUp({ content: '❌ An error occurred with the verification process.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error following up to misconfigured modal:", e));
                    }
                }
                return;
            } else if (interaction.customId === 'confirmOtpModal') {
                const confirmOtpCmd = this.client.commands.get('confirmotp');
                if (confirmOtpCmd && typeof confirmOtpCmd.handleModalSubmit === 'function') {
                    try {
                        await confirmOtpCmd.handleModalSubmit(interaction);
                    } catch (error) {
                        this.debugConfig.log(`Error handling confirmOtpModal submission:`, 'interaction', null, error, 'error');
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '❌ An error occurred with the OTP confirmation.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error replying to modal error:", e));
                        } else {
                            await interaction.followUp({ content: '❌ An error occurred with the OTP confirmation.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error following up to modal error:", e));
                        }
                    }
                } else {
                    this.debugConfig.log('ConfirmOTP command not found or handleModalSubmit function missing for confirmOtpModal.', 'interaction', null, null, 'warn');
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '❌ An error occurred with the OTP confirmation.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error replying to misconfigured modal:", e));
                    } else {
                        await interaction.followUp({ content: '❌ An error occurred with the OTP confirmation.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error following up to misconfigured modal:", e));
                    }
                }
                return;
            } else if (interaction.customId.startsWith('deny_reason_modal_')) {
                const suggestionId = interaction.customId.split('_')[3];
                const reason = interaction.fields.getTextInputValue('denyReasonInput');
                await this._processSuggestionDenial(interaction, suggestionId, reason);
                return;
            } else if (interaction.customId.startsWith('delete_reason_modal_')) {
                const suggestionId = interaction.customId.split('_')[3];
                const reason = interaction.fields.getTextInputValue('deleteReasonInput');
                await this._processSuggestionDelete(interaction, suggestionId, reason);
                return;
            }

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ Unknown modal submission.', flags: [MessageFlags.Ephemeral] }).catch(e => this.debugConfig.log("Error replying to unknown modal:", 'interaction', null, e, 'error'));
            } else {
                await interaction.followUp({ content: '❌ Unknown modal submission.', flags: [MessageFlags.Ephemeral] }).catch(e => this.debugConfig.log("Error following up to unknown modal:", 'interaction', null, e, 'error'));
            }
        }
    }

    /**
     * Handles voice state updates (user joining/leaving/moving channels).
     * @param {import('discord.js').VoiceState} oldState The old voice state.
     * @param {import('discord.js').VoiceState} newState The new voice state.
     * @private
     */
    async _onVoiceStateUpdate(oldState, newState) {
        const userId = newState.member.id;
        const guildId = newState.guild.id;
        const currentTime = Date.now();

        if (!oldState.channelId && newState.channelId) {
            this.client.db.run(`INSERT OR REPLACE INTO active_voice_sessions (user_id, guild_id, channel_id, join_time) VALUES (?, ?, ?, ?)`,
                [userId, guildId, newState.channelId, currentTime],
                (err) => {
                    if (err) this.debugConfig.log('Error inserting active voice session:', 'event', null, err, 'error');
                    else {
                        this.voiceStates.set(userId, { guildId, channelId: newState.channelId, joinTime: currentTime });
                        this.debugConfig.log(`[Voice] ${newState.member.user.tag} joined voice channel ${newState.channel.name}. Session started.`, 'event', { userId, channelId: newState.channelId }, null, 'info');
                    }
                }
            );
        }
        else if (oldState.channelId && (!newState.channelId || oldState.channelId !== newState.channelId)) {
            this.client.db.get(`SELECT join_time FROM active_voice_sessions WHERE user_id = ? AND guild_id = ?`, [userId, guildId], async (err, row) => {
                if (err) {
                    this.debugConfig.log('Error fetching active voice session for update:', 'event', null, err, 'error');
                    return;
                }
                if (row) {
                    const durationMs = currentTime - row.join_time;
                    const durationMinutes = Math.floor(durationMs / (1000 * 60));

                    if (durationMinutes > 0) {
                        this.client.db.run(`INSERT INTO user_stats (user_id, guild_id, messages_sent, voice_time_minutes) VALUES (?, ?, 0, ?)
                                     ON CONFLICT(user_id, guild_id) DO UPDATE SET voice_time_minutes = voice_time_minutes + ?`,
                            [userId, guildId, durationMinutes, durationMinutes],
                            (updateErr) => {
                                if (updateErr) this.debugConfig.log('Error updating voice time in user_stats:', 'event', null, updateErr, 'error');
                                else this.debugConfig.log(`[Voice] Updated voice time for ${oldState.member.user.tag} by ${durationMinutes} minutes.`, 'event', { userId, durationMinutes }, null, 'info');
                            }
                        );
                    }
                    this.client.db.run(`DELETE FROM active_voice_sessions WHERE user_id = ? AND guild_id = ?`, [userId, guildId], (deleteErr) => {
                        if (deleteErr) this.debugConfig.log('Error deleting active voice session:', 'event', null, deleteErr, 'error');
                        else this.debugConfig.log(`[Voice] Session for ${oldState.member.user.tag} ended/moved.`, 'event', { userId }, null, 'info');
                    });
                } else {
                    this.debugConfig.log(`[Voice] No active session found in DB for ${oldState.member.user.tag} when leaving/moving channel.`, 'event', { userId }, null, 'warn');
                }
                this.voiceStates.delete(userId);
                if (newState.channelId) {
                    this.client.db.run(`INSERT INTO active_voice_sessions (user_id, guild_id, channel_id, join_time) VALUES (?, ?, ?, ?)`,
                        [userId, guildId, newState.channelId, currentTime],
                        (err) => {
                            if (err) this.debugConfig.log('Error inserting new active voice session after move:', 'event', null, err, 'error');
                            else {
                                this.voiceStates.set(userId, { guildId, channelId: newState.channelId, joinTime: currentTime });
                                this.debugConfig.log(`[Voice] ${newState.member.user.tag} moved to ${newState.channel.name}. New session started.`, 'event', { userId, newChannelId: newState.channelId }, null, 'info');
                            }
                        }
                    );
                }
            });
        }
    }

    /**
     * Handles new messages created in guilds.
     * @param {import('discord.js').Message} message The message object.
     * @private
     */
    async _onMessageCreate(message) {
        if (message.author.bot || !message.guild) return;

        await this._handleAntiSpam(message);
        await this._updateUserMessageStats(message);
    }

    /**
     * Handles new guild members joining.
     * @param {import('discord.js').GuildMember} member The guild member.
     * @private
     */
    async _onGuildMemberAdd(member) {
        if (member.user.bot) return; 

        this.debugConfig.log(`User ${member.user.tag} (${member.user.id}) joined guild ${member.guild.name} (${member.guild.id}).`, 'event', { user: member.user.id, guild: member.guild.id }, null, 'info');

        const userAvatar = member.user.displayAvatarURL({ dynamic: true, size: 128 });
        const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
        this.client.db.get(`SELECT welcome_message_content, welcome_channel_id, send_welcome_as_dm FROM guild_configs WHERE guild_id = ?`, [member.guild.id], async (err, row) => {
            if (err) {
                this.debugConfig.log('Error fetching welcome config:', 'event', null, err, 'error');
                return;
            }

            let welcomeMessage = row?.welcome_message_content || `Welcome to ${member.guild.name}, ${member}!`;
            welcomeMessage = welcomeMessage.replace(/{user}/g, member.toString())
                                           .replace(/{guild}/g, member.guild.name);

            let dmEmbed;
            let dmComponents = [];
            this.client.db.get(`SELECT user_id FROM verified_users WHERE user_id = ? AND guild_id = ?`, [member.user.id, member.guild.id], async (err, verifiedRow) => {
                if (err) {
                    this.debugConfig.log('Error checking verified_users table:', 'event', null, err, 'error');
                }

                if (verifiedRow) {
                    this.debugConfig.log(`User ${member.user.tag} was previously verified. Attempting to re-assign role.`, 'event', { user: member.user.id }, null, 'info');
                    if (VERIFIED_ROLE_ID) {
                        const verifiedRole = member.guild.roles.cache.get(VERIFIED_ROLE_ID);
                        if (verifiedRole) {
                            try {
                                await member.roles.add(verifiedRole);
                                this.debugConfig.log(`Re-assigned verified role to ${member.user.tag}.`, 'event', { user: member.user.id, role: verifiedRole.name }, null, 'success');
                            } catch (roleErr) {
                                this.debugConfig.log(`Failed to re-assign verified role to ${member.user.tag}:`, 'event', null, roleErr, 'error');
                            }
                        } else {
                            this.debugConfig.log(`VERIFIED_ROLE_ID (${VERIFIED_ROLE_ID}) not found in guild ${member.guild.name}.`, 'event', { guild: member.guild.id }, null, 'warn');
                        }
                    }

                    dmEmbed = new EmbedBuilder()
                        .setColor('#00FF00')
                        .setTitle(`👋 Welcome Back to ${member.guild.name}!`)
                        .setDescription(`It's great to see you again, **${member.user.username}**! You've been automatically re-verified. Enjoy your stay!`)
                        .setThumbnail(userAvatar)
                        .setFooter({ text: 'Pulchowk Bot | Welcome Back' })
                        .setTimestamp();

                } else {
                    const verifyButton = new ButtonBuilder()
                        .setCustomId(`verify_start_button_${member.user.id}`)
                        .setLabel('Verify Your Account')
                        .setStyle(ButtonStyle.Primary);

                    dmComponents = [new ActionRowBuilder().addComponents(verifyButton)];

                    dmEmbed = new EmbedBuilder()
                        .setColor('#0099ff')
                        .setTitle(`👋 Welcome to ${member.guild.name}!`)
                        .setDescription(`We're excited to have you here, ${member.user.username}! To gain full access to the server, please verify your account.`)
                        .addFields(
                            { name: 'How to Verify:', value: 'Click the button below to start the verification process.' }
                        )
                        .setThumbnail(userAvatar)
                        .setFooter({ text: 'Pulchowk Bot | Secure Verification' })
                        .setTimestamp();
                }

                try {
                    await member.send({ embeds: [dmEmbed], components: dmComponents });
                    this.debugConfig.log(`Sent welcome DM to ${member.user.tag}.`, 'event', { user: member.user.id }, null, 'info');
                } catch (dmErr) {
                    this.debugConfig.log(`Could not send welcome DM to ${member.user.tag}:`, 'event', null, dmErr, 'warn');
                }

                if (row && row.welcome_channel_id) {
                    const channel = member.guild.channels.cache.get(row.welcome_channel_id);
                    if (channel && (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)) {
                        const publicWelcomeEmbed = new EmbedBuilder()
                            .setColor('#00FF00')
                            .setTitle(`🎉 A New Pulchowkian Has Arrived!`)
                            .setDescription(`Please give a warm welcome to <@${member.id}>!`)
                            .setThumbnail(userAvatar)
                            .setFooter({ text: `Member Count: ${member.guild.memberCount}` })
                            .setTimestamp();

                        if (row.welcome_message_content) {
                            publicWelcomeEmbed.addFields({
                                name: 'Message from the Admins:',
                                value: row.welcome_message_content.replace(/{user}/g, `<@${member.id}>`).replace(/{guild}/g, member.guild.name)
                            });
                        }

                        await channel.send({ embeds: [publicWelcomeEmbed] }).catch(e => this.debugConfig.log('Error sending public welcome message:', 'event', null, e, 'error'));
                        this.debugConfig.log(`Sent public welcome message to ${channel.name} for ${member.user.tag}`, 'event', { user: member.user.id, channel: channel.id }, null, 'info');
                    } else {
                        this.debugConfig.log(`Configured welcome channel ${row.welcome_channel_id} not found or is not a text/announcement channel for public welcome.`, 'event', { channelId: row.welcome_channel_id }, null, 'warn');
                    }
                }
            });
        });
    }

    /**
     * Handles members leaving a guild.
     * @param {import('discord.js').GuildMember} member The guild member.
     * @private
     */
    async _onGuildMemberRemove(member) {
        if (member.user.bot) return;

        this.debugConfig.log(`User ${member.user.tag} (${member.user.id}) left guild ${member.guild.name} (${member.guild.id}).`, 'event', { user: member.user.id, guild: member.guild.id }, null, 'info');

        try {
            const row = await new Promise((resolve, reject) => {
                this.client.db.get(`SELECT farewell_channel_id FROM guild_configs WHERE guild_id = ?`, [member.guild.id], (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                });
            });
            let farwellChannelId = row?.farewell_channel_id || process.env.FAREWELL_CHANNEL_ID;
            if (row && farwellChannelId) {
                const farewellChannel = member.guild.channels.cache.get(farwellChannelId);
                if (farewellChannel && (farewellChannel.type === ChannelType.GuildText || farewellChannel.type === ChannelType.GuildAnnouncement)) {
                    await farewellChannel.send({ embeds: [new EmbedBuilder()
                        .setColor('#FF0000')
                        .setDescription(`👋 **${member.user.tag}** has left the server. We'll miss them!`)
                        .setTimestamp()
                    ]}).catch(e => this.debugConfig.log("Error sending farewell message to channel:", 'event', null, e, 'error'));
                    this.debugConfig.log(`Successfully attempted to send farewell message to channel for ${member.user.tag}.`, 'event', { user: member.user.id, channel: farwellChannelId }, null, 'info');
                } else {
                    this.debugConfig.log(`Configured farewell channel ${farwellChannelId} not found or is not a text/announcement channel.`, 'event', { channelId: farwellChannelId }, null, 'warn');
                }
            }
            const farewellEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle(`Goodbye from ${member.guild.name}!`)
                .setDescription(`We're sorry to see you go, **${member.user.username}**! We hope you had a good time with us.`)
                .setThumbnail(member.guild.iconURL())
                .setTimestamp()
                .setFooter({ text: 'Pulchowk Bot | You can rejoin anytime!' });

            await member.user.send({ embeds: [farewellEmbed] }).catch(error => {
                this.debugConfig.log(`Could not send farewell DM to ${member.user.tag}:`, 'event', null, error, 'warn');
            });
            this.debugConfig.log(`Successfully attempted to send farewell DM to ${member.user.tag}.`, 'event', { user: member.user.id }, null, 'info');
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            this.debugConfig.log('An unexpected error occurred during guild member removal process:', 'event', null, error, 'error');
        }
    }

    /**
     * Handles reactions being added to messages.
     * @param {import('discord.js').MessageReaction} reaction The message reaction.
     * @param {import('discord.js').User} user The user who added the reaction.
     * @private
     */
    async _onMessageReactionAdd(reaction, user) {
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                this.debugConfig.log('Something went wrong when fetching the reaction:', 'event', null, error, 'error');
                return;
            }
        }
        if (user.bot || !reaction.message.guild) return;

        this.client.db.get(`SELECT role_id FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?`,
            [reaction.message.guild.id, reaction.message.id, reaction.emoji.name],
            async (err, row) => {
                if (err) {
                    this.debugConfig.log('Error fetching reaction role:', 'event', null, err, 'error');
                    return;
                }
                if (row) {
                    const member = reaction.message.guild.members.cache.get(user.id);
                    if (member) {
                        const role = reaction.message.guild.roles.cache.get(row.role_id);
                        if (role) {
                            if (!member.roles.cache.has(role.id)) {
                                if (!reaction.message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                                    this.debugConfig.log(`Bot lacks 'Manage Roles' permission to assign role ${role.name} for reaction role.`, 'event', { role: role.name }, null, 'error');
                                    return;
                                }
                                if (reaction.message.guild.members.me.roles.highest.position <= role.position) {
                                    this.debugConfig.log(`Bot's highest role is not above ${role.name} for reaction role assignment.`, 'event', { role: role.name }, null, 'error');
                                    return;
                                }
                                try {
                                    await member.roles.add(role, 'Reaction role assignment');
                                    this.debugConfig.log(`Assigned role ${role.name} to ${user.tag} via reaction.`, 'event', { user: user.id, role: role.name }, null, 'info');
                                } catch (roleErr) {
                                    this.debugConfig.log(`Error assigning role ${role.name} to ${user.tag}:`, 'event', null, roleErr, 'error');
                                }
                            }
                        } else {
                            this.debugConfig.log(`Configured role ${row.role_id} for reaction role not found in guild ${reaction.message.guild.name}. Deleting invalid entry.`, 'event', { roleId: row.role_id, guild: reaction.message.guild.id }, null, 'warn');
                            this.client.db.run(`DELETE FROM reaction_roles WHERE role_id = ? AND guild_id = ?`, [row.role_id, reaction.message.guild.id]);
                        }
                    }
                }
            }
        );

        const SUGGESTIONS_CHANNEL_ID = process.env.SUGGESTIONS_CHANNEL_ID;
        if (reaction.message.channel.id === SUGGESTIONS_CHANNEL_ID && (reaction.emoji.name === '👍' || reaction.emoji.name === '👎')) {
            const message = await reaction.message.fetch().catch(e => this.debugConfig.log('Error fetching suggestion message for reaction:', 'event', null, e, 'error'));
            if (!message) return;

            this.client.db.get(`SELECT id, upvotes, downvotes, user_id FROM suggestions WHERE message_id = ? AND guild_id = ?`,
                [message.id, message.guild.id],
                async (err, row) => {
                    if (err) {
                        this.debugConfig.log('Error fetching suggestion for voting:', 'event', null, err, 'error');
                        return;
                    }
                    if (row) {
                        if (user.id === row.user_id) {
                            await reaction.users.remove(user.id).catch(e => this.debugConfig.log('Error removing self-vote reaction:', 'event', null, e, 'error'));
                            return;
                        }

                        let newUpvotes = row.upvotes || 0;
                        let newDownvotes = row.downvotes || 0;

                        const hasUpvoted = message.reactions.cache.get('👍')?.users.cache.has(user.id);
                        const hasDownvoted = message.reactions.cache.get('👎')?.users.cache.has(user.id);

                        if (reaction.emoji.name === '👍') {
                            if (hasDownvoted) {
                                await message.reactions.cache.get('👎').users.remove(user.id).catch(e => this.debugConfig.log('Error removing opposite reaction (downvote):', 'event', null, e, 'error'));
                                newDownvotes = Math.max(0, newDownvotes - 1);
                            }
                            newUpvotes++;
                        } else if (reaction.emoji.name === '👎') {
                            if (hasUpvoted) {
                                await message.reactions.cache.get('👍').users.remove(user.id).catch(e => this.debugConfig.log('Error removing opposite reaction (upvote):', 'event', null, e, 'error'));
                                newUpvotes = Math.max(0, newUpvotes - 1);
                            }
                            newDownvotes++;
                        }

                        this.client.db.run(`UPDATE suggestions SET upvotes = ?, downvotes = ? WHERE id = ?`,
                            [newUpvotes, newDownvotes, row.id],
                            (updateErr) => {
                                if (updateErr) {
                                    this.debugConfig.log('Error updating suggestion votes:', 'event', null, updateErr, 'error');
                                    return;
                                }
                                if (message.embeds[0]) {
                                    const updatedEmbed = EmbedBuilder.from(message.embeds[0])
                                        .setFooter({ text: `Suggestion ID: ${row.id} | Votes: 👍 ${newUpvotes} / 👎 ${newDownvotes}` });
                                    message.edit({ embeds: [updatedEmbed] }).catch(e => this.debugConfig.log('Error editing suggestion message embed:', 'event', null, e, 'error'));
                                }
                                this.debugConfig.log(`Updated votes for suggestion ${row.id}: 👍 ${newUpvotes} / 👎 ${newDownvotes}`, 'event', { suggestionId: row.id }, null, 'info');
                            }
                        );
                    }
                }
            );
        }
    }

    /**
     * Handles reactions being removed from messages.
     * @param {import('discord.js').MessageReaction} reaction The message reaction.
     * @param {import('discord.js').User} user The user who removed the reaction.
     * @private
     */
    async _onMessageReactionRemove(reaction, user) {
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                this.debugConfig.log('Something went wrong when fetching the reaction on remove:', 'event', null, error, 'error');
                return;
            }
        }
        if (user.bot || !reaction.message.guild) return;
        this.client.db.get(`SELECT role_id FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?`,
            [reaction.message.guild.id, reaction.message.id, reaction.emoji.name],
            async (err, row) => {
                if (err) {
                    this.debugConfig.log('Error fetching reaction role on remove:', 'event', null, err, 'error');
                    return;
                }
                if (row) {
                    const member = reaction.message.guild.members.cache.get(user.id);
                    if (member) {
                        const role = reaction.message.guild.roles.cache.get(row.role_id);
                        if (role) {
                            if (member.roles.cache.has(role.id)) {
                                if (!reaction.message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                                    this.debugConfig.log(`Bot lacks 'Manage Roles' permission to remove role ${role.name} for reaction role.`, 'event', { role: role.name }, null, 'error');
                                    return;
                                }
                                if (reaction.message.guild.members.me.roles.highest.position <= role.position) {
                                    this.debugConfig.log(`Bot's highest role is not above ${role.name} for reaction role removal.`, 'event', { role: role.name }, null, 'error');
                                    return;
                                }
                                try {
                                    await member.roles.remove(role, 'Reaction role removal');
                                    this.debugConfig.log(`Removed role ${role.name} from ${user.tag} via reaction.`, 'event', { user: user.id, role: role.name }, null, 'info');
                                } catch (roleErr) {
                                    this.debugConfig.log(`Error removing role ${role.name} from ${user.tag}:`, 'event', null, roleErr, 'error');
                                }
                            }
                        }
                    }
                }
            }
        );

        const SUGGESTIONS_CHANNEL_ID = process.env.SUGGESTIONS_CHANNEL_ID;
        if (reaction.message.channel.id === SUGGESTIONS_CHANNEL_ID && (reaction.emoji.name === '👍' || reaction.emoji.name === '👎')) {
            const message = await reaction.message.fetch().catch(e => this.debugConfig.log('Error fetching suggestion message for reaction removal:', 'event', null, e, 'error'));
            if (!message) return;

            this.client.db.get(`SELECT id, upvotes, downvotes, user_id FROM suggestions WHERE message_id = ? AND guild_id = ?`,
                [message.id, message.guild.id],
                async (err, row) => {
                    if (err) {
                        this.debugConfig.log('Error fetching suggestion for voting removal:', 'event', null, err, 'error');
                        return;
                    }
                    if (row) {
                        if (user.id === row.user_id) return; 

                        let newUpvotes = row.upvotes || 0;
                        let newDownvotes = row.downvotes || 0;

                        if (reaction.emoji.name === '👍') {
                            newUpvotes = Math.max(0, newUpvotes - 1);
                        } else if (reaction.emoji.name === '👎') {
                            newDownvotes = Math.max(0, newDownvotes - 1);
                        }

                        this.client.db.run(`UPDATE suggestions SET upvotes = ?, downvotes = ? WHERE id = ?`,
                            [newUpvotes, newDownvotes, row.id],
                            (updateErr) => {
                                if (updateErr) {
                                    this.debugConfig.log('Error updating suggestion votes on removal:', 'event', null, updateErr, 'error');
                                    return;
                                }
                                if (message.embeds[0]) {
                                    const updatedEmbed = EmbedBuilder.from(message.embeds[0])
                                        .setFooter({ text: `Suggestion ID: ${row.id} | Votes: 👍 ${newUpvotes} / 👎 ${newDownvotes}` });
                                    message.edit({ embeds: [updatedEmbed] }).catch(e => this.debugConfig.log('Error editing suggestion message embed on removal:', 'event', null, e, 'error'));
                                }
                                this.debugConfig.log(`Updated votes for suggestion ${row.id} after removal: 👍 ${newUpvotes} / 👎 ${newDownvotes}`, 'event', { suggestionId: row.id }, null, 'info');
                            }
                        );
                    }
                }
            );
        }
    }

    /**
     * Handles anti-spam logic for messages.
     * @param {import('discord.js').Message} message The message object.
     * @private
     */
    async _handleAntiSpam(message) {
        if (!message.guild) {
            return;
        }
        const userId = message.author.id;
        const guildId = message.guild.id;

        this.client.db.get(`SELECT message_limit, time_window_seconds, mute_duration_seconds, kick_threshold, ban_threshold FROM anti_spam_configs WHERE guild_id = ?`, [guildId], async (err, config) => {
            if (err) {
                this.debugConfig.log('Error fetching anti-spam config:', 'event', null, err, 'error');
                return;
            }
            const antiSpamConfig = config || {
                message_limit: 5,
                time_window_seconds: 5,
                mute_duration_seconds: 300,
                kick_threshold: 3,
                ban_threshold: 5
            };
            const { message_limit, time_window_seconds, mute_duration_seconds, kick_threshold, ban_threshold } = antiSpamConfig;

            if (!this.spamMap.has(userId)) {
                this.spamMap.set(userId, {
                    count: 1,
                    lastMessageTimestamp: message.createdTimestamp,
                    timer: setTimeout(() => {
                        this.spamMap.delete(userId);
                        this.debugConfig.log(`Anti-spam: Timer expired for user ${userId}. Resetting spam count.`, 'event', { userId }, null, 'verbose');
                    }, time_window_seconds * 1000)
                });
                this.debugConfig.log(`Anti-spam: Initialized spam tracking for user ${userId}.`, 'event', { userId, count: 1 }, null, 'verbose');
            } else {
                const userData = this.spamMap.get(userId);
                userData.count++;
                clearTimeout(userData.timer);
                userData.timer = setTimeout(() => {
                    this.spamMap.delete(userId);
                    this.debugConfig.log(`Anti-spam: Timer re-expired for user ${userId}. Resetting spam count.`, 'event', { userId }, null, 'verbose');
                }, time_window_seconds * 1000);

                this.debugConfig.log(`Anti-spam: User ${userId} message count: ${userData.count}/${message_limit} within ${time_window_seconds}s.`, 'event', { userId, count: userData.count }, null, 'verbose');

                if (userData.count > message_limit) {
                    this.spamWarnings.set(userId, (this.spamWarnings.get(userId) || 0) + 1);
                    const currentWarnings = this.spamWarnings.get(userId);
                    this.debugConfig.log(`Anti-spam: User ${userId} triggered spam limit. Warnings: ${currentWarnings}.`, 'event', { userId, warnings: currentWarnings }, null, 'warn');

                    if (currentWarnings >= ban_threshold) {
                        if (message.member && message.member.bannable) {
                            await message.member.ban({ reason: `Automated anti-spam: ${currentWarnings} spam warnings.` }).catch(e => this.debugConfig.log('Error banning:', 'event', null, e, 'error'));
                            message.channel.send(`🚨 ${message.author.tag} has been banned for repeated spamming. (${currentWarnings} warnings)`).catch(e => console.error("Error sending ban message:", e));
                            this.spamWarnings.delete(userId);
                            this.debugConfig.log(`Anti-spam: User ${userId} banned.`, 'event', { userId }, null, 'critical');
                        } else {
                            message.channel.send(`🚨 Anti-spam: ${message.author.tag} is spamming but I cannot ban them.`).catch(e => console.error("Error sending ban failure message:", e));
                            this.debugConfig.log(`Anti-spam: Cannot ban user ${userId}. Missing permissions or role hierarchy.`, 'event', { userId }, null, 'warn');
                        }
                    } else if (currentWarnings >= kick_threshold) {
                        if (message.member && message.member.kickable) {
                            await message.member.kick(`Automated anti-spam: ${currentWarnings} spam warnings.`).catch(e => this.debugConfig.log('Error kicking:', 'event', null, e, 'error'));
                            message.channel.send(`⚠️ ${message.author.tag} has been kicked for excessive spamming. (${currentWarnings} warnings)`).catch(e => console.error("Error sending kick message:", e));
                            this.debugConfig.log(`Anti-spam: User ${userId} kicked.`, 'event', { userId }, null, 'critical');
                        } else {
                            message.channel.send(`⚠️ Anti-spam: ${message.author.tag} is spamming but I cannot kick them.`).catch(e => console.error("Error sending kick failure message:", e));
                            this.debugConfig.log(`Anti-spam: Cannot kick user ${userId}. Missing permissions or role hierarchy.`, 'event', { userId }, null, 'warn');
                        }
                    } else {
                        const muteDurationMs = mute_duration_seconds * 1000;
                        if (message.member && message.member.moderatable && !message.member.isCommunicationDisabled()) {
                            await message.member.timeout(muteDurationMs, 'Automated anti-spam mute').catch(e => this.debugConfig.log('Error timing out:', 'event', null, e, 'error'));
                            message.channel.send(`🔇 ${message.author.tag} has been timed out for ${mute_duration_seconds} seconds due to spamming. (Warning ${currentWarnings}/${kick_threshold})`).catch(e => console.error("Error sending mute message:", e));
                            this.debugConfig.log(`Anti-spam: User ${userId} timed out for ${mute_duration_seconds}s.`, 'event', { userId, duration: mute_duration_seconds }, null, 'warn');
                        } else {
                            message.channel.send(`🔇 Anti-spam: ${message.author.tag} is spamming but I cannot mute them. (Warning ${currentWarnings}/${kick_threshold})`).catch(e => console.error("Error sending mute failure message:", e));
                            this.debugConfig.log(`Anti-spam: Cannot mute user ${userId}. Missing permissions or role hierarchy.`, 'event', { userId }, null, 'warn');
                        }
                    }
                    if (message.channel.permissionsFor(this.client.user).has(PermissionsBitField.Flags.ManageMessages)) {
                        await message.channel.bulkDelete(Math.min(userData.count, 100), true).catch(e => this.debugConfig.log('Error bulk deleting messages:', 'event', null, e, 'error'));
                        this.debugConfig.log(`Anti-spam: Bulk deleted ${Math.min(userData.count, 100)} messages for user ${userId}.`, 'event', { userId, count: Math.min(userData.count, 100) }, null, 'info');
                    } else {
                        this.debugConfig.log(`Bot lacks 'Manage Messages' permission to delete spam messages in channel ${message.channel.name}.`, 'event', { channel: message.channel.id }, null, 'warn');
                    }
                    this.spamMap.delete(userId);
                }
            }
        });
    }

    /**
     * Updates user message statistics in the database.
     * @param {import('discord.js').Message} message The message object.
     * @private
     */
    async _updateUserMessageStats(message) {
        const userId = message.author.id;
        const guildId = message.guild.id;
        const now = Date.now();

        this.client.db.run(`INSERT INTO user_stats (user_id, guild_id, messages_sent, last_message_at) VALUES (?, ?, 1, ?)
                     ON CONFLICT(user_id, guild_id) DO UPDATE SET messages_sent = messages_sent + 1, last_message_at = ?`,
            [userId, guildId, now, now],
            (err) => {
                if (err) this.debugConfig.log('Error updating message stats:', 'event', null, err, 'error');
                else this.debugConfig.log(`Updated message stats for user ${userId} in guild ${guildId}.`, 'event', { userId, guildId }, null, 'verbose');
            }
        );
    }

    /**
     * Checks for new notices from the configured source, processes attachments (PDF to PNG),
     * and announces them to the designated Discord channel, splitting messages if too many attachments.
     * Temporary files are cleaned up after each notice is processed.
     * @private
     */
    async _checkAndAnnounceNotices() {
        this.debugConfig.log('Starting check for new notices...', 'scheduler', null, null, 'info');
        const TARGET_NOTICE_CHANNEL_ID = process.env.TARGET_NOTICE_CHANNEL_ID;
        const NOTICE_ADMIN_CHANNEL_ID = process.env.NOTICE_ADMIN_CHANNEL_ID;
        const TEMP_ATTACHMENT_DIR = path.join(process.cwd(), 'temp_notice_attachments');

        this.debugConfig.log(`TARGET_NOTICE_CHANNEL_ID: ${TARGET_NOTICE_CHANNEL_ID}`, 'scheduler', null, null, 'verbose');
        this.debugConfig.log(`NOTICE_ADMIN_CHANNEL_ID: ${NOTICE_ADMIN_CHANNEL_ID}`, 'scheduler', null, null, 'verbose');
        this.debugConfig.log(`Current Working Directory (process.cwd()): ${process.cwd()}`, 'scheduler', null, null, 'verbose');
        this.debugConfig.log(`Calculated TEMP_ATTACHMENT_DIR: ${TEMP_ATTACHMENT_DIR}`, 'scheduler', null, null, 'verbose');

        try {
            await fsPromises.mkdir(TEMP_ATTACHMENT_DIR, { recursive: true });
            this.debugConfig.log(`Successfully ensured TEMP_ATTACHMENT_DIR exists: ${TEMP_ATTACHMENT_DIR}`, 'scheduler', null, null, 'verbose');
        } catch (e) {
            this.debugConfig.log(`Error creating TEMP_ATTACHMENT_DIR (${TEMP_ATTACHMENT_DIR}):`, 'scheduler', null, e, 'error');
            let adminChannel;
            if (NOTICE_ADMIN_CHANNEL_ID && NOTICE_ADMIN_CHANNEL_ID !== 'YOUR_NOTICE_ADMIN_CHANNEL_ID_HERE') {
                try {
                    adminChannel = await this.client.channels.fetch(NOTICE_ADMIN_CHANNEL_ID);
                    if (adminChannel) await adminChannel.send(`❌ Critical: Could not create temp directory: ${e.message}`).catch(sendErr => console.error("Error sending admin error:", sendErr));
                } catch (fetchErr) {
                    this.debugConfig.log(`Could not fetch admin channel for error notification:`, 'scheduler', null, fetchErr, 'warn');
                }
            }
            return;
        }

        if (!TARGET_NOTICE_CHANNEL_ID || TARGET_NOTICE_CHANNEL_ID === 'YOUR_NOTICE_CHANNEL_ID_HERE') {
            this.debugConfig.log('TARGET_NOTICE_CHANNEL_ID not configured. Skipping notice announcements.', 'scheduler', null, null, 'warn');
            return;
        }

        let noticeChannel;
        try {
            noticeChannel = await this.client.channels.fetch(TARGET_NOTICE_CHANNEL_ID);
            if (!noticeChannel || !(noticeChannel.type === ChannelType.GuildText || noticeChannel.type === ChannelType.GuildAnnouncement)) {
                this.debugConfig.log(`Configured notice channel not found or is not a text/announcement channel.`, 'scheduler', { channelId: TARGET_NOTICE_CHANNEL_ID }, null, 'error');
                return;
            }
        } catch (error) {
            this.debugConfig.log(`Error fetching notice channel ${TARGET_NOTICE_CHANNEL_ID}:`, 'scheduler', null, error, 'error');
            return;
        }

        let adminChannel;
        if (NOTICE_ADMIN_CHANNEL_ID && NOTICE_ADMIN_CHANNEL_ID !== 'YOUR_NOTICE_ADMIN_CHANNEL_ID_HERE') {
            try {
                adminChannel = await this.client.channels.fetch(NOTICE_ADMIN_CHANNEL_ID);
            } catch (error) {
                this.debugConfig.log(`Could not fetch admin channel ${NOTICE_ADMIN_CHANNEL_ID}.`, 'scheduler', null, error, 'warn');
                adminChannel = null;
            }
        }

        try {
            this.debugConfig.log('Calling scrapeLatestNotice()...', 'scheduler', null, null, 'info');
            let scrapedNotices = await scrapeLatestNotice();
            this.debugConfig.log(`scrapeLatestNotice() returned: ${JSON.stringify(scrapedNotices)}`, 'scheduler', null, null, 'verbose');

            if (!scrapedNotices || scrapedNotices.length === 0) {
                this.debugConfig.log('No notices found or scraper returned empty.', 'scheduler', null, null, 'info');
                return;
            }

            const MAX_NOTICE_AGE_DAYS = parseInt(process.env.MAX_NOTICE_AGE_DAYS || '30', 10);
            const now = new Date();

            const noticesToAnnounce = scrapedNotices.filter(notice => {
                const noticeDate = new Date(notice.date);
                if (isNaN(noticeDate.getTime())) {
                    this.debugConfig.log(`Invalid date format for notice: ${notice.title} - ${notice.date}`, 'scheduler', { notice }, null, 'warn');
                    return false;
                }

                const ageInDays = (now - noticeDate) / (1000 * 60 * 60 * 24);
                return ageInDays <= MAX_NOTICE_AGE_DAYS;
            });

            if (noticesToAnnounce.length === 0) {
                this.debugConfig.log(`No notices found in the last ${MAX_NOTICE_AGE_DAYS} days.`, 'scheduler', null, null, 'info');
                return;
            }
            this.debugConfig.log(`Found ${noticesToAnnounce.length} notices to announce from the past ${MAX_NOTICE_AGE_DAYS} days.`, 'scheduler', null, null, 'info');

            for (const notice of noticesToAnnounce) {
                let tempFilesOnDisk = [];
                try {
                    if (!notice || !notice.title || !notice.link) {
                        this.debugConfig.log('Scraper returned an invalid notice object:', 'scheduler', { notice }, null, 'warn');
                        continue;
                    }
                    const row = await new Promise((resolve, reject) => {
                        this.client.db.get(`SELECT COUNT(*) AS count FROM notices WHERE link = ?`, [notice.link], (err, result) => {
                            if (err) reject(err);
                            else resolve(result);
                        });
                    });

                    if (row.count === 0) {
                        this.debugConfig.log(`New notice found from ${notice.source}: ${notice.title}`, 'scheduler', null, null, 'info');
                        const noticeEmbed = new EmbedBuilder()
                            .setColor('#1E90FF')
                            .setTitle(`Notice ${notice.id ? notice.id + ': ' : ''}${notice.title}`)
                            .setURL(notice.link)
                            .setFooter({ text: `Source: ${notice.source}` })
                            .setTimestamp(new Date(notice.date));

                        let allFilesForNotice = [];
                        let description = `A new notice has been published.`;
                        if (notice.attachments && notice.attachments.length > 0) {
                            this.debugConfig.log(`Processing attachments for notice: ${notice.title}`, 'scheduler', { attachments: notice.attachments.length }, null, 'info');
                            for (const attachmentUrl of notice.attachments) {
                                try {
                                    const fileName = path.basename(new URL(attachmentUrl).pathname);
                                    const tempFilePath = path.join(TEMP_ATTACHMENT_DIR, fileName);
                                    tempFilesOnDisk.push(tempFilePath);
                                    this.debugConfig.log(`Attempting to download ${attachmentUrl} to ${tempFilePath}`, 'scheduler', null, null, 'verbose');
                                    const response = await axios({
                                        method: 'GET',
                                        url: attachmentUrl,
                                        responseType: 'stream'
                                    });
                                    const writer = createWriteStream(tempFilePath);
                                    response.data.pipe(writer);
                                    await new Promise((resolve, reject) => {
                                        writer.on('finish', resolve);
                                        writer.on('error', reject);
                                    });
                                    const MAX_PDF_PAGES_TO_CONVERT = 10;
                                    if (fileName.toLowerCase().endsWith('.pdf')) {
                                        try {
                                            let totalPdfPages = 0;
                                            try {
                                                const pdfBuffer = await fsPromises.readFile(tempFilePath);
                                                const uint8Array = new Uint8Array(pdfBuffer);

                                                const loadingTask = getDocument({ data: uint8Array });
                                                const pdfDocument = await loadingTask.promise;
                                                totalPdfPages = pdfDocument.numPages;
                                                this.debugConfig.log(`PDF ${fileName} has ${totalPdfPages} pages using pdfjs-dist.`, 'scheduler', { fileName, pages: totalPdfPages }, null, 'verbose');
                                            } catch (pdfjsError) {
                                                this.debugConfig.log(`Could not get page count for PDF ${fileName} using pdfjs-dist:`, 'scheduler', null, pdfjsError, 'warn');
                                                totalPdfPages = MAX_PDF_PAGES_TO_CONVERT; 
                                            }

                                            const pdfConvertOptions = {
                                                density: 150,
                                                quality: 90,
                                                height: 1754,
                                                width: 1240,
                                                format: "png",
                                                saveFilename: path.parse(fileName).name,
                                                savePath: TEMP_ATTACHMENT_DIR
                                            };

                                            const convert = fromPath(tempFilePath, pdfConvertOptions);
                                            let pageConvertedCount = 0;

                                            const pagesToConvert = Math.min(totalPdfPages, MAX_PDF_PAGES_TO_CONVERT);

                                            for (let pageNum = 1; pageNum <= pagesToConvert; pageNum++) {
                                                try {
                                                    const convertResponse = await convert(pageNum);

                                                    if (convertResponse && convertResponse.path) {
                                                        const pngFilePath = convertResponse.path;
                                                        const pngFileName = path.basename(pngFilePath);
                                                        tempFilesOnDisk.push(pngFilePath);
                                                        allFilesForNotice.push(new AttachmentBuilder(pngFilePath, { name: pngFileName }));
                                                        this.debugConfig.log(`Converted PDF ${fileName} page ${pageNum} to PNG and prepared for sending.`, 'scheduler', { page: pageNum, fileName: pngFileName }, null, 'verbose');
                                                        pageConvertedCount++;
                                                    } else {
                                                        this.debugConfig.log(`No valid response for PDF ${fileName} at page ${pageNum}. Stopping conversion for this PDF.`, 'scheduler', { fileName, page: pageNum }, null, 'warn');
                                                        break;
                                                    }
                                                } catch (pageConvertError) {
                                                    this.debugConfig.log(`Could not convert PDF ${fileName} page ${pageNum}:`, 'scheduler', null, pageConvertError, 'warn');
                                                    if (pageConvertError.message.includes('does not exist') || pageConvertError.message.includes('invalid page number')) {
                                                        break;
                                                    }
                                                }
                                            }

                                            if (pageConvertedCount === 0) {
                                                this.debugConfig.log(`No pages converted for PDF ${fileName}. Sending original PDF.`, 'scheduler', { fileName }, null, 'warn');
                                                allFilesForNotice.push(new AttachmentBuilder(tempFilePath, { name: fileName }));
                                            } else if (pageConvertedCount < totalPdfPages) {
                                                this.debugConfig.log(`(Sent ${pageConvertedCount} of ${totalPdfPages} pages from ${fileName} as images.)`, 'scheduler', { converted: pageConvertedCount, total: totalPdfPages }, null, 'info');
                                            } else {
                                                this.debugConfig.log(`(Sent all ${totalPdfPages} pages from ${fileName} as images.)`, 'scheduler', { total: totalPdfPages }, null, 'info');
                                            }

                                        } catch (pdfProcessError) {
                                            this.debugConfig.log(`Error processing PDF ${fileName}:`, 'scheduler', null, pdfProcessError, 'error');
                                            description += `\n\n⚠️ Could not process PDF attachment: ${fileName}`;
                                            allFilesForNotice.push(new AttachmentBuilder(tempFilePath, { name: fileName }));
                                        }
                                    } else {
                                        allFilesForNotice.push(new AttachmentBuilder(tempFilePath, { name: fileName }));
                                        this.debugConfig.log(`Prepared attachment: ${fileName}`, 'scheduler', { fileName }, null, 'verbose');
                                    }
                                } catch (downloadError) {
                                    this.debugConfig.log(`Error downloading attachment ${attachmentUrl}:`, 'scheduler', null, downloadError, 'error');
                                    description += `\n\n⚠️ Could not download an attachment: ${attachmentUrl}`;
                                }
                            }
                        }
                        noticeEmbed.setDescription(description);

                        const ATTACHMENT_LIMIT = 10;
                        if (allFilesForNotice.length > 0) {
                            let sentFirstMessage = false;
                            for (let i = 0; i < allFilesForNotice.length; i += ATTACHMENT_LIMIT) {
                                const chunk = allFilesForNotice.slice(i, i + ATTACHMENT_LIMIT);
                                try {
                                    if (!sentFirstMessage) {
                                        await noticeChannel.send({ embeds: [noticeEmbed], files: chunk });
                                        sentFirstMessage = true;
                                    } else {
                                        await noticeChannel.send({ content: `(Continued attachments for "${notice.title}")`, files: chunk });
                                    }
                                    this.debugConfig.log(`Sent chunk of ${chunk.length} attachments for "${notice.title}" to Discord.`, 'scheduler', { chunkLength: chunk.length, noticeTitle: notice.title }, null, 'info');
                                } catch (discordSendError) {
                                    this.debugConfig.log(`Error sending notice or files to channel ${TARGET_NOTICE_CHANNEL_ID} (chunk ${i / ATTACHMENT_LIMIT + 1}):`, 'scheduler', null, discordSendError, 'error');
                                    if (adminChannel) await adminChannel.send(`❌ Error sending notice/files for "${notice.title}" (chunk ${i / ATTACHMENT_LIMIT + 1}): ${discordSendError.message}`).catch(e => console.error("Error sending admin error:", e));
                                }
                            }
                        } else {
                            try {
                                await noticeChannel.send({ embeds: [noticeEmbed] });
                                this.debugConfig.log(`Sent notice for "${notice.title}" to Discord (no attachments).`, 'scheduler', { noticeTitle: notice.title }, null, 'info');
                            } catch (discordSendError) {
                                this.debugConfig.log(`Error sending notice to channel ${TARGET_NOTICE_CHANNEL_ID}:`, 'scheduler', null, discordSendError, 'error');
                                if (adminChannel) await adminChannel.send(`❌ Error sending notice for "${notice.title}": ${discordSendError.message}`).catch(e => console.error("Error sending admin error:", e));
                            }
                        }

                        await new Promise((resolve, reject) => {
                            this.client.db.run(`INSERT INTO notices (title, link, date, announced_at) VALUES (?, ?, ?, ?)`,
                                [notice.title, notice.link, notice.date, Date.now()],
                                (insertErr) => {
                                    if (insertErr) {
                                        reject(insertErr);
                                    } else {
                                        this.debugConfig.log(`Announced and saved new notice: ${notice.title}`, 'scheduler', { noticeTitle: notice.title }, null, 'success');
                                        resolve();
                                    }
                                }
                            );
                        }).catch(insertErr => {
                            this.debugConfig.log('Error saving new notice to DB:', 'scheduler', null, insertErr, 'error');
                            if (adminChannel) adminChannel.send(`❌ Error saving new notice to DB: ${insertErr.message}`).catch(e => console.error("Error sending admin error:", e));
                        });

                    } else {
                        this.debugConfig.log(`Notice from ${notice.source} ("${notice.title}") already announced. Skipping.`, 'scheduler', { noticeTitle: notice.title }, null, 'info');
                    }
                } catch (noticeProcessError) {
                    this.debugConfig.log(`Error processing notice "${notice.title}":`, 'scheduler', null, noticeProcessError, 'error');
                    if (adminChannel) {
                        await adminChannel.send(`❌ Error processing notice "${notice.title}": ${noticeProcessError.message}`).catch(e => console.error("Error sending admin error:", e));
                    }
                } finally {
                    for (const filePath of tempFilesOnDisk) {
                        try {
                            await fsPromises.unlink(filePath);
                            this.debugConfig.log(`Cleaned up temporary file: ${filePath}`, 'scheduler', { filePath }, null, 'verbose');
                        } catch (unlinkError) {
                            this.debugConfig.log(`Error cleaning up temporary file ${filePath}:`, 'scheduler', null, unlinkError, 'warn');
                        }
                    }
                }
            }
        } catch (error) {
            this.debugConfig.log('Error during notice scraping or announcement:', 'scheduler', null, error, 'error');
            if (adminChannel) {
                await adminChannel.send(`❌ Notice scraping failed: ${error.message}`).catch(e => console.error("Error sending admin error:", e));
            }
        } finally {
            await fsPromises.rm(TEMP_ATTACHMENT_DIR, { recursive: true, force: true }).catch(e => this.debugConfig.log('Error deleting temp directory after all notices processed:', 'scheduler', null, e, 'error'));
        }
    }

    /**
     * Announces birthdays for users in guilds.
     * @private
     */
    async _announceBirthdays() {
        this.debugConfig.log('Checking for birthdays...', 'scheduler', null, null, 'info');
        const BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID = process.env.BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID;
        if (!BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID || BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID === 'YOUR_BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID_HERE') {
            this.debugConfig.log('BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID is not set or invalid. Birthday announcements disabled.', 'scheduler', null, null, 'warn');
            return;
        }
        let announcementChannel;
        try {
            announcementChannel = await this.client.channels.fetch(BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID);
            if (!announcementChannel || !(announcementChannel.type === ChannelType.GuildText || announcementChannel.type === ChannelType.GuildAnnouncement)) {
                this.debugConfig.log(`Configured birthday channel not found or is not a text/announcement channel.`, 'scheduler', { channelId: BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID }, null, 'error');
                return;
            }
        } catch (error) {
            this.debugConfig.log(`Error fetching birthday announcement channel:`, 'scheduler', null, error, 'error');
            return;
        }
        const today = new Date();
        const currentMonth = today.getMonth() + 1;
        const currentDay = today.getDate();
        const guilds = this.client.guilds.cache;
        for (const [guildId, guild] of guilds) {
            try {
                const rows = await new Promise((resolve, reject) => {
                    this.client.db.all(`SELECT user_id, year FROM birthdays WHERE guild_id = ? AND month = ? AND day = ?`,
                        [guild.id, currentMonth, currentDay],
                        (err, resultRows) => {
                            if (err) {
                                this.debugConfig.log(`Error fetching birthdays for guild ${guild.name} (${guild.id}):`, 'scheduler', null, err, 'error');
                                return reject(err);
                            }
                            resolve(resultRows);
                        }
                    );
                });
                if (rows.length > 0) {
                    const birthdayUsers = [];
                    let firstBirthdayUserAvatarUrl = null;
                    for (const row of rows) {
                        try {
                            const member = await guild.members.fetch(row.user_id); 
                            let ageString = '';
                            if (row.year) {
                                const age = today.getFullYear() - row.year;
                                if (age >= 0) ageString = ` (turning ${age})`;
                            }
                            birthdayUsers.push(`• <@${member.user.id}>${ageString}`);
                            if (!firstBirthdayUserAvatarUrl) {
                                firstBirthdayUserAvatarUrl = member.user.displayAvatarURL({ dynamic: true, size: 128 });
                            }
                        } catch (fetchErr) {
                            this.debugConfig.log(`Could not fetch birthday user ${row.user_id}):`, 'scheduler', null, fetchErr, 'warn');
                            birthdayUsers.push(`• Unknown User (ID: ${row.user_id})`); 
                        }
                    }
                    if (birthdayUsers.length > 0) {
                        const authorName = `Free Students' Union, Pulchowk Campus - 2081`;
                        const authorIconUrl = "https://cdn.discordapp.com/attachments/712392381827121174/1396481277284323462/fsulogo.png?ex=687e3e09&is=687cec89&hm=6ce3866b2a68ba39b762c6dd3df8c57c64eecf980e09058768de325bf43246c2&";
                        const authorWebsiteUrl = "https://www.facebook.com/fsupulchowk";

                        const birthdayEmbed = new EmbedBuilder()
                            .setColor('#FFD700') 
                            .setAuthor({
                                name: authorName,
                                iconURL: authorIconUrl,
                                url: authorWebsiteUrl
                            })
                            .setTitle('🎂 Happy Birthday!')
                            .setDescription(`🎉 Wishing a very happy birthday to our amazing community members:\n\n${birthdayUsers.join('\n')}\n\nMay you have a fantastic day filled with joy and celebration!`)
                            .setImage('https://codaio.imgix.net/docs/Y_HFctSU9K/blobs/bl-4kLxBlt-8t/66dbaff27d8df6da40fc20009f59a885dca2e859e880d992e28c3096d08bd205041c9ea43d0ca891055d56e79864748a9564d1be896d57cc93bf6c57e6b25e879d80a6d5058a91ef3572aff7c0a3b9efb24f7f0d1daa0d170368b9686d674c81650fa247?auto=format%2Ccompress&fit=crop&w=1920&ar=4%3A1&crop=focalpoint&fp-x=0.5&fp-y=0.5&fp-z=1') // Festive image
                            .setTimestamp();

                        if (firstBirthdayUserAvatarUrl) {
                            birthdayEmbed.setThumbnail(firstBirthdayUserAvatarUrl);
                        } else {
                            birthdayEmbed.setThumbnail('https://cdn.discordapp.com/attachments/712392381827121174/1396481277284323462/fsulogo.png?ex=687e3e09&is=687cec89&hm=6ce3866b2a68ba39b762c6dd3df8c57c64eecf980e09058768de325bf43246c2&');
                        }
                        await announcementChannel.send({ embeds: [birthdayEmbed] }).catch(e => this.debugConfig.log(`Error sending birthday announcement in guild ${guild.name} (${guild.id}):`, 'scheduler', null, e, 'error'));
                        this.debugConfig.log(`Sent birthday announcement for guild ${guild.id}.`, 'scheduler', { guildId: guild.id }, null, 'info');
                    } else {
                        this.debugConfig.log(`No birthdays found for today in guild ${guild.name} (${guild.id}).`, 'scheduler', { guildId: guild.id }, null, 'info');
                    }
                }
            } catch (guildError) {
                this.debugConfig.log(`Error processing guild ${guild.name} (${guild.id}) for birthdays:`, 'scheduler', null, guildError, 'error');
            }
        }
    }

    /**
     * Placeholder method for handling suggestion votes.
     * You will need to implement the actual logic for updating votes in your database
     * and refreshing the suggestion message. This method now primarily logs and
     * ensures the interaction is handled.
     * @param {import('discord.js').ButtonInteraction} interaction The button interaction.
     * @private
     */
    async _handleSuggestionVote(interaction) {
        this.debugConfig.log(`Handling suggestion vote for interaction ${interaction.customId}`, 'interaction', { interactionId: interaction.customId, user: interaction.user.tag }, null, 'info');
        // The actual vote logic for updating DB/embeds is handled in _onMessageReactionAdd/Remove.
        // This button handler is for a direct button vote, if implemented differently.
        // For now, if a user clicks a button, we acknowledge it.
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Your vote has been registered!', flags: [MessageFlags.Ephemeral] }).catch(e => this.debugConfig.log("Error replying to suggestion vote:", 'interaction', null, e, 'error'));
        } else {
            await interaction.editReply({ content: 'Your vote has been registered!' }).catch(e => this.debugConfig.log("Error editing reply for suggestion vote:", 'interaction', null, e, 'error'));
        }
    }

    /**
     * Handles suggestion deletion initiated via a button by prompting for a reason.
     * @param {import('discord.js').ButtonInteraction} interaction The button interaction.
     * @private
     */
    async _handleSuggestionDelete(interaction) {
        this.debugConfig.log(`Handling suggestion delete for interaction ${interaction.customId}`, 'interaction', { interactionId: interaction.customId, user: interaction.user.tag }, null, 'info');

        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
            return interaction.reply({ content: '❌ You do not have permission to delete suggestions.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error replying to delete permission error:", e));
        }

        const suggestionId = interaction.customId.split('_')[2];

        const modal = new ModalBuilder()
            .setCustomId(`delete_reason_modal_${suggestionId}`)
            .setTitle('Delete Suggestion');

        const reasonInput = new TextInputBuilder()
            .setCustomId('deleteReasonInput')
            .setLabel('Reason for deleting this suggestion:')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setPlaceholder('e.g., Duplicate, irrelevant, rule-breaking');

        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

        await interaction.showModal(modal).catch(e => this.debugConfig.log("Error showing delete reason modal:", 'interaction', null, e, 'error'));
    }


    /**
     * Processes suggestion denial from a modal.
     * This will mark a suggestion as denied, potentially notify the suggester, and update the message.
     * @param {import('discord.js').ModalSubmitInteraction} interaction The modal submission interaction.
     * @param {string} suggestionId The ID of the suggestion to deny.
     * @param {string} reason The reason for denying the suggestion.
     * @private
     */
    async _processSuggestionDenial(interaction, suggestionId, reason) {
        this.debugConfig.log(`Processing denial for suggestion ${suggestionId} with reason: "${reason}"`, 'interaction', { suggestionId, reason, user: interaction.user.tag }, null, 'info');

        try {
            const suggestionRow = await new Promise((resolve, reject) => {
                this.client.db.get(`SELECT message_id, user_id FROM suggestions WHERE id = ?`, [suggestionId], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });

            if (!suggestionRow) {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: `❌ Suggestion with ID \`${suggestionId}\` not found.`, flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error replying to not found suggestion:", e));
                } else {
                    await interaction.editReply({ content: `❌ Suggestion with ID \`${suggestionId}\` not found.` }).catch(e => console.error("Error editing reply for not found suggestion:", e));
                }
                return;
            }
            await new Promise((resolve, reject) => {
                this.client.db.run(`UPDATE suggestions SET status = 'denied', reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`,
                    [reason, interaction.user.id, Date.now(), suggestionId],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
            this.debugConfig.log(`Suggestion ${suggestionId} status updated to 'denied' in DB.`, 'interaction', { suggestionId }, null, 'info');
            const suggestionsChannel = this.client.channels.cache.get(process.env.SUGGESTIONS_CHANNEL_ID);
            if (suggestionsChannel) {
                const message = await suggestionsChannel.messages.fetch(suggestionRow.message_id).catch(e => this.debugConfig.log(`Could not fetch suggestion message ${suggestionRow.message_id}:`, 'interaction', null, e, 'warn'));
                if (message && message.embeds[0]) {
                    const originalEmbed = EmbedBuilder.from(message.embeds[0]);
                    const updatedEmbed = originalEmbed
                        .setColor('#FF0000') 
                        .spliceFields(originalEmbed.fields.length - 1, 1, { name: 'Status', value: `Denied by ${interaction.user.tag}\nReason: ${reason}` }); // Update last field or add new
                    await message.edit({ embeds: [updatedEmbed], components: [] }).catch(e => this.debugConfig.log("Error editing suggestion message after denial:", 'interaction', null, e, 'error'));
                    this.debugConfig.log(`Suggestion message ${suggestionRow.message_id} updated with 'denied' status.`, 'interaction', { messageId: suggestionRow.message_id }, null, 'info');
                }
            }
            try {
                const suggester = await this.client.users.fetch(suggestionRow.user_id);
                if (suggester) {
                    const dmEmbed = new EmbedBuilder()
                        .setColor('#FF0000')
                        .setTitle(`Your Suggestion Was Denied ❌`)
                        .setDescription(`Your suggestion (ID: ${suggestionId}) in ${interaction.guild.name} has been denied.`)
                        .addFields(
                            { name: 'Reason', value: reason },
                            { name: 'Original Suggestion', value: `[Click here to view](${suggestionRow.message_id ? `https://discord.com/channels/${interaction.guild.id}/${process.env.SUGGESTIONS_CHANNEL_ID}/${suggestionRow.message_id}` : 'Not available'})` }
                        )
                        .setTimestamp();
                    await suggester.send({ embeds: [dmEmbed] }).catch(e => this.debugConfig.log(`Could not DM suggester ${suggester.tag} about denial:`, 'interaction', null, e, 'warn'));
                    this.debugConfig.log(`DM sent to suggester ${suggester.tag} about denial.`, 'interaction', { suggesterId: suggester.id }, null, 'info');
                }
            } catch (dmError) {
                this.debugConfig.log(`Error fetching suggester or sending denial DM:`, 'interaction', null, dmError, 'warn');
            }

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: `✅ Suggestion \`${suggestionId}\` has been denied.`, flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error replying to denial success:", e));
            } else {
                await interaction.editReply({ content: `✅ Suggestion \`${suggestionId}\` has been denied.` }).catch(e => console.error("Error editing reply for denial success:", e));
            }

        } catch (error) {
            this.debugConfig.log(`An error occurred while processing suggestion denial for ${suggestionId}:`, 'interaction', null, error, 'error');
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: `❌ An error occurred while denying suggestion \`${suggestionId}\`.`, flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error replying to denial error:", e));
            } else {
                await interaction.editReply({ content: `❌ An error occurred while denying suggestion \`${suggestionId}\`.` }).catch(e => console.error("Error editing reply for denial error:", e));
            }
        }
    }


    /**
     * Processes suggestion deletion from a modal.
     * This will delete the suggestion from the database and Discord message.
     * @param {import('discord.js').ModalSubmitInteraction} interaction The modal submission interaction.
     * @param {string} suggestionId The ID of the suggestion to delete.
     * @param {string} reason The reason for deleting the suggestion.
     * @private
     */
    async _processSuggestionDelete(interaction, suggestionId, reason) {
        this.debugConfig.log(`Processing deletion from modal for suggestion ${suggestionId} with reason: "${reason}"`, 'interaction', { suggestionId, reason, user: interaction.user.tag }, null, 'info');

        try {
            const suggestionRow = await new Promise((resolve, reject) => {
                this.client.db.get(`SELECT message_id, user_id FROM suggestions WHERE id = ?`, [suggestionId], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });

            if (!suggestionRow) {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: `❌ Suggestion with ID \`${suggestionId}\` not found.`, flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error replying to delete not found:", e));
                } else {
                    await interaction.editReply({ content: `❌ Suggestion with ID \`${suggestionId}\` not found.` }).catch(e => console.error("Error editing reply for delete not found:", e));
                }
                return;
            }
            await new Promise((resolve, reject) => {
                this.client.db.run(`DELETE FROM suggestions WHERE id = ?`, [suggestionId], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            this.debugConfig.log(`Suggestion ${suggestionId} deleted from DB.`, 'interaction', { suggestionId }, null, 'info');
            const suggestionsChannel = this.client.channels.cache.get(process.env.SUGGESTIONS_CHANNEL_ID);
            if (suggestionsChannel && suggestionRow.message_id) {
                const message = await suggestionsChannel.messages.fetch(suggestionRow.message_id).catch(e => this.debugConfig.log(`Could not fetch suggestion message ${suggestionRow.message_id} for deletion:`, 'interaction', null, e, 'warn'));
                if (message) {
                    await message.delete(`Suggestion deleted by ${interaction.user.tag}. Reason: ${reason}`).catch(e => this.debugConfig.log("Error deleting suggestion message:", 'interaction', null, e, 'error'));
                    this.debugConfig.log(`Suggestion message ${suggestionRow.message_id} deleted from Discord.`, 'interaction', { messageId: suggestionRow.message_id }, null, 'info');
                }
            }
            try {
                const suggester = await this.client.users.fetch(suggestionRow.user_id);
                if (suggester) {
                    const dmEmbed = new EmbedBuilder()
                        .setColor('#FF0000')
                        .setTitle(`Your Suggestion Was Deleted 🗑️`)
                        .setDescription(`Your suggestion (ID: ${suggestionId}) in ${interaction.guild.name} has been deleted by a moderator.`)
                        .addFields(
                            { name: 'Reason', value: reason }
                        )
                        .setTimestamp();
                    await suggester.send({ embeds: [dmEmbed] }).catch(e => this.debugConfig.log(`Could not DM suggester ${suggester.tag} about deletion:`, 'interaction', null, e, 'warn'));
                    this.debugConfig.log(`DM sent to suggester ${suggester.tag} about deletion.`, 'interaction', { suggesterId: suggester.id }, null, 'info');
                }
            } catch (dmError) {
                this.debugConfig.log(`Error fetching suggester or sending deletion DM:`, 'interaction', null, dmError, 'warn');
            }

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: `✅ Suggestion \`${suggestionId}\` has been deleted.`, flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error replying to delete success:", e));
            } else {
                await interaction.editReply({ content: `✅ Suggestion \`${suggestionId}\` has been deleted.` }).catch(e => console.error("Error editing reply for delete success:", e));
            }

        } catch (error) {
            this.debugConfig.log(`An error occurred while processing suggestion deletion for ${suggestionId}:`, 'interaction', null, error, 'error');
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: `❌ An error occurred while deleting suggestion \`${suggestionId}\`.`, flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error replying to delete error:", e));
            } else {
                await interaction.editReply({ content: `❌ An error occurred while deleting suggestion \`${suggestionId}\`.` }).catch(e => console.error("Error editing reply for delete error:", e));
            }
        }
    }


    /**
     * Starts the bot by logging into Discord.
     */
    async start() {
        this.debugConfig.log('Starting bot...', 'init', null, null, 'info');
        await writeServiceAccountKey();
        try {
            await this.client.login(this.token);
            this.debugConfig.log('Client login successful.', 'init', null, null, 'success');
        } catch (error) {
            this.debugConfig.log('Client login failed.', 'init', null, error, 'error');
            exit(1);
        }
    }
}

async function main() {
    try {
        const database = await initializeDatabase();
        const bot = new PulchowkBot(process.env.BOT_TOKEN, database);
        await bot.start();
    } catch (error) {
        debugConfig.log('Failed to start bot:', 'init', null, error, 'error');
        console.error(error);
        exit(1);
    }
}

main();

export default PulchowkBot;