// src/commands/slash/announce.js
import { 
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder,
    ChannelType,
    MessageFlags
} from 'discord.js';
import { db, getClubByIdentifier } from '../../database.js';
import { log } from '../../utils/debug.js';
import { checkClubPermission } from '../../utils/clubPermissions.js';

export const data = new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Post an announcement to your club channel')
    .addStringOption(option =>
        option.setName('club')
            .setDescription('Your club name or slug')
            .setRequired(true)
            .setAutocomplete(true));

export async function execute(interaction) {
    const clubIdentifier = interaction.options.getString('club');

    try {
        // Get club details using name or slug
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

        // Check authorization using enhanced permission system
        const permissionCheck = await checkClubPermission({
            member: interaction.member,
            clubId: club.id,
            action: 'post'
        });

        if (!permissionCheck.allowed) {
            return await interaction.reply({
                content: `❌ You don't have permission to post announcements for this club.\n**Reason:** ${permissionCheck.reason}\n\n*Only club presidents, moderators, and server admins can post announcements.*`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Show modal for announcement
        const modal = new ModalBuilder()
            .setCustomId(`announcement_modal_${club.id}`)
            .setTitle(`Announcement - ${club.name}`);

        const titleInput = new TextInputBuilder()
            .setCustomId('announcement_title')
            .setLabel('Announcement Title')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g., Important Meeting Tomorrow')
            .setRequired(true)
            .setMaxLength(100);

        const contentInput = new TextInputBuilder()
            .setCustomId('announcement_content')
            .setLabel('Announcement Content')
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
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(contentInput),
            new ActionRowBuilder().addComponents(mentionInput)
        );

        await interaction.showModal(modal);

    } catch (error) {
        log('Error in announce command', 'club', null, error, 'error');
        await interaction.reply({
            content: '❌ An error occurred. Please try again.',
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }
}

/**
 * Handle announcement modal submission with proper permission checks
 */
export async function handleAnnouncementModal(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        // Extract club_id from customId (format: announcement_modal_CLUBID)
        const clubId = parseInt(interaction.customId.split('_')[2]);

        if (isNaN(clubId)) {
            return await interaction.editReply({
                content: '❌ Invalid club ID. Please try again.'
            });
        }

        // Get announcement content from modal
        const title = interaction.fields.getTextInputValue('announcement_title');
        const content = interaction.fields.getTextInputValue('announcement_content');
        const mention = interaction.fields.getTextInputValue('mention_role')?.trim() || null;

        // Get club details
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

        // Re-check authorization (in case permissions changed)
        const permissionCheck = await checkClubPermission({
            member: interaction.member,
            clubId: club.id,
            action: 'post'
        });

        if (!permissionCheck.allowed) {
            return await interaction.editReply({
                content: `❌ You don't have permission to post announcements for this club.\n**Reason:** ${permissionCheck.reason}`
            });
        }

        // Validate club has a channel
        if (!club.channel_id) {
            return await interaction.editReply({
                content: '❌ This club does not have a channel configured. Please contact an administrator.'
            });
        }

        // Fetch and validate channel
        let clubChannel;
        try {
            clubChannel = await interaction.guild.channels.fetch(club.channel_id);
        } catch (fetchError) {
            log('Failed to fetch club channel', 'club', { clubId, channelId: club.channel_id }, fetchError, 'error');
            return await interaction.editReply({
                content: '❌ Club channel not found. The channel may have been deleted. Please contact an administrator.'
            });
        }

        if (!clubChannel) {
            return await interaction.editReply({
                content: '❌ Club channel not found. Please contact an administrator.'
            });
        }

        // Check if channel is a text channel
        if (clubChannel.type !== ChannelType.GuildText && clubChannel.type !== ChannelType.GuildAnnouncement) {
            return await interaction.editReply({
                content: '❌ Club channel is not a text channel. Please contact an administrator.'
            });
        }

        // Check bot permissions in the channel
        const botPermissions = clubChannel.permissionsFor(interaction.guild.members.me);
        
        if (!botPermissions) {
            return await interaction.editReply({
                content: '❌ Unable to check bot permissions. Please contact an administrator.'
            });
        }

        const requiredPermissions = [
            'ViewChannel',
            'SendMessages',
            'EmbedLinks'
        ];

        const missingPermissions = requiredPermissions.filter(perm => !botPermissions.has(perm));

        if (missingPermissions.length > 0) {
            log('Bot missing permissions in club channel', 'club', {
                clubId,
                clubName: club.name,
                channelId: club.channel_id,
                channelName: clubChannel.name,
                missingPermissions
            }, null, 'warn');

            return await interaction.editReply({
                content: `❌ I don't have the required permissions in ${clubChannel}.\n\n**Missing permissions:** ${missingPermissions.join(', ')}\n\nPlease ask an administrator to check my permissions.`
            });
        }

        // Create announcement embed
        const announcementEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(title)
            .setDescription(content)
            .setAuthor({ 
                name: `${club.name} Announcement`, 
                iconURL: club.logo_url || interaction.guild.iconURL() 
            })
            .setFooter({ 
                text: `Posted by ${interaction.user.tag} (${permissionCheck.level})`,
                iconURL: interaction.user.displayAvatarURL()
            })
            .setTimestamp();

        // Prepare message content
        let messageContent = null;
        if (mention) {
            // Validate mention format
            if (mention.toLowerCase() === 'everyone' || mention === '@everyone') {
                if (botPermissions.has('MentionEveryone')) {
                    messageContent = '@everyone';
                } else {
                    return await interaction.editReply({
                        content: '❌ I don\'t have permission to mention @everyone. Please ask an admin to grant me the "Mention Everyone" permission.'
                    });
                }
            } else if (mention.toLowerCase() === 'here' || mention === '@here') {
                if (botPermissions.has('MentionEveryone')) {
                    messageContent = '@here';
                } else {
                    return await interaction.editReply({
                        content: '❌ I don\'t have permission to mention @here. Please ask an admin to grant me the "Mention Everyone" permission.'
                    });
                }
            } else if (club.role_id) {
                // Mention club role
                messageContent = `<@&${club.role_id}>`;
            } else {
                log('Club has no role_id for mentions', 'club', { clubId, clubName: club.name }, null, 'warn');
            }
        }

        // Post announcement
        let postedMessage;
        try {
            postedMessage = await clubChannel.send({ 
                content: messageContent,
                embeds: [announcementEmbed] 
            });

            log('Announcement posted successfully', 'club', {
                clubId,
                clubName: club.name,
                clubSlug: club.slug,
                channelId: clubChannel.id,
                postedBy: interaction.user.tag,
                permissionLevel: permissionCheck.level
            });

        } catch (postError) {
            log('Failed to post announcement', 'club', {
                clubId,
                clubName: club.name,
                channelId: clubChannel.id,
                errorCode: postError.code,
                errorMessage: postError.message
            }, postError, 'error');

            // Provide specific error messages
            if (postError.code === 50013) {
                return await interaction.editReply({
                    content: `❌ Missing permissions to post in ${clubChannel}. Please ask an administrator to check my permissions.`
                });
            } else if (postError.code === 50001) {
                return await interaction.editReply({
                    content: `❌ I don't have access to ${clubChannel}. The channel may be private or deleted.`
                });
            } else {
                return await interaction.editReply({
                    content: `❌ Failed to post announcement: ${postError.message}\n\nPlease contact an administrator.`
                });
            }
        }

        // Store announcement in database
        try {
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO club_announcements (club_id, guild_id, title, content, message_id, channel_id, posted_by) 
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [clubId, interaction.guild.id, title, content, postedMessage.id, clubChannel.id, interaction.user.id],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        } catch (dbError) {
            log('Failed to store announcement in database', 'club', { clubId }, dbError, 'warn');
            // Don't fail the operation if DB storage fails
        }

        // Log to audit log
        try {
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO club_audit_log (guild_id, club_id, action_type, performed_by, target_id, details) 
                     VALUES (?, ?, 'announcement_posted', ?, ?, ?)`,
                    [
                        interaction.guild.id,
                        clubId,
                        interaction.user.id,
                        clubId.toString(),
                        JSON.stringify({ 
                            title, 
                            contentLength: content.length, 
                            mentioned: !!mention,
                            clubSlug: club.slug,
                            permissionLevel: permissionCheck.level
                        })
                    ],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        } catch (auditError) {
            log('Failed to log announcement to audit log', 'club', { clubId }, auditError, 'warn');
        }

        // Send success confirmation
        const successEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Announcement Posted!')
            .setDescription(`Your announcement has been posted to ${clubChannel}`)
            .addFields(
                { name: 'Title', value: title, inline: false },
                { name: '🏛️ Club', value: club.name, inline: true },
                { name: '🔗 Slug', value: `\`${club.slug}\``, inline: true },
                { name: 'Channel', value: `<#${clubChannel.id}>`, inline: true },
                { name: '👤 Posted as', value: permissionCheck.level, inline: true }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [successEmbed] });

    } catch (error) {
        log('Unexpected error in announcement handler', 'club', null, error, 'error');
        
        try {
            await interaction.editReply({
                content: `❌ An unexpected error occurred: ${error.message}\n\nPlease try again or contact an administrator.`
            });
        } catch (replyError) {
            log('Failed to send error reply', 'club', null, replyError, 'error');
        }
    }
}

/**
 * Autocomplete handler for club names
 */
export async function autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();
    const guildId = interaction.guild.id;

    try {
        // Get clubs the user can post announcements in
        const clubs = await new Promise((resolve, reject) => {
            db.all(
                `SELECT c.id, c.name, c.slug
                 FROM clubs c
                 WHERE c.guild_id = ? AND c.status = 'active'
                 ORDER BY c.name ASC`,
                [guildId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        // Filter clubs based on user input and permission
        const filtered = [];
        for (const club of clubs) {
            // Check if name or slug matches
            if (club.name.toLowerCase().includes(focusedValue.toLowerCase()) ||
                club.slug.toLowerCase().includes(focusedValue.toLowerCase())) {
                
                // Check if user can post to this club
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