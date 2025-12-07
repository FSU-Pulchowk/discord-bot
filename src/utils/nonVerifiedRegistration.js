// src/utils/nonVerifiedRegistration.js
import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { db } from '../database.js';
import { log } from './debug.js';

/**
 * Show modal for non-verified user to provide email and phone
 * @param {ButtonInteraction} interaction - Button interaction
 * @param {number} eventId - Event ID
 */
export async function showNonVerifiedModal(interaction, eventId) {
    const modal = new ModalBuilder()
        .setCustomId(`non_verified_registration_${eventId}`)
        .setTitle('Event Registration');

    const nameInput = new TextInputBuilder()
        .setCustomId('name_input')
        .setLabel('Full Name')
        .setPlaceholder('Your full name')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(2)
        .setMaxLength(100);

    const emailInput = new TextInputBuilder()
        .setCustomId('email_input')
        .setLabel('Email Address')
        .setPlaceholder('your.email@example.com')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(5)
        .setMaxLength(100);

    const phoneInput = new TextInputBuilder()
        .setCustomId('phone_input')
        .setLabel('Phone Number')
        .setPlaceholder('+977-9XXXXXXXXX or 98XXXXXXXX')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(10)
        .setMaxLength(15);

    const nameRow = new ActionRowBuilder().addComponents(nameInput);
    const emailRow = new ActionRowBuilder().addComponents(emailInput);
    const phoneRow = new ActionRowBuilder().addComponents(phoneInput);

    modal.addComponents(nameRow, emailRow, phoneRow);

    await interaction.showModal(modal);
}

/**
 * Handle non-verified registration modal submission
 * @param {ModalSubmitInteraction} interaction - Modal submission
 */
export async function handleNonVerifiedModalSubmit(interaction) {
    const { MessageFlags } = await import('discord.js');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const eventId = parseInt(interaction.customId.split('_')[3]);
    const fullName = interaction.fields.getTextInputValue('name_input').trim();
    const email = interaction.fields.getTextInputValue('email_input').trim();
    const phone = interaction.fields.getTextInputValue('phone_input').trim();

    try {
        // Validate full name
        if (fullName.length < 2) {
            return await interaction.editReply({
                content: '❌ **Invalid Name**\n\nPlease provide your full name (at least 2 characters).'
            });
        }

        // Validate email
        if (!validateEmail(email)) {
            return await interaction.editReply({
                content: '❌ **Invalid Email Format**\n\nPlease provide a valid email address (e.g., example@domain.com)'
            });
        }

        // Validate phone
        const phoneValidation = validatePhone(phone);
        if (!phoneValidation.valid) {
            return await interaction.editReply({
                content: `❌ **Invalid Phone Number**\n\n${phoneValidation.message}`
            });
        }

        // Get event details
        const event = await new Promise((resolve, reject) => {
            db.get(
                `SELECT e.*, c.name as club_name,
                        e.bank_details, e.khalti_number, e.esewa_number, e.payment_qr_url
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
            return await interaction.editReply({
                content: '❌ This event is not accepting registrations.'
            });
        }

        // Check if already registered
        const existingReg = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM event_participants WHERE event_id = ? AND user_id = ?`,
                [eventId, interaction.user.id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (existingReg) {
            return await interaction.editReply({
                content: '⚠️ You are already registered for this event!'
            });
        }

        // Check max participants
        if (event.max_participants) {
            const currentCount = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT COUNT(*) as count FROM event_participants 
                     WHERE event_id = ? AND rsvp_status = 'going'`,
                    [eventId],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row.count);
                    }
                );
            });

            if (currentCount >= event.max_participants) {
                return await interaction.editReply({
                    content: '❌ This event has reached its participant limit.'
                });
            }
        }

        // Prepare registration data
        const registrationData = JSON.stringify({
            fullName: fullName,
            email: email,
            phoneNumber: phoneValidation.normalized,
            isVerified: false,
            registeredAt: Date.now()
        });

        // Check if payment is required
        if (event.registration_fee && event.registration_fee > 0) {
            // Payment required - create event_registrations entry
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT OR REPLACE INTO event_registrations 
                     (event_id, user_id, guild_id, payment_status, registration_notes, created_at)
                     VALUES (?, ?, ?, 'unpaid', ?, strftime('%s', 'now'))`,
                    [eventId, interaction.user.id, interaction.guild.id, registrationData],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });

            // Send payment instructions via DM
            try {
                const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder: EmbedActionRow } = await import('discord.js');

                // Build payment methods
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
                    .setDescription(`To complete your registration for **${event.title}**, please make the payment and upload proof.`)
                    .addFields(
                        { name: '💰 Amount', value: `Rs. ${event.registration_fee}`, inline: true },
                        { name: '🎯 Event', value: event.title, inline: true },
                        { name: '\u200b', value: '\u200b', inline: true },
                        { name: '💳 Payment Methods', value: paymentMethodsText, inline: false },
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

                if (event.payment_qr_url) {
                    paymentEmbed.setImage(event.payment_qr_url);
                }

                const uploadButton = new ButtonBuilder()
                    .setCustomId(`upload_payment_proof_${eventId}`)
                    .setLabel('Upload Payment Proof')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('📎');

                const row = new EmbedActionRow().addComponents(uploadButton);

                await interaction.user.send({
                    embeds: [paymentEmbed],
                    components: [row]
                });

                await interaction.editReply({
                    content: `✅ **Contact Information Received!**\n\n` +
                        `👤 Name: ${fullName}\n` +
                        `📧 Email: ${email}\n` +
                        `📱 Phone: ${phoneValidation.normalized}\n\n` +
                        `💰 **Payment Required:** Rs. ${event.registration_fee}\n\n` +
                        `📧 **Check your DMs** for payment instructions!\n\n` +
                        `Your registration will be completed after payment verification.`
                });

                log('Non-verified user info collected, payment required', 'event', {
                    eventId,
                    userId: interaction.user.id,
                    fullName,
                    email,
                    fee: event.registration_fee
                }, null, 'info');

                return; // Stop here - payment flow continues via DM

            } catch (error) {
                log('Error sending payment instructions', 'event', { eventId }, error, 'error');
                await interaction.editReply({
                    content: '❌ Could not send payment instructions. Please enable DMs from server members and try again.'
                });
                return;
            }
        }

        // No payment required - register directly to event_participants
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO event_participants 
                 (event_id, user_id, guild_id, rsvp_status, registration_data)
                 VALUES (?, ?, ?, 'going', ?)`,
                [eventId, interaction.user.id, interaction.guild.id, registrationData],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        await interaction.editReply({
            content: `✅ **Registration Successful!**\n\n` +
                `You have been registered for **${event.title}**.\n\n` +
                `👤 Name: ${fullName}\n` +
                `📧 Email: ${email}\n` +
                `📱 Phone: ${phoneValidation.normalized}\n\n` +
                `**Important:** As a non-verified user, your registration has been recorded. ` +
                `Consider using \`/verify\` to get full verified access to club features and events!`
        });

        log('Non-verified user registered for event', 'event', {
            eventId,
            userId: interaction.user.id,
            fullName,
            email,
            phone: phoneValidation.normalized
        }, null, 'success');

    } catch (error) {
        log('Error in non-verified registration', 'event', { eventId }, error, 'error');
        await interaction.editReply({
            content: '❌ An error occurred during registration. Please try again.'
        });
    }
}

/**
 * Validate email format
 * @param {string} email - Email address
 * @returns {boolean} Valid or not
 */
export function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Validate and normalize phone number
 * @param {string} phone - Phone number
 * @returns {Object} {valid, normalized, message}
 */
export function validatePhone(phone) {
    // Remove all non-digit characters for validation
    const digitsOnly = phone.replace(/\D/g, '');

    // Nepal phone numbers: 10 digits (starts with 9)
    if (digitsOnly.length === 10 && digitsOnly.startsWith('9')) {
        return {
            valid: true,
            normalized: `+977-${digitsOnly}`,
            message: 'Valid'
        };
    }

    // International format with +977
    if (digitsOnly.length === 13 && digitsOnly.startsWith('977') && digitsOnly[3] === '9') {
        return {
            valid: true,
            normalized: `+977-${digitsOnly.substring(3)}`,
            message: 'Valid'
        };
    }

    // Generic international format (any country)
    if (digitsOnly.length >= 10 && digitsOnly.length <= 15) {
        return {
            valid: true,
            normalized: `+${digitsOnly}`,
            message: 'Valid'
        };
    }

    return {
        valid: false,
        normalized: null,
        message: 'Phone number must be 10 digits (Nepal: 98XXXXXXXX) or international format (+977-98XXXXXXXX)'
    };
}