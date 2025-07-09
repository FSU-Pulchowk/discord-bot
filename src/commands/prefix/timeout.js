import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { Command } from '../../utils/Command.js';

class TimeoutCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'timeout',
            description: 'Times out a user for a specified duration (e.g., 10m, 1h, 1d).',
            permissions: [PermissionsBitField.Flags.ModerateMembers],
            usage: '@user <duration> [reason]',
            aliases: ['mute', 'silence'],
            dbInstance: options.dbInstance, 
        });
    }

    async execute(message, args) {
        const targetUser = message.mentions.members.first();
        if (!targetUser) return this.sendUsage(message, `Example: \`${this.client.PREFIX}timeout @user 10m spamming\``);
        if (!args[1]) return this.sendUsage(message, 'Please provide a duration (e.g., 5s, 10m, 1h, 1d).');

        const durationString = args[1];
        let durationMs = 0;
        const match = durationString.match(/^(\d+)([smhd])$/i); // Regex to parse duration (e.g., 10s, 5m, 2h, 1d)

        if (!match) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription('❌ Invalid duration format. Use like `10s`, `5m`, `2h`, `1d`.')] });
        }

        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase();

        if (unit === 's') durationMs = value * 1000;
        else if (unit === 'm') durationMs = value * 60 * 1000;
        else if (unit === 'h') durationMs = value * 60 * 60 * 1000;
        else if (unit === 'd') durationMs = value * 24 * 60 * 60 * 1000;

        if (durationMs === 0 || durationMs > 28 * 24 * 60 * 60 * 1000) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription('❌ Duration must be between 1 second and 28 days.')] });
        }

        const reason = args.slice(2).join(' ') || 'No reason provided.';

        if (targetUser.id === message.author.id) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ You cannot timeout yourself.")] });
        }
        if (targetUser.id === this.client.user.id) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ I cannot timeout myself.")] });
        }
        if (targetUser.id === message.guild.ownerId) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ Cannot timeout the server owner.")] });
        }
        if (!targetUser.moderatable) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ I cannot timeout ${targetUser.user.tag} due to role hierarchy or insufficient permissions.`)] });
        }
        if (targetUser.roles.highest.position >= message.member.roles.highest.position && message.author.id !== message.guild.ownerId) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ You cannot timeout a user with a role equal to or higher than your own.")] });
        }

        try {
            await targetUser.timeout(durationMs, reason);
            message.reply({ embeds: [new EmbedBuilder().setColor('#00FF00').setDescription(`✅ Timed out ${targetUser.user.tag} for ${durationString}. Reason: ${reason}`)] });
        } catch (error) {
            console.error('Error timing out user:', error);
            message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An error occurred while timing out: ${error.message}`)] });
        }
    }
}

export { TimeoutCommand };