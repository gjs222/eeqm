# build.ps1 — Build the CUDA Equihash miner on Windows

# Auto-detect project root (works even if called manually from any folder)
Set-Location "$PSScriptRoot\.."

# Paths relative to the project root
$src = "cuda/gpu_miner_cuda.cu"
$out = "binary/gpu_miner_cuda.exe"

# ── Check nvcc ────────────────────────────────────────────────────────────────
if (!(Get-Command nvcc -ErrorAction SilentlyContinue)) {
    Write-Error "nvcc not found. Please install the CUDA Toolkit."
    exit
}

$nvcc_ver = (nvcc --version | Select-String "release").ToString().Split(",")[-1].Trim()
Write-Host "nvcc version: $nvcc_ver"

# ── Auto-detect SM architecture ──────────────────────────────────────────────
$arch = "sm_86"
if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
    $cap = (nvidia-smi --query-gpu=compute_cap --format=csv,noheader | Select-Object -First 1).Replace(".", "").Trim()
    if ($cap) {
        $arch = "sm_$cap"
        Write-Host "Auto-detected GPU compute capability: $arch"
    }
}

# ── Compile ───────────────────────────────────────────────────────────────────
if (!(Test-Path "binary")) { New-Item -ItemType Directory -Path "binary" -Force }

Write-Host "Compiling $src -> $out (arch=$arch)..."
nvcc -O3 -arch=$arch --use_fast_math -o "$out" "$src"

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Done. Built: $out"
} else {
    Write-Error "❌ Compilation failed."
    exit 1
}
