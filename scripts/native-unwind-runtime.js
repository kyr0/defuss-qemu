// Injected before instantiate_wasm. Each Emscripten worker captures its own
// uninstrumented getter before Asyncify wraps exports in JavaScript.
// The adapter imports no memory and returns the existing helper.u contract:
// Normal/Rewinding => 1, Unwinding => 0.
var pcNativeUnwindStatus={mode:'javascript',reason:'not-initialized'};
Module.pcUnwindStatus=()=>({...pcNativeUnwindStatus});
function pcInitNativeUnwind(exports){
  Module.pcNativeUnwindCheck=null;
  if(typeof exports.asyncify_get_state!=='function'){
    pcNativeUnwindStatus={mode:'javascript',reason:'missing-native-state-getter'};
    return;
  }
  try{
    // (module (import "h" "state" (func (result i32)))
    //   (func (export "ok") (result i32) call 0 i32.const 1 i32.ne))
    const bytes=new Uint8Array([
      0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,
      2,11,1,1,104,5,115,116,97,116,101,0,0,
      3,2,1,0,7,6,1,2,111,107,0,1,
      10,9,1,7,0,16,0,65,1,71,11
    ]);
    const adapter=new WebAssembly.Instance(new WebAssembly.Module(bytes),
      {h:{state:exports.asyncify_get_state}});
    Module.pcNativeUnwindCheck=adapter.exports.ok;
    pcNativeUnwindStatus={mode:'native',reason:null};
  }catch(error){
    // Keep the proven JS path if an older runtime or host rejects the adapter.
    pcNativeUnwindStatus={mode:'javascript',reason:'native-adapter-unavailable',
      detail:String(error?.message||error)};
  }
}
