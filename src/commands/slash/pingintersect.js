// src/commands/slash/pingintersect.js
//
// Pings members who have ALL of the specified roles (intersection),
// or optionally members with the specified roles EXCEPT those with all of them.
// Prompts via Modal whether to create a temporary role to ping and clean up.

import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionsBitField,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
} from 'discord.js';

// In-memory store for pending modal sessions
const pendingIntersections = new Map();
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ── Role slot configuration (2 required + 8 optional = 10 max) ──
const REQUIRED_ROLES = 2;
const OPTIONAL_ROLES = 8; // total max = 10

const builder = new SlashCommandBuilder()
    .setName('pingintersect')
    .setDescription('Pings members who have ALL specified roles (or optionally except them).')
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

// 3. Add except_them boolean option (optional)
builder.addBooleanOption(option =>
    option
        .setName('except_them')
        .setDescription('Want to ping members with the specified roles EXCEPT those having all of them?')
        .setRequired(false)
);

// 4. Add optional message option LAST
builder.addStringOption(option =>
    option
        .setName('message')
        .setDescription('Optional message to include with the ping')
        .setRequired(false)
        .setMaxLength(500)
);

export const data = builder;

export async function execute(interaction) {
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

    // ── Collect all provided roles ─────────────────────────────────────────
    const totalSlots = REQUIRED_ROLES + OPTIONAL_ROLES;
    const roles = [];

    for (let i = 1; i <= totalSlots; i++) {
        const role = interaction.options.getRole(`role_${i}`);
        if (role) roles.push(role);
    }

    // ── Validate: no @everyone ─────────────────────────────────────────────
    const everyoneRole = roles.find(r => r.name === '@everyone' || r.id === interaction.guild.id);
    if (everyoneRole) {
        return interaction.reply({
            content: '❌ The `@everyone` role cannot be used with this command.',
            flags: MessageFlags.Ephemeral
        });
    }

    // ── Validate: no duplicate roles ───────────────────────────────────────
    const uniqueIds = new Set(roles.map(r => r.id));
    if (uniqueIds.size !== roles.length) {
        return interaction.reply({
            content: '❌ You have provided the same role more than once. Each role must be unique.',
            flags: MessageFlags.Ephemeral
        });
    }

    // ── Validate: at least 2 distinct roles ────────────────────────────────
    if (roles.length < 2) {
        return interaction.reply({
            content: '❌ Please provide at least **2** different roles to compute an intersection.',
            flags: MessageFlags.Ephemeral
        });
    }

    const exceptThem = interaction.options.getBoolean('except_them') ?? false;
    const customMessage = interaction.options.getString('message') || '';

    // ── Store pending parameters in-memory ────────────────────────────────
    const sessionId = `${interaction.id}_${Date.now()}`;
    pendingIntersections.set(sessionId, {
        roleIds: roles.map(r => r.id),
        exceptThem,
        customMessage,
        channelId: interaction.channelId,
        guildId: interaction.guildId,
        userId: interaction.user.id
    });

    setTimeout(() => {
        pendingIntersections.delete(sessionId);
    }, SESSION_TTL_MS);

    // ── Present modal asking if they want to create a temporary role ──────
    const modal = new ModalBuilder()
        .setCustomId(`pingintersect_modal_${sessionId}`)
        .setTitle('Ping Intersection Setup');

    const tempRoleInput = new TextInputBuilder()
        .setCustomId('want_temp_role')
        .setLabel('Want to create temporary role? (yes/no)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Type "yes" for temp role, or "no" for direct pings')
        .setValue('no')
        .setMaxLength(10)
        .setRequired(false);

    const messageInput = new TextInputBuilder()
        .setCustomId('ping_message')
        .setLabel('Message to include with ping (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Enter message or announcement to include with the ping...')
        .setValue(customMessage)
        .setMaxLength(1000)
        .setRequired(false);

    modal.addComponents(
        new ActionRowBuilder().addComponents(tempRoleInput),
        new ActionRowBuilder().addComponents(messageInput)
    );

    return interaction.showModal(modal);
}

/**
 * Handles submission of the /pingintersect configuration modal
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 */
export async function handlePingIntersectModal(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const customId = interaction.customId;
    const sessionId = customId.replace('pingintersect_modal_', '');
    const session = pendingIntersections.get(sessionId);

    if (!session) {
        return interaction.editReply({
            content: '⚠️ This ping session has expired. Please run `/pingintersect` again.'
        });
    }

    pendingIntersections.delete(sessionId);

    const { roleIds, exceptThem, customMessage: initialMessage } = session;

    // Check user responses from modal
    const wantTempRoleRaw = (interaction.fields.getTextInputValue('want_temp_role') ?? '').trim().toLowerCase();
    const wantTempRole = ['yes', 'y', 'true', '1'].includes(wantTempRoleRaw);
    const modalMessage = (interaction.fields.getTextInputValue('ping_message') ?? '').trim();
    const finalMessage = modalMessage || initialMessage || null;

    // Resolve roles from cache
    const roles = roleIds.map(id => interaction.guild.roles.cache.get(id)).filter(Boolean);
    if (roles.length < 2) {
        return interaction.editReply({
            content: '❌ One or more selected roles could not be found in this server.'
        });
    }

    // If temporary role requested, verify bot permissions
    if (wantTempRole) {
        const botMember = interaction.guild.members.me;
        if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            return interaction.editReply({
                content: '❌ The bot lacks the **Manage Roles** permission required to create and assign temporary roles.'
            });
        }
    }

    // Fetch guild members
    let members;
    try {
        members = await interaction.guild.members.fetch();
    } catch (err) {
        console.error('[pingintersect] Failed to fetch guild members:', err);
        return interaction.editReply({
            content: '❌ Could not fetch guild members. Ensure the bot has the **Guild Members** intent enabled.'
        });
    }

    // Compute target members based on intersection or except_them
    const targetMembers = exceptThem
        ? members.filter(m => !m.user.bot && roleIds.some(id => m.roles.cache.has(id)) && !roleIds.every(id => m.roles.cache.has(id)))
        : members.filter(m => !m.user.bot && roleIds.every(id => m.roles.cache.has(id)));

    if (targetMembers.size === 0) {
        const roleList = roles.map(r => `**${r.name}**`).join(', ');
        const reason = exceptThem
            ? `No members found with specified roles except the intersection (${roleList}).`
            : `No members found with **all** of these roles: ${roleList}.`;
        return interaction.editReply({
            content: `ℹ️ ${reason}\nNobody was pinged.`
        });
    }

    const roleNames = roles.map(r => `\`${r.name}\``).join(exceptThem ? ' ∪ ' : ' ∩ ');

    // ── Handle temporary role creation & ping ──────────────────────────────
    if (wantTempRole) {
        let tempRole = null;
        try {
            // Merge role names
            const mergedNames = roles.map(r => r.name).join(' + ');
            let tempRoleName = exceptThem ? `[Temp] ${mergedNames} (Except)` : `[Temp] ${mergedNames}`;
            if (tempRoleName.length > 100) {
                tempRoleName = tempRoleName.substring(0, 97) + '...';
            }

            // Create temporary role
            tempRole = await interaction.guild.roles.create({
                name: tempRoleName,
                mentionable: true,
                reason: `Temporary role created by /pingintersect (${interaction.user.tag})`
            });

            // Add target members to the temporary role
            let addedCount = 0;
            for (const member of targetMembers.values()) {
                try {
                    await member.roles.add(tempRole, 'Temporary role assignment for /pingintersect');
                    addedCount++;
                } catch (assignErr) {
                    console.warn(`[pingintersect] Could not add temp role to ${member.user.tag}:`, assignErr.message);
                }
            }

            // Short pause for Discord role cache propagation
            await new Promise(resolve => setTimeout(resolve, 600));

            // Send ping to the channel
            const pingLines = [];
            if (finalMessage) pingLines.push(`📢 **${finalMessage}**`);
            pingLines.push(`${tempRole}`);
            pingLines.push(`*(Temporary role ping for **${addedCount}** member(s) — role is being cleaned up)*`);

            await interaction.channel.send({
                content: pingLines.join('\n\n'),
                allowedMentions: { roles: [tempRole.id] }
            });

            // Short pause so Discord gateway queues mention notifications before role deletion
            await new Promise(resolve => setTimeout(resolve, 1500));

        } catch (err) {
            console.error('[pingintersect] Error during temporary role workflow:', err);
            return interaction.editReply({
                content: `❌ An error occurred during temporary role creation/ping: ${err.message}`
            });
        } finally {
            // Always delete the temporary role
            if (tempRole) {
                try {
                    await tempRole.delete('Temporary intersection role cleanup');
                } catch (delErr) {
                    console.error('[pingintersect] Failed to delete temp role:', delErr);
                }
            }
        }
    } else {
        // ── Direct member pings ────────────────────────────────────────────
        const headerLines = [];
        if (finalMessage) headerLines.push(`📢 **${finalMessage}**`);
        const subtext = exceptThem
            ? `*Pinging **${targetMembers.size}** member(s) with specified roles EXCEPT those with all: ${roleNames}*`
            : `*Pinging **${targetMembers.size}** member(s) with all of: ${roleNames}*`;
        headerLines.push(subtext);
        const header = headerLines.join('\n');

        const mentions = targetMembers.map(m => `<@${m.id}>`);
        const CHUNK_CHAR_LIMIT = 1900;
        const MAX_MENTIONS_PER_MESSAGE = 80;

        const messages = [];
        let currentContent = header + '\n\n';
        let currentMentionCount = 0;

        for (const mention of mentions) {
            if (
                (currentContent.length + mention.length + 1 > CHUNK_CHAR_LIMIT) ||
                (currentMentionCount >= MAX_MENTIONS_PER_MESSAGE)
            ) {
                if (currentContent.trim()) {
                    messages.push(currentContent.trim());
                }
                currentContent = mention + ' ';
                currentMentionCount = 1;
            } else {
                currentContent += mention + ' ';
                currentMentionCount++;
            }
        }
        if (currentContent.trim()) {
            messages.push(currentContent.trim());
        }

        try {
            for (const messageContent of messages) {
                await interaction.channel.send({
                    content: messageContent,
                    allowedMentions: { parse: ['users'] }
                });
            }
        } catch (err) {
            console.error('[pingintersect] Failed to send ping message(s):', err);
            return interaction.editReply({
                content: `❌ Failed to send ping: ${err.message}`
            });
        }
    }

    // ── Ephemeral summary for the executor ────────────────────────────────
    const summaryEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(exceptThem ? '✅ Inverted Intersection Ping Sent' : '✅ Intersection Ping Sent')
        .setDescription(
            roles.map((r, i) => `**Role ${i + 1}:** ${r} (\`${r.name}\`)`).join('\n')
        )
        .addFields(
            { name: 'Operation', value: exceptThem ? `Roles Except Intersection (${roles.map(r => r.name).join(', ')})` : roles.map(r => r.name).join(' ∩ '), inline: false },
            { name: 'Members Targeted', value: targetMembers.size.toString(), inline: true },
            { name: 'Temporary Role Used', value: wantTempRole ? '✅ Yes (merged & deleted)' : '❌ No (direct pings)', inline: true },
            { name: 'Channel', value: `${interaction.channel}`, inline: true }
        )
        .setFooter({ text: `Executed by ${interaction.user.tag}` })
        .setTimestamp();

    if (finalMessage) {
        summaryEmbed.addFields({ name: 'Message', value: finalMessage, inline: false });
    }

    await interaction.editReply({ embeds: [summaryEmbed] });
}