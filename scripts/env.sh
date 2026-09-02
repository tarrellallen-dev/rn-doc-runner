# Source this file to put the project-local Node toolchain on PATH:
#   source scripts/env.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
export PATH="$SCRIPT_DIR/.toolchain/node/bin:$PATH"
