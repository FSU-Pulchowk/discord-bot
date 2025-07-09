import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Scrapes the latest notice from the IOE Exam Section website.
 * @returns {Promise<object|null>} A notice object or null on error.
 */
async function scrapeIoeExamNotice() {
    const url = 'http://exam.ioe.edu.np/';
    try {
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);
        const latestNoticeElement = $('.panel-body ul li').first();
        const linkElement = latestNoticeElement.find('a');

        if (linkElement.length) {
        const title = linkElement.text().trim();
        let relativeLink = linkElement.attr('href');
        const link = new URL(relativeLink, url).href;
        const date = new Date().toISOString(); 

        return {
            title,
            link,
            date,
            source: 'IOE Exam Section'
        };
        }
        console.warn(`[Scraper] Could not find notice element on ${url}`);
        return null;

    } catch (error) {
        console.error(`[Scraper] Error scraping ${url}:`, error.message);
        return null;
    }
}

// --- Helper function to scrape Pulchowk Campus ---
/**
 * Scrapes the latest notice from the Pulchowk Campus website.
 * It first finds the latest notice page, then scrapes that page for attachment links.
 * @returns {Promise<object|null>} A notice object with attachments, or null on error.
 */
async function scrapePcampusNotice() {
    const listUrl = 'https://pcampus.edu.np/category/general-notices/';
    try {
        const { data: listData } = await axios.get(listUrl);
        const $list = cheerio.load(listData);

        const latestArticle = $list('article').first();
        if (!latestArticle.length) {
            console.warn(`[Scraper] Could not find notice article on ${listUrl}`);
            return null;
        }

        const titleElement = latestArticle.find('h2.entry-title a');
        const title = titleElement.text().trim();
        const pageLink = titleElement.attr('href');
        const date = latestArticle.find('time.entry-date').attr('datetime');
        const postId = latestArticle.attr('id');

        if (!pageLink) {
            console.warn(`[Scraper] Could not find a link to the notice details page on ${listUrl}`);
            return null;
        }
        const { data: pageData } = await axios.get(pageLink);
        const $page = cheerio.load(pageData);

        const attachments = [];
        $page('.entry-content a').each((i, el) => {
            const href = $page(el).attr('href');
            if (href && href.includes('/wp-content/uploads/')) {
                const absoluteUrl = new URL(href, pageLink).href;
                attachments.push(absoluteUrl);
            }
        });

        return {
            id: postId,
            title,
            link: pageLink, 
            attachments: [...new Set(attachments)],
            date,
            source: 'Pulchowk Campus'
        };

    } catch (error) {
        console.error(`[Scraper] Error scraping Pulchowk Campus: ${error.message}`);
        return null;
    }
}


/**
 * Scrapes the latest notices from predefined sources (IOE and Pulchowk Campus).
 * This function fetches notices from all sources concurrently and returns a
 * filtered list of the results.
 *
 * @returns {Promise<Array<object>>} An array of the latest notice objects from each source.
 * The structure of each object may vary. Pulchowk Campus notices will include an `attachments` array.
 */
async function scrapeLatestNotice() {
    console.log('[Scraper] Starting scrape for latest notices...');
    const results = await Promise.all([
        scrapeIoeExamNotice(),
        scrapePcampusNotice(),
    ]);
    const validNotices = results.filter(notice => notice !== null);
    console.log(`[Scraper] Found ${validNotices.length} valid notice(s).`);
    return validNotices;
}

export { scrapeLatestNotice };
