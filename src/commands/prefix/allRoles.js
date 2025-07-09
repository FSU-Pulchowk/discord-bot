import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { Command } from '../../utils/Command.js';

class AllRolesCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'allroles',
            description: 'Lists all roles in the server with their IDs.',
            permissions: [PermissionsBitField.Flags.ManageRoles, PermissionsBitField.Flags.Administrator],
            usage: '',
            dbInstance: options.dbInstance,
        });
    }

    async execute(message, args) {
        const allServerRoles = message.guild.roles.cache
            .filter(role => role.id !== message.guild.id && !role.managed)
            .sort((a, b) => b.position - a.position) 
            .map(role => `${role.name} (ID: ${role.id})`);

        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle(`All Roles in ${message.guild.name}`)
            .setDescription(allServerRoles.length > 0 ? allServerRoles.join('\n') : 'No custom roles found.')
            .setTimestamp();

        message.reply({ embeds: [embed] });
    }
}

export { AllRolesCommand };