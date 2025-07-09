import { EmbedBuilder } from 'discord.js';
import { Command } from '../../utils/Command.js';

class RolesCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'roles',
            description: 'Lists roles of yourself or a mentioned user.',
            permissions: [], 
            usage: '[@user]',
            aliases: ['listroles', 'getroles'],
            dbInstance: options.dbInstance,
        });
    }

    async execute(message, args) {
        let user = message.mentions.members.first() || message.guild.members.cache.get(args[0]);

        if (!user && args[0]) {
            const query = args[0].toLowerCase();
            user = message.guild.members.cache.find(m =>
                m.user.username.toLowerCase() === query ||
                m.user.tag.toLowerCase() === query ||
                m.displayName.toLowerCase() === query
            );
        }
        if (!user) {
            user = message.member;
        }

        if (!user) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ User not found or could not determine target user.")] });
        }

        const roles = user.roles.cache
            .filter(role => role.id !== message.guild.id)
            .sort((a, b) => b.position - a.position)
            .map(role => role.name);

        const embed = new EmbedBuilder()
            .setColor('#0099ff') // Blue
            .setTitle(`Roles for ${user.user.tag}`)
            .setDescription(roles.length > 0 ? roles.join('\n') : 'No roles (besides @everyone).')
            .setThumbnail(user.user.displayAvatarURL({ dynamic: true })) // Get user's avatar
            .setTimestamp();
            
        message.reply({ embeds: [embed] });
    }
}

export { RolesCommand };