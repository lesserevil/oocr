OBSIDIAN_VAULT ?= 

.PHONY: all build install test

all: build

build:
	npm run build

install: build
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
	cp main.js manifest.json styles.css "$(OBSIDIAN_VAULT)/.obsidian/plugins/oocr/"
	@echo "Success: Installed oocr plugin to $(OBSIDIAN_VAULT)/.obsidian/plugins/oocr/"

test:
	npm test
