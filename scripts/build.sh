#!/usr/bin/env bash
# build.sh — Smart Diagnostic Build Script
set -euo pipefail

# 1. Find the project root
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "------------------------------------------"
echo "🔍 DIAGNOSTIC INFO:"
echo "Current Directory: $(pwd)"
echo "Checking for CUDA file..."

# 2. SMART SEARCH: Find the CUDA file anywhere in the project
ACTUAL_SRC=$(find . -name "gpu_miner_cuda.cu" | head -1)

if [ -z "$ACTUAL_SRC" ]; then
    # Maybe it's still named miner.cu?
    ACTUAL_SRC=$(find . -name "miner.cu" | head -1)
fi

if [ -z "$ACTUAL_SRC" ]; then
    echo "❌ ERROR: Could not find gpu_miner_cuda.cu or miner.cu anywhere in $(pwd)"
    echo "Files in this directory:"
    ls -R
    exit 1
fi

echo "✅ Found source at: $ACTUAL_SRC"
mkdir -p binary
OUT="binary/gpu_miner_cuda"

# 3. Detect GPU ARCH
ARCH="sm_86"
if command -v nvidia-smi &>/dev/null; then
    CUDA_CAP=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader 2>/dev/null | head -1 | tr -d '.' | tr -d ' ')
    [ -n "$CUDA_CAP" ] && ARCH="sm_${CUDA_CAP}"
fi

# 4. Compile using the found path
echo "Compiling $ACTUAL_SRC -> $OUT (arch=$ARCH)..."
nvcc -O3 -arch="${ARCH}" --use_fast_math -o "$OUT" "$ACTUAL_SRC"

if [ $? -eq 0 ]; then
    echo "------------------------------------------"
    echo "🚀 SUCCESS! Binary created at: $OUT"
else
    echo "❌ Compilation failed."
    exit 1
fi
