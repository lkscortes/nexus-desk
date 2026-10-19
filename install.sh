#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Nexus requer Node.js 24+. Instale a versao LTS em https://nodejs.org/en/download e execute novamente.' >&2
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  printf '%s\n' 'Nexus requer Node.js 24+. Atualize em https://nodejs.org/en/download.' >&2
  exit 1
fi
exec node "$ROOT/scripts/setup.mjs" "$@"
