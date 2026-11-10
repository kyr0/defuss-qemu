PYTHON ?= python3
NODE ?= node
BUILD_OUTPUT ?= artifacts/build-new
JOBS ?= 8
VAE_SESSION ?= $(CODEX_SESSION_ID)
N ?= 80
VAE = $(PYTHON) -B .agents/scripts/vae.py
WITH_TMP = $(PYTHON) -B scripts/with-tmp.py --
export PYTHONDONTWRITEBYTECODE = 1
-include .env
export
.DEFAULT_GOAL := help
.NOTPARALLEL:

.PHONY: help setup verify verify-import test lint coverage e2e gate start stop status log metrics bench build dry-run e2e-smoke e2e-win98 serve
help:
	@echo 'setup: validate installed tooling; verify: lint, test, coverage, e2e, retained identities'
	@echo 'gate VAE_SESSION=id: verify/review/docs for a session; coverage: VAE integration scope'
	@echo 'start/stop/status/log N=80: owned preview service; metrics: registered job resources'
	@echo 'bench: inspect retained timing results; build/dry-run: pinned SDK; e2e-smoke/e2e-win98: VM acceptance'

setup:
	$(VAE) doctor
	$(PYTHON) -B .vae/checks/installation.py

verify: lint test coverage e2e verify-import
	$(PYTHON) -B .vae/checks/release.py

verify-import:
	$(PYTHON) scripts/verify-import.py

test:
	$(WITH_TMP) $(NODE) --test packaging/bun-app/test.mjs
	$(WITH_TMP) $(NODE) --test tests/vae/evidence-inputs.test.mjs
	$(WITH_TMP) $(PYTHON) -B -m unittest discover -s tests/vae -v

lint:
	$(PYTHON) -B -c 'import ast; from pathlib import Path; paths=[Path(".vae/VERIFY.py"),*Path(".vae/checks").glob("*.py"),*Path("tests/vae").glob("*.py"),*Path("packaging/npm").glob("*.py"),*Path("e2e").glob("*.py")]; [ast.parse(p.read_text(),filename=str(p)) for p in paths]; print("Python syntax checked:",len(paths))'
	$(PYTHON) -B -c 'import subprocess; from pathlib import Path; paths=[*Path("packaging/npm").glob("*.mjs"),Path("tests/candidate-isa.mjs"),Path("tests/bun-bundle.mjs"),Path("e2e/guest-systems.mjs"),Path("e2e/slitaz-ui.mjs"),Path("e2e/bun-bundle.mjs"),Path("host/browser/candidate.mjs"),Path("host/browser/runtime-loader.mjs")]; [subprocess.run(["$(NODE)","--check",str(p)],check=True) for p in paths]'
	$(PYTHON) -B .vae/checks/installation.py

coverage:
	$(WITH_TMP) $(PYTHON) -B tests/vae/coverage.py

e2e:
	$(WITH_TMP) $(PYTHON) -B tests/vae/e2e.py
	$(WITH_TMP) $(PYTHON) -B packaging/npm/check.py

gate:
	$(WITH_TMP) $(VAE) gate --repo . --session '$(VAE_SESSION)'

start:
	$(VAE) swarm spawn --repo . --name vm-preview --goal 'Local VM preview service' --workdir . --targets tmp/vm-preview --eta 60 -- $(NODE) e2e/server.mjs

stop:
	$(VAE) swarm stop --repo . --name vm-preview

status metrics:
	$(VAE) swarm status --repo .

log:
	tail -n $(N) var/log/swarm/vm-preview.log

bench:
	$(PYTHON) -B -c 'import json; from pathlib import Path; paths=sorted(Path("artifacts").glob("*-analysis-*/analysis.json")); [print(p, json.loads(p.read_text()).get("decision", {})) for p in paths]; print("Read-only retained results; new timing requires a frozen protocol.")'

build:
	$(PYTHON) scripts/sdk.py $(PYTHON) scripts/build.py --output $(BUILD_OUTPUT) --jobs $(JOBS)

dry-run:
	$(PYTHON) scripts/build.py --output $(BUILD_OUTPUT) --dry-run

e2e-smoke:
	$(NODE) e2e/smoke.mjs

e2e-win98:
	$(NODE) e2e/run-win98.mjs

serve:
	$(NODE) e2e/server.mjs
