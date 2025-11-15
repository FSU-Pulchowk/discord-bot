// src/commands/slash/registerclub.js
import { 
    SlashCommandBuilder, 
    PermissionFlagsBits,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} from 'discord.js';
import { db, generateSlug } from '../../database.js';
import { log } from '../../utils/debug.js';

export const data = new SlashCommandBuilder()
    .setName('registerclub')
    .setDescription('Register a new club (Verified members only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
    const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID || 'YOUR_VERIFIED_ROLE_ID';

    // Check if user has Pulchowkian/Verified role
    if (!interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) {
        return await interaction.reply({
            content: '❌ Only verified @Pulchowkian members can register clubs. Please verify first using `/verify`!',
            flags: MessageFlags.Ephemeral
        });
    }

    // Check if user has proper permissions OR is verified
    const hasManageGuild = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
    
    if (!hasManageGuild && !interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) {
        return await interaction.reply({
            content: '❌ You need Manage Server permission or be a verified member to register clubs.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Check if user already has a club as president
    const existingClub = await new Promise((resolve, reject) => {
        db.get(
            `SELECT id, name, status FROM clubs WHERE guild_id = ? AND president_user_id = ? AND status IN ('pending', 'active')`,
            [interaction.guild.id, interaction.user.id],
            (err, row) => {
                if (err) reject(err);
                else resolve(row);
            }
        );
    });

    if (existingClub) {
        return await interaction.reply({
            content: `❌ You already have a club: **${existingClub.name}** (${existingClub.status})\n\nYou can only be president of one club at a time. Contact an admin if you need to transfer presidency.`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Create the modal
    const modal = new ModalBuilder()
        .setCustomId('club_registration_modal')
        .setTitle('Register New Club');

    const clubNameInput = new TextInputBuilder()
        .setCustomId('club_name')
        .setLabel('Club Name')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., Robotics Club')
        .setRequired(true)
        .setMaxLength(50);

    const descriptionInput = new TextInputBuilder()
        .setCustomId('club_description')
        .setLabel('Club Description')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Describe your club\'s purpose and activities')
        .setRequired(true)
        .setMaxLength(500);

    const categoryInput = new TextInputBuilder()
        .setCustomId('club_category')
        .setLabel('Category')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('technical, cultural, sports, social_service, academic, general')
        .setRequired(true)
        .setMaxLength(20);

    const contactInfoInput = new TextInputBuilder()
        .setCustomId('contact_info')
        .setLabel('Contact Info (Email, Phone, Website)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Email: club@example.com\nPhone: +977-1234567890\nWebsite: https://club.com')
        .setRequired(false)
        .setMaxLength(300);

    const logoUrlInput = new TextInputBuilder()
        .setCustomId('club_logo_url')
        .setLabel('Logo URL (Image Link) - Optional')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('https://example.com/logo.png')
        .setRequired(false);

    modal.addComponents(
        new ActionRowBuilder().addComponents(clubNameInput),
        new ActionRowBuilder().addComponents(descriptionInput),
        new ActionRowBuilder().addComponents(categoryInput),
        new ActionRowBuilder().addComponents(contactInfoInput),
        new ActionRowBuilder().addComponents(logoUrlInput)
    );

    try {
        await interaction.showModal(modal);
        log('Club registration modal shown successfully', 'club', { user: interaction.user.tag });
    } catch (error) {
        log('Error showing club registration modal', 'club', null, error, 'error');
        
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ Failed to show registration form. Please try again.',
                    flags: MessageFlags.Ephemeral
                });
            }
        } catch (replyError) {
            log('Could not send error reply', 'club', null, replyError, 'error');
        }
    }
}

/**
 * Handle modal submission for club registration
 */
export async function handleModalSubmit(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID || 'YOUR_VERIFIED_ROLE_ID';

    // Re-check verification (security)
    if (!interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) {
        return await interaction.editReply({
            content: '❌ Only verified @Pulchowkian members can register clubs.'
        });
    }

    const clubName = interaction.fields.getTextInputValue('club_name');
    const description = interaction.fields.getTextInputValue('club_description');
    const logoUrl = interaction.fields.getTextInputValue('club_logo_url') || null;
    const category = interaction.fields.getTextInputValue('club_category').toLowerCase();
    const contactInfoRaw = interaction.fields.getTextInputValue('contact_info') || '';

    // Parse contact information
    const contactInfo = parseContactInfo(contactInfoRaw);

    // Validate email format if provided
    if (contactInfo.email && !isValidEmail(contactInfo.email)) {
        return await interaction.editReply({
            content: '❌ Invalid email format. Please provide a valid email address.'
        });
    }

    // Validate category
    const validCategories = ['technical', 'cultural', 'sports', 'social_service', 'academic', 'general'];
    if (!validCategories.includes(category)) {
        return await interaction.editReply({ 
            content: `❌ Invalid category. Must be one of: ${validCategories.join(', ')}` 
        });
    }

    const presidentId = interaction.user.id;
    const guildId = interaction.guild.id;

    try {
        // Generate slug from club name
        let slug = generateSlug(clubName);

        // Check if club name already exists
        const existingName = await new Promise((resolve, reject) => {
            db.get(
                `SELECT id FROM clubs WHERE guild_id = ? AND LOWER(name) = LOWER(?)`,
                [guildId, clubName],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (existingName) {
            return await interaction.editReply({
                content: '❌ A club with this name already exists. Please choose a different name.'
            });
        }

        // Check if slug already exists
        const existingSlug = await new Promise((resolve, reject) => {
            db.get(
                `SELECT id FROM clubs WHERE guild_id = ? AND slug = ?`,
                [guildId, slug],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (existingSlug) {
            // Generate alternative slug with timestamp
            slug = `${slug}-${Date.now() % 10000}`;
            log('Slug conflict, generated alternative', 'club', { originalSlug: generateSlug(clubName), newSlug: slug });
        }

        // Check if user already has a pending/active club
        const existingClub = await new Promise((resolve, reject) => {
            db.get(
                `SELECT id, name, status FROM clubs WHERE guild_id = ? AND president_user_id = ? AND status IN ('pending', 'active')`,
                [guildId, presidentId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (existingClub) {
            return await interaction.editReply({
                content: `❌ You already have a club: **${existingClub.name}** (${existingClub.status})\n\nYou can only be president of one club at a time.`
            });
        }

        // Insert club registration with slug
        const clubId = await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO clubs 
                (guild_id, name, slug, description, logo_url, president_user_id, category, 
                 contact_email, contact_phone, website_url, status) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
                [guildId, clubName, slug, description, logoUrl, presidentId, category, 
                 contactInfo.email, contactInfo.phone, contactInfo.website],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });

        // Log action
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_audit_log (guild_id, action_type, performed_by, target_id, details) 
                 VALUES (?, 'club_registration', ?, ?, ?)`,
                [
                    guildId,
                    presidentId,
                    clubId.toString(),
                    JSON.stringify({ 
                        clubName, 
                        slug,
                        category, 
                        hasEmail: !!contactInfo.email,
                        hasPhone: !!contactInfo.phone,
                        hasWebsite: !!contactInfo.website
                    })
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Get president info
        let presidentName = interaction.user.username;
        try {
            const presidentData = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT real_name FROM verified_users WHERE user_id = ?`,
                    [presidentId],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });
            if (presidentData) {
                presidentName = presidentData.real_name;
            }
        } catch (err) {
            log('Could not fetch president name from verified_users', 'club', null, err, 'warn');
        }

        // Send to approval channel
        const EVENT_APPROVAL_CHANNEL_ID = process.env.EVENT_APPROVAL_CHANNEL_ID;
        
        if (!EVENT_APPROVAL_CHANNEL_ID || EVENT_APPROVAL_CHANNEL_ID === 'YOUR_EVENT_APPROVAL_CHANNEL_ID') {
            return await interaction.editReply({
                content: '⚠️ Event approval channel not configured. Please contact an administrator.'
            });
        }

        const approvalChannel = await interaction.guild.channels.fetch(EVENT_APPROVAL_CHANNEL_ID);

        const approvalEmbed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('🏛️ New Club Registration Request')
            .setDescription(`**${clubName}** is awaiting approval`)
            .addFields(
                { name: '🆔 Club ID', value: clubId.toString(), inline: true },
                { name: '🔗 Slug', value: `\`${slug}\``, inline: true },
                { name: '👤 President', value: `${presidentName} (<@${presidentId}>)`, inline: true },
                { name: '📂 Category', value: category.charAt(0).toUpperCase() + category.slice(1), inline: true },
                { name: '✅ Verified', value: '✅ Pulchowkian', inline: true },
                { name: '📝 Description', value: description.length > 1000 ? description.substring(0, 997) + '...' : description }
            );

        // Add contact information fields
        if (contactInfo.email || contactInfo.phone || contactInfo.website) {
            let contactText = '';
            if (contactInfo.email) contactText += `📧 **Email:** ${contactInfo.email}\n`;
            if (contactInfo.phone) contactText += `📞 **Phone:** ${contactInfo.phone}\n`;
            if (contactInfo.website) contactText += `🌐 **Website:** ${contactInfo.website}`;
            
            approvalEmbed.addFields({ 
                name: '📞 Contact Information', 
                value: contactText, 
                inline: false 
            });
        }

        approvalEmbed.addFields({ 
            name: '⚙️ Action Required', 
            value: `Use the buttons below or run:\n\`/clubs approve club_id:${clubId}\`` 
        });

        if (logoUrl) {
            approvalEmbed.setThumbnail(logoUrl);
        }

        approvalEmbed.setTimestamp();

        const approveBtn = new ButtonBuilder()
            .setCustomId(`approve_club_${clubId}`)
            .setLabel('Approve Club')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅');

        const rejectBtn = new ButtonBuilder()
            .setCustomId(`reject_club_${clubId}`)
            .setLabel('Reject Club')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌');

        const row = new ActionRowBuilder().addComponents(approveBtn, rejectBtn);

        await approvalChannel.send({ embeds: [approvalEmbed], components: [row] });

        // Confirm to user
        const confirmEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Club Registration Submitted')
            .setDescription(`Your club **${clubName}** has been submitted for approval.`)
            .addFields(
                { name: '🆔 Registration ID', value: clubId.toString(), inline: true },
                { name: '🔗 Slug', value: `\`${slug}\``, inline: true },
                { name: '📊 Status', value: 'Pending Approval', inline: true }
            );

        // Show submitted contact info
        if (contactInfo.email || contactInfo.phone || contactInfo.website) {
            let submittedContact = '';
            if (contactInfo.email) submittedContact += `📧 ${contactInfo.email}\n`;
            if (contactInfo.phone) submittedContact += `📞 ${contactInfo.phone}\n`;
            if (contactInfo.website) submittedContact += `🌐 ${contactInfo.website}`;
            
            confirmEmbed.addFields({
                name: '📞 Submitted Contact Info',
                value: submittedContact,
                inline: false
            });
        }

        confirmEmbed.addFields({
            name: '📋 Next Steps',
            value: 
                '• Wait for admin approval (usually 24-48h)\n' +
                '• You\'ll be notified via DM\n' +
                '• Once approved, your club will be created with:\n' +
                '  - Member role and Moderator role\n' +
                '  - Private text channel\n' +
                '  - Private voice channel\n' +
                '  - Club embed in #clubs channel\n' +
                `• Use slug \`${slug}\` in all commands`
        });

        confirmEmbed.setFooter({ text: 'Remember your club slug for easy access!' });
        confirmEmbed.setTimestamp();

        await interaction.editReply({ embeds: [confirmEmbed] });

    } catch (error) {
        log('Error registering club:', 'club', null, error, 'error');
        await interaction.editReply({
            content: `❌ An error occurred: ${error.message}`
        }).catch(() => {});
    }
}

/**
 * Parse contact information from multi-line input
 */
function parseContactInfo(contactText) {
    const result = {
        email: null,
        phone: null,
        website: null
    };

    if (!contactText) return result;

    const lines = contactText.split('\n');
    
    for (const line of lines) {
        const trimmed = line.trim();
        
        // Check for email
        if (trimmed.toLowerCase().includes('email:')) {
            const email = trimmed.split(':')[1]?.trim();
            if (email) result.email = email;
        } else if (isValidEmail(trimmed)) {
            result.email = trimmed;
        }
        
        // Check for phone
        if (trimmed.toLowerCase().includes('phone:')) {
            const phone = trimmed.split(':')[1]?.trim();
            if (phone) result.phone = phone;
        } else if (/^[\d\s\+\-\(\)]+$/.test(trimmed) && trimmed.length >= 7) {
            result.phone = trimmed;
        }
        
        // Check for website
        if (trimmed.toLowerCase().includes('website:')) {
            const website = trimmed.split(':')[1]?.trim();
            if (website) result.website = website;
        } else if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            result.website = trimmed;
        }
    }

    return result;
}

/**
 * Validate email format
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}