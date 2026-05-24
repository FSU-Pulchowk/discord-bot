// src/commands/slash/pingintersect.js
//
// Pings only members who have ALL of the specified roles (intersection).
// Supports 2–10 roles. No temporary roles. No database writes. One-time ping.
//
import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionsBitField,
    MessageFlags
} from 'discord.js';

// ── How many role slots to expose in the command (2 required + 8 optional = 10 max) ──
const REQUIRED_ROLES = 2;
const OPTIONAL_ROLES = 8; // total max = 10

// Build the command data dynamically so the slot definitions stay DRY
// Discord rule: required options MUST come before optional ones
const builder = new SlashCommandBuilder()
    .setName('pingintersect')
    .setDescription('Pings members who have ALL of the specified roles (intersection of up to 10 roles).')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild);

// 1. Add required role slots FIRST
for (let i = 1; i <= REQUIRED_ROLES; i++) {
    builder.addRoleOption(option =>
        option
            .setName(`role_${i}`)
            .setDescription(`Role ${i} (required)`)
            .setRequired(true)
    );
}

// 2. Add optional role slots SECOND
for (let i = REQUIRED_ROLES + 1; i <= REQUIRED_ROLES + OPTIONAL_ROLES; i++) {
    builder.addRoleOption(option =>
        option
            .setName(`role_${i}`)
            .setDescription(`Role ${i} (optional)`)
            .setRequired(false)
    );
}

// 3. Add optional message option LAST (optional options must follow required ones)
builder.addStringOption(option =>
    option.setName('message')
        .setDescription('Optional message to include with the ping')
        .setRequired(false)
        .setMaxLength(500)
);

export const data = builder;

export async function execute(interaction) {
    // ── Permission checks ──────────────────────────────────────────────────
    if (!interaction.guild) {
        return interaction.reply({
            content: 'This command can only be used in a server.',
            flags: MessageFlags.Ephemeral
        });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({
            content: '❌ You do not have permission to use this command.',
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // ── Collect all provided roles (skip nulls from optional slots) ────────
    const totalSlots = REQUIRED_ROLES + OPTIONAL_ROLES;
    const roles = [];

    for (let i = 1; i <= totalSlots; i++) {
        const role = interaction.options.getRole(`role_${i}`);
        if (role) roles.push(role);
    }

    // ── Validate: no @everyone ─────────────────────────────────────────────
    const everyoneRole = roles.find(r => r.name === '@everyone' || r.id === interaction.guild.id);
    if (everyoneRole) {
        return interaction.editReply({
            content: '❌ The `@everyone` role cannot be used with this command.'
        });
    }

    // ── Validate: no duplicate roles ───────────────────────────────────────
    const uniqueIds = new Set(roles.map(r => r.id));
    if (uniqueIds.size !== roles.length) {
        return interaction.editReply({
            content: '❌ You have provided the same role more than once. Each role must be unique.'
        });
    }

    // ── Validate: at least 2 distinct roles ───────────────────────────────
    if (roles.length < 2) {
        return interaction.editReply({
            content: '❌ Please provide at least **2** different roles to compute an intersection.'
        });
    }

    const customMessage = interaction.options.getString('message') || null;

    // ── Fetch all guild members ────────────────────────────────────────────
    let members;
    try {
        members = await interaction.guild.members.fetch();
    } catch (err) {
        console.error('[pingintersect] Failed to fetch guild members:', err);
        return interaction.editReply({
            content: '❌ Could not fetch guild members. Ensure the bot has the **Guild Members** intent enabled.'
        });
    }

    // ── Compute intersection: members who have EVERY selected role ─────────
    const roleIds = roles.map(r => r.id);
    const intersection = members.filter(
        m => !m.user.bot && roleIds.every(id => m.roles.cache.has(id))
    );

    if (intersection.size === 0) {
        const roleList = roles.map(r => `**${r.name}**`).join(', ');
        return interaction.editReply({
            content: `ℹ️ No members found with **all** of these roles: ${roleList}.\nNobody was pinged.`
        });
    }

    // ── Build ping chunks (Discord 2000-char message limit) ────────────────
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

    // ── Send ping messages in the channel ─────────────────────────────────
    try {
        const roleNames = roles.map(r => `\`${r.name}\``).join(' ∩ ');

        const headerLines = [];
        if (customMessage) headerLines.push(`📢 **${customMessage}**`);
        headerLines.push(`*Pinging **${intersection.size}** member(s) with all of: ${roleNames}*`);

        // First message: header + first chunk of mentions
        await interaction.channel.send({
            content: headerLines.join('\n') + '\n\n' + chunks[0],
            allowedMentions: { users: intersectionUserIds }
        });

        // Any overflow chunks
        for (let i = 1; i < chunks.length; i++) {
            await interaction.channel.send({
                content: chunks[i],
                allowedMentions: { users: intersectionUserIds }
            });
        }
    } catch (err) {
        console.error('[pingintersect] Failed to send ping message(s):', err);
        return interaction.editReply({
            content: `❌ Failed to send ping: ${err.message}`
        });
    }

    // ── Ephemeral summary for the executor ────────────────────────────────
    const summaryEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('✅ Intersection Ping Sent')
        .setDescription(
            roles.map((r, i) => `**Role ${i + 1}:** ${r} (\`${r.name}\`)`).join('\n')
        )
        .addFields(
            { name: 'Operation', value: roles.map(r => r.name).join(' ∩ '), inline: false },
            { name: 'Members Pinged', value: intersection.size.toString(), inline: true },
            { name: 'Roles Used', value: roles.length.toString(), inline: true },
            { name: 'Channel', value: `${interaction.channel}`, inline: true }
        )
        .setFooter({ text: `Executed by ${interaction.user.tag}` })
        .setTimestamp();

    if (customMessage) {
        summaryEmbed.addFields({ name: 'Message', value: customMessage, inline: false });
    }

    await interaction.editReply({ embeds: [summaryEmbed] });
}