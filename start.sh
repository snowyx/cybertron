#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
node -e "const [a,b]=process.versions.node.split('.').map(Number);if(a<22||(a===22&&b<12)){console.error('需要 Node.js >=22.12');process.exit(1)}"
if [ ! -d node_modules ]; then npm ci; fi
npm run build
echo "赛博坦 3D 世界：http://localhost:${PORT:-9527}"
exec node dist-server/server/src/main.js
