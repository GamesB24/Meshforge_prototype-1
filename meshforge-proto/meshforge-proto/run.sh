#!/usr/bin/env bash
# One-command launch: ./run.sh   (first run: ./run.sh --setup)
set -euo pipefail
cd "$(dirname "$0")"
VENV="${MESHFORGE_VENV:-.venv}"
if [[ "${1:-}" == "--setup" || ! -d "$VENV" ]]; then
  "${PYTHON:-python3}" -m venv "$VENV"
  "$VENV/bin/pip" install --upgrade pip setuptools
  if command -v nvidia-smi >/dev/null 2>&1; then
    "$VENV/bin/pip" install torch torchvision --index-url https://download.pytorch.org/whl/cu121
    "$VENV/bin/pip" install "rembg[gpu]" onnxruntime-gpu
  else
    "$VENV/bin/pip" install torch torchvision --index-url https://download.pytorch.org/whl/cpu
    "$VENV/bin/pip" install rembg onnxruntime
  fi
  [[ -e third_party/TripoSR ]] || git clone --depth 1 https://github.com/VAST-AI-Research/TripoSR.git third_party/TripoSR
  "$VENV/bin/pip" install -r requirements.txt
  # torchmcubes is TripoSR's marching-cubes dependency; it often fails to build. Fall back to the scikit-image shim.
  "$VENV/bin/pip" install git+https://github.com/tatsy/torchmcubes.git || \
    cp torchmcubes_shim.py "$("$VENV/bin/python" -c 'import site;print(site.getsitepackages()[0])')/torchmcubes.py"
fi
echo "MeshForge on http://127.0.0.1:${MESHFORGE_PORT:-8000}  (Ctrl+C to stop)"
exec "$VENV/bin/python" -m meshforge.server
