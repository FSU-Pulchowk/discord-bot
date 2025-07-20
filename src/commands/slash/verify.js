import { SlashCommandBuilder, ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle, ButtonBuilder, ButtonStyle } from 'discord.js';
import { emailService } from '../../services/emailService.js';
import { generateOtp } from '../../utils/otpGenerator.js';
import dotenv from 'dotenv';
import { db } from '../../database.js';

dotenv.config();

const otpCache = new Map();

export const data = new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Start the verification process to gain access to verified channels.');

/**
 * Executes the /verify slash command.
 * Presents a modal to the user to collect their real name, college email, and birthdate.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
 */
export async function execute(interaction) {
    // Check if user is already verified (optional, but good practice)
    const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
    if (VERIFIED_ROLE_ID && interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) {
        return interaction.reply({ content: '✅ You are already verified!', ephemeral: true });
    }

    const modal = new ModalBuilder()
        .setCustomId('verifyModal')
        .setTitle('Pulchowk Campus Verification');

    const realNameInput = new TextInputBuilder()
        .setCustomId('realNameInput')
        .setLabel('Your Full Real Name (as per college records)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., John Doe')
        .setRequired(true);

    const emailInput = new TextInputBuilder()
        .setCustomId('emailInput')
        .setLabel('Your College Email Address')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., rollno.name@pcampus.edu.np')
        .setRequired(true);

    const birthdateInput = new TextInputBuilder()
        .setCustomId('birthdateInput')
        .setLabel('Your Birthdate (YYYY-MM-DD)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., 2000-01-31 (Year is mandatory)')
        .setRequired(true);

    const firstActionRow = new ActionRowBuilder().addComponents(realNameInput);
    const secondActionRow = new ActionRowBuilder().addComponents(emailInput);
    const thirdActionRow = new ActionRowBuilder().addComponents(birthdateInput); // New row for birthdate

    modal.addComponents(firstActionRow, secondActionRow, thirdActionRow); // Add new row to modal

    await interaction.showModal(modal);
}

/**
 * Handles the submission of the verification modal.
 * Generates OTP, sends email, stores data in cache, and sends confirmation message with button.
 * This function is called by the bot's main interaction handler when the modal is submitted.
 * @param {import('discord.js').ModalSubmitInteraction} interaction - The modal submit interaction object.
 */
export async function handleModalSubmit(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const realName = interaction.fields.getTextInputValue('realNameInput').trim();
    const email = interaction.fields.getTextInputValue('emailInput').trim().toLowerCase();
    const birthdateString = interaction.fields.getTextInputValue('birthdateInput').trim();
    const discordUsername = interaction.user.tag;
    const COLLEGE_EMAIL_DOMAIN = process.env.COLLEGE_EMAIL_DOMAIN || '@pcampus.edu.np';

    if (!email.endsWith(COLLEGE_EMAIL_DOMAIN)) {
        return interaction.editReply({ content: `❌ Please use your official college email address ending with \`${COLLEGE_EMAIL_DOMAIN}\`.` });
    }

    const birthdateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!birthdateRegex.test(birthdateString)) {
        return interaction.editReply({ content: '❌ Invalid birthdate format. Please use YYYY-MM-DD (e.g., 2000-01-31). Year is mandatory.' });
    }

    const [year, month, day] = birthdateString.split('-').map(Number);
    if (isNaN(year) || isNaN(month) || isNaN(day) || month < 1 || month > 12 || day < 1 || day > 31) {
        return interaction.editReply({ content: '❌ Invalid birthdate. Please ensure month and day are valid numbers.' });
    }

    const otp = generateOtp();

    otpCache.set(interaction.user.id, {
        otp,
        email,
        realName,
        discordUsername,
        birthdate: { year, month, day }, // Store parsed birthdate
        timestamp: Date.now()
    });

    try {
        await emailService.sendEmail(
            email,
            'Pulchowk Bot Discord Verification OTP',
            `Your One-Time Password (OTP) for Discord verification is: ${otp}\n\nThis OTP is valid for 5 minutes. Do not share this code with anyone.`
        );

        const confirmButton = new ButtonBuilder()
            .setCustomId(`confirm_otp_button_${interaction.user.id}`)
            .setLabel('Confirm OTP')
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(confirmButton);

        await interaction.editReply({
            content: `✅ An OTP has been sent to **${email}**. Please check your inbox (and spam folder).\n\nClick the button below to enter your OTP, or use \`/confirmotp <your_otp>\`.`,
            components: [row]
        });

    } catch (error) {
        console.error('Error during verification modal submission or email sending:', error);
        otpCache.delete(interaction.user.id);
        await interaction.editReply({ content: '❌ Failed to send OTP. Please ensure your email is correct and try again later. If the issue persists, contact an admin.' });
    }
}

/**
 * Returns the OTP cache. Used by confirmotp.js.
 * @returns {Map<string, object>} The OTP cache.
 */
export function getOtpCache() {
    return otpCache;
}

export async function saveBirthday(userId, guildId, birthdate, setBy) {
    const { year, month, day } = birthdate;
    return new Promise((resolve, reject) => {
        db.run(`INSERT OR REPLACE INTO birthdays (user_id, guild_id, month, day, year, set_by) VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, guildId, month, day, year, setBy],
            function(err) {
                if (err) {
                    console.error('Error saving birthday:', err.message);
                    return reject(err);
                }
                console.log(`Birthday for user ${userId} saved/updated.`);
                resolve(this.lastID);
            }
        );
    });
}