// src/commands/slash/announce.js
import { 
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder,
    ChannelType,
    MessageFlags,
    ButtonBuilder,
    ButtonStyle,
    WebhookClient
} from 'discord.js';
import { db, getClubByIdentifier } from '../../database.js';
import { log } from '../../utils/debug.js';
import { checkClubPermission } from '../../utils/clubPermissions.js';

const PUBLIC_WEBHOOK_URL = process.env.WEBHOOK_URL_1;

export const data = new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Post an announcement to your club channel or public')
    .addStringOption(option =>
        option.setName('club')
            .setDescription('Your club name or slug')
            .setRequired(true)
            .setAutocomplete(true))
    .addStringOption(option =>
        option.setName('type')
            .setDescription('Announcement type')
            .setRequired(true)
            .addChoices(
                { name: '📢 Club Channel (Members Only)', value: 'club' },
                { name: '🌐 Public Webhook (Everyone)', value: 'public' }
            ))
    .addStringOption(option =>
        option.setName('format')
            .setDescription('Message format')
            .setRequired(true)
            .addChoices(
                { name: '💬 Simple Message', value: 'simple' },
                { name: '📋 Embed Message', value: 'embed' }
            ));

export async function execute(interaction) {
    const clubIdentifier = interaction.options.getString('club');
    const announcementType = interaction.options.getString('type');
    const format = interaction.options.getString('format');

    try {
        const club = await getClubByIdentifier(interaction.guild.id, clubIdentifier);

        if (!club) {
            return await interaction.reply({
                content: '❌ Club not found. Please check the club name/slug and try again.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (club.status !== 'active') {
            return await interaction.reply({
                content: `❌ This club is currently ${club.status} and cannot post announcements.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const permissionCheck = await checkClubPermission({
            member: interaction.member,
            clubId: club.id,
            action: 'post'
        });

        if (!permissionCheck.allowed) {
            return await interaction.reply({
                content: `❌ You don't have permission to post announcements for this club.\n**Reason:** ${permissionCheck.reason}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Show appropriate modal based on format
        if (format === 'simple') {
            await showSimpleModal(interaction, club, announcementType);
        } else {
            await showEmbedModal(interaction, club, announcementType);
        }

    } catch (error) {
        log('Error in announce command', 'club', null, error, 'error');
        await interaction.reply({
            content: '❌ An error occurred. Please try again.',
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }
}

/**
 * Show simple message modal
 */
async function showSimpleModal(interaction, club, type) {
    const modal = new ModalBuilder()
        .setCustomId(`announce_simple_${club.id}_${type}`)
        .setTitle(`Simple Announcement - ${club.name}`);

    const messageInput = new TextInputBuilder()
        .setCustomId('message_content')
        .setLabel('Announcement Message')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Write your announcement here...')
        .setRequired(true)
        .setMaxLength(2000);

    const mentionInput = new TextInputBuilder()
        .setCustomId('mention_role')
        .setLabel('Mention (optional)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Type: everyone, here, or leave blank')
        .setRequired(false)
        .setMaxLength(20);

    modal.addComponents(
        new ActionRowBuilder().addComponents(messageInput),
        new ActionRowBuilder().addComponents(mentionInput)
    );

    await interaction.showModal(modal);
}

/**
 * Show embed modal
 */
async function showEmbedModal(interaction, club, type) {
    const modal = new ModalBuilder()
        .setCustomId(`announce_embed_${club.id}_${type}`)
        .setTitle(`Embed Announcement - ${club.name}`);

    const titleInput = new TextInputBuilder()
        .setCustomId('embed_title')
        .setLabel('Announcement Title')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., Important Meeting Tomorrow')
        .setRequired(true)
        .setMaxLength(256);

    const descriptionInput = new TextInputBuilder()
        .setCustomId('embed_description')
        .setLabel('Announcement Description')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Write your announcement here...')
        .setRequired(true)
        .setMaxLength(2000);

    const colorInput = new TextInputBuilder()
        .setCustomId('embed_color')
        .setLabel('Embed Color (hex code, e.g., #FF5733)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('#5865F2')
        .setRequired(false)
        .setMaxLength(7);

    const imageInput = new TextInputBuilder()
        .setCustomId('embed_image')
        .setLabel('Image URL (optional)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('https://example.com/image.png')
        .setRequired(false);

    const mentionInput = new TextInputBuilder()
        .setCustomId('mention_role')
        .setLabel('Mention (optional)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Type: everyone, here, or leave blank')
        .setRequired(false)
        .setMaxLength(20);

    modal.addComponents(
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(descriptionInput),
        new ActionRowBuilder().addComponents(colorInput),
        new ActionRowBuilder().addComponents(imageInput),
        new ActionRowBuilder().addComponents(mentionInput)
    );

    await interaction.showModal(modal);
}

/**
 * Handle simple announcement modal
 */
export async function handleSimpleAnnouncementModal(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const parts = interaction.customId.split('_');
    const clubId = parseInt(parts[2]);
    const type = parts[3]; // 'club' or 'public'

    const message = interaction.fields.getTextInputValue('message_content');
    const mention = interaction.fields.getTextInputValue('mention_role')?.trim() || null;

    try {
        const club = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM clubs WHERE id = ? AND status = 'active'`,
                [clubId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!club) {
            return await interaction.editReply({
                content: '❌ Club not found or inactive.'
            });
        }

        const permissionCheck = await checkClubPermission({
            member: interaction.member,
            clubId: club.id,
            action: 'post'
        });

        if (!permissionCheck.allowed) {
            return await interaction.editReply({
                content: `❌ You don't have permission to post announcements.\n**Reason:** ${permissionCheck.reason}`
            });
        }

        if (type === 'public') {
            await postToPublicWebhook(interaction, club, message, null, mention);
        } else {
            await postToClubChannel(interaction, club, message, null, mention, permissionCheck.level);
        }

    } catch (error) {
        log('Error handling simple announcement', 'club', null, error, 'error');
        await interaction.editReply({
            content: `❌ An error occurred: ${error.message}`
        });
    }
}

/**
 * Handle embed announcement modal
 */
export async function handleEmbedAnnouncementModal(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const parts = interaction.customId.split('_');
    const clubId = parseInt(parts[2]);
    const type = parts[3];

    const title = interaction.fields.getTextInputValue('embed_title');
    const description = interaction.fields.getTextInputValue('embed_description');
    const colorInput = interaction.fields.getTextInputValue('embed_color') || '#5865F2';
    const imageUrl = interaction.fields.getTextInputValue('embed_image') || null;
    const mention = interaction.fields.getTextInputValue('mention_role')?.trim() || null;

    try {
        const club = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM clubs WHERE id = ? AND status = 'active'`,
                [clubId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!club) {
            return await interaction.editReply({
                content: '❌ Club not found or inactive.'
            });
        }

        const permissionCheck = await checkClubPermission({
            member: interaction.member,
            clubId: club.id,
            action: 'post'
        });

        if (!permissionCheck.allowed) {
            return await interaction.editReply({
                content: `❌ You don't have permission to post announcements.\n**Reason:** ${permissionCheck.reason}`
            });
        }

        // Parse color
        let color = parseInt(colorInput.replace('#', ''), 16);
        if (isNaN(color)) color = 0x5865F2;

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .setDescription(description)
            .setFooter({ 
                text: `Posted by ${interaction.user.tag} (${permissionCheck.level})`,
                iconURL: interaction.user.displayAvatarURL()
            })
            .setTimestamp();

        if (imageUrl) {
            embed.setImage(imageUrl);
        }

        if (type === 'public') {
            await postToPublicWebhook(interaction, club, null, embed, mention);
        } else {
            await postToClubChannel(interaction, club, null, embed, mention, permissionCheck.level);
        }

    } catch (error) {
        log('Error handling embed announcement', 'club', null, error, 'error');
        await interaction.editReply({
            content: `❌ An error occurred: ${error.message}`
        });
    }
}

/**
 * Post to club channel
 */
async function postToClubChannel(interaction, club, message, embed, mention, permissionLevel) {
    if (!club.channel_id) {
        return await interaction.editReply({
            content: '❌ This club does not have a channel configured.'
        });
    }

    try {
        const clubChannel = await interaction.guild.channels.fetch(club.channel_id);
        
        if (!clubChannel) {
            return await interaction.editReply({
                content: '❌ Club channel not found.'
            });
        }

        let messageContent = null;
        if (mention) {
            if (mention.toLowerCase() === 'everyone' || mention === '@everyone') {
                messageContent = '@everyone';
            } else if (mention.toLowerCase() === 'here' || mention === '@here') {
                messageContent = '@here';
            } else if (club.role_id) {
                messageContent = `<@&${club.role_id}>`;
            }
        }

        let postedMessage;
        if (embed) {
            // Add club branding to embed
            embed.setAuthor({
                name: `${club.name} Announcement`,
                iconURL: club.logo_url || interaction.guild.iconURL()
            });

            postedMessage = await clubChannel.send({
                content: messageContent,
                embeds: [embed]
            });
        } else {
            postedMessage = await clubChannel.send({
                content: `${messageContent ? messageContent + '\n\n' : ''}${message}`
            });
        }

        // Store in database
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_announcements (
                    club_id, guild_id, title, content, message_id, 
                    channel_id, posted_by, announcement_type
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'club')`,
                [
                    club.id, interaction.guild.id, 
                    embed ? embed.data.title : 'Simple Announcement',
                    message || embed?.data.description,
                    postedMessage.id, clubChannel.id, interaction.user.id
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Log
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_audit_log (guild_id, club_id, action_type, performed_by, target_id, details) 
                 VALUES (?, ?, 'announcement_posted', ?, ?, ?)`,
                [
                    interaction.guild.id, club.id, interaction.user.id, club.id.toString(),
                    JSON.stringify({
                        clubName: club.name, clubSlug: club.slug,
                        type: 'club', format: embed ? 'embed' : 'simple',
                        mentioned: !!mention, permissionLevel
                    })
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        const successEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Announcement Posted to Club Channel!')
            .addFields(
                { name: '🏛️ Club', value: club.name, inline: true },
                { name: '🔗 Slug', value: `\`${club.slug}\``, inline: true },
                { name: '📢 Channel', value: `<#${clubChannel.id}>`, inline: true },
                { name: '💬 Format', value: embed ? 'Embed' : 'Simple', inline: true },
                { name: '👤 Posted as', value: permissionLevel, inline: true }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [successEmbed] });

    } catch (error) {
        log('Error posting to club channel', 'club', { clubId: club.id }, error, 'error');
        throw error;
    }
}

/**
 * Post to public webhook
 */
async function postToPublicWebhook(interaction, club, message, embed, mention) {
    try {
        const webhookClient = new WebhookClient({ url: PUBLIC_WEBHOOK_URL });

        let content = message || null;
        if (mention) {
            const mentionText = mention.toLowerCase() === 'everyone' ? '@everyone' : 
                               mention.toLowerCase() === 'here' ? '@here' : null;
            if (mentionText) {
                content = `${mentionText}\n\n${content || ''}`;
            }
        }

        if (embed) {
            // Add club branding
            embed.setAuthor({
                name: `${club.name} - Public Announcement`,
                iconURL: club.logo_url || interaction.guild.iconURL()
            });
        }

        const webhookMessage = await webhookClient.send({
            content,
            embeds: embed ? [embed] : [],
            username: club.name,
            avatarURL: club.logo_url || interaction.guild.iconURL()
        });

        // Store in database
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_announcements (
                    club_id, guild_id, title, content, message_id, 
                    posted_by, announcement_type, webhook_url
                ) VALUES (?, ?, ?, ?, ?, ?, 'public', ?)`,
                [
                    club.id, interaction.guild.id,
                    embed ? embed.data.title : 'Public Announcement',
                    message || embed?.data.description,
                    webhookMessage.id, interaction.user.id, PUBLIC_WEBHOOK_URL
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Log
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_audit_log (guild_id, club_id, action_type, performed_by, target_id, details) 
                 VALUES (?, ?, 'public_announcement_posted', ?, ?, ?)`,
                [
                    interaction.guild.id, club.id, interaction.user.id, club.id.toString(),
                    JSON.stringify({
                        clubName: club.name, clubSlug: club.slug,
                        type: 'public', format: embed ? 'embed' : 'simple',
                        mentioned: !!mention
                    })
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        const successEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Public Announcement Posted via Webhook!')
            .setDescription('Your announcement has been posted publicly and is visible to everyone.')
            .addFields(
                { name: '🏛️ Club', value: club.name, inline: true },
                { name: '🔗 Slug', value: `\`${club.slug}\``, inline: true },
                { name: '🌐 Type', value: 'Public Webhook', inline: true },
                { name: '💬 Format', value: embed ? 'Embed' : 'Simple', inline: true },
                { name: '📛 Posted as', value: club.name, inline: true },
                { name: '🖼️ Avatar', value: club.logo_url ? 'Club Logo' : 'Server Icon', inline: true }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [successEmbed] });

        webhookClient.destroy();

    } catch (error) {
        log('Error posting to webhook', 'club', { clubId: club.id }, error, 'error');
        throw error;
    }
}

/**
 * Autocomplete handler
 */
export async function autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();
    const guildId = interaction.guild.id;

    try {
        const clubs = await new Promise((resolve, reject) => {
            db.all(
                `SELECT id, name, slug FROM clubs WHERE guild_id = ? AND status = 'active' ORDER BY name ASC`,
                [guildId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        const filtered = [];
        for (const club of clubs) {
            if (club.name.toLowerCase().includes(focusedValue.toLowerCase()) ||
                club.slug.toLowerCase().includes(focusedValue.toLowerCase())) {
                
                const permCheck = await checkClubPermission({
                    member: interaction.member,
                    clubId: club.id,
                    action: 'post'
                });

                if (permCheck.allowed) {
                    filtered.push({
                        name: `${club.name} (${club.slug})`,
                        value: club.slug
                    });
                }
            }

            if (filtered.length >= 25) break;
        }

        await interaction.respond(filtered);
    } catch (error) {
        log('Error in announce autocomplete', 'club', null, error, 'error');
        await interaction.respond([]);
    }
}