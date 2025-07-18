import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('setupfsu')
    .setDescription('Sets up a basic FSU server structure (roles, categories, channels).')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator);

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const confirmationEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('🔧 FSU Server Setup Confirmation')
        .setDescription("This command will create essential FSU-related categories, channels, and roles in your server.\n\n**This is a significant action.** It will add new elements to your server but will **not** delete existing ones.\n\nAre you sure you want to proceed?")
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`confirm_setup_fsu_${interaction.id}`) // Unique customId for this interaction
            .setLabel('Yes, Setup Server')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`cancel_setup_fsu_${interaction.id}`) // Unique customId for this interaction
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({ embeds: [confirmationEmbed], components: [row], ephemeral: true });
}

/**
 * Updates the status message during the setup process.
 * @param {import('discord.js').Message} statusMessage - The message to update.
 * @param {string} statusText - The new status text.
 */
async function _updateSetupStatus(statusMessage, statusText) {
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
async function _createRole(guild, { name, color, permissions, reason }) {
    const existingRole = guild.roles.cache.find(r => r.name === name);
    if (existingRole) {
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
async function _createCategory(guild, name, permissionOverwrites = []) {
    const existingCategory = guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildCategory);
    if (existingCategory) {
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
async function _createTextChannel(guild, name, parentId, permissionOverwrites = [], topic = '') {
    const existingChannel = guild.channels.cache.find(c => c.name === name && c.parentId === parentId && c.type === ChannelType.GuildText);
    if (existingChannel) {
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
async function _createVoiceChannel(guild, name, parentId, permissionOverwrites = []) {
    const existingChannel = guild.channels.cache.find(c => c.name === name && c.parentId === parentId && c.type === ChannelType.GuildVoice);
    if (existingChannel) {
        return existingChannel;
    }
    return guild.channels.create({ name, type: ChannelType.GuildVoice, parent: parentId, permissionOverwrites });
}

/**
 * Contains the core logic for setting up the FSU server structure.
 * This should be called by your main bot's interaction handler for the button.
 * @param {import('discord.js').ButtonInteraction} interaction - The button interaction that triggered the setup.
 */
export async function _performSetupLogic(interaction) { // Renamed to avoid conflict if class exists
    const guild = interaction.guild;
    const statusChannel = interaction.channel;
    let statusMessage = interaction.message;

    if (!guild) {
        return statusChannel.send('❌ This command can only be used in a server.').catch(console.error);
    }

    try {
        await _updateSetupStatus(statusMessage, 'Creating roles...');
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
            createdRoles[roleData.name.toLowerCase().replace(/\s+/g, '')] = await _createRole(guild, roleData);
        }
        
        await _updateSetupStatus(statusMessage, 'Creating categories and channels...');

        const everyoneDenyView = [{ id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] }];
        const everyoneAllowView = [{ id: guild.roles.everyone.id, allow: [PermissionsBitField.Flags.ViewChannel] }];

        const welcomeCat = await _createCategory(guild, '🟢 Welcome & Onboarding', everyoneAllowView);
        await _createTextChannel(guild, 'welcome', welcomeCat.id, everyoneAllowView, 'Welcome new members!');
        await _createTextChannel(guild, 'rules', welcomeCat.id, everyoneAllowView, 'Server rules and guidelines.');
        await _createTextChannel(guild, 'introductions', welcomeCat.id, everyoneAllowView, 'Introduce yourself to the community.');
        await _createTextChannel(guild, 'faq-and-help', welcomeCat.id, everyoneAllowView, 'Frequently asked questions and help.');

        const announceCat = await _createCategory(guild, '📣 Announcements', everyoneAllowView);
        await _createTextChannel(guild, 'fsu-announcements', announceCat.id, [
            { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.SendMessages] }, 
            { id: createdRoles.fsuexecutive.id, allow: [PermissionsBitField.Flags.SendMessages] }
        ], 'Official FSU announcements.');
        await _createTextChannel(guild, 'event-calendar', announceCat.id, everyoneAllowView, 'Upcoming events and calendar.');
        
        const generalCat = await _createCategory(guild, '💬 General Discussion', everyoneAllowView);
        await _createTextChannel(guild, 'general-chat', generalCat.id, everyoneAllowView, 'General chat and discussions.');
        await _createTextChannel(guild, 'academic-talk', generalCat.id, everyoneAllowView, 'Discussions about academics and courses.');
        await _createTextChannel(guild, 'off-topic', generalCat.id, everyoneAllowView, 'For off-topic conversations.');

        const voiceCat = await _createCategory(guild, '🔊 Voice Channels', everyoneAllowView);
        await _createVoiceChannel(guild, 'General Voice', voiceCat.id, everyoneAllowView);
        await _createVoiceChannel(guild, 'Study Room 1', voiceCat.id, everyoneAllowView);
        await _createVoiceChannel(guild, 'Study Room 2', voiceCat.id, everyoneAllowView);

        await _updateSetupStatus(statusMessage, '✅ FSU Server setup complete!');
        const successEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Setup Complete!')
            .setDescription('Basic FSU server structure (roles, categories, and channels) has been created. You can now assign roles and customize further.')
            .setTimestamp();
        await statusChannel.send({ embeds: [successEmbed] });

    } catch (error) {
        console.error('Error during FSU server setup:', error);
        if (statusMessage) await _updateSetupStatus(statusMessage, `❌ Error during setup: ${error.message}`).catch(console.error);
        else await statusChannel.send(`❌ An error occurred during setup: ${error.message}`).catch(console.error);
    }
}