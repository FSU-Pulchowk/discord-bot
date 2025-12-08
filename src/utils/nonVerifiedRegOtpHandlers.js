import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { log } from './debug.js';
import { db } from '../database.js';

// OTP Email template for non-verified registration
export const registrationOtpEmailTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Event Registration Verification</title>
    <style>
        body {
            font-family: 'Inter', sans-serif;
            background-color: #f4f4f4;
            margin: 0;
            padding: 0;
        }
        .container {
            max-width: 600px;
            margin: 20px auto;
            background-color: #ffffff;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        }
        .header {
            background-color: #5865F2;
            padding: 30px 20px;
            text-align: center;
            color: #ffffff;
        }
        .header h1 {
            margin: 0;
            font-size: 28px;
            font-weight: bold;
        }
        .content {
            padding: 30px;
            text-align: center;
            color: #333333;
        }
        .content p {
            font-size: 16px;
            line-height: 1.6;
            margin-bottom: 20px;
        }
        .otp-box {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #ffffff;
            font-size: 36px;
            font-weight: bold;
            padding: 20px 40px;
            border-radius: 10px;
            letter-spacing: 8px;
            margin: 20px 0;
            box-shadow: 0 4px 8px rgba(102, 126, 234, 0.4);
        }
        .footer {
            background-color: #f4f4f4;
            padding: 20px;
            text-align: center;
            font-size: 14px;
            color: #777777;
        }
        .footer a {
            color: #5865F2;
            text-decoration: none;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎯 Event Registration</h1>
        </div>
        <div class="content">
            <p>Hello <strong>{{USER_NAME}}</strong>,</p>
            <p>To complete your event registration, please use the verification code below:</p>
            <div class="otp-box">{{OTP_CODE}}</div>
            <p>This code will expire in <strong>5 minutes</strong>.</p>
            <p>If you did not request this code, please ignore this email.</p>
        </div>
        <div class="footer">
            <p>FSU - Pulchowk Campus</p>
            <p>This is an automated message, please do not reply.</p>
        </div>
    </div>
</body>
</html>
`;

/**
 * Handle OTP entry button click for non-verified registration
 */
export async function handleRegOtpButton(interaction) {
    const parts = interaction.customId.split('_');
    const userId = parts[3];
    const eventId = parseInt(parts[4]);

    if (interaction.user.id !== userId) {
        return await interaction.reply({
            content: '❌ This button is not for you.',
            flags: MessageFlags.Ephemeral
        });
    }

    const otpData = global.nonVerifiedRegOtpCache.get(interaction.user.id);
    if (!otpData || otpData.eventId !== eventId) {
        return await interaction.reply({
            content: '❌ No pending verification found. Please try registering again.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Check expiration
    if (Date.now() > otpData.expiresAt) {
        global.nonVerifiedRegOtpCache.delete(interaction.user.id);
        return await interaction.reply({
            content: '❌ Your OTP has expired. Please try registering again.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Show OTP entry modal
    const modal = new ModalBuilder()
        .setCustomId(`reg_otp_modal_${eventId}`)
        .setTitle('Enter Verification Code');

    const otpInput = new TextInputBuilder()
        .setCustomId('otp_input')
        .setLabel('Enter the 6-digit OTP')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., 123456')
        .setMinLength(6)
        .setMaxLength(6)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(otpInput));

    await interaction.showModal(modal);
}

/**
 * Handle OTP modal submission for non-verified registration
 */
export async function handleRegOtpModal(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const eventId = parseInt(interaction.customId.split('_')[3]);
    const enteredOtp = interaction.fields.getTextInputValue('otp_input').trim();

    const otpData = global.nonVerifiedRegOtpCache.get(interaction.user.id);

    if (!otpData || otpData.eventId !== eventId) {
        return await interaction.editReply({
            content: '❌ No pending verification found. Please try registering again.'
        });
    }

    // Check expiration
    if (Date.now() > otpData.expiresAt) {
        global.nonVerifiedRegOtpCache.delete(interaction.user.id);
        return await interaction.editReply({
            content: '❌ Your OTP has expired. Please try registering again.'
        });
    }

    // Verify OTP
    if (enteredOtp !== otpData.otp) {
        return await interaction.editReply({
            content: '❌ **Invalid OTP**\n\nPlease check the code and try again.'
        });
    }

    // OTP verified! Mark as verified
    otpData.verified = true;
    global.nonVerifiedRegOtpCache.set(interaction.user.id, otpData);

    log('Non-verified registration OTP verified', 'event', {
        userId: interaction.user.id,
        eventId,
        email: otpData.email
    }, null, 'success');

    // Now proceed with actual registration (payment or direct)
    await completeNonVerifiedRegistration(interaction, otpData);
}

/**
 * Complete registration after OTP verification
 */
async function completeNonVerifiedRegistration(interaction, otpData) {
    const { eventId, fullName, email, phoneNumber, guildId } = otpData;

    try {
        // Get event details again
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
                content: '❌ This event is no longer accepting registrations.'
            });
        }

        const registrationData = JSON.stringify({
            fullName,
            email,
            phoneNumber,
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
                     VALUES (?, ?, ?, 'pending', ?, strftime('%s', 'now'))`,
                    [eventId, interaction.user.id, guildId, registrationData],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });

            // Send payment instructions via DM
            try {
                const { EmbedBuilder, ActionRowBuilder: EmbedActionRow } = await import('discord.js');

                // Build payment methods
                const paymentMethods = [];
                if (event.bank_details) {
                    paymentMethods.push(`**🏦 Bank Transfer:**\\n${event.bank_details}`);
                }
                if (event.khalti_number) {
                    paymentMethods.push(`**📱 Khalti:**\\n${event.khalti_number}`);
                }
                if (event.esewa_number) {
                    paymentMethods.push(`**💳 eSewa:**\\n${event.esewa_number}`);
                }

                const paymentMethodsText = paymentMethods.length > 0
                    ? paymentMethods.join('\\n\\n')
                    : 'Contact event organizer for payment details';

                const { EmbedBuilder: Embed2 } = await import('discord.js');
                const paymentEmbed = new Embed2()
                    .setColor('#FFA500')
                    .setTitle('💳 Payment Required for Event Registration')
                    .setDescription(`To complete your registration for **${event.title}**, please make the payment and upload proof.`)
                    .addFields(
                        { name: '💰 Amount', value: `Rs. ${event.registration_fee}`, inline: true },
                        { name: '🎯 Event', value: event.title, inline: true },
                        { name: '\\u200b', value: '\\u200b', inline: true },
                        { name: '💳 Payment Methods', value: paymentMethodsText, inline: false },
                        {
                            name: '📋 Payment Instructions',
                            value:
                                '1. Make payment using any of the methods above\\n' +
                                '2. Take a screenshot or save the receipt (PDF/image)\\n' +
                                '3. Click the button below to upload your payment proof\\n' +
                                '4. Wait for admin verification (usually within 24 hours)',
                            inline: false
                        },
                        {
                            name: '⚠️ Important',
                            value:
                                '• Upload clear, readable proof\\n' +
                                '• Include transaction ID in screenshot\\n' +
                                '• Accepted formats: JPG, PNG, PDF\\n' +
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
                    content: `✅ **Email Verified!**\\n\\n` +
                        `👤 Name: ${fullName}\\n` +
                        `📧 Email: ${email}\\n` +
                        `📱 Phone: ${phoneNumber}\\n\\n` +
                        `💰 **Payment Required:** Rs. ${event.registration_fee}\\n\\n` +
                        `📧 **Check your DMs** for payment instructions!\\n\\n` +
                        `Your registration will be completed after payment verification.`
                });

                // Clean up OTP cache
                global.nonVerifiedRegOtpCache.delete(interaction.user.id);

                log('Non-verified user info collected, payment required', 'event', {
                    eventId,
                    userId: interaction.user.id,
                    fullName,
                    email,
                    fee: event.registration_fee
                }, null, 'info');

            } catch (error) {
                log('Error sending payment instructions', 'event', { eventId }, error, 'error');
                await interaction.editReply({
                    content: '❌ Could not send payment instructions. Please enable DMs from server members and try again.'
                });
            }

            return;
        }

        // No payment required - register directly to event_participants
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO event_participants 
                 (event_id, user_id, guild_id, rsvp_status, registration_data)
                 VALUES (?, ?, ?, 'going', ?)`,
                [eventId, interaction.user.id, guildId, registrationData],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        await interaction.editReply({
            content: `✅ **Registration Successful!**\\n\\n` +
                `You have been registered for **${event.title}**.\\n\\n` +
                `👤 Name: ${fullName}\\n` +
                `📧 Email: ${email}\\n` +
                `📱 Phone: ${phoneNumber}\\n\\n` +
                `**Important:** As a non-verified user, your registration has been recorded. ` +
                `Consider using \`/verify\` to get full verified access to club features and events!`
        });

        // Clean up OTP cache
        global.nonVerifiedRegOtpCache.delete(interaction.user.id);

        log('Non-verified user registered for event', 'event', {
            eventId,
            userId: interaction.user.id,
            fullName,
            email,
            phone: phoneNumber
        }, null, 'success');

    } catch (error) {
        log('Error completing non-verified registration', 'event', { eventId }, error, 'error');
        await interaction.editReply({
            content: '❌ An error occurred during registration. Please try again.'
        });
    }
}