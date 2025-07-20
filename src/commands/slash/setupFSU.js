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
        console.log(`Role '${name}' already exists, skipping creation.`);
        return existingRole;
    }
    console.log(`Creating role: ${name}`);
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
        console.log(`Category '${name}' already exists, skipping creation.`);
        return existingCategory;
    }
    console.log(`Creating category: ${name}`);
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
        console.log(`Text channel '${name}' already exists in category ${parentId}, skipping creation.`);
        return existingChannel;
    }
    console.log(`Creating text channel: ${name} in category ${parentId}`);
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
        console.log(`Voice channel '${name}' already exists in category ${parentId}, skipping creation.`);
        return existingChannel;
    }
    console.log(`Creating voice channel: ${name} in category ${parentId}`);
    return guild.channels.create({ name, type: ChannelType.GuildVoice, parent: parentId, permissionOverwrites });
}

/**
 * Helper to create a Discord forum channel.
 * @param {import('discord.js').Guild} guild
 * @param {string} name
 * @param {string} parentId - ID of the parent category.
 * @param {Array<object>} [permissionOverwrites=[]]
 * @param {string} [topic='']
 * @returns {Promise<import('discord.js').ForumChannel>}
 */
async function _createForumChannel(guild, name, parentId, permissionOverwrites = [], topic = '') {
    const existingChannel = guild.channels.cache.find(c => c.name === name && c.parentId === parentId && c.type === ChannelType.GuildForum);
    if (existingChannel) {
        console.log(`Forum channel '${name}' already exists in category ${parentId}, skipping creation.`);
        return existingChannel;
    }
    console.log(`Creating forum channel: ${name} in category ${parentId}`);
    return guild.channels.create({ name, type: ChannelType.GuildForum, parent: parentId, permissionOverwrites, topic });
}

/**
 * Helper to create a Discord stage voice channel.
 * @param {import('discord.js').Guild} guild
 * @param {string} name
 * @param {string} parentId - ID of the parent category.
 * @param {Array<object>} [permissionOverwrites=[]]
 * @returns {Promise<import('discord.js').StageChannel>}
 */
async function _createStageChannel(guild, name, parentId, permissionOverwrites = []) {
    const existingChannel = guild.channels.cache.find(c => c.name === name && c.parentId === parentId && c.type === ChannelType.GuildStageVoice);
    if (existingChannel) {
        console.log(`Stage channel '${name}' already exists in category ${parentId}, skipping creation.`);
        return existingChannel;
    }
    console.log(`Creating stage channel: ${name} in category ${parentId}`);
    return guild.channels.create({ name, type: ChannelType.GuildStageVoice, parent: parentId, permissionOverwrites });
}

/**
 * Helper to get a role ID from the createdRoles map, with a fallback.
 * @param {object} createdRoles - Map of created roles.
 * @param {string} roleKey - The key for the role (e.g., 'admin').
 * @returns {string|null} The role ID or null if not found.
 */
function _getRoleById(createdRoles, roleKey) {
    const role = createdRoles[roleKey];
    if (!role) {
        console.warn(`Role with key '${roleKey}' not found in createdRoles.`);
        return null;
    }
    return role.id;
}

/**
 * Contains the core logic for setting up the FSU server structure.
 * This should be called by your main bot's interaction handler for the button.
 * @param {import('discord.js').ButtonInteraction} interaction - The button interaction that triggered the setup.
 */
export async function _performSetupLogic(interaction) {
    const guild = interaction.guild;
    const statusChannel = interaction.channel;
    let statusMessage = interaction.message;

    if (!guild) {
        return statusChannel.send('❌ This command can only be used in a server.').catch(console.error);
    }

    try {
        await _updateSetupStatus(statusMessage, 'Creating roles...');

        // Define all roles to be created
        const rolesToCreate = [
            { name: 'FSU Executive', color: '#FF0000', permissions: [PermissionsBitField.Flags.Administrator, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ManageRoles], reason: 'Admin Role for FSU Executives' },
            { name: 'Admin', color: '#B30000', permissions: [PermissionsBitField.Flags.Administrator], reason: 'Overall Server Admin Role' },
            { name: 'Moderator', color: '#00AA00', permissions: [PermissionsBitField.Flags.ManageMessages, PermissionsBitField.Flags.KickMembers, PermissionsBitField.Flags.BanMembers, PermissionsBitField.Flags.ModerateMembers, PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.MuteMembers, PermissionsBitField.Flags.DeafenMembers], reason: 'Server Moderator Role' },
            { name: 'Club Leader', color: '#AA00AA', permissions: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak], reason: 'Club Leader Role' },
            { name: 'Student', color: '#0000FF', permissions: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak], reason: 'Student Role' },
            { name: 'Alumni', color: '#00AAAA', permissions: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak], reason: 'Alumni Role' },
            { name: 'Verified', color: '#00FF00', permissions: [], reason: 'Role for verified members' },
            { name: 'Bots', color: '#8888FF', permissions: [], reason: 'Role for other bots' },
            { name: 'Pulchowk Bot', color: '#00FFFF', permissions: [PermissionsBitField.Flags.Administrator], reason: 'Self-role for Pulchowk Bot' }, // This bot's role
            { name: 'FSU bot', color: '#FFAA00', permissions: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels], reason: 'Role for FSU specific bot' },
            { name: 'Guest Speaker', color: '#FFD700', permissions: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak], reason: 'Role for Guest Speakers' },
            { name: 'Mentor Alumni', color: '#D4AF37', permissions: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages], reason: 'Role for Mentor Alumni' },
            { name: 'Pulchowkian', color: '#6A0DAD', permissions: [PermissionsBitField.Flags.ViewChannel], reason: 'General Pulchowkian role' },
            { name: 'Guest', color: '#CCCCCC', permissions: [PermissionsBitField.Flags.ViewChannel], reason: 'Guest role with limited access' },
            // Department Roles
            { name: 'Civil', color: '#A52A2A', permissions: [], reason: 'Civil Engineering Student' },
            { name: 'Computer', color: '#00008B', permissions: [], reason: 'Computer Engineering Student' },
            { name: 'Electrical', color: '#FF4500', permissions: [], reason: 'Electrical Engineering Student' },
            { name: 'Electronics', color: '#8A2BE2', permissions: [], reason: 'Electronics Engineering Student' },
            { name: 'Mechanical', color: '#008000', permissions: [], reason: 'Mechanical Engineering Student' },
            { name: 'Architecture', color: '#800000', permissions: [], reason: 'Architecture Student' },
            { name: 'Chemical', color: '#DAA520', permissions: [], reason: 'Chemical Engineering Student' },
            { name: 'Aerospace', color: '#4682B4', permissions: [], reason: 'Aerospace Engineering Student' },
            // Batch Roles
            { name: 'Batch - 2081', color: '#ADD8E6', permissions: [], reason: 'Batch 2081' },
            { name: 'Batch - 2080', color: '#87CEEB', permissions: [], reason: 'Batch 2080' },
            { name: 'Batch - 2079', color: '#6495ED', permissions: [], reason: 'Batch 2079' },
            { name: 'Batch - 2078', color: '#4169E1', permissions: [], reason: 'Batch 2078' },
            { name: 'Batch - 2077', color: '#1E90FF', permissions: [], reason: 'Batch 2077' },
            { name: 'Batch - 2076', color: '#00BFFF', permissions: [], reason: 'Batch 2076' },
            { name: 'Batch - 2075', color: '#5F9EA0', permissions: [], reason: 'Batch 2075' },
            { name: 'Batch - 2074', color: '#4682B4', permissions: [], reason: 'Batch 2074' },
            { name: 'Batch - 2073', color: '#B0C4DE', permissions: [], reason: 'Batch 2073' },
            { name: 'Batch - 2072', color: '#ADD8E6', permissions: [], reason: 'Batch 2072' },
            { name: 'Batch - 2071', color: '#87CEEB', permissions: [], reason: 'Batch 2071' },
            { name: 'Batch - 2070', color: '#6495ED', permissions: [], reason: 'Batch 2070' },
            // Hobby Roles
            { name: 'Gaming', color: '#FF6347', permissions: [], reason: 'Gaming Enthusiast' },
            { name: 'Design/Art', color: '#DA70D6', permissions: [], reason: 'Design/Art Enthusiast' },
            { name: 'Coding/Dev', color: '#32CD32', permissions: [], reason: 'Coding/Dev Enthusiast' },
            { name: 'Music', color: '#BA55D3', permissions: [], reason: 'Music Lover' },
            { name: 'Dance', color: '#FF1493', permissions: [], reason: 'Dance Enthusiast' },
            { name: 'Reading/Writing', color: '#BDB76B', permissions: [], reason: 'Reading/Writing Enthusiast' },
            { name: 'Sports', color: '#4169E1', permissions: [], reason: 'Sports Enthusiast' }
        ];

        const createdRoles = {};
        for (const roleData of rolesToCreate) {
            // Normalize role name for key (e.g., "FSU Executive" -> "fsuexecutive")
            const roleKey = roleData.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            createdRoles[roleKey] = await _createRole(guild, roleData);
        }
        
        await _updateSetupStatus(statusMessage, 'Creating categories and channels...');

        // Define common permission overwrites using role IDs
        const everyoneId = guild.roles.everyone.id;
        const adminId = _getRoleById(createdRoles, 'admin');
        const moderatorId = _getRoleById(createdRoles, 'moderator');
        const fsuExecutiveId = _getRoleById(createdRoles, 'fsuexecutive');
        const alumniId = _getRoleById(createdRoles, 'alumni');
        const guestSpeakerId = _getRoleById(createdRoles, 'guestspeaker');
        const pulchowkBotId = _getRoleById(createdRoles, 'pulchowkbot');
        const fsuBotId = _getRoleById(createdRoles, 'fsubot');
        const studentId = _getRoleById(createdRoles, 'student');


        // Permission Presets
        const publicViewOnly = [{ id: everyoneId, allow: [PermissionsBitField.Flags.ViewChannel], deny: [PermissionsBitField.Flags.SendMessages] }];
        const publicReadWrite = [{ id: everyoneId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }];
        const staffOnly = [ // Admin and Moderator only view
            { id: everyoneId, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: adminId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
            { id: moderatorId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
            { id: fsuExecutiveId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] } // FSU Executive also part of staff
        ];
        const alumniOnlyPermissions = [
            { id: everyoneId, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: alumniId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ];
        const announcementPermissions = [ // View by all, send by FSU Executive, Admin, Moderator
            { id: everyoneId, allow: [PermissionsBitField.Flags.ViewChannel], deny: [PermissionsBitField.Flags.SendMessages] },
            { id: fsuExecutiveId, allow: [PermissionsBitField.Flags.SendMessages] },
            { id: adminId, allow: [PermissionsBitField.Flags.SendMessages] },
            { id: moderatorId, allow: [PermissionsBitField.Flags.SendMessages] }
        ];
        const pollSuggestionPermissions = [ // View by all, send/create by Admin, Moderator
            { id: everyoneId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }, // Allow everyone to view and send messages by default
            { id: everyoneId, deny: [PermissionsBitField.Flags.SendMessages] }, // Then deny everyone from sending messages
            { id: adminId, allow: [PermissionsBitField.Flags.SendMessages] },
            { id: moderatorId, allow: [PermissionsBitField.Flags.SendMessages] }
        ];
        const financialForumPermissions = [ // View by all, thread creation by FSU Executive, Admin, Moderator, replies by all
            { id: everyoneId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessagesInThreads] }, // Everyone can view and reply in threads
            { id: everyoneId, deny: [PermissionsBitField.Flags.CreatePublicThreads] }, // Deny everyone from creating threads
            { id: fsuExecutiveId, allow: [PermissionsBitField.Flags.CreatePublicThreads] },
            { id: adminId, allow: [PermissionsBitField.Flags.CreatePublicThreads] },
            { id: moderatorId, allow: [PermissionsBitField.Flags.CreatePublicThreads] }
        ];
        const pulchowkSamvadGuestPermissions = [ // Private for staff
            { id: everyoneId, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: adminId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
            { id: moderatorId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
            { id: fsuExecutiveId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
            { id: guestSpeakerId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] } // Guests can view/send in this specific channel
        ];
        const pulchowkSamvadStagePermissions = [ // Stage channel permissions
            { id: everyoneId, deny: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak] },
            { id: fsuExecutiveId, allow: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak, PermissionsBitField.Flags.MuteMembers, PermissionsBitField.Flags.DeafenMembers, PermissionsBitField.Flags.MoveMembers] },
            { id: adminId, allow: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak, PermissionsBitField.Flags.MuteMembers, PermissionsBitField.Flags.DeafenMembers, PermissionsBitField.Flags.MoveMembers] },
            { id: moderatorId, allow: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak, PermissionsBitField.Flags.MuteMembers, PermissionsBitField.Flags.DeafenMembers, PermissionsBitField.Flags.MoveMembers] },
            { id: guestSpeakerId, allow: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak] }
        ];
        const botChannelPermissions = [ // Pulchowk Bot and Staff only
            { id: everyoneId, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: pulchowkBotId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
            { id: fsuBotId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }, // FSU Bot also has permissions here
            { id: adminId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
            { id: moderatorId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
            { id: fsuExecutiveId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ];


        const SERVER_STRUCTURE = [
            {
                name: '🟢 Welcome & Onboarding',
                type: ChannelType.GuildCategory,
                permissionOverwrites: publicReadWrite, // Category visible to everyone
                channels: [
                    { name: '📜┃welcome', type: ChannelType.GuildText, topic: 'Welcome! Please verify your identity and read the community rules.', permissionOverwrites: publicReadWrite, initialMessage: {
                        title: 'Welcome to Pulchowk Campus FSU Discord!',
                        description: 'We\'re thrilled to have you here. To get started, please check out the channels below:\n\n' +
                                     '➡️ **<#CHANNEL_ID_RULES_AND_ROLES>** - Learn about our community rules and pick up roles.\n' +
                                     '➡️ **<#CHANNEL_ID_FAQ>** - Find answers to common questions.\n' +
                                     '➡️ **<#CHANNEL_ID_INTRODUCTIONS>** - Introduce yourself to the community!',
                        color: '#0099ff'
                    }},
                    { name: '📘┃rules-and-roles', type: ChannelType.GuildText, topic: 'Know the rules. Choose your roles. Stay cool. 🕶️', permissionOverwrites: publicReadWrite, initialMessage: {
                        title: '📚 Rules & Roles Guide',
                        description: 'Please read our server rules carefully to ensure a positive environment for everyone. Once you\'ve reviewed them, head over to the self-assignable roles section (if available) to get your relevant roles!',
                        color: '#FFD700'
                    }},
                    { name: '👋┃introductions', type: ChannelType.GuildText, topic: 'Introduce yourself to the community.', permissionOverwrites: publicReadWrite },
                    { name: '❓┃faq', type: ChannelType.GuildText, topic: 'Frequently asked questions and help.', permissionOverwrites: publicReadWrite }
                ]
            },
            {
                name: '📣 Announcements & Updates',
                type: ChannelType.GuildCategory,
                permissionOverwrites: publicViewOnly, // Category visible to everyone, but only specific roles can send messages within channels
                channels: [
                    { name: '📢┃announcements', type: ChannelType.GuildText, topic: 'Official FSU announcements.', permissionOverwrites: announcementPermissions },
                    { name: '💼┃opportunities', type: ChannelType.GuildText, topic: 'Job, internship, and other opportunities.', permissionOverwrites: announcementPermissions },
                    { name: '🗓️┃event-calendar', type: ChannelType.GuildText, topic: 'Upcoming events and important dates.', permissionOverwrites: announcementPermissions },
                    { name: '📦┃lost-and-found', type: ChannelType.GuildText, topic: 'Lost and Found items around campus.', permissionOverwrites: publicReadWrite },
                    { name: '🎂┃birthday', type: ChannelType.GuildText, topic: 'Birthday announcements for community members.', permissionOverwrites: announcementPermissions }
                ]
            },
            {
                name: '📚 Academic Support',
                type: ChannelType.GuildCategory,
                permissionOverwrites: publicReadWrite,
                channels: [
                    { name: '📚┃resources', type: ChannelType.GuildForum, topic: 'Share and find academic resources.', permissionOverwrites: financialForumPermissions }, // Reusing financialForumPermissions for thread creation restriction
                    { name: '📂┃resource-request', type: ChannelType.GuildText, topic: 'Request specific academic resources.', permissionOverwrites: publicReadWrite },
                    { name: '📖┃study-groups', type: ChannelType.GuildText, topic: 'Organize and join study groups.', permissionOverwrites: publicReadWrite },
                    { name: '🧠┃subject-help', type: ChannelType.GuildText, topic: 'Get help with specific subjects.', permissionOverwrites: publicReadWrite }
                ]
            },
            {
                name: '💬 Social & Community',
                type: ChannelType.GuildCategory,
                permissionOverwrites: publicReadWrite,
                channels: [
                    { name: '💬┃general-chat', type: ChannelType.GuildText, topic: 'General discussions for the FSU community.', permissionOverwrites: publicReadWrite },
                    { name: '💊┃anime-manga', type: ChannelType.GuildText, topic: 'Discuss anime, manga, and related topics.', permissionOverwrites: publicReadWrite },
                    { name: '🤣┃memes', type: ChannelType.GuildText, topic: 'Share your favorite memes!', permissionOverwrites: publicReadWrite },
                    { name: '🎨┃hobbies', type: ChannelType.GuildText, topic: 'Connect with others about hobbies and interests.', permissionOverwrites: publicReadWrite },
                    { name: '🎮┃gaming', type: ChannelType.GuildText, topic: 'Find teammates and discuss games.', permissionOverwrites: publicReadWrite },
                    { name: '🎵┃share-music', type: ChannelType.GuildText, topic: 'Share your favorite tunes and artists.', permissionOverwrites: publicReadWrite },
                    { name: '📸┃college-highlights', type: ChannelType.GuildText, topic: 'Share memorable moments and photos from college life.', permissionOverwrites: publicReadWrite },
                    {
                        name: '💵┃financial-forum', type: ChannelType.GuildForum,
                        topic: `This forum is for transparency and smart spending by the Student Union.
:pencil: What to Post:
Only Student Union members should create posts.
Posts should be about planned or completed purchases using student union funds.
:white_check_mark: Post Format:
\`\`\`
**Item:** [Name of item/service]
**Quantity:** [How many?]
**Quoted Price:** [Amount and currency]
**Vendor:** [Shop name or online source]
**Purpose:** [Why it's being bought]
**Date of Purchase (or Planned Date):** [YYYY-MM-DD]
\`\`\`
Note: The ** are there to bold the words
:speech_balloon: Who Can Reply:
Anyone can reply to suggest:
Better prices or vendors
Tips (bulk deals, student discounts, etc.)
Questions about the purchase
NOTE: Replies should stay respectful and helpful. :warning: Rules:
No off-topic comments.
No spam.
Stay on-topic and civil in all replies.
If an alternate suggestion is accepted and used, please edit the original post to reflect the updated info.`,
                        permissionOverwrites: financialForumPermissions,
                        initialMessage: {
                            title: 'Transparency in Student Union Finances 💵',
                            description: `This forum is dedicated to transparent financial reporting and community oversight of Student Union spending.
                            
                            **📝 What to Post:**
                            * Only Student Union members should create new posts (threads).
                            * Posts should detail planned or completed purchases using student union funds.
                            
                            **✅ Post Format:**
                            \`\`\`
                            **Item:** [Name of item/service]
                            **Quantity:** [How many?]
                            **Quoted Price:** [Amount and currency]
                            **Vendor:** [Shop name or online source]
                            **Purpose:** [Why it's being bought]
                            **Date of Purchase (or Planned Date):** [YYYY-MM-DD]
                            \`\`\`
                            
                            **💬 Who Can Reply:**
                            * Anyone can reply to suggest:
                                * Better prices or vendors
                                * Tips (bulk deals, student discounts, etc.)
                                * Questions about the purchase
                            
                            **⚠️ Rules:**
                            * No off-topic comments.
                            * No spam.
                            * Stay on-topic and civil in all replies.
                            * If an alternate suggestion is accepted and used, please edit the original post to reflect the updated info.`,
                            color: '#FFD700'
                        }
                    },
                    { name: '🫂┃pulchowk-samvad-guests', type: ChannelType.GuildText, topic: 'Private channel for Pulchowk Samvad guests.', permissionOverwrites: pulchowkSamvadGuestPermissions },
                    { name: 'पुल्चोक संवाद', type: ChannelType.GuildStageVoice, topic: 'Official stage channel for Pulchowk Samvad events.', permissionOverwrites: pulchowkSamvadStagePermissions }
                ]
            },
            {
                name: '🏛 Clubs & Societies',
                type: ChannelType.GuildCategory,
                permissionOverwrites: publicViewOnly, // Category visible to everyone, but specific roles can send in announcement type channels
                channels: [
                    { name: '🏛 Clubs & Societies', type: ChannelType.GuildText, topic: 'Announcements and information related to various clubs and societies.', permissionOverwrites: announcementPermissions },
                    { name: '🔗┃connection-links', type: ChannelType.GuildText, topic: 'Share links to club social media, websites, and resources.', permissionOverwrites: publicReadWrite },
                    { name: '🎤┃club-discussions', type: ChannelType.GuildText, topic: 'General discussions for club members and enthusiasts.', permissionOverwrites: publicReadWrite },
                    { name: '♣️┃club-requests', type: ChannelType.GuildText, topic: 'Request new clubs or express interest in starting one.', permissionOverwrites: publicReadWrite }
                ]
            },
            {
                name: '🧑🏫 Alumni Section',
                type: ChannelType.GuildCategory,
                permissionOverwrites: alumniOnlyPermissions,
                channels: [
                    { name: '💼┃alumni-opportunities', type: ChannelType.GuildText, topic: 'Job, networking, and other opportunities for alumni.', permissionOverwrites: alumniOnlyPermissions },
                    { name: '🏛️┃alumni-hub', type: ChannelType.GuildText, topic: 'A dedicated space for alumni discussions and connections.', permissionOverwrites: alumniOnlyPermissions },
                    { name: '🧭┃alumni-mentorship', type: ChannelType.GuildText, topic: 'Connect with current students for mentorship.', permissionOverwrites: alumniOnlyPermissions },
                    { name: '🌟┃alumni-spotlight', type: ChannelType.GuildText, topic: 'Showcase achievements and stories of notable alumni.', permissionOverwrites: alumniOnlyPermissions }
                ]
            },
            {
                name: '🗃Feedback and Suggestion',
                type: ChannelType.GuildCategory,
                permissionOverwrites: publicReadWrite,
                channels: [
                    { name: '📝┃suggestions', type: ChannelType.GuildText, topic: 'Submit your suggestions for server improvements.', permissionOverwrites: publicReadWrite },
                    { name: '📊┃polls', type: ChannelType.GuildText, topic: 'Participate in polls and surveys.', permissionOverwrites: pollSuggestionPermissions },
                    { name: '📢┃request-events-opportunity', type: ChannelType.GuildText, topic: 'Request specific events or opportunities to be hosted.', permissionOverwrites: publicReadWrite }
                ]
            },
            {
                name: '🚨Staff🚨',
                type: ChannelType.GuildCategory,
                permissionOverwrites: staffOnly,
                channels: [
                    { name: '🏰┃staff-chat', type: ChannelType.GuildText, topic: 'General chat for server staff.', permissionOverwrites: staffOnly },
                    { name: '📊┃server-moderation', type: ChannelType.GuildText, topic: 'Discussions and logs related to server moderation actions.', permissionOverwrites: staffOnly },
                    { name: '🪵┃server-log', type: ChannelType.GuildText, topic: 'Automatic server logs and audit trail.', permissionOverwrites: staffOnly },
                    { name: '💫┃pulchowk-bot', type: ChannelType.GuildText, topic: 'Bot status, commands, and debugging channel.', permissionOverwrites: botChannelPermissions },
                    { name: '⚙️┃test-webhook', type: ChannelType.GuildText, topic: 'Channel for testing webhooks.', permissionOverwrites: staffOnly },
                    { name: '🛠️┃fsu-log', type: ChannelType.GuildText, topic: 'Logs and discussions for FSU-specific activities.', permissionOverwrites: staffOnly },
                    { name: '⛲Staff Voice', type: ChannelType.GuildVoice, topic: 'Voice chat for staff discussions.', permissionOverwrites: staffOnly },
                    { name: '🎙Interview Room', type: ChannelType.GuildVoice, topic: 'Private voice channel for interviews.', permissionOverwrites: staffOnly }
                ]
            }
        ];

        // Store created channel IDs to replace placeholders in initial messages
        const createdChannelIds = {};

        for (const categoryData of SERVER_STRUCTURE) {
            const createdCategory = await _createCategory(guild, categoryData.name, categoryData.permissionOverwrites);
            for (const channelData of categoryData.channels) {
                let createdChannel;
                switch (channelData.type) {
                    case ChannelType.GuildText:
                        createdChannel = await _createTextChannel(guild, channelData.name, createdCategory.id, channelData.permissionOverwrites, channelData.topic);
                        break;
                    case ChannelType.GuildVoice:
                        createdChannel = await _createVoiceChannel(guild, channelData.name, createdCategory.id, channelData.permissionOverwrites);
                        break;
                    case ChannelType.GuildForum:
                        createdChannel = await _createForumChannel(guild, channelData.name, createdCategory.id, channelData.permissionOverwrites, channelData.topic);
                        break;
                    case ChannelType.GuildStageVoice:
                        createdChannel = await _createStageChannel(guild, channelData.name, createdCategory.id, channelData.permissionOverwrites);
                        break;
                    default:
                        console.warn(`Unknown channel type: ${channelData.type} for channel ${channelData.name}`);
                        continue;
                }
                // Store channel ID for later use in initial messages
                createdChannelIds[channelData.name.toLowerCase().replace(/[^a-z0-9]/g, '')] = createdChannel.id;
            }
        }

        await _updateSetupStatus(statusMessage, 'Sending initial messages to channels...');

        // Send initial messages to specific channels after all are created
        for (const categoryData of SERVER_STRUCTURE) {
            for (const channelData of categoryData.channels) {
                if (channelData.initialMessage) {
                    const channelNameKey = channelData.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                    const targetChannelId = createdChannelIds[channelNameKey];

                    if (targetChannelId) {
                        const targetChannel = guild.channels.cache.get(targetChannelId);
                        if (targetChannel && (targetChannel.type === ChannelType.GuildText || targetChannel.type === ChannelType.GuildForum)) {
                            let description = channelData.initialMessage.description;
                            // Replace placeholders with actual channel IDs
                            description = description.replace(/<#CHANNEL_ID_RULES_AND_ROLES>/g, `<#${createdChannelIds['rulesandroles']}>`);
                            description = description.replace(/<#CHANNEL_ID_FAQ>/g, `<#${createdChannelIds['faq']}>`);
                            description = description.replace(/<#CHANNEL_ID_INTRODUCTIONS>/g, `<#${createdChannelIds['introductions']}>`);

                            const embed = new EmbedBuilder()
                                .setColor(channelData.initialMessage.color)
                                .setTitle(channelData.initialMessage.title)
                                .setDescription(description)
                                .setTimestamp();
                            await targetChannel.send({ embeds: [embed] }).catch(console.error);
                            console.log(`Sent initial message to #${channelData.name}`);
                        }
                    }
                }
            }
        }

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