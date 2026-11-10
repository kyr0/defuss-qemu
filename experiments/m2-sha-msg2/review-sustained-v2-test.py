#!/usr/bin/env python3
"""Independent sustained-v2 replay tests; no VM/browser or external packages."""
import copy
import contextlib
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("review", HERE/"review-sustained-v2.py")
review = importlib.util.module_from_spec(spec); spec.loader.exec_module(review)
SCRATCH = HERE.parents[1]/"tmp"


@contextlib.contextmanager
def scratch():
    SCRATCH.mkdir(parents=True, exist_ok=True)
    # Retain synthetic evidence locally for interruption recovery and inspection.
    yield tempfile.mkdtemp(prefix="review-sustained-v2-", dir=SCRATCH)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def put(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2)+"\n")
    return digest(path.read_bytes())


def identity(path):
    data = path.read_bytes()
    return dict(sha256=digest(data), bytes=len(data))


def report_fixture(manifest, nonce, sha_ratio=.85):
    enabled = manifest["experiment"]["enabled"]
    base = dict(protocol=review.PROTOCOL, bun="1.4.4", revision="38afee6c84fcf48c0edb2466aa4b27d287a59c30", arch="x64", pid=1,
                nonce=nonce, heap=True, file=True, heapLength=4096, heapChecksum=17)
    configuration = dict(parameters=review.PARAMETERS, orders=review.ORDERS, warmupOrders=review.WARMUP_ORDERS)
    prepared = dict(base, **configuration, event="snapshot-prepared", ordinal=0, hostMs=1)
    resumed = dict(base, **configuration, event="resumed", ordinal=1, mode="cold", hostMs=5)
    events, signals, clock = [prepared, resumed], [dict(byte=49, hostMs=2)], 5
    maps = "00400000-00500000 r-xp 00000000 00:01 1 /bun\n"
    warmups, results, calibration, start = [], [], [], None
    for seq, gate in enumerate(review.gates(), 1):
        duration = 100*(sha_ratio if enabled and gate.get("name") == "sha256" else 1) if gate["event"] in ("result", "warmup-result") else 2
        clock += duration
        event = dict(base, **gate, seq=seq, ordinal=1, mode="cold", hostMs=clock, signalHostMs=clock+.1, pairedHostMs=clock+.2,
            stopRequestHostMs=clock+.3, stoppedHostMs=clock+.4, readCompleteHostMs=clock+.5, ackHostMs=clock+.6, contReplyHostMs=clock+.7)
        signals.append(dict(byte=71, hostMs=event["signalHostMs"]))
        if gate["event"] in ("initialized", "maps"):
            event.update(maps=maps, mapsSha256=digest(maps.encode()), mapsBytes=len(maps.encode()))
        if gate["event"] in ("warmup-complete", "complete"):
            event["values"] = review.EXPECTED
        if gate["event"] in ("start", "warmup-start", "gate-start"):
            start = event
        if gate["event"] in ("result", "warmup-result", "gate-result"):
            event["guestMs"] = duration*.8
            if gate["event"] == "gate-result":
                calibration.append(dict(index=event["index"], hostMs=event["hostMs"]-start["ackHostMs"], guestMs=event["guestMs"]))
            else:
                event["value"] = review.EXPECTED[event["name"]]
                row = dict(name=event["name"], sample=event["sample"], iterations=100, startSeq=start["seq"], endSeq=seq,
                    startAckHostMs=start["ackHostMs"], resultHostMs=event["hostMs"], hostMs=event["hostMs"]-start["ackHostMs"],
                    guestMs=event["guestMs"], resultToStopMs=event["stoppedHostMs"]-event["hostMs"], counters=None,
                    runtimeStats=dict(jitPool=dict(charged=11400, limit=12000, linearMemoryBytes=2147483648)))
                (results if gate["event"] == "result" else warmups).append(row)
        events.append(event); clock = event["ackHostMs"]
    browser = dict(status="passed", mode="baseline", snapshotMode="capture", captureCode=False, events=events, signals=signals,
        warmups=warmups, results=results, calibration=calibration, gateAcks=148, startup=dict(preparedHostMs=1, readyHostMs=4, resumedHostMs=5),
        ready=dict(mode="cold", readyMs=3.9, snapshotSaved=True, appSha256=manifest["appSha256"], compatibilitySha256=manifest["generation"]),
        experiment=manifest["experiment"], msg2Status=0x10004 if enabled else 0x10003)
    return dict(schema=1, status="passed", protocol=review.PROTOCOL, mode="baseline", snapshotMode="capture", captureCode=False, browserResult=browser,
        experiment=manifest["experiment"], manifest=manifest, samplePeriod=257, timeoutMs=600000, pageErrors=[], serverErrors=[], transport=dict(publications=1),
        executionConfiguration=dict(aotEnabled=False, planDisabled=True), browser="test-browser",
        host=dict(platform="test", arch="test", release="test", logicalCPUs=1, totalMemoryBytes=1))


def packages_fixture(root):
    packages = {}
    for side, enabled in (("control", False), ("candidate", True)):
        artifacts = {name: dict(sha256=digest(name.encode()), bytes=len(name.encode())) for name in review.ARTIFACTS}
        manifest = dict(schema=1, os="linux", architecture="amd64", bunVersion="1.4.4", vm=review.VM,
            image="oven/bun@sha256:b14d4eb5d84af31d532380ad42fbc8243936bbe23e2b85c5f740efbd845fe6f2",
            snapshot=dict(enabled=True, protocol="com1-ready-v1", readyByte=49, readyMode="manual"),
            appSha256=artifacts["app.mjs"]["sha256"], artifacts=artifacts, benchmark=dict(protocol=review.PROTOCOL),
            experiment=dict(name="sha256msg2-v1", enabled=enabled))
        generation = digest(review.canonical(manifest)); manifest.update(generation=generation, compatibilitySha256=generation)
        for name in artifacts:
            path = root/side/generation/name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text(name)
        packages[side] = dict(path=side, manifest=manifest, manifestSha256=put(root/side/"app.json", manifest))
    return packages


def campaign_fixture(root, kind, packages, selection=None, spread=False):
    executable = root/"fake-executable"; executable.write_text("never executed")
    host_condition = dict(schema=1, executable=str(executable), **identity(executable), environment=dict(LIMA_HOME="/Users/admin/.defuss-vm-lima"),
        arguments=["list", "builder", "--json"], expected=dict(name="builder", status="Stopped", memory=12884901888))
    pairs_count = 4 if kind == "exploration" else selection["confirmationPlanning"]["requiredPairs"]
    plan = dict(schema=1, kind=kind, experiment="sha256msg2-v1", protocol=review.PROTOCOL, pairs=pairs_count, packages=packages,
        createdUtc="2026-11-07T10:00:00Z" if kind == "exploration" else "2026-11-07T11:00:00Z", parameters=review.PARAMETERS,
        orders=review.ORDERS, warmupOrders=review.WARMUP_ORDERS, planningRule=review.PLANNING_RULE, hostCondition=host_condition,
        driftRatioLimit=1.10, primary="sha256", secondary=["integer", "json", "http"], service=["emptyGateP95", "resultStopMaxMs"],
        primaryUpperRatio=.95, secondaryUpperRatio=1.10, readyUpperRatio=1.10, memoryUpperRatio=1.10, serviceUpperRatio=1.50,
        runtimeArtifactByteRatio=1, generatedCodeByteRatio=1.10, confidence=.99, bootstrapDraws=50000, bootstrapSeed=20261107, selection=selection, steps=[])
    for pair in range(1, pairs_count+1):
        for enabled in ((False, True) if pair%2 else (True, False)):
            plan["steps"].append(dict(id=f"pair-{pair:02d}-{'on' if enabled else 'off'}", pair=pair, enabled=enabled,
                package="candidate" if enabled else "control", mode="baseline", snapshot="capture", samplePeriod=257, timeoutMs=600000))
    for name in review.CRITICAL_INPUTS | {"benchmarks/harness/m2-sustained-v2/analyze.mjs"}:
        path = root/name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text("synthetic source "+name)
    plan_path = root/(kind+"-plan.json"); plan_sha = put(plan_path, plan)
    paths = [executable, plan_path, *[p for side in packages for p in (root/side).rglob("*") if p.is_file()],
             *[p for p in (root/"benchmarks").rglob("*") if p.is_file()], root/"manifests/runtime-baseline.json"]
    if selection:
        paths.append(root/selection["path"])
    frozen = dict(schema=1, plan=plan, planSha256=plan_sha, files={str(path.relative_to(root)): identity(path) for path in paths},
        environment=dict(node=str(executable), chrome=str(executable), nodeIdentity=identity(executable), chromeIdentity=identity(executable)))
    directory = root/kind; put(directory/"plan.json", plan); frozen_sha = put(directory/"frozen.json", frozen)
    reports, pairs = [], {}
    for index, step in enumerate(plan["steps"]):
        folder = directory/"attempts"/step["id"]; output = folder/"run"; path = output/"report.json"
        hour = "10" if kind == "exploration" else "11"
        request = dict(stepId=step["id"], freezeSha256=frozen_sha, utc=f"2026-11-07T{hour}:{index+1:02d}:00Z", cache=str((output/"snapshots").relative_to(root)),
            command=[str(executable), str(root/"benchmarks/harness/m2-sustained-v2/run.mjs"), "--plan", plan_path.name, "--package", step["package"],
                "--output", str(output.relative_to(root)), "--mode", "baseline", "--snapshot", "capture", "--sample-period", "257", "--timeout", "600000"])
        request_sha = put(folder/"request.json", request)
        put(folder/"exit.json", dict(code=0, signal=None, error=None, utc=f"2026-11-07T{hour}:{index+1:02d}:30Z"))
        nonce = f"00000000-0000-4000-8000-{index+(100 if kind == 'confirmation' else 0):012d}"
        sha_ratio = .9*math.exp([-.03,0,.03,0][step["pair"]-1]) if spread else .85
        report = report_fixture(packages[step["package"]]["manifest"], nonce, sha_ratio)
        status = dict(host_condition["expected"], errors=[])
        def host_observation(second):
            return dict(status=status, stdout=json.dumps(status), stderr="", startedUtc=f"2026-11-07T{hour}:{index+1:02d}:{second:02d}Z", completedUtc=f"2026-11-07T{hour}:{index+1:02d}:{second+1:02d}Z")
        report.update(package=step["package"], cache=request["cache"], hostCondition=dict(configuration=host_condition, before=host_observation(1), after=host_observation(27)),
            inputHashes={name: info["sha256"] for name, info in frozen["files"].items()},
            servedHashes={"benchmarks/harness/m2-sustained-v2/browser.mjs": frozen["files"]["benchmarks/harness/m2-sustained-v2/browser.mjs"]["sha256"]})
        serial = []
        for event in report["browserResult"]["events"]:
            serial.append(review.PREFIX+json.dumps({k: v for k, v in event.items() if not k.endswith("HostMs") and k != "hostMs"}))
            if "maps" in event:
                maps_path = output/(event["event"]+".maps"); maps_path.parent.mkdir(parents=True, exist_ok=True)
                maps_path.write_text(event.pop("maps")); event["mapsArtifact"] = dict(path=maps_path.name, **identity(maps_path))
        (output/"serial.log").write_text("\n".join(serial)+"\n")
        manifest = report["manifest"]; snapshot = root/request["cache"]/manifest["appSha256"]/(manifest["generation"]+".snapshot")
        snapshot.parent.mkdir(parents=True, exist_ok=True); snapshot.write_text("synthetic snapshot"); report["snapshot"] = identity(snapshot)
        report_sha = put(path, report)
        put(folder/"accepted.json", dict(requestSha256=request_sha, reportSha256=report_sha, recovered=False, utc=f"2026-11-07T{hour}:{index+1:02d}:31Z"))
        # Raw-protocol fixture verification is independent of published summaries.
        _, _, observed = review.Reviewer(root).run_report(path, step, request, frozen)
        pairs.setdefault(step["pair"], dict(pair=step["pair"]))[step["package"]] = observed
        reports.append(dict(stepId=step["id"], path=str(path), sha256=report_sha, nonce=nonce, browser=report["browser"], host=report["host"], observed=observed))
    units = list(pairs.values())
    analysis = dict(schema=1, status="passed", kind=kind, sourceCampaign=kind, frozenSha256=frozen_sha, packages=packages, plan=plan,
        pairs=units, reports=reports, captureNonces=[r["nonce"] for r in reports], analyzerSha256=frozen["files"]["benchmarks/harness/m2-sustained-v2/analyze.mjs"]["sha256"], **review.aggregate(plan, units))
    put(root/(kind+"-analysis.json"), analysis)
    return analysis


class Tests(unittest.TestCase):
    def test_quantiles_and_planning_without_clamping(self):
        self.assertAlmostEqual(review.chi_square_three_quantile(.1), .5843743741551835, places=14)
        plan = dict(primary="sha256", secondary=["integer", "json", "http"], service=["emptyGateP95", "resultStopMaxMs"],
            primaryUpperRatio=.95, secondaryUpperRatio=1.1, readyUpperRatio=1.1, serviceUpperRatio=1.5)
        def endpoints(ratios):
            return {name: dict(ratios=ratios) for name in ["sha256", "integer", "json", "http", "ready", "emptyGateP95", "resultStopMaxMs"]}
        self.assertEqual(review.plan_confirmation(endpoints([.9]*4), plan)["requiredPairs"], 8)
        # Independently agrees with the declared JS fixed-value test: 14 pairs.
        self.assertEqual(review.plan_confirmation(endpoints([.9*math.exp(x) for x in [-.03,0,.03,0]]), plan)["requiredPairs"], 14)
        noisy = review.plan_confirmation(endpoints([.5,.8,1.2,2]), plan)
        self.assertGreater(noisy["requiredPairs"], 32); self.assertFalse(noisy["feasible"])
        review.close_tree(review.interval([.82,.9,.88,.93,.86,.91,.84,.89], draws=1000),
            dict(geometricMean=.8780694955111052, lower=.8457388012081641, upper=.9085649773475281, oneSidedUpper=.9073517011219914))

    def test_protocol_and_whole_campaign_drift(self):
        with scratch() as temporary:
            packages = packages_fixture(Path(temporary)); raw = report_fixture(packages["control"]["manifest"], "00000000-0000-4000-8000-000000000000")
            self.assertEqual(len(review.gates()), 148); review.protocol(raw)
            changed = copy.deepcopy(raw); changed["browserResult"]["warmups"][0]["sample"] = 3
            with self.assertRaises(ValueError): review.protocol(changed)
            changed = copy.deepcopy(raw); changed["browserResult"]["signals"][50]["byte"] = 49
            with self.assertRaises(ValueError): review.protocol(changed)
            rows = [dict(sample=i, hostMs=100 if i < 4 else 50) for i in range(8)]
            self.assertFalse(review.assess_drift(rows)["withinBound"]); self.assertEqual(len(rows), 8)

    def test_full_exploration_and_fresh_variable_size_confirmation(self):
        with scratch() as temporary:
            root = Path(temporary).resolve(); packages = packages_fixture(root)
            exploration = campaign_fixture(root, "exploration", packages, spread=True)
            result = review.Reviewer(root).campaign("exploration", "exploration-analysis.json")
            self.assertTrue(result["selected"]); self.assertTrue(result["protocolAdequate"])
            self.assertEqual(result["confirmationPlanning"]["requiredPairs"], 14)
            drifting = copy.deepcopy(result["pairs"]); drifting[0]["control"]["drift"]["json"]["withinBound"] = False
            vetoed = review.aggregate(result["plan"], drifting)
            self.assertFalse(vetoed["protocolAdequate"]); self.assertFalse(vetoed["selected"])
            self.assertEqual(len(vetoed["endpoints"]["sha256"]["ratios"]), 4)
            selection = dict(path="exploration-analysis.json", sha256=identity(root/"exploration-analysis.json")["sha256"],
                captureNonces=exploration["captureNonces"], confirmationPlanning=exploration["confirmationPlanning"])
            campaign_fixture(root, "confirmation", packages, selection)
            result = review.Reviewer(root).campaign("confirmation", "confirmation-analysis.json")
            self.assertTrue(result["confirmationPassed"]); self.assertEqual(len(result["pairs"]), 14)
            modified = json.loads((root/"confirmation-analysis.json").read_text()); modified["protocolAdequate"] = False
            put(root/"confirmation-analysis.json", modified)
            with self.assertRaisesRegex(ValueError, "protocolAdequate"):
                review.Reviewer(root).campaign("confirmation", "confirmation-analysis.json")


if __name__ == "__main__": unittest.main()
