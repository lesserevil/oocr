import { ItemView, WorkspaceLeaf, Notice, ButtonComponent, MarkdownView, Editor } from "obsidian";
import { OcrService } from "./ocrService";
import OOCRPlugin from "./main";

export const HANDWRITING_VIEW_TYPE = "handwriting-view";

export class HandwritingView extends ItemView {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D | null;
    private isDrawing = false;
    private ocrService: OcrService;
    private plugin: OOCRPlugin;
    private resizeObserver: ResizeObserver;
    private pressureValues: number[] = [];
    private strokeLogs: string[] = [];

    constructor(leaf: WorkspaceLeaf, ocrService: OcrService, plugin: OOCRPlugin) {
        super(leaf);
        this.ocrService = ocrService;
        this.plugin = plugin;
    }

    getViewType() {
        return HANDWRITING_VIEW_TYPE;
    }

    getDisplayText() {
        return "Handwriting OCR";
    }

    getIcon() {
        return "pencil";
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass("handwriting-container");

        // Toolbar
        const toolbar = container.createDiv({ cls: "handwriting-toolbar" });

        new ButtonComponent(toolbar)
            .setButtonText("Clear")
            .setIcon("eraser")
            .onClick(() => this.clearCanvas());

        new ButtonComponent(toolbar)
            .setButtonText("Recognize")
            .setIcon("scan-line")
            .onClick(() => this.runOcr());

        new ButtonComponent(toolbar)
            .setButtonText("Insert")
            .setIcon("arrow-right-circle")
            .setCta()
            .onClick(() => this.runOcrAndInsert());

        // Debug Button (Temporary)
        new ButtonComponent(toolbar)
            .setButtonText("Save Img")
            .setIcon("image-file")
            .onClick(() => this.saveDebugImage());

        // Canvas Wrapper
        const canvasWrapper = container.createDiv({ cls: "handwriting-canvas-wrapper" });

        // Canvas
        this.canvas = canvasWrapper.createEl("canvas", { cls: "handwriting-canvas" });
        this.ctx = this.canvas.getContext("2d");

        // Setup drawing events
        this.setupDrawingEvents();

        // Setup monitoring for size changes
        this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
        this.resizeObserver.observe(canvasWrapper);
    }

    async onClose() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
    }

    setupDrawingEvents() {
        let lastX = 0;
        let lastY = 0;

        const start = (e: PointerEvent) => {
            e.preventDefault();
            this.isDrawing = true;
            const { x, y } = this.getCoords(e);
            lastX = x;
            lastY = y;

            // Draw a single dot in case it's just a tap
            this.ctx?.beginPath();
            this.ctx?.arc(x, y, this.ctx.lineWidth / 2, 0, Math.PI * 2);
            this.ctx?.fill();
            this.ctx?.beginPath(); // Reset path for moving
            this.ctx?.moveTo(x, y);
        };

        const move = (e: PointerEvent) => {
            if (!this.isDrawing || !this.ctx) return;
            e.preventDefault();

            // Handle pressure
            const pressure = e.pressure !== undefined && e.pressure > 0 ? e.pressure : 0.5;
            this.pressureValues.push(pressure);

            const baseWidth = 4.5;
            const dynamicWidth = baseWidth * (0.5 + pressure);

            const { x, y } = this.getCoords(e);

            // Draw segment
            this.ctx.lineWidth = dynamicWidth;
            this.ctx.beginPath();
            this.ctx.moveTo(lastX, lastY);
            this.ctx.lineTo(x, y);
            this.ctx.stroke();

            lastX = x;
            lastY = y;
        };

        const end = (e: PointerEvent) => {
            if (!this.isDrawing) return;
            e.preventDefault();
            this.isDrawing = false;

            if (this.pressureValues.length > 0) {
                const unique = new Set(this.pressureValues).size;
                const min = Math.min(...this.pressureValues).toFixed(3);
                const max = Math.max(...this.pressureValues).toFixed(3);
                const msg = `Stroke ${new Date().toISOString()}: ${this.pressureValues.length} pts, ${unique} unique levels. Range: ${min}-${max}`;
                console.log(msg);
                this.strokeLogs.push(msg);
                this.pressureValues = [];
            }
        };

        // Pointer Events (Unified Mouse/Touch/Pen)
        this.canvas.addEventListener("pointerdown", start as any);
        this.canvas.addEventListener("pointermove", move as any);
        this.canvas.addEventListener("pointerup", end as any);
        this.canvas.addEventListener("pointerout", end as any);
        this.canvas.addEventListener("pointercancel", end as any);
    }

    getCoords(e: PointerEvent | MouseEvent | TouchEvent) {
        const rect = this.canvas.getBoundingClientRect();
        let clientX, clientY;

        if (window.PointerEvent && e instanceof PointerEvent) {
            clientX = e.clientX;
            clientY = e.clientY;
        } else if (window.TouchEvent && e instanceof TouchEvent) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else if (e instanceof MouseEvent) {
            clientX = e.clientX;
            clientY = e.clientY;
        } else {
            clientX = 0; clientY = 0;
        }

        return {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    }

    resizeCanvas() {
        if (!this.canvas || !this.canvas.parentElement) return;

        const rect = this.canvas.parentElement.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        // Save content before resize clears it
        const prevContent = this.canvas.toDataURL();

        // Handle High DPI displays (Retina, Android)
        // This makes the canvas backing store larger than its CSS display size
        const dpr = window.devicePixelRatio || 1;

        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;

        // Ensure the canvas displays at the correct visual size
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;

        // Scale all drawing operations by dpr so logic remains in CSS pixels
        this.ctx = this.canvas.getContext("2d");
        this.ctx?.scale(dpr, dpr);

        this.setupContext();

        // Fill white background to ensure opacity
        // Note: fillRect uses context coordinates, which are already scaled
        this.ctx!.fillStyle = "#FFFFFF";
        this.ctx!.fillRect(0, 0, rect.width, rect.height);

        // Restore content
        const img = new Image();
        img.onload = () => {
            // Draw image at full resolution (it's already a DataURL of the previous state)
            // We need to be careful here: if prevContent was low-res, it stays low-res.
            // But going forward new strokes will be high-res.
            // Since toDataURL returns the backing store resolution, 
            // and we are drawing it into a new scaled context... 
            // We usually want to draw it 1:1 with the backing store? 
            // Actually, simply drawing it at 0,0 with requested width/height in CSS pixels 
            // (which are scaled to backing pixels) works best to fit.
            this.ctx?.drawImage(img, 0, 0, rect.width, rect.height);
        };
        img.src = prevContent;
    }

    setupContext() {
        if (!this.ctx) return;
        this.ctx.lineWidth = 4.5;
        this.ctx.lineCap = "round";
        this.ctx.lineJoin = "round";
        this.ctx.strokeStyle = "#000000";
    }

    clearCanvas() {
        if (!this.ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();

        // Use logical dimensions for drawing operations since context is scaled
        this.ctx.clearRect(0, 0, rect.width, rect.height);
        this.ctx.fillStyle = "#FFFFFF";
        this.ctx.fillRect(0, 0, rect.width, rect.height);
    }

    // Helper to add white padding around the image for better Tesseract recognition
    getPaddedImage(): string {
        const padding = 20; // 20px padding (logical)
        const dpr = window.devicePixelRatio || 1;
        const width = this.canvas.width;
        const height = this.canvas.height;

        // Create temp canvas
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width + (padding * 2 * dpr);
        tempCanvas.height = height + (padding * 2 * dpr);

        const tCtx = tempCanvas.getContext('2d');
        if (!tCtx) return this.canvas.toDataURL("image/png");

        // Fill white
        tCtx.fillStyle = "#FFFFFF";
        tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        // Draw original canvas centered
        tCtx.drawImage(this.canvas, padding * dpr, padding * dpr);

        // Binarize (Threshold) the image to remove anti-aliasing (gray pixels)
        // detailed OCR often works better with sharp black/white
        const imageData = tCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const data = imageData.data;
        const threshold = 180; // Reverted to 180: Produced best results ("nace text for est")

        for (let i = 0; i < data.length; i += 4) {
            // Calculate grayscale brightness (r+g+b)/3
            const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
            const val = brightness > threshold ? 255 : 0;

            data[i] = val;     // R
            data[i + 1] = val; // G
            data[i + 2] = val; // B
            // Alpha stays 255 (or whatever it was)
        }
        tCtx.putImageData(imageData, 0, 0);

        return tempCanvas.toDataURL("image/png");
    }

    async runOcr() {
        if (!this.ocrService) return;

        // UI Feedback
        const originalCursor = this.canvas.style.cursor;
        this.canvas.style.cursor = "wait";

        new Notice("Processing handwriting...");
        try {
            // Get Data URL (default PNG)
            const dataUrl = this.getPaddedImage();
            const text = await this.ocrService.recognize(dataUrl, { handwriting: true });

            if (text.trim()) {
                await navigator.clipboard.writeText(text);
                new Notice("Copied!");
            } else {
                new Notice("No text detected.");
            }
        } catch (error) {
            console.error(error);
            new Notice("Recognition failed.");
        } finally {
            this.canvas.style.cursor = originalCursor;
        }
    }

    async runOcrAndInsert() {
        if (!this.ocrService) return;

        // UI Feedback
        const originalCursor = this.canvas.style.cursor;
        this.canvas.style.cursor = "wait";
        new Notice("Processing & Inserting...");

        try {
            const dataUrl = this.getPaddedImage();
            const text = await this.ocrService.recognize(dataUrl, { handwriting: true });

            if (text.trim()) {
                // Find valid markdown view to insert into
                // Try Active View first (in case user clicked back to editor)
                let markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);

                // Fallback to tracked last active view
                if (!markdownView && this.plugin.lastActiveMarkdownView) {
                    markdownView = this.plugin.lastActiveMarkdownView;
                }

                if (markdownView) {
                    const editor = markdownView.editor;
                    const cursor = editor.getCursor();
                    editor.replaceRange(text, cursor); // replaceRange is safer than replaceSelection if no selection
                    new Notice("Inserted text!");
                } else {
                    // Fallback if user focus is lost (e.g. pinned view)
                    // Try to copy to clipboard anyway as fallback
                    await navigator.clipboard.writeText(text);
                    new Notice("No active document found. Copied to clipboard instead.");
                }
            } else {
                new Notice("No text detected.");
            }
        } catch (error) {
            console.error(error);
            new Notice("Recognition/Insert failed.");
        } finally {
            this.canvas.style.cursor = originalCursor;
        }
    }
    async saveDebugImage() {
        try {
            const dataUrl = this.getPaddedImage();
            const base64Data = dataUrl.split(',')[1];

            // Convert to binary (Android compatible)
            const binaryStr = window.atob(base64Data);
            const len = binaryStr.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
            }

            // Save to file in vault root
            const timestamp = Date.now();
            const filename = `debug_ocr_${timestamp}.png`;
            await this.app.vault.adapter.writeBinary(filename, bytes.buffer);

            // Save stroke log
            const logFilename = `debug_ocr_${timestamp}.txt`;
            await this.app.vault.adapter.write(logFilename, this.strokeLogs.join('\n'));

            new Notice(`Saved debug image: ${filename}`);
            console.log(`Saved debug image to ${filename}`);
        } catch (error) {
            console.error(error);
            new Notice("Failed to save debug image");
        }
    }
}
