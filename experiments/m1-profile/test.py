#!/usr/bin/env python3
"""Lightweight host-native fixtures; does not build QEMU or run a VM."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import platform
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cc", default=os.environ.get("CC", "clang"))
    parser.add_argument("--sysroot", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    sysroot = args.sysroot
    fallback = Path("/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk")
    if not sysroot and platform.system() == "Darwin" and fallback.exists():
        # Current CLT linker cannot read the locally selected SDK27 TBD format.
        sysroot = fallback
    spec = importlib.util.spec_from_file_location("prepare", HERE / "prepare.py")
    prepare = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(prepare)
    originals = {path: prepare.sha(prepare.PROJECT / "engine/qemu" / path)
                 for path in prepare.patch_files(prepare.PROJECT / "engine/qemu")}
    with tempfile.TemporaryDirectory(prefix="defuss-m1-profile-") as temp:
        work = Path(temp)
        command = [args.cc, "-std=c11", "-Wall", "-Wextra", "-Werror", "-O2",
                   "-fsanitize=address,undefined"]
        if sysroot:
            command.extend(["-isysroot", str(sysroot)])
        command.extend([str(HERE / "test-core.c"), "-o", str(work / "test-core")])
        subprocess.run(command, check=True)
        core = subprocess.run([str(work / "test-core"), str(work / "fixture.bin")],
                              check=True, text=True, capture_output=True)
        reader = subprocess.run(["node", str(HERE / "test-reader.mjs"), str(work / "fixture.bin")],
                                check=True, text=True, capture_output=True)
    assert originals == {path: prepare.sha(prepare.PROJECT / "engine/qemu" / path)
                         for path in originals}, "Baseline files changed during fixtures"
    report = {"status": "pass", "kind": "host-native-correctness-only",
              "core": core.stdout.strip(), "reader": reader.stdout.strip(),
              "sourceAnchors": "pass", "baselineUnchanged": True,
              "sanitizers": ["address", "undefined"], "compiler": args.cc,
              "sysroot": str(sysroot) if sysroot else None,
              "qemuBuild": "not exercised by this test", "vm": "not exercised by this test"}
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
