#!/usr/bin/env python3
"""Inspect the actual WebAssembly binary memory/table address declarations."""
import hashlib,json,os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
class Reader:
    def __init__(self,b):self.b=b;self.i=0
    def u(self):
        v=s=0
        while True:
            x=self.b[self.i];self.i+=1;v|=(x&127)<<s
            if x<128:return v
            s+=7;assert s<70
    def byte(self):x=self.b[self.i];self.i+=1;return x
    def name(self):n=self.u();v=self.b[self.i:self.i+n];self.i+=n;return v.decode()
    def limits(self):
        f=self.u();m=self.u();maximum=self.u() if f&1 else None
        return {'flags':f,'minimum':m,'maximum':maximum,'shared':bool(f&2),'addressBits':64 if f&4 else 32}
def inspect(p):
    b=p.read_bytes();assert b[:8]==b'\0asm\x01\0\0\0';r=Reader(b);r.i=8;mem=[];tables=[]
    while r.i<len(b):
        section=r.byte();length=r.u();end=r.i+length
        if section==2:
            for _ in range(r.u()):
                mod=r.name();name=r.name();kind=r.byte()
                if kind==0:r.u()
                elif kind==1:
                    ref=r.byte();tables.append({'module':mod,'name':name,'refType':ref,**r.limits()})
                elif kind==2:mem.append({'module':mod,'name':name,**r.limits()})
                elif kind==3:r.byte();r.byte()
                elif kind==4:r.byte();r.u()
                else:raise AssertionError(kind)
            assert r.i==end
        elif section==4:
            for _ in range(r.u()):
                ref=r.byte();tables.append({'defined':True,'refType':ref,**r.limits()})
            assert r.i==end
        elif section==5:
            for _ in range(r.u()):mem.append({'defined':True,**r.limits()})
            assert r.i==end
        r.i=end
    return {'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'memories':mem,'tables':tables}
if __name__=='__main__':
    paths={'original':'runtime/x86_64/qemu-system-x86_64.wasm','control':'artifacts/rnds2-setup-control-build-01/runtime/x86_64/qemu-system-x86_64.wasm','candidate':'artifacts/memory32-rnds2-build-02/runtime/x86_64/qemu-system-x86_64.wasm','diagnostic':'artifacts/memory32-rnds2-check-build-01/runtime/x86_64/qemu-system-x86_64.wasm'}
    report={k:{'path':p,**inspect(ROOT/p)}for k,p in paths.items()}
    for k,v in report.items():
        assert len(v['memories'])==1
        m=v['memories'][0];assert m['shared'] and m['minimum']*65536==2147483648
        assert m['addressBits']==(64 if k in ['original','control']else 32)
        assert len(v['tables'])==1 and v['tables'][0]['addressBits']==m['addressBits']
    out=ROOT/'artifacts/memory32-rnds2-binary-inspection-01';out.mkdir()
    with (out/'report.json').open('x')as f:json.dump({'status':'passed','runtimes':report},f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    print(json.dumps(report,indent=2))
