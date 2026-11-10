import importlib.util,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1]
spec=importlib.util.spec_from_file_location('derive',HERE/'derive-js.py');d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
spec=importlib.util.spec_from_file_location('prepare',HERE/'prepare.py');p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
class DerivationTests(unittest.TestCase):
 def test_exact_real_glue(self):
  original=(ROOT/'artifacts/m3b-context-v2-build-01/runtime/x86_64/qemu-system-x86_64.js').read_text();observer=(HERE/'observer.js').read_text();new=d.derive(original,observer)
  for old,replacement in d.REPLACEMENTS.items():new=new.replace(replacement,old)
  self.assertEqual(new.replace(observer+'\n','',1),original)
  for old in d.REPLACEMENTS:
   for text in [original.replace(old,'',1),original+old]:
    with self.assertRaises(AssertionError):d.derive(text,observer)
  with self.assertRaises(AssertionError):d.derive(d.derive(original,observer),observer)
 def test_native_scope(self):
  changes=p.patch(p.BASE);self.assertEqual(set(changes),{'tcg/wasm64.c','tcg/m3s-observer.inc'});before=(p.BASE/'tcg/wasm64.c').read_text();after=changes['tcg/wasm64.c']
  a=before.index('#define MAX_EXEC_NUM 50000');b=before.index('#include "m3b-runtime-service.inc"',a)
  self.assertIn(before[a:b],after)
  self.assertEqual(after.count('m3b_service_after_call(env, m3b_entry_pc);'),1);self.assertEqual(after.count('emscripten_sleep(0);'),before.count('emscripten_sleep(0);'))
if __name__=='__main__':unittest.main()
