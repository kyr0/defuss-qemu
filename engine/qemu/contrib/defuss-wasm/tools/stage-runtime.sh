#!/bin/sh
set -eu
[ "$#" = 2 ] && [ "$2" = tuned ] || { echo 'usage: stage-runtime.sh BUILD_DIR tuned' >&2; exit 2; }
here=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
dest=tuned-runtime
mkdir -p "$here/web/$dest" "$here/web/assets"
cp "$1/qemu-system-x86_64.js" "$here/web/$dest/qemu-system-x86_64.js"
python3 "$here/tools/fix-emscripten-poll.py" "$here/web/$dest/qemu-system-x86_64.js"
python3 "$here/tools/expose-profile.py" "$here/web/$dest/qemu-system-x86_64.js"
cp "$1/qemu-system-x86_64.wasm" "$here/web/$dest/"
for extension in worker.js worker.mjs; do
  file="$1/qemu-system-x86_64.$extension"
  if [ -f "$file" ]; then cp "$file" "$here/web/$dest/"; fi
done
for rom in bios-256k.bin kvmvapic.bin vgabios-stdvga.bin vgabios-cirrus.bin; do
  cp "$here/../../pc-bios/$rom" "$here/web/assets/"
done
