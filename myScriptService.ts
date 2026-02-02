import { App, Plugin, Notice, requestUrl } from 'obsidian';

export interface MyScriptOptions {
  applicationKey: string;
  hmacKey: string;
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
    // Check user settings first, then fall back to build-time env vars
    const hasUserKeys = !!this.options?.applicationKey && !!this.options?.hmacKey;
    const hasBuildKeys = !!(process.env.MYSCRIPT_APPLICATION_KEY && process.env.MYSCRIPT_HMAC_KEY);
    return hasUserKeys || hasBuildKeys;
  }

  /**
   * Get effective API keys (user settings take priority over build-time env vars)
   */
  private getKeys(): { applicationKey: string; hmacKey: string } | null {
    // User settings take priority
    if (this.options?.applicationKey && this.options?.hmacKey) {
      return {
        applicationKey: this.options.applicationKey,
        hmacKey: this.options.hmacKey,
      };
    }
    // Fall back to build-time env vars (for CI/testing)
    if (process.env.MYSCRIPT_APPLICATION_KEY && process.env.MYSCRIPT_HMAC_KEY) {
      return {
        applicationKey: process.env.MYSCRIPT_APPLICATION_KEY,
        hmacKey: process.env.MYSCRIPT_HMAC_KEY,
      };
    }
    return null;
  }

  /**
   * Convert captured strokes to JIIX format for MyScript
   * JIIX (JSON Ink) preserves stroke order, timing, and pressure
   * This is the key advantage over bitmap OCR!
   */
  private strokesToJIIX(strokes: Stroke[]): object {
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

    return {
      version: '3',
      contentType: 'Text',
      text: {
        mimeType: 'text/plain',
      },
      strokes: jiixStrokes,
    };
  }

  /**
   * Recognize handwriting by sending VECTOR STROKE DATA to MyScript Cloud
   * This preserves stroke order, timing, and pressure information
   * Result: Much better handwriting recognition than bitmap OCR
   */
  async recognizeStrokes(strokes: Stroke[]): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('MyScript not configured. Please set API keys in settings.');
    }

    const keys = this.getKeys();
    if (!keys) {
      throw new Error('MyScript API keys not available');
    }

    if (strokes.length === 0) {
      return '';
    }

    try {
      new Notice('Recognizing handwriting with MyScript (stroke data)...');
      console.log(`Sending ${strokes.length} strokes to MyScript Cloud...`);

      const jiix = this.strokesToJIIX(strokes);

      // Direct REST API call - bypassing iink-ts protected method issues
      const response = await requestUrl({
        url: `https://cloud.myscript.com/api/v4.0/iink/batch`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.myscript.jiix; charset=UTF-8',
          'Accept': 'application/vnd.myscript.jiix, text/plain',
          'applicationKey': keys.applicationKey,
          'hmac': await this.computeHMAC(jiix, keys.hmacKey),
        },
        body: JSON.stringify(jiix),
      });

      if (response.status !== 200) {
        throw new Error(`MyScript API error: ${response.status} ${response.text}`);
      }

      const result = response.json;

      // Parse JIIX response
      if (result && typeof result === 'object') {
        // Format: {"text": {"label": "recognized text", "words": [...]}}
        if (result.text?.label) {
          console.log('MyScript result:', result.text.label);
          return result.text.label;
        }

        // Alternative formats
        if (result.result?.textLines) {
          return result.result.textLines
            .map((line: any) => line.label || '')
            .join('\n');
        }
      }

      console.warn('Unexpected MyScript response format:', result);
      return '';
    } catch (error) {
      console.error('MyScript stroke recognition failed:', error);
      new Notice(`MyScript recognition failed: ${error}`);
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
      throw new Error('MyScript not configured. Please set API keys in settings.');
    }

    const keys = this.getKeys();
    if (!keys) {
      throw new Error('MyScript API keys not available');
    }

    try {
      new Notice('Recognizing with MyScript (bitmap mode)...');

      let arrayBuffer: ArrayBuffer;

      if (typeof imageData === 'string' && imageData.startsWith('data:')) {
        // Data URL to ArrayBuffer
        const base64Data = imageData.split(',')[1];
        const binaryStr = window.atob(base64Data);
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
          'applicationKey': keys.applicationKey,
          'hmac': await this.computeHMAC(arrayBuffer, keys.hmacKey),
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
      new Notice(`MyScript recognition failed: ${error}`);
      throw error;
    }
  }

  /**
   * Compute HMAC signature for MyScript authentication
   * Required for all API requests
   */
  private async computeHMAC(data: object | ArrayBuffer, hmacKey: string): Promise<string> {
    // HMAC computation using Web Crypto API
    const encoder = new TextEncoder();
    const keyData = encoder.encode(hmacKey);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-512' },
      false,
      ['sign']
    );

    let dataToSign: ArrayBuffer;
    if (data instanceof ArrayBuffer) {
      dataToSign = data;
    } else {
      dataToSign = encoder.encode(JSON.stringify(data));
    }

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataToSign);

    // Convert to base64
    const bytes = new Uint8Array(signature);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
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
      'it_IT', 'nl_NL', 'pl_PL',
      'ru_RU', 'ja_JP', 'zh_CN', 'zh_TW',
      'ko_KR', 'ar_SA', 'hi_IN',
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
