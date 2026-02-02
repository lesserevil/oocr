import { MyScriptService, Stroke, StrokePoint } from '../myScriptService';
import { Notice, requestUrl } from 'obsidian';

// Mock Obsidian
jest.mock('obsidian', () => ({
  Notice: jest.fn(),
  requestUrl: jest.fn(),
  Platform: {
    isMobile: false,
    isAndroidApp: false,
    isIosApp: false,
    isDesktop: true,
  },
}));

describe('MyScriptService', () => {
  let service: MyScriptService;
  let mockApp: any;
  let mockVault: any;

  beforeEach(() => {
    mockVault = {
      create: jest.fn().mockResolvedValue(undefined),
    };
    mockApp = {
      vault: mockVault,
    };
    service = new MyScriptService(mockApp, {} as any);
    service.configure({
      applicationKey: 'test-api-key-12345678901234567890',
      language: 'en_US',
    });
    jest.clearAllMocks();
  });

  describe('JIIX Format', () => {
    test('should create valid JIIX structure', () => {
      // Create a simple stroke
      const strokes: Stroke[] = [{
        points: [
          { x: 10, y: 20, t: 1000, p: 0.5 },
          { x: 15, y: 25, t: 1100, p: 0.7 },
          { x: 20, y: 30, t: 1200, p: 0.5 },
        ]
      }];

      // Access private method via any cast
      const jiix = (service as any).strokesToJIIX(strokes, 'en_US');

      console.log('JIIX Output:', JSON.stringify(jiix, null, 2));

      // Validate structure
      expect(jiix).toHaveProperty('configuration');
      expect(jiix).toHaveProperty('contentType', 'Text');
      expect(jiix).toHaveProperty('strokeGroups');
      expect(Array.isArray(jiix.strokeGroups)).toBe(true);
      expect(jiix.strokeGroups).toHaveLength(1);

      // Validate configuration
      expect(jiix.configuration).toHaveProperty('lang', 'en_US');
      expect(jiix.configuration).toHaveProperty('export');
      expect(jiix.configuration.export).toHaveProperty('jiix');

      // Validate stroke structure (strokes are inside strokeGroups)
      const stroke = jiix.strokeGroups[0].strokes[0];
      expect(stroke).toHaveProperty('id', 'stroke-0');
      expect(stroke).toHaveProperty('pointerType', 'PEN');
      expect(stroke).toHaveProperty('pointerId', 1);
      expect(stroke).toHaveProperty('x');
      expect(stroke).toHaveProperty('y');
      expect(stroke).toHaveProperty('t');
      expect(stroke).toHaveProperty('p');
      expect(Array.isArray(stroke.x)).toBe(true);
      expect(Array.isArray(stroke.y)).toBe(true);
      expect(Array.isArray(stroke.t)).toBe(true);
      expect(Array.isArray(stroke.p)).toBe(true);
    });

    test('should handle empty strokes array', () => {
      const strokes: Stroke[] = [];
      const jiix = (service as any).strokesToJIIX(strokes, 'en_US');

      expect(jiix.strokeGroups).toHaveLength(1);
      expect(jiix.strokeGroups[0].strokes).toHaveLength(0);
      expect(jiix.configuration.lang).toBe('en_US');
    });

    test('should round coordinates to integers', () => {
      const strokes: Stroke[] = [{
        points: [
          { x: 10.7, y: 20.3, t: 1000 },
          { x: 15.2, y: 25.8, t: 1100 },
        ]
      }];

      const jiix = (service as any).strokesToJIIX(strokes, 'en_US');

      expect(jiix.strokeGroups[0].strokes[0].x).toEqual([11, 15]);
      expect(jiix.strokeGroups[0].strokes[0].y).toEqual([20, 26]);
    });

    test('should not include pressure if not provided', () => {
      const strokes: Stroke[] = [{
        points: [
          { x: 10, y: 20, t: 1000 },  // No pressure
          { x: 15, y: 25, t: 1100 },
        ]
      }];

      const jiix = (service as any).strokesToJIIX(strokes, 'en_US');

      expect(jiix.strokeGroups[0].strokes[0]).not.toHaveProperty('p');
    });

    test('should validate JIIX matches MyScript API spec', () => {
      const strokes: Stroke[] = [{
        points: [
          { x: 100, y: 200, t: 1000, p: 0.8 },
          { x: 110, y: 210, t: 1100, p: 0.9 },
        ]
      }];

      const jiix = (service as any).strokesToJIIX(strokes, 'en_US');
      const jsonStr = JSON.stringify(jiix);

      // Log full payload for inspection
      console.log('Full JIIX JSON payload:', jsonStr);
      console.log('Payload size:', jsonStr.length, 'bytes');

      // Validate required fields
      expect(jsonStr).toContain('configuration');
      expect(jsonStr).toContain('contentType');
      expect(jsonStr).toContain('Text');
      expect(jsonStr).toContain('strokes');

      // Validate configuration structure
      expect(jsonStr).toContain('"lang":"en_US"');
      expect(jsonStr).toContain('export');
      expect(jsonStr).toContain('jiix');
    });
  });

  describe('isConfigured', () => {
    test('should return true when API key is set', () => {
      expect(service.isConfigured()).toBe(true);
    });

    test('should return false when API key is empty', () => {
      service.configure({ applicationKey: '' });
      expect(service.isConfigured()).toBe(false);
    });

    test('should return false when never configured', () => {
      const emptyService = new MyScriptService(mockApp, {} as any);
      expect(emptyService.isConfigured()).toBe(false);
    });
  });
});
