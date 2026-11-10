#!/usr/bin/env python3
"""Independently replay frozen M2 screen/confirmation evidence (Python stdlib).

No JavaScript validators or analyzer functions are imported or executed. Exit 0
means the evidence and published analysis agree, not that improvement gates pass.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import re
import statistics
import sys

ROOT = Path(__file__).resolve().parents[2]
HEX = re.compile(r"[a-f0-9]{64}\Z")
NAMES = ["integer", "json", "sha256", "http"]
ORDERS = [NAMES, list(reversed(NAMES)), NAMES[1:] + NAMES[:1]]
PARAMETERS = dict(integerIterations=250000, jsonRecords=128, jsonRounds=8,
                  shaBytes=65536, shaRounds=16, httpRequests=8,
                  batchRepetitions=100, samples=3, warmupCycles=10, gatePairs=20)
EXPECTED = dict(integer=1526500379, json=133784,
                sha256="022efbc5f459321b5cc989106e3d38a7a9f878ddda28663e409811af0cd5e19d", http=1392)
VM = dict(machine="pc,acpi=off", cpu="max", ramMiB=512, smp=1, tbMiB=128, hotLimit=1500, runtimeFlags=3)
ARTIFACTS = {"app.mjs", "kernel", "initramfs.cpio.gz", "runtime/qemu-system-x86_64.js",
             "runtime/qemu-system-x86_64.wasm", "rom/bios-256k.bin", "rom/kvmvapic.bin", "rom/linuxboot_dma.bin"}
CRITICAL_INPUTS = {"benchmarks/harness/m1/protocol.mjs", "benchmarks/harness/m2/run.mjs",
    "benchmarks/harness/m2/browser.mjs", "benchmarks/harness/m2/vm-adapter.mjs",
    "benchmarks/workload/operations.ts", "benchmarks/expected.json", "manifests/runtime-baseline.json"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def same(actual, expected, label):
    require(actual == expected, f"{label}: values differ")


def elapsed(value, label):
    require(type(value) in (int, float) and math.isfinite(value) and value >= 0, f"{label}: invalid elapsed value")
    return value


def integer(value, low=0, high=2**53-1):
    return type(value) is int and low <= value <= high


def canonical(value):
    # Manifests contain strings, bools and integer numbers only, so this is also
    # the ECMAScript canonical encoding used by the package identity contract.
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def timestamp(value):
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def close_tree(actual, expected, label="analysis"):
    if type(expected) is float:
        require(type(actual) in (float, int) and math.isfinite(actual) and
                math.isclose(actual, expected, rel_tol=2e-12, abs_tol=1e-12), f"{label}: numeric recomputation differs")
    elif isinstance(expected, dict):
        require(isinstance(actual, dict), f"{label}: not an object")
        for key, value in expected.items():
            require(key in actual, f"{label}.{key}: missing")
            close_tree(actual[key], value, label + "." + key)
    elif isinstance(expected, list):
        require(isinstance(actual, list) and len(actual) == len(expected), f"{label}: list length differs")
        for index, (a, e) in enumerate(zip(actual, expected)):
            close_tree(a, e, f"{label}[{index}]")
    else:
        same(actual, expected, label)


def gates():
    result = [dict(event="initialized")]
    for i in range(20):
        result += [dict(event="gate-start", index=i), dict(event="gate-result", index=i)]
    result += [dict(event="warmup-start"), dict(event="warmup-complete"), dict(event="maps", phase="post-warmup")]
    for sample, order in enumerate(ORDERS):
        for name in order:
            result += [dict(event=event, name=name, sample=sample, iterations=100) for event in ("start", "result")]
    return result + [dict(event="complete")]


def identity(event):
    close_tree(event, dict(protocol="defuss-m1-v1", bun="1.4.4", revision="38afee6c84fcf48c0edb2466aa4b27d287a59c30",
                           arch="x64", heap=True, file=True, heapLength=4096), "guest identity")
    require(integer(event["pid"], 1), "Invalid guest PID")
    require(bool(re.fullmatch(r"[a-f0-9-]{36}", event["nonce"])), "Invalid guest nonce")
    require(integer(event["heapChecksum"], 0, 0xffffffff), "Invalid heap checksum")
    elapsed(event["hostMs"], "event timestamp")


def protocol(report):
    """Validate raw lifecycle, COM1 pairing, exact results and host endpoints."""
    browser = report["browserResult"]
    events, plan = browser["events"], gates()
    same(len(events), len(plan)+2, "event count")
    prepared, resumed = events[:2]
    for event, name, ordinal in ((prepared, "snapshot-prepared", 0), (resumed, "resumed", 1)):
        identity(event)
        close_tree(event, dict(event=name, ordinal=ordinal, parameters=PARAMETERS, orders=ORDERS), name)
        require("seq" not in event, name + " must have no gate sequence")
    same(resumed["mode"], "cold", "fresh capture continuation")
    for key in ("nonce", "heapChecksum"):
        same(resumed[key], prepared[key], "snapshot " + key)
    signals = browser["signals"]
    same(len(signals), len(plan)+1, "COM1 signal count")
    same(signals[0]["byte"], 49, "COM1 ready byte")
    require(prepared["hostMs"] <= signals[0]["hostMs"] <= browser["startup"]["readyHostMs"] <= resumed["hostMs"], "Readiness order differs")
    last_ack = resumed["hostMs"]
    for seq, (event, wanted, signal) in enumerate(zip(events[2:], plan, signals[1:]), 1):
        identity(event)
        close_tree(event, dict(**wanted, seq=seq, ordinal=1, mode="cold", nonce=resumed["nonce"], heapChecksum=resumed["heapChecksum"]), f"gate {seq}")
        close_tree(signal, dict(byte=71, hostMs=event["signalHostMs"]), "COM1 gate pairing")
        chronology = [event[key] for key in ("pairedHostMs", "stopRequestHostMs", "stoppedHostMs", "readCompleteHostMs", "ackHostMs", "contReplyHostMs")]
        for value in [event["signalHostMs"], *chronology]:
            elapsed(value, "gate chronology")
        require(last_ack <= event["hostMs"] <= chronology[0] and event["signalHostMs"] <= chronology[0] and
                chronology == sorted(chronology), f"Invalid gate chronology {seq}")
        last_ack = event["ackHostMs"]
        if event["event"] in ("result", "gate-result"):
            elapsed(event["guestMs"], "guest elapsed")
        if event["event"] == "result":
            same(event["value"], EXPECTED[event["name"]], "workload checksum")
        if event["event"] in ("warmup-complete", "complete"):
            same(event["values"], EXPECTED, "final checksums")
    same(browser["gateAcks"], len(plan), "ACK count")
    by_seq = {event["seq"]: event for event in events[2:]}
    rows = browser["results"]
    same([{k: r[k] for k in ("name", "sample", "iterations")} for r in rows],
         [dict(name=name, sample=sample, iterations=100) for sample, order in enumerate(ORDERS) for name in order], "batch order")
    phases = [browser["warmup"], *rows]
    for row in phases:
        start, end = by_seq[row["startSeq"]], by_seq[row["endSeq"]]
        if row["name"] == "warmup":
            same((start["event"], end["event"]), ("warmup-start", "warmup-complete"), "warmup pairing")
        else:
            same((start["event"], end["event"]), ("start", "result"), "result pairing")
            for event in (start, end):
                same((row["name"], row["sample"]), (event["name"], event["sample"]), "batch identity")
            same(row["guestMs"], end["guestMs"], "guest endpoint")
        same(row["startAckHostMs"], start["ackHostMs"], "start ACK")
        same(row["resultHostMs"], end["hostMs"], "result arrival")
        same(row["hostMs"], end["hostMs"]-start["ackHostMs"], "host endpoint")
        same(row["resultToStopMs"], end["stoppedHostMs"]-end["hostMs"], "stop tail")
        elapsed(row["hostMs"], "phase elapsed"); elapsed(row["resultToStopMs"], "phase stop")
        require(row["hostMs"] > 0, "Zero phase elapsed")
        same(row["counters"], None, "timing counters")
        require("codeCapture" not in row, "Code inspection in timing phase")
    calibration = browser["calibration"]
    same(len(calibration), 20, "calibration count")
    for i, row in enumerate(calibration):
        start, end = by_seq[2+i*2], by_seq[3+i*2]
        same(row["index"], i, "calibration order")
        same(row["hostMs"], end["hostMs"]-start["ackHostMs"], "calibration endpoint")
        same(row["guestMs"], end["guestMs"], "calibration guest endpoint")
        elapsed(row["hostMs"], "empty gate")
    for scope in (report, browser):
        same(scope.get("captureCode", False), False, "code capture disabled")
        same(scope["status"], "passed", "run status"); same(scope["mode"], "baseline", "timing mode")
        same(scope["snapshotMode"], "capture", "fresh capture")
    for event in (prepared, resumed):
        same(browser["startup"]["preparedHostMs" if event is prepared else "resumedHostMs"], event["hostMs"], "startup endpoint")
    elapsed(browser["ready"]["readyMs"], "VM readiness")
    require(browser["startup"]["readyHostMs"] > 0, "Invalid capture readiness")
    close_tree(browser["ready"], dict(mode="cold", snapshotSaved=True,
                appSha256=report["manifest"]["appSha256"], compatibilitySha256=report["manifest"]["compatibilitySha256"]), "ready identity")
    same(report["transport"]["publications"], 1, "fresh snapshot publication")
    return resumed["nonce"]


def xorshift32(state):
    state ^= (state << 13) & 0xffffffff
    state ^= state >> 17
    state ^= (state << 5) & 0xffffffff
    return state & 0xffffffff


def interval(ratios, draws=50000, seed=20261107, alpha=.01):
    require(len(ratios) >= 2 and all(math.isfinite(r) and r > 0 for r in ratios), "Invalid bootstrap ratios")
    logs = [math.log(r) for r in ratios]
    samples, state, n = [], seed & 0xffffffff, len(ratios)
    for _ in range(draws):
        total = 0.0
        for _ in range(n):
            state = xorshift32(state)
            # Exact integer equivalent of floor((uint32 / 2**32) * n).
            total += logs[(state*n) >> 32]
        samples.append(total/n)
    samples.sort()
    quantile = lambda p: math.exp(samples[min(draws-1, math.floor(p*(draws-1)))])
    total = 0.0
    for value in logs:
        total += value
    return dict(geometricMean=math.exp(total/n), lower=quantile(alpha/2), upper=quantile(1-alpha/2),
                oneSidedUpper=quantile(1-alpha), draws=draws, seed=seed, alpha=alpha)


def aggregate(plan, pairs):
    endpoints = {}
    for name in [plan["primary"], *plan["secondary"], "ready", *plan["service"]]:
        ratios = [pair["candidate"][name]/pair["control"][name] for pair in pairs]
        total = 0.0
        for ratio in ratios:
            require(ratio > 0 and math.isfinite(ratio), "Nonpositive paired ratio")
            total += math.log(ratio)
        summary = dict(ratios=ratios, geometricMean=math.exp(total/len(ratios)))
        if plan["kind"] == "confirmation":
            alpha = .005 if name in plan["service"] else .01 if name in (plan["primary"], "ready") else .01/3
            summary["interval"] = interval(ratios, plan["bootstrapDraws"], plan["bootstrapSeed"], alpha)
        endpoints[name] = summary
    memory = [p["candidate"]["peakObservedLinearMemoryBytes"]/p["control"]["peakObservedLinearMemoryBytes"] for p in pairs]
    selected = plan["kind"] == "screen" and endpoints[plan["primary"]]["geometricMean"] < plan["primaryUpperRatio"] and all(endpoints[n]["geometricMean"] < plan["secondaryUpperRatio"] for n in plan["secondary"])
    passed = plan["kind"] == "confirmation" and endpoints[plan["primary"]]["interval"]["upper"] < plan["primaryUpperRatio"] and all(endpoints[n]["interval"]["oneSidedUpper"] < plan["secondaryUpperRatio"] for n in plan["secondary"]) and endpoints["ready"]["interval"]["oneSidedUpper"] < plan["readyUpperRatio"] and max(memory) <= plan["memoryUpperRatio"] and all(endpoints[n]["interval"]["oneSidedUpper"] < plan["serviceUpperRatio"] for n in plan["service"])
    return dict(endpoints=endpoints, memoryRatios=memory, selected=selected, confirmationPassed=passed, productPromotionEligible=False)


class Reviewer:
    def __init__(self, root=ROOT):
        self.root = root.resolve()
        self.inventory = {}
        self.audit = []

    def path(self, value):
        path = self.root / value
        require(path.is_relative_to(self.root), "Path outside project: " + str(value))
        require(path.resolve().is_relative_to(self.root), "Resolved path outside project")
        for part in (path, *path.parents):
            if part == self.root:
                break
            require(not part.is_symlink(), "Symlink evidence refused: " + str(path))
        return path

    def hash(self, path, expected=None):
        path = Path(path)
        before = path.stat()
        digest, length = hashlib.sha256(), 0
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024*1024), b""):
                digest.update(chunk); length += len(chunk)
        after = path.stat()
        same((before.st_ino, before.st_size, before.st_mtime_ns), (after.st_ino, after.st_size, after.st_mtime_ns), "Evidence changed during hashing")
        record = dict(sha256=digest.hexdigest(), bytes=length)
        if expected is not None:
            close_tree(record, expected, "file " + str(path))
        key = str(path.relative_to(self.root)) if path.is_relative_to(self.root) else str(path)
        if key in self.inventory:
            same(record, self.inventory[key], "Evidence changed during review")
        self.inventory[key] = record
        return record

    def read(self, path):
        self.hash(path)
        return json.loads(Path(path).read_text())

    def manifest(self, package):
        path = self.path(package["path"])
        manifest = self.read(path/"app.json")
        self.hash(path/"app.json", dict(sha256=package["manifestSha256"]))
        same(manifest, package["manifest"], "planned manifest")
        close_tree(manifest, dict(schema=1, os="linux", architecture="amd64", bunVersion="1.4.4",
            image="oven/bun@sha256:b14d4eb5d84af31d532380ad42fbc8243936bbe23e2b85c5f740efbd845fe6f2", vm=VM,
            snapshot=dict(enabled=True, protocol="com1-ready-v1", readyByte=49, readyMode="manual")), "manifest")
        spec = {k: v for k, v in manifest.items() if k not in ("generation", "compatibilitySha256")}
        digest = hashlib.sha256(canonical(spec)).hexdigest()
        same(manifest["generation"], digest, "package generation")
        same(manifest["compatibilitySha256"], digest, "package compatibility")
        same(set(manifest["artifacts"]), ARTIFACTS, "artifact names")
        same(manifest["appSha256"], manifest["artifacts"]["app.mjs"]["sha256"], "app identity")
        for name, info in manifest["artifacts"].items():
            self.hash(path/digest/name, info)
        return manifest

    def validate_plan(self, plan):
        kind = plan["kind"]
        require(kind in ("screen", "confirmation"), "Invalid plan kind")
        close_tree(plan, dict(schema=1, experiment="sha256msg2-v1", protocol="defuss-m1-v1",
            pairs=1 if kind == "screen" else 8, primary="sha256", secondary=["integer", "json", "http"],
            service=["emptyGateP95", "resultStopMaxMs"], primaryUpperRatio=.95, secondaryUpperRatio=1.10,
            readyUpperRatio=1.10, memoryUpperRatio=1.10, serviceUpperRatio=1.50,
            runtimeArtifactByteRatio=1, generatedCodeByteRatio=1.10, confidence=.99, bootstrapDraws=50000,
            bootstrapSeed=20261107), "predeclared protocol")
        expected = []
        for pair in range(1, plan["pairs"]+1):
            for enabled in ((False, True) if pair % 2 else (True, False)):
                expected.append(dict(id=f"pair-{pair:02d}-{'on' if enabled else 'off'}", pair=pair, enabled=enabled,
                    package=plan["packages"]["candidate" if enabled else "control"]["path"], mode="baseline",
                    snapshot="capture", samplePeriod=257, timeoutMs=600000))
        same(plan["steps"], expected, "alternating paired plan")
        manifests = {side: self.manifest(plan["packages"][side]) for side in ("control", "candidate")}
        for side, enabled in (("control", False), ("candidate", True)):
            same(manifests[side]["experiment"], dict(name="sha256msg2-v1", enabled=enabled), "package mode")
        stripped = [{k: v for k, v in manifests[side].items() if k not in ("experiment", "generation", "compatibilitySha256")} for side in ("control", "candidate")]
        same(*stripped, "only package mode may differ")
        require(manifests["control"]["generation"] != manifests["candidate"]["generation"], "Snapshots share a mode identity")

    def run_report(self, path, step, request, frozen):
        report = self.read(path)
        close_tree(report, dict(schema=1, protocol="defuss-m1-v1", experiment=dict(name="sha256msg2-v1", enabled=step["enabled"]),
            samplePeriod=step["samplePeriod"], timeoutMs=step["timeoutMs"], package=step["package"], cache=request["cache"],
            pageErrors=[], serverErrors=[], executionConfiguration=dict(aotEnabled=False, planDisabled=True)), "raw report")
        require(not report.get("deadlineExceeded"), "Run deadline exceeded")
        same(report["manifest"], frozen["plan"]["packages"]["candidate" if step["enabled"] else "control"]["manifest"], "report package")
        close_tree(report["browserResult"], dict(experiment=report["experiment"], msg2Status=0x10004 if step["enabled"] else 0x10003), "locked translation choice")
        for category in ("inputHashes", "servedHashes"):
            require(report[category], "Missing report " + category)
            for name, digest in report[category].items():
                require(HEX.fullmatch(digest), "Malformed input hash")
                same(frozen["files"].get(name, {}).get("sha256"), digest, "unfrozen report input " + name)
        require(CRITICAL_INPUTS <= set(report["inputHashes"]), "Missing mandatory source identities")
        package_names = {step["package"]+"/app.json"} | {step["package"]+"/"+report["manifest"]["generation"]+"/"+name for name in ARTIFACTS}
        require(package_names <= set(report["inputHashes"]), "Missing mandatory package identities")
        nonce = protocol(report)
        serial_path = path.parent/"serial.log"
        self.hash(serial_path)
        serial = serial_path.read_text()
        require("Kernel panic" not in serial and "BUN_APP_FAILURE:" not in serial, "Guest failure in raw serial log")
        records = [json.loads(line[len("DEFUSS_M1 "):]) for line in serial.splitlines() if line.startswith("DEFUSS_M1 ")]
        same(len(records), len(report["browserResult"]["events"]), "serial/report event count")
        for raw, event in zip(records, report["browserResult"]["events"]):
            for key, value in raw.items():
                if key == "maps":
                    same(value.encode(), (path.parent/event["mapsArtifact"]["path"]).read_bytes(), "serial/maps text")
                else:
                    same(event.get(key), value, "raw serial event " + key)
        for event in report["browserResult"]["events"]:
            if event["event"] in ("initialized", "maps"):
                info = event["mapsArtifact"]
                same(Path(info["path"]).name, info["path"], "maps must be a sibling")
                require(0 < info["bytes"] <= 2097152, "Unbounded process maps")
                same((event["mapsSha256"], event["mapsBytes"]), (info["sha256"], info["bytes"]), "maps identity")
                self.hash(path.parent/info["path"], {k: info[k] for k in ("sha256", "bytes")})
                last = 0
                lines = (path.parent/info["path"]).read_text().splitlines()
                require(bool(lines), "Empty maps")
                for line in lines:
                    match = re.fullmatch(r"([0-9a-f]+)-([0-9a-f]+)\s+[r-][w-][x-][ps]\s+[0-9a-f]+\s+[0-9a-f]+:[0-9a-f]+\s+\d+\s*.*", line, re.I)
                    require(match is not None, "Malformed mapping")
                    start, end = (int(v, 16) for v in match.groups())
                    require(last <= start < end, "Unordered or overlapping mappings")
                    last = end
        manifest = report["manifest"]
        self.hash(self.path(report["cache"])/manifest["appSha256"]/(manifest["compatibilitySha256"]+".snapshot"),
                  {k: report["snapshot"][k] for k in ("sha256", "bytes")})
        browser = report["browserResult"]
        observed = dict(ready=browser["startup"]["readyHostMs"],
            emptyGateP95=sorted(r["hostMs"] for r in browser["calibration"])[18],
            resultStopMaxMs=max(r["resultToStopMs"] for r in browser["results"]))
        for name in NAMES:
            observed[name] = statistics.median(r["hostMs"] for r in browser["results"] if r["name"] == name)
        stats = [row["runtimeStats"]["jitPool"] for row in [browser["warmup"], *browser["results"]]]
        require(all(s["limit"] == 12000 and integer(s["charged"], 0, 12000) and integer(s["linearMemoryBytes"], 1) for s in stats), "Missing or breached phase resource observation")
        observed["peakObservedLinearMemoryBytes"] = max(s["linearMemoryBytes"] for s in stats)
        observed["peakObservedChargedInstances"] = max(s["charged"] for s in stats)
        return report, nonce, observed

    def campaign(self, directory, published_path, stack=()):
        directory, published_path = self.path(directory), self.path(published_path)
        require(str(directory) not in stack, "Circular selection evidence")
        frozen = self.read(directory/"frozen.json")
        frozen_sha = self.hash(directory/"frozen.json")["sha256"]
        plan = self.read(directory/"plan.json")
        self.hash(directory/"plan.json", dict(sha256=frozen["planSha256"]))
        same(plan, frozen["plan"], "frozen/copy plan contents")
        for name, info in frozen["files"].items():
            self.hash(self.path(name), info)
        for executable in ("node", "chrome"):
            self.hash(Path(frozen["environment"][executable]), frozen["environment"][executable+"Identity"])
        self.validate_plan(plan)
        selection = plan.get("selection")
        selection_nonces = set()
        if plan["kind"] == "confirmation":
            require(selection, "Confirmation lacks selection evidence")
            selection_file = self.path(selection["path"])
            self.hash(selection_file, dict(sha256=selection["sha256"]))
            selected = self.read(selection_file)
            screen = self.campaign(selected["sourceCampaign"], selection["path"], (*stack, str(directory)))
            same((screen["kind"], screen["selected"]), ("screen", True), "independent screen selection")
            same(screen["packages"], plan["packages"], "selection packages")
            same(selection["captureNonces"], screen["captureNonces"], "selection nonce inventory")
            selection_nonces = set(screen["captureNonces"])
        else:
            same(selection, None, "Screen has no preceding selection")
        attempts, accepted = [], {}
        for folder in sorted((directory/"attempts").iterdir()):
            require(folder.is_dir(), "Unexpected attempt entry")
            row = dict(path=str(folder.relative_to(self.root)), accepted=(folder/"accepted.json").exists())
            if not (folder/"request.json").exists():
                require(not row["accepted"], "Accepted attempt lacks request")
                row["incomplete"] = True; attempts.append(row); continue
            request = self.read(folder/"request.json")
            same(request["freezeSha256"], frozen_sha, "attempt frozen identity")
            row["stepId"] = request["stepId"]
            require(request["stepId"] in {s["id"] for s in plan["steps"]}, "Unknown attempted step")
            if (folder/"exit.json").exists():
                row["exit"] = self.read(folder/"exit.json")
            if row["accepted"]:
                require(request["stepId"] not in accepted, "Multiple accepted attempts for step")
                accepted[request["stepId"]] = (folder, request, self.read(folder/"accepted.json"))
            elif (folder/"run/report.json").exists():
                raw = self.read(folder/"run/report.json")
                row["rawStatus"] = raw.get("status")
                require(not (raw.get("status") == "passed" and row.get("exit", {}).get("code") == 0),
                        "Completed successful observation omitted from accepted evidence")
            attempts.append(row)
        reports, pairs, nonces = [], {}, []
        prior_exit = timestamp(plan["createdUtc"])
        for step in plan["steps"]:
            require(step["id"] in accepted, "Missing accepted step " + step["id"])
            folder, request, record = accepted[step["id"]]
            require((folder/"exit.json").exists(), "Accepted attempt lacks proven child close")
            exit_record = self.read(folder/"exit.json")
            same(exit_record["code"], 0, "child exit")
            same(exit_record.get("signal"), None, "child terminating signal")
            require(not exit_record.get("error"), "child spawn error")
            started, ended = timestamp(request["utc"]), timestamp(exit_record["utc"])
            require(prior_exit <= started <= ended <= timestamp(record["utc"]), "Attempt order/overlap differs from plan")
            prior_exit = ended
            if (folder/"spawned.json").exists():
                spawned = self.read(folder/"spawned.json")
                require(started <= timestamp(spawned["utc"]) <= ended and integer(spawned["pid"], 1), "Invalid spawned process record")
            run_path = folder/"run/report.json"
            same(request["cache"], str((folder/"run/snapshots").relative_to(self.root)), "attempt snapshot ownership")
            command = [frozen["environment"]["node"], str(self.root/"benchmarks/harness/m2/run.mjs"), "--package", step["package"],
                "--output", str((folder/"run").relative_to(self.root)), "--mode", "baseline", "--snapshot", "capture", "--sample-period", "257", "--timeout", "600000"]
            same(request["command"], command, "declared child invocation")
            self.hash(folder/"request.json", dict(sha256=record["requestSha256"]))
            self.hash(run_path, dict(sha256=record["reportSha256"]))
            report, nonce, observed = self.run_report(run_path, step, request, frozen)
            require(nonce not in nonces and nonce not in selection_nonces, "Capture nonce reused")
            nonces.append(nonce)
            group = pairs.setdefault(step["pair"], dict(pair=step["pair"]))
            side = "candidate" if step["enabled"] else "control"
            require(side not in group, "Repeated pair member"); group[side] = observed
            reports.append(dict(stepId=step["id"], path=str(run_path), sha256=record["reportSha256"], nonce=nonce,
                                browser=report["browser"], host=report["host"], observed=observed))
        for row in reports:
            same(row["browser"], reports[0]["browser"], "browser version")
            for field in ("platform", "arch", "release", "logicalCPUs", "totalMemoryBytes"):
                same(row["host"][field], reports[0]["host"][field], "host identity " + field)
        units = list(pairs.values())
        result = dict(schema=1, status="passed", kind=plan["kind"], frozenSha256=frozen_sha, packages=plan["packages"],
                      plan=plan, pairs=units, reports=reports, captureNonces=nonces, **aggregate(plan, units))
        published = self.read(published_path)
        close_tree(published, result, "published independent recomputation")
        same(self.path(published["sourceCampaign"]), directory, "published campaign source")
        same(published["analyzerSha256"], frozen["files"]["benchmarks/harness/m2/analyze.mjs"]["sha256"], "published analyzer source")
        self.audit.append(dict(campaign=str(directory.relative_to(self.root)), analysis=str(published_path.relative_to(self.root)), attempts=attempts,
                               failedOrIncompleteAttempts=sum(not row["accepted"] for row in attempts)))
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--campaign", required=True)
    parser.add_argument("--analysis", required=True)
    parser.add_argument("--output", type=Path, required=True, help="Fresh evidence directory; never overwritten")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    reviewer = Reviewer()
    result = dict(schema=1, status="running", createdUtc=dt.datetime.now(dt.timezone.utc).isoformat(),
                  reviewerSha256=reviewer.hash(Path(__file__).resolve())["sha256"])
    try:
        result["recomputed"] = reviewer.campaign(args.campaign, args.analysis)
        result.update(status="passed", scope="Independent stdlib Python replay of artifact hashes, raw protocol, selection, paired aggregation and deterministic bootstrap gates. Product promotion remains forbidden by unmeasured resource/correctness/exposure gates.")
    except Exception as error:
        result.update(status="failed", failure=f"{type(error).__name__}: {error}")
    result.update(campaignAudits=reviewer.audit, verifiedFiles=reviewer.inventory)
    with (args.output/"review.json").open("x") as stream:
        json.dump(result, stream, indent=2, allow_nan=False); stream.write("\n")
    print(json.dumps({k: result[k] for k in ("status", "failure") if k in result} | {"output": str(args.output)}))
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
