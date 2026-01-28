import { OcrService } from '../ocrService';
import { createWorker } from 'tesseract.js';
import { Notice } from 'obsidian';

// Mock Tesseract.js
jest.mock('tesseract.js', () => ({
    createWorker: jest.fn(),
}));

// Mock Obsidian Notice
jest.mock('obsidian', () => ({
    Notice: jest.fn(),
}));

describe('OcrService', () => {
    let service: OcrService;
    let mockWorker: any;

    beforeEach(() => {
        service = new OcrService();
        mockWorker = {
            recognize: jest.fn().mockResolvedValue({ data: { text: 'Recognized Text' } }),
            terminate: jest.fn(),
        };
        (createWorker as jest.Mock).mockResolvedValue(mockWorker);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('should initialize worker on first recognition', async () => {
        await service.recognize('image.png');
        expect(createWorker).toHaveBeenCalledWith('eng');
    });

    test('should reuse worker for subsequent calls', async () => {
        await service.recognize('image1.png');
        await service.recognize('image2.png');
        expect(createWorker).toHaveBeenCalledTimes(1);
    });

    test('should return recognized text', async () => {
        const result = await service.recognize('image.png');
        expect(result).toBe('Recognized Text');
        expect(mockWorker.recognize).toHaveBeenCalledWith('image.png');
    });

    test('should terminate worker', async () => {
        await service.recognize('image.png'); // Ensure initialized
        await service.terminate();
        expect(mockWorker.terminate).toHaveBeenCalled();
    });

    test('should handle initialization errors', async () => {
        (createWorker as jest.Mock).mockRejectedValueOnce(new Error('Init Failed'));

        await expect(service.recognize('image.png')).rejects.toThrow('OCR worker not available');
        expect(Notice).toHaveBeenCalledWith('Failed to initialize OCR engine.');
    });
});
