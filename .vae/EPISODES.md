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
