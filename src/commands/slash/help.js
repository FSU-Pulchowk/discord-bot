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
        .setTimestamp();

    if (!commandName) {
        helpEmbed
            .setTitle('FSU Pulchowk Bot Commands')
            .setDescription(`My prefix is \`${prefix}\`.\nUse \`${prefix}help [command_name]\` for more info on a specific command.`)
            .setThumbnail(interaction.client.user.displayAvatarURL())
            .setFooter({ text: 'Developed for FSU Pulchowk Campus' });
        const commands = interaction.client.commands;

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
            const cmdUsage = cmd.data.options.length > 0 ? cmd.data.options.map(opt => `<${opt.name}>`).join(' ') : '';
            const cmdLine = `\`/${cmdName} ${cmdUsage}\` - ${cmdDescription}`;

            if (['help', 'mystats', 'topchatters', 'topvoice', 'links', 'news', 'holidays', 'suggest'].includes(cmdName)) {
                generalCommands.push(cmdLine);
            } else if (['setbirthday', 'removebirthday', 'getfaq'].includes(cmdName)) {
                utilityCommands.push(cmdLine);
            } else if (['setupfsu', 'setreactionrole', 'removereactionrole', 'setwelcome', 'setantispam', 'viewantispam'].includes(cmdName)) {
                adminSetupConfig.push(cmdLine);
            } else if (['addfaq', 'removefaq', 'addtask', 'completetask', 'listtasks'].includes(cmdName)) {
                adminTasksFaq.push(cmdLine);
            } else if (['assignrole', 'removerole', 'allroles', 'ban', 'kick', 'timeout', 'warn'].includes(cmdName)) {
                moderationCommands.push(cmdLine);
            } else if (['listsuggestions', 'approvesuggestion', 'denysuggestion', 'nuke', 'gotverified'].includes(cmdName)) {
                suggestionModeration.push(cmdLine);
            } else if (['verify', 'confirmotp'].includes(cmdName)) {
                verificationCommands.push(cmdLine);
            }
        });

        if (generalCommands.length > 0) helpEmbed.addFields({ name: '✨ General Commands', value: generalCommands.join('\n'), inline: false });
        if (utilityCommands.length > 0) helpEmbed.addFields({ name: '🛠️ Utility Commands', value: utilityCommands.join('\n'), inline: false });
        if (adminSetupConfig.length > 0) helpEmbed.addFields({ name: '⚙️ Admin Setup & Config', value: adminSetupConfig.join('\n'), inline: false });
        if (adminTasksFaq.length > 0) helpEmbed.addFields({ name: '📝 Admin Tasks & FAQs', value: adminTasksFaq.join('\n'), inline: false });
        if (moderationCommands.length > 0) helpEmbed.addFields({ name: '🛡️ Moderation Commands', value: moderationCommands.join('\n'), inline: false });
        if (suggestionModeration.length > 0) helpEmbed.addFields({ name: '💡 Suggestion & Advanced Tools', value: suggestionModeration.join('\n'), inline: false });
        if (verificationCommands.length > 0) helpEmbed.addFields({ name: '✅ Verification Commands', value: verificationCommands.join('\n'), inline: false });

        await interaction.reply({ embeds: [helpEmbed], ephemeral: true });

    } else {
        const command = interaction.client.commands.get(commandName.toLowerCase());

        if (!command) {
            return interaction.reply({ content: `❌ Command \`${commandName}\` not found.`, ephemeral: true });
        }

        helpEmbed
            .setTitle(`Command: ${prefix}${command.data.name}`)
            .setDescription(command.data.description || 'No description provided.')
            .addFields(
                { name: 'Usage', value: `\`${prefix}${command.data.name} ${command.data.options.map(opt => `<${opt.name}>`).join(' ')}\``, inline: true }
            );

        if (command.data.options.length > 0) {
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
