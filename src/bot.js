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
import { initializeDatabase, db } from './database.js';
import { emailService } from './services/emailService.js';
import { scrapeLatestNotice } from './services/scraper.js';
import { initializeGoogleCalendarClient } from './commands/slash/holidays.js';
import { fromPath } from 'pdf2pic';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { NoticeProcessor } from './utils/NoticeProcessor.js';

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
    debugConfig.log('Unhandled promise rejection:', 'error', null, error, 'error');
    console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    debugConfig.log('Uncaught exception:', 'error', null, error, 'error');
    console.error('Uncaught exception:', error);
    process.exit(1);
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
    const keyPath = path.resolve(process.cwd(), 'src', 'service_account_key.json');
    try {
        const decoded = Buffer.from(b64, 'base64').toString('utf-8');
        await fsPromises.writeFile(keyPath, decoded);
        debugConfig.log('Service account key saved.', 'init', 'success');
    } catch (error) {
        debugConfig.log(`Error writing service account key: ${error.message}`, 'init', null, error, 'error');
    }
}

/**
 * Main Discord Bot class
 */
class PulchowkBot {
    constructor(token, dbInstance) {
        this.token = token;
        this.db = dbInstance;
        this.debugConfig = debugConfig;
        this.debugConfig.log("Bot instance created. Initializing...", 'init');
        this.colors = {
            primary: 0x5865F2,
            success: 0x57F287,
            warning: 0xFEE75C,
            error: 0xED4245
        };

        this.client = new Client({
            intents: [
                IntentsBitField.Flags.Guilds,
                IntentsBitField.Flags.GuildMembers,
                IntentsBitField.Flags.GuildMessages,
                IntentsBitField.Flags.MessageContent,
                IntentsBitField.Flags.GuildVoiceStates,
                IntentsBitField.Flags.DirectMessages,
                IntentsBitField.Flags.GuildMessageReactions
            ],
            partials: [
                Partials.Channel,
                Partials.Message,
                Partials.Reaction,
                Partials.User,
                Partials.GuildMember
            ],
            rest: {
                requestTimeout: 60000 
            }
        });

        this.client.db = dbInstance;
        this.client.commands = new Collection();
        this.commandFiles = [];
        this.developers = process.env.DEVELOPER_IDS ? process.env.DEVELOPER_IDS.split(',') : [];
        this.noticeProcessor = null;

        // State management
        this.spamMap = new Map();
        this.spamWarnings = new Map();
        this.voiceStates = new Map();
        this.rateLimitMap = new Map();
        this.interactionStates = new Map(); 

        this._initializeCommands();
        this._registerEventListeners();
}
    /**
     * Initializes and loads all slash commands with better error handling.
     * @private
     */
    async _initializeCommands() {
        this.debugConfig.log('Starting command initialization', 'command');
        const commandsPath = path.join(__dirname, 'commands', 'slash');

        try {
            if (!fs.existsSync(commandsPath)) {
                this.debugConfig.log(`Commands directory not found: ${commandsPath}`, 'command', null, null, 'error');
                return;
            }

            const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
            this.debugConfig.log(`Found ${commandFiles.length} command files`, 'command', { files: commandFiles }, null, 'verbose');

            const importPromises = commandFiles.map(async file => {
                const filePath = path.join(commandsPath, file);
                try {
                    const commandModule = await import(`file://${filePath}`);
                    
                    if (!commandModule.data || !commandModule.execute) {
                        this.debugConfig.log(`Invalid command structure in ${file}: missing data or execute`, 'command', { file }, null, 'warn');
                        return;
                    }

                    if (!commandModule.data.name || typeof commandModule.execute !== 'function') {
                        this.debugConfig.log(`Invalid command in ${file}: missing name or execute function`, 'command', { file }, null, 'warn');
                        return;
                    }

                    this.client.commands.set(commandModule.data.name, commandModule);
                    this.commandFiles.push(commandModule.data.toJSON());
                    this.debugConfig.log(`Successfully loaded command: ${commandModule.data.name}`, 'command', null, null, 'verbose');
                    
                } catch (error) {
                    this.debugConfig.log(`Failed to load command from ${file}:`, 'command', { file }, error, 'error');
                }
            });

            await Promise.allSettled(importPromises);
            this.debugConfig.log(`Successfully loaded ${this.client.commands.size} commands.`, 'command');
        } catch (error) {
            this.debugConfig.log('Error during command initialization:', 'command', null, error, 'error');
        }
    }

    /**
     * Registers all Discord.js event listeners
     * @private
     */
    _registerEventListeners() {
        this.debugConfig.log('Registering event listeners...', 'event');
        
        this.client.once(Events.ClientReady, async c => {
            this.debugConfig.log(`Bot is ready! Logged in as ${c.user.tag}`, 'client', { userId: c.user.id });
            c.user.setActivity('for new RSS feeds', { type: 'WATCHING' });
            
            try {
                this.noticeProcessor = new NoticeProcessor(this.client, this.debugConfig, this.colors);
                this.debugConfig.log('NoticeProcessor initialized successfully', 'client', null, null, 'success');
                await this._registerSlashCommands();
                this._scheduleJobs();
                await this._loadActiveVoiceSessions();
                initializeGoogleCalendarClient();
                this.debugConfig.log('Bot initialization completed successfully', 'client', null, null, 'success');
            } catch (error) {
                this.debugConfig.log('Error during bot initialization:', 'client', null, error, 'error');
            }
        });
        this.client.on(Events.InteractionCreate, this._safeEventHandler('InteractionCreate', this._onInteractionCreate.bind(this)));
        this.client.on(Events.VoiceStateUpdate, this._safeEventHandler('VoiceStateUpdate', this._onVoiceStateUpdate.bind(this)));
        this.client.on(Events.MessageCreate, this._safeEventHandler('MessageCreate', this._onMessageCreate.bind(this)));
        this.client.on(Events.GuildMemberAdd, this._safeEventHandler('GuildMemberAdd', this._onGuildMemberAdd.bind(this)));
        this.client.on(Events.GuildMemberRemove, this._safeEventHandler('GuildMemberRemove', this._onGuildMemberRemove.bind(this)));
        this.client.on(Events.MessageReactionAdd, this._safeEventHandler('MessageReactionAdd', this._onMessageReactionAdd.bind(this)));
        this.client.on(Events.MessageReactionRemove, this._safeEventHandler('MessageReactionRemove', this._onMessageReactionRemove.bind(this)));
        this.client.on(Events.Error, error => this.debugConfig.log('Discord.js Client Error:', 'client', null, error, 'error'));
        this.client.on(Events.ShardDisconnect, (event, id) => this.debugConfig.log(`Shard ${id} Disconnected:`, 'client', { event }, null, 'warn'));
        this.client.on(Events.ShardReconnecting, (id) => this.debugConfig.log(`Shard ${id} Reconnecting...`, 'client', null, null, 'info'));
        this.client.on(Events.Warn, info => this.debugConfig.log('Discord.js Warning:', 'client', { info }, null, 'warn'));

        this.debugConfig.log('Event listeners registered successfully.', 'event');
    }

    /**
     * Wraps event handlers
     * @private
     */
    _safeEventHandler(eventName, handler) {
        return async (...args) => {
            try {
                await handler(...args);
            } catch (error) {
                this.debugConfig.log(`Error in ${eventName} handler:`, 'event', { eventName }, error, 'error');
            }
        };
    }

    /**
     * Registers slash commands with Discord API.
     * @private
     */
    async _registerSlashCommands() {
        const token = this.token;
        const clientId = process.env.CLIENT_ID;

        if (!token || !clientId) {
            this.debugConfig.log('BOT_TOKEN or CLIENT_ID missing. Cannot register commands.', 'init', null, new Error('Missing credentials'), 'error');
            return;
        }

        if (this.commandFiles.length === 0) {
            this.debugConfig.log('No commands to register.', 'command', null, null, 'warn');
            return;
        }

        const rest = new REST({ version: '10' }).setToken(token);
        this.debugConfig.log('Started refreshing application (/) commands.', 'command');

        try {
            const data = await rest.put(
                Routes.applicationCommands(clientId),
                { body: this.commandFiles }
            );
            this.debugConfig.log(`Successfully reloaded ${data.length} application (/) commands globally.`, 'command');
        } catch (error) {
            this.debugConfig.log('Failed to register application commands', 'command', null, error, 'error');
        }
    }

    /**
     * Loads active voice sessions from database on startup.
     * @private
     */
    async _loadActiveVoiceSessions() {
        return new Promise((resolve, reject) => {
            this.client.db.all(`SELECT user_id, guild_id, channel_id, join_time FROM active_voice_sessions`, [], (err, rows) => {
                if (err) {
                    this.debugConfig.log('Error loading active voice sessions:', 'client', null, err, 'error');
                    return reject(err);
                }
                
                rows.forEach(row => {
                    this.voiceStates.set(row.user_id, {
                        guildId: row.guild_id,
                        channelId: row.channel_id,
                        joinTime: row.join_time
                    });
                });
                
                this.debugConfig.log(`Loaded ${rows.length} active voice sessions.`, 'client', { count: rows.length });
                resolve();
            });
        });
    }

    /**
     * Enhanced interaction handler
     */
    async _onInteractionCreate(interaction) {
        const startTime = Date.now();
        const interactionKey = `${interaction.id}`;
        
        if (this.interactionStates.has(interactionKey)) {
            this.debugConfig.log('Duplicate interaction detected, skipping', 'interaction', { id: interaction.id }, null, 'warn');
            return;
        }
        this.interactionStates.set(interactionKey, { startTime, handled: false });

        const interactionContext = {
            type: interaction.type,
            id: interaction.id,
            user: interaction.user.tag,
            guild: interaction.guild?.id || 'DM',
            command: interaction.commandName || interaction.customId
        };

        this.debugConfig.log(`Processing interaction`, 'interaction', interactionContext, null, 'trace');

        try {
            this.interactionStates.get(interactionKey).handled = true;

            if (interaction.isChatInputCommand()) {
                await this._handleSlashCommand(interaction);
            } else if (interaction.isButton()) {
                await this._handleButtonInteraction(interaction);
            } else if (interaction.isModalSubmit()) {
                await this._handleModalSubmit(interaction);
            } else {
                await this._handleUnknownInteraction(interaction);
            }

            const duration = Date.now() - startTime;
            this.debugConfig.log(
                `Interaction completed in ${duration}ms`,
                'interaction',
                { ...interactionContext, duration },
                null,
                'debug'
            );

        } catch (error) {
            await this._handleInteractionError(interaction, error, { ...interactionContext, startTime });
        } finally {
            setTimeout(() => {
                this.interactionStates.delete(interactionKey);
            }, 30000);
        }
    }

    /**
     * Improved slash command handler with better validation.
     * @private
     */
    async _handleSlashCommand(interaction) {
        const command = this.client.commands.get(interaction.commandName);
        if (!command) {
            this.debugConfig.log(`Command not found: ${interaction.commandName}`, 'command', { user: interaction.user.tag }, null, 'warn');
            await this._safeReply(interaction, {
                content: '⚠️ Command not found. It might have been removed or is not properly deployed.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        if (typeof command.execute !== 'function') {
            this.debugConfig.log(`Command ${interaction.commandName} missing execute function`, 'command', { user: interaction.user.tag }, null, 'error');
            await this._safeReply(interaction, {
                content: '⚠️ This command is misconfigured. Please contact an administrator.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        if (this._isRateLimited(interaction.user.id, `command:${interaction.commandName}`)) {
            await this._safeReply(interaction, {
                content: '⏱️ You\'re using commands too quickly. Please wait a moment.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        try {
            await command.execute(interaction);
        } catch (error) {
            this.debugConfig.log(`Error in command ${interaction.commandName}`, 'command', { user: interaction.user.tag }, error, 'error');
            if (!interaction.replied && !interaction.deferred) {
                await this._safeErrorReply(interaction, '⚠️ An error occurred while executing this command.');
            }
        }
    }

    /**
     * Enhanced button interaction handler.
     * @private
     */
    async _handleButtonInteraction(interaction) {
        const customId = interaction.customId;
        this.debugConfig.log(`Button interaction: ${customId}`, 'interaction', { user: interaction.user.tag }, null, 'verbose');
        try {
            if (await this._handleSuggestionButtons(interaction)) return;
            if (await this._handleVerificationButtons(interaction)) return;
            if (await this._handleGotVerifiedButtons(interaction)) return;
            if (await this._handleSetupButtons(interaction)) return;
            await this._ensureDeferred(interaction);
            await interaction.editReply({
                content: '⚠️ This button interaction is no longer available or has expired.',
                components: []
            });
        } catch (error) {
            this.debugConfig.log(`Error in button handler: ${customId}`, 'interaction', { user: interaction.user.tag }, error, 'error');
            await this._safeErrorReply(interaction, '⚠️ An error occurred while processing this button.');
        }
    }

    /**
     * Handles verification-related buttons with improved error handling.
     * @private
     */
    async _handleVerificationButtons(interaction) {
        const customId = interaction.customId;
        if (customId.startsWith('verify_start_button_')) {
            return await this._handleVerifyStartButton(interaction);
        }
        if (customId.startsWith('confirm_otp_button_')) {
            return await this._handleConfirmOtpButton(interaction);
        }
        return false;
    }

    /**
     * Improved verify start button handler.
     * @private
     */
    async _handleVerifyStartButton(interaction) {
        const targetId = interaction.customId.replace('verify_start_button_', '');
        if (interaction.user.id !== targetId) {
            await this._safeReply(interaction, {
                content: '⚠️ This verification button is not for you. Please run `/verify` to start your own verification.',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }
        if (this._isRateLimited(interaction.user.id, 'verify_attempt', 3, 300000)) {
            await this._safeReply(interaction, {
                content: '⏱️ Too many verification attempts. Please wait 5 minutes before trying again.',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }
        const verifyCmd = this.client.commands.get('verify');
        if (!verifyCmd) {
            await this._safeReply(interaction, {
                content: '⚠️ Verification command not available. Please contact an administrator.',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }
        if (typeof verifyCmd.handleButtonInteraction !== 'function') {
            await this._safeReply(interaction, {
                content: '⚠️ Please use the `/verify` command directly.',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }
        try {
            await verifyCmd.handleButtonInteraction(interaction);
        } catch (error) {
            this.debugConfig.log('Error in verify button handler', 'interaction', { user: interaction.user.tag }, error, 'error');
            throw error;
        }
        return true;
    }

    /**
     * Handles confirm OTP button interactions.
     * @private
     */
    async _handleConfirmOtpButton(interaction) {
        const confirmOtpCmd = this.client.commands.get('confirmotp');
        if (!confirmOtpCmd || typeof confirmOtpCmd.handleButtonInteraction !== 'function') {
            await this._safeReply(interaction, {
                content: '⚠️ Please use the `/confirmotp` command directly.',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        try {
            await confirmOtpCmd.handleButtonInteraction(interaction);
        } catch (error) {
            this.debugConfig.log('Error in confirmOTP button handler', 'interaction', { user: interaction.user.tag }, error, 'error');
            if (!interaction.replied && !interaction.deferred) {
                await this._safeErrorReply(interaction, '⚠️ An error occurred with OTP confirmation.');
            }
        }
        return true;
    }

    /**
     * Handles suggestion-related buttons.
     * @private
     */
    async _handleSuggestionButtons(interaction) {
        const customId = interaction.customId;
        
        if (customId === 'confirm_suggestion' || customId === 'cancel_suggestion') {
            await this._ensureDeferred(interaction, true);
            return true;
        }
        if (customId.startsWith('suggest_vote_')) {
            await this._handleSuggestionVote(interaction);
            return true;
        }
        if (customId.startsWith('delete_suggestion_')) {
            await this._handleSuggestionDelete(interaction);
            return true;
        }
        return false;
    }

    /**
     * Handles gotverified pagination buttons.
     * @private
     */
    async _handleGotVerifiedButtons(interaction) {
        const customId = interaction.customId;
        if (!customId.startsWith('gotverified_')) return false;

        if (!interaction.member?.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            await this._safeReply(interaction, {
                content: '⚠️ You do not have permission to view this list.',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        await this._ensureDeferred(interaction, true);

        const parts = customId.split('_');
        const action = parts[1];
        let currentPage = parseInt(parts[2], 10);
        const originalUserId = parts[3];

        if (interaction.user.id !== originalUserId) {
            await interaction.editReply({
                content: '⚠️ You cannot control someone else\'s verification list.'
            });
            return true;
        }

        try {
            const allRows = await this._getVerifiedUsers(interaction.guild.id);
            if (action === 'next') currentPage++;
            if (action === 'prev') currentPage--;

            const { renderGotVerifiedPage } = await import('./commands/slash/gotVerified.js');
            const pageData = await renderGotVerifiedPage(interaction, allRows, currentPage, originalUserId);
            await interaction.editReply(pageData);
        } catch (error) {
            this.debugConfig.log('Error in gotverified pagination', 'interaction', { customId }, error, 'error');
            await interaction.editReply({
                content: '⚠️ Could not update the verified users list.',
                components: []
            });
        }
        return true;
    }

    /**
     * Handles setup buttons.
     * @private
     */
    async _handleSetupButtons(interaction) {
        const customId = interaction.customId;
        if (!customId.startsWith('confirm_setup_fsu_') && !customId.startsWith('cancel_setup_fsu_')) {
            return false;
        }

        if (!interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
            await this._safeErrorReply(interaction, 'You do not have permission to perform this action.');
            return true;
        }

        const setupFSUCommand = this.client.commands.get('setupfsu');
        if (!setupFSUCommand || typeof setupFSUCommand._performSetupLogic !== 'function') {
            await this._safeErrorReply(interaction, '⚠️ Setup command is not available.');
            return true;
        }

        try {
            if (customId.startsWith('confirm_setup_fsu_')) {
                await interaction.update({
                    content: '🔧 Beginning FSU server setup...',
                    components: [],
                    embeds: []
                });
                await setupFSUCommand._performSetupLogic(interaction);
            } else {
                await interaction.update({
                    content: '❌ FSU server setup cancelled.',
                    components: [],
                    embeds: []
                });
            }
        } catch (error) {
            this.debugConfig.log('Error in FSU setup button', 'interaction', { customId }, error, 'error');
            await this._safeErrorReply(interaction, '⚠️ An error occurred during setup.');
        }
        return true;
    }

    /**
     * Enhanced modal submit handler.
     * @private
     */
    async _handleModalSubmit(interaction) {
        const customId = interaction.customId;
        this.debugConfig.log(`Modal submission: ${customId}`, 'interaction', { user: interaction.user.tag }, null, 'verbose');

        try {
            if (await this._handleVerificationModals(interaction)) return;
            if (await this._handleSuggestionModals(interaction)) return;

            await this._safeReply(interaction, {
                content: '⚠️ This form submission is no longer valid.',
                flags: MessageFlags.Ephemeral
            });

        } catch (error) {
            this.debugConfig.log(`Error in modal handler: ${customId}`, 'interaction', { user: interaction.user.tag }, error, 'error');
            await this._safeErrorReply(interaction, '⚠️ An error occurred while processing your submission.');
        }
    }

    /**
     * Handles verification modals.
     * @private
     */
    async _handleVerificationModals(interaction) {
        const customId = interaction.customId;
        
        if (customId === 'verifyModal') {
            const verifyCmd = this.client.commands.get('verify');
            if (verifyCmd && typeof verifyCmd.handleModalSubmit === 'function') {
                await verifyCmd.handleModalSubmit(interaction);
            } else {
                await this._safeReply(interaction, {
                    content: '⚠️ Verification system temporarily unavailable.',
                    flags: MessageFlags.Ephemeral
                });
            }
            return true;
        }
        
        if (customId === 'confirmOtpModal') {
            const confirmOtpCmd = this.client.commands.get('confirmotp');
            if (confirmOtpCmd && typeof confirmOtpCmd.handleModalSubmit === 'function') {
                await confirmOtpCmd.handleModalSubmit(interaction);
            } else {
                await this._safeReply(interaction, {
                    content: '⚠️ OTP confirmation system temporarily unavailable.',
                    flags: MessageFlags.Ephemeral
                });
            }
            return true;
        }
        
        return false;
    }

    /**
     * Handles suggestion modals.
     * @private
     */
    async _handleSuggestionModals(interaction) {
        const customId = interaction.customId;
        
        if (customId.startsWith('deny_reason_modal_')) {
            const suggestionId = customId.split('_')[3];
            const reason = interaction.fields.getTextInputValue('denyReasonInput');
            await this._processSuggestionDenial(interaction, suggestionId, reason);
            return true;
        }
        
        if (customId.startsWith('delete_reason_modal_')) {
            const suggestionId = customId.split('_')[3];
            const reason = interaction.fields.getTextInputValue('deleteReasonInput');
            await this._processSuggestionDelete(interaction, suggestionId, reason);
            return true;
        }
        
        return false;
    }

    /**
     * Handles unknown interaction types.
     * @private
     */
    async _handleUnknownInteraction(interaction) {
        this.debugConfig.log(`Unknown interaction type: ${interaction.type}`, 'interaction', { 
            user: interaction.user.tag, 
            type: interaction.type 
        }, null, 'warn');
    }

    /**
     * Improved safe reply method with proper flag handling.
     * @private
     */
    async _safeReply(interaction, options) {
        // Convert ephemeral to flags if needed
        const replyOptions = { ...options };
        if (replyOptions.ephemeral !== undefined) {
            replyOptions.flags = replyOptions.ephemeral ? MessageFlags.Ephemeral : undefined;
            delete replyOptions.ephemeral;
        }

        try {
            if (interaction.replied) {
                await interaction.followUp(replyOptions);
            } else if (interaction.deferred) {
                await interaction.editReply(replyOptions);
            } else {
                await interaction.reply(replyOptions);
            }
        } catch (error) {
            this.debugConfig.log('Failed to send interaction response', 'interaction', {
                user: interaction.user?.tag,
                replied: interaction.replied,
                deferred: interaction.deferred,
                errorCode: error.code
            }, error, 'error');

            if (error.code === 10062) {
                this.debugConfig.log('Interaction expired', 'interaction', { user: interaction.user?.tag }, null, 'warn');
                return;
            }

            if (error.code === 40060) {
                this.debugConfig.log('Interaction already acknowledged', 'interaction', { user: interaction.user?.tag }, null, 'warn');
                return;
            }
            if (!interaction.replied) {
                try {
                    await interaction.followUp({
                        content: '⚠️ There was an error processing your request.',
                        flags: MessageFlags.Ephemeral
                    });
                } catch (followUpError) {
                    this.debugConfig.log('Failed followUp attempt', 'interaction', { user: interaction.user?.tag }, followUpError, 'error');
                }
            }
        }
    }

    /**
     * Safe error reply method.
     * @private
     */
    async _safeErrorReply(interaction, message) {
        const options = {
            content: message,
            flags: MessageFlags.Ephemeral,
            components: [],
            embeds: []
        };

        try {
            if (interaction.replied) {
                await interaction.followUp(options);
            } else if (interaction.deferred) {
                await interaction.editReply(options);
            } else {
                await interaction.reply(options);
            }
        } catch (error) {
            if (error.code !== 10062 && error.code !== 40060) {
                this.debugConfig.log('Failed to send error reply', 'interaction', { user: interaction.user?.tag }, error, 'error');
            }
        }
    }

    /**
     * Ensures interaction is deferred with proper error handling.
     * @private
     */
    async _ensureDeferred(interaction, update = false) {
        if (interaction.replied || interaction.deferred) {
            return true;
        }

        try {
            if (update) {
                await interaction.deferUpdate();
            } else {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            }
            return true;
        } catch (error) {
            if (error.code === 10062) {
                this.debugConfig.log('Interaction expired before deferring', 'interaction', { 
                    customId: interaction.customId,
                    type: interaction.type 
                }, null, 'warn');
                return false;
            }
            
            if (error.code === 40060) {
                this.debugConfig.log('Interaction already acknowledged', 'interaction', { 
                    customId: interaction.customId,
                    type: interaction.type 
                }, null, 'warn');
                return true;
            }
            
            throw error;
        }
    }

    /**
     * Enhanced interaction error handler.
     * @private
     */
    async _handleInteractionError(interaction, error, context = {}) {
        const duration = Date.now() - (context.startTime || Date.now());
        let errorType = 'unknown';
        if (error.code === 10062) errorType = 'expired';
        else if (error.code === 40060) errorType = 'already_acknowledged';
        else if (error.code === 50013) errorType = 'missing_permissions';
        else if (error.name === 'TypeError') errorType = 'type_error';

        this.debugConfig.log('Interaction error', 'interaction', {
            ...context,
            duration,
            errorName: error.name,
            errorCode: error.code,
            errorType
        }, error, 'error');
        if (error.code === 10062 || error.code === 40060) {
            return;
        }
        if (!interaction.replied && !interaction.deferred) {
            await this._safeErrorReply(interaction, '⚠️ An unexpected error occurred. Please try again later.');
        }
    }

    /**
     * Rate limiting implementation.
     * @private
     */
    _isRateLimited(userId, action, limit = 5, window = 60000) {
        const key = `${userId}:${action}`;
        const now = Date.now();
        const userActions = this.rateLimitMap.get(key) || [];
        const recentActions = userActions.filter(time => now - time < window);
        if (recentActions.length >= limit) {
            return true;
        }
        recentActions.push(now);
        this.rateLimitMap.set(key, recentActions);
        if (Math.random() < 0.01) {
            this._cleanupRateLimitMap();
        }

        return false;
    }

    /**
     * Cleans up expired rate limit entries.
     * @private
     */
    _cleanupRateLimitMap() {
        const now = Date.now();
        const maxAge = 300000;
        for (const [key, actions] of this.rateLimitMap.entries()) {
            const recentActions = actions.filter(time => now - time < maxAge);
            if (recentActions.length === 0) {
                this.rateLimitMap.delete(key);
            } else {
                this.rateLimitMap.set(key, recentActions);
            }
        }
    }

    /**
     * Gets verified users from database.
     * @private
     */
    async _getVerifiedUsers(guildId) {
        return new Promise((resolve, reject) => {
            this.client.db.all(
                `SELECT user_id, real_name, email FROM verified_users WHERE guild_id = ? ORDER BY real_name ASC`,
                [guildId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }
    /**
     * Enhanced voice state update handler.
     * @private
     */
    async _onVoiceStateUpdate(oldState, newState) {
        const userId = newState.member.id;
        const guildId = newState.guild.id;
        const currentTime = Date.now();

        const userLeft = oldState.channelId && !newState.channelId;
        const userMoved = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;
        const userJoined = !oldState.channelId && newState.channelId;
        if (userLeft || userMoved) {
            const session = this.voiceStates.get(userId);
            if (session) {
                const durationMs = currentTime - session.joinTime;
                const durationMinutes = Math.floor(durationMs / (1000 * 60));

                if (durationMinutes > 0) {
                    this.client.db.run(
                        `INSERT INTO user_stats (user_id, guild_id, messages_sent, voice_time_minutes) VALUES (?, ?, 0, ?)
                         ON CONFLICT(user_id, guild_id) DO UPDATE SET voice_time_minutes = voice_time_minutes + ?`,
                        [userId, guildId, durationMinutes, durationMinutes],
                        (err) => {
                            if (err) {
                                this.debugConfig.log('Error updating voice time:', 'event', null, err, 'error');
                            } else {
                                this.debugConfig.log(`Updated voice time for ${oldState.member.user.tag}: ${durationMinutes} minutes`, 'event');
                            }
                        }
                    );
                }

                this.voiceStates.delete(userId);
                this.client.db.run(`DELETE FROM active_voice_sessions WHERE user_id = ? AND guild_id = ?`, [userId, guildId]);
            }
        }
        if (userJoined || userMoved) {
            this.voiceStates.set(userId, {
                guildId,
                channelId: newState.channelId,
                joinTime: currentTime
            });

            this.client.db.run(
                `INSERT OR REPLACE INTO active_voice_sessions (user_id, guild_id, channel_id, join_time) VALUES (?, ?, ?, ?)`,
                [userId, guildId, newState.channelId, currentTime],
                (err) => {
                    if (err) {
                        this.debugConfig.log('Error inserting voice session:', 'event', null, err, 'error');
                    } else {
                        this.debugConfig.log(`${newState.member.user.tag} joined ${newState.channel.name}`, 'event');
                    }
                }
            );
        }
    }

    /**
     * Enhanced message create handler.
     * @private
     */
    async _onMessageCreate(message) {
        if (message.author.bot || !message.guild) return;

        try {
            await Promise.all([
                this._handleAntiSpam(message),
                this._updateUserMessageStats(message)
            ]);
        } catch (error) {
            this.debugConfig.log('Error in message create handler', 'event', { messageId: message.id }, error, 'error');
        }
    }

    /**
     * Enhanced guild member add handler.
     * @private
     */
    async _onGuildMemberAdd(member) {
        if (member.user.bot) return;

        this.debugConfig.log(`User ${member.user.tag} joined ${member.guild.name}`, 'event', {
            user: member.user.id,
            guild: member.guild.id
        });

        try {
            const userAvatar = member.user.displayAvatarURL({ dynamic: true, size: 128 });
            const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
            const verifiedRow = await new Promise((resolve, reject) => {
                this.client.db.get(
                    `SELECT user_id FROM verified_users WHERE user_id = ? AND guild_id = ?`,
                    [member.user.id, member.guild.id],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });

            let dmEmbed;
            let dmComponents = [];

            if (verifiedRow) {
                if (VERIFIED_ROLE_ID) {
                    const verifiedRole = member.guild.roles.cache.get(VERIFIED_ROLE_ID);
                    if (verifiedRole) {
                        try {
                            await member.roles.add(verifiedRole);
                            this.debugConfig.log(`Re-assigned verified role to ${member.user.tag}`, 'event', null, null, 'success');
                        } catch (roleErr) {
                            this.debugConfig.log('Failed to re-assign verified role', 'event', null, roleErr, 'error');
                        }
                    }
                }

                dmEmbed = new EmbedBuilder()
                    .setColor(this.colors.success)
                    .setTitle(`👋 Welcome Back to ${member.guild.name}!`)
                    .setDescription(`Great to see you again, **${member.user.username}**! You've been automatically re-verified.`)
                    .setThumbnail(userAvatar)
                    .setTimestamp();
            } else {
                const verifyButton = new ButtonBuilder()
                    .setCustomId(`verify_start_button_${member.user.id}`)
                    .setLabel('Verify Your Account')
                    .setStyle(ButtonStyle.Primary);

                dmComponents = [new ActionRowBuilder().addComponents(verifyButton)];

                dmEmbed = new EmbedBuilder()
                    .setColor(this.colors.primary)
                    .setTitle(`👋 Welcome to ${member.guild.name}!`)
                    .setDescription('To gain full access, please click the button below to start verification.')
                    .setThumbnail(userAvatar)
                    .setTimestamp();
            }
            try {
                await member.send({ embeds: [dmEmbed], components: dmComponents });
                this.debugConfig.log(`Sent welcome DM to ${member.user.tag}`, 'event');
            } catch (dmErr) {
                this.debugConfig.log('Could not send welcome DM', 'event', { user: member.user.tag }, dmErr, 'warn');
            }
            const guildConfig = await new Promise((resolve) => {
                this.client.db.get(
                    `SELECT welcome_channel_id, welcome_message_content FROM guild_configs WHERE guild_id = ?`,
                    [member.guild.id],
                    (err, row) => resolve(row)
                );
            });

            if (guildConfig && guildConfig.welcome_channel_id) {
                const channel = member.guild.channels.cache.get(guildConfig.welcome_channel_id);
                if (channel && (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)) {
                    const publicWelcomeEmbed = new EmbedBuilder()
                        .setColor(this.colors.success)
                        .setDescription(`Please give a warm welcome to ${member}!`)
                        .setThumbnail(userAvatar)
                        .setFooter({ text: `Member Count: ${member.guild.memberCount}` })
                        .setTimestamp();

                    await channel.send({ embeds: [publicWelcomeEmbed] });
                }
            }
        } catch (error) {
            this.debugConfig.log('Error in guild member add handler', 'event', { user: member.user.id }, error, 'error');
        }
    }

    /**
     * Guild member remove handler.
     * @private
     */
    async _onGuildMemberRemove(member) {
        if (member.user.bot) return;

        this.debugConfig.log(`User ${member.user.tag} left ${member.guild.name}`, 'event', {
            user: member.user.id,
            guild: member.guild.id
        });

        try {
            const guildConfig = await new Promise((resolve) => {
                this.client.db.get(
                    `SELECT farewell_channel_id FROM guild_configs WHERE guild_id = ?`,
                    [member.guild.id],
                    (err, row) => resolve(row)
                );
            });

            const farewellChannelId = guildConfig?.farewell_channel_id || process.env.FAREWELL_CHANNEL_ID;
            if (farewellChannelId) {
                const channel = member.guild.channels.cache.get(farewellChannelId);
                if (channel && (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)) {
                    const farewellEmbed = new EmbedBuilder()
                        .setColor(this.colors.error)
                        .setDescription(`👋 **${member.user.tag}** has left the server.`)
                        .setTimestamp();

                    await channel.send({ embeds: [farewellEmbed] });
                }
            }
        } catch (error) {
            this.debugConfig.log('Error in farewell message', 'event', { user: member.user.id }, error, 'error');
        }
    }

    /**
     * Enhanced reaction add handler.
     * @private
     */
    async _onMessageReactionAdd(reaction, user) {
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                this.debugConfig.log('Error fetching partial reaction', 'event', null, error, 'error');
                return;
            }
        }

        if (user.bot || !reaction.message.guild) return;

        try {
            const reactionRole = await new Promise((resolve) => {
                this.client.db.get(
                    `SELECT role_id FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?`,
                    [reaction.message.guild.id, reaction.message.id, reaction.emoji.name],
                    (err, row) => resolve(row)
                );
            });

            if (reactionRole) {
                const member = reaction.message.guild.members.cache.get(user.id);
                const role = reaction.message.guild.roles.cache.get(reactionRole.role_id);
                
                if (member && role && !member.roles.cache.has(role.id)) {
                    await member.roles.add(role, 'Reaction role assignment');
                }
            }
            const SUGGESTIONS_CHANNEL_ID = process.env.SUGGESTIONS_CHANNEL_ID;
            if (reaction.message.channel.id === SUGGESTIONS_CHANNEL_ID && ['👍', '👎'].includes(reaction.emoji.name)) {
                await this._updateSuggestionVotes(reaction.message);
            }
        } catch (error) {
            this.debugConfig.log('Error in reaction add handler', 'event', { messageId: reaction.message.id }, error, 'error');
        }
    }

    /**
     * Enhanced reaction remove handler.
     * @private
     */
    async _onMessageReactionRemove(reaction, user) {
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                this.debugConfig.log('Error fetching partial reaction', 'event', null, error, 'error');
                return;
            }
        }

        if (user.bot || !reaction.message.guild) return;

        try {
            const reactionRole = await new Promise((resolve) => {
                this.client.db.get(
                    `SELECT role_id FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?`,
                    [reaction.message.guild.id, reaction.message.id, reaction.emoji.name],
                    (err, row) => resolve(row)
                );
            });

            if (reactionRole) {
                const member = reaction.message.guild.members.cache.get(user.id);
                const role = reaction.message.guild.roles.cache.get(reactionRole.role_id);
                
                if (member && role && member.roles.cache.has(role.id)) {
                    await member.roles.remove(role, 'Reaction role removal');
                }
            }
            const SUGGESTIONS_CHANNEL_ID = process.env.SUGGESTIONS_CHANNEL_ID;
            if (reaction.message.channel.id === SUGGESTIONS_CHANNEL_ID && ['👍', '👎'].includes(reaction.emoji.name)) {
                await this._updateSuggestionVotes(reaction.message);
            }
        } catch (error) {
            this.debugConfig.log('Error in reaction remove handler', 'event', { messageId: reaction.message.id }, error, 'error');
        }
    }

    // ===================================================================================
    // == HELPER METHODS ==================================================================
    // ===================================================================================

    /**
     * Updates suggestion votes based on reactions.
     * @private
     */
    async _updateSuggestionVotes(message) {
        if (!message || !message.guild) return;

        try {
            const upvotes = message.reactions.cache.get('👍')?.count || 0;
            const downvotes = message.reactions.cache.get('👎')?.count || 0;

            const suggestion = await new Promise((resolve, reject) => {
                this.client.db.get(
                    `SELECT id FROM suggestions WHERE message_id = ? AND guild_id = ?`,
                    [message.id, message.guild.id],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });

            if (suggestion) {
                await new Promise((resolve, reject) => {
                    this.client.db.run(
                        `UPDATE suggestions SET upvotes = ?, downvotes = ? WHERE id = ?`,
                        [upvotes, downvotes, suggestion.id],
                        (err) => {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });

                if (message.embeds[0]) {
                    const updatedEmbed = EmbedBuilder.from(message.embeds[0])
                        .setFooter({ text: `Suggestion ID: ${suggestion.id} | Votes: 👍 ${upvotes} / 👎 ${downvotes}` });
                    
                    await message.edit({ embeds: [updatedEmbed] });
                }
            }
        } catch (error) {
            this.debugConfig.log('Error updating suggestion votes', 'event', { messageId: message.id }, error, 'error');
        }
    }

    /**
     * Enhanced anti-spam handler.
     * @private
     */
    async _handleAntiSpam(message) {
        const userId = message.author.id;
        const guildId = message.guild.id;

        try {
            const config = await new Promise((resolve) => {
                this.client.db.get(
                    `SELECT message_limit, time_window_seconds, mute_duration_seconds, kick_threshold, ban_threshold 
                     FROM anti_spam_configs WHERE guild_id = ?`,
                    [guildId],
                    (err, row) => resolve(row)
                );
            });

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
                    timer: setTimeout(() => this.spamMap.delete(userId), time_window_seconds * 1000)
                });
            } else {
                const userData = this.spamMap.get(userId);
                userData.count++;
                clearTimeout(userData.timer);
                userData.timer = setTimeout(() => this.spamMap.delete(userId), time_window_seconds * 1000);

                if (userData.count > message_limit) {
                    this.spamWarnings.set(userId, (this.spamWarnings.get(userId) || 0) + 1);
                    const currentWarnings = this.spamWarnings.get(userId);
                    if (message.channel.permissionsFor(this.client.user).has(PermissionsBitField.Flags.ManageMessages)) {
                        await message.channel.bulkDelete(Math.min(userData.count, 100), true);
                    }
                    if (currentWarnings >= ban_threshold && message.member?.bannable) {
                        await message.member.ban({ reason: `Anti-spam: ${currentWarnings} warnings.` });
                        await message.channel.send(`🚨 ${message.author.tag} has been banned for repeated spamming.`);
                        this.spamWarnings.delete(userId);
                    } else if (currentWarnings >= kick_threshold && message.member?.kickable) {
                        await message.member.kick(`Anti-spam: ${currentWarnings} warnings.`);
                        await message.channel.send(`⚠️ ${message.author.tag} has been kicked for excessive spamming.`);
                    } else if (message.member?.moderatable) {
                        await message.member.timeout(mute_duration_seconds * 1000, 'Anti-spam mute');
                        await message.channel.send(`🔇 ${message.author.tag} has been timed out for spamming. (Warning ${currentWarnings}/${kick_threshold})`);
                    }

                    this.spamMap.delete(userId);
                }
            }
        } catch (error) {
            this.debugConfig.log('Error in anti-spam handler', 'event', { userId, guildId }, error, 'error');
        }
    }

    /**
     * Updates user message statistics.
     * @private
     */
    async _updateUserMessageStats(message) {
        const userId = message.author.id;
        const guildId = message.guild.id;
        const now = Date.now();

        this.client.db.run(
            `INSERT INTO user_stats (user_id, guild_id, messages_sent, last_message_at) VALUES (?, ?, 1, ?)
             ON CONFLICT(user_id, guild_id) DO UPDATE SET messages_sent = messages_sent + 1, last_message_at = ?`,
            [userId, guildId, now, now],
            (err) => {
                if (err) {
                    this.debugConfig.log('Error updating message stats', 'event', { userId }, err, 'error');
                }
            }
        );
    }

    /**
     * Placeholder for suggestion vote handling.
     * @private
     */
    async _handleSuggestionVote(interaction) {
        await this._safeReply(interaction, {
            content: 'Your vote has been registered via reaction! Use 👍 or 👎 on the message itself.',
            flags: MessageFlags.Ephemeral
        });
    }

    /**
     * Handles suggestion deletion.
     * @private
     */
    async _handleSuggestionDelete(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
            await this._safeReply(interaction, {
                content: '⚠️ You do not have permission to delete suggestions.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const suggestionId = interaction.customId.split('_')[2];
        const modal = new ModalBuilder()
            .setCustomId(`delete_reason_modal_s_${suggestionId}`)
            .setTitle('Delete Suggestion');

        const reasonInput = new TextInputBuilder()
            .setCustomId('deleteReasonInput')
            .setLabel('Reason for deleting this suggestion:')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        await interaction.showModal(modal);
    }

    /**
     * Processes suggestion denial.
     * @private
     */
    async _processSuggestionDenial(interaction, suggestionId, reason) {
        try {
            const suggestionRow = await new Promise((resolve, reject) => {
                this.client.db.get(
                    `SELECT message_id, user_id FROM suggestions WHERE id = ?`,
                    [suggestionId],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });

            if (!suggestionRow) {
                return this._safeErrorReply(interaction, `⚠️ Suggestion with ID \`${suggestionId}\` not found.`);
            }

            await new Promise((resolve, reject) => {
                this.client.db.run(
                    `UPDATE suggestions SET status = 'denied', reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`,
                    [reason, interaction.user.id, Date.now(), suggestionId],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
            const suggestionsChannel = this.client.channels.cache.get(process.env.SUGGESTIONS_CHANNEL_ID);
            const message = await suggestionsChannel?.messages.fetch(suggestionRow.message_id).catch(() => null);
            
            if (message?.embeds[0]) {
                const updatedEmbed = EmbedBuilder.from(message.embeds[0])
                    .setColor(this.colors.error)
                    .addFields({ name: 'Status', value: `Denied by ${interaction.user.tag}\n**Reason:** ${reason}` });
                
                await message.edit({ embeds: [updatedEmbed], components: [] });
            }
            await this._safeReply(interaction, {
                content: `✅ Suggestion \`${suggestionId}\` has been denied.`,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            this.debugConfig.log('Error processing suggestion denial', 'interaction', { suggestionId }, error, 'error');
            await this._safeErrorReply(interaction, `⚠️ An error occurred while denying suggestion \`${suggestionId}\`.`);
        }
    }

    /**
     * Processes suggestion deletion.
     * @private
     */
    async _processSuggestionDelete(interaction, suggestionId, reason) {
        try {
            const suggestionRow = await new Promise((resolve, reject) => {
                this.client.db.get(
                    `SELECT message_id, user_id FROM suggestions WHERE id = ?`,
                    [suggestionId],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });
            if (!suggestionRow) {
                return this._safeErrorReply(interaction, `⚠️ Suggestion with ID \`${suggestionId}\` not found.`);
            }
            await new Promise((resolve, reject) => {
                this.client.db.run(
                    `DELETE FROM suggestions WHERE id = ?`,
                    [suggestionId],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
            const suggestionsChannel = this.client.channels.cache.get(process.env.SUGGESTIONS_CHANNEL_ID);
            const message = await suggestionsChannel?.messages.fetch(suggestionRow.message_id).catch(() => null);
            
            if (message) {
                await message.delete(`Deleted by ${interaction.user.tag}. Reason: ${reason}`);
            }
            await this._safeReply(interaction, {
                content: `✅ Suggestion \`${suggestionId}\` has been deleted.`,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            this.debugConfig.log('Error processing suggestion deletion', 'interaction', { suggestionId }, error, 'error');
            await this._safeErrorReply(interaction, `⚠️ An error occurred while deleting suggestion \`${suggestionId}\`.`);
        }
    }

    /**
     * Sets up all scheduled jobs with better error handling.
     * @private
     */
    _scheduleJobs() {
        try {
            // Birthday announcements
            schedule.scheduleJob('0 0 * * *', async () => {
                this.debugConfig.log('Running daily birthday announcement...', 'scheduler');
                try {
                    await this._announceBirthdays();
                } catch (error) {
                    this.debugConfig.log('Error in birthday announcement job', 'scheduler', null, error, 'error');
                }
            });
            this.debugConfig.log('Scheduled daily birthday announcements for 12 AM.', 'scheduler');

            // RSS polling
            const RSS_POLL_INTERVAL_MINUTES = parseInt(process.env.RSS_POLL_INTERVAL_MINUTES || '5');
            if (RSS_POLL_INTERVAL_MINUTES > 0) {
                schedule.scheduleJob(`*/${RSS_POLL_INTERVAL_MINUTES} * * * *`, async () => {
                    this.debugConfig.log('Running RSS feed poll...', 'scheduler');
                    try {
                        await pollFeeds(this.client);
                    } catch (error) {
                        this.debugConfig.log('Error in RSS polling job', 'scheduler', null, error, 'error');
                    }
                });
                this.debugConfig.log(`Scheduled RSS feed polling every ${RSS_POLL_INTERVAL_MINUTES} minutes.`, 'scheduler');
            } else {
                this.debugConfig.log('RSS polling disabled.', 'scheduler', null, null, 'warn');
            }

            // Notice checking
            const NOTICE_CHECK_INTERVAL_MS = parseInt(process.env.NOTICE_CHECK_INTERVAL_MS || '1800000');
            if (NOTICE_CHECK_INTERVAL_MS > 0) {
                this.debugConfig.log(`Initializing notice checking. Interval: ${NOTICE_CHECK_INTERVAL_MS / 1000} seconds.`, 'scheduler');
                this._checkAndAnnounceNotices();
                setInterval(() => {
                    this._checkAndAnnounceNotices().catch(error => {
                        this.debugConfig.log('Error in notice checking job', 'scheduler', null, error, 'error');
                    });
                }, NOTICE_CHECK_INTERVAL_MS);
                this.debugConfig.log(`Scheduled notice checking every ${NOTICE_CHECK_INTERVAL_MS / 60000} minutes.`, 'scheduler');
            } else {
                this.debugConfig.log('Notice scraping disabled.', 'scheduler', null, null, 'warn');
            }

            this.debugConfig.log('All scheduled jobs set up successfully.', 'scheduler');
        } catch (error) {
            this.debugConfig.log('Error setting up scheduled jobs', 'scheduler', null, error, 'error');
        }
    }

    /**
     * Enhanced notice checking - delegates to the enhanced processor
     * @private
     */
    async _checkAndAnnounceNotices() {
        try {
            if (!this.noticeProcessor) {
                this.debugConfig.log('NoticeProcessor not initialized yet, skipping notice check', 'scheduler', null, null, 'warn');
                return;
            }

            if (!this.client || !this.client.isReady()) {
                this.debugConfig.log('Discord client not ready, skipping notice check', 'scheduler', null, null, 'warn');
                return;
            }

            await this.noticeProcessor.checkAndAnnounceNotices();
        } catch (error) {
            this.debugConfig.log('Error in enhanced notice processing', 'scheduler', null, error, 'error');
            
            const NOTICE_ADMIN_CHANNEL_ID = process.env.NOTICE_ADMIN_CHANNEL_ID;
            if (NOTICE_ADMIN_CHANNEL_ID && NOTICE_ADMIN_CHANNEL_ID !== 'YOUR_NOTICE_ADMIN_CHANNEL_ID_HERE') {
                try {
                    const adminChannel = await this.client.channels.fetch(NOTICE_ADMIN_CHANNEL_ID);
                    await adminChannel?.send(`🚨 **Critical Notice Processing Error:**\n\`\`\`${error.message}\`\`\``);
                } catch (adminError) {
                    this.debugConfig.log('Could not send admin notification', 'scheduler', null, adminError, 'warn');
                }
            }
        }
    }

    /**
     * Processes PDF attachments by converting to images.
     * @private
     */
    async _processPDFAttachment(fileName, tempFilePath, tempDir, allFiles, tempFilesOnDisk) {
        const MAX_PDF_PAGES_TO_CONVERT = Infinity;
        
        try {
            let totalPdfPages = 0;
            
            // Get PDF page count
            try {
                const pdfBuffer = await fsPromises.readFile(tempFilePath);
                const uint8Array = new Uint8Array(pdfBuffer);
                const loadingTask = getDocument({ data: uint8Array });
                const pdfDocument = await loadingTask.promise;
                totalPdfPages = pdfDocument.numPages;
                this.debugConfig.log(`PDF ${fileName} has ${totalPdfPages} pages`, 'scheduler', null, null, 'verbose');
            } catch (pdfjsError) {
                this.debugConfig.log('Could not get PDF page count', 'scheduler', null, pdfjsError, 'warn');
                totalPdfPages = MAX_PDF_PAGES_TO_CONVERT;
            }

            // Convert PDF to images
            const pdfConvertOptions = {
                density: 150,
                quality: 90,
                height: 1754,
                width: 1240,
                format: "png",
                saveFilename: path.parse(fileName).name,
                savePath: tempDir
            };

            const convert = fromPath(tempFilePath, pdfConvertOptions);
            const pagesToConvert = Math.min(totalPdfPages, MAX_PDF_PAGES_TO_CONVERT);
            let pageConvertedCount = 0;

            for (let pageNum = 1; pageNum <= pagesToConvert; pageNum++) {
                try {
                    const convertResponse = await convert(pageNum);
                    if (convertResponse?.path) {
                        const pngFilePath = convertResponse.path;
                        const pngFileName = path.basename(pngFilePath);
                        tempFilesOnDisk.push(pngFilePath);
                        allFiles.push(new AttachmentBuilder(pngFilePath, { name: pngFileName }));
                        pageConvertedCount++;
                        this.debugConfig.log(`Converted PDF page ${pageNum} to PNG`, 'scheduler', null, null, 'verbose');
                    } else {
                        this.debugConfig.log(`No valid response for PDF page ${pageNum}`, 'scheduler', null, null, 'warn');
                        break;
                    }
                } catch (pageError) {
                    this.debugConfig.log(`Could not convert PDF page ${pageNum}`, 'scheduler', null, pageError, 'warn');
                    if (pageError.message.includes('does not exist') || pageError.message.includes('invalid page number')) {
                        break;
                    }
                }
            }

            if (pageConvertedCount === 0) {
                this.debugConfig.log(`No pages converted for PDF ${fileName}. Sending original.`, 'scheduler', null, null, 'warn');
                allFiles.push(new AttachmentBuilder(tempFilePath, { name: fileName }));
            } else {
                this.debugConfig.log(`Converted ${pageConvertedCount} of ${totalPdfPages} pages from ${fileName}`, 'scheduler');
            }

        } catch (pdfProcessError) {
            this.debugConfig.log(`Error processing PDF ${fileName}`, 'scheduler', null, pdfProcessError, 'error');
            allFiles.push(new AttachmentBuilder(tempFilePath, { name: fileName }));
        }
    }

    /**
     * Sends notice with attachments, chunking if necessary.
     * @private
     */
    async _sendNoticeWithAttachments(noticeChannel, embed, attachments, noticeTitle) {
        const ATTACHMENT_LIMIT = 10;
        
        if (attachments.length === 0) {
            await noticeChannel.send({ embeds: [embed] });
            this.debugConfig.log(`Sent notice without attachments: ${noticeTitle}`, 'scheduler');
            return;
        }

        let sentFirstMessage = false;
        
        for (let i = 0; i < attachments.length; i += ATTACHMENT_LIMIT) {
            const chunk = attachments.slice(i, i + ATTACHMENT_LIMIT);
            
            try {
                if (!sentFirstMessage) {
                    await noticeChannel.send({ embeds: [embed], files: chunk });
                    sentFirstMessage = true;
                } else {
                    await noticeChannel.send({
                        content: `(Continued attachments for "${noticeTitle}")`,
                        files: chunk
                    });
                }
                
                this.debugConfig.log(`Sent chunk of ${chunk.length} attachments for "${noticeTitle}"`, 'scheduler');
            } catch (sendError) {
                this.debugConfig.log(`Error sending notice chunk ${i / ATTACHMENT_LIMIT + 1}`, 'scheduler', null, sendError, 'error');
                throw sendError; // Re-throw to be handled by caller
            }
        }
    }

    /**
     * Enhanced birthday announcement system.
     * @private
     */
    async _announceBirthdays() {
        this.debugConfig.log('Checking for birthdays...', 'scheduler');
        const BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID = process.env.BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID;
        
        if (!BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID) {
            this.debugConfig.log('Birthday announcement channel not configured', 'scheduler', null, null, 'warn');
            return;
        }

        let announcementChannel;
        try {
            announcementChannel = await this.client.channels.fetch(BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID);
            if (!announcementChannel) {
                this.debugConfig.log('Birthday announcement channel not found', 'scheduler', { channelId: BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID }, null, 'error');
                return;
            }
        } catch (error) {
            this.debugConfig.log('Error fetching birthday channel', 'scheduler', null, error, 'error');
            return;
        }

        const today = new Date();
        const currentMonth = today.getMonth() + 1;
        const currentDay = today.getDate();

        for (const [, guild] of this.client.guilds.cache) {
            try {
                const birthdays = await new Promise((resolve, reject) => {
                    this.client.db.all(
                        `SELECT user_id, year FROM birthdays WHERE guild_id = ? AND month = ? AND day = ?`,
                        [guild.id, currentMonth, currentDay],
                        (err, rows) => {
                            if (err) reject(err);
                            else resolve(rows || []);
                        }
                    );
                });
                if (birthdays.length === 0) continue;
                const birthdayUsers = [];
                for (const birthday of birthdays) {
                    try {
                        const member = await guild.members.fetch(birthday.user_id);
                        const ageString = birthday.year ? ` (turning ${today.getFullYear() - birthday.year})` : '';
                        birthdayUsers.push(`• ${member}${ageString}`);
                    } catch (memberError) {
                        birthdayUsers.push(`• Unknown User (ID: ${birthday.user_id})`);
                        this.debugConfig.log(`Could not fetch member for birthday: ${birthday.user_id}`, 'scheduler', null, memberError, 'warn');
                    }
                }

                if (birthdayUsers.length > 0) {
                    const birthdayEmbed = new EmbedBuilder()
                        .setColor('#FFD700')
                        .setTitle('🎂 Happy Birthday!')
                        .setDescription(`🎉 Wishing a very happy birthday to:\n\n${birthdayUsers.join('\n')}`)
                        .setTimestamp();

                    await announcementChannel.send({ embeds: [birthdayEmbed] });
                    this.debugConfig.log(`Sent birthday announcement for ${birthdayUsers.length} users in ${guild.name}`, 'scheduler');
                }
            } catch (error) {
                this.debugConfig.log(`Error processing birthdays for guild ${guild.id}`, 'scheduler', { guildId: guild.id }, error, 'error');
            }
        }
    }

    /**
     * Starts the bot
     */
    async start() {
        this.debugConfig.log('Starting bot...', 'init');
        
        try {
            await writeServiceAccountKey();
            await this.client.login(this.token);
            this.debugConfig.log('Bot started successfully', 'init', null, null, 'success');
        } catch (error) {
            this.debugConfig.log('Failed to start bot', 'init', null, error, 'error');
            console.error('Critical startup error:', error);
            process.exit(1);
        }
    }

    /**
     * Graceful shutdown handler.
     */
    async shutdown() {
        this.debugConfig.log('Initiating bot shutdown...', 'shutdown');
        
        try {
            schedule.gracefulShutdown();
            if (this.client.db) {
                this.client.db.close();
            }
            this.client.destroy();
            this.debugConfig.log('Bot shutdown completed', 'shutdown', null, null, 'success');
        } catch (error) {
            this.debugConfig.log('Error during shutdown', 'shutdown', null, error, 'error');
        }
    }
}

async function main() {
    try {
        debugConfig.log('Initializing application...', 'init');
        const requiredEnvVars = ['BOT_TOKEN', 'CLIENT_ID'];
        const missing = requiredEnvVars.filter(varName => !process.env[varName]);
        if (missing.length > 0) {
            throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
        }
        const database = await initializeDatabase();
        debugConfig.log('Database initialized successfully', 'init');
        const bot = new PulchowkBot(process.env.BOT_TOKEN, database);
        process.on('SIGINT', async () => {
            debugConfig.log('Received SIGINT signal, shutting down gracefully...', 'shutdown');
            await bot.shutdown();
            process.exit(0);
        });
        process.on('SIGTERM', async () => {
            debugConfig.log('Received SIGTERM signal, shutting down gracefully...', 'shutdown');
            await bot.shutdown();
            process.exit(0);
        });
        await bot.start();
    } catch (error) {
        debugConfig.log('Critical application error', 'init', null, error, 'error');
        console.error('Application failed to start:', error);
        process.exit(1);
    }
}

main();

export default PulchowkBot;