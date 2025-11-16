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
import { emailService } from '../../services/emailService.js';
import { generateOtp } from '../../utils/otpGenerator.js';

// Store OTP temporarily (in production, use Redis or database)
const otpStore = new Map();

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
            content: `❌ You already have a club: **${existingClub.name}** (${existingClub.status})\n\nYou can only be president of one club at a time.`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Show comprehensive modal
    const modal = new ModalBuilder()
        .setCustomId('club_registration_modal_step1')
        .setTitle('Register New Club - Basic Info');

    const clubNameInput = new TextInputBuilder()
        .setCustomId('club_name')
        .setLabel('Club Name')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., Robotics Club')
        .setRequired(true)
        .setMaxLength(50);

    const emailInput = new TextInputBuilder()
        .setCustomId('club_email')
        .setLabel('Club Official Email')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('robotics@pulchowk.edu.np')
        .setRequired(true)
        .setMaxLength(100);

    const descriptionInput = new TextInputBuilder()
        .setCustomId('club_description')
        .setLabel('Club Description')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Describe your club\'s purpose, mission, and activities')
        .setRequired(true)
        .setMaxLength(1000);

    const categoryInput = new TextInputBuilder()
        .setCustomId('club_category')
        .setLabel('Category')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('technical, cultural, sports, social_service, academic')
        .setRequired(true)
        .setMaxLength(20);

    const logoUrlInput = new TextInputBuilder()
        .setCustomId('club_logo_url')
        .setLabel('Club Logo URL (Image Link)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('https://example.com/logo.png')
        .setRequired(false);

    modal.addComponents(
        new ActionRowBuilder().addComponents(clubNameInput),
        new ActionRowBuilder().addComponents(emailInput),
        new ActionRowBuilder().addComponents(descriptionInput),
        new ActionRowBuilder().addComponents(categoryInput),
        new ActionRowBuilder().addComponents(logoUrlInput)
    );

    await interaction.showModal(modal);
}

/**
 * Handle step 1 modal submission
 */
export async function handleModalStep1(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const clubName = interaction.fields.getTextInputValue('club_name');
    const clubEmail = interaction.fields.getTextInputValue('club_email');
    const description = interaction.fields.getTextInputValue('club_description');
    const category = interaction.fields.getTextInputValue('club_category').toLowerCase();
    const logoUrl = interaction.fields.getTextInputValue('club_logo_url') || null;

    // Validate email
    if (!isValidEmail(clubEmail)) {
        return await interaction.editReply({
            content: '❌ Invalid email format. Please provide a valid institutional email.'
        });
    }

    // Validate category
    const validCategories = ['technical', 'cultural', 'sports', 'social_service', 'academic', 'general'];
    if (!validCategories.includes(category)) {
        return await interaction.editReply({ 
            content: `❌ Invalid category. Must be one of: ${validCategories.join(', ')}` 
        });
    }

    // Store basic data temporarily
    const tempData = {
        clubName,
        clubEmail,
        description,
        category,
        logoUrl,
        userId: interaction.user.id,
        guildId: interaction.guild.id
    };

    // Generate and send OTP
    const otp = generateOTP();
    otpStore.set(clubEmail, {
        otp,
        tempData,
        expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
    });

    try {
        const mailer = new emailService();
        const emailContent = `
         <!DOCTYPE html>
        <html>
        <head>
            <title>Verify Your Club Registration</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                /* Global Styles */
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
                    line-height: 1.6;
                    color: #333;
                    background-color: #f0f2f5; /* Light grey background */
                    margin: 0;
                    padding: 0;
                }
                .container {
                    max-width: 600px;
                    margin: 20px auto;
                    padding: 0;
                    background: #f9f9f9;
                    border-radius: 10px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.08); /* Softer shadow */
                    overflow: hidden; /* Ensures border-radius clips content */
                }

                /* Banner */
                .banner {
                    width: 100%;
                    height: auto; /* Maintain aspect ratio */
                    display: block;
                }

                /* Header */
                .header {
                    background: #5865F2; /* Discord Blue */
                    color: white;
                    padding: 20px 30px;
                    text-align: center;
                }
                .header h1 {
                    margin: 0 0 5px 0;
                    font-size: 24px;
                }
                .header h2 {
                    margin: 0;
                    font-size: 18px;
                    font-weight: 300; /* Lighter font */
                }

                /* Content Area */
                .content {
                    padding: 30px;
                }
                .content p {
                    margin-bottom: 20px;
                }
                .content h2 {
                    color: #333;
                    margin-top: 0;
                }
                .content h3 {
                    color: #5865F2;
                    border-bottom: 2px solid #e0e0e0;
                    padding-bottom: 5px;
                    margin-top: 30px;
                }

                /* OTP Box */
                .otp-box {
                    background: #ffffff;
                    padding: 25px;
                    text-align: center;
                    font-size: 42px; /* Made larger */
                    font-weight: bold;
                    letter-spacing: 8px; /* More spacing */
                    color: #5865F2;
                    border: 2px dashed #5865F2;
                    border-radius: 8px;
                    margin: 30px 0;
                }

                /* Info Box */
                .info-box {
                    background: #eef2ff; /* Lighter, more modern blue */
                    padding: 15px 20px;
                    border-left: 4px solid #5865F2;
                    margin: 20px 0;
                    border-radius: 0 5px 5px 0; /* Rounded corners on one side */
                }

                /* Features Box */
                .features {
                    background: #ffffff;
                    padding: 20px 25px;
                    margin: 30px 0;
                    border-radius: 8px;
                    border: 1px solid #e0e0e0;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.05);
                }
                .feature {
                    margin: 10px 0;
                    padding-left: 30px; /* More space for icon */
                    position: relative;
                    font-size: 15px;
                }
                .feature:before {
                    content: "✔"; /* Heavier checkmark */
                    position: absolute;
                    left: 0;
                    top: 0;
                    color: #4CAF50; /* Green */
                    font-weight: bold;
                    font-size: 18px;
                }
                
                /* Club Details List */
                .details-list {
                    list-style: none;
                    padding: 0;
                    margin: 25px 0;
                    border: 1px solid #ddd;
                    border-radius: 8px;
                    overflow: hidden; /* To clip the li borders */
                    background: #ffffff;
                }
                .details-list li {
                    padding: 14px 20px;
                    border-bottom: 1px solid #eee;
                    font-size: 15px;
                }
                .details-list li:last-child {
                    border-bottom: none;
                }
                .details-list li strong {
                    color: #333;
                    min-width: 110px; /* Aligns the values */
                    display: inline-block;
                }

                /* Footer */
                .footer {
                    text-align: center;
                    color: #777;
                    font-size: 12px;
                    padding: 25px;
                    border-top: 1px solid #e0e0e0;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <!-- Banner Image -->
                <div>
                    <!-- 
                    Using a placeholder here as the original image might not load.
                    The original URL was: https://abhishekkharel.com.np/banner/fsu-banner.png
                    -->
                    <img 
                    src="https://abhishekkharel.com.np/banner/fsu-banner.png" 
                    alt="IOE Pulchowk Campus Banner" 
                    class="banner"
                    onerror="this.onerror=null; this.src='https://placehold.co/600x200/5865F2/FFFFFF?text=IOE+Pulchowk+Campus+Banner';"
                    >
                </div>

                <!-- Header -->
                <div class="header">
                    <h1>🎓 IOE Pulchowk Campus</h1>
                    <h2>Club Management System</h2>
                </div>
                
                <!-- Content -->
                <div class="content">
                    <h2>Verify Your Club Registration</h2>
                    <p>Hello,</p>
                    <!-- Note: Using template placeholders for dynamic content -->
                    <p>Thank you for registering <strong>${clubName}</strong> with the IOE Pulchowk Campus Club Management System!</p>
                    
                    <p>To complete your setup, please use the One-Time Password (OTP) below.</p>
                    
                    <div class="otp-box">
                        ${otp}
                    </div>
                    
                    <div class="info-box">
                        <strong>⏰ This OTP is valid for 10 minutes</strong><br>
                        Please return to Discord and enter this code to complete your registration.
                    </div>

                    <!-- Club Details -->
                    <h3>📋 Your Submitted Details</h3>
                    <ul class="details-list">
                        <li><strong>Club Name:</strong> ${clubName}</li>
                        <li><strong>Category:</strong> ${category.charAt(0).toUpperCase() + category.slice(1)}</li>
                        <li><strong>Email:</strong> ${clubEmail}</li>
                    </ul>

                    <!-- Features -->
                    <div class="features">
                        <h3>🚀 What's Next?</h3>
                        <div class="feature">Integrated Discord & Web Portal Management</div>
                        <div class="feature">Automated Event Creation & RSVP System</div>
                        <div class="feature">Member Management & Attendance Tracking</div>
                        <div class="feature">Announcement System with Webhooks</div>
                        <div class="feature">Excel Data Synchronization</div>
                        <div class="feature">Automated Reports & Analytics</div>
                    </div>

                    <div class="info-box">
                        <strong>🔗 Integration Features:</strong><br>
                        • Discord channels & roles automatically created<br>
                        • Event management with poster attachments<br>
                        • Member verification system<br>
                        • Real-time notifications<br>
                        • Attendance & contribution tracking
                    </div>

                    <p><strong>Need Help?</strong> Contact your server administrator or check the club management documentation.</p>
                </div>
                
                <!-- Footer -->
                <div class="footer">
                    <p>IOE Pulchowk Campus - Club Management System<br>
                    This is an automated message. Please do not reply to this email.</p>
                </div>
            </div>
        </body>
        </html>
        `;

        await mailer.sendEmail(clubEmail, `Verify Club Registration - OTP: ${otp}`, emailContent);

        // Send verification button via DM
        const verifyEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('📧 Email Verification Required')
            .setDescription(`We've sent a verification code to **${clubEmail}**`)
            .addFields(
                { name: '✉️ Check Your Email', value: `Look for an email from IOE Pulchowk Campus with your OTP code.`, inline: false },
                { name: '⏰ Valid For', value: '10 minutes', inline: true },
                { name: '🔢 Code Length', value: '6 digits', inline: true },
                { name: '📋 Club Name', value: clubName, inline: true }
            )
            .setFooter({ text: 'Click the button below to enter your OTP' })
            .setTimestamp();

        const verifyButton = new ButtonBuilder()
            .setCustomId(`verify_club_email_${clubEmail}`)
            .setLabel('Enter OTP Code')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔐');

        const row = new ActionRowBuilder().addComponents(verifyButton);

        await interaction.user.send({ embeds: [verifyEmbed], components: [row] });

        await interaction.editReply({
            content: '✅ Check your DMs! We\'ve sent you a verification button.\n\n' +
                     `📧 An OTP has been sent to **${clubEmail}**\n` +
                     '⏰ Valid for 10 minutes'
        });

    } catch (error) {
        log('Error sending verification email', 'club', null, error, 'error');
        await interaction.editReply({
            content: '❌ Failed to send verification email. Please check the email address and try again.'
        });
    }
}

/**
 * Handle verify button click
 */
export async function handleVerifyButton(interaction) {
    const clubEmail = interaction.customId.split('_')[3];

    const modal = new ModalBuilder()
        .setCustomId(`verify_otp_modal_${clubEmail}`)
        .setTitle('Enter Verification Code');

    const otpInput = new TextInputBuilder()
        .setCustomId('otp_code')
        .setLabel('6-Digit OTP Code')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('123456')
        .setRequired(true)
        .setMinLength(6)
        .setMaxLength(6);

    modal.addComponents(new ActionRowBuilder().addComponents(otpInput));
    await interaction.showModal(modal);
}

/**
 * Handle OTP verification
 */
export async function handleOTPVerification(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const clubEmail = interaction.customId.split('_')[3];
    const enteredOTP = interaction.fields.getTextInputValue('otp_code');

    const stored = otpStore.get(clubEmail);

    if (!stored) {
        return await interaction.editReply({
            content: '❌ Verification session expired. Please start registration again.'
        });
    }

    if (Date.now() > stored.expiresAt) {
        otpStore.delete(clubEmail);
        return await interaction.editReply({
            content: '❌ OTP expired. Please start registration again.'
        });
    }

    if (stored.otp !== enteredOTP) {
        return await interaction.editReply({
            content: '❌ Invalid OTP. Please check your email and try again.'
        });
    }

    // OTP verified! Now show step 2 modal for additional details
    otpStore.delete(clubEmail);
    
    // Store verified data temporarily for step 2
    global.verifiedClubData = global.verifiedClubData || new Map();
    global.verifiedClubData.set(interaction.user.id, stored.tempData);

    const modal2 = new ModalBuilder()
        .setCustomId('club_registration_modal_step2')
        .setTitle('Club Details - Additional Info');

    const advisorInput = new TextInputBuilder()
        .setCustomId('advisor_name')
        .setLabel('Faculty Advisor Name')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Dr. John Doe')
        .setRequired(false)
        .setMaxLength(100);

    const contactInput = new TextInputBuilder()
        .setCustomId('contact_info')
        .setLabel('Contact Information')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Phone: +977-1234567890\nWebsite: https://club.com\nSocial Media: @clubhandle')
        .setRequired(false)
        .setMaxLength(500);

    const maxMembersInput = new TextInputBuilder()
        .setCustomId('max_members')
        .setLabel('Maximum Members (leave blank for unlimited)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('50')
        .setRequired(false)
        .setMaxLength(10);

    const meetingInput = new TextInputBuilder()
        .setCustomId('meeting_schedule')
        .setLabel('Regular Meeting Schedule')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Day: Monday\nTime: 16:00\nLocation: Room 101\nFrequency: Weekly')
        .setRequired(false)
        .setMaxLength(300);

    const visionInput = new TextInputBuilder()
        .setCustomId('club_vision')
        .setLabel('Club Vision & Goals')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('What does your club aim to achieve?')
        .setRequired(false)
        .setMaxLength(500);

    modal2.addComponents(
        new ActionRowBuilder().addComponents(advisorInput),
        new ActionRowBuilder().addComponents(contactInput),
        new ActionRowBuilder().addComponents(maxMembersInput),
        new ActionRowBuilder().addComponents(meetingInput),
        new ActionRowBuilder().addComponents(visionInput)
    );

    await interaction.showModal(modal2);
}

/**
 * Handle step 2 modal submission - Final registration
 */
export async function handleModalStep2(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const advisorName = interaction.fields.getTextInputValue('advisor_name') || null;
    const contactInfo = interaction.fields.getTextInputValue('contact_info') || null;
    const maxMembersStr = interaction.fields.getTextInputValue('max_members') || null;
    const meetingSchedule = interaction.fields.getTextInputValue('meeting_schedule') || null;
    const clubVision = interaction.fields.getTextInputValue('club_vision') || null;

    // Get verified data from step 1
    const basicData = global.verifiedClubData?.get(interaction.user.id);
    if (!basicData) {
        return await interaction.editReply({
            content: '❌ Session expired. Please start registration again.'
        });
    }

    global.verifiedClubData.delete(interaction.user.id);

    // Parse additional data
    const parsedContact = parseContactInfo(contactInfo);
    const maxMembers = maxMembersStr ? parseInt(maxMembersStr) : null;
    const meetingData = parseMeetingSchedule(meetingSchedule);

    try {
        // Generate slug
        let slug = generateSlug(basicData.clubName);

        // Check for existing club
        const existingName = await new Promise((resolve, reject) => {
            db.get(
                `SELECT id FROM clubs WHERE guild_id = ? AND LOWER(name) = LOWER(?)`,
                [basicData.guildId, basicData.clubName],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (existingName) {
            return await interaction.editReply({
                content: '❌ A club with this name already exists.'
            });
        }

        // Check slug conflict
        const existingSlug = await new Promise((resolve, reject) => {
            db.get(
                `SELECT id FROM clubs WHERE guild_id = ? AND slug = ?`,
                [basicData.guildId, slug],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (existingSlug) {
            slug = `${slug}-${Date.now() % 10000}`;
        }

        // Insert comprehensive club data
        const clubId = await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO clubs (
                    guild_id, name, slug, description, logo_url, president_user_id, 
                    category, contact_email, contact_phone, website_url, social_media_links,
                    advisor_name, max_members, meeting_day, meeting_time, meeting_location, 
                    meeting_frequency, club_vision, established_date, status, email_verified
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1)`,
                [
                    basicData.guildId, basicData.clubName, slug, basicData.description, 
                    basicData.logoUrl, basicData.userId, basicData.category,
                    basicData.clubEmail, parsedContact.phone, parsedContact.website, 
                    parsedContact.social, advisorName, maxMembers, 
                    meetingData.day, meetingData.time, meetingData.location,
                    meetingData.frequency, clubVision, Date.now()
                ],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });

        // Log registration
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_audit_log (guild_id, action_type, performed_by, target_id, details) 
                 VALUES (?, 'club_registration', ?, ?, ?)`,
                [
                    basicData.guildId, basicData.userId, clubId.toString(),
                    JSON.stringify({ 
                        clubName: basicData.clubName, slug, category: basicData.category,
                        emailVerified: true, hasAdvisor: !!advisorName, 
                        hasMaxMembers: !!maxMembers, hasMeetingSchedule: !!meetingSchedule
                    })
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Send to approval channel
        await sendToApprovalChannel(interaction, clubId, basicData, {
            advisorName, maxMembers, meetingData, clubVision, parsedContact
        });

        // Success confirmation
        const confirmEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Club Registration Complete!')
            .setDescription(`**${basicData.clubName}** has been successfully registered and verified!`)
            .addFields(
                { name: '🆔 Registration ID', value: clubId.toString(), inline: true },
                { name: '🔗 Slug', value: `\`${slug}\``, inline: true },
                { name: '✅ Email Verified', value: basicData.clubEmail, inline: true },
                { name: '📊 Status', value: 'Pending Admin Approval', inline: true },
                { name: '📂 Category', value: basicData.category.charAt(0).toUpperCase() + basicData.category.slice(1), inline: true }
            );

        if (maxMembers) {
            confirmEmbed.addFields({ name: '👥 Max Members', value: maxMembers.toString(), inline: true });
        }

        confirmEmbed.addFields({
            name: '📋 Next Steps',
            value: 
                '✅ Email verified successfully\n' +
                '⏳ Awaiting admin approval (24-48h)\n' +
                '📱 You\'ll be notified via DM\n' +
                '🎯 Once approved, your club infrastructure will be created automatically'
        });

        confirmEmbed.setFooter({ text: `Remember your club slug: ${slug}` });
        confirmEmbed.setTimestamp();

        await interaction.editReply({ embeds: [confirmEmbed] });

    } catch (error) {
        log('Error completing registration', 'club', null, error, 'error');
        await interaction.editReply({
            content: `❌ An error occurred: ${error.message}`
        });
    }
}

/**
 * Send to approval channel
 */
async function sendToApprovalChannel(interaction, clubId, basicData, additionalData) {
    const EVENT_APPROVAL_CHANNEL_ID = process.env.EVENT_APPROVAL_CHANNEL_ID;
    
    if (!EVENT_APPROVAL_CHANNEL_ID || EVENT_APPROVAL_CHANNEL_ID === 'YOUR_EVENT_APPROVAL_CHANNEL_ID') {
        return;
    }

    try {
        const approvalChannel = await interaction.guild.channels.fetch(EVENT_APPROVAL_CHANNEL_ID);

        const approvalEmbed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('🏛️ New Club Registration - Email Verified')
            .setDescription(`**${basicData.clubName}** is awaiting approval`)
            .addFields(
                { name: '🆔 Club ID', value: clubId.toString(), inline: true },
                { name: '🔗 Slug', value: `\`${basicData.slug || generateSlug(basicData.clubName)}\``, inline: true },
                { name: '✅ Email Verified', value: '✅ Verified', inline: true },
                { name: '👤 President', value: `<@${basicData.userId}>`, inline: true },
                { name: '📂 Category', value: basicData.category.charAt(0).toUpperCase() + basicData.category.slice(1), inline: true },
                { name: '📧 Club Email', value: basicData.clubEmail, inline: true },
                { name: '📝 Description', value: basicData.description.length > 1000 ? basicData.description.substring(0, 997) + '...' : basicData.description }
            );

        if (additionalData.advisorName) {
            approvalEmbed.addFields({ name: '👨‍🏫 Faculty Advisor', value: additionalData.advisorName, inline: true });
        }

        if (additionalData.maxMembers) {
            approvalEmbed.addFields({ name: '👥 Max Members', value: additionalData.maxMembers.toString(), inline: true });
        }

        if (additionalData.meetingData.day) {
            const meetingInfo = `${additionalData.meetingData.day}s at ${additionalData.meetingData.time || 'TBA'}\n` +
                               `Location: ${additionalData.meetingData.location || 'TBA'}\n` +
                               `Frequency: ${additionalData.meetingData.frequency || 'Weekly'}`;
            approvalEmbed.addFields({ name: '📅 Meeting Schedule', value: meetingInfo, inline: false });
        }

        if (additionalData.clubVision) {
            approvalEmbed.addFields({ name: '🎯 Vision & Goals', value: additionalData.clubVision.substring(0, 500), inline: false });
        }

        if (additionalData.parsedContact.phone || additionalData.parsedContact.website || additionalData.parsedContact.social) {
            let contactText = '';
            if (additionalData.parsedContact.phone) contactText += `📞 ${additionalData.parsedContact.phone}\n`;
            if (additionalData.parsedContact.website) contactText += `🌐 ${additionalData.parsedContact.website}\n`;
            if (additionalData.parsedContact.social) contactText += `📱 ${additionalData.parsedContact.social}`;
            
            approvalEmbed.addFields({ name: '📞 Contact Information', value: contactText, inline: false });
        }

        if (basicData.logoUrl) {
            approvalEmbed.setThumbnail(basicData.logoUrl);
        }

        approvalEmbed.addFields({
            name: '⚙️ Action Required',
            value: `Use the buttons below or run:\n\`/clubs approve club_id:${clubId}\``
        });

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

    } catch (error) {
        log('Error sending to approval channel', 'club', null, error, 'error');
    }
}

// Helper functions
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseContactInfo(contactText) {
    const result = { phone: null, website: null, social: null };
    if (!contactText) return result;

    const lines = contactText.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        
        if (trimmed.toLowerCase().includes('phone:')) {
            result.phone = trimmed.split(':')[1]?.trim();
        } else if (/^[\d\s\+\-\(\)]+$/.test(trimmed) && trimmed.length >= 7) {
            result.phone = trimmed;
        }
        
        if (trimmed.toLowerCase().includes('website:')) {
            result.website = trimmed.split(':')[1]?.trim();
        } else if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            result.website = trimmed;
        }
        
        if (trimmed.toLowerCase().includes('social') || trimmed.includes('@')) {
            result.social = trimmed.split(':')[1]?.trim() || trimmed;
        }
    }
    return result;
}

function parseMeetingSchedule(scheduleText) {
    const result = { day: null, time: null, location: null, frequency: 'Weekly' };
    if (!scheduleText) return result;

    const lines = scheduleText.split('\n');
    for (const line of lines) {
        const lower = line.toLowerCase();
        
        if (lower.includes('day:')) {
            result.day = line.split(':')[1]?.trim();
        } else if (lower.includes('time:')) {
            result.time = line.split(':')[1]?.trim();
        } else if (lower.includes('location:')) {
            result.location = line.split(':')[1]?.trim();
        } else if (lower.includes('frequency:')) {
            result.frequency = line.split(':')[1]?.trim();
        }
    }
    return result;
}