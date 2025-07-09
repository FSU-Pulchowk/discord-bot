import { Collection, EmbedBuilder } from 'discord.js';
import { Command } from './Command.js'; // Base Command class
import dotenv from 'dotenv'; // Import dotenv to access environment variables

dotenv.config(); // Load environment variables

/**
 * Manages the registration and execution of prefix-based commands.
 */
class CommandHandler {
    /**
     * @param {import('discord.js').Client} client - The Discord.js client instance.
     * @param {string} prefix - The bot's command prefix (e.g., '!' or '?').
     * @param {sqlite3.Database} dbInstance - The SQLite database instance.
     */
    constructor(client, prefix, dbInstance) {
        if (!client) throw new Error("Client must be provided to CommandHandler.");
        if (!prefix) throw new Error("Prefix must be provided to CommandHandler.");
        if (!dbInstance) console.warn("CommandHandler initialized without a dbInstance. DB commands might fail.");

        this.client = client;
        this.client.PREFIX = prefix;
        this.commands = new Collection();
        this.db = dbInstance;
        this.client.prefixCommands = this.commands;


        this.verifiedRoleId = process.env.VERIFIED_ROLE_ID;
        if (!this.verifiedRoleId || this.verifiedRoleId === 'YOUR_VERIFIED_ROLE_ID_HERE') {
            console.warn("VERIFIED_ROLE_ID is not configured in .env. Verification-gated commands will not function correctly.");
        }


        this.verifiedOnlyCommands = new Set([
            'suggest',
            'setbirthday',
            'removebirthday',
            'news',
            'holidays',
            'topchatters',
            'topvoice'
        ]);
    }

    /**
     * Registers a single command class.
     * @param {typeof Command} CommandClass - The command class to register.
     */
    registerCommand(CommandClass) {
        try {

            const commandInstance = new CommandClass(this.client, { dbInstance: this.db });
            if (!(commandInstance instanceof Command)) {
                console.warn(`[WARNING] Attempted to register a non-Command class: ${CommandClass.name}`);
                return;
            }
            if (this.commands.has(commandInstance.name)) {
                console.warn(`[WARNING] Command "${commandInstance.name}" re-registered. Overwriting.`);
            }
            this.commands.set(commandInstance.name, commandInstance);
            console.log(`[CommandHandler] Registered prefix command: ${commandInstance.name}`);
        } catch (error) {
            console.error(`[CommandHandler] Failed to register command ${CommandClass.name || 'Unnamed'}:`, error);
        }
    }

    /**
     * Registers multiple command classes.
     * @param {Array<typeof Command>} commandClasses - An array of command classes to register.
     */
    registerCommands(commandClasses) {
        commandClasses.forEach(CommandClass => this.registerCommand(CommandClass));
    }

    /**
     * Handles incoming messages, checking for command prefixes and executing commands.
     * @param {import('discord.js').Message} message - The message object.
     */
    async handleMessage(message) {

        if (message.author.bot || !message.guild || !message.content.startsWith(this.client.PREFIX)) {
            return;
        }

        const args = message.content.slice(this.client.PREFIX.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();


        const command = this.commands.get(commandName) || this.commands.find(cmd => cmd.aliases && cmd.aliases.includes(commandName));

        if (!command) return; 



        if (this.verifiedOnlyCommands.has(command.name) || (command.aliases && command.aliases.some(alias => this.verifiedOnlyCommands.has(alias)))) {
            if (!this.verifiedRoleId || this.verifiedRoleId === 'YOUR_VERIFIED_ROLE_ID_HERE') {
                console.warn(`[CommandHandler] VERIFIED_ROLE_ID not configured. Cannot enforce verification for command: ${command.name}.`);
            } else if (!message.member.roles.cache.has(this.verifiedRoleId)) {
                const embed = new EmbedBuilder()
                    .setColor('#FFC107')
                    .setDescription(`🔒 You need to be **verified** to use the \`${this.client.PREFIX}${command.name}\` command. Please use \`/verify\` to get started.`);
                return message.reply({ embeds: [embed], ephemeral: true }).catch(console.error); // ephemeral if possible, otherwise public
            }
        }

        if (!command.hasPermission(message)) {
            return command.sendPermissionError(message);
        }

        try {
            await command.execute(message, args);
        } catch (error) {
            console.error(`[CommandHandler] Error executing prefix command "${command.name}":`, error);
            message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setTitle('Command Error').setDescription(`An error occurred while executing this command: \`${error.message}\``)] }).catch(console.error);
        }
    }

    /**
     * Handles button interactions for commands that have them (e.g., Nuke, SetupFSU).
     * This is separate from slash command interaction handling.
     * @param {import('discord.js').Interaction} interaction - The interaction object.
     */
    async handleButtonInteraction(interaction) {
        if (!interaction.isButton()) return;

        let targetCommandName;
        if (interaction.customId.startsWith('confirm_nuke_') || interaction.customId.startsWith('cancel_nuke_')) {
            targetCommandName = 'nuke';
        } else if (interaction.customId.startsWith('confirm_setup_fsu') || interaction.customId.startsWith('cancel_setup_fsu')) {
            targetCommandName = 'setupfsu';
        } else {
            return;
        }

        const targetCommand = this.commands.get(targetCommandName);
        if (targetCommand && typeof targetCommand.handleButtonInteraction === 'function') {
            try {
                await targetCommand.handleButtonInteraction(interaction);
            } catch (error) {
                console.error(`[CommandHandler] Error handling button interaction for "${targetCommand.name}":`, error);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '❌ An error occurred while processing this button action.', ephemeral: true }).catch(console.error);
                }
            }
        }
    }
}

export { CommandHandler };