import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionsBitField,
    MessageFlags,
    ChannelType, 
    ActionRowBuilder, 
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

export const data = new SlashCommandBuilder()
    .setName('remindverify')
    .setDescription('Sends a verification reminder to unverified users in their DMs.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild) 
    .addStringOption(option =>
        option.setName('message')
            .setDescription('Optional custom message to include in the reminder.')
            .setRequired(false))
    .addUserOption(option =>
        option.setName('target_user')
            .setDescription('Optional: Send reminder only to a specific user (for testing).')
            .setRequired(false));

/**
 * Executes the /remindverify slash command.
 * Fetches unverified users and sends them a DM reminder.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
 */
export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', flags: [MessageFlags.Ephemeral] });
    }

    // Defer the reply as fetching members and sending DMs can take time
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
    const GUILD_ID = process.env.GUILD_ID; // The main guild ID where verification applies

    if (!VERIFIED_ROLE_ID || VERIFIED_ROLE_ID === 'YOUR_VERIFIED_ROLE_ID_HERE') {
        return interaction.editReply({ content: '❌ Verification is not properly configured (VERIFIED_ROLE_ID is missing). Please contact an administrator.' });
    }
    if (!GUILD_ID || GUILD_ID === 'YOUR_GUILD_ID_HERE') {
        return interaction.editReply({ content: '❌ The bot\'s main guild ID is not configured (GUILD_ID is missing). Please contact an administrator.' });
    }

    const customMessage = interaction.options.getString('message');
    const targetUser = interaction.options.getUser('target_user'); // Get the target user if provided

    let targetGuild;
    try {
        targetGuild = await interaction.client.guilds.fetch(GUILD_ID);
    } catch (error) {
        console.error(`Error fetching target guild (${GUILD_ID}):`, error);
        return interaction.editReply({ content: '❌ Could not fetch the main guild to find unverified users. Please check the GUILD_ID environment variable.' });
    }

    let members;
    try {
        // Fetch all members to check their roles
        members = await targetGuild.members.fetch();
    } catch (error) {
        console.error(`Error fetching members for guild ${GUILD_ID}:`, error);
        return interaction.editReply({ content: '❌ Could not fetch members from the main guild. Please ensure the bot has the "Guild Members Intent" enabled and sufficient permissions.' });
    }

    let unverifiedMembers = members.filter(member =>
        !member.user.bot && // Exclude bots
        !member.roles.cache.has(VERIFIED_ROLE_ID) // Include members without the verified role
    );

    // --- START: Temporary filter for testing specific user ---
    if (targetUser) {
        // For testing purposes, filter to only include the target user
        // REMOVE this block for production use to send to all unverified members
        const specificUnverifiedMember = unverifiedMembers.find(member => member.user.id === targetUser.id);
        if (specificUnverifiedMember) {
            unverifiedMembers = new Map([[specificUnverifiedMember.id, specificUnverifiedMember]]);
            console.log(`[RemindVerify] Testing mode: Targeting only user ${targetUser.tag} (${targetUser.id}).`);
        } else {
            return interaction.editReply({ content: `⚠️ User ${targetUser.tag} is either a bot, already verified, or not found in the main guild. Cannot send reminder.` });
        }
    }
    // --- END: Temporary filter for testing specific user ---


    if (unverifiedMembers.size === 0) {
        return interaction.editReply({ content: '✅ No unverified members found in the server at this time.' });
    }

    let sentCount = 0;
    let failedCount = 0;
    const failedUsers = [];

    const reminderEmbed = new EmbedBuilder()
        .setColor('#FFA500') // Orange color for reminder
        .setTitle('🔔 Verification Reminder!')
        .setDescription('It looks like you haven\'t completed your verification yet. To gain full access to the server\'s channels, please complete the verification process.')
        .addFields(
            { name: 'How to Verify:', value: 'Please use the `/verify` command in any channel (or in my DMs) and follow the instructions. If you already started, you can use `/confirmotp` with your code.' },
            { name: 'Need Help?', value: 'If you encounter any issues, please reach out to an administrator in the server.' }
        )
        .setTimestamp();

    if (customMessage) {
        reminderEmbed.addFields({ name: 'Important Note:', value: customMessage });
    }

    // Send DMs sequentially to avoid hitting Discord rate limits too hard
    for (const member of unverifiedMembers.values()) {
        // Create the "Verify Your Account" button for EACH RECIPIENT
        // The customId must contain the recipient's ID for correct handling in verify.js
        const verifyButton = new ButtonBuilder()
            .setCustomId(`verify_start_button_${member.user.id}`) // CORRECTED: Use member.user.id for the recipient
            .setLabel('Verify Your Account')
            .setStyle(ButtonStyle.Primary);

        const actionRow = new ActionRowBuilder().addComponents(verifyButton);

        try {
            await member.send({ embeds: [reminderEmbed], components: [actionRow] }); // Include the button in the DM
            sentCount++;
            await new Promise(resolve => setTimeout(resolve, 500)); // Small delay to prevent rate limits
        } catch (error) {
            console.warn(`Failed to send verification reminder DM to ${member.user.tag} (${member.user.id}):`, error.message);
            failedCount++;
            failedUsers.push(member.user.tag);
        }
    }

    let replyContent = `✅ Sent **${sentCount}** verification reminders.`;
    if (failedCount > 0) {
        replyContent += `\n❌ Failed to send **${failedCount}** reminders (users might have DMs disabled or blocked the bot). Failed users: ${failedUsers.slice(0, 5).join(', ')}${failedUsers.length > 5 ? '...' : ''}`;
    }

    await interaction.editReply({ content: replyContent });

    // Optional: Log to an admin channel if configured
    const ADMIN_LOG_CHANNEL_ID = process.env.ADMIN_LOG_CHANNEL_ID; // Add this to your .env
    if (ADMIN_LOG_CHANNEL_ID && ADMIN_LOG_CHANNEL_ID !== 'YOUR_ADMIN_LOG_CHANNEL_ID_HERE') {
        try {
            const adminLogChannel = await interaction.client.channels.fetch(ADMIN_LOG_CHANNEL_ID);
            if (adminLogChannel && (adminLogChannel.type === ChannelType.GuildText || adminLogChannel.type === ChannelType.GuildAnnouncement)) {
                const logEmbed = new EmbedBuilder()
                    .setColor('#007BFF')
                    .setTitle('Verification Reminders Sent')
                    .setDescription(`**${interaction.user.tag}** sent verification reminders.`)
                    .addFields(
                        { name: 'Total Unverified', value: unverifiedMembers.size.toString(), inline: true },
                        { name: 'Reminders Sent', value: sentCount.toString(), inline: true },
                        { name: 'Reminders Failed', value: failedCount.toString(), inline: true }
                    )
                    .setTimestamp();
                if (failedUsers.length > 0) {
                    logEmbed.addFields({ name: 'Failed Users (Sample)', value: failedUsers.slice(0, 10).join(', ') });
                }
                await adminLogChannel.send({ embeds: [logEmbed] }).catch(e => console.error("Error sending admin log for reminders:", e));
            }
        } catch (logError) {
            console.error('Error fetching or sending to admin log channel:', logError);
        }
    }
}