#!/usr/bin/env python3
"""Small retained checkpoint fixtures. Scratch is always defuss-vm/tmp."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest import mock
import zipfile

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("checkpoint", HERE/"checkpoint.py")
checkpoint = importlib.util.module_from_spec(spec); spec.loader.exec_module(checkpoint)


def put(root, name, data=b"fixture\n"):
    path = root/name; path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data); return path


def fixture():
    scratch = HERE.parent/"tmp"; scratch.mkdir(exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix="checkpoint-test-", dir=scratch))
    put(root, "AGENT_HANDOFF.md", b"Current checkpoint handoff\n")
    put(root, "PLAN.md", b"authored plan\n")
    put(root, "runtime/x86_64/runtime.wasm", b"original runtime bytes")
    put(root, "engine/qemu/subprojects/softfloat/build/template/Makefile", b"authored build recipe")
    put(root, "engine/qemu/target/arm/source.c", b"authored target")
    put(root, "artifacts/run/report.json", b'{"status":"passed"}\n')
    put(root, "artifacts/build-01/build-report.json", b'{"status":"running"}\n')
    put(root, "artifacts/build-01/compile.log", b"line\n"*100)
    put(root, "artifacts/run/serial.log", b"serial\n")
    for name in ["assets/large.bin", "node_modules/library/file.js", ".git/config", "tmp/ignored.txt", "checkpoints/old/ignored.json",
                 "packaging/bun-app/validation/generated.txt", "engine/qemu/build/generated.json", "__pycache__/ignored.pyc",
                 "artifacts/build-01/build/generated.json", "artifacts/overlay/source/docs/large.md", "artifacts/m2-package-off-01/app.json",
                 "artifacts/run/snapshots/meta.json", "artifacts/old/app.mjs.app/app.json"]:
        put(root, name)
    (root/"link-to-plan").symlink_to("PLAN.md")
    return root


class Tests(unittest.TestCase):
    def test_archive_inventory_hashes_handoff_exclusions_and_original_preservation(self):
        root = fixture(); original = (root/"PLAN.md").read_bytes()
        destination, manifest = checkpoint.create_checkpoint(root, evidence_limit=64, label="unit")
        self.assertEqual(destination.parent, root/"checkpoints")
        self.assertEqual(checkpoint.verify_checkpoint(destination), manifest)
        self.assertEqual((destination/"AGENT_HANDOFF.md").read_bytes(), b"Current checkpoint handoff\n")
        self.assertEqual((root/"PLAN.md").read_bytes(), original)
        source = {row["path"]: row for row in manifest["files"] if row["archive"] == "source.zip"}
        self.assertEqual(manifest["plannedSelection"]["sourceFiles"], len(source))
        self.assertIn("runtime/x86_64/runtime.wasm", source)
        self.assertIn("engine/qemu/subprojects/softfloat/build/template/Makefile", source)
        self.assertIn("engine/qemu/target/arm/source.c", source)
        self.assertFalse(any(name.startswith(("assets/", "tmp/", "artifacts/", "checkpoints/", "node_modules/", ".git/")) for name in source))
        self.assertNotIn("packaging/bun-app/validation/generated.txt", source)
        self.assertNotIn("engine/qemu/build/generated.json", source)
        self.assertTrue(stat.S_ISLNK(source["link-to-plan"]["mode"]))
        with zipfile.ZipFile(destination/"source.zip") as archive:
            self.assertEqual(archive.read("link-to-plan"), b"PLAN.md")
        evidence = {row["path"]: row for row in manifest["files"] if row["archive"] == "evidence.zip"}
        self.assertEqual(manifest["plannedSelection"]["evidenceFiles"], len(evidence))
        self.assertEqual(set(evidence), {"artifacts/run/report.json", "artifacts/run/serial.log", "artifacts/build-01/compile.log", "artifacts/build-01/build-report.json"})
        log = evidence["artifacts/build-01/compile.log"]
        self.assertTrue(log["partial"]); self.assertTrue(log["truncated"]); self.assertEqual(log["bytes"], 64)
        self.assertFalse(evidence["artifacts/run/report.json"]["partial"])
        second, _ = checkpoint.create_checkpoint(root, evidence_limit=64)
        self.assertNotEqual(destination, second); self.assertTrue(destination.exists())

    def test_changing_source_and_added_source_never_publish_and_preserve_stages(self):
        for mutation in (lambda root: put(root, "PLAN.md", b"edited during capture"), lambda root: put(root, "new-file.py", b"new source")):
            root = fixture()
            def hook(event, stage):
                if event == "captured": mutation(root)
            with self.assertRaises(checkpoint.CheckpointFailure) as caught:
                checkpoint.create_checkpoint(root, event_hook=hook)
            failure = caught.exception
            self.assertIsInstance(failure.cause, checkpoint.SnapshotChanged)
            self.assertTrue(failure.stage.is_relative_to(root/"tmp")); self.assertTrue((failure.stage/"failure.json").exists())
            self.assertFalse(failure.published)
            self.assertEqual([p for p in (root/"checkpoints").iterdir() if p.name != "old"], [])
            # A fresh stable retry publishes separately; the failed stage remains.
            destination, _ = checkpoint.create_checkpoint(root)
            self.assertTrue(destination.exists()); self.assertTrue(failure.stage.exists())

    def test_immutable_report_change_fails_but_append_only_log_prefix_is_honest(self):
        root = fixture()
        def change_report(event, stage):
            if event == "before-publication": put(root, "artifacts/run/report.json", b'{"status":"changed"}\n')
        with self.assertRaises(checkpoint.CheckpointFailure) as caught:
            checkpoint.create_checkpoint(root, event_hook=change_report)
        self.assertIsInstance(caught.exception.cause, checkpoint.SnapshotChanged)
        root = fixture()
        def append_log(event, stage):
            if event == "captured":
                with (root/"artifacts/build-01/compile.log").open("ab") as stream: stream.write(b"new live build output\n")
        destination, manifest = checkpoint.create_checkpoint(root, evidence_limit=64, event_hook=append_log)
        record = next(row for row in manifest["files"] if row["path"] == "artifacts/build-01/compile.log")
        self.assertTrue(record["partial"]); self.assertEqual(record["sourceBytesAtCaptureStart"], 500)
        self.assertGreater((root/record["path"]).stat().st_size, record["sourceBytesAtCaptureStart"])
        checkpoint.verify_checkpoint(destination)

    def test_corrupt_archive_or_manifest_is_rejected_before_publication(self):
        for filename in ("source.zip", "manifest.json"):
            root = fixture()
            def corrupt(event, stage):
                if event == "before-publication":
                    with (stage/filename).open("ab") as stream: stream.write(b"CORRUPTED")
            with self.assertRaises(checkpoint.CheckpointFailure) as caught:
                checkpoint.create_checkpoint(root, event_hook=corrupt)
            self.assertTrue(caught.exception.stage.exists()); self.assertFalse(caught.exception.published)
        root = fixture(); destination, _ = checkpoint.create_checkpoint(root)
        (destination/"AGENT_HANDOFF.md").write_bytes(b"corrupt copied handoff")
        with self.assertRaisesRegex(ValueError, "Handoff checksum"):
            checkpoint.verify_checkpoint(destination)

    def test_stage_path_symlink_refused_and_atomic_publish_uses_project_tmp(self):
        root = fixture(); other = root/"alternate"; other.mkdir()
        # Remove only the known empty test-owned staging directory contents.
        (root/"tmp/ignored.txt").unlink(); (root/"tmp").rmdir(); (root/"tmp").symlink_to(other, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "symlink"):
            checkpoint.create_checkpoint(root)
        root = fixture(); calls=[]; real = os.rename
        def rename(source, target):
            calls.append((Path(source), Path(target))); return real(source, target)
        with mock.patch.object(checkpoint.os, "rename", side_effect=rename):
            destination, _ = checkpoint.create_checkpoint(root)
        self.assertEqual(len(calls), 1); self.assertEqual(calls[0][0].parent, root/"tmp"); self.assertEqual(calls[0][1], destination)

    def test_existing_destination_and_busy_publication_never_overwrite(self):
        root = fixture(); existing = []
        def reserve_destination(event, stage):
            if event == "before-publication":
                path = root/"checkpoints"/stage.name.removeprefix("checkpoint-stage-")
                path.mkdir(); (path/"keep.txt").write_text("existing data"); existing.append(path)
        with self.assertRaises(checkpoint.CheckpointFailure) as caught:
            checkpoint.create_checkpoint(root, event_hook=reserve_destination)
        self.assertFalse(caught.exception.published)
        self.assertEqual((existing[0]/"keep.txt").read_text(), "existing data")
        root = fixture()
        with mock.patch.object(checkpoint.fcntl, "flock", side_effect=BlockingIOError("other publication active")):
            with self.assertRaises(checkpoint.CheckpointFailure) as caught:
                checkpoint.create_checkpoint(root)
        self.assertTrue((caught.exception.stage/"manifest.json").exists()); self.assertFalse(caught.exception.published)

    def test_small_historical_sources_and_wasm_survive_without_full_overlay_trees(self):
        root = fixture()
        for name in ["artifacts/m1-harness-source-v2/benchmarks/harness/m1/driver.ts", "artifacts/source-preservation/scripts/sdk.py",
                     "artifacts/overlay-v2/prepare.py", "artifacts/fixture-source-v1/fixture.S", "artifacts/host-fixture/tiny.wasm"]:
            put(root, name, b"historical code bytes")
        put(root, "artifacts/host-fixture/large.wasm", b"x"*(checkpoint.WASM_EVIDENCE_LIMIT+1))
        for name in ["artifacts/opaque-overlay/meson.build", "artifacts/opaque-overlay/tcg/emitter.c", "artifacts/opaque-overlay/target/guest.c"]:
            put(root, name)
        for name in ["artifacts/opaque-build/build.ninja", "artifacts/opaque-build/meson-private/ignored.json", "artifacts/opaque-build/generated.c"]:
            put(root, name)
        destination, manifest = checkpoint.create_checkpoint(root)
        evidence = {row["path"] for row in manifest["files"] if row["archive"] == "evidence.zip"}
        self.assertIn("artifacts/source-preservation/scripts/sdk.py", evidence)
        self.assertIn("artifacts/m1-harness-source-v2/benchmarks/harness/m1/driver.ts", evidence)
        self.assertIn("artifacts/overlay-v2/prepare.py", evidence)
        self.assertIn("artifacts/fixture-source-v1/fixture.S", evidence)
        self.assertIn("artifacts/host-fixture/tiny.wasm", evidence)
        self.assertNotIn("artifacts/host-fixture/large.wasm", evidence)
        self.assertFalse(any(name.startswith(("artifacts/opaque-overlay/", "artifacts/opaque-build/")) for name in evidence))
        checkpoint.verify_checkpoint(destination)


if __name__ == "__main__": unittest.main()
