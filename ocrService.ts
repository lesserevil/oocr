import { createWorker, PSM, OEM } from 'tesseract.js';
import { Notice } from 'obsidian';

export interface OcrOptions {
    handwriting?: boolean;
    language?: string;
}

export class OcrService {
    private worker: Awaited<ReturnType<typeof createWorker>> | null = null;
    private isInitializing = false;
    private currentLanguage: string = 'eng';
    private isHandwritingMode: boolean = false;

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

            // Use LSTM engine which is better for handwriting
            this.worker = await createWorker(language, OEM.LSTM_ONLY, {
                logger: (m) => console.log('[Tesseract]', m),
            });

            // Handwriting-optimized parameters
            if (handwriting) {
                await this.worker.setParameters({
                    tessedit_pageseg_mode: PSM.SINGLE_BLOCK, // Treat image as single block
                    // Remove char whitelist to allow more flexibility
                    // tessedit_min_orientation_margin helps with skewed handwriting
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
            new Notice("Failed to initialize OCR service.");
            throw error;
        } finally {
            this.isInitializing = false;
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
                console.log("Converting Data URL to Buffer...");
                const base64Data = image.split(',')[1];
                input = Buffer.from(base64Data, 'base64');
            }

            const { data: { text } } = await this.worker!.recognize(input);
            console.log("OCR Result text length:", text ? text.length : 0);
            return text;
        } catch (error) {
            console.error("OCR recognition failed:", error);
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
