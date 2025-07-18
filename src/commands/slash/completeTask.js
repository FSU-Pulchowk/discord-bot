import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('completetask')
    .setDescription('Marks an administrative task as completed.')
    .addIntegerOption(option =>
        option.setName('task_id')
            .setDescription('The ID of the task to mark as completed')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator);
export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const taskId = interaction.options.getInteger('task_id');
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;

    const db = interaction.client.db;

    db.get(`SELECT * FROM admin_tasks WHERE id = ? AND guildId = ?`, [taskId, guildId], async (err, row) => {
        if (err) {
            console.error('Error fetching task:', err.message);
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error checking task: ${err.message}`)], ephemeral: true });
        }
        if (!row) return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ Task ID **#${taskId}** not found.`)], ephemeral: true });
        if (row.status === 'completed') return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`⚠️ Task **#${taskId}** is already completed.`)], ephemeral: true });

        db.run(`UPDATE admin_tasks SET status = 'completed', completedAt = ?, completedBy = ? WHERE id = ?`,
            [Date.now(), userId, taskId],
            (updateErr) => {
                if (updateErr) {
                    console.error('Error updating task:', updateErr.message);
                    return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error completing task: ${updateErr.message}`)], ephemeral: true });
                }
                const embed = new EmbedBuilder().setColor('#00FF00').setTitle('✅ Task Completed').setDescription(`Task **#${taskId}**: \`${row.taskDescription}\` marked completed by ${interaction.user.tag}.`).setTimestamp();
                interaction.reply({ embeds: [embed] }); 
            }
        );
    });
}