# OOCR Plugin Makefile

# Environment Variables:
# OBSIDIAN_VAULT - Path to local Obsidian vault for 'make install'
# ANDROID_VAULT - Path on Android device for 'make install-android' or 'make debug-pull'
# MYSCRIPT_APPLICATION_KEY - MyScript Cloud API key (for .env usage)
# MYSCRIPT_HMAC_KEY - MyScript Cloud HMAC key (for .env usage)

OBSIDIAN_VAULT ?=
ANDROID_VAULT ?=

# Version management - increment patch version on each build
VERSION_FILE := manifest.json
CURRENT_VERSION := $(shell node -p "require('./$(VERSION_FILE)').version")
BUILD_VERSION := $(shell node -p "const parts='$(CURRENT_VERSION)'.split('.'); parts[2]=parseInt(parts[2])+1; parts.join('.')")

LANG_DATA_URL = https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz
DEV_RESOURCES_DIR = dev-resources
LANG_DATA_FILE = $(DEV_RESOURCES_DIR)/eng.traineddata.gz

.PHONY: all build install test download-assets help bump-version

# Default target
all: build

# Bump the patch version number
bump-version:
	@node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync('$(VERSION_FILE)')); console.log('Version: ' + m.version + ' -> $(BUILD_VERSION)'); m.version='$(BUILD_VERSION)'; fs.writeFileSync('$(VERSION_FILE)', JSON.stringify(m,null,2)+'\\n');"

# Help target - shows all available targets and their env vars
help:
	@echo "OOCR Plugin - Available Make Targets"
	@echo "====================================="
	@echo ""
	@echo "Current Version: $(CURRENT_VERSION)"
	@echo ""
	@echo "Development Targets:"
	@echo "  make build          - Build the plugin (TypeScript + esbuild)"
	@echo "  make dist           - Assemble full distribution into dist/ directory"
	@echo "  make test           - Run test suite (after downloading assets)"
	@echo "  make download-assets - Download Tesseract language data files"
	@echo ""
	@echo "Installation Targets:"
	@echo "  make install        - Install to local Obsidian vault"
	@echo "    Requires: OBSIDIAN_VAULT=/path/to/vault"
	@echo ""
	@echo "  make install-android - Install to Android device via ADB"
	@echo "    Requires: ANDROID_VAULT=/sdcard/Documents/VaultName"
	@echo ""
	@echo "Android Debug Targets:"
	@echo "  make debug-pull     - Pull debug images from Android device"
	@echo "    Requires: ANDROID_VAULT=/sdcard/Documents/VaultName"
	@echo ""
	@echo "Environment Variables for Testing:"
	@echo "  MYSCRIPT_APPLICATION_KEY - Your MyScript Cloud app key"
	@echo "  MYSCRIPT_HMAC_KEY       - Your MyScript Cloud HMAC key"
	@echo "  (Copy .env.example to .env and fill in your keys)"
	@echo ""
	@echo "Examples:"
	@echo "  OBSIDIAN_VAULT=/Users/me/Documents/MyVault make install"
	@echo "  ANDROID_VAULT=/sdcard/Documents/MyVault make install-android"
	@echo ""

download-assets:
	@mkdir -p $(DEV_RESOURCES_DIR)
	@if [ ! -f "$(LANG_DATA_FILE)" ]; then \
		echo "Downloading language data..."; \
		curl -L "$(LANG_DATA_URL)" -o "$(LANG_DATA_FILE)"; \
	fi

build: bump-version
	npm run build
	@echo "==> Built OOCR v$(BUILD_VERSION)"

# Assemble the plugin into a local dist directory
dist: build download-assets
	@rm -rf dist
	@mkdir -p dist/resources
	cp main.js manifest.json styles.css dist/
	cp node_modules/tesseract.js/dist/worker.min.js dist/resources/
	cp node_modules/tesseract.js-core/tesseract-core*.wasm dist/resources/
	cp node_modules/tesseract.js-core/tesseract-core*.js dist/resources/
	cp $(LANG_DATA_FILE) dist/resources/
	@echo "==> Dist ready: OOCR v$(BUILD_VERSION)"

# Install to local Obsidian vault
install: dist
	@if [ -z "$(OBSIDIAN_VAULT)" ]; then \
		echo "Error: OBSIDIAN_VAULT environment variable is not set"; \
		echo "Usage: OBSIDIAN_VAULT=/path/to/vault make install"; \
		exit 1; \
	fi
	@if [ ! -d "$(OBSIDIAN_VAULT)/.obsidian" ]; then \
		echo "Error: $(OBSIDIAN_VAULT) does not appear to be an Obsidian vault (no .obsidian directory found)"; \
		exit 1; \
	fi
	mkdir -p "$(OBSIDIAN_VAULT)/.obsidian/plugins/oocr"
	cp -r dist/* "$(OBSIDIAN_VAULT)/.obsidian/plugins/oocr/"
	@echo "==> Installed OOCR v$(BUILD_VERSION) to $(OBSIDIAN_VAULT)/.obsidian/plugins/oocr/"

# Install to Android device via ADB
install-android: dist
	@if [ -z "$(ANDROID_VAULT)" ]; then \
		echo "Error: ANDROID_VAULT environment variable is not set"; \
		echo "Usage: ANDROID_VAULT=/sdcard/Documents/VaultName make install-android"; \
		exit 1; \
	fi
	@echo "==> Pushing OOCR v$(BUILD_VERSION) to Android device..."
	adb shell mkdir -p "$(ANDROID_VAULT)/.obsidian/plugins/oocr"
	adb push dist/. "$(ANDROID_VAULT)/.obsidian/plugins/oocr/"
	@echo "==> Installed OOCR v$(BUILD_VERSION) to Android $(ANDROID_VAULT)/.obsidian/plugins/oocr/"

# Pull debug images from Android
debug-pull:
	@mkdir -p debug_captures
	@if [ -z "$(ANDROID_VAULT)" ]; then \
		echo "Error: ANDROID_VAULT environment variable is not set"; \
		echo "Usage: ANDROID_VAULT=/sdcard/Documents/VaultName make debug-pull"; \
		exit 1; \
	fi
	adb shell ls "$(ANDROID_VAULT)/debug_ocr_*" 2>/dev/null | tr -d '\r' | xargs -n1 -I{} adb pull "{}" debug_captures/ || true

test: download-assets
	npm test
