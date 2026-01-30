import { createWorker, PSM, OEM } from 'tesseract.js';
import { Notice, App } from 'obsidian';

export interface OcrOptions {
    handwriting?: boolean;
    language?: string;
}

export class OcrService {
    private app: App;
    private worker: Awaited<ReturnType<typeof createWorker>> | null = null;
    private isInitializing = false;
    private currentLanguage: string = 'eng';
    private isHandwritingMode: boolean = false;

    constructor(app: App) {
        this.app = app;
    }

    async getAssetPath(filename: string): Promise<string> {
        const adapter = this.app.vault.adapter;
        // Construct path relative to vault root: .obsidian/plugins/oocr/resources/filename
        // @ts-ignore - configDir is defined in newer types but might be missing in strict types check
        const configDir = this.app.vault.configDir || '.obsidian';
        const path = `${configDir}/plugins/oocr/resources/${filename}`;

        const exists = await adapter.exists(path);
        if (!exists) {
            console.error(`Asset not found: ${path}`);
            throw new Error(`Asset not found: ${path}`);
        }

        return adapter.getResourcePath(path);
    }

    async initialize(options: OcrOptions = {}) {
        const { handwriting = true, language = 'eng' } = options; // Default to handwriting mode

        // Re-initialize if mode changed
        const modeChanged = this.isHandwritingMode !== handwriting || this.currentLanguage !== language;
        if (this.worker && !modeChanged) return;

        if (this.worker && modeChanged) {
            console.log("OCR mode changed, re-initializing...");
            await this.terminate();
        }

        if (this.isInitializing) return;

        this.isInitializing = true;
        try {
            this.currentLanguage = language;
            this.isHandwritingMode = handwriting;

            console.log(`Initializing Tesseract worker (${handwriting ? 'handwriting' : 'print'} mode, language: ${language})...`);

            console.log(`Initializing Tesseract worker (${handwriting ? 'handwriting' : 'print'} mode, language: ${language})...`);

            // 1. Get Core Path - Point to the directory containing all tesseract-core variants
            // Tesseract will append the specific filename (e.g. tesseract-core-simd.wasm.js)
            const configDir = this.app.vault.configDir || '.obsidian';

            // Note: We need a trailing slash for Tesseract to treat it as a directory
            let corePath = this.app.vault.adapter.getResourcePath(`${configDir}/plugins/oocr/resources/`);

            // Strip any query parameters (like ?1769...) that Obsidian adds, 
            // otherwise Tesseract appends the filename AFTER the query param, breaking the path.
            if (corePath.includes('?')) {
                corePath = corePath.split('?')[0];
            }

            // Ensure trailing slash exists after stripping
            if (!corePath.endsWith('/')) {
                corePath += '/';
            }

            // 2. Get Worker Blob URL - Read file content locally to bypass SecurityError on desktop
            // We cannot pass 'app://' URL to new Worker(), so we create a Blob
            const workerRelPath = `${configDir}/plugins/oocr/resources/worker.min.js`;

            if (!(await this.app.vault.adapter.exists(workerRelPath))) {
                throw new Error(`Worker file not found at ${workerRelPath}`);
            }

            const workerContent = await this.app.vault.adapter.read(workerRelPath);
            const workerBlob = new Blob([workerContent], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(workerBlob);

            // 3. Get Lang Path - Same logic as corePath
            const langPath = corePath; // They are in the same directory

            console.log("Loading Tesseract assets from:", { workerRelPath, corePath, langPath });

            // Use LSTM engine which is better for handwriting
            this.worker = await createWorker(language, OEM.LSTM_ONLY, {
                workerPath: workerUrl,
                corePath,
                langPath,
                cacheMethod: 'none', // Force use of local file (no IndexDB caching to prevent partial downloads)
                workerBlobURL: false, // We already provided a Blob URL
                logger: (m) => console.log('[Tesseract]', m),
            });

            // Handwriting-optimized parameters
            if (handwriting) {
                await this.worker.setParameters({
                    tessedit_pageseg_mode: PSM.SINGLE_BLOCK, // Treat image as single block
                    tessedit_char_whitelist: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?-()\'" ',
                    tessedit_min_orientation_margin: '1',
                });
            } else {
                // Standard printed text parameters
                await this.worker.setParameters({
                    tessedit_pageseg_mode: PSM.AUTO,
                });
            }

            console.log("Tesseract worker initialized successfully");
        } catch (error) {
            console.error("Failed to initialize Tesseract worker:", error);
            await this.logErrorToFile(error, "initialize");
            new Notice("Failed to initialize OCR service.");
            throw error;
        } finally {
            this.isInitializing = false;
        }
    }

    async logErrorToFile(error: any, context: string) {
        const logFile = 'OOCR_DEBUG.md';
        const timestamp = new Date().toISOString();
        const msg = `\n\n## ${timestamp} - ${context}\n${error}\n${error.stack || ''}\n`;

        try {
            const adapter = this.app.vault.adapter;
            if (await adapter.exists(logFile)) {
                await adapter.append(logFile, msg);
            } else {
                await adapter.write(logFile, "# OOCR Debug Log" + msg);
            }
        } catch (e) {
            console.error("Failed to write to log file", e);
        }
    }

    async recognize(image: string | Buffer, options: OcrOptions = {}): Promise<string> {
        const { handwriting = true, language = 'eng' } = options; // Default to handwriting mode

        // Initialize with appropriate mode
        await this.initialize({ handwriting, language });

        try {
            console.log(`Starting OCR recognition (${handwriting ? 'handwriting' : 'print'} mode)...`);

            let input: any = image;
            if (typeof image === 'string' && image.startsWith('data:')) {
                console.log("Converting Data URL to Buffer/Uint8Array...");
                const base64Data = image.split(',')[1];

                // Use standard Web API for cross-platform compatibility (Android has no Buffer)
                const binaryStr = window.atob(base64Data);
                const len = binaryStr.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    bytes[i] = binaryStr.charCodeAt(i);
                }
                input = bytes;
            }

            const { data: { text } } = await this.worker!.recognize(input);
            console.log("OCR Result text length:", text ? text.length : 0);
            return text;
        } catch (error) {
            console.error("OCR recognition failed:", error);
            await this.logErrorToFile(error, "recognize");
            throw error;
        }
    }

    async terminate() {
        if (this.worker) {
            await this.worker.terminate();
            this.worker = null;
        }
    }
}
