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
        const start = (e: MouseEvent | TouchEvent) => {
            e.preventDefault();
            this.isDrawing = true;
            const { x, y } = this.getCoords(e);
            this.ctx?.beginPath();
            this.ctx?.moveTo(x, y);
        };

        const move = (e: MouseEvent | TouchEvent) => {
            if (!this.isDrawing) return;
            e.preventDefault();
            const { x, y } = this.getCoords(e);
            this.ctx?.lineTo(x, y);
            this.ctx?.stroke();
        };

        const end = (e: MouseEvent | TouchEvent) => {
            if (!this.isDrawing) return;
            e.preventDefault();
            this.isDrawing = false;
            this.ctx?.closePath();
        };

        // Mouse
        this.canvas.addEventListener("mousedown", start);
        this.canvas.addEventListener("mousemove", move);
        this.canvas.addEventListener("mouseup", end);
        this.canvas.addEventListener("mouseout", end);

        // Touch
        this.canvas.addEventListener("touchstart", start, { passive: false });
        this.canvas.addEventListener("touchmove", move, { passive: false });
        this.canvas.addEventListener("touchend", end, { passive: false });
    }

    getCoords(e: MouseEvent | TouchEvent) {
        const rect = this.canvas.getBoundingClientRect();
        let clientX, clientY;

        if (window.TouchEvent && e instanceof TouchEvent) {
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

        this.canvas.width = rect.width;
        this.canvas.height = rect.height;

        this.setupContext();

        // Fill white background to ensure opacity
        this.ctx!.fillStyle = "#FFFFFF";
        this.ctx!.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Restore content
        const img = new Image();
        img.onload = () => {
            this.ctx?.drawImage(img, 0, 0);
        };
        img.src = prevContent;
    }

    setupContext() {
        if (!this.ctx) return;
        this.ctx.lineWidth = 3;
        this.ctx.lineCap = "round";
        this.ctx.lineJoin = "round";
        this.ctx.strokeStyle = "#000000";
    }

    clearCanvas() {
        if (!this.ctx) return;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = "#FFFFFF";
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    async runOcr() {
        if (!this.ocrService) return;

        // UI Feedback
        const originalCursor = this.canvas.style.cursor;
        this.canvas.style.cursor = "wait";

        new Notice("Processing handwriting...");
        try {
            // Get Data URL (default PNG)
            const dataUrl = this.canvas.toDataURL("image/png");
            const text = await this.ocrService.recognize(dataUrl);

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
            const dataUrl = this.canvas.toDataURL("image/png");
            const text = await this.ocrService.recognize(dataUrl);

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
}
