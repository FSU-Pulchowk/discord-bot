import { gotScraping } from 'got-scraping';
import * as cheerio from 'cheerio';

/**
 * Fetches a URL using got-scraping, which automatically handles proxies,
 * retries, and browser-like headers to avoid blocking.
 * @param {string} url - The URL to fetch.
 * @returns {Promise<string|null>} - The HTML data from the URL, or null on failure.
 */
async function fetchWithScraping(url) {
  console.log(`[Scraper] Fetching ${url}...`);
  try {
    // got-scraping automatically uses the PROXY_URL env var if you set it.
    // It also has smart retry logic and generates browser-like headers.
    const response = await gotScraping({
      url: url,
      // Set a generous timeout and retry limit.
      timeout: { request: 120000 }, // 2-minute timeout for the request
      retry: { limit: 5 }, // Retry up to 5 times on failure
      // Generates realistic browser headers to avoid being detected as a bot.
      headerGeneratorOptions: {
        browsers: ['chrome'],
        devices: ['desktop'],
        locales: ['en-US', 'en'],
        operatingSystems: ['windows', 'linux', 'macos'],
      },
    });
    return response.body;
  } catch (error) {
    console.error(`[Scraper] Failed to fetch ${url} after all retries. Error: ${error.message}`);
    // Return null so the calling function can handle the failure gracefully.
    return null;
  }
}

/**
 * Scrapes the latest notices from the IOE Examination Control Division website.
 * @returns {Promise<Array<object>>} - A list of notice objects.
 */
export async function scrapeIoeExamNotice() {
  const url = 'http://exam.ioe.edu.np/';
  try {
    const data = await fetchWithScraping(url);
    if (!data) {
      console.error('[Scraper] Could not retrieve data from IOE Exam Section. Skipping.');
      return [];
    }
    const $ = cheerio.load(data);
    const notices = [];

    $('#datatable tbody tr').each((_, el) => {
      const row = $(el);
      const titleElement = row.find('td:nth-child(2) a');
      const dateElement = row.find('td:nth-child(3)');
      const viewLinkElement = row.find('td:nth-child(4) a[href*="/Notice/Index/"]');
      const downloadLinkElement = row.find('td:nth-child(4) a[target="_blank"]');

      if (titleElement.length && dateElement.length && viewLinkElement.length && downloadLinkElement.length) {
        const title = titleElement.text().trim();
        const date = dateElement.text().trim();
        const noticePageLink = new URL(viewLinkElement.attr('href'), url).href;
        const pdfLink = new URL(downloadLinkElement.attr('href'), url).href;

        notices.push({
          title,
          link: noticePageLink,
          attachments: [pdfLink],
          date,
          source: 'IOE Exam Section',
        });
      }
    });

    console.log(`[Scraper] Found ${notices.length} notices from IOE Exam Section.`);
    return notices;
  } catch (err) {
    console.error(`[Scraper] An error occurred during scrapeIoeExamNotice: ${err.message}`);
    return [];
  }
}

/**
 * Scrapes the latest notice from the Pulchowk Campus website.
 * @returns {Promise<object|null>} - A single notice object or null on failure.
 */
export async function scrapePcampusNotice() {
  const listUrl = 'https://pcampus.edu.np/category/general-notices/';
  try {
    const listData = await fetchWithScraping(listUrl);
    if (!listData) {
      console.error('[Scraper] Could not retrieve data from Pulchowk Campus notices. Skipping.');
      return null;
    }

    const $list = cheerio.load(listData);
    const latestArticle = $list('article').first();
    if (latestArticle.length === 0) {
        console.warn('[Scraper] No articles found on the Pulchowk Campus notice page.');
        return null;
    }

    const title = latestArticle.find('h2.entry-title a').text().trim();
    const pageLink = latestArticle.find('h2.entry-title a').attr('href');
    const date = latestArticle.find('time.entry-date').attr('datetime');
    const postId = latestArticle.attr('id');

    if (!pageLink) {
        console.error('[Scraper] Could not find page link in the latest article on Pulchowk Campus.');
        return null;
    }

    const pageData = await fetchWithScraping(pageLink);
    if (!pageData) {
        console.error(`[Scraper] Could not retrieve notice detail page ${pageLink}. Skipping.`);
        return null;
    }

    const $page = cheerio.load(pageData);
    const attachments = [];

    $page('.entry-content a').each((_, el) => {
      const href = $page(el).attr('href');
      if (href?.includes('/wp-content/uploads/')) {
        attachments.push(new URL(href, pageLink).href);
      }
    });

    console.log(`[Scraper] Found notice "${title}" from Pulchowk Campus.`);
    return {
      id: postId,
      title,
      link: pageLink,
      attachments: [...new Set(attachments)],
      date,
      source: 'Pulchowk Campus',
    };
  } catch (err) {
    console.error(`[Scraper] An error occurred during scrapePcampusNotice: ${err.message}`);
    return null;
  }
}

/**
 * Scrapes and combines the latest notices from all sources.
 * @returns {Promise<Array<object>>} - A combined list of notice objects.
 */
export async function scrapeLatestNotice() {
  console.log('[Scraper] Starting scrape for all notice sources...');
  const [ioe, pcampus] = await Promise.all([
    scrapeIoeExamNotice(),
    scrapePcampusNotice(),
  ]);
  
  const allNotices = [...(ioe || []), ...(pcampus ? [pcampus] : [])];
  console.log(`[Scraper] Total notices scraped: ${allNotices.length}`);
  return allNotices;
}