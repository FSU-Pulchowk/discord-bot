import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('help')
    .setDescription('Displays a list of all available commands or information about a specific command.')
    .addStringOption(option =>
        option.setName('command_name')
            .setDescription('The name of the command to get more info about')
            .setRequired(false))
    .setDMPermission(true);

export async function execute(interaction) {
    const commandName = interaction.options.getString('command_name');
    const prefix = '/';

    const helpEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTimestamp()
        .setFooter({ text: 'Developed for FSU Pulchowk Campus' });

    if (!commandName) {
        helpEmbed
            .setTitle('FSU Pulchowk Bot Commands')
            .setDescription(`My prefix is \`${prefix}\`.\nUse \`${prefix}help [command_name]\` for more info on a specific command.`)
            .setThumbnail(interaction.client.user.displayAvatarURL());
        
        const commands = interaction.client.commands;

        const isModerator = interaction.member?.permissions.has(PermissionsBitField.Flags.KickMembers) || false;
        const isAdmin = interaction.member?.permissions.has(PermissionsBitField.Flags.BanMembers) || interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator) || false;

        const generalCommands = [];
        const utilityCommands = [];
        const adminSetupConfig = [];
        const adminTasksFaq = [];
        const moderationCommands = [];
        const suggestionModeration = [];
        const verificationCommands = [];

        commands.forEach(cmd => {
            const cmdName = cmd.data.name;
            const cmdDescription = cmd.data.description;
            const cmdLine = `\`/${cmdName}\` - ${cmdDescription}`;

            if (['help', 'mystats', 'topchatters', 'topvoice', 'links', 'news', 'holidays', 'suggest'].includes(cmdName)) {
                generalCommands.push(cmdLine);
            } 
            else if (['setbirthday', 'removebirthday', 'getfaq'].includes(cmdName)) {
                utilityCommands.push(cmdLine);
            } 
            else if (['verify', 'confirmotp'].includes(cmdName)) {
                verificationCommands.push(cmdLine);
            }
            else if (['setupfsu', 'setreactionrole', 'removereactionrole', 'setwelcome', 'setantispam', 'viewantispam'].includes(cmdName)) {
                if (isModerator || isAdmin) {
                    adminSetupConfig.push(cmdLine);
                }
            } 
            else if (['addfaq', 'removefaq', 'addtask', 'completetask', 'listtasks'].includes(cmdName)) {
                if (isModerator || isAdmin) {
                    adminTasksFaq.push(cmdLine);
                }
            }
            else if (['assignrole', 'removerole', 'allroles', 'timeout', 'warn', 'kick', 'ban'].includes(cmdName)) {
                if (isModerator || isAdmin) {
                    moderationCommands.push(cmdLine);
                }
            }
            else if (['listsuggestions', 'approvesuggestion', 'denysuggestion', 'nuke', 'gotverified'].includes(cmdName)) {
                if (isModerator || isAdmin) {
                    suggestionModeration.push(cmdLine);
                }
            }
        });

        if (generalCommands.length > 0) helpEmbed.addFields({ name: '✨ General Commands', value: generalCommands.sort().join('\n'), inline: false });
        if (utilityCommands.length > 0) helpEmbed.addFields({ name: '🛠️ Utility Commands', value: utilityCommands.sort().join('\n'), inline: false });
        if (verificationCommands.length > 0) helpEmbed.addFields({ name: '✅ Verification Commands', value: verificationCommands.sort().join('\n'), inline: false });
        if (adminSetupConfig.length > 0) helpEmbed.addFields({ name: '⚙️ Setup & Configuration (Moderator/Admin Only)', value: adminSetupConfig.sort().join('\n'), inline: false }); 
        if (adminTasksFaq.length > 0) helpEmbed.addFields({ name: '📝 Admin Tasks & FAQs (Moderator/Admin Only)', value: adminTasksFaq.sort().join('\n'), inline: false }); 
        if (moderationCommands.length > 0) helpEmbed.addFields({ name: '🛡️ Moderation Commands (Moderator/Admin Only)', value: moderationCommands.sort().join('\n'), inline: false }); 
        if (suggestionModeration.length > 0) helpEmbed.addFields({ name: '💡 Suggestion & Advanced Tools (Moderator/Admin Only)', value: suggestionModeration.sort().join('\n'), inline: false }); 

        await interaction.reply({ embeds: [helpEmbed], ephemeral: true });

    } else {
        const command = interaction.client.commands.get(commandName.toLowerCase());

        if (!command) {
            return interaction.reply({ content: `❌ Command \`${commandName}\` not found.`, ephemeral: true });
        }

        helpEmbed
            .setTitle(`Command: ${prefix}${command.data.name}`)
            .setDescription(command.data.description || 'No description provided.');

        let usageValue = `\`${prefix}${command.data.name}`;
        if (command.data.options && command.data.options.length > 0) {
            usageValue += ` ${command.data.options.map(opt => `<${opt.name}>`).join(' ')}`;
        }
        usageValue += '`';
        helpEmbed.addFields({ name: 'Usage', value: usageValue, inline: false });

        if (command.data.options && command.data.options.length > 0) {
            const optionsDescription = command.data.options.map(opt => {
                let desc = `\`${opt.name}\`: ${opt.description}`;
                if (opt.required) desc += ' (Required)';
                return desc;
            }).join('\n');
            helpEmbed.addFields({ name: 'Options', value: optionsDescription, inline: false });
        }
        await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
    }
}