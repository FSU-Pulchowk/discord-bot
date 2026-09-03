import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionsBitField,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

export const data = new SlashCommandBuilder()
    .setName('remindverify')
    .setDescription('Sends a verification reminder to an unverified user in their DMs.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .addUserOption(option =>
        option.setName('target_user')
            .setDescription('The user to send a verification reminder to.')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('message')
            .setDescription('Optional custom message to include in the reminder.')
            .setRequired(false));

/**
 * Executes the /remindverify slash command.
 * Sends a single DM reminder to an explicitly selected unverified guild member.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
 */
export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({
            content: '❌ This command can only be used in a server.',
            flags: [MessageFlags.Ephemeral]
        });
    }

    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({
            content: '❌ You do not have permission to use this command.',
            flags: [MessageFlags.Ephemeral]
        });
    }

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;

    if (!VERIFIED_ROLE_ID || VERIFIED_ROLE_ID === 'YOUR_VERIFIED_ROLE_ID_HERE') {
        return interaction.editReply({
            content: '❌ Verification is not properly configured (VERIFIED_ROLE_ID is missing). Please contact an administrator.'
        });
    }

    const targetUser = interaction.options.getUser('target_user');
    const customMessage = interaction.options.getString('message');

    if (targetUser.bot) {
        return interaction.editReply({
            content: '❌ Cannot send a verification reminder to a bot.'
        });
    }

    let targetMember;
    try {
        targetMember = await interaction.guild.members.fetch(targetUser.id);
    } catch {
        targetMember = null;
    }

    if (!targetMember) {
        return interaction.editReply({
            content: `❌ User **${targetUser.tag}** is not a member of this server.`
        });
    }

    if (targetMember.roles.cache.has(VERIFIED_ROLE_ID)) {
        return interaction.editReply({
            content: `⚠️ User **${targetUser.tag}** is already verified.`
        });
    }

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
        .setCustomId(`verify_start_button_${targetMember.user.id}`)
        .setLabel('Verify Your Account')
        .setStyle(ButtonStyle.Primary);

    const actionRow = new ActionRowBuilder().addComponents(verifyButton);

    try {
        await targetMember.send({ embeds: [reminderEmbed], components: [actionRow] });
        return interaction.editReply({
            content: `✅ Verification reminder sent successfully to **${targetUser.tag}**.`
        });
    } catch (error) {
        console.warn(`[DM Failed] Could not send verification reminder DM to ${targetUser.tag} (${targetUser.id}):`, error.message);
        return interaction.editReply({
            content: `❌ Could not deliver DM to **${targetUser.tag}**. They may have direct messages disabled or have blocked the bot.`
        });
    }
}