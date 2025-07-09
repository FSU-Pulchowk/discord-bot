import { SlashCommandBuilder, ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle, ButtonBuilder, ButtonStyle } from 'discord.js';
import { emailService } from '../../services/emailService.js'; 
import { generateOtp } from '../../utils/otpGenerator.js'; 
import dotenv from 'dotenv';

dotenv.config();

// Using a Map for OTP storage (in-memory, not persistent across restarts)
// In a production environment, consider a persistent store like Redis or a database.
const otpCache = new Map(); // Stores { userId: { otp: string, email: string, realName: string, discordUsername: string, timestamp: number } }

export const data = new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Start the verification process to gain access to verified channels.');

/**
 * Executes the /verify slash command.
 * Presents a modal to the user to collect their real name and college email.
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

    const firstActionRow = new ActionRowBuilder().addComponents(realNameInput);
    const secondActionRow = new ActionRowBuilder().addComponents(emailInput);

    modal.addComponents(firstActionRow, secondActionRow);

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
    const discordUsername = interaction.user.tag;
    const COLLEGE_EMAIL_DOMAIN = process.env.COLLEGE_EMAIL_DOMAIN || '@pcampus.edu.np';
    if (!email.endsWith(COLLEGE_EMAIL_DOMAIN)) {
        return interaction.editReply({ content: `❌ Please use your official college email address ending with \`${COLLEGE_EMAIL_DOMAIN}\`.` });
    }

    const otp = generateOtp(); 

    otpCache.set(interaction.user.id, {
        otp,
        email,
        realName,
        discordUsername,
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