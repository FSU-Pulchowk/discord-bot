/**
 * Advanced spam detection utility with tiered trust levels
 * Detects financial scams, external links, and suspicious patterns with context awareness
 */

import { PermissionsBitField } from 'discord.js';

/**
 * Detects if a message contains spam patterns using a point-based system
 * @param {string} content - The message content to check
 * @param {Object} member - The Discord GuildMember object
 * @param {boolean} isVerified - Whether the user is in the verified_users database
 * @returns {Object} - { isSpam: boolean, reason: string, severity: 'high'|'medium'|'low', score: number }
 */
export function detectSpam(content, member = null, isVerified = false) {
    if (!content || typeof content !== 'string') {
        return { isSpam: false, reason: null, severity: null, score: 0 };
    }

    const lowerContent = content.toLowerCase();
    const normalizedContent = lowerContent.replace(/[^\w\s@]/g, ' ').replace(/\s+/g, ' ');

    let score = 0;
    const reasons = [];

    // --- 1. Trusted Domains (Negative score/Weights) ---
    const trustedDomains = [
        'google.com', 'pcampus.edu.np', 'github.com', 'discord.com', 
        'zoom.us', 'microsoft.com', 'youtube.com', 'facebook.com', 
        'instagram.com', 'twitter.com', 'linkedin.com', 'stackoverflow.com'
    ];
    
    const urlPattern = /(https?:\/\/|www\.)[^\s/$.?#].[^\s]*/gi;
    const urls = content.match(urlPattern) || [];
    let riskyUrlCount = 0;

    for (const url of urls) {
        let isTrusted = false;
        for (const domain of trustedDomains) {
            if (url.toLowerCase().includes(domain)) {
                isTrusted = true;
                break;
            }
        }
        if (!isTrusted) {
            riskyUrlCount++;
        }
    }

    if (riskyUrlCount > 0) {
        score += riskyUrlCount * 1.5;
        reasons.push(`${riskyUrlCount} untrusted link(s)`);
    }

    // --- 2. High Severity Patterns (Direct Point Addition) ---
    const patterns = [
        { regex: /\$?\d+[km]?\s*(or\s*more)?\s*(within|in)\s*(a\s*)?(week|day|month)/i, points: 4, reason: 'Financial promise' },
        { regex: /earn(ing)?\s*\$?\d+[km]?\s*(or\s*more)?\s*(within|in)/i, points: 4, reason: 'Earnings hook' },
        { regex: /reimburse\s*me\s*\d+%/i, points: 3, reason: 'Reimbursement scheme' },
        { regex: /profit.*once\s*you\s*receive/i, points: 4, reason: 'Advance fee scam' },
        { regex: /only\s*serious.*interested/i, points: 2, reason: 'Suspicious urgency' },
        { regex: /send\s*me\s*(a\s*)?(friend\s*request|dm|direct\s*message)/i, points: 1.5, reason: 'Contact request' },
        { regex: /ask\s*me\s*how/i, points: 2.3, reason: 'Coaching/Scheme bait' },
        { regex: /(@\w+.*telegram|via\s*telegram|t\.me\/)/i, points: 3.5, reason: 'Telegram redirection' },
        { regex: /link\s*in\s*bio/i, points: 2.5, reason: 'Social redirection' },
        { regex: /(whatsapp|signal|line|viber).*@?\d+/i, points: 3.5, reason: 'External messaging' },
        { regex: /guaranteed\s*(profit|earnings|income|money)/i, points: 4, reason: 'Guaranteed returns' },
        { regex: /make\s*money\s*(fast|quick|easy|now)/i, points: 3, reason: 'Get-rich-quick' },
        { regex: /passive\s*income.*guaranteed/i, points: 4, reason: 'Passive income scam' },
        { regex: /first\s*\d+\s*(people|person)/i, points: 2, reason: 'False scarcity' },
        { regex: /exclusive\s*opportunity/i, points: 2, reason: 'Exclusive bait' },
        { regex: /free\s*money/i, points: 5, reason: 'Free money scam' },
        { regex: /crypto.*investment.*guaranteed/i, points: 5, reason: 'Crypto scam' },
    ];

    for (const p of patterns) {
        if (p.regex.test(content) || p.regex.test(normalizedContent)) {
            score += p.points;
            reasons.push(p.reason);
        }
    }

    // --- 3. Suspicious Keyword Scoring ---
    const suspiciousKeywords = [
        'earn', 'profit', 'income', 'investment', 
        'limited', 'offer', 'spots', 'slots', 
        'reimburse', 'serious', 'dm me', 'contact'
    ];

    let keywordMatches = 0;
    for (const keyword of suspiciousKeywords) {
        const regex = new RegExp(`\\b${keyword}\\b`, 'i');
        if (regex.test(content)) {
            keywordMatches++;
        }
    }
    score += (keywordMatches * 0.5);

    // --- 4. Tiered Thresholds ---
    let threshold = 3.5; // Base threshold (Tier 1: New/Guest)
    let userTier = 'Tier 1 (Guest)';

    if (member) {
        const roles = member.roles.cache;
        const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator) || 
                        member.permissions.has(PermissionsBitField.Flags.ManageMessages);
        
        // Define "Important" role IDs (from env logic in bot.js)
        const importantRoleIds = [
            process.env.ADMIN_ROLE_ID,
            process.env.MODERATOR_ROLE_ID,
            process.env.FSU_EXECUTIVE_ROLE_ID,
            process.env.CLUB_PRESIDENT_ROLE_ID
        ].filter(Boolean);

        const hasImportantRole = importantRoleIds.some(id => roles.has(id));

        if (isAdmin || hasImportantRole) {
            threshold = 9.0; // High threshold for Tier 3 (Important People)
            userTier = 'Tier 3 (Important/Admin)';
        } else if (isVerified) {
            threshold = 5.5; // Medium threshold for Tier 2 (Verified Members)
            userTier = 'Tier 2 (Verified Member)';
        }
    }

    // Special case: If score is EXTREMELY high (blatant scam), even admins might be compromised
    const isBlatantScam = score >= 12;

    const isSpam = score >= threshold;
    const severity = score >= (threshold + 4) || isBlatantScam ? 'high' : (score >= threshold ? 'medium' : 'low');

    return {
        isSpam,
        reason: isSpam ? `Detected patterns: ${reasons.join(', ')} (${userTier})` : null,
        severity: isSpam ? severity : null,
        score,
        userTier
    };
}

/**
 * Legacy check for internal use
 * @param {string} content 
 * @returns {boolean}
 */
export function matchesKnownSpamPattern(content) {
    const result = detectSpam(content);
    return result.isSpam && result.score >= 7;
}

