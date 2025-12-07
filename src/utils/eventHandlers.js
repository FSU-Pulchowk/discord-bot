// src/utils/eventHandlers.js
import {
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder
} from 'discord.js';
import { db } from '../database.js';
import { log } from './debug.js';
import { isServerModerator, checkClubPermission } from './clubPermissions.js';
import { emailService } from '../services/emailService.js';

const emailSvc = new emailService();

/**
 * Handle event approval button (Server Admins only)
 */
export async function handleEventApproval(interaction) {
    await interaction.deferUpdate();

    const eventId = parseInt(interaction.customId.split('_')[2]);

    // Check permissions - Only server admins can approve events
    if (!isServerModerator(interaction.member)) {
        return await interaction.followUp({
            content: '❌ You need Administrator permission to approve events.',
            ephemeral: true
        });
    }

    try {
        // Get event details
        const event = await new Promise((resolve, reject) => {
            db.get(
                `SELECT e.*, c.name as club_name, c.slug as club_slug, c.channel_id as club_channel_id, c.role_id
                 FROM club_events e
                 JOIN clubs c ON e.club_id = c.id
                 WHERE e.id = ?`,
                [eventId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!event) {
            return await interaction.followUp({
                content: '❌ Event not found.',
                ephemeral: true
            });
        }

        if (event.status !== 'pending') {
            return await interaction.followUp({
                content: `⚠️ This event has already been ${event.status}.`,
                ephemeral: true
            });
        }

        // Update event status
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE club_events SET status = 'scheduled', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`,
                [interaction.user.id, Date.now(), Date.now(), eventId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Get current participant count
        const participantCount = await new Promise((resolve, reject) => {
            db.get(
                `SELECT COUNT(*) as count FROM event_participants WHERE event_id = ? AND rsvp_status = 'going'`,
                [eventId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.count || 0);
                }
            );
        });

        // Create event embed for club channel
        const eventEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(`📅 ${event.title}`)
            .setDescription(event.description)
            .addFields(
                { name: '🏛️ Club', value: event.club_name, inline: true },
                { name: '🔗 Slug', value: `\`${event.club_slug}\``, inline: true },
                { name: '📂 Type', value: event.event_type.charAt(0).toUpperCase() + event.event_type.slice(1), inline: true },
                { name: '📅 Date', value: event.event_date, inline: true },
                { name: '⏰ Time', value: event.start_time || 'TBA', inline: true }
            );

        // Add location based on type
        if (event.location_type === 'virtual') {
            eventEmbed.addFields({ name: '🌐 Location', value: 'Virtual Event', inline: true });
            if (event.meeting_link) {
                eventEmbed.addFields({ name: '🔗 Meeting Link', value: event.meeting_link, inline: false });
            }
        } else if (event.location_type === 'hybrid') {
            eventEmbed.addFields({ name: '🏢 Location', value: `${event.venue || 'TBA'} (Hybrid)`, inline: true });
            if (event.meeting_link) {
                eventEmbed.addFields({ name: '🔗 Virtual Option', value: event.meeting_link, inline: false });
            }
        } else {
            eventEmbed.addFields({ name: '📍 Venue', value: event.venue || 'TBA', inline: true });
        }

        // Add participant info
        const maxPart = event.max_participants || event.min_participants || 'Unlimited';
        eventEmbed.addFields({
            name: '📊 Participants',
            value: `${participantCount} / ${maxPart}`,
            inline: true
        });

        // Add registration info if required
        if (event.registration_required) {
            let regInfo = 'Registration Required';
            if (event.registration_deadline) {
                regInfo += `\nDeadline: ${event.registration_deadline}`;
            }
            if (event.registration_fee && event.registration_fee > 0) {
                regInfo += `\nFee: Rs. ${event.registration_fee}`;
            }
            if (event.external_form_url) {
                regInfo += `\n[Register Here](${event.external_form_url})`;
            }
            eventEmbed.addFields({ name: '📝 Registration', value: regInfo, inline: false });
        }

        // Add team info if team event
        if (event.is_team_event) {
            let teamInfo = `Team Size: ${event.team_size_min || 1}-${event.team_size_max || '∞'}`;
            if (event.require_team_captain) {
                teamInfo += '\nTeam Captain Required';
            }
            eventEmbed.addFields({ name: '👥 Team Event', value: teamInfo, inline: false });
        }

        // Add eligibility if specified
        if (event.eligibility_criteria) {
            try {
                const criteria = JSON.parse(event.eligibility_criteria);
                let eligText = '';
                if (criteria.batch && criteria.batch.length > 0) {
                    eligText += `Batches: ${criteria.batch.join(', ')}\n`;
                }
                if (criteria.faculty && criteria.faculty.length > 0) {
                    eligText += `Faculties: ${criteria.faculty.join(', ')}`;
                }
                if (eligText) {
                    eventEmbed.addFields({ name: '🎓 Eligibility', value: eligText, inline: false });
                }
            } catch (e) {
                // Skip if not valid JSON
            }
        }

        // Add poster if available
        if (event.poster_url) {
            eventEmbed.setImage(event.poster_url);
        }

        eventEmbed.setTimestamp()
            .setFooter({ text: `Event ID: ${eventId} | Click Join to participate` });

        const joinButton = new ButtonBuilder()
            .setCustomId(`join_event_${eventId}`)
            .setLabel(event.registration_required ? 'Register' : 'Join Event')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🎯');

        const previewButton = new ButtonBuilder()
            .setCustomId(`preview_participants_${eventId}`)
            .setLabel('View Participants')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('👥');

        const row = new ActionRowBuilder().addComponents(joinButton, previewButton);

        // Post to club channel
        const clubChannel = await interaction.guild.channels.fetch(event.club_channel_id);
        const eventMessage = await clubChannel.send({
            content: event.role_id ? `<@&${event.role_id}> New event announced!` : null,
            embeds: [eventEmbed],
            components: [row]
        });

        // Save message ID
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE club_events SET message_id = ?, updated_at = ? WHERE id = ?`,
                [eventMessage.id, Date.now(), eventId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Post to public Event Announcements channel if visibility allows
        const EVENT_ANNOUNCEMENTS_CHANNEL_ID = process.env.EVENT_ANNOUNCEMENTS_CHANNEL_ID;
        if (EVENT_ANNOUNCEMENTS_CHANNEL_ID &&
            EVENT_ANNOUNCEMENTS_CHANNEL_ID !== 'YOUR_EVENT_ANNOUNCEMENTS_CHANNEL_ID' &&
            (event.visibility === 'guild' || event.visibility === 'public')) {
            try {
                const eventAnnouncementsChannel = await interaction.guild.channels.fetch(EVENT_ANNOUNCEMENTS_CHANNEL_ID);

                const publicEventEmbed = EmbedBuilder.from(eventEmbed)
                    .setFooter({ text: `Hosted by ${event.club_name} | Join the club to participate!` });

                // Remove join button for public announcements, add info button instead
                const infoButton = new ButtonBuilder()
                    .setLabel('More Info')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`https://discord.com/channels/${interaction.guild.id}/${event.club_channel_id}/${eventMessage.id}`)
                    .setEmoji('ℹ️');

                const publicRow = new ActionRowBuilder().addComponents(infoButton);

                await eventAnnouncementsChannel.send({
                    content: `🎉 **New Event: ${event.title}**`,
                    embeds: [publicEventEmbed],
                    components: [publicRow]
                });
            } catch (announceError) {
                log('Failed to post to public event announcements channel', 'club', null, announceError, 'warn');
            }
        }

        // Update approval message
        const approvedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor('#00FF00')
            .addFields({ name: '✅ Approved by', value: `<@${interaction.user.id}>`, inline: true });

        await interaction.editReply({ embeds: [approvedEmbed], components: [] });

        // Notify creator
        try {
            const creator = await interaction.client.users.fetch(event.created_by);
            const notifyEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('🎉 Event Approved!')
                .setDescription(`Your event **${event.title}** has been approved and posted!`)
                .addFields(
                    { name: '🆔 Event ID', value: eventId.toString(), inline: true },
                    { name: '🏛️ Club', value: event.club_name, inline: true },
                    { name: '🔗 Slug', value: `\`${event.club_slug}\``, inline: true },
                    { name: '📢 Posted in', value: `<#${event.club_channel_id}>`, inline: false },
                    {
                        name: '✅ Next Steps', value:
                            '• Event is now live for registrations\n' +
                            '• Members can join using the Join Event button\n' +
                            '• Use View Participants to see registrations\n' +
                            '• Registration closes when capacity is reached'
                    }
                )
                .setTimestamp();

            await creator.send({ embeds: [notifyEmbed] });

            // Send email notification
            try {
                const creatorEmail = await new Promise((resolve, reject) => {
                    db.get(
                        `SELECT email FROM verified_users WHERE user_id = ?`,
                        [event.created_by],
                        (err, row) => {
                            if (err) reject(err);
                            else resolve(row?.email);
                        }
                    );
                });

                if (creatorEmail) {
                    const emailHtml = `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #00FF00;">🎉 Event Approved!</h2>
                            <p>Great news! Your event <strong>${event.title}</strong> has been approved and is now live!</p>
                            
                            <h3>📋 Event Details:</h3>
                            <ul>
                                <li><strong>Event:</strong> ${event.title}</li>
                                <li><strong>Club:</strong> ${event.club_name}</li>
                                <li><strong>Date:</strong> ${event.event_date}</li>
                                <li><strong>Time:</strong> ${event.start_time || 'TBA'}</li>
                                <li><strong>Venue:</strong> ${event.venue || 'TBA'}</li>
                            </ul>
                            
                            <h3>🎯 Next Steps:</h3>
                            <ul>
                                <li>Event is now live for registrations</li>
                                <li>Members can join using the Join Event button</li>
                                <li>Use "View Participants" to see registrations</li>
                                <li>Registration closes when capacity is reached</li>
                            </ul>
                            
                            <p style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
                                Best regards,<br>
                                <strong>FSU Pulchowk Discord Bot</strong>
                            </p>
                        </div>
                    `;

                    await emailSvc.sendEmail(
                        creatorEmail,
                        `🎉 ${event.title} - Event Approved!`,
                        emailHtml
                    );
                    log('Sent event approval email', 'event', { email: creatorEmail, eventId });
                }
            } catch (emailError) {
                log('Error sending event approval email', 'event', null, emailError, 'warn');
            }

        } catch (dmError) {
            log('Failed to notify event creator', 'club', null, dmError, 'warn');
        }

        // Log action
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_audit_log (guild_id, club_id, action_type, performed_by, target_id, details) 
                 VALUES (?, ?, 'event_approved', ?, ?, ?)`,
                [
                    interaction.guild.id,
                    event.club_id,
                    interaction.user.id,
                    eventId.toString(),
                    JSON.stringify({
                        clubId: event.club_id,
                        clubName: event.club_name,
                        clubSlug: event.club_slug,
                        title: event.title
                    })
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

    } catch (error) {
        log('Error approving event:', 'club', null, error, 'error');
        await interaction.followUp({
            content: '❌ An error occurred while approving the event.',
            ephemeral: true
        });
    }
}

/**
 * Handle event rejection button
 */
export async function handleEventRejection(interaction) {
    await interaction.deferUpdate();

    const eventId = parseInt(interaction.customId.split('_')[2]);

    // Check permissions
    if (!isServerAdmin(interaction.member)) {
        return await interaction.followUp({
            content: '❌ You need Administrator permission to reject events.',
            ephemeral: true
        });
    }

    try {
        // Get event details
        const event = await new Promise((resolve, reject) => {
            db.get(
                `SELECT e.*, c.name as club_name, c.slug as club_slug
                 FROM club_events e
                 JOIN clubs c ON e.club_id = c.id
                 WHERE e.id = ?`,
                [eventId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!event) {
            return await interaction.followUp({
                content: '❌ Event not found.',
                ephemeral: true
            });
        }

        if (event.status !== 'pending') {
            return await interaction.followUp({
                content: `⚠️ This event has already been ${event.status}.`,
                ephemeral: true
            });
        }

        // Update event status
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE club_events SET status = 'rejected', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`,
                [interaction.user.id, Date.now(), Date.now(), eventId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Update approval message
        const rejectedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor('#FF0000')
            .addFields({ name: '❌ Rejected by', value: `<@${interaction.user.id}>`, inline: true });

        await interaction.editReply({ embeds: [rejectedEmbed], components: [] });

        // Notify creator
        try {
            const creator = await interaction.client.users.fetch(event.created_by);
            const notifyEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Event Not Approved')
                .setDescription(`Your event **${event.title}** was not approved.`)
                .addFields(
                    { name: '🏛️ Club', value: event.club_name, inline: true },
                    { name: '🔗 Slug', value: `\`${event.club_slug}\``, inline: true },
                    {
                        name: '💡 What you can do', value:
                            '• Review the event details\n' +
                            '• Contact an admin for feedback\n' +
                            '• Make necessary changes\n' +
                            '• Submit a new event request'
                    }
                )
                .setTimestamp();

            await creator.send({ embeds: [notifyEmbed] });
        } catch (dmError) {
            log('Failed to notify event creator', 'club', null, dmError, 'warn');
        }

        // Log action
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_audit_log (guild_id, club_id, action_type, performed_by, target_id, details) 
                 VALUES (?, ?, 'event_rejected', ?, ?, ?)`,
                [
                    interaction.guild.id,
                    event.club_id,
                    interaction.user.id,
                    eventId.toString(),
                    JSON.stringify({
                        clubId: event.club_id,
                        clubName: event.club_name,
                        clubSlug: event.club_slug,
                        title: event.title
                    })
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

    } catch (error) {
        log('Error rejecting event:', 'club', null, error, 'error');
        await interaction.followUp({
            content: '❌ An error occurred while rejecting the event.',
            ephemeral: true
        });
    }
}

/**
 * Handle join event button
 */
export async function handleJoinEventButton(interaction) {
    const eventId = parseInt(interaction.customId.split('_')[2]);
    const PULCHOWKIAN_ROLE_ID = process.env.VERIFIED_ROLE_ID;

    try {
        // Check if user is verified
        const isVerified = PULCHOWKIAN_ROLE_ID && interaction.member.roles.cache.has(PULCHOWKIAN_ROLE_ID);

        if (!isVerified) {
            // Non-verified users: collect email and phone via modal
            const { showNonVerifiedModal } = await import('./nonVerifiedRegistration.js');
            return await showNonVerifiedModal(interaction, eventId);
        }

        // Check event-specific role eligibility
        const { checkEventEligibility } = await import('./roleSelector.js');
        const eligibilityCheck = await checkEventEligibility(
            interaction.user.id,
            eventId,
            interaction.member,
            db
        );

        if (!eligibilityCheck.eligible) {
            return await interaction.reply({
                content: `❌ **You are not eligible for this event.**\n\n${eligibilityCheck.reason}`,
                ephemeral: true
            });
        }

        // Get event details
        const event = await new Promise((resolve, reject) => {
            db.get(
                `SELECT e.*, c.name as club_name, c.slug as club_slug,
                 (SELECT COUNT(*) FROM event_participants WHERE event_id = e.id AND rsvp_status = 'going') as participant_count
                 FROM club_events e
                 JOIN clubs c ON e.club_id = c.id
                 WHERE e.id = ?`,
                [eventId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!event || event.status !== 'scheduled') {
            return await interaction.reply({
                content: '❌ This event is not accepting registrations.',
                ephemeral: true
            });
        }

        // Check if already registered
        const existing = await new Promise((resolve, reject) => {
            db.get(
                `SELECT id FROM event_participants WHERE event_id = ? AND user_id = ?`,
                [eventId, interaction.user.id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (existing) {
            return await interaction.reply({
                content: '✅ You are already registered for this event!',
                ephemeral: true
            });
        }

        // Check capacity
        if (event.max_participants && event.participant_count >= event.max_participants) {
            return await interaction.reply({
                content: '❌ This event has reached its participant limit.',
                ephemeral: true
            });
        }

        // Check if external form is required
        if (event.external_form_url) {
            const formEmbed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle(`📝 External Registration Required`)
                .setDescription(`To register for **${event.title}**, please complete the external form.`)
                .addFields(
                    { name: '🏛️ Club', value: event.club_name, inline: true },
                    { name: '🔗 Form', value: `[Click here to register](${event.external_form_url})`, inline: false }
                )
                .setFooter({ text: 'Complete the form and you\'ll be added automatically' });

            return await interaction.reply({ embeds: [formEmbed], ephemeral: true });
        }

        // Check if payment is required
        if (event.registration_fee && event.registration_fee > 0) {
            const { initiateRegistrationWithPayment } = await import('./eventRegistration.js');

            const paymentResult = await initiateRegistrationWithPayment(interaction, eventId, event);

            return await interaction.reply({
                content: paymentResult.message,
                ephemeral: true
            });
        }

        // Register user (for free events)
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO event_participants (event_id, user_id, guild_id, rsvp_status) VALUES (?, ?, ?, 'going')`,
                [eventId, interaction.user.id, interaction.guild.id],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Update participant count in embed
        const newCount = event.participant_count + 1;
        try {
            const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0]);

            // Find and update the Participants field
            const fields = updatedEmbed.data.fields;
            const participantFieldIndex = fields?.findIndex(f => f.name === '📊 Participants');
            if (participantFieldIndex !== -1) {
                const maxPart = event.max_participants || event.min_participants || 'Unlimited';
                fields[participantFieldIndex].value = `${newCount} / ${maxPart}`;
            }

            await interaction.message.edit({ embeds: [updatedEmbed] });
        } catch (editError) {
            log('Failed to update event embed', 'club', null, editError, 'warn');
        }

        // Confirm to user
        const confirmEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Successfully Registered!')
            .setDescription(`You are now registered for **${event.title}**`)
            .addFields(
                { name: '🏛️ Club', value: event.club_name, inline: true },
                { name: '🔗 Slug', value: `\`${event.club_slug}\``, inline: true },
                { name: '📅 Date & Time', value: `${event.event_date} at ${event.start_time || 'TBA'}`, inline: false }
            );

        if (event.location_type === 'virtual' && event.meeting_link) {
            confirmEmbed.addFields({ name: '🔗 Meeting Link', value: event.meeting_link, inline: false });
        } else if (event.venue) {
            confirmEmbed.addFields({ name: '📍 Venue', value: event.venue, inline: false });
        }

        confirmEmbed.addFields({
            name: '📋 What\'s Next',
            value:
                '• You\'ll receive reminders before the event\n' +
                '• Check the club channel for updates\n' +
                '• Arrive on time for attendance'
        });

        await interaction.reply({ embeds: [confirmEmbed], ephemeral: true });

        // Close registration if capacity reached
        if (event.max_participants && newCount >= event.max_participants) {
            const closedRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`join_event_${eventId}_closed`)
                    .setLabel('Registration Closed')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true)
                    .setEmoji('🔒')
            );

            await interaction.message.edit({ components: [closedRow] });

            // Notify club president
            const club = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT president_user_id FROM clubs WHERE id = ?`,
                    [event.club_id],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });

            if (club?.president_user_id) {
                try {
                    const president = await interaction.client.users.fetch(club.president_user_id);
                    await president.send({
                        content: `🎉 Event **${event.title}** has reached full capacity with ${newCount} participants!`
                    });
                } catch (dmError) {
                    log('Failed to notify president', 'club', null, dmError, 'warn');
                }
            }
        }

        // Log action
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_audit_log (guild_id, club_id, action_type, performed_by, target_id, details) 
                 VALUES (?, ?, 'event_joined', ?, ?, ?)`,
                [
                    interaction.guild.id,
                    event.club_id,
                    interaction.user.id,
                    eventId.toString(),
                    JSON.stringify({
                        eventTitle: event.title,
                        clubName: event.club_name,
                        clubSlug: event.club_slug
                    })
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

    } catch (error) {
        log('Error joining event:', 'club', null, error, 'error');
        await interaction.reply({
            content: '❌ An error occurred. Please try again.',
            ephemeral: true
        }).catch(() => { });
    }
}

/**
 * Handle preview participants button (Club mods and server mods can view)
 */
export async function handlePreviewParticipants(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const eventId = parseInt(interaction.customId.split('_')[2]);

    try {
        // Get event and club details
        const event = await new Promise((resolve, reject) => {
            db.get(
                `SELECT e.*, c.president_user_id, c.name as club_name, c.slug as club_slug
                 FROM club_events e
                 JOIN clubs c ON e.club_id = c.id
                 WHERE e.id = ?`,
                [eventId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!event) {
            return await interaction.editReply({
                content: '❌ Event not found.'
            });
        }

        // Check authorization
        const permissionCheck = await checkClubPermission({
            member: interaction.member,
            clubId: event.club_id,
            action: 'view'
        });

        if (!permissionCheck.allowed) {
            return await interaction.editReply({
                content: `❌ You don't have permission to view participants. (${permissionCheck.reason})`
            });
        }

        // Get confirmed participants (in event_participants table)
        const participants = await new Promise((resolve, reject) => {
            db.all(
                `SELECT ep.*, vu.real_name, vu.email, 'confirmed' as status_type
                 FROM event_participants ep
                 LEFT JOIN verified_users vu ON ep.user_id = vu.user_id
                 WHERE ep.event_id = ?
                 ORDER BY ep.registration_date DESC`,
                [eventId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        // If event has registration fee, also get pending registrations
        let pendingRegistrations = [];
        if (event.registration_fee && event.registration_fee > 0) {
            pendingRegistrations = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT er.*, vu.real_name, vu.email, er.payment_status
                     FROM event_registrations er
                     LEFT JOIN verified_users vu ON er.user_id = vu.user_id
                     WHERE er.event_id = ? AND er.payment_status != 'verified'
                     ORDER BY er.created_at DESC`,
                    [eventId],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                );
            });
        }

        if (participants.length === 0 && pendingRegistrations.length === 0) {
            return await interaction.editReply({
                content: '📋 No registrations yet.'
            });
        }

        // Create participant list embed
        const participantEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(`👥 Registrations for ${event.title}`)
            .setDescription(
                `**Club:** ${event.club_name} (\`${event.club_slug}\`)\n` +
                `**Confirmed:** ${participants.length}${event.max_participants ? ` / ${event.max_participants}` : ''}` +
                (pendingRegistrations.length > 0 ? `\n**Pending Payment:** ${pendingRegistrations.length}` : '')
            )
            .setTimestamp()
            .setFooter({ text: `Event ID: ${eventId}` });

        // Show confirmed participants first
        if (participants.length > 0) {
            const chunkSize = 10;
            for (let i = 0; i < participants.length; i += chunkSize) {
                const chunk = participants.slice(i, i + chunkSize);
                const participantList = chunk.map((p, idx) => {
                    const num = i + idx + 1;
                    const name = p.real_name || 'Unknown';
                    const registeredDate = new Date(p.registration_date * 1000).toLocaleDateString();
                    const status = p.checked_in ? '✅ Checked In' : '✅ Confirmed';
                    return `${num}. **${name}** (<@${p.user_id}>)\n   📧 ${p.email || 'N/A'} • 📅 ${registeredDate} • ${status}`;
                }).join('\n\n');

                participantEmbed.addFields({
                    name: i === 0 ? '✅ Confirmed Participants' : `Participants ${i + 1}-${Math.min(i + chunkSize, participants.length)}`,
                    value: participantList,
                    inline: false
                });
            }
        }

        // Show pending payments separately
        if (pendingRegistrations.length > 0) {
            const pendingList = pendingRegistrations.slice(0, 10).map((p, idx) => {
                const name = p.real_name || 'Unknown';
                const registeredDate = new Date(p.created_at * 1000).toLocaleDateString();
                const statusEmoji = p.payment_status === 'pending' ? '🟡' : (p.payment_status === 'rejected' ? '❌' : '⏳');
                const statusText = p.payment_status === 'pending' ? 'Pending Verification' :
                    (p.payment_status === 'rejected' ? 'Payment Rejected' : 'Awaiting Payment');
                return `${idx + 1}. **${name}** (<@${p.user_id}>)\n   📧 ${p.email || 'N/A'} • 📅 ${registeredDate} • ${statusEmoji} ${statusText}`;
            }).join('\n\n');

            participantEmbed.addFields({
                name: '⏳ Pending Payment Verification',
                value: pendingList + (pendingRegistrations.length > 10 ? `\n\n_...and ${pendingRegistrations.length - 10} more_` : ''),
                inline: false
            });
        }

        await interaction.editReply({ embeds: [participantEmbed] });

    } catch (error) {
        log('Error previewing participants:', 'club', null, error, 'error');
        await interaction.editReply({
            content: '❌ An error occurred while fetching participants.'
        });
    }
}