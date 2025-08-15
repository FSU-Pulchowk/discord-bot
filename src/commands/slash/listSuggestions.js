import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ChannelType } from 'discord.js';
export const data = new SlashCommandBuilder()
    .setName('listsuggestions')
    .setDescription('Lists suggestions, filterable by status.')
    .addStringOption(option =>
        option.setName('status')
            .setDescription('Filter suggestions by status')
            .setRequired(false)
            .addChoices(
                { name: 'Pending', value: 'pending' },
                { name: 'Approved', value: 'approved' },
                { name: 'Denied', value: 'denied' },
                { name: 'Implemented', value: 'implemented' },
                { name: 'All', value: 'all' }
            ))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild); 

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    let statusFilter = interaction.options.getString('status') || 'pending';
    let queryStatus = statusFilter; 
    if (statusFilter === 'all') {
        queryStatus = '%'; 
    } else if (!['pending', 'approved', 'denied', 'implemented'].includes(statusFilter)) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ Invalid status. Use `pending`, `approved`, `denied`, `implemented`, or `all`.")], ephemeral: true });
    }

    const db = interaction.client.db;
    const SUGGESTIONS_CHANNEL_ID = process.env.SUGGESTIONS_CHANNEL_ID || 'YOUR_SUGGESTIONS_CHANNEL_ID_HERE';

    const query = `SELECT * FROM suggestions WHERE guild_id = ? AND status LIKE ? ORDER BY submitted_at DESC`;
    db.all(query, [interaction.guild.id, queryStatus], async (err, rows) => {
        if (err) {
            console.error('Error fetching suggestions:', err.message);
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error fetching suggestions: ${err.message}`)], ephemeral: true });
        }

        const embedTitle = `💡 Suggestions (${statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)})`;
        const embed = new EmbedBuilder().setColor('#0099ff').setTitle(embedTitle).setTimestamp();
        
        if (rows.length === 0) {
            embed.setDescription(`No ${statusFilter} suggestions found for this server.`);
        } else {
            const suggestionFields = [];
            for (const row of rows) {
                if (suggestionFields.length >= 25) {
                    embed.setFooter({text: `Displaying first 25 of ${rows.length} suggestions. For more, refine your search.`});
                    break;
                }

                let suggesterTag = `ID: ${row.user_id}`;
                try {
                    const user = await interaction.client.users.fetch(row.user_id);
                    suggesterTag = user.tag;
                } catch (fetchErr) {
                    console.warn(`Could not fetch suggester user ${row.user_id}:`, fetchErr.message);
                }
                
                let reviewedByTag = '';
                if(row.reviewed_by) {
                    try {
                        const reviewer = await interaction.client.users.fetch(row.reviewed_by);
                        reviewedByTag = ` by ${reviewer.tag}`;
                    } catch (fetchErr) {
                        console.warn(`Could not fetch reviewer user ${row.reviewed_by}:`, fetchErr.message);
                    }
                }

                let fieldText = `"${row.suggestion_text}"\n` +
                               `> Suggested by: ${suggesterTag} on ${new Date(row.submitted_at).toLocaleDateString()}\n` +
                               `> Votes: 👍 ${row.upvotes || 0} / 👎 ${row.downvotes || 0}`;
                
                if (row.reviewed_at) {
                    fieldText += `\n> Reviewed${reviewedByTag} on ${new Date(row.reviewed_at).toLocaleDateString()}`;
                }
                if (row.reason && (row.status === 'approved' || row.status === 'denied')) {
                    fieldText += `\n> Reason: ${row.reason}`;
                }
                if (row.message_id && SUGGESTIONS_CHANNEL_ID !== 'YOUR_SUGGESTIONS_CHANNEL_ID_HERE') {
                    fieldText += `\n> [View Original Suggestion](https://discord.com/channels/${interaction.guild.id}/${SUGGESTIONS_CHANNEL_ID}/${row.message_id})`;
                }

                suggestionFields.push({
                    name: `Suggestion #${row.id} (Status: ${row.status.toUpperCase()})`,
                    value: fieldText.substring(0, 1020)
                });
            }
            embed.addFields(suggestionFields);
        }
        interaction.reply({ embeds: [embed] });
    });
}
