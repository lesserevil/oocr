import { OcrService } from '../ocrService';
import { createWorker } from 'tesseract.js';
import { Notice } from 'obsidian';

// Mock tesseract.js
jest.mock('tesseract.js', () => ({
    createWorker: jest.fn(),
    PSM: {
        AUTO: '3',
        SINGLE_BLOCK: '6',
    },
    OEM: {
        LSTM_ONLY: 1,
    },
}));

// Mock Obsidian Notice
jest.mock('obsidian', () => ({
    Notice: jest.fn(),
}));

describe('OcrService', () => {
    let service: OcrService;
    let mockWorker: any;

    beforeEach(() => {
        // Create mock worker
        mockWorker = {
            recognize: jest.fn(),
            setParameters: jest.fn(),
            terminate: jest.fn(),
        };

        // Setup createWorker mock
        (createWorker as jest.Mock).mockResolvedValue(mockWorker);
        mockWorker.recognize.mockResolvedValue({
            data: { text: 'Recognized Text' },
        });

        service = new OcrService();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('should initialize Tesseract worker in handwriting mode by default', async () => {
        const result = await service.recognize('image.png');

        expect(createWorker).toHaveBeenCalledWith('eng', 1, expect.any(Object));
        expect(mockWorker.setParameters).toHaveBeenCalledWith({
            tessedit_pageseg_mode: '6', // SINGLE_BLOCK for handwriting
            tessedit_min_orientation_margin: '1',
        });
        expect(result).toBe('Recognized Text');
    });

    test('should use print mode when handwriting=false', async () => {
        await service.recognize('image.png', { handwriting: false });

        expect(mockWorker.setParameters).toHaveBeenCalledWith({
            tessedit_pageseg_mode: '3', // AUTO for print
        });
    });

    test('should recognize text from image in handwriting mode', async () => {
        await service.initialize({ handwriting: true });
        const result = await service.recognize('image.png', { handwriting: true });

        expect(mockWorker.recognize).toHaveBeenCalled();
        expect(result).toBe('Recognized Text');
    });

    test('should handle data URL conversion', async () => {
        const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

        await service.recognize(dataUrl);

        expect(mockWorker.recognize).toHaveBeenCalled();
        // The arg should be a Buffer, not the original data URL
        const callArg = (mockWorker.recognize as jest.Mock).mock.calls[0][0];
        expect(Buffer.isBuffer(callArg)).toBe(true);
    });

    test('should throw error on recognition failure', async () => {
        mockWorker.recognize.mockRejectedValueOnce(new Error('OCR Failed'));

        await expect(service.recognize('image.png')).rejects.toThrow('OCR Failed');
    });

    test('should terminate worker', async () => {
        await service.initialize();
        await service.terminate();

        expect(mockWorker.terminate).toHaveBeenCalled();
    });

    test('should not re-initialize if mode has not changed', async () => {
        await service.initialize({ handwriting: true });
        await service.initialize({ handwriting: true });

        // createWorker should only be called once
        expect(createWorker).toHaveBeenCalledTimes(1);
    });

    test('should re-initialize when switching modes', async () => {
        await service.initialize({ handwriting: true });
        await service.initialize({ handwriting: false });

        // createWorker should be called twice (once for each mode)
        expect(createWorker).toHaveBeenCalledTimes(2);
        expect(mockWorker.terminate).toHaveBeenCalledTimes(1);
    });

    test('should support different languages', async () => {
        await service.recognize('image.png', { language: 'spa' });

        expect(createWorker).toHaveBeenCalledWith('spa', 1, expect.any(Object));
    });
});
