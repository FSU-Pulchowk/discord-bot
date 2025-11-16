// src/commands/slash/clubs.js
import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from 'discord.js';
import { db } from '../../database.js';
import { promises as fs } from 'fs';
import path from 'path';
import axios from 'axios';

export const data = new SlashCommandBuilder()
    .setName('clubs')
    .setDescription('Explore and manage college clubs')
    .addSubcommand(subcommand =>
        subcommand
            .setName('browse')
            .setDescription('Browse all available clubs')
            .addStringOption(option =>
                option.setName('category')
                    .setDescription('Filter by category')
                    .setRequired(false)
                    .addChoices(
                        { name: 'Technical', value: 'technical' },
                        { name: 'Cultural', value: 'cultural' },
                        { name: 'Sports', value: 'sports' },
                        { name: 'Social Service', value: 'social_service' },
                        { name: 'Academic', value: 'academic' },
                        { name: 'All', value: 'all' }
                    )))
    .addSubcommand(subcommand =>
        subcommand
            .setName('info')
            .setDescription('Get detailed information about a club')
            .addStringOption(option =>
                option.setName('club_name')
                    .setDescription('Name of the club')
                    .setRequired(true)
                    .setAutocomplete(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('myclubs')
            .setDescription('View your club memberships'))
    .addSubcommand(subcommand =>
        subcommand
            .setName('events')
            .setDescription('View upcoming club events')
            .addStringOption(option =>
                option.setName('club_name')
                    .setDescription('Filter by specific club')
                    .setRequired(false)
                    .setAutocomplete(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('sync')
            .setDescription('[ADMIN] Sync data from Excel files')
            .addStringOption(option =>
                option.setName('sync_type')
                    .setDescription('Type of data to sync')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Join Requests', value: 'join_requests' },
                        { name: 'Club Registrations', value: 'club_registrations' },
                        { name: 'Attendance', value: 'attendance' },
                        { name: 'Event Feedback', value: 'event_feedback' }
                    ))
            .addAttachmentOption(option =>
                option.setName('file')
                    .setDescription('Excel file to sync')
                    .setRequired(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('export')
            .setDescription('[ADMIN] Export club data to Excel')
            .addStringOption(option =>
                option.setName('export_type')
                    .setDescription('Type of data to export')
                    .setRequired(true)
                    .addChoices(
                        { name: 'All Clubs', value: 'clubs' },
                        { name: 'All Members', value: 'members' },
                        { name: 'All Events', value: 'events' }
                    )))
    .addSubcommand(subcommand =>
        subcommand
            .setName('approve')
            .setDescription('[ADMIN] Approve pending club registration')
            .addIntegerOption(option =>
                option.setName('club_id')
                    .setDescription('Club ID to approve')
                    .setRequired(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('pending')
            .setDescription('[ADMIN] View all pending club registrations'))
    .addSubcommand(subcommand =>
        subcommand
            .setName('reject')
            .setDescription('[ADMIN] Reject a pending club registration')
            .addIntegerOption(option =>
                option.setName('club_id')
                    .setDescription('Club ID to reject')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('reason')
                    .setDescription('Reason for rejection')
                    .setRequired(true)));

export async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
        case 'browse':
            await handleBrowse(interaction);
            break;
        case 'info':
            await handleInfo(interaction);
            break;
        case 'myclubs':
            await handleMyClubs(interaction);
            break;
        case 'events':
            await handleEvents(interaction);
            break;
        case 'sync':
            await handleSync(interaction);
            break;
        case 'export':
            await handleExport(interaction);
            break;
        case 'approve':
            await handleApprove(interaction);
            break;
        case 'pending':
            await handlePending(interaction);
            break;
        case 'reject':
            await handleReject(interaction);
            break;
    }
}

/**
 * Browse all clubs with filtering
 */
async function handleBrowse(interaction) {
    await interaction.deferReply();

    const category = interaction.options.getString('category') || 'all';
    const guildId = interaction.guild.id;

    try {
        const query = category === 'all'
            ? `SELECT * FROM clubs WHERE guild_id = ? AND status = 'active' ORDER BY name`
            : `SELECT * FROM clubs WHERE guild_id = ? AND category = ? AND status = 'active' ORDER BY name`;

        const params = category === 'all' ? [guildId] : [guildId, category];

        const clubs = await new Promise((resolve, reject) => {
            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        if (clubs.length === 0) {
            return interaction.editReply({ content: '📋 No clubs found in this category.' });
        }

        // Get member counts for each club
        const clubsWithCounts = await Promise.all(clubs.map(async club => {
            const memberCount = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT COUNT(*) as count FROM club_members WHERE club_id = ? AND status = 'active'`,
                    [club.id],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row?.count || 0);
                    }
                );
            });
            return { ...club, memberCount };
        }));

        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(`🏛️ Available Clubs${category !== 'all' ? ` - ${category.charAt(0).toUpperCase() + category.slice(1)}` : ''}`)
            .setDescription('Browse clubs and use `/clubs info <club_name>` for more details')
            .setTimestamp();

        clubsWithCounts.forEach(club => {
            const capacityInfo = club.max_members
                ? `${club.memberCount}/${club.max_members} members`
                : `${club.memberCount} members`;

            embed.addFields({
                name: `${club.name} (${club.category})`,
                value: `${club.description?.substring(0, 100) || 'No description'}...\n👥 ${capacityInfo}`,
                inline: false
            });
        });

        embed.setFooter({ text: `Total clubs: ${clubs.length} | Fill Google Form to join` });

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('Error browsing clubs:', error);
        await interaction.editReply({ content: '❌ An error occurred while fetching clubs.' });
    }
}

/**
 * Get detailed club information
 */
async function handleInfo(interaction) {
    await interaction.deferReply();

    const clubName = interaction.options.getString('club_name');
    const guildId = interaction.guild.id;

    try {
        const club = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM clubs WHERE guild_id = ? AND LOWER(name) = LOWER(?) AND status = 'active'`,
                [guildId, clubName],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!club) {
            return interaction.editReply({ content: '❌ Club not found.' });
        }

        // Get president info
        const president = await new Promise((resolve, reject) => {
            db.get(
                `SELECT real_name FROM verified_users WHERE user_id = ?`,
                [club.president_user_id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        // Get member count
        const memberCount = await new Promise((resolve, reject) => {
            db.get(
                `SELECT COUNT(*) as count FROM club_members WHERE club_id = ? AND status = 'active'`,
                [club.id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.count || 0);
                }
            );
        });

        // Get upcoming events
        const upcomingEvents = await new Promise((resolve, reject) => {
            db.all(
                `SELECT title, date, start_time FROM club_events 
                 WHERE club_id = ? AND date >= date('now') AND status = 'scheduled'
                 ORDER BY date LIMIT 3`,
                [club.id],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(`🏛️ ${club.name}`)
            .setDescription(club.description || 'No description available')
            .addFields(
                { name: '📂 Category', value: club.category, inline: true },
                { name: '👥 Members', value: club.max_members ? `${memberCount}/${club.max_members}` : memberCount.toString(), inline: true },
                { name: '👔 President', value: president?.real_name || 'Unknown', inline: true }
            );

        if (club.advisor_name) {
            embed.addFields({ name: '🎓 Club Advisor', value: club.advisor_name, inline: true });
        }

        if (club.meeting_day && club.meeting_time) {
            embed.addFields({
                name: '📅 Regular Meetings',
                value: `${club.meeting_day}s at ${club.meeting_time}`,
                inline: true
            });
        }

        if (club.meeting_location) {
            embed.addFields({ name: '📍 Meeting Location', value: club.meeting_location, inline: true });
        }

        if (upcomingEvents.length > 0) {
            const eventList = upcomingEvents.map(e => `• ${e.title} - ${e.date} at ${e.start_time || 'TBA'}`).join('\n');
            embed.addFields({ name: '📆 Upcoming Events', value: eventList, inline: false });
        }

        embed.setFooter({ text: 'Fill the Google Form to join this club' });
        embed.setTimestamp();

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('Error fetching club info:', error);
        await interaction.editReply({ content: '❌ An error occurred while fetching club information.' });
    }
}

/**
 * View user's club memberships
 */
async function handleMyClubs(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.user.id;
    const guildId = interaction.guild.id;

    try {
        const memberships = await new Promise((resolve, reject) => {
            db.all(
                `SELECT c.*, cm.role, cm.joined_at, cm.attendance_count, cm.contribution_points
                 FROM club_members cm
                 JOIN clubs c ON cm.club_id = c.id
                 WHERE cm.user_id = ? AND cm.guild_id = ? AND cm.status = 'active'
                 ORDER BY c.name`,
                [userId, guildId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        if (memberships.length === 0) {
            return interaction.editReply({ content: '📋 You are not a member of any clubs yet. Use `/clubs browse` to explore clubs!' });
        }

        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('🏛️ Your Club Memberships')
            .setDescription(`You are a member of ${memberships.length} club(s)`)
            .setTimestamp();

        memberships.forEach(membership => {
            const roleDisplay = membership.role === 'member' ? 'Member' : membership.role.charAt(0).toUpperCase() + membership.role.slice(1);
            const joinedDate = new Date(membership.joined_at * 1000).toLocaleDateString();

            embed.addFields({
                name: `${membership.name} (${roleDisplay})`,
                value: `**Category:** ${membership.category}\n` +
                    `**Joined:** ${joinedDate}\n` +
                    `**Attendance:** ${membership.attendance_count} meetings\n` +
                    `**Points:** ${membership.contribution_points}`,
                inline: true
            });
        });

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('Error fetching user clubs:', error);
        await interaction.editReply({ content: '❌ An error occurred while fetching your clubs.' });
    }
}

/**
 * View upcoming events
 */
async function handleEvents(interaction) {
    await interaction.deferReply();

    const clubName = interaction.options.getString('club_name');
    const guildId = interaction.guild.id;

    try {
        let query, params;

        if (clubName) {
            query = `SELECT e.*, c.name as club_name 
                     FROM club_events e
                     JOIN clubs c ON e.club_id = c.id
                     WHERE e.guild_id = ? AND LOWER(c.name) = LOWER(?) AND e.date >= date('now') AND e.status = 'scheduled'
                     ORDER BY e.date, e.start_time
                     LIMIT 10`;
            params = [guildId, clubName];
        } else {
            query = `SELECT e.*, c.name as club_name 
                     FROM club_events e
                     JOIN clubs c ON e.club_id = c.id
                     WHERE e.guild_id = ? AND e.date >= date('now') AND e.status = 'scheduled'
                     ORDER BY e.date, e.start_time
                     LIMIT 10`;
            params = [guildId];
        }

        const events = await new Promise((resolve, reject) => {
            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        if (events.length === 0) {
            return interaction.editReply({ content: '📅 No upcoming events found.' });
        }

        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(`📆 Upcoming Events${clubName ? ` - ${clubName}` : ''}`)
            .setDescription('Mark your calendar for these exciting events!')
            .setTimestamp();

        for (const event of events) {
            // Get RSVP count
            const rsvpCount = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT COUNT(*) as count FROM club_event_rsvps WHERE event_id = ? AND status = 'attending'`,
                    [event.id],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row?.count || 0);
                    }
                );
            });

            const eventType = event.event_type.charAt(0).toUpperCase() + event.event_type.slice(1);
            const attendeeInfo = event.max_attendees
                ? `${rsvpCount}/${event.max_attendees} attending`
                : `${rsvpCount} attending`;

            embed.addFields({
                name: `${event.title} [${event.club_name}]`,
                value: `**Type:** ${eventType}\n` +
                    `**Date:** ${event.date} at ${event.start_time || 'TBA'}\n` +
                    `**Location:** ${event.location || 'TBA'}\n` +
                    `**Attendees:** ${attendeeInfo}\n` +
                    `${event.description ? `*${event.description.substring(0, 100)}...*` : ''}`,
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('Error fetching events:', error);
        await interaction.editReply({ content: '❌ An error occurred while fetching events.' });
    }
}

/**
 * Admin: Sync data from Excel file
 */
async function handleSync(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: '❌ You need Manage Server permission to use this command.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const syncType = interaction.options.getString('sync_type');
    const attachment = interaction.options.getAttachment('file');

    if (!attachment.name.endsWith('.xlsx') && !attachment.name.endsWith('.xls')) {
        return interaction.editReply({ content: '❌ Please upload an Excel file (.xlsx or .xls)' });
    }

    try {
        const tempDir = path.join(process.cwd(), 'temp_excel_sync');
        try {
            await fs.mkdir(tempDir, { recursive: true });
        } catch (err) {
            if (err.code !== 'EEXIST') throw err;
        }

        const tempFilePath = path.join(tempDir, `${syncType}_${Date.now()}_${attachment.name}`);

        const response = await axios({
            method: 'GET',
            url: attachment.url,
            responseType: 'arraybuffer'
        });

        await fs.writeFile(tempFilePath, response.data);

        const { ClubExcelService } = await import('../../services/clubExcelService.js');
        const excelService = new ClubExcelService(interaction.client);

        const result = await excelService.syncFromExcel(syncType, tempFilePath);

        try {
            await fs.unlink(tempFilePath);
        } catch (cleanupErr) {
            console.error('Error cleaning up temp file:', cleanupErr);
        }

        if (result.success) {
            const embed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('✅ Sync Completed')
                .addFields(
                    { name: 'Sync Type', value: syncType, inline: true },
                    { name: 'Processed', value: result.processed.toString(), inline: true },
                    { name: 'Skipped', value: result.skipped.toString(), inline: true }
                )
                .setTimestamp();

            if (result.errors && result.errors.length > 0) {
                embed.addFields({
                    name: '⚠️ Errors',
                    value: result.errors.slice(0, 5).map(e => `Row ${e.row}: ${e.error}`).join('\n')
                });
            }

            await interaction.editReply({ embeds: [embed] });
        } else {
            await interaction.editReply({ content: `❌ Sync failed: ${result.error}` });
        }

    } catch (error) {
        console.error('Error syncing Excel:', error);
        await interaction.editReply({ content: `❌ An error occurred: ${error.message}` });
    }
}


/**
 * Admin: Export data to Excel
 */
async function handleExport(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: '❌ You need Manage Server permission to use this command.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const exportType = interaction.options.getString('export_type');

    try {
        const { ClubExcelService } = await import('../../services/clubExcelService.js');
        const excelService = new ClubExcelService(interaction.client);

        const exportDir = path.join(process.cwd(), 'exports');
        try {
            await fs.mkdir(exportDir, { recursive: true });
        } catch (err) {
            if (err.code !== 'EEXIST') throw err;
        }

        const outputPath = path.join(exportDir, `${exportType}_${Date.now()}.xlsx`);

        const result = await excelService.exportToExcel(exportType, outputPath);

        if (result.success) {
            await interaction.editReply({
                content: `✅ Export completed! ${result.rows} rows exported.`,
                files: [outputPath]
            });

            setTimeout(async () => {
                try {
                    await fs.unlink(outputPath);
                } catch (e) {
                    console.error('Error cleaning up export file:', e);
                }
            }, 5000);
        } else {
            await interaction.editReply({ content: `❌ Export failed: ${result.error}` });
        }

    } catch (error) {
        console.error('Error exporting to Excel:', error);
        await interaction.editReply({ content: `❌ An error occurred: ${error.message}` });
    }
}
/**
 * Admin: Approve pending club
 */
async function handleApprove(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ You need Administrator permission to approve clubs.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const clubId = interaction.options.getInteger('club_id');

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
            return interaction.editReply({ content: '❌ Club not found.' });
        }

        if (club.status !== 'pending') {
            return interaction.editReply({ content: `⚠️ This club is already ${club.status}.` });
        }

        // Create club infrastructure
        const guild = interaction.guild;
        const createdResources = await createClubInfrastructure(guild, club);

        if (!createdResources.success) {
            return interaction.editReply({ content: `❌ Failed to create club infrastructure: ${createdResources.error}` });
        }

        // Update club in database
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE clubs SET 
                    status = 'active',
                    role_id = ?,
                    channel_id = ?,
                    voice_channel_id = ?,
                    updated_at = ?
                 WHERE id = ?`,
                [
                    createdResources.role.id,
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

        // Assign president role
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
                    .setTitle(`🎉 Congratulations! ${club.name} has been approved!`)
                    .setDescription('Your club is now active and ready to grow!')
                    .addFields(
                        { name: '📢 Text Channel', value: `<#${createdResources.textChannel.id}>`, inline: true },
                        { name: '🎤 Voice Channel', value: `<#${createdResources.voiceChannel.id}>`, inline: true },
                        { name: '👥 Club Role', value: `<@&${createdResources.role.id}>`, inline: true },
                        {
                            name: '📋 Next Steps', value:
                                '1. Share the club join form with students\n' +
                                '2. Post your first announcement\n' +
                                '3. Schedule your first meeting\n' +
                                '4. Build your team!',
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
                        { name: '👔 President', value: `<@${club.president_user_id}>`, inline: true },
                        { name: '📂 Category', value: club.category, inline: true }
                    );

                if (club.advisor_name) {
                    channelWelcome.addFields({ name: '🎓 Club Advisor', value: club.advisor_name, inline: true });
                }

                if (club.meeting_day && club.meeting_time) {
                    channelWelcome.addFields({
                        name: '📅 Regular Meetings',
                        value: `${club.meeting_day}s at ${club.meeting_time}`,
                        inline: false
                    });
                }

                channelWelcome.addFields({
                    name: '🎯 Getting Started',
                    value: 'Fill out the join form to become a member!\n' +
                        'Stay tuned for upcoming events and activities.',
                    inline: false
                });

                await createdResources.textChannel.send({ embeds: [channelWelcome] });

            } catch (presidentError) {
                console.error('Error notifying president:', presidentError);
                // Continue even if notification fails
            }
        }

        // Send success message to admin
        const successEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Club Approved Successfully')
            .setDescription(`**${club.name}** is now active!`)
            .addFields(
                { name: 'Club ID', value: clubId.toString(), inline: true },
                { name: 'Category', value: club.category, inline: true },
                { name: 'President', value: club.president_user_id ? `<@${club.president_user_id}>` : 'Unknown', inline: true },
                { name: '📢 Text Channel', value: `<#${createdResources.textChannel.id}>`, inline: true },
                { name: '🎤 Voice Channel', value: `<#${createdResources.voiceChannel.id}>`, inline: true },
                { name: '👥 Role', value: `<@&${createdResources.role.id}>`, inline: true }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [successEmbed] });

    } catch (error) {
        console.error('Error approving club:', error);
        await interaction.editReply({ content: `❌ An error occurred: ${error.message}` });
    }
}

/**
 * Create complete club infrastructure (role, channels, permissions)
 */
async function createClubInfrastructure(guild, club) {
    try {
        // Create club role
        const role = await guild.roles.create({
            name: club.name,
            color: getRandomColor(),
            hoist: true,
            mentionable: true,
            reason: `Club approved: ${club.name}`
        });

        // Find or create "CLUBS" category
        let clubsCategory = guild.channels.cache.find(
            c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === 'clubs'
        );

        if (!clubsCategory) {
            clubsCategory = await guild.channels.create({
                name: '🏛️ CLUBS',
                type: ChannelType.GuildCategory,
                reason: 'Creating clubs category'
            });
        }

        // Create text channel
        const textChannel = await guild.channels.create({
            name: club.name.toLowerCase().replace(/\s+/g, '-'),
            type: ChannelType.GuildText,
            parent: clubsCategory.id,
            topic: club.description?.substring(0, 1024) || `Official channel for ${club.name}`,
            reason: `Club approved: ${club.name}`,
            permissionOverwrites: [
                {
                    id: guild.id, // @everyone
                    deny: [PermissionsBitField.Flags.ViewChannel]
                },
                {
                    id: role.id, // Club role
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

        // Create voice channel
        const voiceChannel = await guild.channels.create({
            name: `🎤 ${club.name}`,
            type: ChannelType.GuildVoice,
            parent: clubsCategory.id,
            reason: `Club approved: ${club.name}`,
            permissionOverwrites: [
                {
                    id: guild.id, // @everyone
                    deny: [PermissionsBitField.Flags.ViewChannel]
                },
                {
                    id: role.id, // Club role
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.Connect,
                        PermissionsBitField.Flags.Speak,
                        PermissionsBitField.Flags.Stream
                    ]
                }
            ]
        });

        return {
            success: true,
            role,
            textChannel,
            voiceChannel
        };

    } catch (error) {
        console.error('Error creating club infrastructure:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Generate random color for club role
 */
function getRandomColor() {
    const colors = [
        0x5865F2, // Blurple
        0x57F287, // Green
        0xFEE75C, // Yellow
        0xEB459E, // Pink
        0xED4245, // Red
        0xF26522, // Orange
        0x00D9FF, // Cyan
        0x9B59B6, // Purple
        0xE91E63, // Magenta
        0x00BCD4, // Teal
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

/**
 * Admin: View pending clubs
 */
async function handlePending(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ You need Administrator permission to use this command.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guild.id;

    try {
        const pendingClubs = await new Promise((resolve, reject) => {
            db.all(
                `SELECT c.*, v.real_name as president_name, v.email as president_email
                 FROM clubs c
                 LEFT JOIN verified_users v ON c.president_user_id = v.user_id
                 WHERE c.guild_id = ? AND c.status = 'pending'
                 ORDER BY c.created_at DESC`,
                [guildId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        if (pendingClubs.length === 0) {
            return interaction.editReply({ content: '✅ No pending club registrations at this time.' });
        }

        const embed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('📋 Pending Club Registrations')
            .setDescription(`${pendingClubs.length} club(s) awaiting approval`)
            .setTimestamp();

        for (const club of pendingClubs.slice(0, 10)) { // Limit to 10 to avoid embed limits
            const createdDate = new Date(club.created_at * 1000).toLocaleDateString();

            let fieldValue = `**Description:** ${club.description?.substring(0, 100) || 'None'}...\n`;
            fieldValue += `**Category:** ${club.category}\n`;
            fieldValue += `**President:** ${club.president_name || 'Unknown'}\n`;
            fieldValue += `**Email:** ${club.president_email || 'Unknown'}\n`;

            if (club.advisor_name) {
                fieldValue += `**Advisor:** ${club.advisor_name}\n`;
            }

            if (club.max_members) {
                fieldValue += `**Max Members:** ${club.max_members}\n`;
            }

            fieldValue += `**Submitted:** ${createdDate}\n`;
            fieldValue += `\n**To Approve:** \`/clubs approve club_id:${club.id}\``;
            fieldValue += `\n**To Reject:** \`/clubs reject club_id:${club.id}\``;

            embed.addFields({
                name: `🆔 ${club.id} - ${club.name}`,
                value: fieldValue,
                inline: false
            });
        }

        if (pendingClubs.length > 10) {
            embed.setFooter({ text: `Showing 10 of ${pendingClubs.length} pending clubs` });
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('Error fetching pending clubs:', error);
        await interaction.editReply({ content: `❌ An error occurred: ${error.message}` });
    }
}

/**
 * Admin: Reject pending club
 */
async function handleReject(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ You need Administrator permission to reject clubs.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const clubId = interaction.options.getInteger('club_id');
    const reason = interaction.options.getString('reason');

    try {
        // Get club details
        const club = await new Promise((resolve, reject) => {
            db.get(
                `SELECT c.*, v.real_name as president_name
                 FROM clubs c
                 LEFT JOIN verified_users v ON c.president_user_id = v.user_id
                 WHERE c.id = ?`,
                [clubId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!club) {
            return interaction.editReply({ content: '❌ Club not found.' });
        }

        if (club.status !== 'pending') {
            return interaction.editReply({ content: `⚠️ This club is already ${club.status}.` });
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
                    .setTitle('❌ Club Registration Not Approved')
                    .setDescription(`Unfortunately, your club registration for **${club.name}** has not been approved.`)
                    .addFields(
                        { name: 'Reason', value: reason, inline: false },
                        {
                            name: 'Next Steps', value:
                                '• Review the feedback provided\n' +
                                '• Make necessary adjustments\n' +
                                '• Submit a new registration if desired\n' +
                                '• Contact an administrator for clarification',
                            inline: false
                        }
                    )
                    .setFooter({ text: 'Thank you for your interest in creating a club' })
                    .setTimestamp();

                await president.send({ embeds: [rejectionEmbed] });

            } catch (dmError) {
                console.error('Error notifying president of rejection:', dmError);
            }
        }

        // Confirm to admin
        const confirmEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ Club Registration Rejected')
            .setDescription(`**${club.name}** has been rejected`)
            .addFields(
                { name: 'Club ID', value: clubId.toString(), inline: true },
                { name: 'President', value: club.president_name || 'Unknown', inline: true },
                { name: 'Reason Given', value: reason, inline: false }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [confirmEmbed] });

    } catch (error) {
        console.error('Error rejecting club:', error);
        await interaction.editReply({ content: `❌ An error occurred: ${error.message}` });
    }
}

// Autocomplete handler for club names
export async function autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);

    if (focusedOption.name === 'club_name') {
        const guildId = interaction.guild.id;
        const search = focusedOption.value.toLowerCase();

        try {
            const clubs = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT name FROM clubs WHERE guild_id = ? AND status = 'active' AND LOWER(name) LIKE ? LIMIT 25`,
                    [guildId, `%${search}%`],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                );
            });

            const choices = clubs.map(club => ({ name: club.name, value: club.name }));
            await interaction.respond(choices);
        } catch (error) {
            console.error('Error in autocomplete:', error);
            await interaction.respond([]);
        }
    }
}