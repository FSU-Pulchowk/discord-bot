/**
 * Advanced spam detection utility
 * Detects various spam patterns including financial scams, external links, and suspicious content
 */

/**
 * Detects if a message contains spam patterns
 * @param {string} content - The message content to check
 * @returns {Object} - { isSpam: boolean, reason: string, severity: 'high'|'medium'|'low' }
 */
export function detectSpam(content) {
    if (!content || typeof content !== 'string') {
        return { isSpam: false, reason: null, severity: null };
    }

    const lowerContent = content.toLowerCase();
    const normalizedContent = lowerContent.replace(/[^\w\s@]/g, ' ').replace(/\s+/g, ' ');

    // High severity patterns - immediate ban
    const highSeverityPatterns = [
        // Financial scam patterns
        /\$(\d+)?k?\s*(or\s*more)?\s*(within|in)\s*(a\s*)?(week|day|month)/i,
        /earn(ing)?\s*\$?\d+[km]?\s*(or\s*more)?\s*(within|in)/i,
        /reimburse\s*me\s*\d+%/i,
        /profit.*once\s*you\s*receive/i,
        /only\s*serious.*interested/i,
        /send\s*me\s*(a\s*)?(friend\s*request|dm|direct\s*message)/i,
        /ask\s*me\s*how/i,
        /via\s*telegram/i,
        /@\w+.*telegram/i,
        /link\s*in\s*bio/i,
        
        // External platform requests
        /(telegram|whatsapp|signal|discord|instagram|facebook|twitter).*@/i,
        /contact\s*me\s*(on|via|through)/i,
        /dm\s*me\s*(for|to|on)/i,
        
        // Suspicious financial language
        /guaranteed\s*(profit|earnings|income|money)/i,
        /make\s*money\s*(fast|quick|easy|now)/i,
        /passive\s*income.*guaranteed/i,
        /investment.*return.*guaranteed/i,
        /no\s*risk.*high\s*return/i,
        
        // Pyramid scheme patterns
        /first\s*\d+\s*(people|person)/i,
        /limited\s*(spots|slots|offers?)/i,
        /exclusive\s*opportunity/i,
    ];

    // Medium severity patterns - timeout/warning
    const mediumSeverityPatterns = [
        /(click|check|visit).*(link|url|website|site)/i,
        /free\s*money/i,
        /get\s*rich\s*quick/i,
        /work\s*from\s*home.*\$?\d+/i,
        /crypto.*investment.*guaranteed/i,
    ];

    // Check high severity patterns
    for (const pattern of highSeverityPatterns) {
        if (pattern.test(content) || pattern.test(normalizedContent)) {
            return {
                isSpam: true,
                reason: 'Detected high-severity spam pattern (financial scam/external contact)',
                severity: 'high'
            };
        }
    }

    // Check for multiple suspicious keywords (scoring system)
    const suspiciousKeywords = [
        'earn', 'profit', 'money', 'income', 'investment', 'guaranteed',
        'telegram', 'dm me', 'friend request', 'contact me', 'link in bio',
        'reimburse', 'serious', 'interested', 'exclusive', 'limited',
        'first 10', 'first 5', 'first 20', 'within a week', 'within days'
    ];

    let suspiciousScore = 0;
    for (const keyword of suspiciousKeywords) {
        const regex = new RegExp(keyword.replace(/\s+/g, '\\s+'), 'i');
        if (regex.test(content)) {
            suspiciousScore++;
        }
    }

    // If 3+ suspicious keywords found, it's likely spam
    if (suspiciousScore >= 3) {
        return {
            isSpam: true,
            reason: `Multiple suspicious keywords detected (${suspiciousScore} matches)`,
            severity: 'high'
        };
    }

    // Check medium severity patterns
    for (const pattern of mediumSeverityPatterns) {
        if (pattern.test(content) || pattern.test(normalizedContent)) {
            return {
                isSpam: true,
                reason: 'Detected medium-severity spam pattern',
                severity: 'medium'
            };
        }
    }

    // Check for URLs (especially suspicious domains)
    const urlPattern = /(https?:\/\/|www\.|t\.me|telegram\.me|discord\.gg|discord\.com\/invite)/i;
    if (urlPattern.test(content) && suspiciousScore >= 2) {
        return {
            isSpam: true,
            reason: 'Suspicious URL with multiple spam keywords',
            severity: 'high'
        };
    }

    return { isSpam: false, reason: null, severity: null };
}

/**
 * Checks if content matches the specific spam pattern provided by user
 * @param {string} content - The message content to check
 * @returns {boolean}
 */
export function matchesKnownSpamPattern(content) {
    if (!content || typeof content !== 'string') return false;

    const lowerContent = content.toLowerCase();
    
    // Check for the specific pattern from the user's example
    const hasFinancialPromise = /\$?\d+[km]?\s*(or\s*more)?\s*(within|in)\s*(a\s*)?(week|day)/i.test(content);
    const hasReimburse = /reimburse.*\d+%/i.test(content);
    const hasSeriousRequest = /(only\s*serious|interested).*(friend\s*request|dm|send\s*me)/i.test(content);
    const hasTelegram = /(telegram|@\w+.*telegram|via\s*telegram)/i.test(content);
    const hasLinkInBio = /link\s*in\s*bio/i.test(content);
    const hasAskHow = /ask\s*me\s*(how|via)/i.test(content);

    // If multiple indicators are present, it's the known spam pattern
    const indicators = [hasFinancialPromise, hasReimburse, hasSeriousRequest, hasTelegram, hasLinkInBio, hasAskHow];
    const matchCount = indicators.filter(Boolean).length;

    return matchCount >= 3; // At least 3 indicators match
}

