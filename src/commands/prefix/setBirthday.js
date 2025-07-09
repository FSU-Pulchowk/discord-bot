import { EmbedBuilder } from 'discord.js';
import { Command } from '../../utils/Command.js';

class SetBirthdayCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'setbirthday',
            description: 'Sets your birthday (MM/DD or MM/DD/YYYY) for announcements.',
            permissions: [],
            usage: '<MM/DD | MM/DD/YYYY>',
            aliases: ['mybirthday', 'birthdate'],
            dbInstance: options.dbInstance,
        });
    }

    async execute(message, args) {
        if (args.length === 0) return this.sendUsage(message, `Example: \`${this.client.PREFIX}setbirthday 01/15\` or \`05/20/2000\``);
        
        const dateString = args[0];
        const parts = dateString.split('/');
        
        if (parts.length < 2 || parts.length > 3) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ Invalid date format. Please use MM/DD or MM/DD/YYYY.`)] });
        }

        const month = parseInt(parts[0]);
        const day = parseInt(parts[1]);
        const year = parts.length === 3 ? parseInt(parts[2]) : null;

        if (isNaN(month) || month < 1 || month > 12) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ Invalid month. Month must be between 1 and 12.`)] });
        }
        if (isNaN(day) || day < 1 || day > 31) { // Simple check, not accounting for days in month
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ Invalid day. Day must be between 1 and 31.`)] });
        }
        if (year && (isNaN(year) || year < 1900 || year > new Date().getFullYear())) {
            return message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ Invalid year. Year must be a number between 1900 and the current year.`)] });
        }

        this.db.get(`SELECT 1 FROM birthdays WHERE user_id = ? AND guild_id = ?`, [message.author.id, message.guild.id], (err, existingRow) => {
            if (err) {
                console.error('Error checking birthday:', err.message);
                return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An error occurred while checking your birthday: ${err.message}`)] });
            }

            let sql, params, action;
            if (existingRow) {
                sql = `UPDATE birthdays SET month = ?, day = ?, year = ?, set_by = ?, created_at = ? WHERE user_id = ? AND guild_id = ?`;
                params = [month, day, year, message.author.id, Date.now(), message.author.id, message.guild.id];
                action = 'updated';
            } else {
                sql = `INSERT INTO birthdays (month, day, year, set_by, created_at, user_id, guild_id) VALUES (?, ?, ?, ?, ?, ?, ?)`;
                params = [month, day, year, message.author.id, Date.now(), message.author.id, message.guild.id];
                action = 'set';
            }

            this.db.run(sql, params, (runErr) => {
                if (runErr) {
                    console.error(`Error ${action} birthday:`, runErr.message);
                    return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An error occurred while ${action} your birthday: ${runErr.message}`)] });
                }
                const displayDate = `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}${year ? `/${year}` : ''}`;
                message.reply({ embeds: [new EmbedBuilder().setColor('#00FF00').setTitle(`🎉 Birthday ${action.charAt(0).toUpperCase() + action.slice(1)}!`).setDescription(`Your birthday has been ${action} to **${displayDate}**.`)] });
            });
        });
    }
}

export { SetBirthdayCommand };