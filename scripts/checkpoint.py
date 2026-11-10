#!/usr/bin/env python3
"""Publish verified immutable project checkpoints; all staging stays in project/tmp.

Archives copy files and never move/delete original source, runtime or evidence.
Source and immutable evidence are rehashed before publication. Logs are bounded
prefix observations explicitly marked partial, never an immutable final log.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import sys
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CHUNK = 1024 * 1024
SOURCE_ROOT_EXCLUDES = {"artifacts", "assets", "node_modules", ".git", "tmp", "checkpoints", "build", "dist", "coverage", "playwright-report", "test-results"}
CACHE_NAMES = {"__pycache__", ".cache", "cache", "caches", ".pytest_cache", ".mypy_cache", ".ruff_cache", "node_modules", ".git"}
SOURCE_PATH_EXCLUDES = {"packaging/bun-app/validation", "experiments/m1-profile/native-validation.json", "engine/qemu/build"}
EVIDENCE_DIR_EXCLUDES = CACHE_NAMES | {"build", "source", "runtime", "snapshots", "snapshot", "packages", "dist", "sdk"}
EVIDENCE_SUFFIXES = {".json", ".jsonl", ".ndjson", ".log", ".md", ".txt", ".maps",
                     ".py", ".mjs", ".js", ".ts", ".c", ".h", ".inc", ".s", ".sh", ".wasm"}
WASM_EVIDENCE_LIMIT = 256 * 1024
DEFAULT_EVIDENCE_LIMIT = 8 * CHUNK


class SnapshotChanged(RuntimeError):
    """A selected immutable input changed; the stage must not be published."""


class CheckpointFailure(RuntimeError):
    def __init__(self, stage, cause, published=False):
        self.stage, self.cause, self.published = stage, cause, published
        prefix = "Checkpoint renamed but durability synchronization failed; retained" if published else "Checkpoint failed; preserved stage"
        super().__init__(f"{prefix} {stage}: {type(cause).__name__}: {cause}")


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def durable_new(path, data):
    with Path(path).open("xb") as stream:
        stream.write(data); stream.flush(); os.fsync(stream.fileno())
    sync_directory(Path(path).parent)


def json_bytes(value):
    return (json.dumps(value, indent=2, sort_keys=True, allow_nan=False)+"\n").encode()


def signature(info):
    return dict(device=str(info.st_dev), inode=str(info.st_ino), mode=info.st_mode,
                bytes=info.st_size, mtimeNs=str(info.st_mtime_ns), ctimeNs=str(info.st_ctime_ns))


def hash_stream(stream, writer=None, limit=None):
    digest, count = hashlib.sha256(), 0
    while limit is None or count < limit:
        block = stream.read(CHUNK if limit is None else min(CHUNK, limit-count))
        if not block:
            break
        digest.update(block); count += len(block)
        if writer:
            writer.write(block)
    return dict(sha256=digest.hexdigest(), bytes=count)


def file_identity(path):
    with Path(path).open("rb") as stream:
        return hash_stream(stream)


def safe_directory(path):
    path = Path(path)
    require(not path.is_symlink(), "Directory symlink refused: " + str(path))
    if not path.exists():
        path.mkdir(); sync_directory(path.parent)
    require(path.is_dir(), "Expected directory: " + str(path))


def select_sources(root):
    """Do not prune authored QEMU target/ or subprojects/*/build/ directories."""
    result = {}
    for base, directories, files in os.walk(root, followlinks=False):
        base = Path(base)
        kept = []
        for name in sorted(directories):
            path = base/name; relative = path.relative_to(root).as_posix()
            if name in CACHE_NAMES or relative in SOURCE_PATH_EXCLUDES or base == root and name in SOURCE_ROOT_EXCLUDES:
                continue
            if path.is_symlink():
                result[relative] = signature(path.lstat())
            else:
                kept.append(name)
        directories[:] = kept
        for name in sorted(files):
            path = base/name; relative = path.relative_to(root).as_posix()
            if name in CACHE_NAMES or name == ".DS_Store" or name.endswith((".pyc", ".pyo")) or relative in SOURCE_PATH_EXCLUDES or base == root and name in SOURCE_ROOT_EXCLUDES:
                continue
            info = path.lstat()
            require(stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode), "Unsupported source object: " + relative)
            result[relative] = signature(info)
    require("AGENT_HANDOFF.md" in result, "Current AGENT_HANDOFF.md is required")
    require(stat.S_ISREG(result["AGENT_HANDOFF.md"]["mode"]), "AGENT_HANDOFF.md must be a regular file")
    return dict(sorted(result.items()))


def excluded_evidence_directory(path):
    name = path.name
    full_source = (path/"meson.build").is_file() and (path/"tcg").is_dir() and (path/"target").is_dir()
    sdk_build = (path/"build.ninja").is_file() and (path/"meson-private").is_dir()
    return (name in EVIDENCE_DIR_EXCLUDES or name.endswith(".app") or "-package-" in name or full_source or sdk_build or
            len(name) == 64 and all(c in "0123456789abcdef" for c in name))


def select_evidence(root, limit):
    result, skipped = {}, []
    artifacts = root/"artifacts"
    if not artifacts.exists():
        return result, skipped
    require(not artifacts.is_symlink(), "Artifacts root symlink refused")
    for base, directories, files in os.walk(artifacts, followlinks=False):
        base = Path(base); kept = []
        for name in sorted(directories):
            path = base/name
            if path.is_symlink() or excluded_evidence_directory(path):
                skipped.append(dict(path=path.relative_to(root).as_posix(), reason="excluded evidence directory"))
            else:
                kept.append(name)
        directories[:] = kept
        for name in sorted(files):
            path = base/name
            if path.suffix.lower() not in EVIDENCE_SUFFIXES:
                continue
            relative, info = path.relative_to(root).as_posix(), path.lstat()
            if not stat.S_ISREG(info.st_mode):
                skipped.append(dict(path=relative, reason="nonregular evidence")); continue
            log = path.suffix.lower() == ".log"
            file_limit = min(limit, WASM_EVIDENCE_LIMIT) if path.suffix.lower() == ".wasm" else limit
            if info.st_size > file_limit and not log:
                skipped.append(dict(path=relative, reason="immutable evidence exceeds size limit", bytes=info.st_size, limit=file_limit)); continue
            result[relative] = dict(signature=signature(info), log=log)
    return dict(sorted(result.items())), skipped


def add_entry(archive, root, relative, expected, log_limit=None):
    path = root/relative; before = path.lstat()
    if log_limit is None and signature(before) != expected:
        raise SnapshotChanged("Input changed before capture: " + relative)
    link = stat.S_ISLNK(before.st_mode)
    require(link or stat.S_ISREG(before.st_mode), "Nonregular input changed type: " + relative)
    info = zipfile.ZipInfo(relative, (1980, 1, 1, 0, 0, 0))
    info.create_system = 3; info.external_attr = before.st_mode << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    limit = min(before.st_size, log_limit) if log_limit is not None else before.st_size+1
    with archive.open(info, "w", force_zip64=True) as output:
        if link:
            data = os.fsencode(os.readlink(path)); output.write(data)
            captured = dict(sha256=hashlib.sha256(data).hexdigest(), bytes=len(data))
        else:
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(descriptor, "rb") as source:
                if signature(os.fstat(source.fileno())) != signature(before):
                    raise SnapshotChanged("Input replaced before open: " + relative)
                captured = hash_stream(source, output, limit)
    after = path.lstat()
    changed = signature(before) != signature(after)
    if log_limit is None and (changed or captured["bytes"] != before.st_size):
        raise SnapshotChanged("Input changed while reading: " + relative)
    return dict(path=relative, kind="symlink" if link else "file", **captured, mode=before.st_mode,
        observedBefore=signature(before), observedAfter=signature(after), partial=log_limit is not None,
        consistency="bounded-log-prefix" if log_limit is not None else "immutable-input",
        changedDuringCapture=changed, sourceBytesAtCaptureStart=before.st_size,
        truncated=log_limit is not None and captured["bytes"] < before.st_size)


def make_archive(path, root, selection, evidence_limit=None):
    records = []
    with path.open("xb") as file:
        with zipfile.ZipFile(file, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
            for relative, expected in selection.items():
                log = evidence_limit is not None and expected["log"]
                record = add_entry(archive, root, relative, expected["signature"] if evidence_limit is not None else expected,
                                   evidence_limit if log else None)
                record["archive"] = path.name; records.append(record)
        file.flush(); os.fsync(file.fileno())
    sync_directory(path.parent)
    return records


def verify_archive(path, records):
    expected = {record["path"]: record for record in records}
    require(len(expected) == len(records), "Duplicate manifest archive path")
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)) and set(names) == set(expected), "ZIP inventory differs from manifest")
        for info in archive.infolist():
            relative = PurePosixPath(info.filename)
            require(not relative.is_absolute() and ".." not in relative.parts, "Unsafe ZIP member path")
            record = expected[info.filename]
            require(info.external_attr >> 16 == record["mode"], "ZIP object permissions/type differ")
            with archive.open(info) as stream:
                require(hash_stream(stream) == {k: record[k] for k in ("sha256", "bytes")}, "ZIP content hash/size differs: " + info.filename)
            require(stat.S_ISLNK(record["mode"]) == (record["kind"] == "symlink"), "ZIP link metadata differs")
    # Every member was streamed to EOF, which also verifies zipfile's CRC checks.


def revalidate_inputs(root, source_selection, records):
    if select_sources(root) != source_selection:
        raise SnapshotChanged("Source inventory or metadata changed during checkpoint")
    for record in records:
        if record["partial"]:
            continue
        path = root/record["path"]; before = path.lstat()
        if signature(before) != record["observedBefore"]:
            raise SnapshotChanged("Immutable input metadata changed: " + record["path"])
        if record["kind"] == "symlink":
            data = os.fsencode(os.readlink(path)); current = dict(sha256=hashlib.sha256(data).hexdigest(), bytes=len(data))
        else:
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(descriptor, "rb") as stream:
                if signature(os.fstat(stream.fileno())) != signature(before):
                    raise SnapshotChanged("Immutable input replaced: " + record["path"])
                current = hash_stream(stream, limit=record["bytes"]+1)
        if current != {key: record[key] for key in ("sha256", "bytes")} or signature(path.lstat()) != signature(before):
            raise SnapshotChanged("Immutable input content changed: " + record["path"])
    if select_sources(root) != source_selection:
        raise SnapshotChanged("Source inventory changed during final revalidation")


def verify_checkpoint(directory):
    directory = Path(directory)
    raw = (directory/"manifest.json").read_bytes()
    require((directory/"manifest.sha256").read_text().strip() == hashlib.sha256(raw).hexdigest(), "Manifest checksum differs")
    manifest = json.loads(raw); require(manifest["schema"] == 1, "Unknown checkpoint schema")
    require(set(manifest["archives"]) == {"source.zip", "evidence.zip"}, "Unexpected archive inventory")
    for name, expected in manifest["archives"].items():
        require(file_identity(directory/name) == expected, "Archive checksum differs: " + name)
        verify_archive(directory/name, [record for record in manifest["files"] if record["archive"] == name])
    require(all(record["archive"] in manifest["archives"] for record in manifest["files"]), "Unknown file archive")
    handoff = manifest["handoff"]
    require(file_identity(directory/"AGENT_HANDOFF.md") == handoff, "Handoff checksum differs")
    source_handoff = [row for row in manifest["files"] if row["archive"] == "source.zip" and row["path"] == "AGENT_HANDOFF.md"]
    require(len(source_handoff) == 1 and {k: source_handoff[0][k] for k in ("sha256", "bytes")} == handoff, "Handoff/source mismatch")
    return manifest


def create_checkpoint(root=ROOT, evidence_limit=DEFAULT_EVIDENCE_LIMIT, label=None, event_hook=None):
    root = Path(root).resolve()
    require(evidence_limit > 0, "Evidence limit must be positive")
    require(label is None or label and all(c.isascii() and (c.isalnum() or c in "-_") for c in label), "Label must use letters, digits, dash or underscore")
    safe_directory(root/"tmp"); safe_directory(root/"checkpoints")
    identifier = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")+"-"+uuid.uuid4().hex[:12]+("-"+label if label else "")
    stage, destination = root/"tmp"/("checkpoint-stage-"+identifier), root/"checkpoints"/identifier
    stage.mkdir(); sync_directory(stage.parent)
    hook = event_hook or (lambda event, path: None)
    try:
        started = utc(); sources = select_sources(root); evidence, skipped = select_evidence(root, evidence_limit)
        selection = dict(sourceFiles=len(sources), sourceBytes=sum(info["bytes"] for info in sources.values()),
            evidenceFiles=len(evidence), evidencePlannedBytes=sum(min(info["signature"]["bytes"], evidence_limit) for info in evidence.values()),
            partialLogs=sum(info["log"] for info in evidence.values()), skippedEvidenceEntries=len(skipped))
        records = make_archive(stage/"source.zip", root, sources)
        records += make_archive(stage/"evidence.zip", root, evidence, evidence_limit)
        hook("captured", stage)
        revalidate_inputs(root, sources, records)
        with zipfile.ZipFile(stage/"source.zip") as archive:
            handoff = archive.read("AGENT_HANDOFF.md")
        durable_new(stage/"AGENT_HANDOFF.md", handoff)
        manifest = dict(schema=1, checkpoint=identifier, projectRoot=str(root), startedUtc=started, preparedUtc=utc(),
            plannedSelection=selection,
            scope="Verified stable selected source/runtime files and immutable evidence, plus explicitly partial bounded log prefixes. Not a filesystem-wide transactional snapshot; coordinate source-edit quiet before capture.",
            policy=dict(sourceRootExcludes=sorted(SOURCE_ROOT_EXCLUDES), sourcePathExcludes=sorted(SOURCE_PATH_EXCLUDES),
                cacheDirectoryNames=sorted(CACHE_NAMES), evidenceDirectoryExcludes=sorted(EVIDENCE_DIR_EXCLUDES),
                evidenceSuffixes=sorted(EVIDENCE_SUFFIXES), evidenceFileLimit=evidence_limit, wasmEvidenceLimit=WASM_EVIDENCE_LIMIT,
                evidenceDirectoryPatterns=["*.app", "*-package-*", "64 lowercase hex characters", "QEMU source tree with meson.build/tcg/target", "SDK build tree with build.ninja/meson-private"],
                logs="At most the initial size or limit, whichever is smaller. Always partial; may grow or change after capture.",
                symlinks="Source link targets are archived as link bytes without following them. Evidence links are excluded."),
            archives={name: file_identity(stage/name) for name in ("source.zip", "evidence.zip")},
            handoff=dict(sha256=hashlib.sha256(handoff).hexdigest(), bytes=len(handoff)), files=records, skippedEvidence=skipped)
        raw = json_bytes(manifest); durable_new(stage/"manifest.json", raw)
        durable_new(stage/"manifest.sha256", (hashlib.sha256(raw).hexdigest()+"\n").encode())
        hook("before-publication", stage)
        verify_checkpoint(stage)
        # Revalidate after manifest writes too; changes never publish as success.
        revalidate_inputs(root, sources, records)
        sync_directory(stage)
        lock = root/"checkpoints/.publish.lock"
        descriptor = os.open(lock, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "r+b") as guard:
            fcntl.flock(guard.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            require(not destination.exists() and not destination.is_symlink(), "Checkpoint destination already exists")
            require(stage.stat().st_dev == destination.parent.stat().st_dev, "Atomic publication requires one filesystem")
            os.rename(stage, destination)
            sync_directory(destination.parent); sync_directory(root/"tmp")
        return destination, manifest
    except BaseException as error:
        if stage.exists():
            try:
                durable_new(stage/"failure.json", json_bytes(dict(schema=1, failedUtc=utc(), errorType=type(error).__name__, error=str(error),
                    published=False, recovery="Preserve this stage; rerun creates a fresh stage and never overwrites it.")))
            except Exception:
                pass
        published = destination.exists() and not stage.exists()
        raise CheckpointFailure(destination if published else stage, error, published) from error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label")
    parser.add_argument("--evidence-limit-mib", type=int, default=8)
    parser.add_argument("--retries", type=int, default=0, help="Retry source changes only; every failed stage remains")
    parser.add_argument("--verify", type=Path, help="Read-only verification of an existing checkpoint")
    args = parser.parse_args()
    require(0 <= args.retries <= 3, "Retries must be between zero and three")
    if args.verify:
        manifest = verify_checkpoint(args.verify)
        print(json.dumps(dict(status="passed", checkpoint=str(args.verify), files=len(manifest["files"]))))
        return 0
    for attempt in range(args.retries+1):
        try:
            path, manifest = create_checkpoint(evidence_limit=args.evidence_limit_mib*CHUNK, label=args.label)
            print(json.dumps(dict(status="passed", checkpoint=str(path), files=len(manifest["files"]), archives=manifest["archives"])))
            return 0
        except CheckpointFailure as error:
            print(json.dumps(dict(status="failed", stage=str(error.stage), published=error.published, error=str(error))), file=sys.stderr)
            if not isinstance(error.cause, SnapshotChanged) or attempt == args.retries:
                return 1
    return 1


if __name__ == "__main__":
    sys.exit(main())
