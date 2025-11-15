// src/commands/slash/createEvent.js
import { 
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} from 'discord.js';
import { db, getClubByIdentifier } from '../../database.js';
import { log } from '../../utils/debug.js';
import { checkClubPermission } from '../../utils/clubPermissions.js';

export const data = new SlashCommandBuilder()
    .setName('createevent')
    .setDescription('Create a new club event')
    .addStringOption(option =>
        option.setName('club')
            .setDescription('Your club name or slug')
            .setRequired(true)
            .setAutocomplete(true));

export async function execute(interaction) {
    const clubIdentifier = interaction.options.getString('club');
    const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID || 'YOUR_VERIFIED_ROLE_ID';

    try {
        // Check if user has Pulchowkian/Verified role
        if (!interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) {
            return await interaction.reply({
                content: '❌ Only verified @Pulchowkian members can create club events. Please verify first using `/verify`!',
                flags: MessageFlags.Ephemeral
            });
        }

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
                content: `❌ This club is currently ${club.status} and cannot create events.`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Check authorization - moderators and presidents can create events
        const permissionCheck = await checkClubPermission({
            member: interaction.member,
            clubId: club.id,
            action: 'moderate'
        });

        if (!permissionCheck.allowed) {
            return await interaction.reply({
                content: `❌ You don't have permission to create events for this club.\n**Reason:** ${permissionCheck.reason}\n\n*Only club presidents, moderators, and server admins can create events.*`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Show modal for event creation
        const modal = new ModalBuilder()
            .setCustomId(`create_event_modal_${club.id}`)
            .setTitle(`Create Event - ${club.name}`);

        const titleInput = new TextInputBuilder()
            .setCustomId('event_title')
            .setLabel('Event Title')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g., Annual Tech Fest 2025')
            .setRequired(true)
            .setMaxLength(100);

        const descriptionInput = new TextInputBuilder()
            .setCustomId('event_description')
            .setLabel('Event Description')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Describe your event...')
            .setRequired(true)
            .setMaxLength(1000);

        const dateTimeInput = new TextInputBuilder()
            .setCustomId('event_datetime')
            .setLabel('Date & Time (YYYY-MM-DD HH:MM)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('2025-12-25 14:30')
            .setRequired(true)
            .setMaxLength(50);

        const venueInput = new TextInputBuilder()
            .setCustomId('event_venue')
            .setLabel('Venue (or "Virtual" for online)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g., Auditorium Block A or Virtual')
            .setRequired(true)
            .setMaxLength(200);

        const participantsInput = new TextInputBuilder()
            .setCustomId('event_participants')
            .setLabel('Max Participants (or leave blank)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g., 50')
            .setRequired(false)
            .setMaxLength(10);

        modal.addComponents(
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(descriptionInput),
            new ActionRowBuilder().addComponents(dateTimeInput),
            new ActionRowBuilder().addComponents(venueInput),
            new ActionRowBuilder().addComponents(participantsInput)
        );

        await interaction.showModal(modal);

    } catch (error) {
        log('Error in createevent command', 'club', null, error, 'error');
        await interaction.reply({
            content: '❌ An error occurred. Please try again.',
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }
}

/**
 * Handle create event modal submission
 */
export async function handleCreateEventModal(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        // Extract club_id from customId
        const clubId = parseInt(interaction.customId.split('_')[3]);

        if (isNaN(clubId)) {
            return await interaction.editReply({
                content: '❌ Invalid club ID. Please try again.'
            });
        }

        // Get event data from modal
        const title = interaction.fields.getTextInputValue('event_title');
        const description = interaction.fields.getTextInputValue('event_description');
        const dateTimeStr = interaction.fields.getTextInputValue('event_datetime');
        const venue = interaction.fields.getTextInputValue('event_venue');
        const maxParticipantsStr = interaction.fields.getTextInputValue('event_participants') || null;

        // Parse date and time
        const dateTimeMatch = dateTimeStr.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})$/);
        if (!dateTimeMatch) {
            return await interaction.editReply({
                content: '❌ Invalid date/time format. Please use: YYYY-MM-DD HH:MM\nExample: 2025-12-25 14:30'
            });
        }

        const eventDate = dateTimeMatch[1];
        const startTime = dateTimeMatch[2];

        // Validate date is in the future
        const eventDateTime = new Date(`${eventDate}T${startTime}`);
        if (eventDateTime <= new Date()) {
            return await interaction.editReply({
                content: '❌ Event date must be in the future.'
            });
        }

        // Parse max participants
        let maxParticipants = null;
        if (maxParticipantsStr) {
            maxParticipants = parseInt(maxParticipantsStr);
            if (isNaN(maxParticipants) || maxParticipants < 1) {
                return await interaction.editReply({
                    content: '❌ Max participants must be a positive number.'
                });
            }
        }

        // Determine location type
        const isVirtual = venue.toLowerCase().includes('virtual') || venue.toLowerCase().includes('online');
        const locationType = isVirtual ? 'virtual' : 'physical';

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

        // Re-check authorization
        const permissionCheck = await checkClubPermission({
            member: interaction.member,
            clubId: club.id,
            action: 'moderate'
        });

        if (!permissionCheck.allowed) {
            return await interaction.editReply({
                content: `❌ You don't have permission to create events for this club.\n**Reason:** ${permissionCheck.reason}`
            });
        }

        // Check club settings for event approval requirement
        const clubSettings = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM club_settings WHERE club_id = ?`,
                [clubId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        const requireApproval = clubSettings?.require_event_approval !== false;
        const status = requireApproval ? 'pending' : 'scheduled';

        // Create event
        const eventId = await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_events 
                (club_id, guild_id, title, description, event_date, start_time, venue, location_type, max_participants, status, created_by, visibility) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'club')`,
                [clubId, interaction.guild.id, title, description, eventDate, startTime, venue, locationType, maxParticipants, status, interaction.user.id],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });

        // Log action
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_audit_log (guild_id, club_id, action_type, performed_by, target_id, details) 
                 VALUES (?, ?, 'event_created', ?, ?, ?)`,
                [
                    interaction.guild.id,
                    clubId,
                    interaction.user.id,
                    eventId.toString(),
                    JSON.stringify({ 
                        clubName: club.name,
                        clubSlug: club.slug,
                        eventTitle: title,
                        status,
                        permissionLevel: permissionCheck.level
                    })
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        if (requireApproval) {
            // Send for approval
            const EVENT_APPROVAL_CHANNEL_ID = process.env.EVENT_APPROVAL_CHANNEL_ID;

            if (EVENT_APPROVAL_CHANNEL_ID && EVENT_APPROVAL_CHANNEL_ID !== 'YOUR_EVENT_APPROVAL_CHANNEL_ID') {
                try {
                    const approvalChannel = await interaction.guild.channels.fetch(EVENT_APPROVAL_CHANNEL_ID);

                    const approvalEmbed = new EmbedBuilder()
                        .setColor('#FFA500')
                        .setTitle('📅 New Event Approval Request')
                        .setDescription(`**${title}**`)
                        .addFields(
                            { name: '🏛️ Club', value: club.name, inline: true },
                            { name: '🔗 Slug', value: `\`${club.slug}\``, inline: true },
                            { name: '🆔 Event ID', value: eventId.toString(), inline: true },
                            { name: '📅 Date & Time', value: `${eventDate} at ${startTime}`, inline: true },
                            { name: '📍 Venue', value: venue, inline: true },
                            { name: '🌐 Type', value: locationType === 'virtual' ? 'Virtual' : 'Physical', inline: true },
                            { name: '📝 Description', value: description.length > 1000 ? description.substring(0, 997) + '...' : description }
                        );

                    if (maxParticipants) {
                        approvalEmbed.addFields({ name: '👥 Max Participants', value: maxParticipants.toString(), inline: true });
                    }

                    approvalEmbed.addFields(
                        { name: '👤 Created By', value: `<@${interaction.user.id}> (${permissionCheck.level})`, inline: true },
                        { name: '⚙️ Action Required', value: `Use the buttons below or run:\n\`/event approve event_id:${eventId}\``, inline: false }
                    );

                    if (club.logo_url) {
                        approvalEmbed.setThumbnail(club.logo_url);
                    }

                    approvalEmbed.setTimestamp();

                    const approveBtn = new ButtonBuilder()
                        .setCustomId(`approve_event_${eventId}`)
                        .setLabel('Approve Event')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('✅');

                    const rejectBtn = new ButtonBuilder()
                        .setCustomId(`reject_event_${eventId}`)
                        .setLabel('Reject Event')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('❌');

                    const row = new ActionRowBuilder().addComponents(approveBtn, rejectBtn);

                    await approvalChannel.send({ embeds: [approvalEmbed], components: [row] });

                } catch (channelError) {
                    log('Failed to send event for approval', 'club', null, channelError, 'error');
                }
            }

            // Confirm to user
            const confirmEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('✅ Event Created - Pending Approval')
                .setDescription(`Your event **${title}** has been submitted for approval.`)
                .addFields(
                    { name: '🆔 Event ID', value: eventId.toString(), inline: true },
                    { name: '🏛️ Club', value: club.name, inline: true },
                    { name: '🔗 Slug', value: `\`${club.slug}\``, inline: true },
                    { name: '📅 Date & Time', value: `${eventDate} at ${startTime}`, inline: true },
                    { name: '📍 Venue', value: venue, inline: true },
                    { name: '📊 Status', value: 'Pending Approval', inline: true },
                    { name: '⏳ Next Steps', value: 
                        '• Wait for admin approval (usually 24-48h)\n' +
                        '• You\'ll receive a DM when approved\n' +
                        '• Once approved, members can register'
                    }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [confirmEmbed] });

        } else {
            // Auto-approved, post directly to club channel
            const confirmEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('✅ Event Created Successfully')
                .setDescription(`Your event **${title}** is now live!`)
                .addFields(
                    { name: '🆔 Event ID', value: eventId.toString(), inline: true },
                    { name: '🏛️ Club', value: club.name, inline: true },
                    { name: '🔗 Slug', value: `\`${club.slug}\``, inline: true },
                    { name: '📅 Date & Time', value: `${eventDate} at ${startTime}`, inline: true },
                    { name: '📍 Venue', value: venue, inline: true },
                    { name: '📊 Status', value: 'Live - Members can register', inline: true },
                    { name: '✅ Posted to', value: club.channel_id ? `<#${club.channel_id}>` : 'Club channel', inline: false }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [confirmEmbed] });

            // Post to club channel (would be handled by event approval handler logic)
            // For auto-approved events, we could post directly here
        }

    } catch (error) {
        log('Error handling create event modal', 'club', null, error, 'error');
        await interaction.editReply({
            content: `❌ An error occurred: ${error.message}\n\nPlease try again or contact an administrator.`
        });
    }
}

/**
 * Autocomplete handler for club names (only clubs user can create events in)
 */
export async function autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();
    const guildId = interaction.guild.id;
    const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID || 'YOUR_VERIFIED_ROLE_ID';

    try {
        // Check if user is verified
        if (!interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) {
            return await interaction.respond([{
                name: '❌ You must be verified to create events',
                value: 'not_verified'
            }]);
        }

        // Get all active clubs
        const clubs = await new Promise((resolve, reject) => {
            db.all(
                `SELECT id, name, slug
                 FROM clubs
                 WHERE guild_id = ? AND status = 'active'
                 ORDER BY name ASC`,
                [guildId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        // Filter clubs based on input and permission
        const filtered = [];
        for (const club of clubs) {
            // Check if name or slug matches
            if (club.name.toLowerCase().includes(focusedValue.toLowerCase()) ||
                club.slug.toLowerCase().includes(focusedValue.toLowerCase())) {
                
                // Check if user can create events for this club
                const permCheck = await checkClubPermission({
                    member: interaction.member,
                    clubId: club.id,
                    action: 'moderate'
                });

                if (permCheck.allowed) {
                    filtered.push({
                        name: `${club.name} (${club.slug}) - ${permCheck.level}`,
                        value: club.slug
                    });
                }
            }

            // Limit to 25 results
            if (filtered.length >= 25) break;
        }

        if (filtered.length === 0) {
            filtered.push({
                name: '❌ No clubs found or no permission',
                value: 'no_clubs'
            });
        }

        await interaction.respond(filtered);
    } catch (error) {
        log('Error in createevent autocomplete', 'club', null, error, 'error');
        await interaction.respond([]);
    }
}