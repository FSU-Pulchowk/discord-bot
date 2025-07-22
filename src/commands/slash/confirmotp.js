import {
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    ActionRowBuilder,
    TextInputStyle,
    EmbedBuilder,
    PermissionsBitField,
    MessageFlags // Import MessageFlags for ephemeral replies
} from 'discord.js';
import { getOtpCache, saveVerifiedUser, saveBirthday } from './verify.js';
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
        .setMinLength(6)
        .setMaxLength(6)
    )
    .setDMPermission(true);

/**
 * Core logic for processing OTP confirmation, whether from slash command or modal submission.
 * This is a private helper function within this module.
 * @param {import('discord.js').ChatInputCommandInteraction | import('discord.js').ModalSubmitInteraction} interaction - The interaction object.
 * @param {string} enteredOtp - The OTP entered by the user.
 */
async function _processOtpConfirmation(interaction, enteredOtp) {
    const userOtpData = getOtpCache().get(interaction.user.id);
    const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
    const GUILD_ID = process.env.GUILD_ID;

    // For slash commands, defer immediately. For modal submissions, they are already deferred by bot.js.
    // NOTE: The deferral for modal submissions is now handled directly in handleModalSubmit.
    if (interaction.isChatInputCommand() && !interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    }

    try {
        if (!VERIFIED_ROLE_ID || VERIFIED_ROLE_ID === 'YOUR_VERIFIED_ROLE_ID_HERE') {
            return await interaction.editReply({ content: '❌ Verification is not properly configured (VERIFIED_ROLE_ID is missing). Please contact an administrator.' });
        }
        if (!GUILD_ID || GUILD_ID === 'YOUR_GUILD_ID_HERE') {
            return await interaction.editReply({ content: '❌ The bot\'s main guild ID is not configured (GUILD_ID is missing). Please contact an administrator.' });
        }

        if (!userOtpData) {
            return await interaction.editReply({ content: '❌ No pending verification found. Please use the `/verify` command first to get an OTP.' });
        }

        const OTP_EXPIRATION_TIME_MS = 5 * 60 * 1000;
        if (Date.now() - userOtpData.expiresAt > OTP_EXPIRATION_TIME_MS) {
            getOtpCache().delete(interaction.user.id);
            return await interaction.editReply({ content: '❌ Your OTP has expired. Please use the `/verify` command again to get a new one.' });
        }

        if (enteredOtp !== userOtpData.otp) {
            return await interaction.editReply({ content: '❌ Incorrect OTP. Please try again.' });
        }

        const guildId = userOtpData.guildId;
        let targetGuild;
        let memberToVerify;

        try {
            targetGuild = await interaction.client.guilds.fetch(guildId);
            memberToVerify = await targetGuild.members.fetch(interaction.user.id);
        } catch (fetchError) {
            console.error(`Error fetching guild or member during OTP confirmation for user ${interaction.user.id}:`, fetchError);
            getOtpCache().delete(interaction.user.id);
            return await interaction.editReply({ content: '❌ Could not find you in the server to assign roles. Please ensure you are in the server and try again.' });
        }

        if (memberToVerify.roles.cache.has(VERIFIED_ROLE_ID)) {
            getOtpCache().delete(interaction.user.id);
            return await interaction.editReply({ content: '✅ You are already verified!' });
        }

        const verifiedRole = targetGuild.roles.cache.get(VERIFIED_ROLE_ID);
        if (!verifiedRole) {
            console.error(`VERIFIED_ROLE_ID (${VERIFIED_ROLE_ID}) not found in guild ${targetGuild.name}.`);
            getOtpCache().delete(interaction.user.id);
            return await interaction.editReply({ content: '❌ The verified role could not be found in the server. Please contact an administrator.' });
        }

        if (!targetGuild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            console.error(`Bot lacks 'Manage Roles' permission in guild ${targetGuild.name} to assign verified role.`);
            getOtpCache().delete(interaction.user.id);
            return await interaction.editReply({ content: '❌ I do not have permissions to assign roles. Please contact an administrator.' });
        }
        if (targetGuild.members.me.roles.highest.position <= verifiedRole.position) {
            console.error(`Bot's highest role is not above ${verifiedRole.name} in guild ${targetGuild.name}.`);
            getOtpCache().delete(interaction.user.id);
            return await interaction.editReply({ content: '❌ My role is not high enough to assign the verified role. Please contact an administrator.' });
        }

        await memberToVerify.roles.add(verifiedRole, 'User verification via OTP');

        await saveVerifiedUser(
            interaction.user.id,
            guildId,
            userOtpData.realName,
            userOtpData.discordUsername,
            userOtpData.email
        );

        await saveBirthday(
            interaction.user.id,
            guildId,
            userOtpData.birthdate,
            interaction.user.id
        );

        getOtpCache().delete(interaction.user.id);

        const successEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Verification Successful!')
            .setDescription(`Congratulations, **${userOtpData.realName}**! You have been successfully verified and granted the **${verifiedRole.name}** role.`)
            .addFields(
                { name: 'Welcome to the community!', value: 'You now have full access to the verified channels.' }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [successEmbed], components: [] });

        const VERIFICATION_LOG_CHANNEL_ID = process.env.VERIFICATION_LOG_CHANNEL_ID;
        if (VERIFICATION_LOG_CHANNEL_ID) {
            try {
                const logChannel = await targetGuild.channels.fetch(VERIFICATION_LOG_CHANNEL_ID);
                if (logChannel && (logChannel.type === ChannelType.GuildText || logChannel.type === ChannelType.GuildAnnouncement)) {
                    const logEmbed = new EmbedBuilder()
                        .setColor('#00FF00')
                        .setTitle('User Verified')
                        .setDescription(`**${memberToVerify.user.tag}** (${memberToVerify.user.id}) has successfully verified.`)
                        .addFields(
                            { name: 'Real Name', value: userOtpData.realName, inline: true },
                            { name: 'Email', value: userOtpData.email, inline: true },
                            { name: 'Birthdate', value: `${userOtpData.birthdate.year}-${userOtpData.birthdate.month}-${userOtpData.birthdate.day}`, inline: true }
                        )
                        .setTimestamp();
                    await logChannel.send({ embeds: [logEmbed] }).catch(e => console.error("Error sending verification log:", e));
                }
            } catch (logError) {
                console.error('Error sending verification log to channel:', logError);
            }
        }

    } catch (error) {
        console.error('Error during OTP confirmation:', error);
        await interaction.editReply({ content: '❌ An unexpected error occurred during OTP confirmation. Please try again later. If the issue persists, contact an admin.' });
    }
}

/**
 * Executes the /confirmotp slash command.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
 */
export async function execute(interaction) {
    const enteredOtp = interaction.options.getString('otp');
    await _processOtpConfirmation(interaction, enteredOtp);
}

/**
 * Handles the click of the "Enter OTP" button.
 * Presents a modal to the user to enter the OTP.
 * @param {import('discord.js').ButtonInteraction} interaction - The button interaction object.
 */
export async function handleButtonInteraction(interaction) {
    // The interaction is explicitly NOT deferred in bot.js for this button type,
    // allowing showModal to be the initial response.

    // Corrected index to get the userId from the customId
    const expectedUserId = interaction.customId.split('_')[3]; 
    console.log(`Expected User ID from customId: ${expectedUserId}`);
    console.log(`Interaction User ID: ${interaction.user.id}`);

    if (interaction.user.id !== expectedUserId) {
        return await interaction.reply({ content: '❌ This button is not for you.', flags: [MessageFlags.Ephemeral] });
    }

    const userOtpData = getOtpCache().get(interaction.user.id);
    if (!userOtpData) {
        return await interaction.reply({ content: '❌ No pending verification found. Please use the `/verify` command first to get an OTP.', flags: [MessageFlags.Ephemeral] });
    }
    
    const OTP_EXPIRATION_TIME_MS = 5 * 60 * 1000;
    if (Date.now() - userOtpData.expiresAt > OTP_EXPIRATION_TIME_MS) {
        getOtpCache().delete(interaction.user.id);
        return await interaction.reply({ content: '❌ Your OTP has expired. Please use the `/verify` command again to get a new one.', flags: [MessageFlags.Ephemeral] });
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
 * Handles the submission of the confirm OTP modal ('confirmOtpModal').
 * Processes the entered OTP and completes verification.
 * This function is called by the bot's main interaction handler when the modal is submitted.
 * @param {import('discord.js').ModalSubmitInteraction} interaction - The modal submit interaction object.
 */
export async function handleModalSubmit(interaction) {
    // Defer the modal submission interaction immediately to prevent InteractionNotReplied errors
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const enteredOtp = interaction.fields.getTextInputValue('otpInput');
    await _processOtpConfirmation(interaction, enteredOtp);
}