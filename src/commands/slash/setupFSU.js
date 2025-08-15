import { SlashCommandBuilder, PermissionsBitField, ChannelType, EmbedBuilder } from 'discord.js';
import { db } from '../../database.js';

// --- Database Interaction Helpers (Promisified) ---

/**
 * Saves the guild structure backup to the database.
 * @param {string} guildId - The ID of the guild.
 * @param {string} backupData - The JSON string of the backup.
 * @returns {Promise<void>}
 */
function saveBackupToDB(guildId, backupData) {
    const query = `
        INSERT OR REPLACE INTO guild_structure_backups (guild_id, backup_data, saved_at)
        VALUES (?, ?, ?)
    `;
    return new Promise((resolve, reject) => {
        db.run(query, [guildId, backupData, Math.floor(Date.now() / 1000)], (err) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

/**
 * Retrieves the latest guild structure backup from the database.
 * @param {string} guildId - The ID of the guild.
 * @returns {Promise<{backup_data: string, saved_at: number} | null>}
 */
function getBackupFromDB(guildId) {
    const query = 'SELECT backup_data, saved_at FROM guild_structure_backups WHERE guild_id = ?';
    return new Promise((resolve, reject) => {
        db.get(query, [guildId], (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}


// --- Command Definition ---

export const data = new SlashCommandBuilder()
    .setName('setupfsu')
    .setDescription('Manages FSU server structure backups.')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .addSubcommand(subcommand =>
        subcommand
        .setName('save')
        .setDescription('Saves the current server structure (roles and channels) to a backup.'))
    .addSubcommand(subcommand =>
        subcommand
        .setName('restore')
        .setDescription('Restores the server structure from the last backup. Skips existing items.'));

export async function execute(interaction) {
    // Ensure the command is used in a guild
    if (!interaction.inGuild()) {
        return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
    }

    // Defer reply to allow time for processing
    await interaction.deferReply({ ephemeral: true });

    const subcommand = interaction.options.getSubcommand();
    const guild = interaction.guild;

    try {
        if (subcommand === 'save') {
            await handleSave(interaction, guild);
        } else if (subcommand === 'restore') {
            await handleRestore(interaction, guild);
        }
    } catch (error) {
        console.error(`Error executing /setupfsu ${subcommand}:`, error);
        await interaction.editReply({ content: `An unexpected error occurred: ${error.message}` });
    }
}


// --- Subcommand Handlers ---

/**
 * Handles the logic for the "save" subcommand.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {import('discord.js').Guild} guild
 */
async function handleSave(interaction, guild) {
    const roles = (await guild.roles.fetch())
        .filter(role => role.id !== guild.id) // Exclude @everyone role
        .map(role => ({
            id: role.id,
            name: role.name,
            color: role.color,
            hoist: role.hoist,
            permissions: role.permissions.bitfield.toString(),
            position: role.position,
            mentionable: role.mentionable,
        }));

    const channels = (await guild.channels.fetch())
        .map(channel => ({
            id: channel.id,
            type: channel.type,
            name: channel.name,
            position: channel.position,
            parentId: channel.parentId,
            topic: 'topic' in channel ? channel.topic : null,
            permissionOverwrites: channel.permissionOverwrites.cache.map(ow => ({
                id: ow.id, 
                type: ow.type, 
                allow: ow.allow.bitfield.toString(),
                deny: ow.deny.bitfield.toString(),
            })),
        }));

    const backupData = {
        savedAt: Date.now(),
        guildId: guild.id,
        guildName: guild.name,
        roles,
        channels,
    };

    const jsonBackup = JSON.stringify(backupData, null, 2);

    await saveBackupToDB(guild.id, jsonBackup);

    const successEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ Backup Saved')
        .setDescription(`Successfully saved the structure of **${roles.length} roles** and **${channels.length} channels**.`)
        .setTimestamp();

    await interaction.editReply({ embeds: [successEmbed] });
}

/**
 * Handles the logic for the "restore" subcommand.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {import('discord.js').Guild} guild
 */
async function handleRestore(interaction, guild) {
    const backup = await getBackupFromDB(guild.id);
    if (!backup) {
        return interaction.editReply({ content: '❌ No backup found for this server. Please run `/setupfsu save` first.', ephemeral: true });
    }

    const backupData = JSON.parse(backup.backup_data);
    await interaction.editReply({ content: 'Restoring from backup... This may take a few minutes. Please wait.' });

    // --- Role Restoration ---
    const oldToNewRoleIdMap = new Map();
    const existingRoles = await guild.roles.fetch();

    for (const savedRole of backupData.roles.sort((a, b) => b.position - a.position)) {
        const existingRole = existingRoles.find(r => r.name === savedRole.name);
        if (existingRole) {
            oldToNewRoleIdMap.set(savedRole.id, existingRole.id); // Map old ID to existing role's ID
        } else {
            try {
                const newRole = await guild.roles.create({
                    name: savedRole.name,
                    color: savedRole.color,
                    hoist: savedRole.hoist,
                    permissions: BigInt(savedRole.permissions),
                    mentionable: savedRole.mentionable,
                    position: savedRole.position,
                    reason: 'Restored from FSU backup.',
                });
                oldToNewRoleIdMap.set(savedRole.id, newRole.id); // Map old ID to newly created role's ID
            } catch (err) {
                console.warn(`Could not create role "${savedRole.name}": ${err.message}`);
            }
        }
    }

    // --- Channel Restoration ---
    const oldToNewChannelIdMap = new Map();
    const existingChannels = await guild.channels.fetch();
    const sortedChannels = backupData.channels.sort((a, b) => a.position - b.position);

    // First pass: Create categories
    const categories = sortedChannels.filter(c => c.type === ChannelType.GuildCategory);
    for (const savedChannel of categories) {
        const existingChannel = existingChannels.find(c => c.name === savedChannel.name && c.type === savedChannel.type);
        if (existingChannel) {
            oldToNewChannelIdMap.set(savedChannel.id, existingChannel.id);
        } else {
            const newChannel = await createChannelFromBackup(guild, savedChannel, oldToNewRoleIdMap, null);
            if (newChannel) oldToNewChannelIdMap.set(savedChannel.id, newChannel.id);
        }
    }

    // Second pass: Create all other channels
    const otherChannels = sortedChannels.filter(c => c.type !== ChannelType.GuildCategory);
    for (const savedChannel of otherChannels) {
        const parentId = savedChannel.parentId ? oldToNewChannelIdMap.get(savedChannel.parentId) : null;
        const existingChannel = existingChannels.find(c => c.name === savedChannel.name && c.type === savedChannel.type && c.parentId === parentId);

        if (existingChannel) {
             oldToNewChannelIdMap.set(savedChannel.id, existingChannel.id);
        } else {
            const newChannel = await createChannelFromBackup(guild, savedChannel, oldToNewRoleIdMap, parentId);
            if (newChannel) oldToNewChannelIdMap.set(savedChannel.id, newChannel.id);
        }
    }
    
    // --- Final Positioning Pass ---
    for (const savedChannel of sortedChannels) {
        const newChannelId = oldToNewChannelIdMap.get(savedChannel.id);
        if (newChannelId) {
            const channelToPosition = guild.channels.cache.get(newChannelId);
            if (channelToPosition) {
                try {
                    await channelToPosition.setPosition(savedChannel.position);
                } catch (err) {
                    console.warn(`Could not set position for channel "${channelToPosition.name}": ${err.message}`);
                }
            }
        }
    }

    const successEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ Restore Complete')
        .setDescription('Server structure has been restored from the backup. Any roles or channels that already existed by name were skipped to avoid duplicates.')
        .setTimestamp();
    
    await interaction.editReply({ embeds: [successEmbed] });
}


/**
 * A helper function to create a channel from backup data.
 * @param {import('discord.js').Guild} guild
 * @param {object} savedChannel - The channel data from the backup JSON.
 * @param {Map<string, string>} roleIdMap - A map of old role IDs to new role IDs.
 * @param {string | null} newParentId - The ID of the new parent category, if any.
 * @returns {Promise<import('discord.js').GuildChannel | null>}
 */
async function createChannelFromBackup(guild, savedChannel, roleIdMap, newParentId) {
    // Remap permission overwrites to use the new role IDs
    const permissionOverwrites = savedChannel.permissionOverwrites.map(ow => {
        const newId = ow.type === 0 ? roleIdMap.get(ow.id) : ow.id; // type 0 is role, 1 is member
        if (!newId) return null; // If the role for this overwrite no longer exists, skip it
        return {
            id: newId,
            allow: BigInt(ow.allow),
            deny: BigInt(ow.deny),
        };
    }).filter(Boolean); // Remove any null entries

    try {
        const newChannel = await guild.channels.create({
            name: savedChannel.name,
            type: savedChannel.type,
            topic: savedChannel.topic,
            parent: newParentId,
            position: savedChannel.position,
            permissionOverwrites,
            reason: 'Restored from FSU backup.',
        });
        return newChannel;
    } catch (err) {
        console.warn(`Could not create channel "${savedChannel.name}": ${err.message}`);
        return null;
    }
}