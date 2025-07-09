import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { Command } from '../../utils/Command.js';

class WarnCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'warn',
            description: 'Warns a user and records it in the database.',
            permissions: [PermissionsBitField.Flags.KickMembers, PermissionsBitField.Flags.BanMembers], 
            usage: '@user [reason]',
            dbInstance: options.dbInstance,
        });
    }

    async execute(message, args) {
        const targetUser = message.mentions.members.first();
        if (!targetUser) return this.sendUsage(message, 'Please mention a user to warn.');
        const reason = args.slice(1).join(' ') || 'No reason provided.';

        if (targetUser.id === message.author.id) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ You cannot warn yourself.")] });
        }
        if (targetUser.id === this.client.user.id) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ I cannot be warned.")] });
        }
        if (targetUser.id === message.guild.ownerId) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ Cannot warn the server owner.")] });
        }
        if (targetUser.roles.highest.position >= message.member.roles.highest.position && message.author.id !== message.guild.ownerId) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ Cannot warn a user with a role equal to or higher than your own.")] });
        }

        this.db.run(`INSERT INTO warnings (userId, guildId, moderatorId, reason, timestamp) VALUES (?, ?, ?, ?, ?)`,
            [targetUser.id, message.guild.id, message.author.id, reason, Date.now()],
            function(err) {
                if (err) {
                    console.error('Error inserting warning into database:', err.message);
                    return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An error occurred while recording the warning: ${err.message}`)] });
                }
                const warningId = this.lastID; 
                const embed = new EmbedBuilder()
                    .setColor('#FFA500')
                    .setTitle('⚠️ User Warned')
                    .setDescription(`**${targetUser.user.tag}** has been warned.`)
                    .addFields(
                        { name: 'Moderator', value: message.author.tag, inline: true },
                        { name: 'Reason', value: reason, inline: true },
                        { name: 'Warning ID', value: warningId.toString(), inline: true }
                    )
                    .setTimestamp();
                
                message.reply({ embeds: [embed] });

                targetUser.send(`You have been warned in **${message.guild.name}** for: \`${reason}\`. Your warning ID is: \`${warningId}\`.\n\nRepeated warnings may lead to further moderation actions.`).catch(dmErr => {
                    console.warn(`Could not DM warning message to ${targetUser.user.tag}:`, dmErr.message);
                    message.channel.send(`⚠️ Could not DM warning to ${targetUser.user.tag}. They might have DMs disabled or I lack permissions.`).catch(e => console.error("Error sending DM failure message:", e));
                });
            }
        );
    }
}

export { WarnCommand };