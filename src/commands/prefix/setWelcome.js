import { EmbedBuilder, PermissionsBitField, ChannelType } from 'discord.js';
import { Command } from '../../utils/Command.js';

class SetWelcomeCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'setwelcome',
            description: 'Sets or disables a custom welcome message for new members.',
            permissions: [PermissionsBitField.Flags.Administrator, PermissionsBitField.Flags.ManageGuild],
            usage: '<"message"> [channel | "dm"] | disable',
            aliases: ['welcomeset', 'configwelcome'],
            dbInstance: options.dbInstance,
        });
    }

    async execute(message, args) {
        const guildId = message.guild.id;

        if (args[0] && args[0].toLowerCase() === 'disable') {
            this.db.run(`UPDATE guild_configs SET welcome_message_content = NULL, welcome_channel_id = NULL, send_welcome_as_dm = 0 WHERE guild_id = ?`, [guildId], function(err) {
                if (err) {
                    console.error('Error disabling welcome message:', err.message);
                    return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error disabling welcome message: ${err.message}`)] });
                }
                message.reply({ embeds: [new EmbedBuilder().setColor(this.changes > 0 ? '#00FF00' : '#FFC107').setDescription(this.changes > 0 ? '✅ Welcome message disabled.' : 'ℹ️ No welcome message was configured for this server.')] });
            });
            return;
        }

        const contentRegex = /"([^"]*)"/;
        const contentMatch = message.content.match(contentRegex);

        if (!contentMatch) {
            return this.sendUsage(message, `Set: \`"Welcome {user}!" #general\` or \`"Hi {user}!" "dm"\`\nDisable: \`disable\``);
        }

        const welcomeMessageContent = contentMatch[1];
        
        if (!welcomeMessageContent.includes('{user}')) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription('⚠️ Your welcome message must include the `{user}` placeholder to mention the new member.')] });
        }
        if (welcomeMessageContent.length > 1000) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription('⚠️ Welcome message is too long. Maximum 1000 characters.')] });
        }

        let channelId = null;
        let sendAsDm = 0;

        const remainingArgs = message.content.substring(contentMatch.index + contentMatch[0].length).trim();

        if (remainingArgs) {
            const mentionedChannel = message.mentions.channels.first();
            if (mentionedChannel) {
                if (mentionedChannel.type !== ChannelType.GuildText) {
                    return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription('❌ The mentioned channel must be a text channel.')] });
                }
                channelId = mentionedChannel.id;
            } else if (remainingArgs.toLowerCase() === 'dm' || remainingArgs.toLowerCase() === '"dm"') {
                sendAsDm = 1;
            } else {
                return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ Invalid target for welcome message. Please use a #channel or specify "dm".`)] });
            }
        } else {
            channelId = message.channel.id;
        }

        this.db.run(`INSERT OR REPLACE INTO guild_configs (guild_id, welcome_message_content, welcome_channel_id, send_welcome_as_dm) VALUES (?, ?, ?, ?)`,
            [guildId, welcomeMessageContent, channelId, sendAsDm], (err) => {
                if (err) {
                    console.error('Error setting welcome message:', err.message);
                    return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An error occurred while setting the welcome message: ${err.message}`)] });
                }
                let responseMessage;
                if (sendAsDm) {
                    responseMessage = `✅ Welcome DM set: \`\`\`${welcomeMessageContent}\`\`\``;
                } else {
                    responseMessage = `✅ Welcome for <#${channelId}> set: \`\`\`${welcomeMessageContent}\`\`\``;
                }
                message.reply({ embeds: [new EmbedBuilder().setColor('#00FF00').setDescription(responseMessage)] });
            }
        );
    }
}

export { SetWelcomeCommand };