import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { Command } from '../../utils/Command.js';

class AddTaskCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'addtask',
            description: 'Adds a new administrative task to the to-do list.',
            permissions: [PermissionsBitField.Flags.Administrator],
            usage: '<task description>',
            dbInstance: options.dbInstance,
        });
    }

    async execute(message, args) {
        const taskDescription = args.join(' ');
        if (!taskDescription) return this.sendUsage(message, 'Please provide a task description.');

        this.db.run(`INSERT INTO admin_tasks (guildId, creatorId, taskDescription, createdAt, status) VALUES (?, ?, ?, ?, ?)`,
            [message.guild.id, message.author.id, taskDescription, Date.now(), 'pending'],
            function(err) {
                if (err) {
                    console.error('Error inserting task:', err.message);
                    const embed = new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error adding task: ${err.message}`);
                    return message.reply({ embeds: [embed] });
                }
                const embed = new EmbedBuilder().setColor('#00FF00').setTitle('✅ Task Added').setDescription(`Task **#${this.lastID}**: \`${taskDescription}\``)
                    .addFields(
                        { name: 'Created By', value: message.author.tag, inline: true },
                        { name: 'Status', value: 'Pending', inline: true }
                    ).setTimestamp();
                message.reply({ embeds: [embed] });
            }
        );
    }
}

export { AddTaskCommand };