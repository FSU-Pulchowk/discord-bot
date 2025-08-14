import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('setbirthday')
    .setDescription('Sets your birthday (YYYY/MM/DD) for announcements.')
    .addStringOption(option =>
        option.setName('date')
            .setDescription('Your birthday in YYYY/MM/DD format (e.g. 05/20/2000 AD)')
            .setRequired(true))
    .setDMPermission(false); 

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    const dateString = interaction.options.getString('date');
    const parts = dateString.split('/');
    
    if (parts.length < 2 || parts.length > 3) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ Invalid date format. Please use MM/DD or MM/DD/YYYY.`)], ephemeral: true });
    }

    const month = parseInt(parts[1]);
    const day = parseInt(parts[2]);
    const year = parts.length === 3 ? parseInt(parts[0]) : null;

    if (isNaN(month) || month < 1 || month > 12) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ Invalid month. Month must be between 1 and 12.`)], ephemeral: true });
    }
    if (isNaN(day) || day < 1 || day > 31) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ Invalid day. Day must be between 1 and 31.`)], ephemeral: true });
    }
    if (year && (isNaN(year) || year < 1900 || year > new Date().getFullYear())) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ Invalid year. Year must be a number between 1900 and the current year.`)], ephemeral: true });
    }

    const userId = interaction.user.id;
    const guildId = interaction.guild.id;
    const db = interaction.client.db;

    db.get(`SELECT 1 FROM birthdays WHERE user_id = ? AND guild_id = ?`, [userId, guildId], (err, existingRow) => {
        if (err) {
            console.error('Error checking birthday:', err.message);
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An error occurred while checking your birthday: ${err.message}`)], ephemeral: true });
        }

        let sql, params, action;
        if (existingRow) {
            sql = `UPDATE birthdays SET month = ?, day = ?, year = ?, set_by = ?, created_at = ? WHERE user_id = ? AND guild_id = ?`;
            params = [month, day, year, userId, Date.now(), userId, guildId];
            action = 'updated';
        } else {
            sql = `INSERT INTO birthdays (month, day, year, set_by, created_at, user_id, guild_id) VALUES (?, ?, ?, ?, ?, ?, ?)`;
            params = [month, day, year, userId, Date.now(), userId, guildId];
            action = 'set';
        }

        db.run(sql, params, (runErr) => {
            if (runErr) {
                console.error(`Error ${action} birthday:`, runErr.message);
                return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An error occurred while ${action} your birthday: ${runErr.message}`)], ephemeral: true });
            }
            const displayDate = `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}${year ? `/${year}` : ''}`;
            interaction.reply({ embeds: [new EmbedBuilder().setColor('#00FF00').setTitle(`🎉 Birthday ${action.charAt(0).toUpperCase() + action.slice(1)}!`).setDescription(`Your birthday has been ${action} to **${displayDate}**.`)] }); // Can be ephemeral or public
        });
    });
}