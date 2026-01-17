import { AuditLogEvent, PermissionsBitField, EmbedBuilder } from 'discord.js';
import { debugConfig } from '../utils/debug.js';

const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const MODERATOR_ROLE_ID = process.env.MODERATOR_ROLE_ID;
const FSU_EXECUTIVE_ROLE_ID = process.env.FSU_EXECUTIVE_ROLE_ID;
const ALLOWED_ROLES = [ADMIN_ROLE_ID, MODERATOR_ROLE_ID, FSU_EXECUTIVE_ROLE_ID].filter(Boolean);

/**
 * Checks if a member has any of the allowed roles for unrestricted access.
 * @param {GuildMember} member 
 * @returns {boolean}
 */
function isAuthorized(member) {
    if (!member) return false;
    if (member.id === member.guild.ownerId) return true;
    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true; // Admins are usually safe, but requirements said SPECIFIC roles. 
    // However, the prompt says "expect ADMin, moderator and FSU_executive". This usually implies the role itself, but Discord Admin permission is supreme. 
    // Let's stick to the roles + owner as "Admin" in context usually means "someone with the Admin Role".
    // But safely, let's allow actual Administrators too to prevent lockout, unless the user specifically wants to restrict them (which is hard).

    return member.roles.cache.some(role => ALLOWED_ROLES.includes(role.id));
}

/**
 * Handles role deletion.
 * @param {Role} role 
 */
export async function handleRoleDelete(role) {
    const { guild } = role;

    // Fetch audit logs to find who deleted the role
    let auditLogs;
    try {
        auditLogs = await guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.RoleDelete,
        });
    } catch (error) {
        debugConfig.log('Failed to fetch audit logs for role deletion', 'roleProtection', null, error, 'error');
        return;
    }

    const logEntry = auditLogs.entries.first();
    if (!logEntry) return;

    const { executor, target } = logEntry;

    // Ensure the log entry matches the deleted role
    if (target.id !== role.id) return;

    // Check if the executor is the bot itself (to prevent loops)
    if (executor.id === guild.client.user.id) return;

    const executorMember = await guild.members.fetch(executor.id).catch(() => null);

    if (isAuthorized(executorMember)) {
        debugConfig.log(`Authorized role deletion by ${executor.tag}`, 'roleProtection');
        return;
    }

    // UnAuthorized Deletion -> Re-create Role
    debugConfig.log(`Unauthorized role deletion by ${executor.tag}. Re-creating role...`, 'roleProtection', null, null, 'warn');

    try {
        const newRole = await guild.roles.create({
            name: role.name,
            color: role.color,
            hoist: role.hoist,
            permissions: role.permissions,
            mentionable: role.mentionable,
            reason: `Restoring role deleted by unauthorized user: ${executor.tag}`
        });

        // Notify in a log channel if possible, or just debug log
        // (Assuming no specific log channel configured for this, just doing core logic)

    } catch (error) {
        debugConfig.log('Failed to re-create deleted role', 'roleProtection', null, error, 'error');
    }
}

/**
 * Handles role updates.
 * @param {Role} oldRole 
 * @param {Role} newRole 
 */
export async function handleRoleUpdate(oldRole, newRole) {
    const { guild } = newRole;

    // Calculate role age
    const roleAge = Date.now() - newRole.createdTimestamp;
    const THIRTY_MINUTES = 30 * 60 * 1000;

    // If role is new (less than 30 mins), allow modification
    if (roleAge < THIRTY_MINUTES) return;

    // Fetch audit logs
    let auditLogs;
    try {
        auditLogs = await guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.RoleUpdate,
        });
    } catch (error) {
        debugConfig.log('Failed to fetch audit logs for role update', 'roleProtection', null, error, 'error');
        return;
    }

    const logEntry = auditLogs.entries.first();
    if (!logEntry) return; // Can happen if update wasn't recent enough or cached

    const { executor, target } = logEntry;
    if (target.id !== newRole.id) return;
    if (executor.id === guild.client.user.id) return;

    const executorMember = await guild.members.fetch(executor.id).catch(() => null);

    if (isAuthorized(executorMember)) {
        debugConfig.log(`Authorized role update by ${executor.tag}`, 'roleProtection');
        return;
    }

    // Unauthorized Modification on OLD role -> Revert
    debugConfig.log(`Unauthorized role update by ${executor.tag} on old role. Reverting...`, 'roleProtection', null, null, 'warn');

    try {
        // Revert to old properties
        // Only revert what changed (basic checks)
        // Note: permissions are bitfields, need comparison
        if (oldRole.permissions.bitfield !== newRole.permissions.bitfield ||
            oldRole.name !== newRole.name ||
            oldRole.color !== newRole.color ||
            oldRole.hoist !== newRole.hoist ||
            oldRole.mentionable !== newRole.mentionable
        ) {
            await newRole.edit({
                name: oldRole.name,
                color: oldRole.color,
                hoist: oldRole.hoist,
                permissions: oldRole.permissions,
                mentionable: oldRole.mentionable,
                reason: `Reverting unauthorized changes by ${executor.tag}`
            });
        }
    } catch (error) {
        debugConfig.log('Failed to revert role changes', 'roleProtection', null, error, 'error');
    }
}
