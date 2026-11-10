#!/usr/bin/env python3
"""Small deterministic review fixtures; no VM, browser, SDK or external library."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("review", HERE/"review-confirmation.py")
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def put(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2)+"\n")
    return digest(path.read_bytes())


def identity(path):
    data = path.read_bytes()
    return dict(sha256=digest(data), bytes=len(data))


def fixture_report(enabled, manifest):
    base = dict(protocol="defuss-m1-v1", bun="1.4.4", revision="38afee6c84fcf48c0edb2466aa4b27d287a59c30",
                arch="x64", pid=2, nonce=f"00000000-0000-4000-8000-{int(enabled):012d}", heap=True, file=True, heapLength=4096, heapChecksum=7)
    prepared = dict(base, event="snapshot-prepared", ordinal=0, hostMs=1, parameters=review.PARAMETERS, orders=review.ORDERS)
    resumed = dict(base, event="resumed", ordinal=1, hostMs=6, mode="cold", parameters=review.PARAMETERS, orders=review.ORDERS)
    events, signals, clock = [prepared, resumed], [dict(byte=49, hostMs=2)], 6
    maps = "00001000-00002000 r-xp 00000000 00:01 1 /bun\n"
    for seq, gate in enumerate(review.gates(), 1):
        duration = 1
        if gate["event"] == "result":
            duration = 100 * (.85 if enabled and gate["name"] == "sha256" else 1)
        elif gate["event"] == "gate-result":
            duration = 2
        clock += duration
        event = dict(base, **gate, seq=seq, ordinal=1, mode="cold", hostMs=clock,
            signalHostMs=clock+.1, pairedHostMs=clock+.2, stopRequestHostMs=clock+.3,
            stoppedHostMs=clock+.4, readCompleteHostMs=clock+.5, ackHostMs=clock+.6, contReplyHostMs=clock+.7)
        signals.append(dict(byte=71, hostMs=event["signalHostMs"]))
        if gate["event"] in ("result", "gate-result"):
            event["guestMs"] = duration*.8
        if gate["event"] == "result":
            event["value"] = review.EXPECTED[gate["name"]]
        if gate["event"] in ("warmup-complete", "complete"):
            event["values"] = review.EXPECTED
        if gate["event"] in ("initialized", "maps"):
            event.update(maps=maps, mapsSha256=digest(maps.encode()), mapsBytes=len(maps.encode()))
        events.append(event); clock = event["ackHostMs"]
    rows, calibration = [], []
    start = None
    for event in events[2:]:
        if event["event"] in ("start", "warmup-start", "gate-start"):
            start = event
        elif event["event"] == "gate-result":
            calibration.append(dict(index=event["index"], hostMs=event["hostMs"]-start["ackHostMs"], guestMs=event["guestMs"]))
        elif event["event"] in ("result", "warmup-complete"):
            rows.append(dict(name=event.get("name", "warmup"), sample=event.get("sample"), iterations=event.get("iterations"),
                startSeq=start["seq"], endSeq=event["seq"], startAckHostMs=start["ackHostMs"], resultHostMs=event["hostMs"],
                hostMs=event["hostMs"]-start["ackHostMs"], resultToStopMs=event["stoppedHostMs"]-event["hostMs"],
                guestMs=event.get("guestMs"), counters=None, runtimeStats=dict(jitPool=dict(limit=12000, charged=100, linearMemoryBytes=1048576))))
    browser = dict(status="passed", mode="baseline", snapshotMode="capture", events=events, signals=signals, gateAcks=len(review.gates()),
        startup=dict(preparedHostMs=1, resumedHostMs=6, readyHostMs=5), warmup=rows[0], results=rows[1:], calibration=calibration,
        ready=dict(readyMs=4.9, mode="cold", snapshotSaved=True, appSha256=manifest["appSha256"], compatibilitySha256=manifest["compatibilitySha256"]),
        experiment=manifest["experiment"], msg2Status=0x10004 if enabled else 0x10003)
    return dict(schema=1, status="passed", protocol="defuss-m1-v1", mode="baseline", snapshotMode="capture", browserResult=browser,
        experiment=manifest["experiment"], manifest=manifest, samplePeriod=257, timeoutMs=600000, pageErrors=[], serverErrors=[],
        executionConfiguration=dict(aotEnabled=False, planDisabled=True), transport=dict(publications=1), browser="test-browser",
        host=dict(platform="test", arch="test", release="test", logicalCPUs=1, totalMemoryBytes=100))


def screen_fixture(root):
    packages = {}
    for side, enabled in (("control", False), ("candidate", True)):
        artifacts = {name: dict(sha256=digest(name.encode()), bytes=len(name.encode())) for name in review.ARTIFACTS}
        manifest = dict(schema=1, os="linux", architecture="amd64", bunVersion="1.4.4", vm=review.VM,
            image="oven/bun@sha256:b14d4eb5d84af31d532380ad42fbc8243936bbe23e2b85c5f740efbd845fe6f2",
            snapshot=dict(enabled=True, protocol="com1-ready-v1", readyByte=49, readyMode="manual"),
            appSha256=artifacts["app.mjs"]["sha256"], artifacts=artifacts, experiment=dict(name="sha256msg2-v1", enabled=enabled))
        generation = digest(review.canonical(manifest)); manifest.update(generation=generation, compatibilitySha256=generation)
        for name in artifacts:
            path = root/side/generation/name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text(name)
        packages[side] = dict(path=side, manifest=manifest, manifestSha256=put(root/side/"app.json", manifest))
    steps = [dict(id=f"pair-01-{'on' if enabled else 'off'}", pair=1, enabled=enabled, package="candidate" if enabled else "control",
        mode="baseline", snapshot="capture", samplePeriod=257, timeoutMs=600000) for enabled in (False, True)]
    plan = dict(schema=1, id="test", experiment="sha256msg2-v1", kind="screen", createdUtc="2026-11-07T10:00:00Z", packages=packages,
        protocol="defuss-m1-v1", pairs=1, steps=steps, inputs=[], selection=None, primary="sha256", secondary=["integer", "json", "http"],
        service=["emptyGateP95", "resultStopMaxMs"], primaryUpperRatio=.95, secondaryUpperRatio=1.10, readyUpperRatio=1.10,
        memoryUpperRatio=1.10, serviceUpperRatio=1.50, runtimeArtifactByteRatio=1, generatedCodeByteRatio=1.10, confidence=.99,
        bootstrapDraws=50000, bootstrapSeed=20261107)
    for name in review.CRITICAL_INPUTS | {"benchmarks/harness/m2/analyze.mjs"}:
        path = root/name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text("synthetic source "+name)
    executable = root/"fake-executable"; executable.write_text("not executed")
    files = {str(path.relative_to(root)): identity(path) for path in root.rglob("*") if path.is_file()}
    campaign = root/"campaign"
    plan_sha = put(campaign/"plan.json", plan)
    frozen = dict(schema=1, plan=plan, planSha256=plan_sha, files=files,
        environment=dict(node=str(executable), chrome=str(executable), nodeIdentity=identity(executable), chromeIdentity=identity(executable)))
    frozen_sha = put(campaign/"frozen.json", frozen)
    reports, pairs = [], [dict(pair=1)]
    for index, step in enumerate(steps):
        folder = campaign/"attempts"/step["id"]
        path = folder/"run/report.json"
        request = dict(stepId=step["id"], freezeSha256=frozen_sha, utc=f"2026-11-07T10:0{index+1}:00Z",
            cache=str((folder/"run/snapshots").relative_to(root)), command=[str(executable), str(root/"benchmarks/harness/m2/run.mjs"),
                "--package", step["package"], "--output", str((folder/"run").relative_to(root)), "--mode", "baseline", "--snapshot", "capture", "--sample-period", "257", "--timeout", "600000"])
        request_sha = put(folder/"request.json", request)
        put(folder/"exit.json", dict(code=0, signal=None, error=None, utc=f"2026-11-07T10:0{index+1}:30Z"))
        manifest = packages[step["package"]]["manifest"]
        report = fixture_report(step["enabled"], manifest)
        report.update(package=step["package"], cache=request["cache"], inputHashes={name: info["sha256"] for name, info in files.items()},
            servedHashes={"benchmarks/harness/m2/browser.mjs": files["benchmarks/harness/m2/browser.mjs"]["sha256"]})
        serial = []
        for event in report["browserResult"]["events"]:
            serial.append("DEFUSS_M1 "+json.dumps({k: v for k, v in event.items() if not k.endswith("HostMs") and k != "hostMs"}))
            if "maps" in event:
                maps_path = path.parent/(event["event"]+".maps"); maps_path.parent.mkdir(parents=True, exist_ok=True)
                maps_path.write_text(event.pop("maps")); event["mapsArtifact"] = dict(path=maps_path.name, **identity(maps_path))
        (path.parent/"serial.log").write_text("\n".join(serial)+"\n")
        snapshot = root/request["cache"]/manifest["appSha256"]/(manifest["generation"]+".snapshot")
        snapshot.parent.mkdir(parents=True, exist_ok=True); snapshot.write_text("synthetic snapshot")
        report["snapshot"] = identity(snapshot)
        report_sha = put(path, report)
        put(folder/"accepted.json", dict(reportSha256=report_sha, requestSha256=request_sha, recovered=False, utc=f"2026-11-07T10:0{index+1}:31Z"))
        observed = dict(ready=5, emptyGateP95=2, resultStopMaxMs=max(row["resultToStopMs"] for row in report["browserResult"]["results"]),
            integer=100, json=100, sha256=85 if step["enabled"] else 100, http=100, peakObservedLinearMemoryBytes=1048576, peakObservedChargedInstances=100)
        pairs[0][step["package"]] = observed
        reports.append(dict(stepId=step["id"], path=str(path), sha256=report_sha, nonce=report["browserResult"]["events"][0]["nonce"], browser=report["browser"], host=report["host"], observed=observed))
    analysis = dict(schema=1, status="passed", kind="screen", sourceCampaign="campaign", frozenSha256=frozen_sha, packages=packages,
        plan=plan, pairs=pairs, reports=reports, captureNonces=[row["nonce"] for row in reports],
        analyzerSha256=files["benchmarks/harness/m2/analyze.mjs"]["sha256"], **review.aggregate(plan, pairs))
    put(root/"analysis.json", analysis)
    return analysis


def confirmation_fixture(root, screen):
    """Create 16 new tiny captures and an independently retained screen."""
    selection_sha = put(root/"screen-analysis.json", screen)
    plan = copy.deepcopy(screen["plan"])
    plan.update(kind="confirmation", pairs=8, createdUtc="2026-11-07T11:00:00Z",
        selection=dict(path="screen-analysis.json", sha256=selection_sha, captureNonces=screen["captureNonces"]), inputs=["screen-analysis.json"])
    plan["steps"] = []
    for pair in range(1, 9):
        for enabled in ((False, True) if pair%2 else (True, False)):
            plan["steps"].append(dict(id=f"pair-{pair:02d}-{'on' if enabled else 'off'}", pair=pair, enabled=enabled,
                package="candidate" if enabled else "control", mode="baseline", snapshot="capture", samplePeriod=257, timeoutMs=600000))
    campaign = root/"confirmation"
    frozen = json.loads((root/"campaign/frozen.json").read_text())
    frozen.update(plan=plan, planSha256=put(campaign/"plan.json", plan))
    frozen["files"]["screen-analysis.json"] = identity(root/"screen-analysis.json")
    frozen_sha = put(campaign/"frozen.json", frozen)
    reports, pairs = [], {}
    for index, step in enumerate(plan["steps"]):
        source = root/"campaign/attempts"/f"pair-01-{'on' if step['enabled'] else 'off'}"
        folder = campaign/"attempts"/step["id"]
        shutil.copytree(source/"run", folder/"run")
        request = json.loads((source/"request.json").read_text())
        request.update(stepId=step["id"], freezeSha256=frozen_sha, utc=f"2026-11-07T11:{index+1:02d}:00Z",
            cache=str((folder/"run/snapshots").relative_to(root)))
        request["command"][5] = str((folder/"run").relative_to(root))
        request_sha = put(folder/"request.json", request)
        put(folder/"exit.json", dict(code=0, signal=None, error=None, utc=f"2026-11-07T11:{index+1:02d}:30Z"))
        path = folder/"run/report.json"
        report = json.loads(path.read_text()); report["cache"] = request["cache"]
        nonce = f"00000000-0000-4000-8000-{index+100:012d}"
        old_nonce = report["browserResult"]["events"][0]["nonce"]
        for event in report["browserResult"]["events"]:
            event["nonce"] = nonce
        serial = folder/"run/serial.log"; serial.write_text(serial.read_text().replace(old_nonce, nonce))
        report_sha = put(path, report)
        put(folder/"accepted.json", dict(requestSha256=request_sha, reportSha256=report_sha, recovered=False, utc=f"2026-11-07T11:{index+1:02d}:31Z"))
        source_report = screen["reports"][int(step["enabled"])]
        pairs.setdefault(step["pair"], dict(pair=step["pair"]))[step["package"]] = source_report["observed"]
        reports.append(dict(source_report, stepId=step["id"], path=str(path), sha256=report_sha, nonce=nonce))
    units = list(pairs.values())
    analysis = dict(schema=1, status="passed", kind="confirmation", sourceCampaign="confirmation", frozenSha256=frozen_sha, packages=plan["packages"],
        plan=plan, pairs=units, reports=reports, captureNonces=[row["nonce"] for row in reports], analyzerSha256=screen["analyzerSha256"], **review.aggregate(plan, units))
    put(root/"confirmation-analysis.json", analysis)
    return analysis


class ReviewTests(unittest.TestCase):
    def test_rng_and_bootstrap(self):
        state, sequence = 1, []
        for _ in range(5):
            state = review.xorshift32(state); sequence.append(state)
        self.assertEqual(sequence, [270369, 67634689, 2647435461, 307599695, 2398689233])
        constant = review.interval([.5]*8, draws=1000)
        self.assertEqual((constant["lower"], constant["upper"], constant["oneSidedUpper"]), (.5, .5, .5))
        two_point = review.interval([.25, 4], draws=1000)
        self.assertEqual((two_point["lower"], two_point["upper"], two_point["geometricMean"]), (.25, 4, 1))
        # Fixed JS analyzer output, independently reproduced by integer-index Python RNG.
        golden = dict(geometricMean=.8780694955111052, lower=.8457388012081641,
                      upper=.9085649773475281, oneSidedUpper=.9073517011219914)
        review.close_tree(review.interval([.82,.9,.88,.93,.86,.91,.84,.89], draws=1000), golden)

    def test_protocol_rejects_checksum_signal_nonce_and_endpoint_changes(self):
        manifest = dict(appSha256="a"*64, compatibilitySha256="b"*64, experiment=dict(name="sha256msg2-v1", enabled=False))
        report = fixture_report(False, manifest)
        review.protocol(report)
        for mutate in (
            lambda r: r["browserResult"]["events"][47].update(value=0),
            lambda r: r["browserResult"]["signals"][5].update(byte=49),
            lambda r: r["browserResult"]["events"][5].update(nonce="f"*36),
            lambda r: r["browserResult"]["results"][0].update(hostMs=90),
            lambda r: r["browserResult"]["warmup"].update(codeCapture={}),
        ):
            changed = copy.deepcopy(report); mutate(changed)
            with self.assertRaises(ValueError):
                review.protocol(changed)

    def test_complete_screen_and_independent_tamper_rejection(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve(); expected = screen_fixture(root)
            result = review.Reviewer(root).campaign("campaign", "analysis.json")
            self.assertTrue(result["selected"]); self.assertFalse(result["confirmationPassed"])
            self.assertFalse(result["productPromotionEligible"])
            self.assertEqual(result["endpoints"]["sha256"]["ratios"], [.85])
            analysis = copy.deepcopy(expected); analysis["endpoints"]["sha256"]["geometricMean"] = .75
            put(root/"analysis.json", analysis)
            with self.assertRaisesRegex(ValueError, "numeric recomputation"):
                review.Reviewer(root).campaign("campaign", "analysis.json")
            put(root/"analysis.json", expected)
            snapshot = next(root.glob("campaign/attempts/*/run/snapshots/*/*.snapshot"))
            snapshot.write_text("tampered")
            with self.assertRaisesRegex(ValueError, "file"):
                review.Reviewer(root).campaign("campaign", "analysis.json")

    def test_confirmation_fails_each_independent_gate(self):
        plan = dict(kind="confirmation", primary="sha256", secondary=["integer", "json", "http"], service=["emptyGateP95", "resultStopMaxMs"],
            bootstrapDraws=100, bootstrapSeed=20261107, primaryUpperRatio=.95, secondaryUpperRatio=1.1,
            readyUpperRatio=1.1, memoryUpperRatio=1.1, serviceUpperRatio=1.5)
        control = {name: 100 for name in ["sha256", "integer", "json", "http", "ready", "emptyGateP95", "resultStopMaxMs", "peakObservedLinearMemoryBytes"]}
        candidate = dict(control, sha256=85)
        pairs = [dict(pair=i+1, control=control, candidate=candidate) for i in range(8)]
        self.assertTrue(review.aggregate(plan, pairs)["confirmationPassed"])
        for name, value in (("sha256", 96), ("integer", 111), ("json", 111), ("http", 111),
                            ("ready", 111), ("peakObservedLinearMemoryBytes", 111), ("emptyGateP95", 151), ("resultStopMaxMs", 151)):
            changed = copy.deepcopy(pairs)
            for pair in changed:
                pair["candidate"][name] = value
            self.assertFalse(review.aggregate(plan, changed)["confirmationPassed"], name)

    def test_recursive_selection_and_all_fresh_confirmation_pairs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve(); screen = screen_fixture(root)
            confirmation_fixture(root, screen)
            reviewer = review.Reviewer(root)
            result = reviewer.campaign("confirmation", "confirmation-analysis.json")
            self.assertTrue(result["confirmationPassed"])
            self.assertEqual(len(result["pairs"]), 8)
            self.assertEqual(len(set(result["captureNonces"])), 16)
            self.assertEqual(len(reviewer.audit), 2)


if __name__ == "__main__":
    unittest.main()
