// src/commands/prefix/nuke.js
import { EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Collection } from 'discord.js'; 
import { Command } from '../../utils/Command.js';

class NukeCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'nuke',
            description: 'Deletes all channels and roles. EXTREME CAUTION! (Server Owner Only)',
            permissions: [],
            usage: '',
            dbInstance: options.dbInstance,
        });
    }

    /**
     * Executes the !nuke command.
     * Sends a confirmation message with buttons.
     * @param {import('discord.js').Message} message - The message that triggered the command.
     * @param {string[]} args - Command arguments (not used for nuke).
     */
    async execute(message, args) {
        if (message.author.id !== message.guild.ownerId) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ This command can only be used by the server owner.')] });
        }

        const nukeEmbed = new EmbedBuilder()
            .setColor('#FF0000') // Red for danger
            .setTitle('⚠️ SERVER NUKE CONFIRMATION ⚠️')
            .setDescription("**WARNING:** This command will delete **ALL** channels and roles in this server (except the channel this command is run in).\n\n**This action is IRREVERSIBLE.**\n\nAre you absolutely sure you want to proceed?")
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`confirm_nuke_${message.id}`)
                .setLabel('Yes, Nuke It All')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`cancel_nuke_${message.id}`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

        await message.reply({ embeds: [nukeEmbed], components: [row] });
    }

    /**
     * Handles button interactions specifically for the Nuke command.
     * This method is called by the main CommandHandler when a relevant button is pressed.
     * @param {import('discord.js').ButtonInteraction} interaction - The button interaction.
     */
    async handleButtonInteraction(interaction) {
        const originalMessageId = interaction.customId.split('_')[2];
        if (interaction.message.reference?.messageId !== originalMessageId) {
            return interaction.reply({ content: 'This confirmation is not for your command.', ephemeral: true });
        }

        if (interaction.user.id !== interaction.guild.ownerId) {
            return interaction.reply({ content: '❌ Only the server owner can confirm this action.', ephemeral: true });
        }

        if (interaction.customId.startsWith('confirm_nuke_')) {
            await interaction.update({ content: '💣 Beginning server nuke... This may take a moment.', components: [], embeds: [] });
            await this._nukeServerLogic(interaction);
        } else if (interaction.customId.startsWith('cancel_nuke_')) {
            await interaction.update({ content: '❌ Server nuke cancelled.', components: [], embeds: [] });
        }
    }
    
    /**
     * Updates the status message during the nuke process.
     * @param {import('discord.js').Message} statusMessage - The message to update.
     * @param {string} statusText - The new status text.
     */
    async _updateNukeStatus(statusMessage, statusText) {
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
     * @param {import('discord.js').ButtonInteraction} interaction - The button interaction that triggered the nuke.
     */
    async _nukeServerLogic(interaction) {
        const guild = interaction.guild;
        const statusChannel = interaction.channel; // The channel where the command was issued

        if (!guild) {
            console.error('Nuke command executed outside a guild context.');
            return statusChannel.send('❌ This command can only be used in a server.').catch(console.error);
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
            for (const channel of [...allChannels.values()]) { // Changed line
                if (channel.id !== statusChannel.id && channel.deletable) {
                    try {
                        await channel.delete(`Server nuke command by ${interaction.user.tag}`);
                    } catch (e) {
                        console.error(`Minor error deleting channel ${channel.name} (${channel.id}):`, e.message);
                    }
                }
            }
            await this._updateNukeStatus(statusMessage, 'Deleting roles...');

            const allRoles = await guild.roles.fetch();
            for (const role of [...allRoles.values()]) { // Changed line
                if (role.name !== '@everyone' && !role.managed && role.editable) { // Check if bot can edit/delete
                    try {
                        await role.delete(`Server nuke command by ${interaction.user.tag}`);
                    } catch (e) {
                        console.error(`Minor error deleting role ${role.name} (${role.id}):`, e.message);
                    }
                }
            }
            await this._updateNukeStatus(statusMessage, '✅ Server nuke complete!');
            const successEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('💥 Server Nuke Complete!')
                .setDescription("All deletable channels and roles have been removed.\n\nTo rebuild a basic FSU server structure, use the `!setupfsu` command.")
                .setTimestamp();
            await statusChannel.send({ embeds: [successEmbed] });

        } catch (error) {
            console.error('Major error during server nuke:', error);
            await statusChannel.send(`❌ A major error occurred during the nuke process: ${error.message}`).catch(console.error);
        }
    }
}

export { NukeCommand };