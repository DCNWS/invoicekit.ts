#!/bin/sh
# Build the WebAssembly engine from the Go repository and drop it, with the Go
# runtime glue, into assets/. Run npm run build afterwards to compile TypeScript.
#
#   ./scripts/build-wasm.sh [path-to-go-repo]
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
go_repo=${1:-$(CDPATH= cd -- "$root/../invoicekit.go" && pwd)}
if [ ! -f "$go_repo/cmd/einv-wasm/main.go" ]; then
  echo "no Go checkout with cmd/einv-wasm at $go_repo" >&2
  echo "clone https://github.com/DCNWS/invoicekit.go beside this repository," >&2
  echo "or pass its path as the first argument" >&2
  exit 1
fi
dest="$root/assets"
"$go_repo/scripts/build-wasm.sh" "$dest"
