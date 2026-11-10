import unittest,struct,copy
from xstate import seed,compare,state,caps
class StateTests(unittest.TestCase):
 def test_components_and_corruption(self):
  for m in (7,31,519,543):
   c=dict(schema=1,mask=m,size=2696 if m&512 else 1088 if m&24 else 832,ymmOffset=576,pkruOffset=2688 if m&512 else 0,bndregsOffset=960 if m&24 else 0,bndcsrOffset=1024 if m&24 else 0,patterns=2)
   for p in (0,1):
    a=bytearray(seed(c,p));struct.pack_into('<I',a,28,65535);self.assertEqual(compare(bytes(a),c,p),65535)
    offsets=[0,2,4,6,8,16,24,32,40,152,160,415,512,520,576,831]+([960,1023,1024,1039] if m&24 else [])+([2688] if m&512 else [])
    for off in offsets:
     with self.subTest(mask=m,pattern=p,offset=off):
      b=bytearray(a);b[off]^=1
      with self.assertRaises(ValueError):compare(bytes(b),c,p)
    for off in [5,7,42,416,511,528,575]:a[off]^=128
    self.assertEqual(compare(bytes(a),c,p),65535)
 def test_observation_order_and_bounds(self):
  c=dict(schema=1,mask=543,size=2696,ymmOffset=576,pkruOffset=2688,bndregsOffset=960,bndcsrOffset=1024,patterns=2);g=dict(seq=1,checks=81924)
  r=dict(seq=1,invocations=4096,samples=[])
  for p in (0,1):
   b=bytearray(seed(c,p));struct.pack_into('<I',b,28,65535);r['samples'].append(dict(pattern=p,invocation=4095+p,before=b.hex(),after=b.hex()))
  self.assertEqual(state(r,c,g)['invocations'],4096)
  mutations=[lambda x:x.update(seq=2),lambda x:x.update(invocations=4095),lambda x:x['samples'].reverse(),lambda x:x['samples'][0].update(invocation=1),lambda x:x['samples'][1].update(after='00')]
  for edit in mutations:
   bad=copy.deepcopy(r);edit(bad)
   with self.assertRaises(ValueError):state(bad,c,g)
  for key,value in [('mask',551),('size',4097),('ymmOffset',577),('bndcsrOffset',0)]:
   with self.assertRaises(ValueError):caps({**c,key:value})
if __name__=='__main__':unittest.main()
