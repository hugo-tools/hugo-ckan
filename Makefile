CKAN_URL ?= https://dati.comune.milano.it
LANG     ?= it
MAX      ?= 0

.PHONY: harvest build serve clean
harvest:            ## snapshot the CKAN portal's metadata into data/ckan/
	python3 harvest.py $(CKAN_URL) --lang $(LANG) --max $(MAX)
build:              ## render the static site into public/
	hugo --gc --minify
serve:              ## local preview at http://localhost:1313
	hugo server
clean:
	rm -rf public resources
