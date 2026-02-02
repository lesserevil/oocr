import { Plugin, Notice, TFile, WorkspaceLeaf, MarkdownView } from 'obsidian';
import { OcrService } from './ocrService';
import { MyScriptService } from './myScriptService';
import { HandwritingView, HANDWRITING_VIEW_TYPE } from './handwritingView';
import { OOCRSettings, DEFAULT_SETTINGS, OOCRSettingTab } from './settings';

export default class OOCRPlugin extends Plugin {
  public settings: OOCRSettings;
  private ocrService: OcrService;
  public myScriptService: MyScriptService;
  public lastActiveMarkdownView: MarkdownView | null = null;

  async onload() {
    console.log('Loading OOCR plugin');

    // Load settings
    const loadedData = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);

    // Initialize services
    this.ocrService = new OcrService(this.app);
    this.myScriptService = new MyScriptService(this.app, this);
    this.updateMyScriptConfig();

    // Register settings tab
    this.addSettingTab(new OOCRSettingTab(this.app, this));

    this.registerView(
      HANDWRITING_VIEW_TYPE,
      (leaf) => new HandwritingView(leaf, this.ocrService, this.myScriptService, this)
    );

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (leaf?.view instanceof MarkdownView) {
          this.lastActiveMarkdownView = leaf.view;
        }
      })
    );

    this.addRibbonIcon('pencil', 'Open Handwriting OCR', () => {
      this.activateView();
    });

    this.addCommand({
      id: 'open-handwriting-view',
      name: 'Open Handwriting Canvas',
      callback: () => {
        this.activateView();
      }
    });

    this.addCommand({
      id: 'run-ocr-test',
      name: 'Test OCR on Sample URL',
      callback: async () => {
        new Notice("Starting OCR test...");
        try {
          const text = await this.ocrService.recognize('https://tesseract.projectnaptha.com/img/eng_bw.png');
          console.log("OCR Result:", text);
          new Notice("OCR Complete! Check console.");
        } catch (e) {
          new Notice("OCR Failed: " + e);
        }
      }
    });

    // Quick switch command
    this.addCommand({
      id: 'toggle-ocr-engine',
      name: 'Toggle OCR Engine (Tesseract <-> MyScript)',
      callback: async () => {
        this.settings.ocrEngine = this.settings.ocrEngine === 'tesseract' ? 'myscript' : 'tesseract';
        await this.saveSettings();
        new Notice(`Switched to ${this.settings.ocrEngine === 'myscript' ? 'MyScript' : 'Tesseract'}`);
      }
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && this.isImage(file)) {
          menu.addItem((item) => {
            item
              .setTitle("Extract Text with OCR")
              .setIcon("scan-line")
              .onClick(async () => {
                await this.performOcrOnFile(file);
              });
          });
        }
      })
    );

    this.addCommand({
      id: 'ocr-active-file',
      name: 'Extract Text from Current File (if Image)',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file instanceof TFile && this.isImage(file)) {
          if (!checking) {
            this.performOcrOnFile(file);
          }
          return true;
        }
        return false;
      }
    });
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  updateMyScriptConfig() {
    if (this.myScriptService && this.settings.myScriptApplicationKey) {
      this.myScriptService.configure({
        applicationKey: this.settings.myScriptApplicationKey,
        language: this.settings.myScriptLanguage,
      });
    }
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(HANDWRITING_VIEW_TYPE);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: HANDWRITING_VIEW_TYPE, active: true });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
      this.app.workspace.setActiveLeaf(leaf);
    }
  }

  isImage(file: TFile): boolean {
    const extensions = ["png", "jpg", "jpeg", "webp", "bmp"];
    return extensions.includes(file.extension.toLowerCase());
  }

  async performOcrOnFile(file: TFile) {
    new Notice(`Starting OCR on ${file.name}...`);
    try {
      const arrayBuffer = await this.app.vault.readBinary(file);
      let text = '';

      // Use selected engine
      if (this.settings.ocrEngine === 'myscript' && this.myScriptService?.isConfigured()) {
        text = await this.myScriptService.recognizeBitmap(arrayBuffer, `image/${file.extension === 'jpg' ? 'jpeg' : file.extension}`);
      } else {
        const blob = new Blob([arrayBuffer]);
        const url = URL.createObjectURL(blob);
        text = await this.ocrService.recognize(url);
        URL.revokeObjectURL(url);
      }

      if (text.trim().length === 0) {
        new Notice("OCR finished, but no text was found.");
        return;
      }

      await navigator.clipboard.writeText(text);
      new Notice("OCR Complete! Text copied to clipboard.");
    } catch (error) {
      console.error(error);
      new Notice("OCR Failed: " + error);
    }
  }

  async onunload() {
    console.log('Unloading OOCR plugin');
    await this.ocrService.terminate();
  }
}
