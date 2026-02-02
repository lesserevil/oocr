import { App, Plugin, Notice, requestUrl, Platform } from 'obsidian';

export interface MyScriptOptions {
  applicationKey: string;
  language?: string;
}

export interface StrokePoint {
  x: number;
  y: number;
  t: number;
  p?: number;
}

export interface Stroke {
  points: StrokePoint[];
}

/**
 * MyScript Cloud Service
 *
 * Note: iink-ts v3.2.1 has TypeScript declaration issues with protected methods.
 * This implementation uses direct REST API calls instead.
 *
 * Key advantage: MyScript accepts vector stroke data directly!
 * Tesseract only accepts bitmaps.
 */
export class MyScriptService {
  private app: App;
  private plugin: Plugin;
  private options: MyScriptOptions | null = null;

  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
  }

  configure(options: MyScriptOptions): void {
    this.options = options;
  }

  isConfigured(): boolean {
    // Only check user settings (no env var fallback)
    return !!this.options?.applicationKey;
  }

  /**
   * Write debug info to a file in the vault for offline debugging
   */
  private async writeDebugFile(name: string, data: unknown): Promise<void> {
    // Check if debug files are enabled (settings is on plugin)
    const settings = (this.plugin as any).settings;
    if (!settings?.enableDebugFiles) {
      return;
    }
    try {
      const timestamp = Date.now();
      const filename = `debug_${name}_${timestamp}.txt`;
      const vaultPath = 'android-vault';
      const content = JSON.stringify({
        timestamp: new Date().toISOString(),
        vaultPath: vaultPath,
        platform: {
          isMobile: Platform.isMobile,
          isAndroidApp: Platform.isAndroidApp,
          isIosApp: Platform.isIosApp,
          isDesktop: Platform.isDesktop,
        },
        data: data,
      }, null, 2);
      await this.app.vault.create(filename, content);
      console.log(`[OOCR] Debug file created: ${filename}`);
    } catch (e) {
      console.error('[OOCR] Failed to write debug file:', e);
    }
  }

  /**
   * Convert captured strokes to JIIX format for MyScript
   * JIIX (JSON Ink) preserves stroke order, timing, and pressure
   * This is the key advantage over bitmap OCR!
   */
  private strokesToJIIX(strokes: Stroke[], language: string = 'en_US'): object {
    const jiixStrokes = strokes.map((stroke, strokeIndex) => ({
      id: `stroke-${strokeIndex}`,
      pointerType: 'PEN',
      pointerId: 1,
      x: stroke.points.map(p => Math.round(p.x)),
      y: stroke.points.map(p => Math.round(p.y)),
      t: stroke.points.map(p => p.t),
      ...(stroke.points[0]?.p !== undefined && {
        p: stroke.points.map(p => p.p ?? 0.5),
      }),
    }));

    // MyScript Cloud API v4 batch format requires configuration object
    return {
      configuration: {
        lang: language,
        export: {
          jiix: {
            'bounding-box': false,
            strokes: true,
            text: {
              chars: true,
              words: true,
            },
          },
        },
      },
      contentType: 'Text',
      strokeGroups: [{ strokes: jiixStrokes }],
    };
  }

  /**
   * Recognize handwriting by sending VECTOR STROKE DATA to MyScript Cloud
   * This preserves stroke order, timing, and pressure information
   * Result: Much better handwriting recognition than bitmap OCR
   */
  async recognizeStrokes(strokes: Stroke[]): Promise<string> {
    const debugInfo: Record<string, unknown> = {
      stage: 'start',
      strokeCount: strokes.length
    };
    await this.writeDebugFile('myscript_request', debugInfo);
    console.log('[OOCR] MyScript recognizeStrokes called with', strokes.length, 'strokes');

    if (!this.isConfigured()) {
      await this.writeDebugFile('myscript_error', { ...debugInfo, error: 'not_configured' });
      throw new Error('MyScript not configured. Please set API key in settings.');
    }

    const appKey = this.options?.applicationKey;
    if (!appKey) {
      throw new Error('MyScript API key not available');
    }

    debugInfo.appKeyPrefix = appKey.substring(0, 8) + '...';
    debugInfo.appKeyLength = appKey.length;

    if (strokes.length === 0) {
      return '';
    }

    try {
      new Notice('Recognizing handwriting with MyScript (stroke data)...');
      console.log('[OOCR] Sending', strokes.length, 'strokes to MyScript Cloud...');

      const language = this.options?.language || 'en_US';
      const jiix = this.strokesToJIIX(strokes, language);
      debugInfo.jiixPreview = JSON.stringify(jiix).substring(0, 200);
      console.log('[OOCR] JIIX preview:', debugInfo.jiixPreview);

      debugInfo.stage = 'sending_request';
      debugInfo.requestUrl = 'https://cloud.myscript.com/api/v4.0/iink/batch';

      // Capture request headers and full payload
      // NOTE: Must use application/json, NOT application/vnd.myscript.jiix
      // MyScript's server rejects the vendor content-type with charset
      const requestHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.myscript.jiix, text/plain',
        'applicationKey': appKey,
      };
      debugInfo.requestHeaders = requestHeaders;
      debugInfo.fullJiixPayload = jiix;
      debugInfo.fullRequestBody = JSON.stringify(jiix);

      // Write debug BEFORE making request
      await this.writeDebugFile('myscript_request', debugInfo);

      // Direct REST API call
      let response;
      try {
        response = await requestUrl({
          url: `https://cloud.myscript.com/api/v4.0/iink/batch`,
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(jiix),
        });
      } catch (requestError: any) {
        // requestUrl throws for non-2xx status - capture all error details
        console.log('[OOCR] Request failed:', requestError);
        debugInfo.stage = 'request_threw_error';
        debugInfo.errorRequest = {
          message: requestError.message,
          status: requestError.status,
          text: requestError.text?.substring(0, 2000),
          headers: requestError.headers,
          url: requestError.url,
        };
        await this.writeDebugFile('myscript_error', debugInfo);
        throw new Error(`MyScript request failed: ${requestError.status} ${requestError.text || requestError.message}`);
      }

      console.log('[OOCR] Response received:', response.status);
      debugInfo.responseStatus = response.status;
      debugInfo.responseHeaders = JSON.stringify(response.headers || {});

      if (response.status !== 200) {
        debugInfo.responseText = response.text?.substring(0, 2000);
        debugInfo.stage = 'error_' + response.status;
        debugInfo.fullJiixPayload = jiix;
        await this.writeDebugFile('myscript_error', debugInfo);
        throw new Error(`MyScript API error: ${response.status} ${response.text}`);
      }

      const result = response.json;

      // Parse JIIX response
      if (result && typeof result === 'object') {
        // Format: {"text": {"label": "recognized text", "words": [...]}}
        if (result.label) {
          console.log('[OOCR] MyScript result (top-level label):', result.label);
          return result.label;
        }
        // Format: {"text": {"label": "recognized text", "words": [...]}}
        if (result.text?.label) {
          console.log('[OOCR] MyScript result (result.text.label):', result.text.label);
          return result.text.label;
        }
        // Alternative formats
        if (result.result?.textLines) {
          const text = result.result.textLines
            .map((line: any) => line.label || '')
            .join('\n');
          console.log('[OOCR] MyScript result (textLines):', text);
          return text;
        }
        // Format with words array
        if (result.words && Array.isArray(result.words) && result.words.length > 0) {
          const text = result.words.map((w: any) => w.label || '').join(' ');
          console.log('[OOCR] MyScript result (from words):', text);
          return text;
        }
      }

      console.warn('Unexpected MyScript response format:', result);
      return '';
    } catch (error) {
      debugInfo.stage = 'error';
      debugInfo.error = error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : String(error);
      await this.writeDebugFile('myscript_error', debugInfo);
      console.error('[OOCR] MyScript stroke recognition failed:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      new Notice(`MyScript recognition failed: ${errorMsg}`);
      throw error;
    }
  }

  /**
   * Fallback: Recognize from bitmap (for compatibility)
   * MyScript also supports bitmap input via REST API
   */
  async recognizeBitmap(
    imageData: string | ArrayBuffer,
    mimeType: string = 'image/png'
  ): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('MyScript not configured. Please set API key in settings.');
    }

    const appKey = this.options?.applicationKey;
    if (!appKey) {
      throw new Error('MyScript API key not available');
    }

    try {
      new Notice('Recognizing with MyScript (bitmap mode)...');
      let arrayBuffer: ArrayBuffer;

      if (typeof imageData === 'string' && imageData.startsWith('data:')) {
        // Data URL to ArrayBuffer
        const base64Data = imageData.split(',')[1];
        let binaryStr: string;
        if (typeof atob !== 'undefined') {
          binaryStr = atob(base64Data);
        } else {
          // Manual base64 decode for Android
          const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
          binaryStr = '';
          const base64Replaced = base64Data.replace(/[^A-Za-z0-9+/]/g, '');
          for (let i = 0; i < base64Replaced.length; i += 4) {
            const enc1 = chars.indexOf(base64Replaced.charAt(i));
            const enc2 = chars.indexOf(base64Replaced.charAt(i + 1));
            const enc3 = chars.indexOf(base64Replaced.charAt(i + 2));
            const enc4 = chars.indexOf(base64Replaced.charAt(i + 3));
            const chr1 = (enc1 << 2) | (enc2 >> 4);
            const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
            const chr3 = ((enc3 & 3) << 6) | enc4;
            binaryStr += String.fromCharCode(chr1);
            if (enc3 !== 64) binaryStr += String.fromCharCode(chr2);
            if (enc4 !== 64) binaryStr += String.fromCharCode(chr3);
          }
        }
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        arrayBuffer = bytes.buffer;
      } else if (typeof imageData === 'string') {
        // Assume it's a URL - fetch it
        const response = await fetch(imageData);
        arrayBuffer = await response.arrayBuffer();
      } else {
        arrayBuffer = imageData;
      }

      // Direct REST API call with binary image data
      const response = await requestUrl({
        url: `https://cloud.myscript.com/api/v4.0/iink/batch`,
        method: 'POST',
        headers: {
          'Content-Type': mimeType,
          'Accept': 'application/vnd.myscript.jiix, text/plain',
          'applicationKey': appKey,
        },
        body: arrayBuffer,
      });

      if (response.status !== 200) {
        throw new Error(`MyScript API error: ${response.status} ${response.text}`);
      }

      const result = response.json;
      if (result && typeof result === 'object') {
        if (result.text?.label) {
          return result.text.label;
        }
      }
      return '';
    } catch (error) {
      console.error('MyScript bitmap recognition failed:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      new Notice(`MyScript recognition failed: ${errorMsg}`);
      throw error;
    }
  }

  /**
   * Get available languages
   */
  async getAvailableLanguages(): Promise<string[]> {
    return [
      'en_US', 'en_GB', 'en_CA',
      'fr_FR', 'fr_CA',
      'de_DE', 'de_AT', 'de_CH',
      'es_ES', 'es_MX',
      'pt_BR', 'pt_PT',
      'it_IT', 'nl_NL', 'pl_PL', 'ru_RU',
      'ja_JP', 'zh_CN', 'zh_TW', 'ko_KR',
      'ar_SA', 'hi_IN',
    ];
  }

  /**
   * Get free quota information
   * MyScript provides 2000 requests/month on free tier
   */
  getQuotaInfo(): { requestsPerMonth: number; type: string } {
    return {
      requestsPerMonth: 2000,
      type: 'Free tier',
    };
  }
}
