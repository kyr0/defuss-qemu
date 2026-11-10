#!/usr/bin/env python3
"""Record passed pre-timing prerequisites only; never creates a timing plan."""
import argparse,datetime as dt,importlib.util,json,os
from pathlib import Path
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('finite_review',HERE/'review.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for key in ('control','candidate','heldout','diagnostic','resource','output'):parser.add_argument('--'+key,required=True)
    args=parser.parse_args();review=r.Review();review.frozen_sources();packages={}
    for side,enabled in [('control',False),('candidate',True)]:
        directory=review.path(getattr(args,side));r.require(directory.is_relative_to(r.ROOT/'artifacts'),'real retained package required');m=review.production_manifest(directory,r.OUTER);r.same(m['experiment'],dict(name='passive-fifo-v1',enabled=enabled),'package mode')
        packages[side]=dict(path=str(directory.relative_to(r.ROOT)),manifest=m,manifestSha256=review.hash(directory/'app.json')['sha256'])
    stripped=lambda m:{k:v for k,v in m.items() if k not in ('experiment','generation','compatibilitySha256')}
    r.same(stripped(packages['control']['manifest']),stripped(packages['candidate']['manifest']),'matched packages')
    records={}
    for role in ('heldout','diagnostic','resource'):
        path=review.path(getattr(args,role));r.require(path.is_relative_to(r.ROOT/'artifacts'),'real retained prerequisite required');item=dict(path=str(path.relative_to(r.ROOT)),sha256=review.hash(path)['sha256']);review.prerequisite_review(role,item,packages);records[role]=item
    output=review.path(args.output);r.require(output.is_relative_to(r.ROOT/'artifacts') and not output.exists(),'fresh artifacts ledger required');output.parent.mkdir(parents=True,exist_ok=True)
    result=dict(schema=1,experiment='passive-fifo-v1',protocol=r.OUTER,createdUtc=dt.datetime.now(dt.timezone.utc).isoformat(),packages={side:{k:value[k] for k in ('path','manifestSha256')} for side,value in packages.items()},reviews=records,
      scope='Prerequisite identity ledger only. Include this file and all three referenced reviews, runtime build/source audits and source reviews in prospective plan.inputs. No timing plan or performance acceptance is created.')
    for name,identity in list(review.inventory.items()):review.hash(Path(name) if Path(name).is_absolute() else r.ROOT/name,identity)
    r.durable_json(output,result);print(json.dumps(dict(status='passed',output=str(output.relative_to(r.ROOT)),sha256=r.sha(output.read_bytes()))))
if __name__=='__main__':main()
