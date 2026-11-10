# Admission-pressure exposure

VERIFIED: The CPU profile of retained RNDS2 found the TCI leaf interpreter
across every workload. At stopped boundaries, the instance pool also entered
the higher admission-threshold bands. This experiment checks whether the
existing admission policy actually defers interpreted intervals.

The host and guest drivers derive from the frozen MSG1 harness. They keep
the original runtime bytes, guest application, hot limit, pool limit and
workload protocol. The guest driver adds the existing pressure-meter flag
to flags 3, producing flags 7, and reads the seven counters only while stopped.
It does not use the CPU profiler. Original driver files remain unchanged.

```sh
python3 -B scripts/with-tmp.py -- python3 -B experiments/engine-cpu-profile/execute.py pressure artifacts/engine-pressure-exposure-01 artifacts/engine-pressure-execution-01
python3 -B experiments/engine-pressure-exposure/analyze.py artifacts/engine-pressure-exposure-01
```

Use a detached VAE job for the capture and new output paths for every attempt.
The shared controller preserves execution and browser-cleanup receipts.

VERIFIED: The completed capture recorded admission deferral in every workload
and zero hard-cap fallbacks. The analyzer reports the counts separately from
the bank's instrumented elapsed counters. It does not calculate exclusive CPU
cost or an application speedup. The
[opportunity report](../../research/engines/new-opportunities-01.md) records
the result and the causal comparison still needed before a policy change.
