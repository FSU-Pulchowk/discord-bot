// src/commands/slash/ad.js
// Advertisement Engine slash command.
//
// Subcommand routing:
//   Staff (ManageGuild):   create | list | view | edit | delete | enable | disable |
//                          presence(set/off/status) | priority | scope | schedule | dm | stats
//   Regular members:       Any management subcommand → shows best eligible ad instead.

import {
    SlashCommandBuilder,
    PermissionsBitField,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
} from 'discord.js';

import * as repo from '../../services/ads/adRepository.js';
import * as manager from '../../services/ads/adManager.js';
import { buildAdReply, buildAdEmbed, buildAdComponents, deliverAdToUser } from '../../services/ads/adDelivery.js';
import { getCurrentPresenceAdId, forceRotationTick } from '../../services/ads/adScheduler.js';

export const data = new SlashCommandBuilder()
    .setName('ad')
    .setDescription('Advertisement management (staff) or view current ad (members)')

    .addSubcommand(s => s
        .setName('create')
        .setDescription('Create a new advertisement'))

    .addSubcommand(s => s
        .setName('list')
        .setDescription('List all advertisements')
        .addIntegerOption(o => o.setName('page').setDescription('Page number').setMinValue(1).setRequired(false)))

    .addSubcommand(s => s
        .setName('view')
        .setDescription('View a specific advertisement')
        .addStringOption(o => o.setName('ad_id').setDescription('Advertisement ID (e.g. AD-20260908-7F3A)').setRequired(true)))

    .addSubcommand(s => s
        .setName('edit')
        .setDescription('Edit an existing advertisement')
        .addStringOption(o => o.setName('ad_id').setDescription('Advertisement ID').setRequired(true)))

    .addSubcommand(s => s
        .setName('delete')
        .setDescription('Delete (soft-delete) an advertisement')
        .addStringOption(o => o.setName('ad_id').setDescription('Advertisement ID').setRequired(true)))

    .addSubcommand(s => s
        .setName('enable')
        .setDescription('Enable a disabled advertisement')
        .addStringOption(o => o.setName('ad_id').setDescription('Advertisement ID').setRequired(true)))
    .addSubcommand(s => s
        .setName('disable')
        .setDescription('Disable an advertisement temporarily')
        .addStringOption(o => o.setName('ad_id').setDescription('Advertisement ID').setRequired(true)))

    .addSubcommandGroup(g => g
        .setName('presence')
        .setDescription('Manage the presence advertisement')
        .addSubcommand(s => s
            .setName('set')
            .setDescription('Set an ad as the active presence advertisement')
            .addStringOption(o => o.setName('ad_id').setDescription('Advertisement ID').setRequired(true)))
        .addSubcommand(s => s
            .setName('off')
            .setDescription('Stop all presence ads and restore the static presence'))
        .addSubcommand(s => s
            .setName('status')
            .setDescription('Show which ad is currently controlling presence')))

    .addSubcommand(s => s
        .setName('priority')
        .setDescription('Change the priority of an advertisement')
        .addStringOption(o => o.setName('ad_id').setDescription('Advertisement ID').setRequired(true))
        .addStringOption(o => o
            .setName('level')
            .setDescription('New priority')
            .setRequired(true)
            .addChoices(
                { name: 'Low', value: 'low' },
                { name: 'Normal', value: 'normal' },
                { name: 'High', value: 'high' },
                { name: 'Critical', value: 'critical' },
            )))

    .addSubcommand(s => s
        .setName('scope')
        .setDescription('Change the delivery scope of an advertisement')
        .addStringOption(o => o.setName('ad_id').setDescription('Advertisement ID').setRequired(true))
        .addStringOption(o => o
            .setName('level')
            .setDescription('New scope')
            .setRequired(true)
            .addChoices(
                { name: 'Global', value: 'global' },
                { name: 'Guild', value: 'guild' },
                { name: 'Channel', value: 'channel' },
                { name: 'Role', value: 'role' },
                { name: 'User', value: 'user' },
            ))
        .addStringOption(o => o
            .setName('target_id')
            .setDescription('Channel / Role / User ID (required when scope ≠ global/guild)')
            .setRequired(false)))

    .addSubcommand(s => s
        .setName('schedule')
        .setDescription('Set or clear the start / expiry schedule for an advertisement')
        .addStringOption(o => o.setName('ad_id').setDescription('Advertisement ID').setRequired(true)))

    .addSubcommand(s => s
        .setName('dm')
        .setDescription('Force-send an advertisement to a user via DM')
        .addStringOption(o => o.setName('ad_id').setDescription('Advertisement ID').setRequired(true))
        .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true)))

    .addSubcommand(s => s
        .setName('stats')
        .setDescription('Show delivery statistics for an advertisement')
        .addStringOption(o => o.setName('ad_id').setDescription('Advertisement ID').setRequired(true)));

export async function execute(interaction) {
    const isStaff = interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild);

    if (!isStaff) {
        return handleMemberView(interaction);
    }

    const sub = interaction.options.getSubcommand(false);
    const group = interaction.options.getSubcommandGroup(false);

    if (group === 'presence') {
        switch (sub) {
            case 'set': return handlePresenceSet(interaction);
            case 'off': return handlePresenceOff(interaction);
            case 'status': return handlePresenceStatus(interaction);
        }
    }

    switch (sub) {
        case 'create': return handleCreate(interaction);
        case 'list': return handleList(interaction);
        case 'view': return handleView(interaction);
        case 'edit': return handleEdit(interaction);
        case 'delete': return handleDelete(interaction);
        case 'enable': return handleToggle(interaction, true);
        case 'disable': return handleToggle(interaction, false);
        case 'priority': return handlePriority(interaction);
        case 'scope': return handleScope(interaction);
        case 'schedule': return handleSchedule(interaction);
        case 'dm': return handleForceDm(interaction);
        case 'stats': return handleStats(interaction);
        default:
            return interaction.reply({ content: '⚠️ Unknown subcommand.', flags: MessageFlags.Ephemeral });
    }
}

async function handleMemberView(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const roleIds = interaction.member?.roles?.cache?.map(r => r.id) ?? [];
    const ad = await manager.getAdForMember(
        interaction.guild.id,
        interaction.user.id,
        interaction.channel?.id,
        roleIds
    );

    if (!ad) {
        return interaction.editReply({ content: '📢 There are no active announcements at the moment.' });
    }

    const payload = buildAdReply(ad);
    return interaction.editReply(payload);
}

async function handleCreate(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('ad_create_modal')
        .setTitle('Create Advertisement');

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('ad_title')
                .setLabel('Title')
                .setStyle(TextInputStyle.Short)
                .setMaxLength(256)
                .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('ad_description')
                .setLabel('Description / Content')
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(4000)
                .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('ad_redirect_url')
                .setLabel('Redirect URL (optional)')
                .setStyle(TextInputStyle.Short)
                .setMaxLength(500)
                .setPlaceholder('https://example.com')
                .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('ad_type')
                .setLabel('Type: presence | interaction | announcement')
                .setStyle(TextInputStyle.Short)
                .setMaxLength(20)
                .setValue('presence')
                .setRequired(false)
        ),
    );

    return interaction.showModal(modal);
}

/** Called from interactionCreate.js when the modal is submitted. */
export async function handleAdCreateModal(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const title = interaction.fields.getTextInputValue('ad_title').trim();
    const description = interaction.fields.getTextInputValue('ad_description').trim();
    const redirectRaw = (interaction.fields.getTextInputValue('ad_redirect_url') ?? '').trim();
    const typeRaw = (interaction.fields.getTextInputValue('ad_type') ?? 'presence').trim().toLowerCase();

    const validTypes = ['presence', 'interaction', 'announcement'];
    const type = validTypes.includes(typeRaw) ? typeRaw : 'presence';

    let redirect_url = null;
    if (redirectRaw) {
        try { new URL(redirectRaw); redirect_url = redirectRaw; }
        catch { return interaction.editReply({ content: '❌ Invalid redirect URL. Please enter a valid `https://` URL or leave it blank.' }); }
    }

    const ad = await manager.createAd({
        guild_id: interaction.guild?.id ?? null,
        title,
        description,
        redirect_url,
        type,
        priority: 'normal',
        scope: 'guild',
        created_by: interaction.user.id,
    });

    const embed = new EmbedBuilder()
        .setColor('#57F287')
        .setTitle('✅ Advertisement Created')
        .addFields(
            { name: 'ID', value: `\`${ad.id}\``, inline: true },
            { name: 'Type', value: ad.type, inline: true },
            { name: 'Title', value: ad.title, inline: false },
        )
        .setFooter({ text: 'Check your DMs — you can upload an image for this ad.' })
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    _promptForImage(interaction, ad);
}

async function _promptForImage(interaction, ad) {
    try {
        const dmChannel = await interaction.user.createDM();
        await dmChannel.send(
            `📸 **Ad \`${ad.id}\` was created!**\n\n` +
            `Would you like to attach an image? **Upload an image file** now, or type \`skip\` to save without one.\n` +
            `*(Session expires in 5 minutes)*`
        );

        const result = await manager.startImageUploadSession(interaction.user.id, ad.id);

        if (!result.skipped && result.imagePath) {
            await manager.editAd(ad.id, { image_url: result.imagePath });
            await dmChannel.send(`🖼️ Ad \`${ad.id}\` now has an image attached.`);
        }
    } catch (err) {
        console.warn(`[ad.js] Could not complete image upload session for ${ad.id}:`, err.message);
    }
}

async function handleList(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const page = interaction.options.getInteger('page') ?? 1;
    const { rows, total, limit } = await repo.listAds(interaction.guild.id, { page, limit: 8 });

    if (total === 0) {
        return interaction.editReply({ content: '📭 No advertisements found.' });
    }

    const totalPages = Math.ceil(total / limit);
    const priorityEmoji = { critical: '🔴', high: '🟠', normal: '🟡', low: '🟢' };
    const typeEmoji = { presence: '📡', interaction: '💬', announcement: '📢' };

    const lines = rows.map(ad => {
        const enabled = ad.enabled ? '✅' : '❌';
        const priority = priorityEmoji[ad.priority] ?? '⚪';
        const type = typeEmoji[ad.type] ?? '❓';
        const expires = ad.expires_at ? `<t:${Math.floor(ad.expires_at / 1000)}:R>` : '∞';
        return `**\`${ad.id}\`** ${enabled} ${priority}${type}\n` +
            `↳ ${ad.title.substring(0, 50)} — expires ${expires}`;
    }).join('\n\n');

    const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('📋 Advertisements')
        .setDescription(lines)
        .setFooter({ text: `Page ${page} / ${totalPages}  •  ${total} total` });

    const navRow = new ActionRowBuilder();
    if (page > 1) {
        navRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`ad_list_${page - 1}`)
                .setLabel('◀ Prev')
                .setStyle(ButtonStyle.Secondary)
        );
    }
    if (page < totalPages) {
        navRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`ad_list_${page + 1}`)
                .setLabel('Next ▶')
                .setStyle(ButtonStyle.Secondary)
        );
    }

    const reply = { embeds: [embed] };
    if (navRow.components.length) reply.components = [navRow];
    return interaction.editReply(reply);
}



async function handleView(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const id = interaction.options.getString('ad_id').trim().toUpperCase();
    const ad = await repo.getAdById(id);
    if (!ad) return interaction.editReply({ content: `❌ Ad \`${id}\` not found.` });

    const payload = buildAdReply(ad);
    const embed = payload.embeds[0];
    embed.addFields(
        { name: 'ID', value: `\`${ad.id}\``, inline: true },
        { name: 'Status', value: ad.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
        { name: 'Priority', value: ad.priority, inline: true },
        { name: 'Type', value: ad.type, inline: true },
        { name: 'Scope', value: ad.scope_target_id ? `${ad.scope}:${ad.scope_target_id}` : ad.scope, inline: true },
        { name: 'Created', value: `<t:${Math.floor(ad.created_at / 1000)}:f>`, inline: true },
        { name: 'Starts', value: ad.starts_at ? `<t:${Math.floor(ad.starts_at / 1000)}:f>` : '—', inline: true },
        { name: 'Expires', value: ad.expires_at ? `<t:${Math.floor(ad.expires_at / 1000)}:f>` : '∞', inline: true },
        { name: 'Image', value: ad.image_url ?? 'None', inline: false },
    );

    return interaction.editReply(payload);
}

async function handleEdit(interaction) {
    const id = interaction.options.getString('ad_id').trim().toUpperCase();
    const ad = await repo.getAdById(id);
    if (!ad) {
        return interaction.reply({ content: `❌ Ad \`${id}\` not found.`, flags: MessageFlags.Ephemeral });
    }

    const modal = new ModalBuilder()
        .setCustomId(`ad_edit_modal_${id}`)
        .setTitle(`Edit ${id}`);

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('ad_title')
                .setLabel('Title')
                .setStyle(TextInputStyle.Short)
                .setValue(ad.title.substring(0, 256))
                .setMaxLength(256)
                .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('ad_description')
                .setLabel('Description / Content')
                .setStyle(TextInputStyle.Paragraph)
                .setValue(ad.description.substring(0, 4000))
                .setMaxLength(4000)
                .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('ad_redirect_url')
                .setLabel('Redirect URL (optional)')
                .setStyle(TextInputStyle.Short)
                .setValue(ad.redirect_url ?? '')
                .setMaxLength(500)
                .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('ad_type')
                .setLabel('Type: presence | interaction | announcement')
                .setStyle(TextInputStyle.Short)
                .setValue(ad.type)
                .setMaxLength(20)
                .setRequired(false)
        ),
    );

    return interaction.showModal(modal);
}

/** Called from interactionCreate.js when the edit modal is submitted. */
export async function handleAdEditModal(interaction, adId) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const title = interaction.fields.getTextInputValue('ad_title').trim();
    const description = interaction.fields.getTextInputValue('ad_description').trim();
    const redirectRaw = (interaction.fields.getTextInputValue('ad_redirect_url') ?? '').trim();
    const typeRaw = (interaction.fields.getTextInputValue('ad_type') ?? '').trim().toLowerCase();

    const validTypes = ['presence', 'interaction', 'announcement'];
    const type = validTypes.includes(typeRaw) ? typeRaw : undefined;

    let redirect_url = null;
    if (redirectRaw) {
        try { new URL(redirectRaw); redirect_url = redirectRaw; }
        catch { return interaction.editReply({ content: '❌ Invalid redirect URL.' }); }
    }

    const updates = { title, description, redirect_url };
    if (type) updates.type = type;

    const updated = await manager.editAd(adId, updates);
    if (!updated) return interaction.editReply({ content: `❌ Ad \`${adId}\` not found.` });

    forceRotationTick();

    const embed = new EmbedBuilder()
        .setColor('#57F287')
        .setTitle('✅ Advertisement Updated')
        .addFields({ name: 'ID', value: `\`${adId}\``, inline: true })
        .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
}

async function handleDelete(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const id = interaction.options.getString('ad_id').trim().toUpperCase();
    const ad = await repo.getAdById(id);
    if (!ad) return interaction.editReply({ content: `❌ Ad \`${id}\` not found.` });

    const embed = new EmbedBuilder()
        .setColor('#ED4245')
        .setTitle('⚠️ Confirm Deletion')
        .setDescription(`Are you sure you want to delete **\`${id}\`** — *${ad.title}*?\n\nThis will soft-delete the ad and remove its image from disk.`);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`ad_delete_confirm_${id}`)
            .setLabel('Yes, Delete')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`ad_delete_cancel_${id}`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary),
    );

    return interaction.editReply({ embeds: [embed], components: [row] });
}

/** Button handler — confirm deletion */
export async function handleAdDeleteConfirm(interaction, adId) {
    await interaction.deferUpdate();
    await manager.deleteAd(adId);
    forceRotationTick();
    return interaction.editReply({
        content: `🗑️ Ad \`${adId}\` has been deleted.`,
        embeds: [], components: [],
    });
}

/** Button handler — cancel deletion */
export async function handleAdDeleteCancel(interaction) {
    await interaction.deferUpdate();
    return interaction.editReply({ content: '↩️ Deletion cancelled.', embeds: [], components: [] });
}

async function handleToggle(interaction, enabled) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const id = interaction.options.getString('ad_id').trim().toUpperCase();
    const ad = await repo.getAdById(id);
    if (!ad) return interaction.editReply({ content: `❌ Ad \`${id}\` not found.` });

    await manager.editAd(id, { enabled: enabled ? 1 : 0 });
    forceRotationTick();

    return interaction.editReply({
        content: enabled
            ? `✅ Ad \`${id}\` has been **enabled**.`
            : `⏸️ Ad \`${id}\` has been **disabled**.`,
    });
}

async function handlePresenceSet(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const id = interaction.options.getString('ad_id').trim().toUpperCase();
    const ad = await repo.getAdById(id);
    if (!ad) return interaction.editReply({ content: `❌ Ad \`${id}\` not found.` });

    await manager.editAd(id, { type: 'presence', enabled: 1 });
    forceRotationTick();

    return interaction.editReply({ content: `📡 Ad \`${id}\` is now set as a **presence** advertisement and will appear in the bot's status during the next rotation tick.` });
}

async function handlePresenceOff(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { rows } = await repo.listAds(interaction.guild.id, { limit: 100 });
    const presenceAds = rows.filter(a => a.type === 'presence');
    for (const a of presenceAds) {
        await manager.editAd(a.id, { type: 'interaction' });
    }

    forceRotationTick();
    return interaction.editReply({ content: `⏹️ All presence ads have been turned off. Static presence has been restored.` });
}

async function handlePresenceStatus(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const currentId = getCurrentPresenceAdId();
    if (!currentId) {
        return interaction.editReply({ content: '📡 **Presence**: Static (no ad currently active)' });
    }

    const ad = await repo.getAdById(currentId);
    const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('📡 Active Presence Advertisement')
        .addFields(
            { name: 'ID', value: `\`${currentId}\``, inline: true },
            { name: 'Title', value: ad?.title ?? 'Unknown', inline: true },
            { name: 'Priority', value: ad?.priority ?? '—', inline: true },
        )
        .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
}

async function handlePriority(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const id = interaction.options.getString('ad_id').trim().toUpperCase();
    const level = interaction.options.getString('level');

    const ad = await repo.getAdById(id);
    if (!ad) return interaction.editReply({ content: `❌ Ad \`${id}\` not found.` });

    await manager.editAd(id, { priority: level });
    forceRotationTick();

    return interaction.editReply({ content: `🎚️ Ad \`${id}\` priority set to **${level}**.` });
}

async function handleScope(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const id = interaction.options.getString('ad_id').trim().toUpperCase();
    const scope = interaction.options.getString('level');
    const targetId = interaction.options.getString('target_id') ?? null;

    const needsTarget = ['channel', 'role', 'user'].includes(scope);
    if (needsTarget && !targetId) {
        return interaction.editReply({ content: `❌ The \`${scope}\` scope requires a \`target_id\`.` });
    }

    const ad = await repo.getAdById(id);
    if (!ad) return interaction.editReply({ content: `❌ Ad \`${id}\` not found.` });

    await manager.editAd(id, { scope, scope_target_id: needsTarget ? targetId : null });

    return interaction.editReply({ content: `🎯 Ad \`${id}\` scope set to **${scope}**${targetId ? ` (target: \`${targetId}\`)` : ''}.` });
}

async function handleSchedule(interaction) {
    const id = interaction.options.getString('ad_id').trim().toUpperCase();
    const ad = await repo.getAdById(id);
    if (!ad) {
        return interaction.reply({ content: `❌ Ad \`${id}\` not found.`, flags: MessageFlags.Ephemeral });
    }

    const modal = new ModalBuilder()
        .setCustomId(`ad_schedule_modal_${id}`)
        .setTitle(`Schedule — ${id}`);

    const fmt = (ts) => ts ? new Date(ts).toISOString().replace('T', ' ').substring(0, 16) : '';

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('starts_at')
                .setLabel('Start (YYYY-MM-DD HH:MM) — leave blank to start now')
                .setStyle(TextInputStyle.Short)
                .setValue(fmt(ad.starts_at))
                .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('expires_at')
                .setLabel('Expiry (YYYY-MM-DD HH:MM) — leave blank for never')
                .setStyle(TextInputStyle.Short)
                .setValue(fmt(ad.expires_at))
                .setRequired(false)
        ),
    );

    return interaction.showModal(modal);
}

/** Modal handler for /ad schedule */
export async function handleAdScheduleModal(interaction, adId) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const startsRaw = (interaction.fields.getTextInputValue('starts_at') ?? '').trim();
    const expiresRaw = (interaction.fields.getTextInputValue('expires_at') ?? '').trim();

    const parseTs = (str) => {
        if (!str) return null;
        const ts = Date.parse(str);
        if (isNaN(ts)) throw new Error(`Invalid date/time: "${str}". Use YYYY-MM-DD HH:MM`);
        return ts;
    };

    let starts_at, expires_at;
    try {
        starts_at = parseTs(startsRaw);
        expires_at = parseTs(expiresRaw);
    } catch (err) {
        return interaction.editReply({ content: `❌ ${err.message}` });
    }

    if (starts_at && expires_at && expires_at <= starts_at) {
        return interaction.editReply({ content: '❌ Expiry must be after start time.' });
    }

    await manager.editAd(adId, { starts_at, expires_at });
    forceRotationTick();

    return interaction.editReply({
        content: `📅 Schedule updated for \`${adId}\`.\n` +
            `**Starts**: ${starts_at ? `<t:${Math.floor(starts_at / 1000)}:f>` : 'Immediately'}\n` +
            `**Expires**: ${expires_at ? `<t:${Math.floor(expires_at / 1000)}:f>` : 'Never'}`,
    });
}

async function handleForceDm(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const id = interaction.options.getString('ad_id').trim().toUpperCase();
    const user = interaction.options.getUser('user');
    const ad = await repo.getAdById(id);
    if (!ad) return interaction.editReply({ content: `❌ Ad \`${id}\` not found.` });

    // Admin force-send bypasses cooldowns
    const dmChannel = await user.createDM().catch(() => null);
    if (!dmChannel) {
        return interaction.editReply({ content: `❌ Cannot DM ${user.tag} — their DMs are closed.` });
    }

    const payload = buildAdReply(ad);
    await dmChannel.send(payload);

    await repo.recordDelivery({
        advertisement_id: id,
        user_id: user.id,
        guild_id: interaction.guild.id,
        delivery_type: 'dm',
        delivered_at: Date.now(),
    });

    return interaction.editReply({ content: `📨 Ad \`${id}\` sent to ${user.tag}.` });
}

async function handleStats(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const id = interaction.options.getString('ad_id').trim().toUpperCase();
    const ad = await repo.getAdById(id);
    if (!ad) return interaction.editReply({ content: `❌ Ad \`${id}\` not found.` });

    const stats = await repo.getAdStats(id);
    const total = stats.reduce((acc, s) => acc + s.cnt, 0);

    const lines = stats.length
        ? stats.map(s => `• **${s.delivery_type}**: ${s.cnt}`).join('\n')
        : '_No deliveries recorded yet._';

    const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`📊 Stats — \`${id}\``)
        .setDescription(`**${ad.title}**\n\n${lines}`)
        .addFields({ name: 'Total Deliveries', value: `${total}`, inline: true })
        .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
}

export async function handleAdDismiss(interaction, adId) {
    try {
        await repo.recordDismiss(adId, interaction.user.id);
    } catch { /* non-critical */ }

    await interaction.update({ content: '✖️ Ad dismissed.', embeds: [], components: [], files: [] });
}

export async function handleAdListPage(interaction, page) {
    if (!interaction.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.update({ content: '⚠️ You no longer have permission to view this.', components: [] });
    }

    await interaction.deferUpdate();

    const { rows, total, limit } = await repo.listAds(interaction.guild.id, { page, limit: 8 });
    const totalPages = Math.ceil(total / limit);
    const priorityEmoji = { critical: '🔴', high: '🟠', normal: '🟡', low: '🟢' };
    const typeEmoji = { presence: '📡', interaction: '💬', announcement: '📢' };

    const lines = rows.map(ad => {
        const enabled = ad.enabled ? '✅' : '❌';
        const priority = priorityEmoji[ad.priority] ?? '⚪';
        const type = typeEmoji[ad.type] ?? '❓';
        const expires = ad.expires_at ? `<t:${Math.floor(ad.expires_at / 1000)}:R>` : '∞';
        return `**\`${ad.id}\`** ${enabled} ${priority}${type}\n↳ ${ad.title.substring(0, 50)} — expires ${expires}`;
    }).join('\n\n');

    const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('📋 Advertisements')
        .setDescription(lines || '_No ads found._')
        .setFooter({ text: `Page ${page} / ${totalPages}  •  ${total} total` });

    const navRow = new ActionRowBuilder();
    if (page > 1) navRow.addComponents(new ButtonBuilder().setCustomId(`ad_list_${page - 1}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary));
    if (page < totalPages) navRow.addComponents(new ButtonBuilder().setCustomId(`ad_list_${page + 1}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary));

    const reply = { embeds: [embed] };
    if (navRow.components.length) reply.components = [navRow];
    else reply.components = [];

    return interaction.editReply(reply);
}
