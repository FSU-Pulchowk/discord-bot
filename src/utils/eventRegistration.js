// src/utils/eventRegistration.js
import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, AttachmentBuilder } from 'discord.js';
import { db } from '../database.js';
import { log } from './debug.js';

/**
 * Check if event requires payment
 * @param {number} eventId - Event ID
 * @returns {Promise<Object>} Event with payment info
 */
export async function getEventPaymentInfo(eventId) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT id, title, registration_fee, registration_required,
                    bank_details, khalti_number, esewa_number, payment_qr_url
             FROM club_events WHERE id = ?`,
            [eventId],
            (err, row) => {
                if (err) reject(err);
                else resolve(row);
            }
        );
    });
}

/**
 * Initiate registration with payment check
 * @param {CommandInteraction} interaction - Discord interaction
 * @param {number} eventId - Event ID
 * @param {Object} event - Event data
 */
export async function initiateRegistrationWithPayment(interaction, eventId, event) {
    try {
        // Check if event requires payment
        if (!event.registration_fee || event.registration_fee <= 0) {
            // No payment required, proceed with normal registration
            return { requiresPayment: false };
        }

        // Check if user already has registration entry
        const existingReg = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM event_registrations WHERE event_id = ? AND user_id = ?`,
                [eventId, interaction.user.id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (existingReg) {
            // Check payment status
            if (existingReg.payment_status === 'verified') {
                return {
                    requiresPayment: true,
                    paymentVerified: true,
                    message: '✅ Your payment has been verified! You are registered for this event.'
                };
            } else if (existingReg.payment_status === 'pending') {
                return {
                    requiresPayment: true,
                    paymentVerified: false,
                    message: '⏳ Your payment proof is pending verification. Please wait for admin approval.'
                };
            } else if (existingReg.payment_status === 'rejected') {
                return {
                    requiresPayment: true,
                    paymentVerified: false,
                    message: '❌ Your previous payment proof was rejected. Please upload a new proof.',
                    allowResubmit: true
                };
            }
        }

        // Create new registration entry
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO event_registrations (event_id, user_id, guild_id, payment_status, created_at)
                 VALUES (?, ?, ?, 'pending', strftime('%s', 'now'))`,
                [eventId, interaction.user.id, interaction.guild.id],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Send payment instructions via DM
        await sendPaymentInstructions(interaction, event);

        return {
            requiresPayment: true,
            paymentVerified: false,
            message: '📧 Check your DMs for payment instructions!'
        };

    } catch (error) {
        log('Error initiating registration with payment', 'payment', { eventId }, error, 'error');
        throw error;
    }
}

/**
 * Send payment instructions to user via DM
 * @param {CommandInteraction} interaction - Discord interaction
 * @param {Object} event - Event data
 */
async function sendPaymentInstructions(interaction, event) {
    try {
        // Build payment methods section
        const paymentMethods = [];

        if (event.bank_details) {
            paymentMethods.push(`**🏦 Bank Transfer:**\n${event.bank_details}`);
        }

        if (event.khalti_number) {
            paymentMethods.push(`**📱 Khalti:**\n${event.khalti_number}`);
        }

        if (event.esewa_number) {
            paymentMethods.push(`**💳 eSewa:**\n${event.esewa_number}`);
        }

        const paymentMethodsText = paymentMethods.length > 0
            ? paymentMethods.join('\n\n')
            : 'Contact event organizer for payment details';

        const paymentEmbed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('💳 Payment Required for Event Registration')
            .setDescription(
                `To complete your registration for **${event.title}**, please make the payment and upload proof.`
            )
            .addFields(
                { name: '💰 Amount', value: `Rs. ${event.registration_fee}`, inline: true },
                { name: '🎯 Event', value: event.title, inline: true },
                { name: '\u200b', value: '\u200b', inline: true },
                {
                    name: '💳 Payment Methods',
                    value: paymentMethodsText,
                    inline: false
                },
                {
                    name: '📋 Payment Instructions',
                    value:
                        '1. Make payment using any of the methods above\n' +
                        '2. Take a screenshot or save the receipt (PDF/image)\n' +
                        '3. Click the button below to upload your payment proof\n' +
                        '4. Wait for admin verification (usually within 24 hours)',
                    inline: false
                },
                {
                    name: '⚠️ Important',
                    value:
                        '• Upload clear, readable proof\n' +
                        '• Include transaction ID in screenshot\n' +
                        '• Accepted formats: JPG, PNG, PDF\n' +
                        '• File size: Max 8MB',
                    inline: false
                }
            )
            .setFooter({ text: 'Your registration will be confirmed after payment verification' })
            .setTimestamp();

        // Add QR code image if available
        if (event.payment_qr_url) {
            paymentEmbed.setImage(event.payment_qr_url);
        }

        const uploadButton = new ButtonBuilder()
            .setCustomId(`upload_payment_proof_${event.id}`)
            .setLabel('Upload Payment Proof')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📎');

        const row = new ActionRowBuilder().addComponents(uploadButton);

        await interaction.user.send({
            embeds: [paymentEmbed],
            components: [row]
        });

        log('Sent payment instructions', 'payment', {
            eventId: event.id,
            userId: interaction.user.id
        }, null, 'success');

    } catch (error) {
        log('Error sending payment instructions DM', 'payment', { eventId: event.id }, error, 'error');
        throw new Error('Could not send DM. Please enable DMs from server members.');
    }
}

/**
 * Handle payment proof upload button
 * @param {ButtonInteraction} interaction - Button interaction
 */
export async function handlePaymentProofUpload(interaction) {
    const eventId = parseInt(interaction.customId.split('_')[3]);

    try {
        await interaction.reply({
            content:
                '📎 **Upload your payment proof now:**\n\n' +
                '1. Send your payment screenshot/receipt as a file attachment\n' +
                '2. Accepted formats: JPG, PNG, PDF\n' +
                '3. You have 5 minutes to upload\n\n' +
                '**Reply with the file in this DM!**',
            ephemeral: true
        });

        // Create message collector to wait for attachment
        const filter = (m) => m.author.id === interaction.user.id && m.attachments.size > 0;
        const collector = interaction.channel.createMessageCollector({
            filter,
            time: 300000, // 5 minutes
            max: 1
        });

        collector.on('collect', async (message) => {
            const attachment = message.attachments.first();

            // Validate file type
            const validTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
            if (!validTypes.includes(attachment.contentType)) {
                return await message.reply('❌ Invalid file type. Please upload JPG, PNG, or PDF only.');
            }

            // Validate file size (8MB)
            if (attachment.size > 8 * 1024 * 1024) {
                return await message.reply('❌ File too large. Maximum size is 8MB.');
            }

            // Store payment proof URL
            await storePaymentProof(eventId, interaction.user.id, attachment.url, attachment.name);

            // Notify user
            await message.reply({
                content: '✅ **Payment proof uploaded successfully!**\\n\\n' +
                    '⏳ Your proof is now pending admin verification.\\n' +
                    '📧 You will be notified once verified.\\n\\n' +
                    'Expected verification time: Within 24 hours'
            });

            // Get guild from database and client (since interaction.guild is null in DMs)
            const registration = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT guild_id FROM event_registrations WHERE event_id = ? AND user_id = ?`,
                    [eventId, interaction.user.id],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });

            if (registration && registration.guild_id) {
                const guild = await interaction.client.guilds.fetch(registration.guild_id);
                // Send to admins for verification
                await sendPaymentVerificationRequest(eventId, interaction.user.id, guild, attachment.url);
            }

            log('Payment proof uploaded', 'payment', {
                eventId,
                userId: interaction.user.id,
                proofUrl: attachment.url
            }, null, 'success');
        });

        collector.on('end', (collected) => {
            if (collected.size === 0) {
                interaction.followUp({
                    content: '⏱️ Upload timeout. Please click the button again to retry.',
                    ephemeral: true
                }).catch(() => { });
            }
        });

    } catch (error) {
        log('Error handling payment proof upload', 'payment', { eventId }, error, 'error');
        await interaction.reply({
            content: '❌ An error occurred. Please try again.',
            ephemeral: true
        }).catch(() => { });
    }
}

/**
 * Store payment proof in database
 * @param {number} eventId - Event ID
 * @param {string} userId - User ID
 * @param {string} proofUrl - Proof file URL
 * @param {string} fileName - File name
 */
async function storePaymentProof(eventId, userId, proofUrl, fileName) {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE event_registrations 
             SET payment_proof_url = ?, 
                 payment_status = 'pending', 
                 updated_at = strftime('%s', 'now')
             WHERE event_id = ? AND user_id = ?`,
            [proofUrl, eventId, userId],
            (err) => {
                if (err) reject(err);
                else resolve();
            }
        );
    });
}

/**
 * Send payment verification request to club moderators
 * @param {number} eventId - Event ID
 * @param {string} userId - User ID
 * @param {Guild} guild - Discord guild
 * @param {string} proofUrl - Payment proof URL
 */
async function sendPaymentVerificationRequest(eventId, userId, guild, proofUrl) {
    try {
        // Get event and club details
        const event = await new Promise((resolve, reject) => {
            db.get(
                `SELECT e.*, c.name as club_name, c.president_user_id, c.moderator_role_id
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

        if (!event) return;

        // Get user info
        const user = await guild.members.fetch(userId);
        const verifiedUser = await new Promise((resolve, reject) => {
            db.get(
                `SELECT real_name, email FROM verified_users WHERE user_id = ?`,
                [userId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        const verificationEmbed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('🔔 New Payment Verification Request')
            .setDescription(`A participant has uploaded payment proof for **${event.title}**`)
            .addFields(
                { name: '👤 Participant', value: `${verifiedUser?.real_name || user.user.username} (<@${userId}>)`, inline: true },
                { name: '📧 Email', value: verifiedUser?.email || 'N/A', inline: true },
                { name: '\u200b', value: '\u200b', inline: true },
                { name: '🎯 Event', value: event.title, inline: true },
                { name: '💰 Amount', value: `Rs. ${event.registration_fee}`, inline: true },
                { name: '\u200b', value: '\u200b', inline: true },
                { name: '📎 Payment Proof', value: `[View Proof](${proofUrl})`, inline: false }
            )
            .setImage(proofUrl.endsWith('.pdf') ? null : proofUrl) // Show image if not PDF
            .setFooter({ text: `Event ID: ${eventId} | User ID: ${userId}` })
            .setTimestamp();

        const approveButton = new ButtonBuilder()
            .setCustomId(`verify_payment_${eventId}_${userId}`)
            .setLabel('Approve Payment')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅');

        const rejectButton = new ButtonBuilder()
            .setCustomId(`reject_payment_${eventId}_${userId}`)
            .setLabel('Reject Payment')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌');

        const row = new ActionRowBuilder().addComponents(approveButton, rejectButton);

        // Send to club president
        if (event.president_user_id) {
            try {
                const president = await guild.members.fetch(event.president_user_id);
                await president.send({ embeds: [verificationEmbed], components: [row] });
            } catch (error) {
                log('Failed to DM club president', 'payment', null, error, 'warn');
            }
        }

        // Send to users with moderator role
        if (event.moderator_role_id) {
            const role = await guild.roles.fetch(event.moderator_role_id);
            if (role) {
                const moderators = role.members.filter(m => !m.user.bot).first(3); // Max 3 mods - returns array
                for (const mod of moderators) {
                    try {
                        await mod.send({ embeds: [verificationEmbed], components: [row] });
                    } catch (error) {
                        log(`Failed to DM moderator ${mod.id}`, 'payment', null, error, 'warn');
                    }
                }
            }
        }

        log('Sent payment verification requests', 'payment', {
            eventId,
            userId,
            presidentId: event.president_user_id
        }, null, 'success');

    } catch (error) {
        log('Error sending payment verification request', 'payment', { eventId, userId }, error, 'error');
    }
}

/**
 * Handle payment verification (approve)
 * @param {ButtonInteraction} interaction - Button interaction
 */
export async function handlePaymentVerification(interaction) {
    await interaction.deferUpdate();

    const [, , eventId, userId] = interaction.customId.split('_');

    try {
        // Get guild_id and registration data from registration (since interaction.guild is null in DMs)
        const registration = await new Promise((resolve, reject) => {
            db.get(
                `SELECT guild_id, registration_notes FROM event_registrations WHERE event_id = ? AND user_id = ?`,
                [parseInt(eventId), userId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!registration) {
            throw new Error('Registration not found');
        }

        // Update payment status
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE event_registrations 
                 SET payment_status = 'verified',
                     payment_verified_by = ?,
                     payment_verified_at = strftime('%s', 'now')
                 WHERE event_id = ? AND user_id = ?`,
                [interaction.user.id, parseInt(eventId), userId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Add to event_participants with registration data
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT OR IGNORE INTO event_participants (event_id, user_id, guild_id, rsvp_status, registration_data)
                 VALUES (?, ?, ?, 'going', ?)`,
                [parseInt(eventId), userId, registration.guild_id, registration.registration_notes],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Notify user
        const user = await interaction.client.users.fetch(userId);
        await user.send({
            content: `✅ **Payment Verified!**\n\nYour payment has been approved and you are now registered for the event!\n\nEvent ID: ${eventId}`
        }).catch(() => { });

        // Update verification message
        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor('#00FF00')
            .addFields({ name: '✅ Verified by', value: `<@${interaction.user.id}>`, inline: true });

        await interaction.message.edit({ embeds: [updatedEmbed], components: [] });

        log('Payment verified', 'payment', { eventId, userId, verifiedBy: interaction.user.id }, null, 'success');

    } catch (error) {
        log('Error verifying payment', 'payment', { eventId, userId }, error, 'error');
        await interaction.followUp({
            content: '❌ An error occurred while verifying payment.',
            ephemeral: true
        }).catch(() => { });
    }
}

/**
 * Handle payment rejection
 * @param {ButtonInteraction} interaction - Button interaction  
 */
export async function handlePaymentRejection(interaction) {
    await interaction.deferUpdate();

    const [, , eventId, userId] = interaction.customId.split('_');

    try {
        // Update payment status
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE event_registrations 
                 SET payment_status = 'rejected',
                     payment_verified_by = ?,
                     payment_verified_at = strftime('%s', 'now')
                 WHERE event_id = ? AND user_id = ?`,
                [interaction.user.id, parseInt(eventId), userId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Notify user
        const user = await interaction.client.users.fetch(userId);
        await user.send({
            content:
                `❌ **Payment Proof Rejected**\n\n` +
                `Your payment proof for Event ID ${eventId} was not approved.\n\n` +
                `**Please:**\n` +
                `• Check if the screenshot is clear\n` +
                `• Ensure transaction details are visible\n` +
                `• Upload a new proof if payment was made\n\n` +
                `Click the "Upload Payment Proof" button again to resubmit.`
        }).catch(() => { });

        // Update verification message
        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor('#FF0000')
            .addFields({ name: '❌ Rejected by', value: `<@${interaction.user.id}>`, inline: true });

        await interaction.message.edit({ embeds: [updatedEmbed], components: [] });

        log('Payment rejected', 'payment', { eventId, userId, rejectedBy: interaction.user.id }, null, 'warn');

    } catch (error) {
        log('Error rejecting payment', 'payment', { eventId, userId }, error, 'error');
        await interaction.followUp({
            content: '❌ An error occurred while rejecting payment.',
            ephemeral: true
        }).catch(() => { });
    }
}
