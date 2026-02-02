import { ItemView, WorkspaceLeaf, Notice, ButtonComponent, MarkdownView, Editor } from 'obsidian';
import { OcrService } from './ocrService';
import { MyScriptService, Stroke, StrokePoint } from './myScriptService';
import OOCRPlugin from './main';

export const HANDWRITING_VIEW_TYPE = 'handwriting-view';

interface CapturedStroke {
  points: StrokePoint[];
}

export class HandwritingView extends ItemView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private isDrawing = false;
  private ocrService: OcrService;
  private myScriptService: MyScriptService;
  private plugin: OOCRPlugin;
  private resizeObserver: ResizeObserver;

  // Stroke capture for MyScript
  private currentStroke: CapturedStroke | null = null;
  private capturedStrokes: CapturedStroke[] = [];
  private strokeStartTime: number = 0;

  // Debug/logging
  private pressureValues: number[] = [];
  private strokeLogs: string[] = [];

  constructor(
    leaf: WorkspaceLeaf,
    ocrService: OcrService,
    myScriptService: MyScriptService,
    plugin: OOCRPlugin
  ) {
    super(leaf);
    this.ocrService = ocrService;
    this.myScriptService = myScriptService;
    this.plugin = plugin;
  }

  getViewType() {
    return HANDWRITING_VIEW_TYPE;
  }

  getDisplayText() {
    return 'Handwriting OCR';
  }

  getIcon() {
    return 'pencil';
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('handwriting-container');

    // Toolbar
    const toolbar = container.createDiv({ cls: 'handwriting-toolbar' });

    new ButtonComponent(toolbar)
      .setButtonText('Clear')
      .setIcon('eraser')
      .onClick(() => this.clearCanvas());

    // Show current engine in recognize button
    const engineLabel = this.plugin.settings.ocrEngine === 'myscript' ? '(MyScript)' : '(Tesseract)';
    new ButtonComponent(toolbar)
      .setButtonText(`Recognize ${engineLabel}`)
      .setIcon('scan-line')
      .setTooltip(`Using ${this.plugin.settings.ocrEngine}`)
      .onClick(() => this.runOcr());

    new ButtonComponent(toolbar)
      .setButtonText('Insert')
      .setIcon('arrow-right-circle')
      .setCta()
      .onClick(() => this.runOcrAndInsert());

    // Debug Button
    new ButtonComponent(toolbar)
      .setButtonText('Save Img')
      .setIcon('image-file')
      .onClick(() => this.saveDebugImage());

    // Stroke count indicator (if capturing strokes)
    if (this.plugin.settings.captureStrokes) {
      const strokeInfo = toolbar.createEl('span', {
        cls: 'stroke-info',
        text: 'Strokes: 0'
      });
      strokeInfo.style.marginLeft = 'auto';
      strokeInfo.style.fontSize = '12px';
      strokeInfo.style.color = 'var(--text-muted)';
      (this as any).strokeInfoEl = strokeInfo;
    }

    // Canvas Wrapper
    const canvasWrapper = container.createDiv({ cls: 'handwriting-canvas-wrapper' });

    // Canvas
    this.canvas = canvasWrapper.createEl('canvas', { cls: 'handwriting-canvas' });
    this.ctx = this.canvas.getContext('2d');

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

      // Start new stroke capture
      this.strokeStartTime = Date.now();
      this.currentStroke = {
        points: [{
          x: x,
          y: y,
          t: 0,
          p: e.pressure !== undefined && e.pressure > 0 ? e.pressure : 0.5
        }]
      };

      // Draw a single dot in case it's just a tap
      this.ctx?.beginPath();
      this.ctx?.arc(x, y, (this.ctx.lineWidth / 2), 0, Math.PI * 2);
      this.ctx?.fill();
      this.ctx?.beginPath();
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

      // Add point to current stroke
      if (this.currentStroke) {
        this.currentStroke.points.push({
          x: x,
          y: y,
          t: Date.now() - this.strokeStartTime,
          p: pressure
        });
      }

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

      // Save completed stroke
      if (this.currentStroke && this.currentStroke.points.length > 0) {
        this.capturedStrokes.push(this.currentStroke);
        this.currentStroke = null;
        this.updateStrokeInfo();
      }

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
    this.canvas.addEventListener('pointerdown', start as any);
    this.canvas.addEventListener('pointermove', move as any);
    this.canvas.addEventListener('pointerup', end as any);
    this.canvas.addEventListener('pointerout', end as any);
    this.canvas.addEventListener('pointercancel', end as any);
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
      clientX = 0;
      clientY = 0;
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

    // Handle High DPI displays
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;

    // Scale all drawing operations by dpr
    this.ctx = this.canvas.getContext('2d');
    this.ctx?.scale(dpr, dpr);
    this.setupContext();

    // Fill white background
    this.ctx!.fillStyle = '#FFFFFF';
    this.ctx!.fillRect(0, 0, rect.width, rect.height);

    // Restore content
    const img = new Image();
    img.onload = () => {
      this.ctx?.drawImage(img, 0, 0, rect.width, rect.height);
    };
    img.src = prevContent;
  }

  setupContext() {
    if (!this.ctx) return;
    this.ctx.lineWidth = 4.5;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.strokeStyle = '#000000';
  }

  clearCanvas() {
    if (!this.ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();

    this.ctx.clearRect(0, 0, rect.width, rect.height);
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.fillRect(0, 0, rect.width, rect.height);

    // Clear captured strokes
    this.capturedStrokes = [];
    this.currentStroke = null;
    this.updateStrokeInfo();
  }

  updateStrokeInfo() {
    const infoEl = (this as any).strokeInfoEl;
    if (infoEl) {
      infoEl.textContent = `Strokes: ${this.capturedStrokes.length}`;
    }
  }

  getPaddedImage(): string {
    const padding = 20;
    const dpr = window.devicePixelRatio || 1;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Create temp canvas
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width + (padding * 2 * dpr);
    tempCanvas.height = height + (padding * 2 * dpr);
    const tCtx = tempCanvas.getContext('2d');

    if (!tCtx) return this.canvas.toDataURL('image/png');

    // Fill white
    tCtx.fillStyle = '#FFFFFF';
    tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

    // Draw original canvas centered
    tCtx.drawImage(this.canvas, padding * dpr, padding * dpr);

    // Binarize (Threshold)
    const imageData = tCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const data = imageData.data;
    const threshold = 180;

    for (let i = 0; i < data.length; i += 4) {
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const val = brightness > threshold ? 255 : 0;
      data[i] = val;
      data[i + 1] = val;
      data[i + 2] = val;
    }
    tCtx.putImageData(imageData, 0, 0);

    return tempCanvas.toDataURL('image/png');
  }

  /**
   * Convert captured strokes to MyScript format
   */
  getCapturedStrokes(): Stroke[] {
    return this.capturedStrokes.map(stroke => ({
      points: stroke.points
    }));
  }

  async runOcr() {
    const originalCursor = this.canvas.style.cursor;
    this.canvas.style.cursor = 'wait';
    new Notice('Processing handwriting...');

    try {
      let text = '';

      // Use selected engine
      if (this.plugin.settings.ocrEngine === 'myscript' && this.plugin.settings.captureStrokes) {
        // Try MyScript with stroke data first (the key advantage!)
        const strokes = this.getCapturedStrokes();
        if (strokes.length > 0 && this.myScriptService?.isConfigured()) {
          try {
            console.log(`Sending ${strokes.length} strokes to MyScript...`);
            text = await this.myScriptService.recognizeStrokes(strokes);
          } catch (strokeError) {
            console.warn('Stroke recognition failed, falling back to bitmap:', strokeError);
            if (this.plugin.settings.fallbackToBitmap) {
              const dataUrl = this.getPaddedImage();
              text = await this.myScriptService.recognizeBitmap(dataUrl);
            }
          }
        } else if (this.myScriptService?.isConfigured()) {
          // No strokes captured or MyScript not configured, use bitmap
          const dataUrl = this.getPaddedImage();
          text = await this.myScriptService.recognizeBitmap(dataUrl);
        } else {
          throw new Error('MyScript not configured. Please add API keys in settings.');
        }
      } else if (this.plugin.settings.ocrEngine === 'myscript' && this.myScriptService?.isConfigured()) {
        // MyScript selected but stroke capture disabled - use bitmap
        const dataUrl = this.getPaddedImage();
        text = await this.myScriptService.recognizeBitmap(dataUrl);
      } else {
        // Default to Tesseract
        const dataUrl = this.getPaddedImage();
        text = await this.ocrService.recognize(dataUrl, {
          handwriting: this.plugin.settings.tesseractHandwritingMode,
          language: this.plugin.settings.tesseractLanguage
        });
      }

      if (text.trim()) {
        await navigator.clipboard.writeText(text);
        new Notice('Copied!');
        return text;
      } else {
        new Notice('No text detected.');
        return '';
      }
    } catch (error) {
      console.error(error);
      new Notice('Recognition failed: ' + error.message);
      return '';
    } finally {
      this.canvas.style.cursor = originalCursor;
    }
  }

  async runOcrAndInsert() {
    const text = await this.runOcr();

    if (!text.trim()) return;

    try {
      // Find valid markdown view to insert into
      let markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);

      if (!markdownView && this.plugin.lastActiveMarkdownView) {
        markdownView = this.plugin.lastActiveMarkdownView;
      }

      if (markdownView) {
        const editor = markdownView.editor;
        const cursor = editor.getCursor();
        editor.replaceRange(text, cursor);
        new Notice('Inserted text!');
      } else {
        // Fallback: copy to clipboard
        await navigator.clipboard.writeText(text);
        new Notice('No active document found. Copied to clipboard instead.');
      }
    } catch (error) {
      console.error(error);
      new Notice('Insert failed: ' + error.message);
    }
  }

  async saveDebugImage() {
    try {
      const dataUrl = this.getPaddedImage();
      const base64Data = dataUrl.split(',')[1];

      // Convert to binary
      const binaryStr = window.atob(base64Data);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      // Save to file
      const timestamp = Date.now();
      const filename = `debug_ocr_${timestamp}.png`;
      await this.app.vault.adapter.writeBinary(filename, bytes.buffer);

      // Save stroke data if available
      if (this.capturedStrokes.length > 0) {
        const strokesFilename = `debug_ocr_${timestamp}_strokes.json`;
        const strokesData = {
          strokeCount: this.capturedStrokes.length,
          strokes: this.capturedStrokes.map(s => ({
            pointCount: s.points.length,
            points: s.points
          }))
        };
        await this.app.vault.adapter.write(strokesFilename, JSON.stringify(strokesData, null, 2));
      }

      // Save stroke log
      const logFilename = `debug_ocr_${timestamp}.txt`;
      await this.app.vault.adapter.write(logFilename, this.strokeLogs.join('\n'));

      new Notice(`Saved debug files: ${filename}`);
      console.log(`Saved debug image to ${filename}`);
    } catch (error) {
      console.error(error);
      new Notice('Failed to save debug files');
    }
  }
}
