// src/services/ads/adDelivery.js
// Handles building and sending ad embeds to users (ephemeral replies & DMs).

import {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder,
} from 'discord.js';
import path from 'path';
import { existsSync } from 'fs';
import { recordDelivery } from './adRepository.js';
import { isUserEligibleForDm, filterEligibleAds, pickBestPresenceAd } from './adEligibility.js';
import { getEligibleDmAds } from './adRepository.js';

/**
 * Build a rich embed for an advertisement.
 *
 * @param {object}  ad
 * @param {object}  [opts]
 * @param {string}  [opts.attachmentName]  basename of attached image (set image to attachment://<name>)
 * @returns {EmbedBuilder}
 */
export function buildAdEmbed(ad, { attachmentName } = {}) {
    const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(ad.title.substring(0, 256))
        .setDescription(ad.description.substring(0, 4096))
        .setFooter({ text: `📢 Advertisement  •  ${ad.id}` })
        .setTimestamp();

    if (ad.redirect_url) {
        embed.setURL(ad.redirect_url.substring(0, 500));
    }

    if (attachmentName) {
        embed.setImage(`attachment://${attachmentName}`);
    }

    return embed;
}

/**
 * Build action-row buttons for an advertisement.
 * Always includes a Dismiss button; optionally a "Learn More" link button.
 *
 * @param {object} ad
 * @returns {ActionRowBuilder[]}
 */
export function buildAdComponents(ad) {
    const buttons = [];

    if (ad.redirect_url) {
        try {
            new URL(ad.redirect_url);   // validates
            buttons.push(
                new ButtonBuilder()
                    .setLabel('Learn More')
                    .setStyle(ButtonStyle.Link)
                    .setURL(ad.redirect_url)
                    .setEmoji('🔗')
            );
        } catch { /* invalid URL — skip */ }
    }

    buttons.push(
        new ButtonBuilder()
            .setCustomId(`ad_dismiss_${ad.id}`)
            .setLabel('Dismiss')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('✖️')
    );

    return [new ActionRowBuilder().addComponents(...buttons)];
}

/**
 * Resolve the local image file for an ad (if any) and return:
 *   { files: AttachmentBuilder[], attachmentName: string|null }
 */
function resolveAdImage(ad) {
    if (!ad.image_url) return { files: [], attachmentName: null };

    const imagePath = path.resolve(process.cwd(), ad.image_url);
    if (!existsSync(imagePath)) {
        console.warn(`[AdDelivery] Image not found on disk: ${imagePath}`);
        return { files: [], attachmentName: null };
    }

    const attachmentName = path.basename(imagePath);
    return {
        files: [new AttachmentBuilder(imagePath, { name: attachmentName })],
        attachmentName,
    };
}

/**
 * Build a full reply payload (embeds + components + files) for an ad.
 * Suitable for interaction.editReply() or channel.send().
 */
export function buildAdReply(ad) {
    const { files, attachmentName } = resolveAdImage(ad);
    const embed      = buildAdEmbed(ad, { attachmentName });
    const components = buildAdComponents(ad);
    return { embeds: [embed], components, files };
}

/**
 * Send an ad to a user's DM.
 * Checks eligibility before sending and records delivery afterwards.
 *
 * @param {import('discord.js').User} user
 * @param {object}  ad
 * @param {string}  [guildId]
 * @returns {Promise<{ delivered: boolean, reason?: string }>}
 */
export async function deliverAdToUser(user, ad, guildId = null) {
    try {
        const eligible = await isUserEligibleForDm(ad, user.id);
        if (!eligible) return { delivered: false, reason: 'cooldown_or_limit' };

        const dmChannel = await user.createDM().catch(() => null);
        if (!dmChannel) return { delivered: false, reason: 'dm_closed' };

        const payload = buildAdReply(ad);
        await dmChannel.send(payload);

        await recordDelivery({
            advertisement_id: ad.id,
            user_id:          user.id,
            guild_id:         guildId,
            delivery_type:    'dm',
            delivered_at:     Date.now(),
        });

        return { delivered: true };
    } catch (err) {
        console.error(`[AdDelivery] DM delivery failed (ad=${ad.id}, user=${user.id}):`, err);
        return { delivered: false, reason: 'error' };
    }
}

/**
 * Fire-and-forget: after a slash command interaction, check whether the user
 * should receive an ad DM.  Never throws.
 *
 * @param {import('discord.js').CommandInteraction} interaction
 */
export function maybeDeliverAdDm(interaction) {
    if (!interaction.guild || !interaction.user || interaction.user.bot) return;

    // Deliberately NOT awaited — runs in background without blocking the command
    _doMaybeDeliverAdDm(interaction).catch(err => {
        console.error('[AdDelivery] Background DM delivery error:', err);
    });
}

async function _doMaybeDeliverAdDm(interaction) {
    const now = Date.now();
    const ads = await getEligibleDmAds(now);
    const context = {
        now,
        guildId:   interaction.guild.id,
        userId:    interaction.user.id,
        channelId: interaction.channel?.id,
        roleIds:   interaction.member?.roles?.cache?.map(r => r.id) ?? [],
    };
    const eligible = filterEligibleAds(ads, context);
    const best     = pickBestPresenceAd(eligible);
    if (!best) return;

    await deliverAdToUser(interaction.user, best, interaction.guild.id);
}