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
 * Minimum delay between sending DMs to prevent rate limiting and spam detection.
 * Discord's DM rate limits are strict. Start with a conservative value.
 * Adjust this if you still face issues, but be cautious with lower values.
 * @type {number}
 */
const DM_SEND_DELAY_MS = 3000; 

/**
 * Executes the /remindverify slash command.
 * Fetches unverified users and sends them a DM reminder.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
 */
export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', flags: [MessageFlags.Ephemeral] });
    }

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
    const GUILD_ID = process.env.GUILD_ID;

    if (!VERIFIED_ROLE_ID || VERIFIED_ROLE_ID === 'YOUR_VERIFIED_ROLE_ID_HERE') {
        return interaction.editReply({ content: '❌ Verification is not properly configured (VERIFIED_ROLE_ID is missing). Please contact an administrator.' });
    }
    if (!GUILD_ID || GUILD_ID === 'YOUR_GUILD_ID_HERE') {
        return interaction.editReply({ content: '❌ The bot\'s main guild ID is not configured (GUILD_ID is missing). Please contact an administrator.' });
    }

    const customMessage = interaction.options.getString('message');
    const targetUser = interaction.options.getUser('target_user');

    let targetGuild;
    try {
        targetGuild = await interaction.client.guilds.fetch(GUILD_ID);
    } catch (error) {
        console.error(`Error fetching target guild (${GUILD_ID}):`, error);
        return interaction.editReply({ content: '❌ Could not fetch the main guild to find unverified users. Please check the GUILD_ID environment variable.' });
    }

    let members;
    try {
        members = await targetGuild.members.fetch();
    } catch (error) {
        console.error(`Error fetching members for guild ${GUILD_ID}:`, error);
        return interaction.editReply({ content: '❌ Could not fetch members from the main guild. Please ensure the bot has the "Guild Members Intent" enabled and sufficient permissions.' });
    }

    let unverifiedMembers = members.filter(member =>
        !member.user.bot &&
        !member.roles.cache.has(VERIFIED_ROLE_ID)
    );

    if (targetUser) {
        const specificUnverifiedMember = unverifiedMembers.find(member => member.user.id === targetUser.id);
        if (specificUnverifiedMember) {
            unverifiedMembers = new Map([[specificUnverifiedMember.id, specificUnverifiedMember]]);
            console.log(`[RemindVerify] Testing mode: Targeting only user ${targetUser.tag} (${targetUser.id}).`);
        } else {
            return interaction.editReply({ content: `⚠️ User ${targetUser.tag} is either a bot, already verified, or not found in the main guild. Cannot send reminder.` });
        }
    }


    if (unverifiedMembers.size === 0) {
        return interaction.editReply({ content: '✅ No unverified members found in the server at this time.' });
    }

    let sentCount = 0;
    let failedCount = 0;
    const failedUsers = [];

    const reminderEmbed = new EmbedBuilder()
        .setColor('#FFA500')
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

    const verifyButton = new ButtonBuilder()
        .setCustomId(`verify_start_button`)
        .setLabel('Verify Your Account')
        .setStyle(ButtonStyle.Primary);
    const actionRow = new ActionRowBuilder().addComponents(verifyButton);

    for (const member of unverifiedMembers.values()) {
        try {
            await member.send({ embeds: [reminderEmbed], components: [actionRow] });
            sentCount++;
            console.log(`[DM Sent] Sent verification reminder to ${member.user.tag} (${member.user.id}).`);
        } catch (error) {
            console.warn(`[DM Failed] Failed to send verification reminder DM to ${member.user.tag} (${member.user.id}):`, error.message);
            failedCount++;
            failedUsers.push(member.user.tag);
        }
        await new Promise(resolve => setTimeout(resolve, DM_SEND_DELAY_MS));
    }

    let replyContent = `✅ Sent **${sentCount}** verification reminders.`;
    if (failedCount > 0) {
        replyContent += `\n❌ Failed to send **${failedCount}** reminders (users might have DMs disabled or blocked the bot). Failed users: ${failedUsers.slice(0, 5).join(', ')}${failedUsers.length > 5 ? '...' : ''}`;
    }

    await interaction.editReply({ content: replyContent });

    const NOTICE_ADMIN_CHANNEL_ID = process.env.NOTICE_ADMIN_CHANNEL_ID;
    if (NOTICE_ADMIN_CHANNEL_ID && NOTICE_ADMIN_CHANNEL_ID !== 'YOUR_NOTICE_ADMIN_CHANNEL_ID_HERE') {
        try {
            const adminLogChannel = await interaction.client.channels.fetch(NOTICE_ADMIN_CHANNEL_ID);
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