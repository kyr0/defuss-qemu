# Episodes

<!-- Newest last. The gate appends FAIL|DONE|FINDING; past 100 entries it trims only its own oldest DONE|FAIL|learned
FINDING (git keeps them). Leads (LESSON, FINDING learn=none) stay until wrap settles them; doctor fails above 30.
Agents append `<UTC ISO> s=<session> LESSON <VAE-DIALECT>` only for a falsified HYPOTHESIS, a dead end, or a root cause.
Session start injects the 3 newest open entries: LESSON, FINDING learn=none, FAIL without a later DONE.
Wrap: EVERY lead becomes a test | .vae/VERIFY.py rule | one MEMORY line with BC, then delete; OR delete BC evidence. -->

2026-11-08T12:50:22Z s=01a1b55a FAIL prose,coverage
2026-11-08T12:56:34Z s=01a1b55a DONE fp=3b1163e22cc9 cov=91.4% paths=AGENTS.md,Makefile,docs/decisions/vae-onboarding-01.md,tests/vae/coverage.py(+2)
2026-11-08T12:56:34Z s=01a1b55a FINDING Makefile:verify learn=verifier: VAE check_wiring and required command checks remain enabled.
2026-11-08T12:56:34Z s=01a1b55a FINDING .vae/checks/installation.py:check learn=test: tests/vae/test_installation.py tests installed CLI, preservation, integrity, commit denial and session resume.
2026-11-08T12:56:34Z s=01a1b55a FINDING tests/vae/coverage.py:percentage learn=verifier: make coverage is mandatory and fails when the real trace report cannot be parsed.
2026-11-08T14:17:02Z s=01a1b55a FAIL docs.pages,prose,env.example
2026-11-08T14:22:18Z s=01a1b55a DONE fp=f83eccea4628 cov=91.4% paths=AGENTS.md,AGENT_HANDOFF.md,ARCH.md,Makefile(+23)
2026-11-08T14:22:18Z s=01a1b55a FINDING Makefile:verify learn=verifier: VAE wiring, coverage, artifact evidence and both integration commands stay enabled in .vae/VERIFY.py.
2026-11-08T14:22:18Z s=01a1b55a FINDING tests/vae/coverage.py:percentage learn=verifier: make coverage remains required and fails if the actual trace summary cannot be parsed.
2026-11-08T14:22:18Z s=01a1b55a FINDING experiments/engine-cpu-profile/collector.mjs:browserIdentity learn=test: calibrate.mjs exercises a real page and worker, and check-evidence.mjs rehashes that passing capture against current collector bytes.
2026-11-08T14:22:18Z s=01a1b55a FINDING experiments/engine-cpu-profile/import-symbols.py:missing_indexes learn=verifier: Numeric keys are retained verbatim, duplicate keys fail, missing indexes are recorded, and the evidence verifier binds the complete originating map and mapped r
2026-11-08T14:22:18Z s=01a1b55a FINDING ARCH.md; .env.example; experiments/engine-cpu-profile/README.md; experiments/engine-pressure-exposure/README.md learn=verifier: The installed documentation, prose and environment checks remain mandatory.
2026-11-10T03:08:40Z s=01a1b55a FAIL package,tests.integration.2
2026-11-10T05:42:03Z s=01a1b55a FAIL env.example,tests.no-mocks
2026-11-10T05:49:37Z s=01a1b55a FAIL tests.e2e.1
2026-11-10T05:52:18Z s=01a1b55a DONE fp=2c54c4b2dcbe cov=91.4% paths=ARCH.md,Makefile,README.md,e2e/acceptance.py(+39)
2026-11-10T05:52:18Z s=01a1b55a FINDING host/browser/win9x.mjs; packaging/bun-app/vm.mjs: onRuntimeInitialized learn=test: packaging/npm/e2e.mjs tests native staging from both origins; Bun acceptance remains hash-bound by .vae/checks/release.py.
2026-11-10T05:52:18Z s=01a1b55a FINDING host/browser/runtime-loader.mjs: workerScript; packaging/npm/index.mjs; packaging/bun-app/vm.mjs learn=test: Real Chrome same-origin and cross-origin consumers run in make e2e, with console/request/HTTP failures rejected.
2026-11-10T05:52:18Z s=01a1b55a FINDING experiments/engine-cpu-profile/evidence-inputs.mjs: verifyRetainedInputs learn=test: tests/vae/evidence-inputs.test.mjs exercises actual filesystem bindings and rejects altered current or retained inputs; manifests/history/engine-capture-environ
2026-11-10T05:52:18Z s=01a1b55a FINDING e2e/guest-systems.mjs: FreeDOS keyboard input learn=test: The retained installed-package FreeDOS command/file acceptance is required by the release verifier.
2026-11-10T05:52:18Z s=01a1b55a FINDING e2e/slitaz-ui.mjs; e2e/guest-systems.mjs: SliTaz readiness learn=test: SliTaz acceptance requires the unique disk file, selected runtime hashes and unchanged ISO; visual readiness alone never passes acceptance.
2026-11-10T05:52:18Z s=01a1b55a FINDING .vae/checks/release.py: check learn=verifier: The release checker runs in both make verify and the session gate integration commands.
2026-11-10T05:52:18Z s=01a1b55a FINDING .vae/VERIFY.py: tests.no-mocks source rules learn=test: tests/vae/test_installation.py:test_mock_policy_distinguishes_source_from_provenance runs the real installed verifier without mocks.
2026-11-10T05:52:18Z s=01a1b55a FINDING tests/vae/e2e.py: bundle paths learn=test: make e2e continues to test the extracted portable artifact, preventing accidental source-tree dependency use.
2026-11-10T05:52:18Z s=01a1b55a FINDING .env.example: browser harness keys learn=verifier: The environment inventory check remains enabled.
2026-11-10T06:01:21Z s=01a1b55a DONE fp=a12b9a50f96c cov=91.4% paths=NEW_AGENT_HANDOFF.md
