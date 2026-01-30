# Obsidian OCR Plugin (OOCR)

OCR text recognition plugin optimized for Boox tablets and handwriting input.

## Features

✅ **Handwriting OCR** - Optimized for handwritten notes using Tesseract LSTM engine  
✅ **Canvas Input** - Draw directly in Obsidian and convert to text  
✅ **Image OCR** - Right-click any image file to extract text  
✅ **Auto-Insert** - Recognize and insert text at cursor position  
✅ **Multiple Languages** - Support for 100+ languages via Tesseract

## Handwriting Recognition

The plugin uses Tesseract.js with special optimizations for handwriting:

### How It Works

1. **LSTM Engine** - Uses Long Short-Term Memory neural network (better for cursive/handwriting)
2. **Single Block Mode** - Treats input as continuous text block (vs. document layout)
3. **Orientation Correction** - Handles slightly skewed or rotated handwriting

### Tips for Better Accuracy

📝 **Write clearly** - Separate letters, avoid overlapping strokes  
📝 **Use contrast** - Black ink on white background works best  
📝 **Size matters** - Larger handwriting = better recognition  
📝 **Clean background** - Remove noise, shadows, or background patterns  

### Image Preprocessing (Future Enhancement)

For even better results, you could add image preprocessing:
- **Binarization** - Convert to pure black & white
- **Noise Removal** - Remove speckles and artifacts
- **Deskewing** - Auto-rotate tilted images
- **Contrast Enhancement** - Make text stand out more

## Usage

### Handwriting Canvas

1. Click ribbon icon or use command palette: "Open Handwriting OCR"
2. Draw your text on the canvas
3. Click "Recognize" to copy to clipboard
4. Or click "Insert" to insert at cursor position

### Image File OCR

1. Right-click any PNG/JPG image in file explorer
2. Select "Run OCR on this image"
3. Text will be saved as a `.md` file

## Installation

### From Release

1. Download `main.js`, `manifest.json`, `styles.css` from latest release
2. Create folder: `<vault>/.obsidian/plugins/oocr/`
3. Copy files to the folder
4. Enable plugin in Obsidian settings

### From Source

```bash
git clone <repo>
cd oocr
npm install
OBSIDIAN_VAULT=/path/to/vault make install
```

## Development

```bash
# Run tests
make test

# Build and install
OBSIDIAN_VAULT=/path/to/vault make install

# Watch mode
npm run dev
```

## Technical Details

### Architecture

- **Tesseract.js 5.1.1** - JavaScript port of Tesseract OCR engine
- **LSTM Mode** - Neural network-based recognition (vs. legacy pattern matching)
- **Worker-based** - OCR runs in background without blocking UI

### Why Tesseract.js (not Scribe.js)?

We initially tried Scribe.js but reverted to Tesseract.js because:

1. **Nested Workers Issue** - Scribe.js requires spawning workers from workers, which conflicts with Obsidian's plugin security model
2. **Simpler Architecture** - Tesseract.js has a cleaner API and fewer dependencies
3. **Better Compatibility** - Works out-of-the-box in Electron/Obsidian environment

## License

MIT
