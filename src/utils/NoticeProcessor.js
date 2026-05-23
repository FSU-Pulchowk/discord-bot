import path from 'path';
import { promises as fsPromises, createWriteStream } from 'fs';
import axios from 'axios';
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { fromPath } from 'pdf2pic';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { scrapeLatestNotice } from '../services/scraper.js';

/**
 * NoticeProcessor handles the lifecycle of discovering, downloading, 
 * converting, and publishing academic/institutional notices to Discord channels.
 * * Key architectural features:
 * - Robust error handling with dynamic exponential backoff retries.
 * - Single-file isolation during downloads to prevent EISDIR (Directory injection) crashes.
 * - Multi-page PDF to PNG split-conversion using pdf2pic and pdfjs-dist.
 * - Memory and disk-space-safe size checking guards.
 * - Fragmented attachment uploading to bypass Discord's payload size limits.
 * - Browser header spoofing and Referer injection to bypass portal hotlink protection.
 */
class NoticeProcessor {
    /**
     * @param {Object} client - The Discord.js Client instance containing database or context references.
     * @param {Object} debugConfig - Logger configuration managing levels and logging targets.
     * @param {Object} colors - Styling/aesthetic definitions for console outputs or embeds.
     */
    constructor(client, debugConfig, colors) {
        this.client = client;
        this.debugConfig = debugConfig;
        this.colors = colors;
        
        // Limits & Constants
        this.MAX_FILE_SIZE = 25 * 1024 * 1024; // Individual file boundary (25 MB)
        this.MAX_TOTAL_ATTACHMENT_SIZE = 25 * 1024 * 1024; // Consolidated payload limit (25 MB)
        this.ATTACHMENT_CHUNK_SIZE = 10; // Discord max attachments per message
        this.REQUEST_TIMEOUT = 30000; // Network timeout (30 seconds)
        this.RETRY_ATTEMPTS = 3; // Maximum operational retries
        this.RETRY_DELAY = 2000; // Delay base before retry (2 seconds)
        this.SCRAPE_TIMEOUT_MS = 10 * 60 * 1000; // Notice scraping maximum duration (10 minutes)
    }

    /**
     * Evaluates latest announcements and publishes new updates to targeted Discord channels.
     * Implements isolated, temporary workspaces per notice index.
     * @returns {Promise<void>}
     */
    async checkAndAnnounceNotices() {
        this.debugConfig.log('Starting enhanced notice check...', 'scheduler');

        const TARGET_NOTICE_CHANNEL_ID = process.env.TARGET_NOTICE_CHANNEL_ID;
        const NOTICE_ADMIN_CHANNEL_ID  = process.env.NOTICE_ADMIN_CHANNEL_ID;
        const TEMP_PARENT_DIR = path.join(process.cwd(), 'temp_notice_attachments');

        let adminChannel;

        try {
            if (!TARGET_NOTICE_CHANNEL_ID || TARGET_NOTICE_CHANNEL_ID === 'YOUR_NOTICE_CHANNEL_ID_HERE') {
                this.debugConfig.log(
                    'TARGET_NOTICE_CHANNEL_ID not configured. Skipping notice announcements.',
                    'scheduler', null, null, 'warn'
                );
                return;
            }

            // Establish the root temp directory
            await this.ensureTempDirectory(TEMP_PARENT_DIR);

            const channels = await this.fetchChannelsWithTimeout(
                TARGET_NOTICE_CHANNEL_ID,
                NOTICE_ADMIN_CHANNEL_ID
            );
            const noticeChannel = channels.noticeChannel;
            adminChannel        = channels.adminChannel;

            // Fetch latest notices with a safety timeout guard
            const scrapedNotices = await this.scrapeNoticesWithTimeout();
            if (!scrapedNotices || scrapedNotices.length === 0) {
                this.debugConfig.log('No notices found or scraper returned empty.', 'scheduler');
                return;
            }

            // Exclude notices that are too old or already recorded in the system
            const noticesToAnnounce = await this.filterNewNotices(scrapedNotices);
            if (noticesToAnnounce.length === 0) {
                this.debugConfig.log('All scraped notices already announced.', 'scheduler');
                return;
            }

            this.debugConfig.log(`Processing ${noticesToAnnounce.length} new notices.`, 'scheduler');

            for (const [index, notice] of noticesToAnnounce.entries()) {
                // Keep file systems isolated; generate separate folders per notice index
                const noticeDir = path.join(TEMP_PARENT_DIR, `notice_${index}`);

                try {
                    await this.ensureTempDirectory(noticeDir);
                    await this.processNoticeWithRetry(
                        notice, noticeChannel, noticeDir, adminChannel
                    );
                    
                    // Small delay to mitigate rate limits between consecutive notice runs
                    if (index < noticesToAnnounce.length - 1) {
                        await this.sleep(1000);
                    }
                } catch (noticeError) {
                    this.debugConfig.log(
                        `Failed to process notice after retries: ${notice.title}`,
                        'scheduler', null, noticeError, 'error'
                    );
                    if (adminChannel) {
                        await this.sendAdminAlert(
                            adminChannel,
                            `Failed to process notice "${notice.title}": ${noticeError.message}`
                        );
                    }
                } finally {
                    // Safe immediate cleanup of this specific notice's temporary folder
                    await this.cleanupTempDirectory(noticeDir);
                }
            }

        } catch (error) {
            this.debugConfig.log('Critical error during notice checking', 'scheduler', null, error, 'error');
            if (adminChannel) {
                await this.sendAdminAlert(adminChannel, `Critical notice scraping error: ${error.message}`);
            }
        } finally {
            // Ultimate fallback to clean up the shared parent container directory
            await this.cleanupTempDirectory(TEMP_PARENT_DIR);
        }
    }

    /**
     * Tries to process and deliver a single notice with progressive retry backoff.
     * @param {Object} notice - Notice data object.
     * @param {Object} noticeChannel - Target Discord channel object.
     * @param {string} tempDir - Folder path allocated to this notice.
     * @param {Object} adminChannel - Channel object for system/error reporting.
     * @param {number} attempt - Recursive tracking index for operational attempts.
     * @returns {Promise<void>}
     */
    async processNoticeWithRetry(notice, noticeChannel, tempDir, adminChannel, attempt = 1) {
        const tempFilesOnDisk = [];

        try {
            if (!notice?.title || !notice?.link) {
                throw new Error('Invalid notice object: missing title or link');
            }

            const isAlreadyAnnounced = await this.isNoticeAlreadyAnnounced(notice.link);
            if (isAlreadyAnnounced) {
                this.debugConfig.log(`Notice already announced: ${notice.title}`, 'scheduler');
                return;
            }

            this.debugConfig.log(
                `Processing new notice (attempt ${attempt}): ${notice.title}`, 'scheduler'
            );

            const noticeEmbed = this.createNoticeEmbed(notice);
            const { attachments, description } = await this.processNoticeAttachments(
                notice, tempDir, tempFilesOnDisk
            );

            noticeEmbed.setDescription(description);
            
            // Deliver embed and linked media to the targeted Discord server channel
            await this.sendNoticeWithChunkedAttachments(
                noticeChannel, noticeEmbed, attachments, notice.title
            );
            await this.saveNoticeToDatabase(notice);

            this.debugConfig.log(
                `Successfully announced notice: ${notice.title}`,
                'scheduler', null, null, 'success'
            );

        } catch (error) {
            if (attempt < this.RETRY_ATTEMPTS && this.shouldRetry(error)) {
                this.debugConfig.log(
                    `Retrying notice processing (${attempt}/${this.RETRY_ATTEMPTS}): ${notice.title}`,
                    'scheduler', null, null, 'warn'
                );
                await this.sleep(this.RETRY_DELAY * attempt);
                return this.processNoticeWithRetry(
                    notice, noticeChannel, tempDir, adminChannel, attempt + 1
                );
            }
            throw error;
        } finally {
            // Clean up individual dynamic generated files
            await this.cleanupTempFiles(tempFilesOnDisk);
        }
    }

    /**
     * Resolves, downloads, and processes all assets linked within a notice.
     * @param {Object} notice - The notice item being published.
     * @param {string} tempDir - Working directories context.
     * @param {string[]} tempFilesOnDisk - Registry array tracking local temp files.
     * @returns {Promise<{attachments: AttachmentBuilder[], description: string}>}
     */
    async processNoticeAttachments(notice, tempDir, tempFilesOnDisk) {
        let allFilesForNotice = [];
        let description = 'A new notice has been published.';
        let totalSize = 0;

        if (!notice.attachments || notice.attachments.length === 0) {
            return { attachments: allFilesForNotice, description };
        }

        this.debugConfig.log(
            `Processing ${notice.attachments.length} attachments`, 'scheduler'
        );

        for (const [index, attachmentUrl] of notice.attachments.entries()) {
            try {
                const result = await this.processSingleAttachment(
                    attachmentUrl, index, tempDir, tempFilesOnDisk, totalSize
                );

                if (result.files && result.files.length > 0) {
                    allFilesForNotice.push(...result.files);
                    totalSize = result.totalSize;
                } else if (result.error) {
                    // ── FIX: Log the attachment error internally but omit it from the public embed description
                    this.debugConfig.log(
                        `Attachment ${index + 1} (${attachmentUrl}) skipped: ${result.error}`,
                        'scheduler', null, null, 'warn'
                    );
                }

                // Mitigate Discord limit overrides by monitoring cumulative payload size
                if (totalSize > this.MAX_TOTAL_ATTACHMENT_SIZE * 0.8) {
                    this.debugConfig.log(
                        `Total payload limit reached. Skipping subsequent attachments for "${notice.title}".`,
                        'scheduler', null, null, 'warn'
                    );
                    break;
                }

            } catch (attachmentError) {
                this.debugConfig.log(
                    `Error processing attachment ${index + 1}`,
                    'scheduler', null, attachmentError, 'error'
                );
            }
        }

        return { attachments: allFilesForNotice, description };
    }

    /**
     * Downloads an attachment and returns a list of actionable AttachmentBuilders.
     * Instantly intercepts PDFs to convert them into multi-page image streams.
     * @param {string} attachmentUrl - Absolute URL pointing to remote host resource.
     * @param {number} attachmentIndex - Sequential index tracking position context.
     * @param {string} tempDir - Dedicated operational temp subdirectory.
     * @param {string[]} tempFilesOnDisk - Local path references collection.
     * @param {number} currentTotalSize - Cumulative payload size tracking.
     * @returns {Promise<{files?: AttachmentBuilder[], error?: string, totalSize?: number}>}
     */
    async processSingleAttachment(attachmentUrl, attachmentIndex, tempDir, tempFilesOnDisk, currentTotalSize) {
        try {
            this.debugConfig.log(
                `Downloading attachment ${attachmentIndex + 1} from ${attachmentUrl}`,
                'scheduler', null, null, 'verbose'
            );

            // Connect to remote host first, resolve exact metadata (Content-Type) before deciding local filepath
            const downloadResult = await this.downloadFileWithSizeCheck(attachmentUrl, tempDir, attachmentIndex);
            if (!downloadResult.success) {
                return { error: downloadResult.error };
            }

            const { filePath: tempFilePath, fileName } = downloadResult;
            tempFilesOnDisk.push(tempFilePath);

            const fileStats = await fsPromises.stat(tempFilePath);
            const fileSize  = fileStats.size;

            if (fileSize > this.MAX_FILE_SIZE) {
                return {
                    error: `File too large (${this.formatFileSize(fileSize)} > ${this.formatFileSize(this.MAX_FILE_SIZE)})`
                };
            }
            if (currentTotalSize + fileSize > this.MAX_TOTAL_ATTACHMENT_SIZE) {
                return { error: 'Would exceed total attachment size limit' };
            }

            let resultFiles;
            // If the attachment is a PDF, split it into PNG pages. If it is already an image (from CKEditor), send directly.
            if (fileName.toLowerCase().endsWith('.pdf')) {
                resultFiles = await this.processPDFWithSizeLimit(
                    fileName, tempFilePath, tempDir, tempFilesOnDisk, currentTotalSize
                );
            } else {
                resultFiles = [new AttachmentBuilder(tempFilePath, { name: fileName })];
            }

            // Recalculate size to reflect visual conversions (e.g. PDF rendered pages as PNGs)
            let actualTotalSize = currentTotalSize;
            for (const file of resultFiles) {
                try {
                    const stats = await fsPromises.stat(file.attachment);
                    actualTotalSize += stats.size;
                } catch (statError) {
                    this.debugConfig.log(
                        `Could not get file size for ${file.name}`,
                        'scheduler', null, statError, 'warn'
                    );
                }
            }

            return { files: resultFiles, totalSize: actualTotalSize };

        } catch (error) {
            return { error: error.message };
        }
    }

    /**
     * Resolves a URL query string or relative paths into a clean file-system compatible file name.
     * Prioritizes valid extensions discovered inside the URL baseline, falling back to Content-Type values.
     * @param {string} attachmentUrl - Incoming payload resource URL.
     * @param {number} fallbackIndex - Numerical fallback index to format filename.
     * @param {string} contentType - Upstream response headers header content payload classification.
     * @returns {string} Fully qualified filename with a safe extension.
     */
    extractFileName(attachmentUrl, fallbackIndex, contentType = '') {
        const MIME_TO_EXT = {
            'image/jpeg':       '.jpg',
            'image/jpg':        '.jpg',
            'image/png':        '.png',
            'image/gif':        '.gif',
            'image/webp':       '.webp',
            'application/pdf':  '.pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
            'application/msword': '.doc',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
            'application/vnd.ms-excel': '.xls',
        };

        const KNOWN_EXTS = /\.(pdf|jpe?g|png|gif|webp|docx?|xlsx?|pptx?|zip|rar)$/i;

        try {
            const parsed   = new URL(attachmentUrl);
            const basename = decodeURIComponent(path.basename(parsed.pathname));

            // Prioritize URL naming if it contains standard extension metadata
            if (basename && KNOWN_EXTS.test(basename)) {
                return basename;
            }

            // Path segment exists but is naked of extensions - attempt matching via MIME Sniffing
            if (basename && basename.length > 0 && basename !== '/') {
                if (contentType) {
                    const mime = contentType.split(';')[0].trim().toLowerCase();
                    const ext  = MIME_TO_EXT[mime];
                    if (ext) return `${basename}${ext}`;
                }
                return `${basename}_${fallbackIndex}.bin`;
            }
        } catch {
            // Fall through
        }

        // Ultimate Content-Type Fallback mapping
        if (contentType) {
            const mime = contentType.split(';')[0].trim().toLowerCase();
            const ext  = MIME_TO_EXT[mime];
            if (ext) return `attachment_${fallbackIndex}${ext}`;
        }

        return `attachment_${fallbackIndex}.bin`;
    }

    /**
     * Core streaming downloader equipped with strict payload limit and Content-Type validation.
     * Inspects files immediately to safeguard against masquerading error documents.
     * Mimics modern standard browser headers to bypass hotlinking and WAF blocks.
     * @param {string} url - Target resource URL.
     * @param {string} tempDir - Targeted local folder context.
     * @param {number} fallbackIndex - Numerical fallback index to format filename.
     * @returns {Promise<{success: boolean, filePath?: string, fileName?: string, error?: string}>}
     */
    async downloadFileWithSizeCheck(url, tempDir, fallbackIndex) {
        let finalFilePath = null;

        try {
            // Resolve origin of the target URL to bypass host-based hotlinking blocks
            let refererHeader = 'https://portal.tu.edu.np/';
            try {
                const parsedUrl = new URL(url);
                refererHeader = parsedUrl.origin + '/';
            } catch { /* use default fallback referer */ }

            const response = await axios({
                method: 'GET',
                url,
                responseType: 'stream',
                timeout: this.REQUEST_TIMEOUT,
                maxContentLength: this.MAX_FILE_SIZE,
                maxBodyLength: this.MAX_FILE_SIZE,
                maxRedirects: 5,
                headers: {
                    // Spoof standard desktop Google Chrome instead of exposing Bot user-agents
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': refererHeader,
                    // Prioritize images, pdf files, and other media over HTML page representations
                    'Accept': 'image/avif,image/webp,image/apng,image/*,application/pdf,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Connection': 'keep-alive',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });

            const contentType = response.headers['content-type'] || '';
            
            // Intercept HTML documents masquerading as 200 OK binary downloads (typical portal login wall redirects)
            if (contentType.includes('text/html') && !url.toLowerCase().endsWith('.html') && !url.toLowerCase().endsWith('.htm')) {
                // Read a small segment of the stream to extract page titles, security tags, or login challenges
                const htmlSnippet = await new Promise((resolve) => {
                    let buffer = '';
                    const onData = (chunk) => {
                        buffer += chunk.toString('utf8');
                        if (buffer.length > 1024) cleanup();
                    };
                    const onEnd = () => cleanup();
                    const onError = () => cleanup();
                    
                    const cleanup = () => {
                        response.data.off('data', onData);
                        response.data.off('end', onEnd);
                        response.data.off('error', onError);
                        resolve(buffer);
                    };

                    response.data.on('data', onData);
                    response.data.on('end', onEnd);
                    response.data.on('error', onError);
                    
                    // Set timeout guard in case stream locks up
                    setTimeout(cleanup, 1500);
                });

                // Pull the page title
                const titleMatch = htmlSnippet.match(/<title>([\s\S]*?)<\/title>/i);
                const pageTitle = titleMatch ? titleMatch[1].trim() : 'No Title Found';
                
                // Extract clean text snippet while dropping styling rules and JS blocks
                const bodySnippet = htmlSnippet
                    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                    .replace(/<[^>]*>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .substring(0, 150)
                    .trim();

                return {
                    success: false,
                    error: `Received HTML instead of binary document. Page Title: "${pageTitle}". Snippet: "${bodySnippet}"`
                };
            }

            const contentLength = response.headers['content-length'];
            if (contentLength && parseInt(contentLength) > this.MAX_FILE_SIZE) {
                return {
                    success: false,
                    error: `File too large (${this.formatFileSize(contentLength)})`
                };
            }

            // Sniff name reliably using both URL pathways & HTTP content configurations
            const rawName = this.extractFileName(url, fallbackIndex, contentType);
            const fileName = this.sanitizeFileName(rawName);
            finalFilePath = path.join(tempDir, fileName);

            const writer = createWriteStream(finalFilePath);
            let downloadedSize = 0;

            response.data.on('data', (chunk) => {
                downloadedSize += chunk.length;
                if (downloadedSize > this.MAX_FILE_SIZE) {
                    writer.destroy();
                    response.data.destroy();
                }
            });

            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
                response.data.on('error', reject);
            });

            // Ensure written document holds actual content payload (not a 1-byte file or error token)
            const stats = await fsPromises.stat(finalFilePath);
            if (stats.size < 100) {
                await fsPromises.unlink(finalFilePath).catch(() => {});
                return {
                    success: false,
                    error: `Response payload too small (${stats.size} bytes) — likely empty or corrupt`
                };
            }

            return { success: true, filePath: finalFilePath, fileName };

        } catch (error) {
            if (finalFilePath) {
                try { await fsPromises.unlink(finalFilePath); } catch { /* ignore */ }
            }

            if (error.code === 'ECONNABORTED' || error.code === 'TIMEOUT') {
                return { success: false, error: 'Download timeout' };
            }
            return { success: false, error: error.message };
        }
    }

    /**
     * Converts a PDF file into highly optimized, web-ready PNG pages.
     * Utilizes a ratio conversion mechanism ensuring high DPI without breaching size constraints.
     * @param {string} fileName - Clean original PDF filename.
     * @param {string} tempFilePath - Raw target document file path on disk.
     * @param {string} tempDir - Folder to write converted images.
     * @param {string[]} tempFilesOnDisk - Registry mapping allocated files.
     * @param {number} currentTotalSize - Active notice transmission size track.
     * @returns {Promise<AttachmentBuilder[]>} List of ready-to-dispatch attachments.
     */
    async processPDFWithSizeLimit(fileName, tempFilePath, tempDir, tempFilesOnDisk, currentTotalSize) {
        const MAX_PDF_PAGES = 50;
        const MAX_PDF_CONVERSION_SIZE = this.MAX_TOTAL_ATTACHMENT_SIZE * 4;

        try {
            let totalPdfPages = 0;
            let pdfDocument   = null;

            try {
                const pdfBuffer  = await fsPromises.readFile(tempFilePath);
                const uint8Array = new Uint8Array(pdfBuffer);
                const loadingTask = getDocument({ data: uint8Array });
                pdfDocument = await loadingTask.promise;
                totalPdfPages = pdfDocument.numPages;
                this.debugConfig.log(`PDF ${fileName} has ${totalPdfPages} pages`, 'scheduler');
            } catch (pdfjsError) {
                this.debugConfig.log(
                    'Could not get PDF page count, sending original file',
                    'scheduler', null, pdfjsError, 'warn'
                );
                return [new AttachmentBuilder(tempFilePath, { name: fileName })];
            }

            const pagesToConvert = Math.min(totalPdfPages, MAX_PDF_PAGES);
            if (pagesToConvert === 0) {
                return [new AttachmentBuilder(tempFilePath, { name: fileName })];
            }

            let pageWidth  = 1240;
            let pageHeight = 1754;

            try {
                const firstPage = await pdfDocument.getPage(1);
                const viewport  = firstPage.getViewport({ scale: 1.0 });
                const scale     = 150 / 72; // Convert typical 72 DPI documents to 150 DPI
                pageWidth  = Math.round(viewport.width  * scale);
                pageHeight = Math.round(viewport.height * scale);

                const MAX_DIM = 3000;
                if (pageWidth > MAX_DIM || pageHeight > MAX_DIM) {
                    const sf = MAX_DIM / Math.max(pageWidth, pageHeight);
                    pageWidth  = Math.round(pageWidth  * sf);
                    pageHeight = Math.round(pageHeight * sf);
                }
            } catch (dimensionError) {
                this.debugConfig.log(
                    'Could not detect PDF dimensions, using defaults',
                    'scheduler', null, dimensionError, 'warn'
                );
            }

            const pdfConvertOptions = {
                density:      200,
                quality:      85,
                height:       pageHeight,
                width:        pageWidth,
                format:       'png',
                saveFilename: path.parse(fileName).name,
                savePath:     tempDir,
            };

            const convert        = fromPath(tempFilePath, pdfConvertOptions);
            const convertedFiles = [];
            let conversionTotalSize = currentTotalSize;

            for (let pageNum = 1; pageNum <= pagesToConvert; pageNum++) {
                try {
                    const convertResponse = await convert(pageNum);
                    if (convertResponse?.path) {
                        const pngFilePath = convertResponse.path;
                        const pngFileName = path.basename(pngFilePath);
                        const stats       = await fsPromises.stat(pngFilePath);

                        if (conversionTotalSize + stats.size > MAX_PDF_CONVERSION_SIZE) {
                            this.debugConfig.log(
                                `Stopping PDF conversion at page ${pageNum} — size limit reached`,
                                'scheduler', null, null, 'warn'
                            );
                            await fsPromises.unlink(pngFilePath);
                            break;
                        }

                        tempFilesOnDisk.push(pngFilePath);
                        convertedFiles.push(new AttachmentBuilder(pngFilePath, { name: pngFileName }));
                        conversionTotalSize += stats.size;
                        this.debugConfig.log(
                            `Converted page ${pageNum}/${pagesToConvert} (${this.formatFileSize(stats.size)})`,
                            'scheduler', null, null, 'verbose'
                        );
                    } else {
                        break;
                    }
                } catch (pageError) {
                    this.debugConfig.log(
                        `Could not convert PDF page ${pageNum}`,
                        'scheduler', null, pageError, 'warn'
                    );
                    if (
                        pageError.message.includes('does not exist') ||
                        pageError.message.includes('invalid page number')
                    ) break;
                }
            }

            if (convertedFiles.length === 0) {
                this.debugConfig.log(
                    `No pages converted for ${fileName} — sending original`,
                    'scheduler', null, null, 'warn'
                );
                return [new AttachmentBuilder(tempFilePath, { name: fileName })];
            }

            this.debugConfig.log(
                `Converted ${convertedFiles.length} pages from ${fileName}`, 'scheduler'
            );
            return convertedFiles;

        } catch (pdfProcessError) {
            this.debugConfig.log(
                `Error processing PDF ${fileName}`,
                'scheduler', null, pdfProcessError, 'error'
            );
            return [new AttachmentBuilder(tempFilePath, { name: fileName })];
        }
    }

    /**
     * Distributes bulk notice attachments over multiple segmented chunks and messages.
     * Guarantees deliveries do not violate Discord API boundaries.
     * @param {Object} noticeChannel - Targeted Discord channel.
     * @param {EmbedBuilder} embed - Styled RichEmbed metadata instance.
     * @param {AttachmentBuilder[]} attachments - Assets queued for delivery.
     * @param {string} noticeTitle - Raw Notice Header Title.
     * @returns {Promise<void>}
     */
    async sendNoticeWithChunkedAttachments(noticeChannel, embed, attachments, noticeTitle) {
        if (attachments.length === 0) {
            await this.sendWithRetry(() => noticeChannel.send({ embeds: [embed] }));
            this.debugConfig.log(`Sent notice without attachments: ${noticeTitle}`, 'scheduler');
            return;
        }

        let sentFirstMessage = false;
        const chunkSize      = this.ATTACHMENT_CHUNK_SIZE;
        const totalChunks    = Math.ceil(attachments.length / chunkSize);

        for (let i = 0; i < attachments.length; i += chunkSize) {
            const chunk       = attachments.slice(i, i + chunkSize);
            const chunkNumber = Math.floor(i / chunkSize) + 1;

            try {
                if (!sentFirstMessage) {
                    await this.sendWithRetry(() =>
                        noticeChannel.send({ embeds: [embed], files: chunk })
                    );
                    sentFirstMessage = true;
                    this.debugConfig.log(
                        `Sent main notice with ${chunk.length} attachment(s): ${noticeTitle}`,
                        'scheduler'
                    );
                } else {
                    await this.sendWithRetry(() =>
                        noticeChannel.send({
                            content: `📎 Additional attachments for "${noticeTitle}" (${chunkNumber}/${totalChunks})`,
                            files: chunk,
                        })
                    );
                    this.debugConfig.log(
                        `Sent attachment chunk ${chunkNumber}/${totalChunks} (${chunk.length} file(s))`,
                        'scheduler'
                    );
                }

                if (i + chunkSize < attachments.length) await this.sleep(2000);

            } catch (sendError) {
                this.debugConfig.log(
                    `Error sending chunk ${chunkNumber}/${totalChunks}`,
                    'scheduler', null, sendError, 'error'
                );
                throw sendError;
            }
        }
    }

    /**
     * Executes arbitrary messaging actions wrapped in retry handlers.
     * @param {Function} sendFunction - Anonymous function containing action context.
     * @param {number} maxAttempts - Operational limit.
     * @returns {Promise<any>}
     */
    async sendWithRetry(sendFunction, maxAttempts = 3) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await sendFunction();
            } catch (error) {
                if (attempt === maxAttempts || !this.shouldRetry(error)) throw error;
                const delay = this.RETRY_DELAY * Math.pow(2, attempt - 1);
                this.debugConfig.log(
                    `Retrying send (${attempt}/${maxAttempts}) in ${delay}ms`,
                    'scheduler', null, null, 'warn'
                );
                await this.sleep(delay);
            }
        }
    }

    /**
     * Analyzes HTTP/network errors to determine if it is safe/recommended to retry.
     * @param {Error} error - System error or exception object.
     * @returns {boolean}
     */
    shouldRetry(error) {
        const retryableCodes   = ['ECONNABORTED', 'TIMEOUT', 'ENOTFOUND', 'ECONNRESET', 'EPIPE'];
        const retryableStatuses = [429, 500, 502, 503, 504];
        return (
            retryableCodes.includes(error.code) ||
            retryableStatuses.includes(error.status) ||
            error.message?.includes('aborted') ||
            error.message?.includes('timeout') ||
            error.message?.includes('network')
        );
    }

    /**
     * Strips malicious formatting sequences, spacing, and unsafe characters from filenames.
     * @param {string} fileName - Dirty file system naming.
     * @returns {string} Highly sanitized, safely truncated naming string.
     */
    sanitizeFileName(fileName) {
        return fileName
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
            .replace(/\s+/g, '_')
            .substring(0, 100);
    }

    /**
     * Formats plain byte counts into legible metadata metric suffixes.
     * @param {number} bytes - Quantifiable file byte size.
     * @returns {string} Formatted, human-readable size descriptor.
     */
    formatFileSize(bytes) {
        if (!bytes || bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Custom promise-wrapped sleep timer.
     * @param {number} ms - Milliseconds duration to pause execution.
     * @returns {Promise<void>}
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Constructs a unified, styled RichEmbed block targeting notice content presentation.
     * @param {Object} notice - Notice descriptor.
     * @returns {EmbedBuilder} Configured Discord Embed.
     */
    createNoticeEmbed(notice) {
        const embed = new EmbedBuilder()
            .setColor('#1E90FF')
            .setTitle(`📢 ${notice.title}`)
            .setURL(notice.link)
            .setFooter({ text: `Source: ${notice.source}` });

        if (notice.nepaliDate) {
            embed.addFields({ name: 'Date (AD)', value: notice.nepaliDate, inline: true });
        }

        try {
            embed.setTimestamp(new Date(notice.date));
        } catch {
            embed.setTimestamp(new Date());
        }

        return embed;
    }

    /**
     * Safe directory instantiation method wrapper.
     * @param {string} tempDir - Folder to ensure exists.
     * @returns {Promise<void>}
     */
    async ensureTempDirectory(tempDir) {
        try {
            await fsPromises.mkdir(tempDir, { recursive: true });
        } catch (error) {
            if (error.code !== 'EEXIST') {
                throw new Error(`Could not create temp directory ${tempDir}: ${error.message}`);
            }
        }
    }

    /**
     * Safely recursive unlinks and deletes target temporary directory paths.
     * @param {string} tempDir - Folder scheduled for deletion.
     * @returns {Promise<void>}
     */
    async cleanupTempDirectory(tempDir) {
        try {
            await fsPromises.rm(tempDir, { recursive: true, force: true });
        } catch (error) {
            this.debugConfig.log(
                `Error cleaning up temp directory: ${tempDir}`,
                'scheduler', null, error, 'warn'
            );
        }
    }

    /**
     * Individual cleanup method to safely delete transient files.
     * @param {string[]} filePaths - Collection of local file paths.
     * @returns {Promise<void>}
     */
    async cleanupTempFiles(filePaths) {
        for (const filePath of filePaths) {
            try {
                await fsPromises.unlink(filePath);
            } catch {
                // Ignore if already deleted
            }
        }
    }

    /**
     * Fetches targeting Discord communication channels concurrently.
     * @param {string} noticeChannelId - Target news distribution channel ID.
     * @param {string} adminChannelId - Fallback admin system diagnostic logger channel ID.
     * @returns {Promise<{noticeChannel: Object, adminChannel: Object|null}>}
     */
    async fetchChannelsWithTimeout(noticeChannelId, adminChannelId) {
        const fetchTimeout = 10_000;

        const noticeChannel = await Promise.race([
            this.client.channels.fetch(noticeChannelId),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Channel fetch timeout')), fetchTimeout)
            ),
        ]);

        let adminChannel = null;
        if (adminChannelId && adminChannelId !== 'YOUR_NOTICE_ADMIN_CHANNEL_ID_HERE') {
            try {
                adminChannel = await Promise.race([
                    this.client.channels.fetch(adminChannelId),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Admin channel fetch timeout')), fetchTimeout)
                    ),
                ]);
            } catch (adminError) {
                this.debugConfig.log(
                    'Could not fetch admin channel', 'scheduler', null, adminError, 'warn'
                );
            }
        }

        return { noticeChannel, adminChannel };
    }

    /**
     * Contacts upstream scrapers wrapped inside a robust racing timeout protection.
     * @returns {Promise<Object[]>} Collection of resolved notice items.
     */
    async scrapeNoticesWithTimeout() {
        try {
            return await Promise.race([
                scrapeLatestNotice(),
                new Promise((_, reject) =>
                    setTimeout(
                        () => reject(new Error('Notice scraping timeout')),
                        this.SCRAPE_TIMEOUT_MS
                    )
                ),
            ]);
        } catch (error) {
            throw new Error(`Notice scraping failed: ${error.message}`);
        }
    }

    /**
     * Evaluates a collection of notices to exclude old or duplicate items.
     * @param {Object[]} notices - List of parsed notice datasets.
     * @returns {Promise<Object[]>} List containing only brand-new, valid notices.
     */
    async filterNewNotices(notices) {
        const MAX_NOTICE_AGE_DAYS = parseInt(process.env.MAX_NOTICE_AGE_DAYS || '30', 10);
        const now = new Date();
        const results = [];

        for (const notice of notices) {
            const noticeDate = new Date(notice.date);
            if (isNaN(noticeDate.getTime())) {
                this.debugConfig.log(
                    `Invalid date for notice "${notice.title}": ${notice.date}`,
                    'scheduler', null, null, 'warn'
                );
                continue;
            }

            const ageInDays = (now - noticeDate) / (1000 * 60 * 60 * 24);
            if (ageInDays > MAX_NOTICE_AGE_DAYS) continue;

            const already = await this.isNoticeAlreadyAnnounced(notice.link);
            if (already) {
                this.debugConfig.log(`Already announced: ${notice.title}`, 'scheduler');
                continue;
            }

            results.push(notice);
        }

        return results;
    }

    /**
     * Basic age checking list utility. Left for backward compatibility.
     * @param {Object[]} notices - List of notices.
     * @returns {Object[]}
     */
    filterNoticesByAge(notices) {
        const MAX_NOTICE_AGE_DAYS = parseInt(process.env.MAX_NOTICE_AGE_DAYS || '30', 10);
        const now = new Date();
        return notices.filter(notice => {
            const noticeDate = new Date(notice.date);
            if (isNaN(noticeDate.getTime())) return false;
            return (now - noticeDate) / (1000 * 60 * 60 * 24) <= MAX_NOTICE_AGE_DAYS;
        });
    }

    /**
     * Queries database storage engines to evaluate notice announce statuses.
     * @param {string} link - URL link serving as a unique primary key identifier.
     * @returns {Promise<boolean>} Resolves to true if the notice was already sent.
     */
    async isNoticeAlreadyAnnounced(link) {
        return new Promise((resolve, reject) => {
            this.client.db.get(
                `SELECT COUNT(*) AS count FROM notices WHERE link = ?`,
                [link],
                (err, result) => {
                    if (err) reject(err);
                    else resolve(result.count > 0);
                }
            );
        });
    }

    /**
     * Commits a dispatched notice entry into the persistent tracking database.
     * @param {Object} notice - Notice data object.
     * @returns {Promise<void>}
     */
    async saveNoticeToDatabase(notice) {
        return new Promise((resolve, reject) => {
            this.client.db.run(
                `INSERT INTO notices (title, link, date, announced_at) VALUES (?, ?, ?, ?)`,
                [notice.title, notice.link, notice.date, Date.now()],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    /**
     * Publishes urgent operational warnings directly to the bot administrators.
     * @param {Object} adminChannel - Target Discord reporting channel.
     * @param {string} message - Alert details payload.
     * @returns {Promise<void>}
     */
    async sendAdminAlert(adminChannel, message) {
        try {
            await adminChannel.send(`🚨 **Bot Alert:** ${message}`);
        } catch (error) {
            this.debugConfig.log('Failed to send admin alert', 'scheduler', null, error, 'warn');
        }
    }
}

export { NoticeProcessor };