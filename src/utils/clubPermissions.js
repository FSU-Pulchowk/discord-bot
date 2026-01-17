// src/utils/clubPermissions.js
import { PermissionsBitField } from 'discord.js';
import { db, isClubPresident, isClubModerator } from '../database.js';
import { log } from './debug.js';

/**
 * Server role IDs from environment variables
 * These roles have access to ALL channels including club channels
 */
const SERVER_PRIVILEGED_ROLES = {
    ADMIN: process.env.ADMIN_ROLE_ID || '1364069370543996969',
    MODERATOR: process.env.MODERATOR_ROLE_ID || '1364094348685479996',
    FSU_EXECUTIVE: process.env.FSU_EXECUTIVE_ROLE_ID || '1364094346835660850',
    FSU_BOT: process.env.FSU_BOT_ROLE_ID || '1402321439415341240'
};

/**
 * Check if user has server-level privileged role
 */
export function hasServerPrivilegedRole(member) {
    if (!member || !member.roles) return false;
    
    return member.roles.cache.some(role => 
        Object.values(SERVER_PRIVILEGED_ROLES).includes(role.id)
    );
}

/**
 * Check if user is a server administrator
 */
export function isServerAdmin(member) {
    if (!member) return false;
    
    // Check if has Admin permission
    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return true;
    }
    
    // Check if has Admin role
    return member.roles.cache.has(SERVER_PRIVILEGED_ROLES.ADMIN);
}

/**
 * Check if user is a server moderator
 */
export function isServerModerator(member) {
    if (!member) return false;
    
    // Admins are also moderators
    if (isServerAdmin(member)) return true;
    
    // Check if has Moderator or Executive role
    return member.roles.cache.has(SERVER_PRIVILEGED_ROLES.MODERATOR) ||
           member.roles.cache.has(SERVER_PRIVILEGED_ROLES.FSU_EXECUTIVE);
}

/**
 * Comprehensive permission checker for club operations
 * @param {Object} options - Permission check options
 * @param {GuildMember} options.member - Discord guild member
 * @param {number} options.clubId - Club database ID
 * @param {string} options.action - Action to check ('view', 'moderate', 'manage', 'delete')
 * @returns {Promise<Object>} - { allowed: boolean, reason: string, level: string }
 */
export async function checkClubPermission({ member, clubId, action = 'view' }) {
    if (!member) {
        return { allowed: false, reason: 'No member provided', level: 'none' };
    }

    const userId = member.user.id;

    // Server-level privileged roles have ALL permissions
    if (hasServerPrivilegedRole(member)) {
        return { 
            allowed: true, 
            reason: 'Server privileged role', 
            level: 'Server Management' 
        };
    }

    // Get club and member info
    const club = await new Promise((resolve, reject) => {
        db.get(
            `SELECT * FROM clubs WHERE id = ? AND status = 'active'`,
            [clubId],
            (err, row) => {
                if (err) reject(err);
                else resolve(row);
            }
        );
    });

    if (!club) {
        return { allowed: false, reason: 'Club not found', level: 'none' };
    }

    // Check if user is club president
    if (club.president_user_id === userId) {
        return { 
            allowed: true, 
            reason: 'Club president', 
            level: 'president' 
        };
    }

    // Check if user is club moderator
    const clubMember = await new Promise((resolve, reject) => {
        db.get(
            `SELECT * FROM club_members WHERE club_id = ? AND user_id = ? AND status = 'active'`,
            [clubId, userId],
            (err, row) => {
                if (err) reject(err);
                else resolve(row);
            }
        );
    });

    if (!clubMember) {
        // User is not a member
        if (action === 'view' && club.is_public) {
            return { allowed: true, reason: 'Public club', level: 'public' };
        }
        return { allowed: false, reason: 'Not a club member', level: 'none' };
    }

    // User is a member - check action permissions
    const permissions = {
        view: ['member', 'moderator', 'president'],
        post: ['moderator', 'president'],
        moderate: ['moderator', 'president'],
        manage: ['president'],
        delete: ['president']
    };

    const allowedRoles = permissions[action] || [];
    
    if (allowedRoles.includes(clubMember.role)) {
        return { 
            allowed: true, 
            reason: `Club ${clubMember.role}`, 
            level: clubMember.role 
        };
    }

    return { 
        allowed: false, 
        reason: `Insufficient permissions (requires: ${allowedRoles.join(' or ')})`, 
        level: clubMember.role 
    };
}

/**
 * Generate channel permission overwrites for club channels
 * Ensures server privileged roles always have access
 */
export function generateClubChannelPermissions(guild, club) {
    const botMember = guild.members.me;
    
    const permissionOverwrites = [
        // Deny @everyone by default
        {
            id: guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel]
        },
        // Bot always has full access
        {
            id: botMember.id,
            allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.ManageChannels,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ManageMessages,
                PermissionsBitField.Flags.EmbedLinks,
                PermissionsBitField.Flags.AttachFiles,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.MentionEveryone,
                PermissionsBitField.Flags.ManageRoles
            ]
        }
    ];

    // Add server privileged roles
    Object.values(SERVER_PRIVILEGED_ROLES).forEach(roleId => {
        const role = guild.roles.cache.get(roleId);
        if (role) {
            permissionOverwrites.push({
                id: roleId,
                allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ManageMessages,
                    PermissionsBitField.Flags.ReadMessageHistory,
                    PermissionsBitField.Flags.EmbedLinks,
                    PermissionsBitField.Flags.AttachFiles
                ]
            });
        }
    });

    // Add club role (members)
    if (club.role_id) {
        permissionOverwrites.push({
            id: club.role_id,
            allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.AddReactions,
                PermissionsBitField.Flags.AttachFiles,
                PermissionsBitField.Flags.EmbedLinks
            ]
        });
    }

    // Add club moderator role (enhanced permissions)
    if (club.moderator_role_id) {
        permissionOverwrites.push({
            id: club.moderator_role_id,
            allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ManageMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.AddReactions,
                PermissionsBitField.Flags.AttachFiles,
                PermissionsBitField.Flags.EmbedLinks,
                PermissionsBitField.Flags.MentionEveryone,
                PermissionsBitField.Flags.ManageThreads
            ]
        });
    }

    return permissionOverwrites;
}

/**
 * Generate voice channel permission overwrites for club voice channels
 */
export function generateClubVoicePermissions(guild, club) {
    const botMember = guild.members.me;
    
    const permissionOverwrites = [
        // Deny @everyone by default
        {
            id: guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel]
        },
        // Bot access
        {
            id: botMember.id,
            allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.ManageChannels,
                PermissionsBitField.Flags.Connect,
                PermissionsBitField.Flags.ManageRoles
            ]
        }
    ];

    // Add server privileged roles
    Object.values(SERVER_PRIVILEGED_ROLES).forEach(roleId => {
        const role = guild.roles.cache.get(roleId);
        if (role) {
            permissionOverwrites.push({
                id: roleId,
                allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.Connect,
                    PermissionsBitField.Flags.Speak,
                    PermissionsBitField.Flags.Stream,
                    PermissionsBitField.Flags.MuteMembers,
                    PermissionsBitField.Flags.DeafenMembers,
                    PermissionsBitField.Flags.MoveMembers
                ]
            });
        }
    });

    // Add club role (members)
    if (club.role_id) {
        permissionOverwrites.push({
            id: club.role_id,
            allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.Connect,
                PermissionsBitField.Flags.Speak,
                PermissionsBitField.Flags.Stream,
                PermissionsBitField.Flags.UseVAD
            ]
        });
    }

    // Add club moderator role (enhanced voice permissions)
    if (club.moderator_role_id) {
        permissionOverwrites.push({
            id: club.moderator_role_id,
            allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.Connect,
                PermissionsBitField.Flags.Speak,
                PermissionsBitField.Flags.Stream,
                PermissionsBitField.Flags.UseVAD,
                PermissionsBitField.Flags.MuteMembers,
                PermissionsBitField.Flags.DeafenMembers,
                PermissionsBitField.Flags.PrioritySpeaker
            ]
        });
    }

    return permissionOverwrites;
}

/**
 * Update existing channel permissions to include server privileged roles
 */
export async function updateChannelPermissionsWithPrivilegedRoles(guild, channelId) {
    try {
        const channel = await guild.channels.fetch(channelId);
        if (!channel) {
            log('Channel not found for permission update', 'club', { channelId }, null, 'warn');
            return false;
        }

        const botMember = guild.members.me;
        
        // Ensure bot has access
        await channel.permissionOverwrites.edit(botMember.id, {
            ViewChannel: true,
            SendMessages: true,
            ManageMessages: true,
            EmbedLinks: true,
            AttachFiles: true,
            ReadMessageHistory: true,
            ManageChannels: true
        });

        // Add server privileged roles
        for (const roleId of Object.values(SERVER_PRIVILEGED_ROLES)) {
            const role = guild.roles.cache.get(roleId);
            if (role) {
                await channel.permissionOverwrites.edit(roleId, {
                    ViewChannel: true,
                    SendMessages: true,
                    ManageMessages: true,
                    ReadMessageHistory: true,
                    EmbedLinks: true,
                    AttachFiles: true
                }).catch(err => {
                    log(`Failed to add role ${roleId} to channel ${channelId}`, 'club', null, err, 'warn');
                });
            }
        }

        log('Updated channel permissions with privileged roles', 'club', { channelId });
        return true;

    } catch (error) {
        log('Error updating channel permissions', 'club', { channelId }, error, 'error');
        return false;
    }
}

/**
 * Verify and fix club channel permissions
 */
export async function verifyClubChannelPermissions(guild, clubId) {
    try {
        const club = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM clubs WHERE id = ? AND status = 'active'`,
                [clubId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!club) {
            return { success: false, error: 'Club not found' };
        }

        const results = {
            textChannel: false,
            voiceChannel: false,
            category: false
        };

        // Update text channel
        if (club.channel_id) {
            results.textChannel = await updateChannelPermissionsWithPrivilegedRoles(guild, club.channel_id);
        }

        // Update voice channel
        if (club.voice_channel_id) {
            results.voiceChannel = await updateChannelPermissionsWithPrivilegedRoles(guild, club.voice_channel_id);
        }

        // Update category
        if (club.category_id) {
            results.category = await updateChannelPermissionsWithPrivilegedRoles(guild, club.category_id);
        }

        return { success: true, results };

    } catch (error) {
        log('Error verifying club permissions', 'club', { clubId }, error, 'error');
        return { success: false, error: error.message };
    }
}

/**
 * Remove user from club and revoke roles
 */
export async function removeUserFromClub(guild, clubId, userId, removedBy, reason = 'No reason provided') {
    try {
        const club = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM clubs WHERE id = ?`,
                [clubId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!club) {
            return { success: false, error: 'Club not found' };
        }

        // Cannot remove president
        if (club.president_user_id === userId) {
            return { success: false, error: 'Cannot remove club president' };
        }

        // Update database
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE club_members 
                 SET status = 'removed', removed_at = ?, removed_by = ?, removal_reason = ?, updated_at = ?
                 WHERE club_id = ? AND user_id = ?`,
                [Date.now(), removedBy, reason, Date.now(), clubId, userId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Remove Discord roles
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
            if (club.role_id) {
                await member.roles.remove(club.role_id, `Removed from club: ${reason}`).catch(() => {});
            }
            if (club.moderator_role_id) {
                await member.roles.remove(club.moderator_role_id, `Removed from club: ${reason}`).catch(() => {});
            }
        }

        // Log action
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_audit_log (guild_id, club_id, action_type, performed_by, target_id, details) 
                 VALUES (?, ?, 'member_removed', ?, ?, ?)`,
                [
                    guild.id,
                    clubId,
                    removedBy,
                    userId,
                    JSON.stringify({ clubName: club.name, reason })
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        return { success: true };

    } catch (error) {
        log('Error removing user from club', 'club', { clubId, userId }, error, 'error');
        return { success: false, error: error.message };
    }
}

export default {
    hasServerPrivilegedRole,
    isServerAdmin,
    isServerModerator,
    checkClubPermission,
    generateClubChannelPermissions,
    generateClubVoicePermissions,
    updateChannelPermissionsWithPrivilegedRoles,
    verifyClubChannelPermissions,
    removeUserFromClub,
    SERVER_PRIVILEGED_ROLES
};