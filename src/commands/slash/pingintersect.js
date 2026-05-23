/**
 * @file pingintersect.js
 * @description Pings members who possess ALL of the specified roles (intersection).
 * Designed for targeted notifications in servers.
 * * Features:
 * - Supports 2 to 10 roles.
 * - Handles Discord character limits by chunking ping messages.
 * - Enforces permissions (Manage Guild).
 * - Implements safety validations (no duplicate roles, no @everyone).
 */

import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionsBitField,
    MessageFlags
} from 'discord.js';

// Configuration for role input slots
const REQUIRED_ROLES = 2;
const OPTIONAL_ROLES = 8;
const MAX_ROLES = REQUIRED_ROLES + OPTIONAL_ROLES;

// Dynamically build the SlashCommand structure
const builder = new SlashCommandBuilder()
    .setName('pingintersect')
    .setDescription('Pings members who have ALL of the specified roles (intersection of up to 10 roles).')
    .addStringOption(option =>
        option.setName('message')
            .setDescription('Optional message to include with the ping')
            .setRequired(false)
            .setMaxLength(500)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild);

// Register Required Roles (slots 1-2)
for (let i = 1; i <= REQUIRED_ROLES; i++) {
    builder.addRoleOption(option =>
        option.setName(`role_${i}`)
            .setDescription(`Role ${i} (required)`)
            .setRequired(true)
    );
}

// Register Optional Roles (slots 3-10)
for (let i = REQUIRED_ROLES + 1; i <= MAX_ROLES; i++) {
    builder.addRoleOption(option =>
        option.setName(`role_${i}`)
            .setDescription(`Role ${i} (optional)`)
            .setRequired(false)
    );
}

export const data = builder;

/**
 * Execute command logic
 * @param {import('discord.js').ChatInputCommandInteraction} interaction 
 */
export async function execute(interaction) {
    // 1. Basic environment and permission check
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // 2. Aggregate provided roles
    const roles = [];
    for (let i = 1; i <= MAX_ROLES; i++) {
        const role = interaction.options.getRole(`role_${i}`);
        if (role) roles.push(role);
    }

    // 3. Perform safety validations
    const everyoneRole = roles.find(r => r.name === '@everyone' || r.id === interaction.guild.id);
    if (everyoneRole) {
        return interaction.editReply({ content: '❌ The `@everyone` role cannot be used with this command.' });
    }

    const uniqueIds = new Set(roles.map(r => r.id));
    if (uniqueIds.size !== roles.length) {
        return interaction.editReply({ content: '❌ You have provided the same role more than once.' });
    }

    if (roles.length < 2) {
        return interaction.editReply({ content: '❌ Please provide at least **2** different roles to compute an intersection.' });
    }

    const customMessage = interaction.options.getString('message') || null;

    // 4. Fetch all members
    let members;
    try {
        members = await interaction.guild.members.fetch();
    } catch (err) {
        console.error('[pingintersect] Failed to fetch guild members:', err);
        return interaction.editReply({ content: '❌ Could not fetch guild members. Ensure the bot has the **Guild Members** intent enabled.' });
    }

    // 5. Calculate intersection (filter members who have ALL role IDs)
    const roleIds = roles.map(r => r.id);
    const intersection = members.filter(
        m => !m.user.bot && roleIds.every(id => m.roles.cache.has(id))
    );

    if (intersection.size === 0) {
        const roleList = roles.map(r => `**${r.name}**`).join(', ');
        return interaction.editReply({ content: `ℹ️ No members found with **all** of these roles: ${roleList}.` });
    }

    // 6. Partition mentions into chunks (to prevent exceeding Discord's 2000-char limit)
    const mentions = intersection.map(m => `<@${m.id}>`);
    const intersectionUserIds = intersection.map(m => m.id);
    const CHUNK_CHAR_LIMIT = 1900;
    const chunks = [];
    let current = '';

    for (const mention of mentions) {
        if (current.length + mention.length + 1 > CHUNK_CHAR_LIMIT) {
            chunks.push(current.trim());
            current = mention + ' ';
        } else {
            current += mention + ' ';
        }
    }
    if (current.trim()) chunks.push(current.trim());

    // 7. Send notification messages
    try {
        const roleNames = roles.map(r => `\`${r.name}\``).join(' ∩ ');
        const header = (customMessage ? `📢 **${customMessage}**\n` : '') + 
                       `*Pinging **${intersection.size}** member(s) with all of: ${roleNames}*`;

        await interaction.channel.send({
            content: header + '\n\n' + chunks[0],
            allowedMentions: { users: intersectionUserIds }
        });

        // Send additional chunks if necessary
        for (let i = 1; i < chunks.length; i++) {
            await interaction.channel.send({
                content: chunks[i],
                allowedMentions: { users: intersectionUserIds }
            });
        }
    } catch (err) {
        console.error('[pingintersect] Failed to send ping:', err);
        return interaction.editReply({ content: `❌ Failed to send ping: ${err.message}` });
    }

    // 8. Ephemeral summary for the moderator
    const summaryEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('✅ Intersection Ping Sent')
        .setDescription(roles.map((r, i) => `**Role ${i + 1}:** ${r} (\`${r.name}\`)`).join('\n'))
        .addFields(
            { name: 'Operation', value: roles.map(r => r.name).join(' ∩ '), inline: false },
            { name: 'Members Pinged', value: intersection.size.toString(), inline: true },
            { name: 'Roles Used', value: roles.length.toString(), inline: true },
            { name: 'Channel', value: `${interaction.channel}`, inline: true }
        )
        .setFooter({ text: `Executed by ${interaction.user.tag}` })
        .setTimestamp();

    if (customMessage) summaryEmbed.addFields({ name: 'Message', value: customMessage, inline: false });

    await interaction.editReply({ embeds: [summaryEmbed] });
}