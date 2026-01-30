OBSIDIAN_VAULT ?= 
LANG_DATA_URL = https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz
DEV_RESOURCES_DIR = dev-resources
LANG_DATA_FILE = $(DEV_RESOURCES_DIR)/eng.traineddata.gz

.PHONY: all build install test download-assets

all: build

download-assets:
	@mkdir -p $(DEV_RESOURCES_DIR)
	@if [ ! -f "$(LANG_DATA_FILE)" ]; then \
		echo "Downloading language data..."; \
		curl -L "$(LANG_DATA_URL)" -o "$(LANG_DATA_FILE)"; \
	fi

build:
	npm run build

install: build download-assets
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
	mkdir -p "$(OBSIDIAN_VAULT)/.obsidian/plugins/oocr/resources"
	cp main.js manifest.json styles.css "$(OBSIDIAN_VAULT)/.obsidian/plugins/oocr/"
	cp node_modules/tesseract.js/dist/worker.min.js "$(OBSIDIAN_VAULT)/.obsidian/plugins/oocr/resources/"
	cp node_modules/tesseract.js-core/tesseract-core*.wasm "$(OBSIDIAN_VAULT)/.obsidian/plugins/oocr/resources/"
	cp node_modules/tesseract.js-core/tesseract-core*.js "$(OBSIDIAN_VAULT)/.obsidian/plugins/oocr/resources/"
	cp $(LANG_DATA_FILE) "$(OBSIDIAN_VAULT)/.obsidian/plugins/oocr/resources/"
	@echo "Success: Installed oocr plugin to $(OBSIDIAN_VAULT)/.obsidian/plugins/oocr/"

test: download-assets
	npm test
