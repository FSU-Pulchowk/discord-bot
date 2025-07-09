import { EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from 'discord.js';
import { Command } from '../../utils/Command.js';

class SetupFSUCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'setupfsu',
            description: 'Sets up a basic FSU server structure (roles, categories, channels).',
            permissions: [PermissionsBitField.Flags.Administrator], 
            usage: '',
            dbInstance: options.dbInstance, 
        });
    }

    /**
     * Executes the !setupfsu command.
     * Sends a confirmation message with buttons.
     * @param {import('discord.js').Message} message - The message that triggered the command.
     * @param {string[]} args - Command arguments (not used for setup).
     */
    async execute(message, args) {
        const confirmationEmbed = new EmbedBuilder()
            .setColor('#0099ff') // Blue
            .setTitle('🔧 FSU Server Setup Confirmation')
            .setDescription("This command will create essential FSU-related categories, channels, and roles in your server.\n\n**This is a significant action.** It will add new elements to your server but will **not** delete existing ones.\n\nAre you sure you want to proceed?")
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('confirm_setup_fsu')
                .setLabel('Yes, Setup Server')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('cancel_setup_fsu')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

        await message.reply({ embeds: [confirmationEmbed], components: [row] });
    }

    /**
     * Handles button interactions specifically for the SetupFSU command.
     * This method is called by the main CommandHandler when a relevant button is pressed.
     * @param {import('discord.js').ButtonInteraction} interaction - The button interaction.
     */
    async handleButtonInteraction(interaction) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: 'You do not have permission to confirm this action.', ephemeral: true });
        }

        if (interaction.customId === 'confirm_setup_fsu') {
            await interaction.update({ content: '⏳ Setting up FSU server structure... This may take a while.', components: [], embeds: [] });
            await this._performSetup(interaction);
        } else if (interaction.customId === 'cancel_setup_fsu') {
            await interaction.update({ content: '❌ FSU server setup cancelled.', components: [], embeds: [] });
        }
    }

    /**
     * Updates the status message during the setup process.
     * @param {import('discord.js').Message} statusMessage - The message to update.
     * @param {string} statusText - The new status text.
     */
    async _updateStatus(statusMessage, statusText) {
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('🔧 FSU Setup Progress')
            .addFields({name: 'Status', value: statusText})
            .setTimestamp();
        await statusMessage.edit({ embeds: [embed] }).catch(console.error);
    }

    /**
     * Helper to create a Discord role.
     * @param {import('discord.js').Guild} guild
     * @param {object} roleData
     * @returns {Promise<import('discord.js').Role>}
     */
    async _createRole(guild, { name, color, permissions, reason }) {
        const existingRole = guild.roles.cache.find(r => r.name === name);
        if (existingRole) {
            console.log(`Role "${name}" already exists. Skipping creation.`);
            return existingRole;
        }
        return guild.roles.create({ name, color, permissions, reason: `FSU Setup: ${reason}` });
    }

    /**
     * Helper to create a Discord category channel.
     * @param {import('discord.js').Guild} guild
     * @param {string} name
     * @param {Array<object>} [permissionOverwrites=[]]
     * @returns {Promise<import('discord.js').CategoryChannel>}
     */
    async _createCategory(guild, name, permissionOverwrites = []) {
        const existingCategory = guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildCategory);
        if (existingCategory) {
            console.log(`Category "${name}" already exists. Skipping creation.`);
            return existingCategory;
        }
        return guild.channels.create({ name, type: ChannelType.GuildCategory, permissionOverwrites });
    }

    /**
     * Helper to create a Discord text channel.
     * @param {import('discord.js').Guild} guild
     * @param {string} name
     * @param {string} parentId - ID of the parent category.
     * @param {Array<object>} [permissionOverwrites=[]]
     * @param {string} [topic='']
     * @returns {Promise<import('discord.js').TextChannel>}
     */
    async _createTextChannel(guild, name, parentId, permissionOverwrites = [], topic = '') {
        const existingChannel = guild.channels.cache.find(c => c.name === name && c.parentId === parentId && c.type === ChannelType.GuildText);
        if (existingChannel) {
            console.log(`Text channel "${name}" in category ${parentId} already exists. Skipping creation.`);
            return existingChannel;
        }
        return guild.channels.create({ name, type: ChannelType.GuildText, parent: parentId, permissionOverwrites, topic });
    }

    /**
     * Helper to create a Discord voice channel.
     * @param {import('discord.js').Guild} guild
     * @param {string} name
     * @param {string} parentId - ID of the parent category.
     * @param {Array<object>} [permissionOverwrites=[]]
     * @returns {Promise<import('discord.js').VoiceChannel>}
     */
    async _createVoiceChannel(guild, name, parentId, permissionOverwrites = []) {
        const existingChannel = guild.channels.cache.find(c => c.name === name && c.parentId === parentId && c.type === ChannelType.GuildVoice);
        if (existingChannel) {
            console.log(`Voice channel "${name}" in category ${parentId} already exists. Skipping creation.`);
            return existingChannel;
        }
        return guild.channels.create({ name, type: ChannelType.GuildVoice, parent: parentId, permissionOverwrites });
    }

    /**
     * Contains the core logic for setting up the FSU server structure.
     * @param {import('discord.js').ButtonInteraction} interaction - The button interaction that triggered the setup.
     */
    async _performSetup(interaction) {
        const guild = interaction.guild;
        const statusChannel = interaction.channel;
        let statusMessage = interaction.message;

        if (!guild) {
            console.error('Setup command executed outside a guild context.');
            return statusChannel.send('❌ This command can only be used in a server.').catch(console.error);
        }

        try {
            await this._updateStatus(statusMessage, 'Creating roles...');
            const rolesToCreate = [
                { name: 'FSU Executive', color: '#FF0000', permissions: [PermissionsBitField.Flags.Administrator], reason: 'Admin Role' },
                { name: 'Moderator', color: '#00AA00', permissions: [PermissionsBitField.Flags.ManageMessages, PermissionsBitField.Flags.KickMembers, PermissionsBitField.Flags.ModerateMembers, PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages], reason: 'Moderator Role' },
                { name: 'Club Leader', color: '#AA00AA', permissions: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak], reason: 'Club Leader Role' },
                { name: 'Student', color: '#0000FF', permissions: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak], reason: 'Student Role' },
                { name: 'Alumni', color: '#00AAAA', permissions: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak], reason: 'Alumni Role' },
                { name: 'Verified', color: '#00FF00', permissions: [], reason: 'Role for verified members' }
            ];

            const createdRoles = {};
            for (const roleData of rolesToCreate) {
                createdRoles[roleData.name.toLowerCase().replace(/\s+/g, '')] = await this._createRole(guild, roleData);
            }
            
            await this._updateStatus(statusMessage, 'Creating categories and channels...');

            const everyoneDenyView = [{ id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] }];
            const everyoneAllowView = [{ id: guild.roles.everyone.id, allow: [PermissionsBitField.Flags.ViewChannel] }];

            const welcomeCat = await this._createCategory(guild, '🟢 Welcome & Onboarding', everyoneAllowView);
            await this._createTextChannel(guild, 'welcome', welcomeCat.id, everyoneAllowView, 'Welcome new members!');
            await this._createTextChannel(guild, 'rules', welcomeCat.id, everyoneAllowView, 'Server rules and guidelines.');
            await this._createTextChannel(guild, 'introductions', welcomeCat.id, everyoneAllowView, 'Introduce yourself to the community.');
            await this._createTextChannel(guild, 'faq-and-help', welcomeCat.id, everyoneAllowView, 'Frequently asked questions and help.');

            const announceCat = await this._createCategory(guild, '📣 Announcements', everyoneAllowView);
            await this._createTextChannel(guild, 'fsu-announcements', announceCat.id, [
                { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.SendMessages] }, 
                { id: createdRoles.fsuexecutive.id, allow: [PermissionsBitField.Flags.SendMessages] }
            ], 'Official FSU announcements.');
            await this._createTextChannel(guild, 'event-calendar', announceCat.id, everyoneAllowView, 'Upcoming events and calendar.');
            
            const generalCat = await this._createCategory(guild, '💬 General Discussion', everyoneAllowView);
            await this._createTextChannel(guild, 'general-chat', generalCat.id, everyoneAllowView, 'General chat and discussions.');
            await this._createTextChannel(guild, 'academic-talk', generalCat.id, everyoneAllowView, 'Discussions about academics and courses.');
            await this._createTextChannel(guild, 'off-topic', generalCat.id, everyoneAllowView, 'For off-topic conversations.');

            const voiceCat = await this._createCategory(guild, '🔊 Voice Channels', everyoneAllowView);
            await this._createVoiceChannel(guild, 'General Voice', voiceCat.id, everyoneAllowView);
            await this._createVoiceChannel(guild, 'Study Room 1', voiceCat.id, everyoneAllowView);
            await this._createVoiceChannel(guild, 'Study Room 2', voiceCat.id, everyoneAllowView);

            await this._updateStatus(statusMessage, '✅ FSU Server setup complete!');
            const successEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('✅ Setup Complete!')
                .setDescription('Basic FSU server structure (roles, categories, and channels) has been created. You can now assign roles and customize further.')
                .setTimestamp();
            await statusChannel.send({ embeds: [successEmbed] });

        } catch (error) {
            console.error('Error during FSU server setup:', error);
            if (statusMessage) await this._updateStatus(statusMessage, `❌ Error during setup: ${error.message}`).catch(console.error);
            else await statusChannel.send(`❌ An error occurred during setup: ${error.message}`).catch(console.error);
        }
    }
}

export { SetupFSUCommand };