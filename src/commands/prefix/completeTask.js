import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { Command } from '../../utils/Command.js';

class CompleteTaskCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'completetask',
            description: 'Marks an administrative task as completed.',
            permissions: [PermissionsBitField.Flags.Administrator],
            usage: '<task ID>',
            dbInstance: options.dbInstance,
        });
    }

    async execute(message, args) {
        const taskId = parseInt(args[0]);
        if (isNaN(taskId)) return this.sendUsage(message, 'Please provide a valid task ID.');

        this.db.get(`SELECT * FROM admin_tasks WHERE id = ? AND guildId = ?`, [taskId, message.guild.id], (err, row) => {
            if (err) {
                console.error('Error fetching task:', err.message);
                return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error checking task: ${err.message}`)] });
            }
            if (!row) return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ Task ID **#${taskId}** not found.`)] });
            if (row.status === 'completed') return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`⚠️ Task **#${taskId}** is already completed.`)] });

            this.db.run(`UPDATE admin_tasks SET status = 'completed', completedAt = ?, completedBy = ? WHERE id = ?`,
                [Date.now(), message.author.id, taskId],
                (updateErr) => {
                    if (updateErr) {
                        console.error('Error updating task:', updateErr.message);
                        return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error completing task: ${updateErr.message}`)] });
                    }
                    const embed = new EmbedBuilder().setColor('#00FF00').setTitle('✅ Task Completed').setDescription(`Task **#${taskId}**: \`${row.taskDescription}\` marked completed by ${message.author.tag}.`).setTimestamp();
                    message.reply({ embeds: [embed] });
                }
            );
        });
    }
}

export { CompleteTaskCommand };