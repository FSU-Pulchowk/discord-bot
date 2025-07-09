import { SlashCommandBuilder, ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle } from 'discord.js';
import { getOtpCache } from './verify.js'; 
import dotenv from 'dotenv'; 
import { db } from '../../database.js';

dotenv.config();

export const data = new SlashCommandBuilder()
    .setName('confirmotp')
    .setDescription('Confirm your identity by entering the OTP sent to your college email.')
    .addStringOption(option =>
        option.setName('otp')
        .setDescription('The 6-digit OTP you received in your email')
        .setRequired(true)
    );

/**
 * Core logic for processing OTP confirmation, whether from slash command or modal submission.
 * This is a private helper function within this module.
 * @param {import('discord.js').ChatInputCommandInteraction | import('discord.js').ModalSubmitInteraction} interaction - The interaction object.
 * @param {string} enteredOtp - The OTP entered by the user.
 */
async function _processOtpConfirmation(interaction, enteredOtp) {
    const userOtpData = getOtpCache().get(interaction.user.id);
    const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;

    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
    }

    try {
        if (!VERIFIED_ROLE_ID || VERIFIED_ROLE_ID === 'YOUR_VERIFIED_ROLE_ID_HERE') {
            return await interaction.editReply({ content: '❌ The bot owner has not configured the `VERIFIED_ROLE_ID` in the `.env` file. Please contact an admin.' });
        }

        if (!userOtpData) {
            return await interaction.editReply({ content: '❌ No pending verification found. Please use `/verify` first.' });
        }

        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        if (userOtpData.timestamp < fiveMinutesAgo) {
            getOtpCache().delete(interaction.user.id); 
            return await interaction.editReply({ content: '❌ Your OTP has expired. Please use `/verify` again to get a new one.' });
        }

        if (enteredOtp !== userOtpData.otp) {
            return await interaction.editReply({ content: '❌ Invalid OTP. Please try again or use `/verify` to get a new one.' });
        }

        const role = interaction.guild.roles.cache.get(VERIFIED_ROLE_ID);
        if (!role) {
            console.error(`Verified role with ID ${VERIFIED_ROLE_ID} not found.`);
            return await interaction.editReply({ content: '❌ The verified role could not be found. Please contact an admin.' });
        }

        if (!interaction.guild.members.me.permissions.has('ManageRoles')) {
            return await interaction.editReply({ content: '❌ I do not have permission to manage roles. Please ask an admin to grant me "Manage Roles" permission.' });
        }
        if (interaction.guild.members.me.roles.highest.position <= role.position) {
            return await interaction.editReply({ content: `❌ My highest role is not above the "${role.name}" role. Please ask an admin to move my role higher.` });
        }

        await interaction.member.roles.add(role, 'User verified via OTP');

        const { email, realName, discordUsername } = userOtpData;
        const userId = interaction.user.id;
        const guildId = interaction.guild.id;

        console.log(`[DEBUG] Attempting to save: UserID=${userId}, GuildID=${guildId}, RealName='${realName}', DiscordUsername='${discordUsername}', Email='${email}'`);
        if (!realName) {
            console.error("[DEBUG] realName is undefined or null from otpCache!");
        }

        db.run(`INSERT INTO verified_users (user_id, guild_id, real_name, discord_username, email)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    guild_id = excluded.guild_id,
                    real_name = excluded.real_name,
                    discord_username = excluded.discord_username,
                    email = excluded.email,
                    verified_at = CURRENT_TIMESTAMP`,
            [userId, guildId, realName, discordUsername, email],
            function(err) {
                if (err) {
                    console.error('Error saving verified user data to DB:', err.message);
                } else {
                    console.log(`Verified user ${discordUsername} (${userId}) saved to DB.`);
                }
            }
        );
        getOtpCache().delete(interaction.user.id); 

        await interaction.editReply({ content: `🎉 Congratulations! You have been successfully verified as **${realName}** and the "${role.name}" role has been assigned.` });

    } catch (error) {
        console.error('❌ Error during OTP confirmation or role assignment:', error);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: '❌ An error occurred during verification. Please contact an admin or try again later.' });
        } else {
            await interaction.reply({ content: '❌ An error occurred during verification. Please contact an admin or try again later.', ephemeral: true });
        }
    }
}

/**
 * Executes the /confirmotp slash command.
 * Verifies the OTP and assigns the verified role.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
 */
export async function execute(interaction) {
    const enteredOtp = interaction.options.getString('otp');
    await _processOtpConfirmation(interaction, enteredOtp);
}

/**
 * Handles button interactions for the confirm OTP button.
 * Presents a modal to the user to enter the OTP.
 * @param {import('discord.js').ButtonInteraction} interaction - The button interaction object.
 */
export async function handleButtonInteraction(interaction) {
    const expectedUserId = interaction.customId.split('_')[3]; 
    if (interaction.user.id !== expectedUserId) {
        return interaction.reply({ content: '❌ This button is not for you.', ephemeral: true });
    }

    const modal = new ModalBuilder()
        .setCustomId('confirmOtpModal')
        .setTitle('Enter OTP');

    const otpInput = new TextInputBuilder()
        .setCustomId('otpInput')
        .setLabel('Enter the 6-digit OTP')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., 123456')
        .setMinLength(6)
        .setMaxLength(6)
        .setRequired(true);

    const firstActionRow = new ActionRowBuilder().addComponents(otpInput);
    modal.addComponents(firstActionRow);

    await interaction.showModal(modal);
}

/**
 * Handles the submission of the confirm OTP modal.
 * Processes the entered OTP and completes verification.
 * This function is called by the bot's main interaction handler when the modal is submitted.
 * @param {import('discord.js').ModalSubmitInteraction} interaction - The modal submit interaction object.
 */
export async function handleModalSubmit(interaction) {
    const enteredOtp = interaction.fields.getTextInputValue('otpInput');
    await _processOtpConfirmation(interaction, enteredOtp);
}