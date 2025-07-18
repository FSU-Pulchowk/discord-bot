import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';

/**
 * Fetches a URL using Puppeteer headless browser.
 * @param {string} url - The URL to fetch.
 * @returns {Promise<string|null>} - The HTML content or null on failure.
 */
async function fetchWithBrowser(url) {
    console.log(`[Browser] Launching browser to fetch ${url}...`);
    let browser = null;
    try {
        browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });

        const page = await browser.newPage();
        await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36'
        );

        console.log(`[Browser] Navigating to ${url}...`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 120000 });

        console.log(`[Browser] Page loaded, extracting content...`);
        const content = await page.content();

        return content;
    } catch (error) {
        console.error(`[Browser] Failed to fetch ${url}: ${error.message}`);
        return null;
    } finally {
        if (browser) {
        console.log('[Browser] Closing browser...');
        await browser.close();
        }
    }
}

/**
 * Scrapes IOE Exam Notices.
 * @returns {Promise<Array>} List of notices.
 */
export async function scrapeIoeExamNotice() {
    const url = 'http://exam.ioe.edu.np/';
    const data = await fetchWithBrowser(url);
    if (!data) {
        console.error('[Scraper] Could not retrieve IOE Exam data.');
        return [];
    }

    const $ = cheerio.load(data);
    const notices = [];

    $('#datatable tbody tr').each((_, el) => {
        const row = $(el);
        const titleEl = row.find('td:nth-child(2) a');
        const dateEl = row.find('td:nth-child(3)');
        const viewLinkEl = row.find('td:nth-child(4) a[href*="/Notice/Index/"]');
        const downloadLinkEl = row.find('td:nth-child(4) a[target="_blank"]');

        if (titleEl.length && dateEl.length && viewLinkEl.length && downloadLinkEl.length) {
        notices.push({
            title: titleEl.text().trim(),
            date: dateEl.text().trim(),
            link: new URL(viewLinkEl.attr('href'), url).href,
            attachments: [new URL(downloadLinkEl.attr('href'), url).href],
            source: 'IOE Exam Section',
        });
        }
    });

    console.log(`[Scraper] Found ${notices.length} IOE Exam notices.`);
    return notices;
}

/**
 * Scrapes latest Pulchowk Campus Notice.
 * @returns {Promise<Object|null>} Latest notice or null.
 */
export async function scrapePcampusNotice() {
    const listUrl = 'https://pcampus.edu.np/category/general-notices/';
    const listData = await fetchWithBrowser(listUrl);
    if (!listData) {
        console.error('[Scraper] Could not retrieve Pulchowk Campus notices.');
        return null;
    }

    const $list = cheerio.load(listData);
    const latestArticle = $list('article').first();

    if (!latestArticle.length) {
        console.warn('[Scraper] No articles found on Pulchowk Campus notices page.');
        return null;
    }

    const title = latestArticle.find('h2.entry-title a').text().trim();
    const pageLink = latestArticle.find('h2.entry-title a').attr('href');
    const date = latestArticle.find('time.entry-date').attr('datetime');
    const postId = latestArticle.attr('id');

    if (!pageLink) {
        console.error('[Scraper] No valid link found in Pulchowk notice.');
        return null;
    }

    const pageData = await fetchWithBrowser(pageLink);
    if (!pageData) {
        console.error(`[Scraper] Could not retrieve Pulchowk notice detail page ${pageLink}.`);
        return null;
    }

    const $page = cheerio.load(pageData);
    const attachments = [];
    $page('.entry-content a').each((_, el) => {
        const href = $page(el).attr('href');
        if (href && href.includes('/wp-content/uploads/')) {
        attachments.push(new URL(href, pageLink).href);
        }
    });

    console.log(`[Scraper] Found Pulchowk notice titled "${title}".`);

    return {
        id: postId,
        title,
        link: pageLink,
        attachments: [...new Set(attachments)],
        date,
        source: 'Pulchowk Campus',
    };
}

/**
 * Scrapes all notices and combines them.
 * @returns {Promise<Array>} Combined notice list.
 */
export async function scrapeLatestNotice() {
    console.log('[Scraper] Starting full scrape...');
    const [ioeNotices, pcampusNotice] = await Promise.all([
        scrapeIoeExamNotice(),
        scrapePcampusNotice(),
    ]);

    const combined = [...(ioeNotices || []), ...(pcampusNotice ? [pcampusNotice] : [])];
    console.log(`[Scraper] Scraped total ${combined.length} notices.`);
    return combined;
}