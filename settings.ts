import { App, PluginSettingTab, Setting } from 'obsidian';
import OOCRPlugin from './main';

export interface OOCRSettings {
  // OCR Engine selection
  ocrEngine: 'tesseract' | 'myscript';

  // Tesseract settings
  tesseractLanguage: string;
  tesseractHandwritingMode: boolean;

  // MyScript settings
  myScriptApplicationKey: string;
  myScriptHmacKey: string;
  myScriptLanguage: string;

  // Capture settings
  captureStrokes: boolean; // Whether to capture vector stroke data
  fallbackToBitmap: boolean; // Fallback to bitmap if stroke recognition fails
}

export const DEFAULT_SETTINGS: OOCRSettings = {
  ocrEngine: 'tesseract',
  tesseractLanguage: 'eng',
  tesseractHandwritingMode: true,
  myScriptApplicationKey: '',
  myScriptHmacKey: '',
  myScriptLanguage: 'en_US',
  captureStrokes: true,
  fallbackToBitmap: true,
};

export class OOCRSettingTab extends PluginSettingTab {
  plugin: OOCRPlugin;

  constructor(app: App, plugin: OOCRPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'OOCR Settings' });

    // OCR Engine Selection
    new Setting(containerEl)
      .setName('OCR Engine')
      .setDesc('Choose between Tesseract.js (local, free) or MyScript (cloud, stroke-aware)')
      .addDropdown(dropdown =>
        dropdown
          .addOption('tesseract', 'Tesseract.js (Local)')
          .addOption('myscript', 'MyScript Cloud (Better handwriting)')
          .setValue(this.plugin.settings.ocrEngine)
          .onChange(async value => {
            this.plugin.settings.ocrEngine = value as 'tesseract' | 'myscript';
            await this.plugin.saveSettings();
            this.display(); // Refresh to show/hide relevant settings
          })
      );

    // Tesseract Settings
    if (this.plugin.settings.ocrEngine === 'tesseract') {
      containerEl.createEl('h3', { text: 'Tesseract Settings' });

      new Setting(containerEl)
        .setName('Language')
        .setDesc('Language code for OCR (e.g., eng, fra, deu)')
        .addText(text =>
          text
            .setPlaceholder('eng')
            .setValue(this.plugin.settings.tesseractLanguage)
            .onChange(async value => {
              this.plugin.settings.tesseractLanguage = value || 'eng';
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName('Handwriting Mode')
        .setDesc('Optimize for handwriting recognition')
        .addToggle(toggle =>
          toggle
            .setValue(this.plugin.settings.tesseractHandwritingMode)
            .onChange(async value => {
              this.plugin.settings.tesseractHandwritingMode = value;
              await this.plugin.saveSettings();
            })
        );
    }

    // MyScript Settings
    if (this.plugin.settings.ocrEngine === 'myscript') {
      containerEl.createEl('h3', { text: 'MyScript Settings' });

      const desc = document.createDocumentFragment();
      desc.appendText('Get your API keys from ');
      const link = desc.createEl('a', {
        href: 'https://developer.myscript.com/getting-started/web',
        text: 'developer.myscript.com',
      });
      link.setAttr('target', '_blank');
      desc.appendText('. Free tier includes 2000 requests/month.');

      containerEl.createEl('p', { text: '' }).append(desc);

      new Setting(containerEl)
        .setName('Application Key')
        .setDesc('Your MyScript Cloud application key')
        .addText(text =>
          text
            .setPlaceholder('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx')
            .setValue(this.plugin.settings.myScriptApplicationKey)
            .onChange(async value => {
              this.plugin.settings.myScriptApplicationKey = value;
              await this.plugin.saveSettings();
              this.plugin.updateMyScriptConfig();
            })
        );

      new Setting(containerEl)
        .setName('HMAC Key')
        .setDesc('Your MyScript Cloud HMAC key (for request signing)')
        .addText(text => {
          text
            .setPlaceholder('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx')
            .setValue(this.plugin.settings.myScriptHmacKey)
            .onChange(async value => {
              this.plugin.settings.myScriptHmacKey = value;
              await this.plugin.saveSettings();
              this.plugin.updateMyScriptConfig();
            });
          text.inputEl.type = 'password';
          return text;
        });

      new Setting(containerEl)
        .setName('Language')
        .setDesc('Language for recognition (e.g., en_US, fr_FR, de_DE)')
        .addText(text =>
          text
            .setPlaceholder('en_US')
            .setValue(this.plugin.settings.myScriptLanguage)
            .onChange(async value => {
              this.plugin.settings.myScriptLanguage = value || 'en_US';
              await this.plugin.saveSettings();
            })
        );

      // Status indicator
      const isConfigured = this.plugin.myScriptService?.isConfigured();
      const statusDiv = containerEl.createEl('div', {
        cls: 'myscript-status',
      });
      statusDiv.style.padding = '12px';
      statusDiv.style.marginTop = '16px';
      statusDiv.style.borderRadius = '4px';

      if (isConfigured) {
        statusDiv.style.backgroundColor = 'var(--background-modifier-success)';
        statusDiv.style.color = 'var(--text-on-accent)';
        statusDiv.textContent = '✓ MyScript is configured and ready';
      } else {
        statusDiv.style.backgroundColor = 'var(--background-modifier-error)';
        statusDiv.style.color = 'var(--text-on-accent)';
        statusDiv.textContent = '✗ MyScript is not configured. Please add your API keys.';
      }
    }

    // Capture Settings (shared)
    containerEl.createEl('h3', { text: 'Capture Settings' });

    new Setting(containerEl)
      .setName('Capture Stroke Data')
      .setDesc('Store vector stroke data alongside bitmaps (enables stroke-based recognition with MyScript)')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.captureStrokes)
          .onChange(async value => {
            this.plugin.settings.captureStrokes = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Fallback to Bitmap')
      .setDesc('If stroke recognition fails, fall back to bitmap OCR')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.fallbackToBitmap)
          .onChange(async value => {
            this.plugin.settings.fallbackToBitmap = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
