// src/utils/nonVerifiedRegistration.js
import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { db } from '../database.js';
import { log } from './debug.js';
import { emailService } from '../services/emailService.js';
import { generateOtp } from './otpGenerator.js';

// Global cache for non-verified registration OTPs
global.nonVerifiedRegOtpCache = global.nonVerifiedRegOtpCache || new Map();

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
        // Generate OTP
        const otp = generateOtp();
        const otpExpiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
        // Store user data and OTP
        global.nonVerifiedRegOtpCache.set(interaction.user.id, {
            otp,
            email,
            fullName,
            phoneNumber: phoneValidation.normalized,
            eventId,
            guildId: interaction.guild.id,
            verified: false,
            expiresAt: otpExpiresAt,
            createdAt: Date.now()
        });
        log('Non-verified registration OTP generated', 'event', { userId: interaction.user.id, email, eventId, otp }, null, 'info');
        // Send OTP email
        try {
            const emailClient = new emailService();
            const emailSubject = 'FSU: Event Registration Verification';
            
            // Import the email template
            const { registrationOtpEmailTemplate } = await import('./nonVerifiedRegOtpHandlers.js');
            const emailHtmlContent = registrationOtpEmailTemplate
                .replace('{{USER_NAME}}', fullName)
                .replace('{{OTP_CODE}}', otp);
            await emailClient.sendEmail(email, emailSubject, emailHtmlContent);
            log('Non-verified registration OTP email sent', 'event', { email, eventId }, null, 'success');
        } catch (error) {
            log('Error sending registration OTP email', 'event', { email, eventId }, error, 'error');
            global.nonVerifiedRegOtpCache.delete(interaction.user.id);
            return await interaction.editReply({
                content: '❌ **Failed to send verification email.**\n\nPlease check your email address and try again.'
            });
        }
        // Show button to enter OTP
        const otpButton = new ButtonBuilder()
            .setCustomId(`reg_otp_button_${interaction.user.id}_${eventId}_${Date.now()}`)
            .setLabel('Enter OTP')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🔐');
        const row = new ActionRowBuilder().addComponents(otpButton);
        await interaction.editReply({
            content: `✅ **Verification Code Sent!**\n\n` +
                `A 6-digit OTP has been sent to **${email}**.\n\n` +
                `Please check your inbox (and spam folder) and click the button below to enter your OTP.\n\n` +
                `⏱️ OTP expires in 5 minutes.`,
            components: [row]
        });
    } catch (error) {
        log('Error in non-verified registration', 'event', { eventId }, error, 'error');
        await interaction.editReply({
            content: '❌ An error occurred. Please try again.'
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