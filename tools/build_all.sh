#!/usr/bin/env bash
# Rebuild every data/<slug>/ folder from the model archives in the project root.
#   tools/build_all.sh            -> Human-GEM + Mouse-GEM
# Requires the Python environment in tools/.venv (see README).
set -euo pipefail
cd "$(dirname "$0")/.."
PY=tools/.venv/bin/python

build() {  # build <archive-or-folder> <slug> [extra build_model args]
  local src=$1 slug=$2; shift 2
  $PY tools/build_model.py "$src" "$slug" "$@"
  $PY tools/build_atommaps.py "$slug" 2> >(grep -v Warning >&2)
  $PY tools/build_layout.py "$slug" | tail -1
}

build "$(ls -d Human-GEM-*.zip | tail -1)" human-gem
build "$(ls -d Mouse-GEM-*.zip | tail -1)" mouse-gem --structures-from human-gem
$PY tools/write_manifest.py
