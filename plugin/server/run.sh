#!/bin/bash
# Claude Code puede lanzar el servidor MCP de este plugin con un PATH minimo
# que no incluye Node (confirmado real: aunque el usuario tenga Node en su
# shell interactiva via .zshrc/.bashrc, un proceso lanzado sin esa shell no
# lo hereda) - se busca en las ubicaciones habituales en vez de depender del
# PATH heredado, mismo criterio que otros instaladores de este mismo autor
# (ver run_pipeline.sh de los proyectos de automatizacion).
set -euo pipefail

NODE_BIN=""
for candidato in \
    "$(command -v node 2>/dev/null || true)" \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    /usr/bin/node \
    "$HOME"/.node-*/bin/node \
    "$HOME"/.nvm/versions/node/*/bin/node \
    "$HOME"/.volta/bin/node; do
  if [ -n "$candidato" ] && [ -x "$candidato" ]; then
    NODE_BIN="$candidato"
    break
  fi
done

if [ -z "$NODE_BIN" ]; then
  echo "manoo: no se encontro el binario de Node en ninguna ubicacion conocida." >&2
  echo "Instala Node (https://nodejs.org) o agrega su ruta a este script (run.sh)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$NODE_BIN" "$SCRIPT_DIR/index.mjs"
