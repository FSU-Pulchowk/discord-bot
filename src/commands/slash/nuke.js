import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Collection } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('nuke')
    .setDescription('Deletes all channels and roles. EXTREME CAUTION! (Server Owner Only)')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator); // Only server owner can use it, but Discord requires some permission for visibility

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }
    if (interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ This command can only be used by the server owner.')], ephemeral: true });
    }

    const nukeEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('⚠️ SERVER NUKE CONFIRMATION ⚠️')
        .setDescription("**WARNING:** This command will delete **ALL** channels and roles in this server (except the channel this command is run in).\n\n**This action is IRREVERSIBLE.**\n\nAre you absolutely sure you want to proceed?")
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`confirm_nuke_${interaction.id}`) // Use interaction.id for unique customId
            .setLabel('Yes, Nuke It All')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`cancel_nuke_${interaction.id}`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({ embeds: [nukeEmbed], components: [row], ephemeral: true }); // Make initial confirmation ephemeral
}


/**
 * Updates the status message during the nuke process.
 * @param {import('discord.js').Interaction} interaction - The original interaction to follow up on.
 * @param {import('discord.js').Message} statusMessage - The message to update.
 * @param {string} statusText - The new status text.
 */
async function _updateNukeStatus(statusMessage, statusText) {
    const updatedEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('💣 Server Nuke Progress')
        .setDescription('Removing server components...')
        .addFields({ name: 'Status', value: statusText })
        .setTimestamp();
    await statusMessage.edit({ embeds: [updatedEmbed] }).catch(console.error);
}

/**
 * Contains the core logic for nuking the server.
 * This should be called by your main bot's interaction handler for the button.
 * @param {import('discord.js').ButtonInteraction} interaction - The button interaction that triggered the nuke.
 */
export async function _nukeServerLogic(interaction) {
    const guild = interaction.guild;
    const statusChannel = interaction.channel;

    if (!guild) {
        console.error('Nuke command executed outside a guild context.');
        return interaction.followUp({ content: '❌ This command can only be used in a server.', ephemeral: true }).catch(console.error);
    }

    try {
        const statusEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('💣 Server Nuke Progress')
            .setDescription('Initializing...')
            .addFields({ name: 'Status', value: 'Deleting channels...' })
            .setTimestamp();
        const statusMessage = await statusChannel.send({ embeds: [statusEmbed] });

        const allChannels = await guild.channels.fetch();
        for (const channel of [...allChannels.values()]) {
            if (channel.id !== statusChannel.id && channel.deletable) {
                try {
                    await channel.delete(`Server nuke command by ${interaction.user.tag}`);
                } catch (e) {
                    console.error(`Minor error deleting channel ${channel.name} (${channel.id}):`, e.message);
                }
            }
        }
        await _updateNukeStatus(statusMessage, 'Deleting roles...');

        const allRoles = await guild.roles.fetch();
        for (const role of [...allRoles.values()]) {
            if (role.name !== '@everyone' && !role.managed && role.editable) {
                try {
                    await role.delete(`Server nuke command by ${interaction.user.tag}`);
                } catch (e) {
                    console.error(`Minor error deleting role ${role.name} (${role.id}):`, e.message);
                }
            }
        }
        await _updateNukeStatus(statusMessage, '✅ Server nuke complete!');
        const successEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('💥 Server Nuke Complete!')
            .setDescription("All deletable channels and roles have been removed.\n\nTo rebuild a basic FSU server structure, use the `/setupfsu` command.")
            .setTimestamp();
        await statusChannel.send({ embeds: [successEmbed] });

    } catch (error) {
        console.error('Major error during server nuke:', error);
        await statusChannel.send(`❌ A major error occurred during the nuke process: ${error.message}`).catch(console.error);
    }
}