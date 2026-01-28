import { createWorker, Worker } from 'tesseract.js';
import { Notice } from 'obsidian';

export class OcrService {
    private worker: Worker | null = null;
    private isInitializing = false;

    async initialize() {
        if (this.worker || this.isInitializing) return;

        this.isInitializing = true;
        try {
            console.log("Initializing Tesseract worker...");
            // Default load from CDN for now. 
            // In the future for offline support, we would bundle worker paths.
            this.worker = await createWorker('eng');
            console.log("Tesseract worker initialized.");
        } catch (error) {
            console.error("Failed to initialize Tesseract worker:", error);
            new Notice("Failed to initialize OCR engine.");
        } finally {
            this.isInitializing = false;
        }
    }

    async recognize(image: string | Buffer): Promise<string> {
        if (!this.worker) {
            await this.initialize();
        }

        if (!this.worker) {
            throw new Error("OCR worker not available");
        }

        try {
            const result = await this.worker.recognize(image);
            return result.data.text;
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
