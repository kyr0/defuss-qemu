#!/usr/bin/env python3
"""Freeze a narrow shared-view transport correction without touching v1."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[2]
HERE='experiments/m3b-device-observer-v2/'
OLD='experiments/m3b-device-observer/'
BASE_MANIFEST='artifacts/m3b-device-observer-source-01/manifest.json'
BASE_SHA='8b26afce5abf634435e3c2297d85ff3d7662d21d8d42ad4c1495548d71443edb'
BASE_TOOL='artifacts/m3b-device-observer-source-01/source/'+OLD+'freeze.py'
BASE_TOOL_SHA='7e6bc2b22ca92fcf6a3fffc62d4556be37d687adb19a79304858f02de7cd8204'
FAILED='artifacts/m3b-device-observation-01/report.json'
FAILED_SHA='b025ab97ade8d48bc209e8828b18b4bd563d719f89f9ef15a4d3cf52b7ecbe61'

def original_derivation(name,text):
    if name=='run.mjs':
        text=text.replace(OLD,HERE).replace("protocol:'defuss-m3b-device-observation-v1'","protocol:'defuss-m3b-device-observation-v2'")
        text=text.replace("['run.mjs','browser.mjs','graph.mjs','test-graph.mjs','README.md']","['run.mjs','browser.mjs','graph.mjs','test-graph.mjs','README.md','transport.mjs','test-transport.mjs','freeze.py']")
        text=text.replace("'experiments/m3b-device-observer-v2/graph.mjs',","'experiments/m3b-device-observer-v2/graph.mjs','experiments/m3b-device-observer-v2/transport.mjs',")
    elif name=='browser.mjs':
        text="import {acceptQmpChunk,decodeSerialBytes} from './transport.mjs';\n"+text
        text=text.replace("protocol:'defuss-m3b-device-observation-v1'","protocol:'defuss-m3b-device-observation-v2'")
        text=text.replace('report.rawQmp+=rawDecoder.decode(b.subarray(o,o+n),{stream:true});qmp.accept(b.subarray(o,o+n));',
                          'acceptQmpChunk(rawDecoder,qmp,b,o,n,text=>{report.rawQmp+=text;});')
        text=text.replace("mod.FS.readFile('/guest/console.log',{encoding:'utf8'})","decodeSerialBytes(mod.FS.readFile('/guest/console.log'))")
    return text

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',required=True)
    parser.add_argument('--test-evidence',action='append',required=True)
    args=parser.parse_args()
    assert hashlib.sha256((ROOT/BASE_TOOL).read_bytes()).hexdigest()==BASE_TOOL_SHA
    assert (ROOT/BASE_TOOL).resolve()==ROOT/BASE_TOOL
    spec=importlib.util.spec_from_file_location('frozen_observer_freezer',ROOT/BASE_TOOL)
    base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
    selected,_=base.selection(ROOT,args.test_evidence)
    def add(name,expected=None,role='v2-dependency'):
        data,sig=base.read_stable(ROOT,name)
        if expected:base.require(base.digest(data)==expected,'Pinned v2 dependency changed: '+name)
        if name in selected:base.require(selected[name]['data']==data and selected[name]['signature']==sig,'Input changed: '+name)
        else:selected[name]={'data':data,'signature':sig,'role':role}
        return data
    manifest=json.loads(add(BASE_MANIFEST,BASE_SHA))
    add(BASE_TOOL,BASE_TOOL_SHA)
    failure=json.loads(add(FAILED,FAILED_SHA,'preserved-failed-observation'))
    base.require(failure['status']=='failed' and failure['commandCount']==0 and
                 'ArrayBufferView value must not be shared' in failure['failure'] and
                 failure['inputRecheck']==[],'Unexpected preserved failure')
    for name,sha in [
        ('artifacts/m3b-device-observer-source-review-01/review.json','dac62163e9312b5f0e16f052bdc46db4efbf28c521a08f30bdc3bd8240524f40'),
        ('artifacts/m3b-device-observer-source-review-01/syntax-supplement.json','7168914541d9691031678640e54afdde908507b239a72356aa99fd9daf77164c')]:add(name,sha)
    old={r['path']:r for r in manifest['files']}
    derivations=[]
    for name in ['run.mjs','browser.mjs','graph.mjs','test-graph.mjs']:
        row=old[OLD+name];original=add(row['archive'],row['sha256']).decode()
        current=add(HERE+name,role='v2-source')
        base.require(current.decode()==original_derivation(name,original),'Unexpected change beyond transport/namespace: '+name)
        derivations.append({'path':HERE+name,'original':row['archive'],'originalSha256':row['sha256'],'sha256':base.digest(current)})
    for name in ['transport.mjs','test-transport.mjs','README.md','freeze.py']:add(HERE+name,role='v2-source')
    imports=[]
    for name,row in selected.items():
        if not name.startswith(HERE) or not name.endswith('.mjs'):continue
        for match in re.findall(r'\bfrom\s*[\'\"]([^\'\"]+)[\'\"]|\bimport\s*\(\s*[\'\"]([^\'\"]+)[\'\"]\s*\)',row['data'].decode()):
            specifier=next(v for v in match if v);target=None
            if specifier.startswith(('.','/')):
                p=ROOT/specifier.lstrip('/') if specifier.startswith('/') else ROOT/Path(name).parent/specifier
                target=p.resolve().relative_to(ROOT).as_posix();base.require(target in selected,'Missing v2 import '+target)
            else:base.require(specifier.startswith('node:') or specifier=='playwright','Unexpected external import')
            imports.append({'source':name,'specifier':specifier,'localTarget':target})
    base.require(len(selected)<=base.MAX_FILES and sum(len(v['data']) for v in selected.values())<=base.MAX_TOTAL,'V2 freeze bounds')
    result=base.publish(ROOT,args.output,selected,{
        'kind':'m3b-off-device-observer-v2-source-freeze','previousSource':{'path':BASE_MANIFEST,'sha256':BASE_SHA},
        'preservedFailure':{'path':FAILED,'sha256':FAILED_SHA},'derivations':derivations,'imports':imports,
        'testEvidence':args.test_evidence,
        'changeScope':'Transport copy before raw QMP decoding/parsing and final serial decoding; namespace/protocol/source closure updated. Graph checks, argv, runtime/assets, timeout bounds and host conditions unchanged.'})
    p=ROOT/args.output/'manifest.json'
    print(json.dumps({'status':result['status'],'manifest':str(p.relative_to(ROOT)),'sha256':base.digest(p.read_bytes()),'files':len(result['files'])}))

if __name__=='__main__':main()
