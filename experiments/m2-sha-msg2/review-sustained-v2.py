#!/usr/bin/env python3
"""Independently replay frozen sustained-v2 exploration/confirmation evidence (Python stdlib).

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
PROTOCOL = "defuss-m2-sustained-v2"
PREFIX = "DEFUSS_M2_SUSTAINED_V2 "
BALANCED = [["integer","json","http","sha256"],["json","sha256","integer","http"],
            ["sha256","http","json","integer"],["http","integer","sha256","json"]]
ORDERS = BALANCED * 2
WARMUP_ORDERS = BALANCED + BALANCED[:1]
PARAMETERS = dict(integerIterations=250000, jsonRecords=128, jsonRounds=8,
                  shaBytes=65536, shaRounds=16, httpRequests=8,
                  batchRepetitions=100, samples=8, warmupRounds=5, warmupCallsPerEndpoint=500, gatePairs=20)
EXPECTED = dict(integer=1526500379, json=133784,
                sha256="022efbc5f459321b5cc989106e3d38a7a9f878ddda28663e409811af0cd5e19d", http=1392)
VM = dict(machine="pc,acpi=off", cpu="max", ramMiB=512, smp=1, tbMiB=128, hotLimit=1500, runtimeFlags=3)
ARTIFACTS = {"app.mjs", "kernel", "initramfs.cpio.gz", "runtime/qemu-system-x86_64.js",
             "runtime/qemu-system-x86_64.wasm", "rom/bios-256k.bin", "rom/kvmvapic.bin", "rom/linuxboot_dma.bin"}
CRITICAL_INPUTS = {"benchmarks/harness/m2-sustained-v2/protocol.mjs", "benchmarks/harness/m2-sustained-v2/run.mjs",
    "benchmarks/harness/m2-sustained-v2/browser.mjs", "benchmarks/harness/m2-sustained-v2/vm-adapter.mjs",
    "benchmarks/workload/operations.ts", "benchmarks/expected.json", "manifests/runtime-baseline.json"}
PLANNING_RULE = dict(method="Conservative approximate Gaussian planning from four independent pilot paired log-ratios; not a power guarantee for the bootstrap decision",
    pilotPairs=4, power=.80, sdUpperConfidence=.90, sdChiSquareLowerQuantile=.5843743741551835,
    sdDegreesOfFreedom=3, primaryTargetRatio=.90, otherTargetRatio=1, minimumPairs=8, maximumPairs=32,
    roundTo="next even number",
    formula="s_design=s_pilot*sqrt(3/chi2(0.10,3)); N_endpoint=ceil(((z_bound+z_0.80)*s_design/log(limit/target))^2); N=max(8, all endpoints), rounded even. Never clamp to the maximum.")


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
    for sample, order in enumerate(WARMUP_ORDERS):
        for name in order:
            result += [dict(event=event, name=name, sample=sample, iterations=100) for event in ("warmup-start", "warmup-result")]
    result += [dict(event="warmup-complete"), dict(event="maps", phase="post-warmup")]
    for sample, order in enumerate(ORDERS):
        for name in order:
            result += [dict(event=event, name=name, sample=sample, iterations=100) for event in ("start", "result")]
    return result + [dict(event="complete")]


def identity(event):
    close_tree(event, dict(protocol="defuss-m2-sustained-v2", bun="1.4.4", revision="38afee6c84fcf48c0edb2466aa4b27d287a59c30",
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
        close_tree(event, dict(event=name, ordinal=ordinal, parameters=PARAMETERS, orders=ORDERS, warmupOrders=WARMUP_ORDERS), name)
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
        if event["event"] in ("result", "warmup-result", "gate-result"):
            elapsed(event["guestMs"], "guest elapsed")
        if event["event"] in ("result", "warmup-result"):
            same(event["value"], EXPECTED[event["name"]], "workload checksum")
        if event["event"] in ("warmup-complete", "complete"):
            same(event["values"], EXPECTED, "final checksums")
    same(browser["gateAcks"], len(plan), "ACK count")
    by_seq = {event["seq"]: event for event in events[2:]}
    rows = browser["results"]
    same([{k: r[k] for k in ("name", "sample", "iterations")} for r in rows],
         [dict(name=name, sample=sample, iterations=100) for sample, order in enumerate(ORDERS) for name in order], "batch order")
    warmups = browser["warmups"]
    same([{k: r[k] for k in ("name", "sample", "iterations")} for r in warmups],
         [dict(name=name, sample=sample, iterations=100) for sample, order in enumerate(WARMUP_ORDERS) for name in order], "warmup order")
    phases = warmups + rows
    for index, row in enumerate(phases):
        start, end = by_seq[row["startSeq"]], by_seq[row["endSeq"]]
        wanted = ("warmup-start", "warmup-result") if index < 20 else ("start", "result")
        same((start["event"], end["event"]), wanted, "phase pairing")
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


def chi_square_three_quantile(probability):
    """Invert the closed-form df=3 chi-square CDF; no copied JS quantile."""
    low, high = 0.0, 100.0
    for _ in range(100):
        middle = (low+high)/2
        cdf = math.erf(math.sqrt(middle/2))-math.sqrt(2*middle/math.pi)*math.exp(-middle/2)
        if cdf < probability:
            low = middle
        else:
            high = middle
    return (low+high)/2


def plan_confirmation(endpoints, plan):
    quantile = chi_square_three_quantile(.10)
    close_tree(quantile, PLANNING_RULE["sdChiSquareLowerQuantile"], "independent chi-square quantile")
    normal, details, required = statistics.NormalDist(), {}, 8
    for name in [plan["primary"], *plan["secondary"], "ready", *plan["service"]]:
        ratios = endpoints[name]["ratios"]
        require(len(ratios) == 4 and all(math.isfinite(r) and r > 0 for r in ratios), "Planning needs four positive pilot paired ratios")
        logs = [math.log(r) for r in ratios]
        mean = sum(logs)/4
        pilot_sd = math.sqrt(sum((value-mean)**2 for value in logs)/3)
        design_sd = pilot_sd*math.sqrt(3/quantile)
        limit = plan["primaryUpperRatio"] if name == plan["primary"] else plan["readyUpperRatio"] if name == "ready" else plan["serviceUpperRatio"] if name in plan["service"] else plan["secondaryUpperRatio"]
        target = .90 if name == plan["primary"] else 1
        probability = .995 if name == plan["primary"] or name in plan["service"] else .99 if name == "ready" else 1-.01/3
        z_bound = normal.inv_cdf(probability)
        n = math.ceil(((z_bound+normal.inv_cdf(.80))*design_sd/math.log(limit/target))**2)
        details[name] = dict(pilotSD=pilot_sd, designSD=design_sd, target=target, limit=limit, zBound=z_bound, rawRequiredPairs=n)
        required = max(required, n)
    required += required % 2
    return dict(rule=PLANNING_RULE, endpoints=details, requiredPairs=required, feasible=required <= 32,
        action="Freeze exactly the required number of wholly fresh confirmation pairs." if required <= 32 else
        "No confirmation under this plan. Retain the pilot and declare a new expanded pilot/design or an explicit larger budget before collecting more data.")


def assess_drift(rows, limit=1.10):
    same([row["sample"] for row in rows], list(range(8)), "drift sample order")
    early = statistics.median(row["hostMs"] for row in rows[:4])
    late = statistics.median(row["hostMs"] for row in rows[4:])
    require(early > 0 and late > 0, "Nonpositive drift endpoint")
    ratio = late/early
    return dict(earlyMedianMs=early, lateMedianMs=late, lateEarlyRatio=ratio, ratioLimit=limit,
        withinBound=1/limit <= ratio <= limit,
        scope="Predeclared whole-campaign suitability veto only. Passing does not establish stationarity or JIT convergence. All eight measured batches remain in the endpoint median.")


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
    adequate = all(drift["withinBound"] for pair in pairs for side in ("control", "candidate") for drift in pair[side]["drift"].values())
    planning = plan_confirmation(endpoints, plan) if plan["kind"] == "exploration" else plan["selection"]["confirmationPlanning"]
    selected = adequate and plan["kind"] == "exploration" and endpoints[plan["primary"]]["geometricMean"] < plan["primaryUpperRatio"] and all(endpoints[n]["geometricMean"] < plan["secondaryUpperRatio"] for n in plan["secondary"])
    passed = adequate and plan["kind"] == "confirmation" and endpoints[plan["primary"]]["interval"]["upper"] < plan["primaryUpperRatio"] and all(endpoints[n]["interval"]["oneSidedUpper"] < plan["secondaryUpperRatio"] for n in plan["secondary"]) and endpoints["ready"]["interval"]["oneSidedUpper"] < plan["readyUpperRatio"] and max(memory) <= plan["memoryUpperRatio"] and all(endpoints[n]["interval"]["oneSidedUpper"] < plan["serviceUpperRatio"] for n in plan["service"])
    return dict(protocol=PROTOCOL, protocolAdequate=adequate, confirmationPlanning=planning, endpoints=endpoints,
                memoryRatios=memory, selected=selected, confirmationPassed=passed, productPromotionEligible=False)


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
        same(manifest.get("benchmark"), dict(protocol=PROTOCOL), "sustained package protocol")
        require("observation" not in manifest, "Diagnostic package cannot enter timing")
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
        require(kind in ("exploration", "confirmation"), "Invalid plan kind")
        close_tree(plan, dict(schema=1, experiment="sha256msg2-v1", protocol="defuss-m2-sustained-v2",
            pairs=4 if kind == "exploration" else plan["selection"]["confirmationPlanning"]["requiredPairs"], primary="sha256", secondary=["integer", "json", "http"],
            service=["emptyGateP95", "resultStopMaxMs"], primaryUpperRatio=.95, secondaryUpperRatio=1.10,
            readyUpperRatio=1.10, memoryUpperRatio=1.10, serviceUpperRatio=1.50,
            runtimeArtifactByteRatio=1, generatedCodeByteRatio=1.10, confidence=.99, bootstrapDraws=50000,
            bootstrapSeed=20261107), "predeclared protocol")
        same(plan["parameters"], PARAMETERS, "fixed workload parameters")
        same(plan["orders"], ORDERS, "fixed measured orders")
        same(plan["warmupOrders"], WARMUP_ORDERS, "fixed warmup orders")
        close_tree(plan["planningRule"], PLANNING_RULE, "sample-size rule")
        same(plan["driftRatioLimit"], 1.10, "fixed drift suitability limit")
        require(integer(plan["pairs"], 4, 32) and plan["pairs"] % 2 == 0, "Invalid pair count")
        if kind == "confirmation":
            require(plan["pairs"] >= 8 and plan["selection"]["confirmationPlanning"]["feasible"], "Infeasible confirmation")
        condition = plan["hostCondition"]
        close_tree(condition, dict(schema=1, arguments=["list", "builder", "--json"],
            environment=dict(LIMA_HOME="/Users/admin/.defuss-vm-lima"), expected=dict(name="builder", status="Stopped", memory=12884901888)), "compiler VM condition")
        self.hash(Path(condition["executable"]), {k: condition[k] for k in ("sha256", "bytes")})
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
        close_tree(report, dict(schema=1, protocol="defuss-m2-sustained-v2", experiment=dict(name="sha256msg2-v1", enabled=step["enabled"]),
            samplePeriod=step["samplePeriod"], timeoutMs=step["timeoutMs"], package=step["package"], cache=request["cache"],
            pageErrors=[], serverErrors=[], executionConfiguration=dict(aotEnabled=False, planDisabled=True)), "raw report")
        require(not report.get("deadlineExceeded"), "Run deadline exceeded")
        require("observation" not in report, "Diagnostic observation cannot enter timing")
        condition = report["hostCondition"]
        same(condition["configuration"], frozen["plan"]["hostCondition"], "recorded compiler VM configuration")
        checks = []
        for stage in ("before", "after"):
            observation = condition[stage]
            same(json.loads(observation["stdout"]), observation["status"], "raw compiler VM status")
            close_tree(observation["status"], condition["configuration"]["expected"], "compiler VM stopped")
            same(observation["status"].get("errors", []), [], "compiler VM errors")
            started, completed = timestamp(observation["startedUtc"]), timestamp(observation["completedUtc"])
            require(started <= completed, "Host-condition clock order")
            checks.append((started, completed))
        require(checks[0][1] <= checks[1][0], "Host-condition observation order")
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
        records = [json.loads(line[len(PREFIX):]) for line in serial.splitlines() if line.startswith(PREFIX)]
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
        observed["drift"] = {name: assess_drift([row for row in browser["results"] if row["name"] == name], frozen["plan"]["driftRatioLimit"])
                             for name in [frozen["plan"]["primary"], *frozen["plan"]["secondary"]]}
        for key, rows in (("warmups", browser["warmups"]), ("measured", browser["results"])):
            observed[key] = [dict(name=row["name"], sample=row["sample"], hostMs=row["hostMs"], guestMs=row["guestMs"], pool=row["runtimeStats"]["jitPool"]) for row in rows]
        stats = [row["runtimeStats"]["jitPool"] for row in [*browser["warmups"], *browser["results"]]]
        require(all(s["limit"] == 12000 and integer(s["charged"], 0, 12000) and integer(s["linearMemoryBytes"], 1) for s in stats), "Missing or breached phase resource observation")
        observed["peakObservedLinearMemoryBytes"] = max(s["linearMemoryBytes"] for s in stats)
        observed["peakObservedChargedInstances"] = max(s["charged"] for s in stats)
        return report, nonce, observed

    def campaign(self, directory, published_path, stack=()):
        directory, published_path = self.path(directory), self.path(published_path)
        require(str(directory) not in stack, "Circular selection evidence")
        require(not (directory/"invalid-completed-observation.json").exists(), "Campaign permanently halted on an invalid completed observation")
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
            same((screen["kind"], screen["selected"]), ("exploration", True), "independent screen selection")
            same(screen["packages"], plan["packages"], "selection packages")
            same(selection["captureNonces"], screen["captureNonces"], "selection nonce inventory")
            close_tree(selection["confirmationPlanning"], screen["confirmationPlanning"], "independent pilot size planning")
            require(screen["protocolAdequate"] and screen["confirmationPlanning"]["feasible"], "Pilot unsuitable or confirmation infeasible")
            same(plan["pairs"], screen["confirmationPlanning"]["requiredPairs"], "frozen confirmation sample size")
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
                require(not raw.get("nonRetryableCompletedObservation") and raw.get("browserResult", {}).get("status") != "passed",
                        "Completed guest observation omitted after later evidence/host validation failure")
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
            plan_argument = request["command"][3]
            self.hash(self.path(plan_argument), dict(sha256=frozen["planSha256"]))
            same(frozen["files"][plan_argument]["sha256"], frozen["planSha256"], "child frozen plan")
            command = [frozen["environment"]["node"], str(self.root/"benchmarks/harness/m2-sustained-v2/run.mjs"), "--plan", plan_argument, "--package", step["package"],
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
        same(published["analyzerSha256"], frozen["files"]["benchmarks/harness/m2-sustained-v2/analyze.mjs"]["sha256"], "published analyzer source")
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
