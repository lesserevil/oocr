// Live API test - runs actual HTTP request to MyScript Cloud
// This test uses native fetch (Node 18+) instead of Obsidian's requestUrl

// Load env vars from .env.test
require('dotenv').config({ path: '.env.test' });

describe('MyScript Live API Test', () => {
  const realApiKey = process.env.MYSCRIPT_APPLICATION_KEY;

  test('make real request to MyScript API', async () => {
    if (!realApiKey) {
      console.log('Skipping live API test - no MYSCRIPT_APPLICATION_KEY in .env.test');
      return;
    }

    console.log('\n=== LIVE API TEST ===');
    console.log('Using API key:', realApiKey.substring(0, 8) + '...');

    // Simple stroke (like writing "A")
    const strokes = [
      {
        points: [
          { x: 100, y: 200, t: 0, p: 0.5 },
          { x: 150, y: 100, t: 200, p: 0.7 },
          { x: 200, y: 200, t: 400, p: 0.5 },
        ]
      },
      {
        points: [
          { x: 125, y: 150, t: 500, p: 0.5 },
          { x: 175, y: 150, t: 600, p: 0.5 },
        ]
      }
    ];

    // Create JIIX payload with strokeGroups (per MyScript REST API spec)
    const jiixStrokes = strokes.map((stroke, i) => ({
      id: `stroke-${i}`,
      pointerType: 'PEN',
      pointerId: 1,
      x: stroke.points.map(p => Math.round(p.x)),
      y: stroke.points.map(p => Math.round(p.y)),
      t: stroke.points.map(p => p.t),
      p: stroke.points.map(p => p.p ?? 0.5),
    }));

    const jiix = {
      configuration: {
        lang: 'en_US',
        export: {
          jiix: {
            'bounding-box': false,
            strokes: true,
            text: {
              chars: true,
              words: true
            }
          }
        }
      },
      contentType: 'Text',
      strokeGroups: [{ strokes: jiixStrokes }],
    };

    console.log('\nRequest URL: https://cloud.myscript.com/api/v4.0/iink/batch');
    console.log('Headers:', {
      'Content-Type': 'application/vnd.myscript.jiix',
      'Accept': 'application/vnd.myscript.jiix, text/plain',
      'applicationKey': realApiKey.substring(0, 8) + '...',
    });
    console.log('\nJIIX payload:');
    console.log(JSON.stringify(jiix, null, 2));

    try {
      const bodyStr = JSON.stringify(jiix);

      const response = await fetch('https://cloud.myscript.com/api/v4.0/iink/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.myscript.jiix, text/plain',
          'applicationKey': realApiKey,
        },
        body: bodyStr,
      });

      const responseText = await response.text();

      console.log('\n=== RESPONSE ===');
      console.log('Status:', response.status);
      console.log('Status Text:', response.statusText);
      const headerObj: Record<string, string> = {};
      response.headers.forEach((value, key) => { headerObj[key] = value; });
      console.log('Headers:', headerObj);
      console.log('Body preview:', responseText?.substring(0, 1000));

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${responseText}`);
      }

      expect(response.status).toBe(200);
      console.log('\n✓ Live API test PASSED');
    } catch (error: any) {
      console.log('\n=== ERROR ===');
      console.log('Error:', error.message);
      console.log('\n✗ Live API test FAILED');
      throw error;
    }
  }, 30000);
});
