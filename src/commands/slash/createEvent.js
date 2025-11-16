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
    MessageFlags,
    AttachmentBuilder
} from 'discord.js';
import { db, getClubByIdentifier } from '../../database.js';
import { log } from '../../utils/debug.js';
import { checkClubPermission } from '../../utils/clubPermissions.js';

global.eventPosterData = global.eventPosterData || new Map();

export const data = new SlashCommandBuilder()
    .setName('createevent')
    .setDescription('Create a new club event with poster')
    .addStringOption(option =>
        option.setName('club')
            .setDescription('Your club name or slug')
            .setRequired(true)
            .setAutocomplete(true));

export async function execute(interaction) {
    const clubIdentifier = interaction.options.getString('club');
    const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID || 'YOUR_VERIFIED_ROLE_ID';

    try {
        if (!interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) {
            return await interaction.reply({
                content: '❌ Only verified @Pulchowkian members can create club events.',
                flags: MessageFlags.Ephemeral
            });
        }

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

        const permissionCheck = await checkClubPermission({
            member: interaction.member,
            clubId: club.id,
            action: 'moderate'
        });

        if (!permissionCheck.allowed) {
            return await interaction.reply({
                content: `❌ You don't have permission to create events for this club.\n**Reason:** ${permissionCheck.reason}`,
                flags: MessageFlags.Ephemeral
            });
        }

        // Show comprehensive event creation modal
        const modal = new ModalBuilder()
            .setCustomId(`create_event_modal_step1_${club.id}`)
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
            .setPlaceholder('Describe your event, activities, and what participants can expect')
            .setRequired(true)
            .setMaxLength(2000);

        const dateTimeInput = new TextInputBuilder()
            .setCustomId('event_datetime')
            .setLabel('Date & Time (YYYY-MM-DD HH:MM)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('2025-12-25 14:30')
            .setRequired(true)
            .setMaxLength(50);

        const venueInput = new TextInputBuilder()
            .setCustomId('event_venue')
            .setLabel('Venue / Location')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Auditorium Block A, Virtual, or Hybrid')
            .setRequired(true)
            .setMaxLength(200);

        const typeInput = new TextInputBuilder()
            .setCustomId('event_type')
            .setLabel('Event Type')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('workshop, seminar, competition, social, meeting, other')
            .setRequired(true)
            .setMaxLength(50);

        modal.addComponents(
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(descriptionInput),
            new ActionRowBuilder().addComponents(dateTimeInput),
            new ActionRowBuilder().addComponents(venueInput),
            new ActionRowBuilder().addComponents(typeInput)
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
 * Handle step 1 modal - Basic event info
 */
export async function handleCreateEventModalStep1(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const clubId = parseInt(interaction.customId.split('_')[4]);

    const title = interaction.fields.getTextInputValue('event_title');
    const description = interaction.fields.getTextInputValue('event_description');
    const dateTimeStr = interaction.fields.getTextInputValue('event_datetime');
    const venue = interaction.fields.getTextInputValue('event_venue');
    const eventType = interaction.fields.getTextInputValue('event_type').toLowerCase();

    // Validate date/time
    const dateTimeMatch = dateTimeStr.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})$/);
    if (!dateTimeMatch) {
        return await interaction.editReply({
            content: '❌ Invalid date/time format. Use: YYYY-MM-DD HH:MM\nExample: 2025-12-25 14:30'
        });
    }

    const eventDate = dateTimeMatch[1];
    const startTime = dateTimeMatch[2];

    const eventDateTime = new Date(`${eventDate}T${startTime}`);
    if (eventDateTime <= new Date()) {
        return await interaction.editReply({
            content: '❌ Event date must be in the future.'
        });
    }

    // Validate event type
    const validTypes = ['workshop', 'seminar', 'competition', 'social', 'meeting', 'cultural', 'sports', 'other'];
    if (!validTypes.includes(eventType)) {
        return await interaction.editReply({
            content: `❌ Invalid event type. Must be one of: ${validTypes.join(', ')}`
        });
    }

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

        // Store basic data and show step 2 modal
        global.eventPosterData.set(interaction.user.id, {
            clubId, club, title, description, eventDate, startTime, venue, eventType,
            createdAt: Date.now()
        });

        // Show step 2 modal for additional details
        const modal2 = new ModalBuilder()
            .setCustomId('create_event_modal_step2')
            .setTitle('Event Details - Additional Info');

        const participantsInput = new TextInputBuilder()
            .setCustomId('max_participants')
            .setLabel('Max Participants (leave blank for unlimited)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('50')
            .setRequired(false)
            .setMaxLength(10);

        const minParticipantsInput = new TextInputBuilder()
            .setCustomId('min_participants')
            .setLabel('Minimum Participants Required')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('10')
            .setRequired(false)
            .setMaxLength(10);

        const registrationInput = new TextInputBuilder()
            .setCustomId('registration_info')
            .setLabel('Registration Details')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Deadline: YYYY-MM-DD\nFee: Rs. 100\nExternal Form: https://forms.gle/...')
            .setRequired(false)
            .setMaxLength(500);

        const eligibilityInput = new TextInputBuilder()
            .setCustomId('eligibility')
            .setLabel('Eligibility (Batch, Faculty, etc.)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Batch: 078, 079\nFaculty: All\nRequirements: Open to all')
            .setRequired(false)
            .setMaxLength(500);

        const meetingLinkInput = new TextInputBuilder()
            .setCustomId('meeting_link')
            .setLabel('Meeting/Registration Link (for virtual events)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://meet.google.com/...')
            .setRequired(false);

        modal2.addComponents(
            new ActionRowBuilder().addComponents(participantsInput),
            new ActionRowBuilder().addComponents(minParticipantsInput),
            new ActionRowBuilder().addComponents(registrationInput),
            new ActionRowBuilder().addComponents(eligibilityInput),
            new ActionRowBuilder().addComponents(meetingLinkInput)
        );

        await interaction.showModal(modal2);

    } catch (error) {
        log('Error in step 1', 'club', null, error, 'error');
        await interaction.editReply({
            content: `❌ An error occurred: ${error.message}`
        });
    }
}

/**
 * Handle step 2 modal - Additional details
 */
export async function handleCreateEventModalStep2(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const basicData = global.eventPosterData.get(interaction.user.id);
    if (!basicData || Date.now() - basicData.createdAt > 10 * 60 * 1000) {
        global.eventPosterData.delete(interaction.user.id);
        return await interaction.editReply({
            content: '❌ Session expired. Please start creating the event again.'
        });
    }

    const maxParticipantsStr = interaction.fields.getTextInputValue('max_participants') || null;
    const minParticipantsStr = interaction.fields.getTextInputValue('min_participants') || null;
    const registrationInfo = interaction.fields.getTextInputValue('registration_info') || null;
    const eligibilityInfo = interaction.fields.getTextInputValue('eligibility') || null;
    const meetingLink = interaction.fields.getTextInputValue('meeting_link') || null;

    const maxParticipants = maxParticipantsStr ? parseInt(maxParticipantsStr) : null;
    const minParticipants = minParticipantsStr ? parseInt(minParticipantsStr) : null;

    // Parse registration info
    const regData = parseRegistrationInfo(registrationInfo);
    const eligibilityData = parseEligibilityInfo(eligibilityInfo);

    // Update stored data
    basicData.maxParticipants = maxParticipants;
    basicData.minParticipants = minParticipants;
    basicData.registrationDeadline = regData.deadline;
    basicData.registrationFee = regData.fee;
    basicData.externalFormUrl = regData.externalForm;
    basicData.eligibilityCriteria = eligibilityData;
    basicData.meetingLink = meetingLink;
    basicData.registrationRequired = !!(regData.deadline || regData.fee || regData.externalForm);

    global.eventPosterData.set(interaction.user.id, basicData);

    // Determine location type
    const venueL = basicData.venue.toLowerCase();
    let locationType = 'physical';
    if (venueL.includes('virtual') || venueL.includes('online')) {
        locationType = 'virtual';
    } else if (venueL.includes('hybrid')) {
        locationType = 'hybrid';
    }
    basicData.locationType = locationType;

    // Now ask for poster upload
    const posterEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('📸 Upload Event Poster')
        .setDescription('Please upload your event poster image to complete the event creation.')
        .addFields(
            { name: '🎯 Event', value: basicData.title, inline: true },
            { name: '🏛️ Club', value: basicData.club.name, inline: true },
            { name: '📅 Date', value: `${basicData.eventDate} at ${basicData.startTime}`, inline: true },
            { name: '📋 Instructions', value: 
                '1. Click "Upload Poster" button below\n' +
                '2. Select your event poster (image file)\n' +
                '3. Or click "Skip Poster" to create without one\n\n' +
                '**Recommended:** JPG or PNG, max 8MB'
            }
        )
        .setFooter({ text: 'Posters make your event more attractive!' })
        .setTimestamp();

    const uploadButton = new ButtonBuilder()
        .setCustomId('upload_event_poster')
        .setLabel('Upload Poster')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📸');

    const skipButton = new ButtonBuilder()
        .setCustomId('skip_event_poster')
        .setLabel('Skip Poster')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⏭️');

    const row = new ActionRowBuilder().addComponents(uploadButton, skipButton);

    await interaction.editReply({ embeds: [posterEmbed], components: [row] });
}

/**
 * Handle upload poster button - Ask for poster in DM
 */
export async function handleUploadPosterButton(interaction) {
    await interaction.deferUpdate();

    const uploadInstructionsEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('📤 Send Your Event Poster')
        .setDescription('Please send your event poster image as an attachment in this DM.\n\n**Format:** JPG, PNG, or GIF\n**Size:** Max 8MB')
        .addFields(
            { name: '⏰ Time Limit', value: '5 minutes', inline: true },
            { name: '📝 Note', value: 'Send only the image file, no text needed', inline: true }
        )
        .setFooter({ text: 'Waiting for your poster...' })
        .setTimestamp();

    try {
        await interaction.user.send({ embeds: [uploadInstructionsEmbed] });
        
        await interaction.followUp({
            content: '✅ Check your DMs! Send your poster image there.',
            ephemeral: true
        });

        // Set up message collector for poster
        const dmChannel = await interaction.user.createDM();
        const filter = m => m.author.id === interaction.user.id && m.attachments.size > 0;
        const collector = dmChannel.createMessageCollector({ filter, time: 5 * 60 * 1000, max: 1 });

        collector.on('collect', async (message) => {
            const attachment = message.attachments.first();
            
            if (!attachment.contentType?.startsWith('image/')) {
                await message.reply('❌ Please send an image file (JPG, PNG, or GIF).');
                return;
            }

            // Store poster URL
            const basicData = global.eventPosterData.get(interaction.user.id);
            if (basicData) {
                basicData.posterUrl = attachment.url;
                global.eventPosterData.set(interaction.user.id, basicData);

                await message.reply('✅ Poster uploaded! Creating your event...');
                await finalizeEventCreation(interaction, basicData);
            } else {
                await message.reply('❌ Session expired. Please create the event again.');
            }
        });

        collector.on('end', (collected, reason) => {
            if (reason === 'time' && collected.size === 0) {
                interaction.user.send('⏰ Poster upload timed out. Creating event without poster...').catch(() => {});
                const basicData = global.eventPosterData.get(interaction.user.id);
                if (basicData) {
                    finalizeEventCreation(interaction, basicData);
                }
            }
        });

    } catch (error) {
        log('Error in poster upload', 'club', null, error, 'error');
        await interaction.followUp({
            content: '❌ Could not send DM. Please enable DMs from server members.',
            ephemeral: true
        });
    }
}

/**
 * Handle skip poster button
 */
export async function handleSkipPosterButton(interaction) {
    await interaction.deferUpdate();

    const basicData = global.eventPosterData.get(interaction.user.id);
    if (!basicData) {
        return await interaction.followUp({
            content: '❌ Session expired. Please create the event again.',
            ephemeral: true
        });
    }

    await finalizeEventCreation(interaction, basicData);
}

/**
 * Finalize event creation
 */
async function finalizeEventCreation(interaction, eventData) {
    try {
        // Re-check permission
        const permissionCheck = await checkClubPermission({
            member: interaction.member,
            clubId: eventData.clubId,
            action: 'moderate'
        });

        if (!permissionCheck.allowed) {
            global.eventPosterData.delete(interaction.user.id);
            return await interaction.user.send({
                content: `❌ Permission check failed: ${permissionCheck.reason}`
            }).catch(() => {});
        }

        // Check if approval required
        const clubSettings = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM club_settings WHERE club_id = ?`,
                [eventData.clubId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        const requireApproval = clubSettings?.require_event_approval !== false;
        const status = requireApproval ? 'pending' : 'scheduled';

        // Insert event
        const eventId = await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_events (
                    club_id, guild_id, title, description, event_date, start_time, 
                    venue, location_type, event_type, max_participants, min_participants,
                    registration_required, registration_deadline, registration_fee,
                    external_form_url, meeting_link, eligibility_criteria, poster_url,
                    status, created_by, visibility
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'club')`,
                [
                    eventData.clubId, eventData.club.guild_id, eventData.title, 
                    eventData.description, eventData.eventDate, eventData.startTime,
                    eventData.venue, eventData.locationType, eventData.eventType,
                    eventData.maxParticipants, eventData.minParticipants,
                    eventData.registrationRequired ? 1 : 0, eventData.registrationDeadline,
                    eventData.registrationFee, eventData.externalFormUrl, eventData.meetingLink,
                    JSON.stringify(eventData.eligibilityCriteria), eventData.posterUrl,
                    status, interaction.user.id
                ],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });

        // Clear stored data
        global.eventPosterData.delete(interaction.user.id);

        // Log
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_audit_log (guild_id, club_id, action_type, performed_by, target_id, details) 
                 VALUES (?, ?, 'event_created', ?, ?, ?)`,
                [
                    eventData.club.guild_id, eventData.clubId, interaction.user.id, eventId.toString(),
                    JSON.stringify({
                        clubName: eventData.club.name, clubSlug: eventData.club.slug,
                        eventTitle: eventData.title, status, hasPoster: !!eventData.posterUrl,
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
            await sendForApproval(interaction, eventId, eventData);
        }

        // Success message
        const successEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle(requireApproval ? '✅ Event Created - Pending Approval' : '✅ Event Created Successfully!')
            .setDescription(`**${eventData.title}** has been ${requireApproval ? 'submitted for approval' : 'created and is now live'}!`)
            .addFields(
                { name: '🆔 Event ID', value: eventId.toString(), inline: true },
                { name: '🏛️ Club', value: eventData.club.name, inline: true },
                { name: '🔗 Slug', value: `\`${eventData.club.slug}\``, inline: true },
                { name: '📅 Date & Time', value: `${eventData.eventDate} at ${eventData.startTime}`, inline: true },
                { name: '📍 Venue', value: eventData.venue, inline: true },
                { name: '📊 Status', value: requireApproval ? 'Pending Approval' : 'Live', inline: true }
            );

        if (eventData.posterUrl) {
            successEmbed.setImage(eventData.posterUrl);
            successEmbed.addFields({ name: '📸 Poster', value: '✅ Uploaded', inline: true });
        }

        await interaction.user.send({ embeds: [successEmbed] }).catch(() => {});

        // Also send to original channel if possible
        try {
            const originalMessage = await interaction.fetchReply();
            await originalMessage.edit({ 
                content: null,
                embeds: [successEmbed], 
                components: [] 
            });
        } catch (e) {
            // Ignore if can't edit
        }

    } catch (error) {
        log('Error finalizing event', 'club', null, error, 'error');
        global.eventPosterData.delete(interaction.user.id);
        await interaction.user.send({
            content: `❌ An error occurred: ${error.message}`
        }).catch(() => {});
    }
}

/**
 * Send event for approval
 */
async function sendForApproval(interaction, eventId, eventData) {
    const EVENT_APPROVAL_CHANNEL_ID = process.env.EVENT_APPROVAL_CHANNEL_ID;
    if (!EVENT_APPROVAL_CHANNEL_ID || EVENT_APPROVAL_CHANNEL_ID === 'YOUR_EVENT_APPROVAL_CHANNEL_ID') {
        return;
    }

    try {
        const approvalChannel = await interaction.guild.channels.fetch(EVENT_APPROVAL_CHANNEL_ID);

        const approvalEmbed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('📅 New Event Approval Request')
            .setDescription(`**${eventData.title}**`)
            .addFields(
                { name: '🏛️ Club', value: eventData.club.name, inline: true },
                { name: '🔗 Slug', value: `\`${eventData.club.slug}\``, inline: true },
                { name: '🆔 Event ID', value: eventId.toString(), inline: true },
                { name: '📅 Date & Time', value: `${eventData.eventDate} at ${eventData.startTime}`, inline: true },
                { name: '📍 Venue', value: eventData.venue, inline: true },
                { name: '🌐 Type', value: `${eventData.locationType} ${eventData.eventType}`, inline: true },
                { name: '📝 Description', value: eventData.description.length > 1000 ? eventData.description.substring(0, 997) + '...' : eventData.description }
            );

        if (eventData.maxParticipants) {
            approvalEmbed.addFields({ name: '👥 Max Participants', value: eventData.maxParticipants.toString(), inline: true });
        }

        if (eventData.registrationRequired) {
            let regInfo = 'Required';
            if (eventData.registrationDeadline) regInfo += `\nDeadline: ${eventData.registrationDeadline}`;
            if (eventData.registrationFee) regInfo += `\nFee: Rs. ${eventData.registrationFee}`;
            approvalEmbed.addFields({ name: '📝 Registration', value: regInfo, inline: true });
        }

        if (eventData.posterUrl) {
            approvalEmbed.setImage(eventData.posterUrl);
        }

        approvalEmbed.addFields({
            name: '👤 Created By',
            value: `<@${interaction.user.id}>`,
            inline: true
        });

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

    } catch (error) {
        log('Error sending for approval', 'club', null, error, 'error');
    }
}

// Helper functions
function parseRegistrationInfo(text) {
    const result = { deadline: null, fee: null, externalForm: null };
    if (!text) return result;

    const lines = text.split('\n');
    for (const line of lines) {
        const lower = line.toLowerCase();
        
        if (lower.includes('deadline:')) {
            result.deadline = line.split(':')[1]?.trim();
        }
        
        if (lower.includes('fee:')) {
            const feeStr = line.split(':')[1]?.trim();
            const feeMatch = feeStr?.match(/\d+/);
            result.fee = feeMatch ? parseInt(feeMatch[0]) : null;
        }
        
        if (lower.includes('form:') || lower.includes('external')) {
            const urlMatch = line.match(/https?:\/\/[^\s]+/);
            result.externalForm = urlMatch ? urlMatch[0] : null;
        }
    }
    return result;
}

function parseEligibilityInfo(text) {
    const result = { batch: [], faculty: [], requirements: null };
    if (!text) return result;

    const lines = text.split('\n');
    for (const line of lines) {
        const lower = line.toLowerCase();
        
        if (lower.includes('batch:')) {
            const batchStr = line.split(':')[1]?.trim();
            result.batch = batchStr?.split(',').map(b => b.trim()) || [];
        }
        
        if (lower.includes('faculty:')) {
            const facultyStr = line.split(':')[1]?.trim();
            result.faculty = facultyStr?.split(',').map(f => f.trim()) || [];
        }
        
        if (lower.includes('requirements:')) {
            result.requirements = line.split(':')[1]?.trim();
        }
    }
    return result;
}

/**
 * Autocomplete handler
 */
export async function autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();
    const guildId = interaction.guild.id;
    const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID || 'YOUR_VERIFIED_ROLE_ID';

    try {
        if (!interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) {
            return await interaction.respond([{
                name: '❌ You must be verified to create events',
                value: 'not_verified'
            }]);
        }

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
                    action: 'moderate'
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
        log('Error in createevent autocomplete', 'club', null, error, 'error');
        await interaction.respond([]);
    }
}