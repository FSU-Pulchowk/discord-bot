import path from 'path';
import { promises as fsPromises, createWriteStream } from 'fs';
import axios from 'axios';
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { fromPath } from 'pdf2pic';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { scrapeLatestNotice } from '../services/scraper.js';

/**
 * Enhanced notice processing methods for the PulchowkBot class
 * Addresses timeout issues, file size limits, and better error handling
 */

class NoticeProcessor {
    constructor(client, debugConfig, colors) {
        this.client = client;
        this.debugConfig = debugConfig;
        this.colors = colors;
        // Discord limits
        this.MAX_FILE_SIZE = 25 * 1024 * 1024;
        this.MAX_TOTAL_ATTACHMENT_SIZE = 25 * 1024 * 1024;
        this.ATTACHMENT_CHUNK_SIZE = 10;
        this.REQUEST_TIMEOUT = 30000;
        this.RETRY_ATTEMPTS = 3;
        this.RETRY_DELAY = 2000;
    }

    /**
     * Enhanced notice checking with better error handling and retry logic
     */
    async checkAndAnnounceNotices() {
        this.debugConfig.log('Starting enhanced notice check...', 'scheduler');
        const TARGET_NOTICE_CHANNEL_ID = process.env.TARGET_NOTICE_CHANNEL_ID;
        const NOTICE_ADMIN_CHANNEL_ID = process.env.NOTICE_ADMIN_CHANNEL_ID;
        const TEMP_ATTACHMENT_DIR = path.join(process.cwd(), 'temp_notice_attachments');

        let noticeChannel, adminChannel;

        try {
            if (!TARGET_NOTICE_CHANNEL_ID || TARGET_NOTICE_CHANNEL_ID === 'YOUR_NOTICE_CHANNEL_ID_HERE') {
                this.debugConfig.log('TARGET_NOTICE_CHANNEL_ID not configured. Skipping notice announcements.', 'scheduler', null, null, 'warn');
                return;
            }
            await this.ensureTempDirectory(TEMP_ATTACHMENT_DIR);
            const channels = await this.fetchChannelsWithTimeout(TARGET_NOTICE_CHANNEL_ID, NOTICE_ADMIN_CHANNEL_ID);
            noticeChannel = channels.noticeChannel;
            adminChannel = channels.adminChannel;
            const scrapedNotices = await this.scrapeNoticesWithTimeout();
            if (!scrapedNotices || scrapedNotices.length === 0) {
                this.debugConfig.log('No notices found or scraper returned empty.', 'scheduler');
                return;
            }
            const noticesToAnnounce = this.filterNoticesByAge(scrapedNotices);
            if (noticesToAnnounce.length === 0) {
                return;
            }
            this.debugConfig.log(`Processing ${noticesToAnnounce.length} recent notices.`, 'scheduler');
            for (const [index, notice] of noticesToAnnounce.entries()) {
                try {
                    await this.processNoticeWithRetry(notice, noticeChannel, TEMP_ATTACHMENT_DIR, adminChannel);
                    if (index < noticesToAnnounce.length - 1) {
                        await this.sleep(1000);
                    }
                } catch (noticeError) {
                    this.debugConfig.log(`Failed to process notice after retries: ${notice.title}`, 'scheduler', null, noticeError, 'error');
                    if (adminChannel) {
                        await this.sendAdminAlert(adminChannel, `Failed to process notice "${notice.title}": ${noticeError.message}`);
                    }
                }
            }

        } catch (error) {
            this.debugConfig.log('Critical error during notice checking', 'scheduler', null, error, 'error');
            if (adminChannel) {
                await this.sendAdminAlert(adminChannel, `Critical notice scraping error: ${error.message}`);
            }
        } finally {
            await this.cleanupTempDirectory(TEMP_ATTACHMENT_DIR);
        }
    }

    /**
     * Process a single notice with retry logic
     */
    async processNoticeWithRetry(notice, noticeChannel, tempDir, adminChannel, attempt = 1) {
        let tempFilesOnDisk = [];

        try {
            if (!notice?.title || !notice?.link) {
                throw new Error('Invalid notice object: missing title or link');
            }
            const isAlreadyAnnounced = await this.isNoticeAlreadyAnnounced(notice.link);
            if (isAlreadyAnnounced) {
                this.debugConfig.log(`Notice already announced: ${notice.title}`, 'scheduler');
                return;
            }

            this.debugConfig.log(`Processing new notice (attempt ${attempt}): ${notice.title}`, 'scheduler');
            const noticeEmbed = this.createNoticeEmbed(notice);
            const { attachments, description } = await this.processNoticeAttachments(
                notice,
                tempDir,
                tempFilesOnDisk
            );

            noticeEmbed.setDescription(description);
            await this.sendNoticeWithChunkedAttachments(noticeChannel, noticeEmbed, attachments, notice.title);
            await this.saveNoticeToDatabase(notice);

            this.debugConfig.log(`Successfully announced notice: ${notice.title}`, 'scheduler', null, null, 'success');

        } catch (error) {
            if (attempt < this.RETRY_ATTEMPTS && this.shouldRetry(error)) {
                this.debugConfig.log(`Retrying notice processing (${attempt}/${this.RETRY_ATTEMPTS}): ${notice.title}`, 'scheduler', null, null, 'warn');
                await this.sleep(this.RETRY_DELAY * attempt); // Exponential backoff
                return this.processNoticeWithRetry(notice, noticeChannel, tempDir, adminChannel, attempt + 1);
            }
            throw error;
        } finally {
            await this.cleanupTempFiles(tempFilesOnDisk);
        }
    }

    /**
     * Process notice attachments with size validation and better error handling
     */
    async processNoticeAttachments(notice, tempDir, tempFilesOnDisk) {
        let allFilesForNotice = [];
        let description = 'A new notice has been published.';
        let totalSize = 0;

        if (!notice.attachments || notice.attachments.length === 0) {
            return { attachments: allFilesForNotice, description };
        }

        this.debugConfig.log(`Processing ${notice.attachments.length} attachments`, 'scheduler');

        for (const [index, attachmentUrl] of notice.attachments.entries()) {
            try {
                const result = await this.processSingleAttachment(
                    attachmentUrl,
                    tempDir,
                    tempFilesOnDisk,
                    totalSize
                );

                if (result.files && result.files.length > 0) {
                    allFilesForNotice.push(...result.files);
                    totalSize = result.totalSize;
                } else if (result.error) {
                    description += `\n\n⚠️ Could not process attachment ${index + 1}: ${result.error}`;
                }

                if (totalSize > this.MAX_TOTAL_ATTACHMENT_SIZE * 0.8) { // 80% of limit
                    this.debugConfig.log(`Approaching size limit, stopping at ${allFilesForNotice.length} files`, 'scheduler', null, null, 'warn');
                    const remainingCount = notice.attachments.length - index - 1;
                    if (remainingCount > 0) {
                        description += `\n\n⚠️ ${remainingCount} additional attachment(s) were too large to include.`;
                    }
                    break;
                }

            } catch (attachmentError) {
                this.debugConfig.log(`Error processing attachment ${index + 1}`, 'scheduler', null, attachmentError, 'error');
                description += `\n\n⚠️ Could not process attachment ${index + 1}: ${attachmentError.message}`;
            }
        }

        return { attachments: allFilesForNotice, description };
    }

    /**
     * Process a single attachment with size validation
     */
    async processSingleAttachment(attachmentUrl, tempDir, tempFilesOnDisk, currentTotalSize) {
        try {
            const fileName = this.sanitizeFileName(path.basename(new URL(attachmentUrl).pathname));
            const tempFilePath = path.join(tempDir, fileName);
            const downloadResult = await this.downloadFileWithSizeCheck(attachmentUrl, tempFilePath);
            if (!downloadResult.success) {
                return { error: downloadResult.error };
            }

            tempFilesOnDisk.push(tempFilePath);

            const fileStats = await fsPromises.stat(tempFilePath);
            const fileSize = fileStats.size;
            if (fileSize > this.MAX_FILE_SIZE) {
                return { error: `File too large (${this.formatFileSize(fileSize)} > ${this.formatFileSize(this.MAX_FILE_SIZE)})` };
            }
            if (currentTotalSize + fileSize > this.MAX_TOTAL_ATTACHMENT_SIZE) {
                return { error: 'Would exceed total attachment size limit' };
            }

            let resultFiles = [];
            if (fileName.toLowerCase().endsWith('.pdf')) {
                resultFiles = await this.processPDFWithSizeLimit(fileName, tempFilePath, tempDir, tempFilesOnDisk, currentTotalSize);
            } else {
                resultFiles = [new AttachmentBuilder(tempFilePath, { name: fileName })];
            }
            let actualTotalSize = currentTotalSize;
            for (const file of resultFiles) {
                try {
                    const stats = await fsPromises.stat(file.attachment);
                    actualTotalSize += stats.size;
                } catch (statError) {
                    this.debugConfig.log(`Could not get file size for ${file.name}`, 'scheduler', null, statError, 'warn');
                }
            }

            return { files: resultFiles, totalSize: actualTotalSize };

        } catch (error) {
            return { error: error.message };
        }
    }

    /**
     * Download file with size checking and timeout
     */
    async downloadFileWithSizeCheck(url, filePath) {
        try {
            const response = await axios({
                method: 'GET',
                url: url,
                responseType: 'stream',
                timeout: this.REQUEST_TIMEOUT,
                maxContentLength: this.MAX_FILE_SIZE,
                maxBodyLength: this.MAX_FILE_SIZE
            });
            const contentLength = response.headers['content-length'];
            if (contentLength && parseInt(contentLength) > this.MAX_FILE_SIZE) {
                return { success: false, error: `File too large (${this.formatFileSize(contentLength)} > ${this.formatFileSize(this.MAX_FILE_SIZE)})` };
            }

            const writer = createWriteStream(filePath);
            let downloadedSize = 0;

            response.data.on('data', (chunk) => {
                downloadedSize += chunk.length;
                if (downloadedSize > this.MAX_FILE_SIZE) {
                    writer.destroy();
                    response.data.destroy();
                    throw new Error('File size exceeds limit during download');
                }
            });

            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
                response.data.on('error', reject);
            });

            return { success: true };

        } catch (error) {
            try {
                await fsPromises.unlink(filePath);
            } catch (unlinkError) {
            }

            if (error.code === 'ECONNABORTED' || error.code === 'TIMEOUT') {
                return { success: false, error: 'Download timeout' };
            }
            return { success: false, error: error.message };
        }
    }

    /**
     * PDF processing with dynamic size detection
     */
    async processPDFWithSizeLimit(fileName, tempFilePath, tempDir, tempFilesOnDisk, currentTotalSize) {
        const MAX_PDF_PAGES = 50;
        const MAX_PDF_CONVERSION_SIZE = this.MAX_TOTAL_ATTACHMENT_SIZE * 4;

        try {
            let totalPdfPages = 0;
            let pdfDocument = null;

            try {
                const pdfBuffer = await fsPromises.readFile(tempFilePath);
                const uint8Array = new Uint8Array(pdfBuffer);
                const loadingTask = getDocument({ data: uint8Array });
                pdfDocument = await loadingTask.promise;
                totalPdfPages = pdfDocument.numPages;
                this.debugConfig.log(`PDF ${fileName} has ${totalPdfPages} pages`, 'scheduler');
            } catch (pdfjsError) {
                this.debugConfig.log('Could not get PDF page count, using original file', 'scheduler', null, pdfjsError, 'warn');
                return [new AttachmentBuilder(tempFilePath, { name: fileName })];
            }

            const pagesToConvert = Math.min(totalPdfPages, MAX_PDF_PAGES);

            if (pagesToConvert === 0) {
                return [new AttachmentBuilder(tempFilePath, { name: fileName })];
            }

            let pageWidth = 1240;
            let pageHeight = 1754;

            try {
                const firstPage = await pdfDocument.getPage(1);
                const viewport = firstPage.getViewport({ scale: 1.0 });

                const pdfWidth = viewport.width;
                const pdfHeight = viewport.height;

                const isLandscape = pdfWidth > pdfHeight;

                const TARGET_DPI = 150; // Balance between quality and file size
                const POINTS_PER_INCH = 72;
                const scale = TARGET_DPI / POINTS_PER_INCH;

                pageWidth = Math.round(pdfWidth * scale);
                pageHeight = Math.round(pdfHeight * scale);

                const MAX_DIMENSION = 3000;
                if (pageWidth > MAX_DIMENSION || pageHeight > MAX_DIMENSION) {
                    const scaleFactor = MAX_DIMENSION / Math.max(pageWidth, pageHeight);
                    pageWidth = Math.round(pageWidth * scaleFactor);
                    pageHeight = Math.round(pageHeight * scaleFactor);
                }

                this.debugConfig.log(
                    `PDF dimensions detected: ${pdfWidth}x${pdfHeight} pts (${isLandscape ? 'landscape' : 'portrait'})`,
                    'scheduler',
                    null,
                    null,
                    'verbose'
                );
                this.debugConfig.log(
                    `Converting to: ${pageWidth}x${pageHeight} px`,
                    'scheduler',
                    null,
                    null,
                    'verbose'
                );

            } catch (dimensionError) {
                this.debugConfig.log('Could not detect PDF dimensions, using defaults', 'scheduler', null, dimensionError, 'warn');
            }

            const pdfConvertOptions = {
                density: 200, 
                quality: 85,  
                height: pageHeight,
                width: pageWidth,
                format: "png",
                saveFilename: path.parse(fileName).name,
                savePath: tempDir
            };

            const convert = fromPath(tempFilePath, pdfConvertOptions);
            const convertedFiles = [];
            let conversionTotalSize = currentTotalSize;

            for (let pageNum = 1; pageNum <= pagesToConvert; pageNum++) {
                try {
                    const convertResponse = await convert(pageNum);
                    if (convertResponse?.path) {
                        const pngFilePath = convertResponse.path;
                        const pngFileName = path.basename(pngFilePath);
                        const stats = await fsPromises.stat(pngFilePath);

                        if (conversionTotalSize + stats.size > MAX_PDF_CONVERSION_SIZE) {
                            this.debugConfig.log(`Stopping PDF conversion at page ${pageNum} due to size limit`, 'scheduler', null, null, 'warn');
                            await fsPromises.unlink(pngFilePath);
                            break;
                        }

                        tempFilesOnDisk.push(pngFilePath);
                        convertedFiles.push(new AttachmentBuilder(pngFilePath, { name: pngFileName }));
                        conversionTotalSize += stats.size;

                        this.debugConfig.log(`Converted PDF page ${pageNum}/${pagesToConvert} (${this.formatFileSize(stats.size)})`, 'scheduler', null, null, 'verbose');
                    } else {
                        this.debugConfig.log(`No valid response for PDF page ${pageNum}`, 'scheduler', null, null, 'warn');
                        break;
                    }
                } catch (pageError) {
                    this.debugConfig.log(`Could not convert PDF page ${pageNum}`, 'scheduler', null, pageError, 'warn');
                    if (pageError.message.includes('does not exist') || pageError.message.includes('invalid page number')) {
                        break;
                    }
                }
            }

            if (convertedFiles.length === 0) {
                this.debugConfig.log(`No pages converted for PDF ${fileName}. Sending original.`, 'scheduler', null, null, 'warn');
                return [new AttachmentBuilder(tempFilePath, { name: fileName })];
            } else {
                this.debugConfig.log(`Successfully converted ${convertedFiles.length} pages from ${fileName}`, 'scheduler');
                return convertedFiles;
            }

        } catch (pdfProcessError) {
            this.debugConfig.log(`Error processing PDF ${fileName}`, 'scheduler', null, pdfProcessError, 'error');
            return [new AttachmentBuilder(tempFilePath, { name: fileName })];
        }
    }

    /**
     * Notice sending with better chunking and error handling
     */
    async sendNoticeWithChunkedAttachments(noticeChannel, embed, attachments, noticeTitle) {
        if (attachments.length === 0) {
            await this.sendWithRetry(() => noticeChannel.send({ embeds: [embed] }));
            this.debugConfig.log(`Sent notice without attachments: ${noticeTitle}`, 'scheduler');
            return;
        }

        let sentFirstMessage = false;
        const chunkSize = this.ATTACHMENT_CHUNK_SIZE;

        for (let i = 0; i < attachments.length; i += chunkSize) {
            const chunk = attachments.slice(i, i + chunkSize);
            const chunkNumber = Math.floor(i / chunkSize) + 1;
            const totalChunks = Math.ceil(attachments.length / chunkSize);

            try {
                if (!sentFirstMessage) {
                    await this.sendWithRetry(() =>
                        noticeChannel.send({
                            embeds: [embed],
                            files: chunk
                        })
                    );
                    sentFirstMessage = true;
                    this.debugConfig.log(`Sent main notice with ${chunk.length} attachments: ${noticeTitle}`, 'scheduler');
                } else {
                    await this.sendWithRetry(() =>
                        noticeChannel.send({
                            content: `📎 Additional attachments for "${noticeTitle}" (${chunkNumber}/${totalChunks})`,
                            files: chunk
                        })
                    );
                    this.debugConfig.log(`Sent attachment chunk ${chunkNumber}/${totalChunks} (${chunk.length} files)`, 'scheduler');
                }

                if (i + chunkSize < attachments.length) {
                    await this.sleep(2000);
                }

            } catch (sendError) {
                this.debugConfig.log(`Error sending notice chunk ${chunkNumber}/${totalChunks}`, 'scheduler', null, sendError, 'error');
                throw sendError;
            }
        }
    }

    /**
     * Send with retry logic for API calls
     */
    async sendWithRetry(sendFunction, maxAttempts = 3) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await sendFunction();
            } catch (error) {
                if (attempt === maxAttempts || !this.shouldRetry(error)) {
                    throw error;
                }

                const delay = this.RETRY_DELAY * Math.pow(2, attempt - 1); // Exponential backoff
                this.debugConfig.log(`Retrying send operation (${attempt}/${maxAttempts}) in ${delay}ms`, 'scheduler', null, null, 'warn');
                await this.sleep(delay);
            }
        }
    }

    /**
     * Utility methods
     */

    shouldRetry(error) {
        const retryableCodes = ['ECONNABORTED', 'TIMEOUT', 'ENOTFOUND', 'ECONNRESET', 'EPIPE'];
        const retryableStatusCodes = [429, 500, 502, 503, 504];
        return retryableCodes.includes(error.code) ||
            retryableStatusCodes.includes(error.status) ||
            error.message?.includes('aborted') ||
            error.message?.includes('timeout') ||
            error.message?.includes('network');
    }

    sanitizeFileName(fileName) {
        return fileName.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    createNoticeEmbed(notice) {
        return new EmbedBuilder()
            .setColor('#1E90FF')
            .setTitle(`📢 Notice${notice.id ? ` ${notice.id}` : ''}: ${notice.title}`)
            .setURL(notice.link)
            .setFooter({ text: `Source: ${notice.source}` })
            .setTimestamp(new Date(notice.date));
    }

    async ensureTempDirectory(tempDir) {
        try {
            await fsPromises.mkdir(tempDir, { recursive: true });
        } catch (error) {
            throw new Error(`Could not create temp directory: ${error.message}`);
        }
    }

    async cleanupTempDirectory(tempDir) {
        try {
            await fsPromises.rm(tempDir, { recursive: true, force: true });
        } catch (error) {
            this.debugConfig.log(`Error cleaning up temp directory: ${tempDir}`, 'scheduler', null, error, 'warn');
        }
    }

    async cleanupTempFiles(filePaths) {
        for (const filePath of filePaths) {
            try {
                await fsPromises.unlink(filePath);
            } catch (error) {
                this.debugConfig.log(`Error cleaning up temp file: ${filePath}`, 'scheduler', null, error, 'warn');
            }
        }
    }

    async fetchChannelsWithTimeout(noticeChannelId, adminChannelId) {
        const fetchTimeout = 10000;

        try {
            const noticeChannel = await Promise.race([
                this.client.channels.fetch(noticeChannelId),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Channel fetch timeout')), fetchTimeout))
            ]);

            let adminChannel = null;
            if (adminChannelId && adminChannelId !== 'YOUR_NOTICE_ADMIN_CHANNEL_ID_HERE') {
                try {
                    adminChannel = await Promise.race([
                        this.client.channels.fetch(adminChannelId),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Admin channel fetch timeout')), fetchTimeout))
                    ]);
                } catch (adminError) {
                    this.debugConfig.log('Could not fetch admin channel', 'scheduler', null, adminError, 'warn');
                }
            }

            return { noticeChannel, adminChannel };
        } catch (error) {
            throw new Error(`Failed to fetch channels: ${error.message}`);
        }
    }

    async scrapeNoticesWithTimeout() {
        const scrapeTimeout = 60000;

        try {
            return await Promise.race([
                scrapeLatestNotice(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Notice scraping timeout')), scrapeTimeout))
            ]);
        } catch (error) {
            throw new Error(`Notice scraping failed: ${error.message}`);
        }
    }

    filterNoticesByAge(notices) {
        const MAX_NOTICE_AGE_DAYS = parseInt(process.env.MAX_NOTICE_AGE_DAYS || '30', 10);
        const now = new Date();

        return notices.filter(notice => {
            const noticeDate = new Date(notice.date);
            if (isNaN(noticeDate.getTime())) {
                this.debugConfig.log(`Invalid date format: ${notice.title} - ${notice.date}`, 'scheduler', { notice }, null, 'warn');
                return false;
            }

            const ageInDays = (now - noticeDate) / (1000 * 60 * 60 * 24);
            return ageInDays <= MAX_NOTICE_AGE_DAYS;
        });
    }

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

    async sendAdminAlert(adminChannel, message) {
        try {
            await adminChannel.send(`🚨 **Bot Alert:** ${message}`);
        } catch (error) {
            this.debugConfig.log('Failed to send admin alert', 'scheduler', null, error, 'warn');
        }
    }
}

export { NoticeProcessor };