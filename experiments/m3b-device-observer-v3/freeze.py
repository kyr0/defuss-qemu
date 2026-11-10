#!/usr/bin/env python3
"""Freeze the unexecuted vAPIC-disabled observer revision in a later safe gap."""
import argparse,hashlib,importlib.util,json,re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
HERE='experiments/m3b-device-observer-v3/'
OLD='experiments/m3b-device-observer-v2/'
TOOL='artifacts/m3b-device-observer-source-01/source/experiments/m3b-device-observer/freeze.py'
TOOL_SHA='7e6bc2b22ca92fcf6a3fffc62d4556be37d687adb19a79304858f02de7cd8204'
PREVIOUS='artifacts/m3b-device-observer-v2-source-01/manifest.json'
PREVIOUS_SHA='5fa06fb24507dc56b8052c2a8cbdef31d1b845219f05ca6af086470242441834'
OBSERVED='artifacts/m3b-device-observation-02/report.json'
OBSERVED_SHA='010063763eea0b6ec0fee5a414d4cb733f0f1872f90a998ff5d2257ccd14bc4b'

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',required=True)
    parser.add_argument('--test-evidence',action='append',required=True)
    args=parser.parse_args()
    assert (ROOT/TOOL).resolve()==ROOT/TOOL and hashlib.sha256((ROOT/TOOL).read_bytes()).hexdigest()==TOOL_SHA
    spec=importlib.util.spec_from_file_location('frozen_off_freezer',ROOT/TOOL)
    base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
    selected={}
    def add(name,expected=None,role='dependency'):
        data,sig=base.read_stable(ROOT,name)
        if expected:base.require(base.digest(data)==expected,'Pinned input changed: '+name)
        if name in selected:base.require(selected[name]['data']==data and selected[name]['signature']==sig,'Input drift: '+name)
        else:selected[name]={'data':data,'signature':sig,'role':role}
        base.require(len(selected)<=base.MAX_FILES and sum(len(v['data']) for v in selected.values())<=base.MAX_TOTAL,'V3 closure bounds')
        return data
    previous=json.loads(add(PREVIOUS,PREVIOUS_SHA,'previous-manifest'))
    add(TOOL,TOOL_SHA,'pinned-freeze-tool')
    for row in previous['files']:
        data=add(row['path'],row['sha256'],'preserved-v2-input')
        base.require(len(data)==row['bytes'],'Previous size mismatch')
        base.require(add(row['archive'],row['sha256'],'preserved-v2-archive')==data,'Previous archive mismatch')
    observed=json.loads(add(OBSERVED,OBSERVED_SHA,'preserved-observation-not-eligibility'))
    base.require(observed['status']=='observed' and observed['eligibilityEstablished'] is False and
                 observed['graph']['counts'].get('kvmvapic')==1 and len(observed['graph']['devices'])==27,'Wrong observed graph provenance')
    add('artifacts/m3b-device-observer-v2-source-review-01/review.json','14e365d1240cebc58b05e29227fcba74bf0d79419ea83a958a673f76f4cadb5c','previous-source-review')
    add('artifacts/m3b-observed-device-audit-01/review.json','61ab4ce4fde35b7a08f5c220a95f6a20f9e07de66f3a685c182d009bdb40023d','conditional-device-audit')
    for name in ['run.mjs','browser.mjs','graph.mjs','test-graph.mjs','transport.mjs','test-transport.mjs','freeze.py','README.md']:
        add(HERE+name,role='v3-source')
    # Exact launch/host wrapper changes; transport fix is preserved unchanged.
    expected=selected[OLD+'run.mjs']['data'].decode().replace(OLD,HERE).replace('defuss-m3b-device-observation-v2','defuss-m3b-device-observation-v3')
    base.require(selected[HERE+'run.mjs']['data'].decode()==expected,'Unexpected host wrapper change')
    expected=selected[OLD+'browser.mjs']['data'].decode().replace('defuss-m3b-device-observation-v2','defuss-m3b-device-observation-v3')
    anchor="'-machine','pc,acpi=off,hpet=off,usb=off','-cpu','max',"
    base.require(expected.count(anchor)==1,'Launch anchor mismatch')
    expected=expected.replace(anchor,"'-machine','pc,acpi=off,hpet=off,usb=off','-global','apic.vapic=off','-cpu','max',")
    base.require(selected[HERE+'browser.mjs']['data'].decode()==expected,'Unexpected browser change')
    for name in ['transport.mjs','test-transport.mjs']:
        base.require(selected[HERE+name]['data']==selected[OLD+name]['data'],'Transport source changed')
    base.require(1<=len(args.test_evidence)<=16 and len(set(args.test_evidence))==len(args.test_evidence),'Supply1..16unique test evidence files')
    for name in args.test_evidence:
        base.require(Path(name).parts[0]=='artifacts','Retain test evidence under artifacts')
        add(name,role='test-evidence')
    imports=[]
    for name,row in selected.items():
        if not name.startswith(HERE) or not name.endswith('.mjs'):continue
        for _,sp in re.findall(r'(?:\bfrom\s+|\bimport\s*\(\s*)([\'\"])([^\'\"]+)[\'\"]',row['data'].decode()):
            target=None
            if sp.startswith(('.','/')):
                p=ROOT/sp.lstrip('/') if sp.startswith('/') else ROOT/Path(name).parent/sp
                target=p.resolve().relative_to(ROOT).as_posix();base.require(target in selected,'Missing local import '+target)
            else:base.require(sp.startswith('node:') or sp=='playwright','Unexpected package import')
            imports.append({'source':name,'specifier':sp,'localTarget':target})
    result=base.publish(ROOT,args.output,selected,{
        'kind':'m3b-off-device-observer-v3-source-freeze','previousSource':{'path':PREVIOUS,'sha256':PREVIOUS_SHA},
        'preservedObservation':{'path':OBSERVED,'sha256':OBSERVED_SHA,'eligibilityEstablished':False},
        'imports':imports,'testEvidence':args.test_evidence,
        'changeScope':'Adds apic.vapic=off, requires sole CPU local APIC native QOM vapic false and no kvmvapic node. V2 transport unchanged; graph checks strengthened. Still OFF-only and not native eligibility.'})
    p=ROOT/args.output/'manifest.json'
    print(json.dumps({'status':result['status'],'manifest':str(p.relative_to(ROOT)),'sha256':base.digest(p.read_bytes()),'files':len(result['files'])}))

if __name__=='__main__':main()
