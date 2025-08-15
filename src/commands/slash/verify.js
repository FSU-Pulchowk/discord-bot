import {
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    ActionRowBuilder,
    TextInputStyle,
    ButtonBuilder,
    ButtonStyle,
    PermissionsBitField,
    MessageFlags
} from 'discord.js';
import { emailService } from '../../services/emailService.js';
import { generateOtp } from '../../utils/otpGenerator.js';
import dotenv from 'dotenv';
import { db } from '../../database.js';
import { log } from '../../utils/debug.js'; // Import the log function

dotenv.config();
const emailClient = new emailService();

const otpEmailTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your One-Time Password (OTP)</title>
    <style>
        body {
            font-family: 'Inter', sans-serif;
            background-color: #f4f4f4;
            margin: 0;
            padding: 0;
            -webkit-text-size-adjust: 100%;
            -ms-text-size-adjust: 100%;
            width: 100% !important;
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
            background-color: #4CAF50; /* Green header */
            padding: 30px 20px;
            text-align: center;
            color: #ffffff;
            border-top-left-radius: 12px;
            border-top-right-radius: 12px;
        }
        .header h1 {
            margin: 0;
            font-size: 28px;
            font-weight: bold;
        }
        .header-banner {
            width: 100%;
            max-width: 500px; /* Adjust as needed */
            height: auto;
            margin-top: 20px;
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
        .otp-code {
            display: inline-block;
            background-color: #e0f2f7; /* Light blue background for OTP */
            color: #007bff; /* Blue text for OTP */
            font-size: 32px;
            font-weight: bold;
            padding: 15px 30px;
            border-radius: 8px;
            border: 2px dashed #007bff;
            margin: 25px 0;
            letter-spacing: 3px;
        }
        .button-container {
            margin-top: 30px;
            display: flex; /* Use flexbox for button alignment */
            justify-content: center; /* Center buttons horizontally */
            gap: 15px; /* Space between buttons */
            flex-wrap: wrap; /* Allow buttons to wrap on smaller screens */
        }
        .button {
            display: inline-block;
            background-color: #007bff; /* Blue button */
            color: #ffffff;
            padding: 15px 30px;
            text-decoration: none;
            border-radius: 8px;
            font-size: 18px;
            font-weight: bold;
            transition: background-color 0.3s ease;
            white-space: nowrap; /* Prevent text wrapping inside button */
        }
        .button:hover {
            background-color: #0056b3; /* Darker blue on hover */
        }
        .footer {
            background-color: #f0f0f0;
            padding: 20px;
            text-align: center;
            font-size: 12px;
            color: #777777;
            border-bottom-left-radius: 12px;
            border-bottom-right-radius: 12px;
            margin-top: 20px;
        }
        .footer p {
            margin: 0;
        }
        .important-note {
            font-size: 14px;
            color: #dc3545; /* Red for important notes */
            margin-top: 20px;
            font-weight: bold;
        }

        /* Responsive adjustments */
        @media only screen and (max-width: 600px) {
            .container {
                width: 100% !important;
                margin: 0;
                border-radius: 0;
            }
            .header {
                border-radius: 0;
            }
            .footer {
                border-radius: 0;
            }
            .content {
                padding: 20px;
            }
            .otp-code {
                font-size: 28px;
                padding: 12px 25px;
            }
            .button {
                padding: 12px 25px;
                font-size: 16px;
            }
            .header-banner {
                max-width: 100%;
            }
            .button-container {
                flex-direction: column; /* Stack buttons vertically on small screens */
                align-items: center; /* Center stacked buttons */
                gap: 10px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Verification Required</h1>
            <img src="https://abhishekkharel.com.np/banner/fsu-banner.png" alt="Pulchowk Campus Banner" class="header-banner" width="600" height="120">
        </div>
        <div class="content">
            <p>Hello, {{USER_REAL_NAME}}!</p>
            <p>You recently requested a One-Time Password (OTP) for verification. Please use the following code to complete your action:</p>
            <div class="otp-code">
                {{OTP_CODE}}
            </div>
            <p>This OTP is valid for <strong>5 minutes</strong>. Do not share this code with anyone.</p>
            <center>
                <div class="button-container">
                    <a href="https://discord.gg/YaQxWnqJVx" class="button">🔗 Join Our Discord Server</a>
                </div>
            </center>
            <p class="important-note">If you did not request this OTP, please ignore this email.</p>
        </div>
        <div class="footer">
            <p>&copy; 2025 FSU Bot. All rights reserved.</p>
            <p>This is an automated message, please do not reply.</p>
        </div>
    </div>
</body>
</html>
`;

const otpCache = new Map();

// Debug function to help troubleshoot
function debugOtpCache(context = '') {
    log(`OTP Cache Debug (${context})`, 'verify', {
        cacheSize: otpCache.size,
        cacheContents: Array.from(otpCache.entries()).map(([userId, data]) => ({
            userId,
            otp: data.otp,
            email: data.email,
            realName: data.realName,
            expiresAt: new Date(data.expiresAt).toISOString(),
            isExpired: Date.now() > data.expiresAt,
            timeRemaining: Math.max(0, Math.floor((data.expiresAt - Date.now()) / 1000)) + 's'
        }))
    }, null, 'verbose');
}

export const data = new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Start the verification process to gain access to verified channels.')
    .setDMPermission(true); 

/**
 * Creates and returns the initial verification modal.
 */
function createVerifyModal() {
    const modal = new ModalBuilder()
        .setCustomId('verifyModal')
        .setTitle('Pulchowk Campus Verification');

    const realNameInput = new TextInputBuilder()
        .setCustomId('realNameInput')
        .setLabel('Your Full Real Name (as per college records)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., Ram Thapa Magar')
        .setMinLength(3)
        .setMaxLength(100)
        .setRequired(true);

    const collegeEmailInput = new TextInputBuilder()
        .setCustomId('collegeEmailInput')
        .setLabel('Your Pulchowk Campus Email Address')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., rollno.name@pcampus.edu.np')
        .setMinLength(10)
        .setMaxLength(255)
        .setRequired(true);

    const birthdateInput = new TextInputBuilder()
        .setCustomId('birthdateInput')
        .setLabel('Your Birthdate (YYYY-MM-DD) ')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('AD format e.g., 2000-01-15')
        .setMinLength(10)
        .setMaxLength(10)
        .setRequired(true);

    const firstActionRow = new ActionRowBuilder().addComponents(realNameInput);
    const secondActionRow = new ActionRowBuilder().addComponents(collegeEmailInput);
    const thirdActionRow = new ActionRowBuilder().addComponents(birthdateInput);

    modal.addComponents(firstActionRow, secondActionRow, thirdActionRow);
    return modal;
}

/**
 * Executes the /verify slash command.
 */
export async function execute(interaction) {
    log('[/verify] command executed', 'command', {
        userTag: interaction.user.tag,
        userId: interaction.user.id
    });
    
    let guildToVerifyFor = null;
    let memberInGuild = null;

    const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
    const GUILD_ID = process.env.GUILD_ID;

    if (!VERIFIED_ROLE_ID || VERIFIED_ROLE_ID === 'YOUR_VERIFIED_ROLE_ID_HERE') {
        log('Verification not configured: VERIFIED_ROLE_ID missing', 'error', null, new Error('VERIFIED_ROLE_ID is missing'));
        return interaction.reply({ content: '❌ Verification is not properly configured (VERIFIED_ROLE_ID is missing). Please contact an administrator.', flags: [MessageFlags.Ephemeral] });
    }

    if (!GUILD_ID || GUILD_ID === 'YOUR_GUILD_ID_HERE') {
        log('Verification not configured: GUILD_ID missing', 'error', null, new Error('GUILD_ID is missing'));
        return interaction.reply({ content: '❌ The bot\'s main guild ID is not configured (GUILD_ID is missing). Please contact an administrator.', flags: [MessageFlags.Ephemeral] });
    }

    try {
        guildToVerifyFor = await interaction.client.guilds.fetch(GUILD_ID);
        memberInGuild = await guildToVerifyFor.members.fetch(interaction.user.id);

        if (!memberInGuild) {
            log('User not a member of main server', 'warn', { userId: interaction.user.id, guildName: guildToVerifyFor.name });
            return interaction.reply({ content: `❌ You must be a member of the main server (${guildToVerifyFor.name}) to use this command. Please join the server first.`, flags: [MessageFlags.Ephemeral] });
        }
    } catch (error) {
        log('Error fetching guild or member for verification', 'error', { userId: interaction.user.id, guildId: GUILD_ID }, error);
        return interaction.reply({ content: '❌ Could not determine your membership in the main server. Please ensure you are in the server and try again later.', flags: [MessageFlags.Ephemeral] });
    }

    if (memberInGuild.roles.cache.has(VERIFIED_ROLE_ID)) {
        log('User already verified', 'info', { userId: interaction.user.id });
        return interaction.reply({ content: '✅ You are already verified!', flags: [MessageFlags.Ephemeral] });
    }

    const modal = createVerifyModal();
    await interaction.showModal(modal);
}

/**
 * Handles a button interaction to show the initial verification modal.
 */
export async function handleButtonInteraction(interaction) {
    log('handleButtonInteraction (verify)', 'interaction', {
        userTag: interaction.user.tag,
        userId: interaction.user.id,
        customId: interaction.customId
    });
    
    let guildToVerifyFor = null;
    let memberInGuild = null;
    const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
    const GUILD_ID = process.env.GUILD_ID;

    if (!VERIFIED_ROLE_ID || VERIFIED_ROLE_ID === 'YOUR_VERIFIED_ROLE_ID_HERE') {
        log('Verification not configured: VERIFIED_ROLE_ID missing', 'error', null, new Error('VERIFIED_ROLE_ID is missing'));
        await interaction.reply({ 
            content: '❌ Verification is not properly configured (VERIFIED_ROLE_ID is missing). Please contact an administrator.', 
            flags: [MessageFlags.Ephemeral] 
        });
        return; 
    }

    if (!GUILD_ID || GUILD_ID === 'YOUR_GUILD_ID_HERE') {
        log('Verification not configured: GUILD_ID missing', 'error', null, new Error('GUILD_ID is missing'));
        await interaction.reply({ 
            content: '❌ The bot\'s main guild ID is not configured (GUILD_ID is missing). Please contact an administrator.', 
            flags: [MessageFlags.Ephemeral] 
        });
        return;
    }

    try {
        guildToVerifyFor = await interaction.client.guilds.fetch(GUILD_ID);
        memberInGuild = await guildToVerifyFor.members.fetch(interaction.user.id);

        if (!memberInGuild) {
            log('User not a member of main server', 'warn', { userId: interaction.user.id, guildName: guildToVerifyFor.name });
            await interaction.reply({ 
                content: `❌ You must be a member of the main server (${guildToVerifyFor.name}) to use this button. Please join the server first.`, 
                flags: [MessageFlags.Ephemeral] 
            });
            return; 
        }
    } catch (error) {
        log('Error fetching guild or member for DM button verification', 'error', { userId: interaction.user.id, guildId: GUILD_ID }, error);
        await interaction.reply({ 
            content: '❌ Could not determine your membership in the main server. Please ensure you are in the server and try again later.', 
            flags: [MessageFlags.Ephemeral] 
        });
        return; 
    }

    if (memberInGuild.roles.cache.has(VERIFIED_ROLE_ID)) {
        log('User already verified via button interaction', 'info', { userId: interaction.user.id });
        await interaction.reply({ 
            content: '✅ You are already verified!', 
            flags: [MessageFlags.Ephemeral] 
        });
        return; 
    }

    // Show the verification modal
    const modal = createVerifyModal();
    await interaction.showModal(modal);
}

/**
 * Handles the submission of the verification modal ('verifyModal').
 */
export async function handleModalSubmit(interaction) {
    log('handleModalSubmit (verify)', 'interaction', {
        userTag: interaction.user.tag,
        userId: interaction.user.id
    });
    
    // Debug cache state before processing
    debugOtpCache('before modal processing');
    
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const realName = interaction.fields.getTextInputValue('realNameInput');
    const email = interaction.fields.getTextInputValue('collegeEmailInput');
    const birthdateString = interaction.fields.getTextInputValue('birthdateInput');

    const userId = interaction.user.id;
    const guildId = process.env.GUILD_ID;
    const discordUsername = interaction.user.tag;

    log('Form data received', 'info', { realName, email, birthdateString, userId });

    // Validation (without clearing cache on errors)
    if (!email.endsWith('@pcampus.edu.np')) {
        log('Email validation failed', 'warn', { email });
        return await interaction.editReply({ content: '❌ Please use your official Pulchowk Campus email address (@pcampus.edu.np).' });
    }

    const birthdateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!birthdateRegex.test(birthdateString)) {
        log('Birthdate format validation failed', 'warn', { birthdateString });
        return await interaction.editReply({ content: '❌ Please enter your birthdate in YYYY-MM-DD format (e.g., 2000-01-15).' });
    }

    const [year, month, day] = birthdateString.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) {
        log('Birthdate value validation failed', 'warn', { birthdateString, parsedDate: date });
        return await interaction.editReply({ content: '❌ The birthdate you entered is not valid. Please check the month, day, and year.' });
    }

    // Generate OTP and store in cache
    const otp = generateOtp();
    const otpExpiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes from now

    const otpData = {
        otp,
        realName,
        email,
        birthdate: { year, month, day },
        guildId: guildId,
        discordUsername,
        expiresAt: otpExpiresAt,
    };

    // Store in cache BEFORE attempting to send email
    otpCache.set(userId, otpData);
    log(`OTP stored in cache`, 'info', { userId, otp, expiresAt: new Date(otpExpiresAt).toISOString() });
    
    // Debug cache state after storing OTP
    debugOtpCache('after storing OTP');

    try {
        // Try to send email
        const emailSubject = 'FSU: Your One-Time Password (OTP) for Pulchowk Campus Verification';
        const emailHtmlContent = otpEmailTemplate
            .replace('{{OTP_CODE}}', otp)
            .replace('{{USER_REAL_NAME}}', realName); 

        let emailSent = false;
        try {
            await emailClient.sendEmail(email, emailSubject, emailHtmlContent);
            emailSent = true;
            log('Email sent successfully', 'success', { email });
        } catch (emailError) {
            log('Error sending verification email', 'error', { email }, emailError);
            // Don't throw here - we'll still allow manual OTP entry
        }

        // Create button for OTP entry (always create this, regardless of email success)
        const confirmButton = new ButtonBuilder()
            .setCustomId(`confirm_otp_button_${userId}_${Date.now()}`)
            .setLabel('Enter OTP')
            .setStyle(ButtonStyle.Success);

        const row = new ActionRowBuilder().addComponents(confirmButton);

        // Customize message based on email success
        let responseMessage = `✅ An OTP has been generated for **${email}**.`;
        if (emailSent) {
            responseMessage += ` Please check your inbox (and spam folder).`;
        } else {
            responseMessage += ` ⚠️ There was an issue sending the email, but you can still enter your OTP manually if you received it.`;
        }
        responseMessage += `\n\nClick the button below to enter your OTP, or use \`/confirmotp <your_otp>\`.`;

        await interaction.editReply({
            content: responseMessage,
            components: [row]
        });

        log('Response sent to user, OTP should be in cache', 'info');
        debugOtpCache('after sending response');

    } catch (error) {
        log('Critical error during verification process', 'error', null, error);
        // Only clear cache on truly critical errors
        otpCache.delete(userId);
        log('Cache cleared due to critical error', 'warn', { userId });
        await interaction.editReply({ 
            content: '❌ A critical error occurred during verification. Please try the `/verify` command again. If the issue persists, contact an admin.' 
        });
    }
}

export function getOtpCache() {
    return otpCache;
}

// Export debug function for troubleshooting
export { debugOtpCache };

export async function saveBirthday(userId, guildId, birthdate, setBy) {
    const { year, month, day } = birthdate;
    return new Promise((resolve, reject) => {
        db.run(`INSERT OR REPLACE INTO birthdays (user_id, guild_id, month, day, year, set_by) VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, guildId, month, day, year, setBy],
            function(err) {
                if (err) {
                    log('Error saving birthday', 'error', { userId, guildId }, err);
                    return reject(err);
                }
                log(`Birthday for user ${userId} saved/updated in guild ${guildId}.`, 'success');
                resolve(this.lastID);
            }
        );
    });
}

export async function saveVerifiedUser(userId, guildId, realName, discordUsername, email) {
    return new Promise((resolve, reject) => {
        db.run(`INSERT OR REPLACE INTO verified_users (user_id, guild_id, real_name, discord_username, email, verified_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [userId, guildId, realName, discordUsername, email],
            function(err) {
                if (err) {
                    log('Error saving verified user to database', 'error', { userId, guildId }, err);
                    return reject(err);
                }
                log(`User ${userId} (${discordUsername}) verified and saved in guild ${guildId}.`, 'success');
                resolve(this.lastID);
            }
        );
    });
}