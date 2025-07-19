import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth'; 

puppeteer.use(StealthPlugin());

/**
 * Sleeps for a given number of milliseconds.
 * @param {number} ms - The number of milliseconds to sleep.
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetches HTML content using Puppeteer for dynamic content sites (like IOE exam site).
 * Implements retry mechanism and stealth plugin.
 * @param {string} url - The URL to fetch.
 * @param {number} retries - Number of retries for the request.
 * @param {number} delay - Delay between retries in milliseconds.
 * @returns {Promise<string|null>} - HTML content or null on failure.
 */
async function fetchWithPuppeteer(url, retries = 3, delay = 5000) {
    let browser;
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`[Puppeteer] Attempt ${i + 1} to fetch ${url}...`);
            browser = await puppeteer.launch({
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-gpu',
                    '--no-zygote',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage'
                ],
                headless: true
            });
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36');
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }); // Increased to 60 seconds
            await page.waitForSelector('#datatable tbody tr', { timeout: 30000 }); // Increased to 30 seconds

            const content = await page.content();
            console.log(`[Puppeteer] Successfully fetched ${url}.`);
            return content;
        } catch (error) {
            console.error(`[Puppeteer] Failed to fetch ${url} on attempt ${i + 1}: ${error.message}`);
            if (browser) {
                await browser.close();
                browser = null;
            }
            if (i < retries - 1) {
                console.log(`[Puppeteer] Retrying in ${delay / 1000} seconds...`);
                await sleep(delay);
            }
        } finally {
            if (browser) await browser.close();
        }
    }
    console.error(`[Puppeteer] All ${retries} attempts failed for ${url}.`);
    return null;
}

/**
 * Fetches a URL using Axios for static sites.
 * Implements retry mechanism.
 * @param {string} url - The URL to fetch.
 * @param {number} retries - Number of retries for the request.
 * @param {number} delay - Delay between retries in milliseconds.
 * @returns {Promise<string|null>} - HTML content or null on failure.
 */
async function fetchWithAxios(url, retries = 3, delay = 5000) {
    for (let i = 0; i < retries; i++) {
        console.log(`[HTTP] Attempt ${i + 1} to fetch ${url} with axios...`);
        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
                },
                timeout: 30000, // Increased to 30 seconds
            });
            console.log(`[HTTP] Successfully fetched ${url} with axios.`);
            return response.data;
        } catch (error) {
            console.error(`[HTTP] Failed to fetch ${url} on attempt ${i + 1}: ${error.message}`);
            if (i < retries - 1) {
                console.log(`[HTTP] Retrying in ${delay / 1000} seconds...`);
                await sleep(delay);
            }
        }
    }
    console.error(`[HTTP] All ${retries} attempts failed for ${url}.`);
    return null;
}

/**
 * Scrapes IOE Exam Notices using Puppeteer and your Cloudflare proxy.
 */
export async function scrapeIoeExamNotice() {
    const url = 'https://proxy.abhishekkharel.com.np/discord-bot/http/exam.ioe.edu.np';
    const data = await fetchWithPuppeteer(url); // Use default retries and delay
    if (!data) {
        console.error('[Scraper] Could not retrieve IOE Exam data after multiple attempts.');
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
            const noticeLink = new URL(viewLinkEl.attr('href'), url).href;
            const attachmentLink = new URL(downloadLinkEl.attr('href'), url).href;

            notices.push({
                title: titleEl.text().trim(),
                date: dateEl.text().trim(),
                link: noticeLink,
                attachments: [attachmentLink],
                source: 'IOE Exam Section',
            });
        }
    });

    console.log(`[Scraper] Found ${notices.length} IOE Exam notices.`);
    return notices;
}

/**
 * Scrapes Pulchowk Campus Notices (static, so Axios + Cheerio is fine).
 */
export async function scrapePcampusNotice() {
    const listUrl = 'https://pcampus.edu.np/category/general-notices/';
    const listData = await fetchWithAxios(listUrl); // Use default retries and delay
    if (!listData) {
        console.error('[Scraper] Could not retrieve Pulchowk Campus notices after multiple attempts.');
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

    const pageData = await fetchWithAxios(pageLink); // Use default retries and delay
    if (!pageData) {
        console.error(`[Scraper] Could not retrieve Pulchowk notice detail page ${pageLink} after multiple attempts.`);
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