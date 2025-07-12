import { Client, Collection, IntentsBitField, EmbedBuilder, PermissionsBitField, ChannelType, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, Events } from 'discord.js';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v9'; // Or v10, depending on your discord.js version
import dotenv from 'dotenv';
import schedule from 'node-schedule';
import { initializeDatabase, db } from './database.js';
import { emailService } from './services/emailService.js';
import { scrapeLatestNotice } from './services/scraper.js';
import { initializeGoogleCalendarClient } from './commands/slash/holidays.js';

import { promises as fsPromises, createWriteStream } from 'fs';
import path from 'path';
import axios from 'axios';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

dotenv.config();

class PulchowkBot {
    constructor(token, dbInstance) {
        this.token = token;
        this.db = dbInstance;
        this.client = new Client({
            intents: [
                IntentsBitField.Flags.Guilds,
                IntentsBitField.Flags.GuildMembers,
                IntentsBitField.Flags.GuildMessages,
                IntentsBitField.Flags.MessageContent,
                IntentsBitField.Flags.GuildVoiceStates,
                IntentsBitField.Flags.GuildMessageReactions,
                IntentsBitField.Flags.DirectMessages,
            ],
            partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember, Partials.User],
        });
        this.client.db = this.db;
        this.client.commands = new Collection();
        this.spamMap = new Map();
        this.spamWarnings = new Map();
        this.voiceStates = new Map();

        this._setupEventListeners();
    }

    async _setupEventListeners() {
        this.client.once('ready', () => this._onReady());
        this.client.on(Events.InteractionCreate, (interaction) => this._onInteractionCreate(interaction));
        this.client.on('messageCreate', (message) => this._onMessageCreate(message)); 
        this.client.on('guildMemberAdd', (member) => this._onGuildMemberAdd(member));
        this.client.on('messageReactionAdd', (reaction, user) => this._onMessageReactionAdd(reaction, user));
        this.client.on('messageReactionRemove', (reaction, user) => this._onMessageReactionRemove(reaction, user));
        this.client.on('voiceStateUpdate', (oldState, newState) => this._onVoiceStateUpdate(oldState, newState));
    }

    async _onReady() {
        console.log(`✅ Logged in as ${this.client.user.tag}`);
        await initializeGoogleCalendarClient();
        await this._loadActiveVoiceSessions();
        this._scheduleDailyTasks();
        await this._loadSlashCommands();
    }

    async _loadSlashCommands() {
        const slashCommandsPath = path.join(process.cwd(), 'src', 'commands', 'slash');
        const slashCommandFiles = fsPromises.readdir(slashCommandsPath).catch(e => {
            console.error(`Error reading slash commands directory ${slashCommandsPath}:`, e);
            return [];
        });

        const commandsForDiscordAPI = [];

        for (const file of await slashCommandFiles) {
            if (!file.endsWith('.js')) continue;
            const filePath = path.join(slashCommandsPath, file);
            try {
                const command = await import(filePath);
                if ('data' in command && 'execute' in command) {
                    this.client.commands.set(command.data.name, command);
                    commandsForDiscordAPI.push(command.data.toJSON());
                } else {
                    console.warn(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
                }
            } catch (error) {
                console.error(`Error loading slash command from ${filePath}:`, error);
            }
        }
        console.log(`[INFO] Loaded ${this.client.commands.size} slash commands.`);
        const rest = new REST({ version: '10' }).setToken(this.token);

        try {
            console.log('Started refreshing application (/) commands.');
            await rest.put(
                Routes.applicationCommands(this.client.user.id),
                { body: commandsForDiscordAPI },
            );
            console.log('Successfully reloaded application (/) commands globally.');
        } catch (error) {
            console.error('Error refreshing application (/) commands:', error);
        }
    }

    async _loadActiveVoiceSessions() {
        return new Promise((resolve, reject) => {
            this.db.all(`SELECT user_id, guild_id, channel_id, join_time FROM active_voice_sessions`, [], (err, rows) => {
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

    async _onInteractionCreate(interaction) {
        if (interaction.isChatInputCommand()) {
            const command = this.client.commands.get(interaction.commandName);
            if (!command) {
                console.warn(`Received interaction for unknown slash command: ${interaction.commandName}`);
                await interaction.reply({ content: '❌ Unknown command. It might have been removed or is not deployed correctly.', ephemeral: true }).catch(e => console.error("Error replying to unknown command:", e));
                return;
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(`Error executing slash command ${interaction.commandName}:`, error);
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: '❌ There was an error while executing this command!', ephemeral: true });
                } else {
                    await interaction.reply({ content: '❌ There was an error while executing this command!', ephemeral: true });
                }
            }
        } 
        else if (interaction.isButton()) {
            const customId = interaction.customId;
            if (customId.startsWith('confirm_nuke_') || customId.startsWith('cancel_nuke_')) {
                const nukeCommand = this.client.commands.get('nuke');
                if (nukeCommand && typeof nukeCommand._nukeServerLogic === 'function') { // Assuming _nukeServerLogic is exported
                    if (customId.startsWith('confirm_nuke_')) {
                        if (interaction.user.id !== interaction.guild.ownerId) {
                            return interaction.reply({ content: '❌ Only the server owner can confirm this action.', ephemeral: true });
                        }
                        await interaction.update({ content: '💣 Beginning server nuke... This may take a moment.', components: [], embeds: [] });
                        await nukeCommand._nukeServerLogic(interaction);
                    } else if (customId.startsWith('cancel_nuke_')) {
                        if (interaction.user.id !== interaction.guild.ownerId) {
                            return interaction.reply({ content: '❌ Only the server owner can cancel this action.', ephemeral: true });
                        }
                        await interaction.update({ content: '❌ Server nuke cancelled.', components: [], embeds: [] });
                    }
                }
                return;
            }
            else if (customId.startsWith('confirm_setup_fsu_') || customId.startsWith('cancel_setup_fsu_')) {
                const setupFSUCommand = this.client.commands.get('setupfsu');
                if (setupFSUCommand && typeof setupFSUCommand._performSetupLogic === 'function') { 
                    if (customId.startsWith('confirm_setup_fsu_')) {
                        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                            return interaction.reply({ content: 'You do not have permission to confirm this action.', ephemeral: true });
                        }
                        await interaction.update({ content: '🔧 Beginning FSU server setup... This may take a moment.', components: [], embeds: [] });
                        await setupFSUCommand._performSetupLogic(interaction);
                    } else if (customId.startsWith('cancel_setup_fsu_')) {
                        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                            return interaction.reply({ content: 'You do not have permission to cancel this action.', ephemeral: true });
                        }
                        await interaction.update({ content: '❌ FSU server setup cancelled.', components: [], embeds: [] });
                    }
                }
                return;
            }
            else if (customId.startsWith('gotverified_')) {
                const gotVerifiedCommand = this.client.commands.get('gotverified');
                if (gotVerifiedCommand && typeof gotVerifiedCommand.execute === 'function') {
                    await gotVerifiedCommand.execute(interaction);
                }
                return;
            }
            else if (customId.startsWith('confirm_otp_button_')) {
                const confirmOtpCmd = this.client.commands.get('confirmotp');
                if (confirmOtpCmd && typeof confirmOtpCmd.handleButtonInteraction === 'function') {
                    await confirmOtpCmd.handleButtonInteraction(interaction);
                }
                return;
            }
             else if (customId.startsWith('suggest_vote_')) {
                await this._handleSuggestionVote(interaction);
            }
        } 
        else if (interaction.isModalSubmit()) {
            if (interaction.customId === 'verifyModal') {
                const verifyCmd = this.client.commands.get('verify');
                if (verifyCmd && typeof verifyCmd.handleModalSubmit === 'function') {
                    await verifyCmd.handleModalSubmit(interaction);
                }
                return;
            } else if (interaction.customId === 'confirmOtpModal') {
                const confirmOtpCmd = this.client.commands.get('confirmotp');
                if (confirmOtpCmd && typeof confirmOtpCmd.handleModalSubmit === 'function') {
                    await confirmOtpCmd.handleModalSubmit(interaction);
                }
                return;
            }
        }
    }

    async _onMessageCreate(message) {
        if (message.author.bot) return;
        if (!message.guild) {
            return;
        }
        await this._handleAntiSpam(message);
        await this._updateUserMessageStats(message);
    }

    async _onGuildMemberAdd(member) {
        this.db.get(`SELECT welcome_message_content, welcome_channel_id, send_welcome_as_dm FROM guild_configs WHERE guild_id = ?`, [member.guild.id], async (err, row) => {
            if (err) {
                    console.error('Error fetching welcome config:', err.message);
                    return;
            }
            if (row && row.welcome_message_content) {
                const messageContent = row.welcome_message_content.replace(/{user}/g, `<@${member.id}>`);

                if (row.send_welcome_as_dm) {
                    try {
                        await member.send(messageContent);
                        console.log(`Sent welcome DM to ${member.user.tag}`);
                    } catch (dmErr) {
                        console.warn(`Could not send welcome DM to ${member.user.tag}: ${dmErr.message}`);
                        if (row.welcome_channel_id) {
                            const channel = member.guild.channels.cache.get(row.welcome_channel_id);
                            if (channel && channel.type === ChannelType.GuildText) {
                                await channel.send(`Welcome <@${member.id}>! (Could not send DM)\n${messageContent}`).catch(e => console.error('Error sending welcome fallback to channel:', e));
                            }
                        }
                    }
                } else if (row.welcome_channel_id) {
                    const channel = member.guild.channels.cache.get(row.welcome_channel_id);
                    if (channel && channel.type === ChannelType.GuildText) {
                        await channel.send(messageContent).catch(e => console.error('Error sending welcome message to channel:', e));
                    } else {
                        console.warn(`Configured welcome channel ${row.welcome_channel_id} not found or is not a text channel in guild ${member.guild.name}.`);
                    }
                }
            }
        });
    }

    async _onMessageReactionAdd(reaction, user) {
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error('Something went wrong when fetching the reaction:', error);
                return;
            }
        }
        if (user.bot || !reaction.message.guild) return;

        this.db.get(`SELECT role_id FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?`,
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
                            console.warn(`Configured role ${row.role_id} for reaction role not found in guild ${reaction.message.guild.name}.`);
                            this.db.run(`DELETE FROM reaction_roles WHERE role_id = ? AND guild_id = ?`, [row.role_id, reaction.message.guild.id]);
                        }
                    }
                }
            }
        );

        const SUGGESTIONS_CHANNEL_ID = process.env.SUGGESTIONS_CHANNEL_ID;
        if (reaction.message.channel.id === SUGGESTIONS_CHANNEL_ID && (reaction.emoji.name === '👍' || reaction.emoji.name === '👎')) {
            const message = await reaction.message.fetch().catch(e => console.error('Error fetching suggestion message:', e));
            if (!message) return;

            this.db.get(`SELECT id, upvotes, downvotes, user_id FROM suggestions WHERE message_id = ? AND guild_id = ?`,
                [message.id, message.guild.id],
                async (err, row) => {
                    if (err) {
                        console.error('Error fetching suggestion for voting:', err.message);
                        return;
                    }
                    if (row) {
                        if (user.id === row.user_id) {
                            await reaction.users.remove(user.id).catch(e => console.error('Error removing self-vote reaction:', e));
                            return;
                        }

                        let newUpvotes = row.upvotes || 0;
                        let newDownvotes = row.downvotes || 0;

                        const hasUpvoted = message.reactions.cache.get('👍')?.users.cache.has(user.id);
                        const hasDownvoted = message.reactions.cache.get('👎')?.users.cache.has(user.id);

                        if (reaction.emoji.name === '👍') {
                            if (hasDownvoted) {
                                await message.reactions.cache.get('👎').users.remove(user.id).catch(e => console.error('Error removing opposite reaction:', e));
                                newDownvotes = Math.max(0, newDownvotes - 1);
                            }
                            newUpvotes++;
                        } else if (reaction.emoji.name === '👎') {
                            if (hasUpvoted) {
                                await message.reactions.cache.get('👍').users.remove(user.id).catch(e => console.error('Error removing opposite reaction:', e));
                                newUpvotes = Math.max(0, newUpvotes - 1);
                            }
                            newDownvotes++;
                        }

                        this.db.run(`UPDATE suggestions SET upvotes = ?, downvotes = ? WHERE id = ?`,
                            [newUpvotes, newDownvotes, row.id],
                            (updateErr) => {
                                if (updateErr) {
                                    console.error('Error updating suggestion votes:', updateErr.message);
                                    return;
                                }
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

    async _onMessageReactionRemove(reaction, user) {
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error('Something went wrong when fetching the reaction:', error);
                return;
            }
        }
        if (user.bot || !reaction.message.guild) return;
        this.db.get(`SELECT role_id FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?`,
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

        const SUGGESTIONS_CHANNEL_ID = process.env.SUGGESTIONS_CHANNEL_ID;
        if (reaction.message.channel.id === SUGGESTIONS_CHANNEL_ID && (reaction.emoji.name === '👍' || reaction.emoji.name === '👎')) {
            const message = await reaction.message.fetch().catch(e => console.error('Error fetching suggestion message:', e));
            if (!message) return;

            this.db.get(`SELECT id, upvotes, downvotes, user_id FROM suggestions WHERE message_id = ? AND guild_id = ?`,
                [message.id, message.guild.id],
                async (err, row) => {
                    if (err) {
                        console.error('Error fetching suggestion for voting removal:', err.message);
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

                        this.db.run(`UPDATE suggestions SET upvotes = ?, downvotes = ? WHERE id = ?`,
                            [newUpvotes, newDownvotes, row.id],
                            (updateErr) => {
                                if (updateErr) {
                                    console.error('Error updating suggestion votes on removal:', updateErr.message);
                                    return;
                                }
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

    async _onVoiceStateUpdate(oldState, newState) {
        const userId = newState.member.id;
        const guildId = newState.guild.id;
        if (!oldState.channelId && newState.channelId) {
            this.db.run(`INSERT INTO active_voice_sessions (user_id, guild_id, channel_id, join_time) VALUES (?, ?, ?, ?)`,
                [userId, guildId, newState.channelId, Date.now()],
                (err) => {
                    if (err) console.error('Error inserting active voice session:', err.message);
                    else {
                        this.voiceStates.set(userId, { guildId, channelId: newState.channelId, joinTime: Date.now() });
                        console.log(`[Voice] ${newState.member.user.tag} joined voice channel ${newState.channel.name}. Session started.`);
                    }
                }
            );
        }
        else if (oldState.channelId && (!newState.channelId || oldState.channelId !== newState.channelId)) {
            this.db.get(`SELECT join_time FROM active_voice_sessions WHERE user_id = ? AND guild_id = ?`, [userId, guildId], async (err, row) => {
                if (err) {
                    console.error('Error fetching active voice session for update:', err.message);
                    return;
                }
                if (row) {
                    const durationMs = Date.now() - row.join_time;
                    const durationMinutes = Math.floor(durationMs / (1000 * 60));

                    if (durationMinutes > 0) {
                        this.db.run(`INSERT INTO user_stats (user_id, guild_id, messages_sent, voice_time_minutes) VALUES (?, ?, 1, ?)
                                     ON CONFLICT(user_id, guild_id) DO UPDATE SET voice_time_minutes = voice_time_minutes + ?`,
                            [userId, guildId, durationMinutes, durationMinutes],
                            (updateErr) => {
                                if (updateErr) console.error('Error updating voice time in user_stats:', updateErr.message);
                                else console.log(`[Voice] Updated voice time for ${oldState.member.user.tag} by ${durationMinutes} minutes.`);
                            }
                        );
                    }
                    this.db.run(`DELETE FROM active_voice_sessions WHERE user_id = ? AND guild_id = ?`, [userId, guildId], (deleteErr) => {
                        if (deleteErr) console.error('Error deleting active voice session:', deleteErr.message);
                        else console.log(`[Voice] Session for ${oldState.member.user.tag} ended/moved.`);
                    });
                } else {
                    console.warn(`[Voice] No active session found in DB for ${oldState.member.user.tag} when leaving/moving channel.`);
                }
                this.voiceStates.delete(userId);
                if (newState.channelId) {
                    this.db.run(`INSERT INTO active_voice_sessions (user_id, guild_id, channel_id, join_time) VALUES (?, ?, ?, ?)`,
                        [userId, guildId, newState.channelId, Date.now()],
                        (err) => {
                            if (err) console.error('Error inserting new active voice session after move:', err.message);
                            else {
                                this.voiceStates.set(userId, { guildId, channelId: newState.channelId, joinTime: Date.now() });
                                console.log(`[Voice] ${newState.member.user.tag} moved to ${newState.channel.name}. New session started.`);
                            }
                        }
                    );
                }
            });
        }
    }

    async _handleAntiSpam(message) {
        if (!message.guild) {
            return;
        }

        const userId = message.author.id;
        const guildId = message.guild.id;

        this.db.get(`SELECT message_limit, time_window_seconds, mute_duration_seconds, kick_threshold, ban_threshold FROM anti_spam_configs WHERE guild_id = ?`, [guildId], async (err, config) => {
            if (err) {
                console.error('Error fetching anti-spam config:', err.message);
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
                    }, time_window_seconds * 1000)
                });
            } else {
                const userData = this.spamMap.get(userId);
                userData.count++;
                clearTimeout(userData.timer);
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
                            this.spamWarnings.delete(userId);
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
                    await message.channel.bulkDelete(userData.count, true).catch(e => console.error('Error bulk deleting messages:', e));
                    this.spamMap.delete(userId);
                }
            }
        });
    }

    async _updateUserMessageStats(message) {
        const userId = message.author.id;
        const guildId = message.guild.id;
        const now = Date.now();

        this.db.run(`INSERT INTO user_stats (user_id, guild_id, messages_sent, last_message_at) VALUES (?, ?, 1, ?)
                     ON CONFLICT(user_id, guild_id) DO UPDATE SET messages_sent = messages_sent + 1, last_message_at = ?`,
            [userId, guildId, now, now],
            (err) => {
                if (err) console.error('Error updating message stats:', err.message);
            }
        );
    }

    _scheduleDailyTasks() {
        const NOTICE_CHECK_INTERVAL_MS = parseInt(process.env.NOTICE_CHECK_INTERVAL_MS || '1800000');
        if (NOTICE_CHECK_INTERVAL_MS > 0) {
            this._checkAndAnnounceNotices();
            setInterval(() => this._checkAndAnnounceNotices(), NOTICE_CHECK_INTERVAL_MS);
            console.log(`Scheduled notice checking every ${NOTICE_CHECK_INTERVAL_MS / 60000} minutes.`);
        } else {
            console.warn('NOTICE_CHECK_INTERVAL_MS is not set or invalid. Notice scraping disabled.');
        }

        const BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID = process.env.BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID;
        if (BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID && BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID !== 'YOUR_BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID_HERE') {
            schedule.scheduleJob('0 9 * * *', () => this._announceBirthdays());
            console.log('Scheduled daily birthday announcements for 9 AM.');
        } else {
            console.warn('BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID is not set or invalid. Birthday announcements disabled.');
        }
    }

    async _checkAndAnnounceNotices() {
        console.log('[Scheduler] Checking for new notices...');
        const TARGET_NOTICE_CHANNEL_ID = process.env.TARGET_NOTICE_CHANNEL_ID;
        const NOTICE_ADMIN_CHANNEL_ID = process.env.NOTICE_ADMIN_CHANNEL_ID;
        const TEMP_ATTACHMENT_DIR = path.join(process.cwd(), 'temp_notice_attachments'); 

        
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
            if (!noticeChannel || noticeChannel.type !== ChannelType.GuildText) {
                console.error(`[Scheduler] Configured notice channel (${TARGET_NOTICE_CHANNEL_ID}) not found or is not a text channel.`);
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
            let scrapedNotices = await scrapeLatestNotice();

            if (!scrapedNotices || scrapedNotices.length === 0) {
                console.log('[Scheduler] No notices found or scraper returned empty.');
                return;
            }

            let latestDate = null;
            scrapedNotices.forEach(notice => {
                const noticeDate = new Date(notice.date);
                if (isNaN(noticeDate.getTime())) {
                    console.warn(`[Scheduler] Invalid date format for notice: ${notice.title} - ${notice.date}`);
                    return;
                }
                if (!latestDate || noticeDate > latestDate) {
                    latestDate = noticeDate;
                }
            });

            if (!latestDate) {
                console.log('[Scheduler] No valid dates found in scraped notices.');
                return;
            }


            const noticesToAnnounce = scrapedNotices.filter(notice => {
                const noticeDate = new Date(notice.date);
                return noticeDate.getFullYear() === latestDate.getFullYear() &&
                       noticeDate.getMonth() === latestDate.getMonth() &&
                       noticeDate.getDate() === latestDate.getDate();
            });

            if (noticesToAnnounce.length === 0) {
                console.log('[Scheduler] No notices found for the latest date.');
                return;
            }

            for (const notice of noticesToAnnounce) {
                if (!notice || !notice.title || !notice.link) {
                    console.warn('[Scheduler] Scraper returned an invalid notice object:', notice);
                    continue;
                }

                const row = await new Promise((resolve, reject) => {
                    this.db.get(`SELECT COUNT(*) AS count FROM notices WHERE link = ?`, [notice.link], (err, result) => {
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

                    let filesToSend = [];
                    let tempFilesOnDisk = []; 
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

                                const MAX_PDF_PAGES_TO_CONVERT = 5; 


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
                                            totalPdfPages = MAX_PDF_PAGES_TO_CONVERT;
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
                                                    filesToSend.push(new AttachmentBuilder(pngFilePath, { name: pngFileName }));
                                                    console.log(`Converted PDF ${fileName} page ${pageNum} to PNG and prepared for sending.`);
                                                    pageConvertedCount++;
                                                } else {
                                                    console.warn(`No valid response for PDF ${fileName} at page ${pageNum}. Stopping conversion for this PDF.`);
                                                    break;
                                                }
                                            } catch (pageConvertError) {
                                                console.warn(`Could not convert PDF ${fileName} page ${pageNum}:`, pageConvertError.message);
                                                if (pageConvertError.message.includes('does not exist') || pageConvertError.message.includes('invalid page number')) {
                                                    break;
                                                }
                                            }
                                        }

                                        if (pageConvertedCount === 0) {
                                            console.warn(`No pages converted for PDF ${fileName}. Sending original PDF.`);
                                            filesToSend.push(new AttachmentBuilder(tempFilePath, { name: fileName }));
                                        } else if (pageConvertedCount < totalPdfPages) {
                                            console.log(`\n(Sent ${pageConvertedCount} of ${totalPdfPages} pages from ${fileName} as images.)`);
                                        } else {
                                            console.log(`\n(Sent all ${totalPdfPages} pages from ${fileName} as images.)`);
                                        }

                                    } catch (pdfProcessError) {
                                        console.error(`Error processing PDF ${fileName}:`, pdfProcessError.message);
                                        description += `\n\n⚠️ Could not process PDF attachment: ${fileName}`;
                                        filesToSend.push(new AttachmentBuilder(tempFilePath, { name: fileName }));
                                    }
                                } else {
                                    filesToSend.push(new AttachmentBuilder(tempFilePath, { name: fileName }));
                                    console.log(`Prepared attachment: ${fileName}`);
                                }
                            } catch (downloadError) {
                                console.error(`Error downloading attachment ${attachmentUrl}:`, downloadError.message);
                                description += `\n\n⚠️ Could not download an attachment: ${attachmentUrl}`;
                            }
                        }
                    }

                    noticeEmbed.setDescription(description);

                    try {
                        await noticeChannel.send({ embeds: [noticeEmbed], files: filesToSend });
                        console.log(`Sent notice and attachments for "${notice.title}" to Discord.`);
                    } catch (discordSendError) {
                        console.error(`Error sending notice or files to channel ${TARGET_NOTICE_CHANNEL_ID}:`, discordSendError);
                        if (adminChannel) await adminChannel.send(`❌ Error sending notice/files for "${notice.title}": ${discordSendError.message}`).catch(e => console.error("Error sending admin error:", e));
                    } finally {
                        for (const filePath of tempFilesOnDisk) {
                            try {
                                await fsPromises.unlink(filePath);
                                console.log(`Cleaned up temporary file: ${filePath}`);
                            } catch (unlinkError) {
                                console.warn(`Error cleaning up temporary file ${filePath}:`, unlinkError.message);
                            }
                        }
                    }

                    await new Promise((resolve, reject) => {
                        this.db.run(`INSERT INTO notices (title, link, date, announced_at) VALUES (?, ?, ?, ?)`,
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
            } 

        } catch (error) {
            console.error('[Scheduler] Error during notice scraping or announcement:', error.message);
            if (adminChannel) {
                await adminChannel.send(`❌ Notice scraping failed: ${error.message}`).catch(e => console.error("Error sending admin error:", e));
            }
        }
        finally {
            await fsPromises.rm(TEMP_ATTACHMENT_DIR, { recursive: true, force: true }).catch(e => console.error('Error deleting temp directory after all notices processed:', e));
        }
    }


    async _announceBirthdays() {
        console.log('[Scheduler] Checking for birthdays...');
        const BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID = process.env.BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID;

        if (!BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID || BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID === 'YOUR_BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID_HERE') {
            console.warn('BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID is not set or invalid. Birthday announcements disabled.');
            return;
        }

        let announcementChannel;
        try {
            announcementChannel = await this.client.channels.fetch(BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID);
            if (!announcementChannel || announcementChannel.type !== ChannelType.GuildText) {
                console.error(`[Scheduler] Configured birthday channel (${BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID}) not found or is not a text channel.`);
                return;
            }
        } catch (error) {
            console.error(`[Scheduler] Error fetching birthday channel ${BIRTHDAY_ANNOUNCEMENT_CHANNEL_ID}:`, error.message);
            return;
        }

        const today = new Date();
        const currentMonth = today.getMonth() + 1;
        const currentDay = today.getDate();

        const guilds = this.client.guilds.cache;

        for (const [_, guild] of guilds) {
            try {
                this.db.all(`SELECT user_id, year FROM birthdays WHERE guild_id = ? AND month = ? AND day = ?`,
                    [guild.id, currentMonth, currentDay],
                    async (err, rows) => {
                        if (err) {
                            console.error(`Error fetching birthdays for guild ${guild.id}:`, err.message);
                            return;
                        }

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
                                    console.warn(`Could not fetch birthday user ${row.user_id} in guild ${guild.id}:`, fetchErr.message);
                                    birthdayUsers.push(`• Unknown User (ID: ${row.user_id})`);
                                }
                            }


                            const authorName = `Free Students' Union, Pulchowk Campus - 2081`;
                            const authorIconUrl = "https://fsu.abhishekkharel.com.np/images/fsulogo.png";
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
                                .setImage('https://codaio.imgix.net/docs/Y_HFctSU9K/blobs/bl-4kLxBlt-8t/66dbaff27d8df6da40fc20009f59a885dca2e859e880d992e28c3096d08bd205041c9ea43d0ca891055d56e79864748a9564d1be896d57cc93bf6c57e6b25e879d80a6d5058a91ef3572aff7c0a3b9efb24f7f0d1daa0d170368b9686d674c81650fa247?auto=format%2Ccompress&fit=crop&w=1920&ar=4%3A1&crop=focalpoint&fp-x=0.5&fp-y=0.5&fp-z=1')
                                .setTimestamp();
                            if (firstBirthdayUserAvatarUrl) {
                                birthdayEmbed.setThumbnail(firstBirthdayUserAvatarUrl);
                            } else {
                                birthdayEmbed.setThumbnail('https://fsu.abhishekkharel.com.np/images/fsulogo.png')
                            }
                            await announcementChannel.send({ embeds: [birthdayEmbed] }).catch(e => console.error(`Error sending birthday announcement in guild ${guild.id}:`, e));
                        }
                    }
                );
            } catch (guildError) {
                console.error(`Error processing guild ${guild.id} for birthdays:`, guildError);
            }
        }
    }

    start() {
        this.client.login(this.token);
    }
}

async function main() {
    try {
        const database = await initializeDatabase();
        const bot = new PulchowkBot(process.env.BOT_TOKEN, database); 
        bot.start();
    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1);
    }
}

main();