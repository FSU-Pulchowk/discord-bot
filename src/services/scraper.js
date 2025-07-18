import puppeteer from 'puppeteer-core';
import chromium from 'chrome-aws-lambda';
import * as cheerio from 'cheerio';

/**
 * Fetches a URL using a headless browser (Puppeteer), which is robust
 * against anti-scraping measures like Cloudflare.
 * @param {string} url - The URL to fetch.
 * @returns {Promise<string|null>} - The HTML data from the URL, or null on failure.
 */
async function fetchWithBrowser(url) {
  console.log(`[Browser] Launching browser to fetch ${url}...`);
  let browser = null;
  try {
    const executablePath = await chromium.executablePath;
    if (!executablePath) {
        throw new Error('Chromium executable not found. Set up a local path for development if needed.');
    }

    browser = await puppeteer.launch({
        args: chromium.args,
        executablePath: executablePath,
        headless: chromium.headless,
    });

    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36');

    console.log(`[Browser] Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 120000 });

    console.log(`[Browser] Page loaded successfully. Getting content...`);
    const content = await page.content();
    
    return content;
  } catch (error) {
    console.error(`[Browser] Failed to fetch ${url} with headless browser. Error: ${error.message}`);
    return null;
  } finally {
    if (browser !== null) {
      console.log('[Browser] Closing browser.');
      await browser.close();
    }
  }
}

/**
 * Scrapes the latest notices from the IOE Examination Control Division website.
 * @returns {Promise<Array<object>>} - A list of notice objects.
 */
export async function scrapeIoeExamNotice() {
  const url = 'http://exam.ioe.edu.np/';
  try {
    const data = await fetchWithBrowser(url);
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
    const listData = await fetchWithBrowser(listUrl);
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

    const pageData = await fetchWithBrowser(pageLink);
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