import { Client, Collection, IntentsBitField, EmbedBuilder, PermissionsBitField, ChannelType, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, Events, MessageFlags, Widget } from 'discord.js';
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

dotenv.config();

// Global unhandled promise rejection handler to prevent bot crashes
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection (this caused the bot to crash):', error);
});

/**
 * Writes the Google Service Account Key from an environment variable to a file.
 * This is necessary for Google Calendar API access.
 */
async function writeServiceAccountKey() {
    const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64;
    if (!b64) {
        console.warn('No GOOGLE_SERVICE_ACCOUNT_KEY_B64 env var found. Google Calendar features might be limited.');
        return;
    }
    const keyPath = path.resolve(process.cwd(), 'src', 'service_account_key.json'); // Save in src directory
    try {
        const decoded = Buffer.from(b64, 'base64').toString('utf-8');
        await fsPromises.writeFile(keyPath, decoded);
        console.log('Service account key saved.');
    } catch (error) {
        console.error('Error writing service account key:', error);
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
        this.client = new Client({
            intents: [
                IntentsBitField.Flags.Guilds,             // Required for guild-related events (members, channels, roles)
                IntentsBitField.Flags.GuildMembers,       // Required for guild member add/remove, member updates
                IntentsBitField.Flags.GuildMessages,      // Required for message creation, updates, deletions
                IntentsBitField.Flags.MessageContent,     // Required to read message content (for commands, anti-spam)
                IntentsBitField.Flags.GuildVoiceStates,   // Required for voice channel activity tracking
                IntentsBitField.Flags.DirectMessages,     // Required for direct messages to the bot
                IntentsBitField.Flags.GuildMessageReactions // Required for reaction roles, suggestion voting
            ],
            partials: [
                Partials.Channel,    // Required for DM channels and uncached channels
                Partials.Message,    // Required for uncached messages (e.g., old messages for reactions)
                Partials.Reaction,   // Required for uncached reactions
                Partials.User,       // Required for uncached users
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
     * @private
     */
    _initializeCommands() {
        const commandsPath = path.join(process.cwd(), 'src', 'commands', 'slash');
        try {
            const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
            for (const file of commandFiles) {
                const filePath = path.join(commandsPath, file);
                import(filePath).then(command => {
                    if (command.data && command.execute) {
                        this.client.commands.set(command.data.name, command);
                        this.commandFiles.push(command.data.toJSON());
                        console.log(`Loaded command: ${command.data.name}`);
                    } else {
                        console.warn(`The command at ${filePath} is missing a required "data" or "execute" property.`);
                    }
                }).catch(error => {
                    console.error(`Error loading command from ${filePath}:`, error);
                });
            }
        } catch (error) {
            console.error('Error reading commands directory:', error);
        }
    }

    /**
     * Registers all Discord.js event listeners.
     * @private
     */
    _registerEventListeners() {
        // Client ready event: fires once when the bot successfully logs in
        this.client.once(Events.ClientReady, c => {
            console.log(`Ready! Logged in as ${c.user.tag}`);
            c.user.setActivity('for new RSS feeds', { type: 'WATCHING' }); // Set bot's activity
            this._scheduleJobs(); // Start all recurring jobs
            this._registerSlashCommands(); // Register slash commands with Discord API
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
            console.error('Discord.js Client Error:', error);
        });
        // Shard Disconnect event: for when a shard disconnects
        this.client.on(Events.ShardDisconnect, (event, id) => {
            console.warn(`Discord.js Shard ${id} Disconnected:`, event);
        });
        // Shard Reconnecting event: for when a shard attempts to reconnect
        this.client.on(Events.ShardReconnecting, (id) => {
            console.log(`Discord.js Shard ${id} Reconnecting...`);
        });
        // Discord.js Client Warning event: for non-critical warnings
        this.client.on(Events.Warn, info => {
            console.warn('Discord.js Client Warning:', info);
        });
    }

    /**
     * Registers slash commands with the Discord API.
     * @private
     */
    async _registerSlashCommands() {
        const rest = new REST({ version: '10' }).setToken(this.token);
        try {
            console.log(`Started refreshing ${this.commandFiles.length} application (/) commands.`);
            // Register commands globally (for all guilds the bot is in)
            const data = await rest.put(
                Routes.applicationCommands(this.client.user.id),
                { body: this.commandFiles },
            );
            console.log(`Successfully reloaded ${data.length} application (/) commands.`);
        } catch (error) {
            console.error('Failed to register slash commands:', error);
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
                    console.error('Error loading active voice sessions from DB:', err.message);
                    return reject(err);
                }
                rows.forEach(row => {
                    this.voiceStates.set(row.user_id, {
                        guildId: row.guild_id,
                        channelId: row.channel_id,
                        joinTime: row.join_time
                    });
                });
                console.log(`Loaded ${rows.length} active voice sessions from database.`);
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
            console.log('[Scheduler] Running daily birthday announcement...');
            await this._announceBirthdays(); // This method handles its own channel ID validation
        });
        console.log('Scheduled daily birthday announcements for 12 AM.');

        // RSS Feed Polling Schedule
        const RSS_POLL_INTERVAL_MINUTES = parseInt(process.env.RSS_POLL_INTERVAL_MINUTES || '5'); // Default to 5 minutes
        if (RSS_POLL_INTERVAL_MINUTES > 0) {
            console.log(`[Scheduler] Initializing RSS feed polling. Interval: ${RSS_POLL_INTERVAL_MINUTES} minutes.`);
            schedule.scheduleJob(`*/${RSS_POLL_INTERVAL_MINUTES} * * * *`, async () => {
                console.log('[Scheduler] Running RSS feed poll...');
                await pollFeeds(this.client); // Pass the client instance to pollFeeds
            });
            console.log(`Scheduled RSS feed polling every ${RSS_POLL_INTERVAL_MINUTES} minutes.`);
        } else {
            console.warn('RSS_POLL_INTERVAL_MINUTES is not set or invalid. RSS polling disabled.');
        }

        // Notice Scraping and Announcement Schedule
        const NOTICE_CHECK_INTERVAL_MS = parseInt(process.env.NOTICE_CHECK_INTERVAL_MS || '1800000'); // Default to 30 minutes (1800000 ms)
        if (NOTICE_CHECK_INTERVAL_MS > 0) {
            console.log(`[Scheduler] Initializing notice checking. Interval: ${NOTICE_CHECK_INTERVAL_MS / 1000} seconds.`);
            this._checkAndAnnounceNotices(); // Initial call on startup
            setInterval(() => this._checkAndAnnounceNotices(), NOTICE_CHECK_INTERVAL_MS); // Recurring interval
            console.log(`Scheduled notice checking every ${NOTICE_CHECK_INTERVAL_MS / 60000} minutes.`);
        } else {
            console.warn('NOTICE_CHECK_INTERVAL_MS is not set or invalid. Notice scraping disabled.');
        }

        // Removed the commented-out email reminder schedule as per your confirmation.
        // If you decide to add email reminders in the future, you'll need to implement
        // emailService.sendDueReminders in your emailService.js file.

        // You can add other scheduled jobs here (e.g., voice activity updates)
        // schedule.scheduleJob('*/5 * * * *', async () => { // Every 5 minutes
        //     console.log('Running scheduled job: Update voice activity.');
        //     try {
        //         await this._updateVoiceActivity();
        //     } catch (error) {
        //         console.error('Error during scheduled voice activity update:', error);
        //     }
        // });

        console.log('All scheduled jobs set up.');
    }

    /**
     * Handles all incoming Discord interactions (slash commands, buttons, modals).
     * @param {import('discord.js').Interaction} interaction The interaction object.
     * @private
     */
    async _onInteractionCreate(interaction) {
        // --- Handle Chat Input Commands ---
        if (interaction.isChatInputCommand()) {
            const command = this.client.commands.get(interaction.commandName);

            if (!command) {
                console.warn(`Received interaction for unknown slash command: ${interaction.commandName}`);
                await interaction.reply({
                    content: '❌ Unknown command. It might have been removed or is not deployed correctly.',
                    flags: [MessageFlags.Ephemeral]
                }).catch(e => console.error("Error replying to unknown command:", e));
                return;
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(`Error executing slash command ${interaction.commandName}:`, error);
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({
                        content: '❌ There was an error while executing this command!',
                        flags: [MessageFlags.Ephemeral]
                    }).catch(e => console.error("Error sending error follow-up:", e));
                } else {
                    await interaction.reply({
                        content: '❌ There was an error while executing this command!',
                        flags: [MessageFlags.Ephemeral]
                    }).catch(e => console.error("Error sending error reply:", e));
                }
            }
        }
        // --- Handle Button Interactions ---
        else if (interaction.isButton()) {
            const customId = interaction.customId;

            // --- Specific Button Handlers (that might or might not defer/reply themselves) ---

            // Handle 'confirm_suggestion' or 'cancel_suggestion'
            // Assuming these are handled elsewhere (e.g., a collector or a specific command's method)
            if (customId === 'confirm_suggestion' || customId === 'cancel_suggestion') {
                return;
            }

            // Handle 'gotverified_' button. The associated command should ideally handle its own response.
            if (customId.startsWith('gotverified_')) {
                const gotVerifiedCommand = this.client.commands.get('gotverified');
                if (gotVerifiedCommand && typeof gotVerifiedCommand.execute === 'function') {
                    try {
                        // Assuming 'gotverified' command's execute handles its own defer/reply/followUp
                        await gotVerifiedCommand.execute(interaction);
                    } catch (error) {
                        console.error(`Error handling 'gotverified' button interaction:`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '❌ An error occurred with the verification status button.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error replying to gotverified button error:", e));
                        } else {
                            await interaction.followUp({ content: '❌ An error occurred with the verification status button.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error following up to gotverified button error:", e));
                        }
                    }
                } else {
                    console.warn(`'gotverified' command not found or execute function missing for button interaction.`);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '❌ The "Got Verified" command is not configured correctly.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error replying to misconfigured gotverified command:", e));
                    } else {
                        await interaction.followUp({ content: '❌ The "Got Verified" command is not configured correctly.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error following up to misconfigured gotverified command:", e));
                    }
                }
                return; // Exit after handling this specific button
            }

            // --- General Deferral for other buttons if not already replied/deferred ---
            // This acts as a catch-all for buttons that might take longer to process,
            // ensuring the "Bot is thinking..." message appears.
            if (!interaction.replied && !interaction.deferred) {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }).catch(e => {
                    if (e.code === 10062) { // Discord API Error: Unknown Interaction
                        console.warn(`❗ [Bot] Interaction ${customId} expired before deferring.`); // Use customId here
                    } else {
                        console.error("Error deferring button interaction:", e);
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
                        console.error(`Error handling verify_start_button interaction:`, error);
                        // Use editReply because it should already be deferred by the general defer or this command's logic.
                        await interaction.editReply({ content: '❌ An error occurred with the verification button. Please try the `/verify` command directly.' }).catch(e => console.error("Error editing reply for verify button error:", e));
                    }
                } else {
                    console.warn(`verify command not found or handleButtonInteraction function missing for button interaction.`);
                    await interaction.editReply({ content: '❌ The verification command is misconfigured. Please contact an administrator.' }).catch(e => console.error("Error editing reply for misconfigured verify command:", e));
                }
                return;
            }
            else if (customId.startsWith('confirm_otp_button_')) {
                const confirmOtpCmd = this.client.commands.get('confirmotp');
                if (confirmOtpCmd && typeof confirmOtpCmd.handleButtonInteraction === 'function') {
                    try {
                        await confirmOtpCmd.handleButtonInteraction(interaction);
                    } catch (error) {
                        console.error(`Error handling confirm_otp_button interaction:`, error);
                        await interaction.editReply({ content: '❌ An error occurred with the OTP confirmation button. Please try the `/confirmotp` command directly.' }).catch(e => console.error("Error editing reply for confirmotp button error:", e));
                    }
                } else {
                    console.warn(`confirmotp command not found or handleButtonInteraction function missing for button interaction.`);
                    await interaction.editReply({ content: '❌ The OTP confirmation command is misconfigured. Please contact an administrator.' }).catch(e => console.error("Error editing reply for misconfigured confirmotp command:", e));
                }
                return;
            }
            else if (customId.startsWith('confirm_setup_fsu_') || customId.startsWith('cancel_setup_fsu_')) {
                const setupFSUCommand = this.client.commands.get('setupfsu');
                if (setupFSUCommand && typeof setupFSUCommand._performSetupLogic === 'function') {
                    if (customId.startsWith('confirm_setup_fsu_')) {
                        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                            return interaction.editReply({ content: 'You do not have permission to confirm this action.' });
                        }
                        await interaction.editReply({ content: '🔧 Beginning FSU server setup... This may take a moment.', components: [], embeds: [] });
                        await setupFSUCommand._performSetupLogic(interaction);
                    } else if (customId.startsWith('cancel_setup_fsu_')) {
                        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                            return interaction.editReply({ content: 'You do not have permission to cancel this action.' });
                        }
                        await interaction.editReply({ content: '❌ FSU server setup cancelled.', components: [], embeds: [] });
                    }
                } else {
                    await interaction.editReply({ content: '❌ Setup command not found or is misconfigured.' });
                }
                return;
            }
            else if (customId.startsWith('suggest_vote_')) {
                await this._handleSuggestionVote(interaction);
                return;
            }
            else if (customId.startsWith('delete_suggestion_')) {
                await this._handleSuggestionDelete(interaction);
                return;
            }

            // Fallback for unhandled button interactions that were deferred
            await interaction.editReply({ content: '❌ Unknown button interaction.' }).catch(e => console.error("Error editing reply for unknown button:", e));
        }
        // --- Handle Modal Submissions ---
        else if (interaction.isModalSubmit()) {
            if (interaction.customId === 'verifyModal') {
                const verifyCmd = this.client.commands.get('verify');
                if (verifyCmd && typeof verifyCmd.handleModalSubmit === 'function') {
                    try {
                        await verifyCmd.handleModalSubmit(interaction);
                    } catch (error) {
                        console.error(`Error handling verifyModal submission:`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '❌ An error occurred with the verification process.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error replying to modal error:", e));
                        } else {
                            await interaction.followUp({ content: '❌ An error occurred with the verification process.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error following up to modal error:", e));
                        }
                    }
                } else {
                    console.warn('Verify command not found or handleModalSubmit function missing for verifyModal.');
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
                        console.error(`Error handling confirmOtpModal submission:`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '❌ An error occurred with the OTP confirmation.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error replying to modal error:", e));
                        } else {
                            await interaction.followUp({ content: '❌ An error occurred with the OTP confirmation.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error following up to modal error:", e));
                        }
                    }
                } else {
                    console.warn('ConfirmOTP command not found or handleModalSubmit function missing for confirmOtpModal.');
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

            // Fallback for unhandled modal submissions
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ Unknown modal submission.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error replying to unknown modal:", e));
            } else {
                await interaction.followUp({ content: '❌ Unknown modal submission.', flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error following up to unknown modal:", e));
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

        // User joined a voice channel
        if (!oldState.channelId && newState.channelId) {
            this.client.db.run(`INSERT OR REPLACE INTO active_voice_sessions (user_id, guild_id, channel_id, join_time) VALUES (?, ?, ?, ?)`,
                [userId, guildId, newState.channelId, currentTime],
                (err) => {
                    if (err) console.error('Error inserting active voice session:', err.message);
                    else {
                        this.voiceStates.set(userId, { guildId, channelId: newState.channelId, joinTime: currentTime });
                        console.log(`[Voice] ${newState.member.user.tag} joined voice channel ${newState.channel.name}. Session started.`);
                    }
                }
            );
        }
        // User left a voice channel or moved channels
        else if (oldState.channelId && (!newState.channelId || oldState.channelId !== newState.channelId)) {
            this.client.db.get(`SELECT join_time FROM active_voice_sessions WHERE user_id = ? AND guild_id = ?`, [userId, guildId], async (err, row) => {
                if (err) {
                    console.error('Error fetching active voice session for update:', err.message);
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
                                if (updateErr) console.error('Error updating voice time in user_stats:', updateErr.message);
                                else console.log(`[Voice] Updated voice time for ${oldState.member.user.tag} by ${durationMinutes} minutes.`);
                            }
                        );
                    }
                    this.client.db.run(`DELETE FROM active_voice_sessions WHERE user_id = ? AND guild_id = ?`, [userId, guildId], (deleteErr) => {
                        if (deleteErr) console.error('Error deleting active voice session:', deleteErr.message);
                        else console.log(`[Voice] Session for ${oldState.member.user.tag} ended/moved.`);
                    });
                } else {
                    console.warn(`[Voice] No active session found in DB for ${oldState.member.user.tag} when leaving/moving channel.`);
                }
                this.voiceStates.delete(userId); // Remove from in-memory map
                // If user moved to a new channel, start a new session
                if (newState.channelId) {
                    this.client.db.run(`INSERT INTO active_voice_sessions (user_id, guild_id, channel_id, join_time) VALUES (?, ?, ?, ?)`,
                        [userId, guildId, newState.channelId, currentTime],
                        (err) => {
                            if (err) console.error('Error inserting new active voice session after move:', err.message);
                            else {
                                this.voiceStates.set(userId, { guildId, channelId: newState.channelId, joinTime: currentTime });
                                console.log(`[Voice] ${newState.member.user.tag} moved to ${newState.channel.name}. New session started.`);
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
        if (message.author.bot || !message.guild) return; // Ignore bots and DMs

        await this._handleAntiSpam(message);
        await this._updateUserMessageStats(message);
    }

    /**
     * Handles new guild members joining.
     * @param {import('discord.js').GuildMember} member The guild member.
     * @private
     */
    async _onGuildMemberAdd(member) {
        if (member.user.bot) return; // Ignore bots

        console.log(`User ${member.user.tag} (${member.user.id}) joined guild ${member.guild.name} (${member.guild.id}).`);

        const userAvatar = member.user.displayAvatarURL({ dynamic: true, size: 128 });
        const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;

        // Fetch guild-specific welcome configuration
        this.client.db.get(`SELECT welcome_message_content, welcome_channel_id, send_welcome_as_dm FROM guild_configs WHERE guild_id = ?`, [member.guild.id], async (err, row) => {
            if (err) {
                console.error('Error fetching welcome config:', err.message);
                return;
            }

            let welcomeMessage = row?.welcome_message_content || `Welcome to ${member.guild.name}, ${member}!`;
            welcomeMessage = welcomeMessage.replace(/{user}/g, member.toString())
                                           .replace(/{guild}/g, member.guild.name);

            let dmEmbed;
            let dmComponents = [];

            // Check if user was previously verified
            this.client.db.get(`SELECT user_id FROM verified_users WHERE user_id = ? AND guild_id = ?`, [member.user.id, member.guild.id], async (err, verifiedRow) => {
                if (err) {
                    console.error('Error checking verified_users table:', err.message);
                }

                if (verifiedRow) {
                    console.log(`User ${member.user.tag} was previously verified. Attempting to re-assign role.`);
                    if (VERIFIED_ROLE_ID) {
                        const verifiedRole = member.guild.roles.cache.get(VERIFIED_ROLE_ID);
                        if (verifiedRole) {
                            try {
                                await member.roles.add(verifiedRole);
                                console.log(`Re-assigned verified role to ${member.user.tag}.`);
                            } catch (roleErr) {
                                console.error(`Failed to re-assign verified role to ${member.user.tag}:`, roleErr.message);
                            }
                        } else {
                            console.warn(`VERIFIED_ROLE_ID (${VERIFIED_ROLE_ID}) not found in guild ${member.guild.name}.`);
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
                    // User not previously verified, prompt for verification
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

                // Send welcome DM
                try {
                    await member.send({ embeds: [dmEmbed], components: dmComponents });
                    console.log(`Sent welcome DM to ${member.user.tag}.`);
                } catch (dmErr) {
                    console.warn(`Could not send welcome DM to ${member.user.tag}: ${dmErr.message}`);
                }

                // Send public welcome message to configured channel
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

                        await channel.send({ embeds: [publicWelcomeEmbed] }).catch(e => console.error('Error sending public welcome message:', e));
                        console.log(`Sent public welcome message to ${channel.name} for ${member.user.tag}`);
                    } else {
                        console.warn(`Configured welcome channel ${row.welcome_channel_id} not found or is not a text/announcement channel for public welcome.`);
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
        if (member.user.bot) return; // Ignore bots

        console.log(`User ${member.user.tag} (${member.user.id}) left guild ${member.guild.name} (${member.guild.id}).`);

        try {
            // Fetch farewell channel from guild configuration
            const row = await new Promise((resolve, reject) => {
                this.client.db.get(`SELECT farewell_channel_id FROM guild_configs WHERE guild_id = ?`, [member.guild.id], (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                });
            });

            // Send public farewell message
            if (row && row.farewell_channel_id) {
                const farewellChannel = member.guild.channels.cache.get(row.farewell_channel_id);
                if (farewellChannel && (farewellChannel.type === ChannelType.GuildText || farewellChannel.type === ChannelType.GuildAnnouncement)) {
                    await farewellChannel.send({ embeds: [new EmbedBuilder()
                        .setColor('#FF0000')
                        .setDescription(`👋 **${member.user.tag}** has left the server. We'll miss them!`)
                        .setTimestamp()
                    ]}).catch(e => console.error("Error sending farewell message to channel:", e));
                    console.log(`Successfully attempted to send farewell message to channel for ${member.user.tag}.`);
                } else {
                    console.warn(`Configured farewell channel ${row.farewell_channel_id} not found or is not a text/announcement channel.`);
                }
            }

            // Send farewell DM to the user
            const farewellEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle(`Goodbye from ${member.guild.name}!`)
                .setDescription(`We're sorry to see you go, **${member.user.username}**! We hope you had a good time with us.`)
                .setThumbnail(member.guild.iconURL())
                .setTimestamp()
                .setFooter({ text: 'Pulchowk Bot | You can rejoin anytime!' });

            await member.user.send({ embeds: [farewellEmbed] }).catch(error => {
                console.warn(`Could not send farewell DM to ${member.user.tag}:`, error.message);
            });
            console.log(`Successfully attempted to send farewell DM to ${member.user.tag}.`);

            // Small delay to ensure messages are sent before potential process exit (if this is the last member)
            await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
            console.error('An unexpected error occurred during guild member removal process:', error);
        }
    }

    /**
     * Handles reactions being added to messages.
     * @param {import('discord.js').MessageReaction} reaction The message reaction.
     * @param {import('discord.js').User} user The user who added the reaction.
     * @private
     */
    async _onMessageReactionAdd(reaction, user) {
        // Fetch partial reactions/messages if needed
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error('Something went wrong when fetching the reaction:', error);
                return;
            }
        }
        if (user.bot || !reaction.message.guild) return; // Ignore bots and DMs

        // Handle Reaction Roles
        this.client.db.get(`SELECT role_id FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?`,
            [reaction.message.guild.id, reaction.message.id, reaction.emoji.name],
            async (err, row) => {
                if (err) {
                    console.error('Error fetching reaction role:', err.message);
                    return;
                }
                if (row) {
                    const member = reaction.message.guild.members.cache.get(user.id);
                    if (member) {
                        const role = reaction.message.guild.roles.cache.get(row.role_id);
                        if (role) {
                            if (!member.roles.cache.has(role.id)) {
                                // Check bot's permissions and role hierarchy before assigning
                                if (!reaction.message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                                    console.error(`Bot lacks 'Manage Roles' permission to assign role ${role.name} for reaction role.`);
                                    return;
                                }
                                if (reaction.message.guild.members.me.roles.highest.position <= role.position) {
                                    console.error(`Bot's highest role is not above ${role.name} for reaction role assignment.`);
                                    return;
                                }
                                try {
                                    await member.roles.add(role, 'Reaction role assignment');
                                    console.log(`Assigned role ${role.name} to ${user.tag} via reaction.`);
                                } catch (roleErr) {
                                    console.error(`Error assigning role ${role.name} to ${user.tag}:`, roleErr);
                                }
                            }
                        } else {
                            console.warn(`Configured role ${row.role_id} for reaction role not found in guild ${reaction.message.guild.name}. Deleting invalid entry.`);
                            this.client.db.run(`DELETE FROM reaction_roles WHERE role_id = ? AND guild_id = ?`, [row.role_id, reaction.message.guild.id]);
                        }
                    }
                }
            }
        );

        // Handle Suggestion Voting (if applicable)
        const SUGGESTIONS_CHANNEL_ID = process.env.SUGGESTIONS_CHANNEL_ID;
        if (reaction.message.channel.id === SUGGESTIONS_CHANNEL_ID && (reaction.emoji.name === '👍' || reaction.emoji.name === '👎')) {
            const message = await reaction.message.fetch().catch(e => console.error('Error fetching suggestion message:', e));
            if (!message) return;

            this.client.db.get(`SELECT id, upvotes, downvotes, user_id FROM suggestions WHERE message_id = ? AND guild_id = ?`,
                [message.id, message.guild.id],
                async (err, row) => {
                    if (err) {
                        console.error('Error fetching suggestion for voting:', err.message);
                        return;
                    }
                    if (row) {
                        // Prevent self-voting on suggestions
                        if (user.id === row.user_id) {
                            await reaction.users.remove(user.id).catch(e => console.error('Error removing self-vote reaction:', e));
                            return;
                        }

                        let newUpvotes = row.upvotes || 0;
                        let newDownvotes = row.downvotes || 0;

                        // Check if the user has already reacted with the opposite emoji
                        const hasUpvoted = message.reactions.cache.get('👍')?.users.cache.has(user.id);
                        const hasDownvoted = message.reactions.cache.get('👎')?.users.cache.has(user.id);

                        if (reaction.emoji.name === '👍') {
                            if (hasDownvoted) {
                                await message.reactions.cache.get('👎').users.remove(user.id).catch(e => console.error('Error removing opposite reaction:', e));
                                newDownvotes = Math.max(0, newDownvotes - 1); // Ensure it doesn't go below zero
                            }
                            newUpvotes++;
                        } else if (reaction.emoji.name === '👎') {
                            if (hasUpvoted) {
                                await message.reactions.cache.get('👍').users.remove(user.id).catch(e => console.error('Error removing opposite reaction:', e));
                                newUpvotes = Math.max(0, newUpvotes - 1); // Ensure it doesn't go below zero
                            }
                            newDownvotes++;
                        }

                        // Update votes in the database
                        this.client.db.run(`UPDATE suggestions SET upvotes = ?, downvotes = ? WHERE id = ?`,
                            [newUpvotes, newDownvotes, row.id],
                            (updateErr) => {
                                if (updateErr) {
                                    console.error('Error updating suggestion votes:', updateErr.message);
                                    return;
                                }
                                // Update the message embed to reflect new vote counts
                                if (message.embeds[0]) {
                                    const updatedEmbed = EmbedBuilder.from(message.embeds[0])
                                        .setFooter({ text: `Suggestion ID: ${row.id} | Votes: 👍 ${newUpvotes} / 👎 ${newDownvotes}` });
                                    message.edit({ embeds: [updatedEmbed] }).catch(e => console.error('Error editing suggestion message embed:', e));
                                }
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
        // Fetch partial reactions/messages if needed
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error('Something went wrong when fetching the reaction:', error);
                return;
            }
        }
        if (user.bot || !reaction.message.guild) return; // Ignore bots and DMs

        // Handle Reaction Roles
        this.client.db.get(`SELECT role_id FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?`,
            [reaction.message.guild.id, reaction.message.id, reaction.emoji.name],
            async (err, row) => {
                if (err) {
                    console.error('Error fetching reaction role on remove:', err.message);
                    return;
                }
                if (row) {
                    const member = reaction.message.guild.members.cache.get(user.id);
                    if (member) {
                        const role = reaction.message.guild.roles.cache.get(row.role_id);
                        if (role) {
                            if (member.roles.cache.has(role.id)) {
                                // Check bot's permissions and role hierarchy before removing
                                if (!reaction.message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                                    console.error(`Bot lacks 'Manage Roles' permission to remove role ${role.name} for reaction role.`);
                                    return;
                                }
                                if (reaction.message.guild.members.me.roles.highest.position <= role.position) {
                                    console.error(`Bot's highest role is not above ${role.name} for reaction role removal.`);
                                    return;
                                }
                                try {
                                    await member.roles.remove(role, 'Reaction role removal');
                                    console.log(`Removed role ${role.name} from ${user.tag} via reaction.`);
                                } catch (roleErr) {
                                    console.error(`Error removing role ${role.name} from ${user.tag}:`, roleErr);
                                }
                            }
                        }
                    }
                }
            }
        );

        // Handle Suggestion Voting (if applicable)
        const SUGGESTIONS_CHANNEL_ID = process.env.SUGGESTIONS_CHANNEL_ID;
        if (reaction.message.channel.id === SUGGESTIONS_CHANNEL_ID && (reaction.emoji.name === '👍' || reaction.emoji.name === '👎')) {
            const message = await reaction.message.fetch().catch(e => console.error('Error fetching suggestion message:', e));
            if (!message) return;

            this.client.db.get(`SELECT id, upvotes, downvotes, user_id FROM suggestions WHERE message_id = ? AND guild_id = ?`,
                [message.id, message.guild.id],
                async (err, row) => {
                    if (err) {
                        console.error('Error fetching suggestion for voting removal:', err.message);
                        return;
                    }
                    if (row) {
                        // Self-votes shouldn't affect counts, so no need to process removal for them
                        if (user.id === row.user_id) return;

                        let newUpvotes = row.upvotes || 0;
                        let newDownvotes = row.downvotes || 0;

                        if (reaction.emoji.name === '👍') {
                            newUpvotes = Math.max(0, newUpvotes - 1); // Ensure it doesn't go below zero
                        } else if (reaction.emoji.name === '👎') {
                            newDownvotes = Math.max(0, newDownvotes - 1); // Ensure it doesn't go below zero
                        }

                        // Update votes in the database
                        this.client.db.run(`UPDATE suggestions SET upvotes = ?, downvotes = ? WHERE id = ?`,
                            [newUpvotes, newDownvotes, row.id],
                            (updateErr) => {
                                if (updateErr) {
                                    console.error('Error updating suggestion votes on removal:', updateErr.message);
                                    return;
                                }
                                // Update the message embed to reflect new vote counts
                                if (message.embeds[0]) {
                                    const updatedEmbed = EmbedBuilder.from(message.embeds[0])
                                        .setFooter({ text: `Suggestion ID: ${row.id} | Votes: 👍 ${newUpvotes} / 👎 ${newDownvotes}` });
                                    message.edit({ embeds: [updatedEmbed] }).catch(e => console.error('Error editing suggestion message embed:', e));
                                }
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
                console.error('Error fetching anti-spam config:', err.message);
                return;
            }
            // Default anti-spam configuration if not found in DB
            const antiSpamConfig = config || {
                message_limit: 5,
                time_window_seconds: 5,
                mute_duration_seconds: 300, // 5 minutes
                kick_threshold: 3,
                ban_threshold: 5
            };
            const { message_limit, time_window_seconds, mute_duration_seconds, kick_threshold, ban_threshold } = antiSpamConfig;

            if (!this.spamMap.has(userId)) {
                // First message in the window
                this.spamMap.set(userId, {
                    count: 1,
                    lastMessageTimestamp: message.createdTimestamp,
                    timer: setTimeout(() => {
                        this.spamMap.delete(userId); // Clear user's spam data after time window
                    }, time_window_seconds * 1000)
                });
            } else {
                const userData = this.spamMap.get(userId);
                userData.count++;
                clearTimeout(userData.timer); // Reset timer on new message
                userData.timer = setTimeout(() => {
                    this.spamMap.delete(userId);
                }, time_window_seconds * 1000);

                if (userData.count > message_limit) {
                    this.spamWarnings.set(userId, (this.spamWarnings.get(userId) || 0) + 1);
                    const currentWarnings = this.spamWarnings.get(userId);

                    if (currentWarnings >= ban_threshold) {
                        if (message.member && message.member.bannable) {
                            await message.member.ban({ reason: `Automated anti-spam: ${currentWarnings} spam warnings.` }).catch(e => console.error('Error banning:', e));
                            message.channel.send(`🚨 ${message.author.tag} has been banned for repeated spamming. (${currentWarnings} warnings)`).catch(e => console.error("Error sending ban message:", e));
                            this.spamWarnings.delete(userId); // Clear warnings after ban
                        } else {
                            message.channel.send(`🚨 Anti-spam: ${message.author.tag} is spamming but I cannot ban them.`).catch(e => console.error("Error sending ban failure message:", e));
                        }
                    } else if (currentWarnings >= kick_threshold) {
                        if (message.member && message.member.kickable) {
                            await message.member.kick(`Automated anti-spam: ${currentWarnings} spam warnings.`).catch(e => console.error('Error kicking:', e));
                            message.channel.send(`⚠️ ${message.author.tag} has been kicked for excessive spamming. (${currentWarnings} warnings)`).catch(e => console.error("Error sending kick message:", e));
                        } else {
                            message.channel.send(`⚠️ Anti-spam: ${message.author.tag} is spamming but I cannot kick them.`).catch(e => console.error("Error sending kick failure message:", e));
                        }
                    } else {
                        const muteDurationMs = mute_duration_seconds * 1000;
                        if (message.member && message.member.moderatable && !message.member.isCommunicationDisabled()) {
                            await message.member.timeout(muteDurationMs, 'Automated anti-spam mute').catch(e => console.error('Error timing out:', e));
                            message.channel.send(`🔇 ${message.author.tag} has been timed out for ${mute_duration_seconds} seconds due to spamming. (Warning ${currentWarnings}/${kick_threshold})`).catch(e => console.error("Error sending mute message:", e));
                        } else {
                            message.channel.send(`🔇 Anti-spam: ${message.author.tag} is spamming but I cannot mute them. (Warning ${currentWarnings}/${kick_threshold})`).catch(e => console.error("Error sending mute failure message:", e));
                        }
                    }
                    // Delete spam messages
                    if (message.channel.permissionsFor(this.client.user).has(PermissionsBitField.Flags.ManageMessages)) {
                        await message.channel.bulkDelete(Math.min(userData.count, 100), true).catch(e => console.error('Error bulk deleting messages:', e));
                    } else {
                        console.warn(`Bot lacks 'Manage Messages' permission to delete spam messages in channel ${message.channel.name}.`);
                    }
                    this.spamMap.delete(userId); // Clear current spam count after action
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
                if (err) console.error('Error updating message stats:', err.message);
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
        console.log('[Scheduler] Starting check for new notices...');
        const TARGET_NOTICE_CHANNEL_ID = process.env.TARGET_NOTICE_CHANNEL_ID;
        const NOTICE_ADMIN_CHANNEL_ID = process.env.NOTICE_ADMIN_CHANNEL_ID;
        const TEMP_ATTACHMENT_DIR = path.join(process.cwd(), 'temp_notice_attachments');

        console.log(`[Scheduler] TARGET_NOTICE_CHANNEL_ID: ${TARGET_NOTICE_CHANNEL_ID}`);
        console.log(`[Scheduler] NOTICE_ADMIN_CHANNEL_ID: ${NOTICE_ADMIN_CHANNEL_ID}`);
        console.log(`[Debug] Current Working Directory (process.cwd()): ${process.cwd()}`);
        console.log(`[Debug] Calculated TEMP_ATTACHMENT_DIR: ${TEMP_ATTACHMENT_DIR}`);

        try {
            await fsPromises.mkdir(TEMP_ATTACHMENT_DIR, { recursive: true });
            console.log(`[Debug] Successfully ensured TEMP_ATTACHMENT_DIR exists: ${TEMP_ATTACHMENT_DIR}`);
        } catch (e) {
            console.error(`[Debug] Error creating TEMP_ATTACHMENT_DIR (${TEMP_ATTACHMENT_DIR}):`, e);
            let adminChannel;
            if (NOTICE_ADMIN_CHANNEL_ID && NOTICE_ADMIN_CHANNEL_ID !== 'YOUR_NOTICE_ADMIN_CHANNEL_ID_HERE') {
                try {
                    adminChannel = await this.client.channels.fetch(NOTICE_ADMIN_CHANNEL_ID);
                    if (adminChannel) await adminChannel.send(`❌ Critical: Could not create temp directory: ${e.message}`).catch(sendErr => console.error("Error sending admin error:", sendErr));
                } catch (fetchErr) {
                    console.warn(`Could not fetch admin channel for error notification:`, fetchErr.message);
                }
            }
            return;
        }

        if (!TARGET_NOTICE_CHANNEL_ID || TARGET_NOTICE_CHANNEL_ID === 'YOUR_NOTICE_CHANNEL_ID_HERE') {
            console.warn('[Scheduler] TARGET_NOTICE_CHANNEL_ID not configured. Skipping notice announcements.');
            return;
        }

        let noticeChannel;
        try {
            noticeChannel = await this.client.channels.fetch(TARGET_NOTICE_CHANNEL_ID);
            if (!noticeChannel || !(noticeChannel.type === ChannelType.GuildText || noticeChannel.type === ChannelType.GuildAnnouncement)) {
                console.error(`[Scheduler] Configured notice channel not found or is not a text/announcement channel.`);
                return;
            }
        } catch (error) {
            console.error(`[Scheduler] Error fetching notice channel ${TARGET_NOTICE_CHANNEL_ID}:`, error.message);
            return;
        }

        let adminChannel;
        if (NOTICE_ADMIN_CHANNEL_ID && NOTICE_ADMIN_CHANNEL_ID !== 'YOUR_NOTICE_ADMIN_CHANNEL_ID_HERE') {
            try {
                adminChannel = await this.client.channels.fetch(NOTICE_ADMIN_CHANNEL_ID);
            } catch (error) {
                console.warn(`[Scheduler] Could not fetch admin channel ${NOTICE_ADMIN_CHANNEL_ID}.`, error.message);
                adminChannel = null;
            }
        }

        try {
            console.log('[Scheduler] Calling scrapeLatestNotice()...');
            let scrapedNotices = await scrapeLatestNotice();
            console.log(`[Scheduler] scrapeLatestNotice() returned: ${JSON.stringify(scrapedNotices)}`);

            if (!scrapedNotices || scrapedNotices.length === 0) {
                console.log('[Scheduler] No notices found or scraper returned empty.');
                return;
            }

            const MAX_NOTICE_AGE_DAYS = parseInt(process.env.MAX_NOTICE_AGE_DAYS || '30', 10);
            const now = new Date();

            const noticesToAnnounce = scrapedNotices.filter(notice => {
                const noticeDate = new Date(notice.date);
                if (isNaN(noticeDate.getTime())) {
                    console.warn(`[Scheduler] Invalid date format for notice: ${notice.title} - ${notice.date}`);
                    return false;
                }

                const ageInDays = (now - noticeDate) / (1000 * 60 * 60 * 24);
                return ageInDays <= MAX_NOTICE_AGE_DAYS;
            });

            if (noticesToAnnounce.length === 0) {
                console.log(`[Scheduler] No notices found in the last ${MAX_NOTICE_AGE_DAYS} days.`);
                return;
            }
            console.log(`[Scheduler] Found ${noticesToAnnounce.length} notices to announce from the past ${MAX_NOTICE_AGE_DAYS} days.`);

            for (const notice of noticesToAnnounce) {
                let tempFilesOnDisk = [];
                try {
                    if (!notice || !notice.title || !notice.link) {
                        console.warn('[Scheduler] Scraper returned an invalid notice object:', notice);
                        continue;
                    }

                    // Check if the notice has already been announced
                    const row = await new Promise((resolve, reject) => {
                        this.client.db.get(`SELECT COUNT(*) AS count FROM notices WHERE link = ?`, [notice.link], (err, result) => {
                            if (err) reject(err);
                            else resolve(result);
                        });
                    });

                    if (row.count === 0) {
                        console.log(`[Scheduler] New notice found from ${notice.source}: ${notice.title}`);

                        const noticeEmbed = new EmbedBuilder()
                            .setColor('#1E90FF')
                            .setTitle(`Notice ${notice.id ? notice.id + ': ' : ''}${notice.title}`)
                            .setURL(notice.link)
                            .setFooter({ text: `Source: ${notice.source}` })
                            .setTimestamp(new Date(notice.date));

                        let allFilesForNotice = [];
                        let description = `A new notice has been published.`;

                        if (notice.attachments && notice.attachments.length > 0) {
                            console.log(`[Scheduler] Processing attachments for notice: ${notice.title}`);

                            for (const attachmentUrl of notice.attachments) {
                                try {
                                    const fileName = path.basename(new URL(attachmentUrl).pathname);
                                    const tempFilePath = path.join(TEMP_ATTACHMENT_DIR, fileName);
                                    tempFilesOnDisk.push(tempFilePath);

                                    console.log(`[Debug] Attempting to download ${attachmentUrl} to ${tempFilePath}`);
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
                                                console.log(`[Debug] PDF ${fileName} has ${totalPdfPages} pages using pdfjs-dist.`);
                                            } catch (pdfjsError) {
                                                console.warn(`[Warning] Could not get page count for PDF ${fileName} using pdfjs-dist:`, pdfjsError.message);
                                                totalPdfPages = MAX_PDF_PAGES_TO_CONVERT; // Fallback to max pages if page count fails
                                            }

                                            const pdfConvertOptions = {
                                                density: 150,
                                                quality: 90,
                                                width: 1240,
                                                height: 1754,
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
                                                        console.log(`Converted PDF ${fileName} page ${pageNum} to PNG and prepared for sending.`);
                                                        pageConvertedCount++;
                                                    } else {
                                                        console.warn(`No valid response for PDF ${fileName} at page ${pageNum}. Stopping conversion for this PDF.`);
                                                        break; // Stop if a page conversion fails
                                                    }
                                                } catch (pageConvertError) {
                                                    console.warn(`Could not convert PDF ${fileName} page ${pageNum}:`, pageConvertError.message);
                                                    if (pageConvertError.message.includes('does not exist') || pageConvertError.message.includes('invalid page number')) {
                                                        break; // Stop if page number is invalid or file not found
                                                    }
                                                }
                                            }

                                            if (pageConvertedCount === 0) {
                                                console.warn(`No pages converted for PDF ${fileName}. Sending original PDF.`);
                                                allFilesForNotice.push(new AttachmentBuilder(tempFilePath, { name: fileName }));
                                            } else if (pageConvertedCount < totalPdfPages) {
                                                console.log(`\n(Sent ${pageConvertedCount} of ${totalPdfPages} pages from ${fileName} as images.)`);
                                            } else {
                                                console.log(`\n(Sent all ${totalPdfPages} pages from ${fileName} as images.)`);
                                            }

                                        } catch (pdfProcessError) {
                                            console.error(`Error processing PDF ${fileName}:`, pdfProcessError.message);
                                            description += `\n\n⚠️ Could not process PDF attachment: ${fileName}`;
                                            allFilesForNotice.push(new AttachmentBuilder(tempFilePath, { name: fileName })); // Send original PDF if conversion fails
                                        }
                                    } else {
                                        allFilesForNotice.push(new AttachmentBuilder(tempFilePath, { name: fileName }));
                                        console.log(`Prepared attachment: ${fileName}`);
                                    }
                                } catch (downloadError) {
                                    console.error(`Error downloading attachment ${attachmentUrl}:`, downloadError.message);
                                    description += `\n\n⚠️ Could not download an attachment: ${attachmentUrl}`;
                                }
                            }
                        }
                        noticeEmbed.setDescription(description);

                        const ATTACHMENT_LIMIT = 10; // Discord's attachment limit per message
                        if (allFilesForNotice.length > 0) {
                            let sentFirstMessage = false;
                            for (let i = 0; i < allFilesForNotice.length; i += ATTACHMENT_LIMIT) {
                                const chunk = allFilesForNotice.slice(i, i + ATTACHMENT_LIMIT);
                                try {
                                    if (!sentFirstMessage) {
                                        await noticeChannel.send({ embeds: [noticeEmbed], files: chunk });
                                        sentFirstMessage = true;
                                    } else {
                                        // Send subsequent chunks as separate messages with a continuation note
                                        await noticeChannel.send({ content: `(Continued attachments for "${notice.title}")`, files: chunk });
                                    }
                                    console.log(`Sent chunk of ${chunk.length} attachments for "${notice.title}" to Discord.`);
                                } catch (discordSendError) {
                                    console.error(`Error sending notice or files to channel ${TARGET_NOTICE_CHANNEL_ID} (chunk ${i / ATTACHMENT_LIMIT + 1}):`, discordSendError);
                                    if (adminChannel) await adminChannel.send(`❌ Error sending notice/files for "${notice.title}" (chunk ${i / ATTACHMENT_LIMIT + 1}): ${discordSendError.message}`).catch(e => console.error("Error sending admin error:", e));
                                }
                            }
                        } else {
                            // Send only embed if no attachments
                            try {
                                await noticeChannel.send({ embeds: [noticeEmbed] });
                                console.log(`Sent notice for "${notice.title}" to Discord (no attachments).`);
                            } catch (discordSendError) {
                                console.error(`Error sending notice to channel ${TARGET_NOTICE_CHANNEL_ID}:`, discordSendError);
                                if (adminChannel) await adminChannel.send(`❌ Error sending notice for "${notice.title}": ${discordSendError.message}`).catch(e => console.error("Error sending admin error:", e));
                            }
                        }

                        // Save the announced notice to the database
                        await new Promise((resolve, reject) => {
                            this.client.db.run(`INSERT INTO notices (title, link, date, announced_at) VALUES (?, ?, ?, ?)`,
                                [notice.title, notice.link, notice.date, Date.now()],
                                (insertErr) => {
                                    if (insertErr) {
                                        reject(insertErr);
                                    } else {
                                        console.log(`[Scheduler] Announced and saved new notice: ${notice.title}`);
                                        resolve();
                                    }
                                }
                            );
                        }).catch(insertErr => {
                            console.error('Error saving new notice to DB:', insertErr.message);
                            if (adminChannel) adminChannel.send(`❌ Error saving new notice to DB: ${insertErr.message}`).catch(e => console.error("Error sending admin error:", e));
                        });

                    } else {
                        console.log(`[Scheduler] Notice from ${notice.source} ("${notice.title}") already announced. Skipping.`);
                    }
                } catch (noticeProcessError) {
                    console.error(`[Scheduler] Error processing notice "${notice.title}":`, noticeProcessError.message);
                    if (adminChannel) {
                        await adminChannel.send(`❌ Error processing notice "${notice.title}": ${noticeProcessError.message}`).catch(e => console.error("Error sending admin error:", e));
                    }
                } finally {
                    // Clean up temporary files for this notice
                    for (const filePath of tempFilesOnDisk) {
                        try {
                            await fsPromises.unlink(filePath);
                            console.log(`Cleaned up temporary file: ${filePath}`);
                        } catch (unlinkError) {
                            console.warn(`Error cleaning up temporary file ${filePath}:`, unlinkError.message);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('[Scheduler] Error during notice scraping or announcement:', error.message);
            if (adminChannel) {
                await adminChannel.send(`❌ Notice scraping failed: ${error.message}`).catch(e => console.error("Error sending admin error:", e));
            }
        }
        finally {
            // Attempt to remove the entire temp directory after all notices are processed
            await fsPromises.rm(TEMP_ATTACHMENT_DIR, { recursive: true, force: true }).catch(e => console.error('Error deleting temp directory after all notices processed:', e));
        }
    }

    /**
     * Announces birthdays for users in guilds.
     * @private
     */
    async _announceBirthdays() {
        console.log('[Scheduler] Checking for birthdays...');
        const BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID = process.env.BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID;

        // Validate if the announcement channel ID is set
        if (!BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID || BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID === 'YOUR_BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID_HERE') {
            console.warn('BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID is not set or invalid. Birthday announcements disabled.');
            return;
        }

        let announcementChannel;
        try {
            // Fetch the announcement channel
            announcementChannel = await this.client.channels.fetch(BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID);
            // Ensure it's a valid text or announcement channel
            if (!announcementChannel || !(announcementChannel.type === ChannelType.GuildText || announcementChannel.type === ChannelType.GuildAnnouncement)) {
                console.error(`[Scheduler] Configured birthday channel not found or is not a text/announcement channel.`);
                return;
            }
        } catch (error) {
            console.error(`[Scheduler] Error fetching birthday announcement channel:`, error.message);
            return;
        }

        const today = new Date();
        const currentMonth = today.getMonth() + 1; // getMonth() is 0-indexed
        const currentDay = today.getDate();
        const guilds = this.client.guilds.cache; // Use cached guilds for efficiency

        for (const [guildId, guild] of guilds) {
            try {
                // Fetch birthdays for the current guild and date from the database
                const rows = await new Promise((resolve, reject) => {
                    this.client.db.all(`SELECT user_id, year FROM birthdays WHERE guild_id = ? AND month = ? AND day = ?`,
                        [guild.id, currentMonth, currentDay],
                        (err, resultRows) => {
                            if (err) {
                                console.error(`Error fetching birthdays for guild ${guild.name} (${guild.id}):`, err.message);
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
                            const member = await guild.members.fetch(row.user_id); // Fetch guild member
                            let ageString = '';
                            if (row.year) {
                                const age = today.getFullYear() - row.year;
                                if (age >= 0) ageString = ` (turning ${age})`;
                            }
                            birthdayUsers.push(`• <@${member.user.id}>${ageString}`);
                            // Get avatar URL for the first user for the embed thumbnail
                            if (!firstBirthdayUserAvatarUrl) {
                                firstBirthdayUserAvatarUrl = member.user.displayAvatarURL({ dynamic: true, size: 128 });
                            }
                        } catch (fetchErr) {
                            console.warn(`Could not fetch birthday user ${row.user_id}):`, fetchErr.message);
                            birthdayUsers.push(`• Unknown User (ID: ${row.user.id})`); // Fallback for unfetchable users
                        }
                    }

                    if (birthdayUsers.length > 0) {
                        const authorName = `Free Students' Union, Pulchowk Campus - 2081`;
                        const authorIconUrl = "https://cdn.discordapp.com/attachments/712392381827121174/1396481277284323462/fsulogo.png?ex=687e3e09&is=687cec89&hm=6ce3866b2a68ba39b762c6dd3df8c57c64eecf980e09058768de325bf43246c2&";
                        const authorWebsiteUrl = "https://www.facebook.com/fsupulchowk";

                        const birthdayEmbed = new EmbedBuilder()
                            .setColor('#FFD700') // Gold color
                            .setAuthor({
                                name: authorName,
                                iconURL: authorIconUrl,
                                url: authorWebsiteUrl
                            })
                            .setTitle('🎂 Happy Birthday!')
                            .setDescription(`🎉 Wishing a very happy birthday to our amazing community members:\n\n${birthdayUsers.join('\n')}\n\nMay you have a fantastic day filled with joy and celebration!`)
                            .setImage('https://codaio.imgix.net/docs/Y_HFctSU9K/blobs/bl-4kLxBlt-8t/66dbaff27d8df6da40fc20009f59a885dca2e859e880d992e28c3096d08bd205041c9ea43d0ca891055d56e79864748a9564d1be896d57cc93bf6c57e6b25e879d80a6d5058a91ef3572aff7c0a3b9efb24f7f0d1daa0d170368b9686d674c81650fa247?auto=format%2Ccompress&fit=crop&w=1920&ar=4%3A1&crop=focalpoint&fp-x=0.5&fp-y=0.5&fp-z=1') // Festive image
                            .setTimestamp();

                        // Set thumbnail to the first birthday user's avatar or default logo
                        if (firstBirthdayUserAvatarUrl) {
                            birthdayEmbed.setThumbnail(firstBirthdayUserAvatarUrl);
                        } else {
                            birthdayEmbed.setThumbnail('https://cdn.discordapp.com/attachments/712392381827121174/1396481277284323462/fsulogo.png?ex=687e3e09&is=687cec89&hm=6ce3866b2a68ba39b762c6dd3df8c57c64eecf980e09058768de325bf43246c2&');
                        }

                        // Send the birthday announcement
                        await announcementChannel.send({ embeds: [birthdayEmbed] }).catch(e => console.error(`Error sending birthday announcement in guild ${guild.name} (${guild.id}):`, e));
                    } else {
                        console.log(`[Scheduler] No birthdays found for today in guild ${guild.name} (${guild.id}).`);
                    }
                }
            } catch (guildError) {
                console.error(`Error processing guild ${guild.name} (${guild.id}) for birthdays:`, guildError);
            }
        }
    }

    /**
     * Placeholder method for handling suggestion votes.
     * You will need to implement the actual logic for updating votes in your database
     * and refreshing the suggestion message.
     * @param {import('discord.js').ButtonInteraction} interaction The button interaction.
     * @private
     */
    async _handleSuggestionVote(interaction) {
        console.log(`Handling suggestion vote for interaction ${interaction.customId}`);
        // TODO: Implement actual logic for voting on suggestions.
        // This should fetch the suggestion, update its votes, and edit the original message.

        // Acknowledge the interaction, as it's a button click
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Voted on suggestion!', flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error replying to suggestion vote:", e));
        } else {
            await interaction.editReply({ content: 'Voted on suggestion!' }).catch(e => console.error("Error editing reply for suggestion vote:", e));
        }
    }

    /**
     * Placeholder method for handling suggestion deletion initiated via a button.
     * You will need to implement the actual logic for deleting the suggestion from the database
     * and deleting the message from Discord.
     * @param {import('discord.js').ButtonInteraction} interaction The button interaction.
     * @private
     */
    async _handleSuggestionDelete(interaction) {
        console.log(`Handling suggestion delete for interaction ${interaction.customId}`);
        // TODO: Implement actual logic for deleting suggestions.
        // This should fetch the suggestion, check permissions, delete from DB, and delete the message.

        // Acknowledge the interaction
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Suggestion deletion requested!', flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error replying to suggestion delete:", e));
        } else {
            await interaction.editReply({ content: 'Suggestion deletion requested!' }).catch(e => console.error("Error editing reply for suggestion delete:", e));
        }
    }

    /**
     * Placeholder method for processing suggestion denial from a modal.
     * You will need to implement the actual logic for marking a suggestion as denied,
     * potentially notifying the suggester, and updating the message.
     * @param {import('discord.js').ModalSubmitInteraction} interaction The modal submission interaction.
     * @param {string} suggestionId The ID of the suggestion to deny.
     * @param {string} reason The reason for denying the suggestion.
     * @private
     */
    async _processSuggestionDenial(interaction, suggestionId, reason) {
        console.log(`Processing denial for suggestion ${suggestionId} with reason: ${reason}`);
        // TODO: Implement actual logic for denying a suggestion.
        // This should update the suggestion status in DB, possibly edit the message, and notify the user.

        // Acknowledge the modal submission
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: `Suggestion ${suggestionId} denied. Reason: "${reason}"`, flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error replying to suggestion denial:", e));
        } else {
            await interaction.editReply({ content: `Suggestion ${suggestionId} denied. Reason: "${reason}"` }).catch(e => console.error("Error editing reply for suggestion denial:", e));
        }
    }

    /**
     * Placeholder method for processing suggestion deletion from a modal.
     * This is typically for administrative deletion with a reason.
     * @param {import('discord.js').ModalSubmitInteraction} interaction The modal submission interaction.
     * @param {string} suggestionId The ID of the suggestion to delete.
     * @param {string} reason The reason for deleting the suggestion.
     * @private
     */
    async _processSuggestionDelete(interaction, suggestionId, reason) {
        console.log(`Processing deletion from modal for suggestion ${suggestionId} with reason: ${reason}`);
        // TODO: Implement actual logic for deleting a suggestion with a reason.
        // This should delete from DB, delete message, and potentially log the action.

        // Acknowledge the modal submission
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: `Suggestion ${suggestionId} deleted. Reason: "${reason}"`, flags: [MessageFlags.Ephemeral] }).catch(e => console.error("Error replying to suggestion deletion from modal:", e));
        } else {
            await interaction.editReply({ content: `Suggestion ${suggestionId} deleted. Reason: "${reason}"` }).catch(e => console.error("Error editing reply for suggestion deletion from modal:", e));
        }
    }


    /**
     * Starts the bot by logging into Discord.
     */
    async start() {
        await writeServiceAccountKey(); // Ensure service account key is written before login
        await this.client.login(this.token).catch(console.error);
    }
}

// Main function to initialize and start the bot
async function main() {
    try {
        const database = await initializeDatabase(); // Initialize SQLite database
        const bot = new PulchowkBot(process.env.BOT_TOKEN, database);
        await bot.start(); // Start the bot
    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1); // Exit process on critical startup failure
    }
}

main(); // Call the main function to run the bot

// Export the bot class for potential testing or external use
export default PulchowkBot;
