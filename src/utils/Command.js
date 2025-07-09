import { EmbedBuilder, PermissionsBitField } from 'discord.js';

/**
 * Base class for all prefix-based bot commands.
 * Provides common properties and methods for command handling,
 * such as permission checking and usage messages.
 */
class Command {
    /**
     * @param {import('discord.js').Client} client - The Discord.js client instance.
     * @param {object} options - Command options.
     * @param {string} options.name - The name of the command (e.g., 'help').
     * @param {string} options.description - A brief description of the command.
     * @param {Array<string | bigint>} [options.permissions=[]] - Discord permissions required to use this command.
     * @param {string} [options.usage=''] - How to use the command (e.g., '<arg1> [arg2]').
     * @param {sqlite3.Database} [options.dbInstance=null] - The SQLite database instance.
     * @param {Array<string>} [options.aliases=[]] - Alternative names for the command.
     */
    constructor(client, { name, description, permissions = [], usage = '', dbInstance = null, aliases = [] }) {
        if (!client) throw new Error("Client must be provided to Command class.");
        if (!name) throw new Error("Command name must be provided.");
        if (!description) throw new Error("Command description must be provided.");

        this.client = client;
        this.name = name;
        this.description = description;
        this.permissions = permissions;
        this.usage = usage;
        this.db = dbInstance;
        this.aliases = aliases;
    }

    /**
     * The main execution logic for the command.
     * This method must be overridden by concrete command classes.
     * @param {import('discord.js').Message} message - The message that triggered the command.
     * @param {string[]} args - An array of arguments passed to the command.
     * @throws {Error} If not overridden.
     */
    async execute(message, args) {
        throw new Error(`Command ${this.name} does not have an execute() method.`);
    }

    /**
     * Checks if the message author has the required permissions for this command.
     * @param {import('discord.js').Message} message - The message to check permissions for.
     * @returns {boolean} True if the user has permissions, false otherwise.
     */
    hasPermission(message) {
        if (this.permissions.length === 0) return true; 
        if (!message.member) {
            console.warn(`Permissions check failed for ${this.name}: message.member is null (likely DM).`);
            return false;
        }
        return message.member.permissions.has(this.permissions, true);
    }

    /**
     * Sends an error message to the channel if the user lacks permissions.
     * @param {import('discord.js').Message} message - The message to reply to.
     * @returns {Promise<import('discord.js').Message>} The sent reply message.
     */
    sendPermissionError(message) {
        const requiredPerms = this.permissions
            .map(p => Object.keys(PermissionsBitField.Flags).find(key => PermissionsBitField.Flags[key] === p) || `Unknown Permission (${p})`)
            .map(name => name.replace(/([A-Z])/g, ' $1').trim())
            .join(' or ');
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setDescription(`❌ You need the following permissions to use this command: \`${requiredPerms}\`.`);
        return message.reply({ embeds: [embed] });
    }

    /**
     * Sends a usage message for the command.
     * @param {import('discord.js').Message} message - The message to reply to.
     * @param {string} [extraMessage=''] - Additional message to include in the usage embed.
     * @returns {Promise<import('discord.js').Message>} The sent reply message.
     */
    sendUsage(message, extraMessage = '') {
        const embed = new EmbedBuilder()
            .setColor('#FFC107')
            .setDescription(`Usage: \`${this.client.PREFIX}${this.name} ${this.usage}\`${extraMessage ? `\n${extraMessage}` : ''}`);
        return message.reply({ embeds: [embed] });
    }
}

export { Command };
