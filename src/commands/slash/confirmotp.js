import {
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    ActionRowBuilder,
    TextInputStyle,
    EmbedBuilder,
    PermissionsBitField,
    MessageFlags,
    ChannelType
} from 'discord.js';
import { getOtpCache, saveVerifiedUser, saveBirthday, debugOtpCache } from './verify.js';
import dotenv from 'dotenv';
import { db } from '../../database.js';
import { log } from '../../utils/debug.js';

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
 */
async function _processOtpConfirmation(interaction, enteredOtp) {
    log('_processOtpConfirmation started', 'command', {
        userTag: interaction.user.tag,
        userId: interaction.user.id,
        enteredOtp
    });
    
    // Debug cache state
    debugOtpCache('at start of OTP confirmation');
    
    const userOtpData = getOtpCache().get(interaction.user.id);
    const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
    const GUILD_ID = process.env.GUILD_ID;

    // For slash commands, defer immediately. For modal submissions, they are already deferred.
    if (interaction.isChatInputCommand() && !interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    }

    try {
        if (!VERIFIED_ROLE_ID || VERIFIED_ROLE_ID === 'YOUR_VERIFIED_ROLE_ID_HERE') {
            log('Verification not configured: VERIFIED_ROLE_ID missing', 'error', null, new Error('VERIFIED_ROLE_ID is missing'));
            return await interaction.editReply({ content: '❌ Verification is not properly configured (VERIFIED_ROLE_ID is missing). Please contact an administrator.' });
        }
        if (!GUILD_ID || GUILD_ID === 'YOUR_GUILD_ID_HERE') {
            log('Verification not configured: GUILD_ID missing', 'error', null, new Error('GUILD_ID is missing'));
            return await interaction.editReply({ content: '❌ The bot\'s main guild ID is not configured (GUILD_ID is missing). Please contact an administrator.' });
        }

        if (!userOtpData) {
            log('No OTP data found in cache for user', 'warn', { userId: interaction.user.id });
            debugOtpCache('when OTP data not found');
            return await interaction.editReply({ content: '❌ No pending verification found. Please use the `/verify` command first to get an OTP.' });
        }

        log('Found OTP data in cache', 'info', {
            storedOtp: userOtpData.otp,
            enteredOtp: enteredOtp,
            expiresAt: new Date(userOtpData.expiresAt).toISOString(),
            isExpired: Date.now() > userOtpData.expiresAt
        });

        // Check if OTP has expired
        if (Date.now() > userOtpData.expiresAt) {
            log('OTP has expired', 'warn', { userId: interaction.user.id });
            getOtpCache().delete(interaction.user.id);
            return await interaction.editReply({ content: '❌ Your OTP has expired. Please use the `/verify` command again to get a new one.' });
        }

        // Check if OTP matches
        if (enteredOtp !== userOtpData.otp) {
            log('OTP mismatch', 'warn', { entered: enteredOtp, expected: userOtpData.otp });
            return await interaction.editReply({ content: '❌ Incorrect OTP. Please try again.' });
        }

        log('OTP is valid, proceeding with verification...', 'info');

        const guildId = userOtpData.guildId;
        let targetGuild;
        let memberToVerify;

        try {
            targetGuild = await interaction.client.guilds.fetch(guildId);
            memberToVerify = await targetGuild.members.fetch(interaction.user.id);
        } catch (fetchError) {
            log('Error fetching guild or member during OTP confirmation', 'error', { userId: interaction.user.id }, fetchError);
            getOtpCache().delete(interaction.user.id);
            return await interaction.editReply({ content: '❌ Could not find you in the server to assign roles. Please ensure you are in the server and try again.' });
        }

        if (memberToVerify.roles.cache.has(VERIFIED_ROLE_ID)) {
            getOtpCache().delete(interaction.user.id);
            log('User already verified, clearing old OTP cache', 'info', { userId: interaction.user.id });
            return await interaction.editReply({ content: '✅ You are already verified!' });
        }

        const verifiedRole = targetGuild.roles.cache.get(VERIFIED_ROLE_ID);
        if (!verifiedRole) {
            log(`VERIFIED_ROLE_ID (${VERIFIED_ROLE_ID}) not found`, 'error', { guildName: targetGuild.name });
            getOtpCache().delete(interaction.user.id);
            return await interaction.editReply({ content: '❌ The verified role could not be found in the server. Please contact an administrator.' });
        }

        if (!targetGuild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            log(`Bot lacks 'Manage Roles' permission`, 'error', { guildName: targetGuild.name });
            getOtpCache().delete(interaction.user.id);
            return await interaction.editReply({ content: '❌ I do not have permissions to assign roles. Please contact an administrator.' });
        }
        if (targetGuild.members.me.roles.highest.position <= verifiedRole.position) {
            log(`Bot's highest role is not above verified role`, 'error', { botRole: targetGuild.members.me.roles.highest.name, verifiedRole: verifiedRole.name });
            getOtpCache().delete(interaction.user.id);
            return await interaction.editReply({ content: '❌ My role is not high enough to assign the verified role. Please contact an administrator.' });
        }

        // Assign verified role
        await memberToVerify.roles.add(verifiedRole, 'User verification via OTP');
        log('Assigned verified role', 'success', { userTag: memberToVerify.user.tag, roleName: verifiedRole.name });

        // Save to database
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

        // Clear OTP cache after successful verification
        getOtpCache().delete(interaction.user.id);
        log('OTP cache cleared after successful verification', 'info', { userId: interaction.user.id });

        const successEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Verification Successful!')
            .setDescription(`Congratulations, **${userOtpData.realName}**! You have been successfully verified and granted the **${verifiedRole.name}** role.`)
            .addFields(
                { name: 'Welcome to the community!', value: 'You now have full access to the verified channels.' }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [successEmbed], components: [] });

        // Send log to verification channel if configured
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
                    await logChannel.send({ embeds: [logEmbed] }).catch(e => log('Error sending verification log', 'error', null, e));
                }
            } catch (logError) {
                log('Error sending verification log to channel', 'error', { channelId: VERIFICATION_LOG_CHANNEL_ID }, logError);
            }
        }

    } catch (error) {
        log('Error during OTP confirmation', 'error', null, error);
        await interaction.editReply({ content: '❌ An unexpected error occurred during OTP confirmation. Please try again later. If the issue persists, contact an admin.' });
    }
}

/**
 * Executes the /confirmotp slash command.
 */
export async function execute(interaction) {
    const enteredOtp = interaction.options.getString('otp');
    await _processOtpConfirmation(interaction, enteredOtp);
}

/**
 * Handles the click of the "Enter OTP" button.
 */
export async function handleButtonInteraction(interaction) {
    log('handleButtonInteraction (confirmotp) started', 'interaction', {
        userTag: interaction.user.tag,
        userId: interaction.user.id,
        customId: interaction.customId
    });
    
    // Debug cache state when button is clicked
    debugOtpCache('when OTP button clicked');

    // Parse customId: confirm_otp_button_${userId}_${timestamp}
    const customIdParts = interaction.customId.split('_');
    log('CustomId parts parsed', 'info', { parts: customIdParts });
    
    if (customIdParts.length < 4) {
        log('Invalid customId format', 'warn', { customId: interaction.customId });
        return await interaction.reply({ 
            content: '❌ Invalid button. Please use the `/verify` command again.', 
            flags: [MessageFlags.Ephemeral] 
        });
    }
    
    const expectedUserId = customIdParts[3]; // Index 3 should be the userId
    log('Checking button ownership', 'verbose', { expectedUserId, actualUserId: interaction.user.id });

    if (interaction.user.id !== expectedUserId) {
        return await interaction.reply({ content: '❌ This button is not for you.', flags: [MessageFlags.Ephemeral] });
    }

    const userOtpData = getOtpCache().get(interaction.user.id);
    if (!userOtpData) {
        log('No OTP data found when button clicked', 'warn', { userId: interaction.user.id });
        debugOtpCache('when no OTP data found for button');
        return await interaction.reply({ content: '❌ No pending verification found. Please use the `/verify` command first to get an OTP.', flags: [MessageFlags.Ephemeral] });
    }
    
    // Check if OTP expired
    if (Date.now() > userOtpData.expiresAt) {
        log('OTP expired when button clicked', 'warn', { userId: interaction.user.id });
        getOtpCache().delete(interaction.user.id);
        return await interaction.reply({ content: '❌ Your OTP has expired. Please use the `/verify` command again to get a new one.', flags: [MessageFlags.Ephemeral] });
    }

    log('OTP data found, showing modal', 'info');

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
 */
export async function handleModalSubmit(interaction) {
    log('handleModalSubmit (confirmotp) started', 'interaction', {
        userTag: interaction.user.tag,
        userId: interaction.user.id
    });
    
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const enteredOtp = interaction.fields.getTextInputValue('otpInput');
    await _processOtpConfirmation(interaction, enteredOtp);
}