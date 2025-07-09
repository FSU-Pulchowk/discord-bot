import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { Command } from '../../utils/Command.js';

class GotVerifiedCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'gotverified',
            description: 'Displays a list of verified users with their real names and college email addresses.',
            permissions: [PermissionsBitField.Flags.Administrator, PermissionsBitField.Flags.ManageGuild], // Restricted to admins/guild managers
            usage: '',
            dbInstance: options.dbInstance,
            aliases: ['listverified', 'verifiedusers'],
        });
    }

    async execute(message, args) {
        if (!message.guild) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ This command can only be used in a server.')] });
        }

        this.db.all(`SELECT user_id, real_name, email FROM verified_users WHERE guild_id = ? ORDER BY real_name ASC`,
            [message.guild.id],
            async (err, rows) => {
                if (err) {
                    console.error('Error fetching verified users:', err.message);
                    return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error fetching verified users: ${err.message}`)] });
                }

                const embed = new EmbedBuilder()
                    .setColor('#0099ff') // Blue
                    .setTitle(`✅ Verified Users in ${message.guild.name}`)
                    .setTimestamp()
                    .setFooter({ text: `Total Verified Users: ${rows.length}` });

                if (rows.length === 0) {
                    embed.setDescription('No users have been verified in this server yet.');
                } else {
                    let description = '';
                    const MAX_DESCRIPTION_LENGTH = 3800;

                    for (const row of rows) {
                        let userTag = `ID: ${row.user_id}`;
                        try {
                            const user = await this.client.users.fetch(row.user_id);
                            userTag = user.tag;
                        } catch (fetchErr) {
                            console.warn(`Could not fetch Discord user for ID ${row.user_id}:`, fetchErr.message);
                        }

                        const line = `**${row.real_name}** (${userTag}) - \`${row.email}\`\n`;
                        if (description.length + line.length > MAX_DESCRIPTION_LENGTH) {
                            description += `\n...and ${rows.length - rows.indexOf(row)} more.`;
                            break;
                        }
                        description += line;
                    }
                    embed.setDescription(description);
                }
                message.reply({ embeds: [embed] });
            }
        );
    }
}

export { GotVerifiedCommand };