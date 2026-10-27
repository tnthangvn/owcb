# codebase-workflow site. Usage: make help
SKILL    := .agents/skills/codebase-workflow
SCRIPTS  := $(SKILL)/scripts
ARCHIFY  := .agents/skills/archify
PROJECTS := $(patsubst %/src/plan.json,%,$(wildcard */src/plan.json))
P        ?= $(PROJECTS)
PORT     ?= 8765

.PHONY: help compile build check site serve clean clean-all

help:
	@echo "make compile [P=<project>] [PAGE=id]  spec -> compiler -> archify finalize (staged in src/pages/<id>/out)"
	@echo "make build                      publish staged pages, merge manifests, render every index.html"
	@echo "make check                      gates: manifest, files, links, coverage, secrets"
	@echo "make site [P=<project>]               compile + build + check"
	@echo "make serve [PORT=8765]          preview the site at http://127.0.0.1:$(PORT)/"
	@echo "make clean [P=<project>] [KEEP=all]   delete failed runs and older passes (KEEP=all keeps every pass)"
	@echo "make clean-all [P=<project>]          delete all regenerable work files, passing evidence too"
	@echo "projects: $(PROJECTS)"

compile:
	@for p in $(P); do node $(SCRIPTS)/plan.mjs compile $$p $(if $(PAGE),--page $(PAGE)) || exit 1; done

build:
	@for p in $(PROJECTS); do node $(SCRIPTS)/plan.mjs manifest $$p || exit 1; done
	@node $(SCRIPTS)/build-site.mjs .

check:
	@node $(SCRIPTS)/check-site.mjs .

site: compile build check

serve:
	python3 -m http.server $(PORT) --bind 127.0.0.1

# Removes failed review folders, stale/failed candidate attempts, pending receipts, and passes replaced by a newer one (KEEP=all keeps them).
clean:
	@for p in $(P); do node $(SCRIPTS)/clean.mjs $$p $(if $(filter all,$(KEEP)),,--latest) || exit 1; done
	@find . -maxdepth 1 -type d -name 'review-*' -exec rm -rf {} +

# Full wipe of regenerable work files (passing evidence too); `make site` rebuilds them.
clean-all:
	@for p in $(P); do \
	  test -d $$p/src/pages || continue; \
	  find $$p/src/pages -mindepth 2 -maxdepth 2 -type d \( -name 'review-*' -o -name 'build-*' -o -name compiled -o -name out -o -name receipts \) -prune -exec rm -rf {} +; \
	  find $$p/src/pages -mindepth 2 -maxdepth 2 -type f \( -name worker.log -o -name '*.delivery-pending.json' \) -delete; \
	  echo "wiped $$p"; \
	done
