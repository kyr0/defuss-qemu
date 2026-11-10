#!/bin/sh
# Run in the QEMU Project wasm64 SDK image. See README for its pinned digest.
set -eu
flavor=tuned
case "${1:-tuned}" in tuned) ;; *) echo 'This distribution builds the tuned PC runtime' >&2; exit 2;; esac
here=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
src=$(CDPATH='' cd -- "$here/../.." && pwd)
build=${BUILD_DIR:-"$src/build-defuss-$flavor"}
mkdir -p "$build"; cd "$build"
# Preserve the source's Asyncify/pthread/export configuration while enabling
# LLVM autovectorization for compilation and the matching SIMD system libraries.
wasm_link_args=$(python3 - "$src/configs/meson/emscripten.txt" <<'PYARGS'
import ast, configparser, sys
config = configparser.ConfigParser(interpolation=None)
config.read(sys.argv[1])
args = ast.literal_eval(config['built-in options']['c_link_args'])
if '-msimd128' not in args:
    args.append('-msimd128')
print(' '.join(args))
PYARGS
)
emconfigure "$src/configure" --static --cpu=wasm64 --target-list=x86_64-softmmu \
  --disable-werror --disable-docs --disable-tools --disable-rust --disable-guest-agent \
  --disable-plugins --disable-download --without-default-features --enable-tcg \
  --disable-tcg-interpreter --with-coroutine=wasm \
  "-Dc_args=-pthread -msimd128" "-Dc_link_args=$wasm_link_args" -Doptimization=2
ninja -j "${JOBS:-4}" qemu-system-x86_64.js
"$here/tools/stage-runtime.sh" "$build" "$flavor"
