import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ChannelType } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('setwelcome')
    .setDescription('Sets or disables a custom welcome message for new members.')
    .addSubcommand(subcommand =>
        subcommand.setName('set')
            .setDescription('Sets a new welcome message.')
            .addStringOption(option =>
                option.setName('message_content')
                    .setDescription('The welcome message content. Use {user} for mention.')
                    .setRequired(true))
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('The channel to send the welcome message to (defaults to current channel)')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(false))
            .addBooleanOption(option =>
                option.setName('send_as_dm')
                    .setDescription('Whether to send the welcome message as a DM (overrides channel)')
                    .setRequired(false)))
    .addSubcommand(subcommand =>
        subcommand.setName('disable')
            .setDescription('Disables the custom welcome message.'))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild);

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const guildId = interaction.guild.id;
    const db = interaction.client.db;

    if (interaction.options.getSubcommand() === 'disable') {
        db.run(`UPDATE guild_configs SET welcome_message_content = NULL, welcome_channel_id = NULL, send_welcome_as_dm = 0 WHERE guild_id = ?`, [guildId], function(err) {
            if (err) {
                console.error('Error disabling welcome message:', err.message);
                return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error disabling welcome message: ${err.message}`)], ephemeral: true });
            }
            interaction.reply({ embeds: [new EmbedBuilder().setColor(this.changes > 0 ? '#00FF00' : '#FFC107').setDescription(this.changes > 0 ? '✅ Welcome message disabled.' : 'ℹ️ No welcome message was configured for this server.')], ephemeral: true });
        });
        return;
    }

    if (interaction.options.getSubcommand() === 'set') {
        const welcomeMessageContent = interaction.options.getString('message_content');
        const targetChannel = interaction.options.getChannel('channel');
        const sendAsDm = interaction.options.getBoolean('send_as_dm') || false;

        if (!welcomeMessageContent.includes('{user}')) {
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription('⚠️ Your welcome message must include the `{user}` placeholder to mention the new member.')], ephemeral: true });
        }
        if (welcomeMessageContent.length > 1000) {
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription('⚠️ Welcome message is too long. Maximum 1000 characters.')], ephemeral: true });
        }

        let channelId = null;
        if (!sendAsDm) {
            channelId = targetChannel ? targetChannel.id : interaction.channel.id;
        }

        db.run(`INSERT OR REPLACE INTO guild_configs (guild_id, welcome_message_content, welcome_channel_id, send_welcome_as_dm) VALUES (?, ?, ?, ?)`,
            [guildId, welcomeMessageContent, channelId, sendAsDm ? 1 : 0], (err) => {
                if (err) {
                    console.error('Error setting welcome message:', err.message);
                    return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An error occurred while setting the welcome message: ${err.message}`)], ephemeral: true });
                }
                let responseMessage;
                if (sendAsDm) {
                    responseMessage = `✅ Welcome DM set: \`\`\`${welcomeMessageContent}\`\`\``;
                } else {
                    responseMessage = `✅ Welcome for <#${channelId}> set: \`\`\`${welcomeMessageContent}\`\`\``;
                }
                interaction.reply({ embeds: [new EmbedBuilder().setColor('#00FF00').setDescription(responseMessage)] }); // Can be ephemeral or public
            }
        );
    }
}