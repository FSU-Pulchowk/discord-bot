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
                `SELECT e.*, c.name as club_name 
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

        // Register participant with non-verified data stored in registration_data JSON
        const registrationData = JSON.stringify({
            fullName: fullName,
            email: email,
            phoneNumber: phoneValidation.normalized,
            isVerified: false,
            registeredAt: Date.now()
        });

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
