// src/commands/prefix/help.js
import { Command } from '../../utils/Command.js';
import { EmbedBuilder } from 'discord.js';

export class HelpCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'help',
            description: 'Displays a list of all available commands or information about a specific command.',
            usage: '!help [command_name]',
            aliases: ['h', 'commands'],
            dbInstance: options.dbInstance
        });
    }

    async execute(message, args) {
        const prefix = this.client.PREFIX;

        if (args.length === 0) {
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('� FSU Pulchowk Bot Commands')
                .setDescription(`My prefix is \`${prefix}\`.\nUse \`${prefix}help [command_name]\` for more info on a specific command.`)
                .setThumbnail(this.client.user.displayAvatarURL()) // Use this.client
                .setTimestamp()
                .setFooter({ text: 'Developed for FSU Pulchowk Campus' });

            const generalCommands = [
                '`!help` - Displays this help message.',
                '`!mystats` - Shows your message and voice activity statistics.',
                '`!topchatters` - Shows the top 10 message senders.',
                '`!topvoice` - Shows the top 10 voice chatters.',
                '`!links` - Provides useful links related to the campus/FSU.',
                '`!news` - Fetches the latest notices from IOE and Pulchowk Campus.',
                '`!holidays` - Lists upcoming holidays from the configured Google Calendar.',
                '`!suggest` - Submit a suggestion for the server.'
            ].join('\n');

            const utilityCommands = [
                '`!setbirthday` - Sets your birthday for announcements.',
                '`!removebirthday` - Removes your birthday.',
                '`!getfaq` - Retrieves an FAQ by its ID or a search term.'
            ].join('\n');
            
            const adminSetupConfig = [
                '`!setupfsu` - Sets up a basic FSU server structure (roles, categories, channels).',
                '`!setreactionrole` - Sets up a reaction role on a message.',
                '`!removereactionrole` - Removes a reaction role configuration.',
                '`!setwelcome` - Sets or disables a custom welcome message for new members.',
                '`!setantispam` - Configures anti-spam settings.',
                '`!viewantispam` - Displays current anti-spam settings.',
            ].join('\n');

            const adminTasksFaq = [
                '`!addfaq` - Adds a new Frequently Asked Question to the knowledge base.',
                '`!removefaq` - Removes an FAQ by its ID.',
                '`!addtask` - Adds a new administrative task to the to-do list.',
                '`!completetask` - Marks an administrative task as completed.',
                '`!listtasks` - Lists admin tasks, filterable by status.',
            ].join('\n');

            const moderationCommands = [
                '`!assignrole` - Assigns a role to a user.',
                '`!removerole` - Removes a role from a user.',
                '`!allroles` - Lists all roles in the server with their IDs.',
                '`!ban` - Bans a member from the server.',
                '`!kick` - Kicks a member from the server.',
                '`!timeout` - Times out (mutes) a member for a duration.',
                '`!warn` - Warns a member.',
            ].join('\n');

            const suggestionModeration = [
                '`!listsuggestions` - Lists suggestions, filterable by status.',
                '`!approvesuggestion` - Approves a suggestion by its ID.',
                '`!denysuggestion` - Denies a suggestion by its ID.',
                '`!nuke` - Deletes all channels and roles. EXTREME CAUTION! (Server Owner Only)',
                '`!gotverified` - Displays a list of verified users with their real names and college email addresses.',
            ].join('\n');

            const verificationCommands = [
                '`/verify` - Initiates the verification process with your college email. (Slash Command)',
                '`/confirmotp` - Confirms your OTP to complete verification. (Slash Command)'
            ].join('\n');

            embed.addFields(
                { name: '✨ General Commands', value: generalCommands, inline: false },
                { name: '🛠️ Utility Commands', value: utilityCommands, inline: false },
                { name: '⚙️ Admin Setup & Config', value: adminSetupConfig, inline: false },
                { name: '📝 Admin Tasks & FAQs', value: adminTasksFaq, inline: false },
                { name: '🛡️ Moderation Commands', value: moderationCommands, inline: false },
                { name: '💡 Suggestion & Advanced Tools', value: suggestionModeration, inline: false },
                { name: '✅ Verification Commands', value: verificationCommands, inline: false }
            );

            await message.channel.send({ embeds: [embed] });

        } else {
            const commandName = args[0].toLowerCase();
            const command = this.client.prefixCommands.find(cmd =>
                cmd.name === commandName || (cmd.aliases && cmd.aliases.includes(commandName))
            );

            if (!command) {
                return message.reply(`❌ Command \`${commandName}\` not found.`);
            }

            const commandEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`Command: ${prefix}${command.name}`)
                .setDescription(command.description || 'No description provided.')
                .addFields(
                    { name: 'Usage', value: `\`${command.usage || `${prefix}${command.name}`}\``, inline: true }
                )
                .setTimestamp();

            if (command.aliases && command.aliases.length > 0) {
                commandEmbed.addFields({ name: 'Aliases', value: `\`${command.aliases.join(', ')}\``, inline: true });
            }

            if (command.permissions && command.permissions.length > 0) {
                commandEmbed.addFields({
                    name: 'Required Permissions',
                    value: command.permissions.map(p => `\`${p}\``).join(', '),
                    inline: false
                });
            }

            await message.channel.send({ embeds: [commandEmbed] });
        }
    }
}
