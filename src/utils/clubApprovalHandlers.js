// src/utils/clubApprovalHandlers.js
import {
    EmbedBuilder,
    PermissionsBitField,
    ChannelType,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder
} from 'discord.js';
import { db } from '../database.js';
import { log } from './debug.js';

/**
 * Handle club approval button
 */
export async function handleClubApproval(interaction) {
    await interaction.deferUpdate();

    const clubId = parseInt(interaction.customId.split('_')[2]);

    // Check permissions
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return await interaction.followUp({
            content: 'You need Manage Server permission to approve clubs.',
            ephemeral: true
        });
    }

    try {
        // Get club details
        const club = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM clubs WHERE id = ?`,
                [clubId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!club) {
            return await interaction.followUp({
                content: 'Club not found.',
                ephemeral: true
            });
        }

        if (club.status !== 'pending') {
            return await interaction.followUp({
                content: `This club is already ${club.status}.`,
                ephemeral: true
            });
        }

        // Create club infrastructure
        const guild = interaction.guild;
        const createdResources = await createClubInfrastructure(guild, club);

        if (!createdResources.success) {
            return await interaction.followUp({
                content: `Failed to create club infrastructure: ${createdResources.error}`,
                ephemeral: true
            });
        }

        // Update club in database
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE clubs SET 
                    status = 'active',
                    role_id = ?,
                    moderator_role_id = ?,
                    channel_id = ?,
                    voice_channel_id = ?,
                    updated_at = ?
                 WHERE id = ?`,
                [
                    createdResources.role.id,
                    createdResources.modRole.id,
                    createdResources.textChannel.id,
                    createdResources.voiceChannel.id,
                    Date.now(),
                    clubId
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Assign president role and add to members
        if (club.president_user_id) {
            try {
                const president = await guild.members.fetch(club.president_user_id);
                await president.roles.add(createdResources.role, 'Club approved - president role');

                // Add president as member in database
                await new Promise((resolve, reject) => {
                    db.run(
                        `INSERT OR REPLACE INTO club_members (club_id, user_id, guild_id, role, status) 
                         VALUES (?, ?, ?, 'president', 'active')`,
                        [clubId, club.president_user_id, guild.id],
                        (err) => {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });

                // Send congratulations DM to president
                const presidentUser = await interaction.client.users.fetch(club.president_user_id);
                const welcomeEmbed = new EmbedBuilder()
                    .setColor('#00FF00')
                    .setTitle(`Congratulations! ${club.name} has been approved!`)
                    .setDescription('Your club is now active and ready to grow!')
                    .addFields(
                        { name: 'Text Channel', value: `<#${createdResources.textChannel.id}>`, inline: true },
                        { name: 'Voice Channel', value: `<#${createdResources.voiceChannel.id}>`, inline: true },
                        { name: 'Club Role', value: `<@&${createdResources.role.id}>`, inline: true },
                        {
                            name: 'Next Steps', value:
                                '• Your club embed is now in the #clubs channel\n' +
                                '• Members can join by clicking the Join button\n' +
                                '• Use `/createevent` to schedule events\n' +
                                '• Use `/announce` to post announcements\n' +
                                '• Build your team and start activities!',
                            inline: false
                        }
                    )
                    .setFooter({ text: 'Use /clubs info to see your club details' })
                    .setTimestamp();

                await presidentUser.send({ embeds: [welcomeEmbed] });

                // Post welcome message in club channel
                const channelWelcome = new EmbedBuilder()
                    .setColor('#5865F2')
                    .setTitle(`Welcome to ${club.name}!`)
                    .setDescription(club.description || 'No description provided')
                    .addFields(
                        { name: 'President', value: `<@${club.president_user_id}>`, inline: true },
                        { name: 'Category', value: club.category, inline: true }
                    );

                if (club.logo_url) {
                    channelWelcome.setThumbnail(club.logo_url);
                }

                channelWelcome.addFields({
                    name: 'Getting Started',
                    value: '• Share the club join link with interested members\n' +
                        '• Plan your first meeting or event\n' +
                        '• Build your team of trusted members\n' +
                        '• Start making an impact!',
                    inline: false
                });

                await createdResources.textChannel.send({ embeds: [channelWelcome] });

            } catch (presidentError) {
                log('Error notifying president:', 'club', null, presidentError, 'error');
                // Continue even if notification fails
            }
        }

        // Post club embed to #clubs channel
        const CLUBS_CHANNEL_ID = process.env.CLUBS_CHANNEL_ID;
        if (CLUBS_CHANNEL_ID) {
            try {
                const clubsChannel = await guild.channels.fetch(CLUBS_CHANNEL_ID);

                const clubEmbed = new EmbedBuilder()
                    .setColor(createdResources.role.color || '#5865F2')
                    .setTitle(`${club.name}`)
                    .setDescription(club.description || 'No description provided')
                    .addFields(
                        { name: 'Category', value: club.category.charAt(0).toUpperCase() + club.category.slice(1), inline: true },
                        { name: 'Members', value: '1', inline: true },
                        { name: 'President', value: `<@${club.president_user_id}>`, inline: true }
                    )
                    .setFooter({ text: `Club ID: ${clubId} | Click Join Club to become a member!` })
                    .setTimestamp();

                if (club.logo_url) {
                    clubEmbed.setThumbnail(club.logo_url);
                }

                const joinButton = new ButtonBuilder()
                    .setCustomId(`join_club_${clubId}`)
                    .setLabel('Join Club')
                    .setStyle(ButtonStyle.Primary);

                const row = new ActionRowBuilder().addComponents(joinButton);

                await clubsChannel.send({ embeds: [clubEmbed], components: [row] });

            } catch (clubsChannelError) {
                log('Failed to post to clubs channel:', 'club', null, clubsChannelError, 'error');
            }
        }

        // Update approval message
        const approvedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor('#00FF00')
            .addFields({ name: 'Approved by', value: `<@${interaction.user.id}>`, inline: true });

        await interaction.editReply({ embeds: [approvedEmbed], components: [] });

        // Log action
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_audit_log (guild_id, action_type, performed_by, target_id, details) 
                 VALUES (?, 'club_approved', ?, ?, ?)`,
                [
                    guild.id,
                    interaction.user.id,
                    clubId.toString(),
                    JSON.stringify({
                        clubName: club.name,
                        roleId: createdResources.role.id,
                        channelId: createdResources.textChannel.id
                    })
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

    } catch (error) {
        log('Error approving club:', 'club', null, error, 'error');
        await interaction.followUp({
            content: 'An error occurred while approving the club.',
            ephemeral: true
        });
    }
}

/**
 * Handle club rejection button
 */
export async function handleClubRejection(interaction) {
    await interaction.deferUpdate();

    const clubId = parseInt(interaction.customId.split('_')[2]);

    // Check permissions
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return await interaction.followUp({
            content: 'You need Manage Server permission to reject clubs.',
            ephemeral: true
        });
    }

    try {
        // Get club details
        const club = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM clubs WHERE id = ?`,
                [clubId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!club) {
            return await interaction.followUp({
                content: 'Club not found.',
                ephemeral: true
            });
        }

        if (club.status !== 'pending') {
            return await interaction.followUp({
                content: `This club is already ${club.status}.`,
                ephemeral: true
            });
        }

        // Update club status to rejected
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE clubs SET status = 'rejected', updated_at = ? WHERE id = ?`,
                [Date.now(), clubId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Notify president
        if (club.president_user_id) {
            try {
                const president = await interaction.client.users.fetch(club.president_user_id);

                const rejectionEmbed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle('Club Registration Not Approved')
                    .setDescription(`Unfortunately, your club registration for **${club.name}** has not been approved.`)
                    .addFields(
                        {
                            name: 'Next Steps', value:
                                '• Review your club details\n' +
                                '• Contact an administrator for feedback\n' +
                                '• Make necessary adjustments\n' +
                                '• Submit a new registration if desired',
                            inline: false
                        }
                    )
                    .setFooter({ text: 'Thank you for your interest in creating a club' })
                    .setTimestamp();

                await president.send({ embeds: [rejectionEmbed] });

            } catch (dmError) {
                log('Error notifying president of rejection:', 'club', null, dmError, 'error');
            }
        }

        // Update approval message
        const rejectedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor('#FF0000')
            .addFields({ name: 'Rejected by', value: `<@${interaction.user.id}>`, inline: true });

        await interaction.editReply({ embeds: [rejectedEmbed], components: [] });

        // Log action
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_audit_log (guild_id, action_type, performed_by, target_id, details) 
                 VALUES (?, 'club_rejected', ?, ?, ?)`,
                [
                    interaction.guild.id,
                    interaction.user.id,
                    clubId.toString(),
                    JSON.stringify({ clubName: club.name })
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

    } catch (error) {
        log('Error rejecting club:', 'club', null, error, 'error');
        await interaction.followUp({
            content: 'An error occurred while rejecting the club.',
            ephemeral: true
        });
    }
}

/**
 * Create complete club infrastructure (role, channels, permissions)
 * FIXED: Now ensures bot always has access to created channels
 */
async function createClubInfrastructure(guild, club) {
    try {
        const botMember = guild.members.me;

        // Get random color (await this async function!)
        const roleColor = await getRandomColor(guild);

        // Create club role (for all members)
        const role = await guild.roles.create({
            name: club.name,
            color: roleColor, // ✅ Fixed: Now using awaited color value
            hoist: true,
            mentionable: true,
            reason: `Club approved: ${club.name}`
        });

        // Create moderator role (for club moderators)
        const modRole = await guild.roles.create({
            name: `${club.name} - Moderator`,
            color: roleColor, // Same color as club role
            hoist: true, // Display separately in sidebar
            mentionable: true,
            reason: `Club moderator role: ${club.name}`
        });

        // Find or create "CLUBS" category
        let clubsCategory = guild.channels.cache.find(
            c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === 'clubs'
        );

        if (!clubsCategory) {
            clubsCategory = await guild.channels.create({
                name: 'CLUBS',
                type: ChannelType.GuildCategory,
                reason: 'Creating clubs category',
                permissionOverwrites: [
                    {
                        id: guild.id, // @everyone
                        deny: [PermissionsBitField.Flags.ViewChannel]
                    },
                    {
                        id: botMember.id, // BOT - CRITICAL: Always give bot access
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.ManageChannels,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ManageMessages,
                            PermissionsBitField.Flags.EmbedLinks,
                            PermissionsBitField.Flags.AttachFiles,
                            PermissionsBitField.Flags.ReadMessageHistory,
                            PermissionsBitField.Flags.MentionEveryone
                        ]
                    }
                ]
            });
        }

        // Create text channel with BOT permissions
        const textChannel = await guild.channels.create({
            name: club.name.toLowerCase().replace(/\s+/g, '-'),
            type: ChannelType.GuildText,
            parent: clubsCategory.id,
            topic: club.description?.substring(0, 1024) || `Official channel for ${club.name}`,
            reason: `Club approved: ${club.name}`,
            permissionOverwrites: [
                {
                    id: guild.id, // @everyone - deny access
                    deny: [PermissionsBitField.Flags.ViewChannel]
                },
                {
                    id: botMember.id, // BOT - CRITICAL: Full access for bot
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ManageMessages,
                        PermissionsBitField.Flags.EmbedLinks,
                        PermissionsBitField.Flags.AttachFiles,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.MentionEveryone,
                        PermissionsBitField.Flags.ManageChannels
                    ]
                },
                {
                    id: role.id, // Club role - member access
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.AddReactions,
                        PermissionsBitField.Flags.AttachFiles,
                        PermissionsBitField.Flags.EmbedLinks
                    ]
                }
            ]
        });

        log('Created text channel with bot permissions', 'club', {
            channelId: textChannel.id,
            channelName: textChannel.name,
            botHasAccess: textChannel.permissionsFor(botMember).has(PermissionsBitField.Flags.ViewChannel)
        });

        // Create voice channel with BOT permissions
        const voiceChannel = await guild.channels.create({
            name: `${club.name}`,
            type: ChannelType.GuildVoice,
            parent: clubsCategory.id,
            reason: `Club approved: ${club.name}`,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel]
                },
                {
                    id: botMember.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.ManageChannels
                    ]
                },
                {
                    id: role.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.Connect,
                        PermissionsBitField.Flags.Speak,
                        PermissionsBitField.Flags.Stream
                    ]
                }
            ]
        });

        const botPerms = textChannel.permissionsFor(botMember);
        const hasRequiredPerms = botPerms &&
            botPerms.has(PermissionsBitField.Flags.ViewChannel) &&
            botPerms.has(PermissionsBitField.Flags.SendMessages) &&
            botPerms.has(PermissionsBitField.Flags.EmbedLinks);

        if (!hasRequiredPerms) {
            log('WARNING: Bot may not have proper access to created channel', 'club', {
                channelId: textChannel.id,
                channelName: textChannel.name,
                hasViewChannel: botPerms?.has(PermissionsBitField.Flags.ViewChannel),
                hasSendMessages: botPerms?.has(PermissionsBitField.Flags.SendMessages),
                hasEmbedLinks: botPerms?.has(PermissionsBitField.Flags.EmbedLinks)
            }, null, 'warn');
        }

        return {
            success: true,
            role,
            modRole,
            textChannel,
            voiceChannel
        };

    } catch (error) {
        log('Error creating club infrastructure:', 'club', null, error, 'error');
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * 41 Unique colors for club roles
 */
const CLUB_COLORS = [
    0x5865F2, 0x00D9FF, 0x3498DB, 0x1ABC9C, 0x00BCD4, // Blues & Cyans
    0x57F287, 0x2ECC71, 0x27AE60, 0x00FF7F, 0x32CD32, // Greens
    0xFEE75C, 0xF1C40F, 0xFFD700, 0xFFA500, // Yellows & Golds
    0xF26522, 0xE74C3C, 0xED4245, 0xFF6347, 0xFF4500, 0xDC143C, // Oranges & Reds
    0xEB459E, 0xE91E63, 0xFF1493, 0xFF69B4, 0xBA55D3, // Pinks & Magentas
    0x9B59B6, 0x8E44AD, 0x7B68EE, 0x9370DB, 0xDA70D6, // Purples
    0xA0522D, 0xCD853F, 0xD2691E, 0x8B4513, // Browns & Earthy
    0x00CED1, 0x20B2AA, 0x4169E1, 0xFF8C00, 0xB22222, 0xC71585, 0x6A5ACD // Vibrant
];

/**
 * Get a random unique color, avoiding already used colors
 */
async function getRandomColor(guild) {
    try {
        const clubs = await new Promise((resolve, reject) => {
            db.all(
                `SELECT role_id FROM clubs WHERE guild_id = ? AND status = 'active' AND role_id IS NOT NULL`,
                [guild.id],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        const usedColors = [];
        for (const club of clubs) {
            try {
                const role = await guild.roles.fetch(club.role_id);
                if (role && role.color !== 0) {
                    usedColors.push(role.color);
                }
            } catch (error) {
                continue;
            }
        }

        const availableColors = CLUB_COLORS.filter(color => !usedColors.includes(color));

        if (availableColors.length === 0) {
            return CLUB_COLORS[Math.floor(Math.random() * CLUB_COLORS.length)];
        }

        return availableColors[Math.floor(Math.random() * availableColors.length)];
    } catch (error) {
        log('Error getting unique color, using random', 'club', null, error, 'warn');
        return CLUB_COLORS[Math.floor(Math.random() * CLUB_COLORS.length)];
    }
}