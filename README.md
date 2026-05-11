# Equium ($EQM) Solana Miner

A high-performance, multi-threaded Equihash(96,5) miner for the Equium protocol on Solana. This miner uses a **Master/Worker Architecture**: Node.js handles the Solana chain state and orchestration, while a high-speed CUDA binary handles the GPU Proof-of-Work.

## 📋 Prerequisites

- **Node.js**: v20.x or higher.
- **CUDA Toolkit**: Required for GPU mining (must have `nvcc` in your PATH).
- **Solana Wallet**: Private key with a small amount of SOL for fees.

## 🚀 Quick Start (CPU Only)

1. **Install**:
   ```powershell
   npm install
   ```
2. **Configure**: Fill in your `RPC_URL` and `PRIVATE_KEY` in the `.env` file.
3. **Run**:
   ```powershell
   node index.js
   ```

## ⚡ GPU Mining (CUDA Process Bridge)

The GPU miner runs as a standalone binary that communicates with Node.js via a high-speed Process Bridge.

1. **Build**:
   ```powershell
   npm run build
   ```
   *This uses the scripts in `/scripts` to compile `/cuda/miner.cu` into `/binary`.*

2. **Run**:
   ```powershell
   node index.js --gpu
   ```

### ⚙️ How Orchestration Works
- **Round Sync**: Node.js polls Solana every 5s. If a new block height is detected, it automatically kills the GPU process and restarts it with the fresh challenge.
- **Hashrate Sync**: The GPU reports its speed via `stdout`, which is displayed live in the main terminal UI.
- **Submission**: Node.js handles all Solana transaction signing and landing.

## 💎 Project Structure

- `index.js`: Main entry and "Nuclear" UUID shim.
- `src/`: Core Node.js logic (miner, worker, chain, config).
- `cuda/`: GPU source code (`miner.cu`, `blake2b.cuh`).
- `scripts/`: Build automation (`build.sh`, `build.ps1`).
- `binary/`: Where the compiled miner executable lives.

## 🛠️ Developer: GPU I/O Reference
The GPU binary communicates via JSON over Standard I/O:
- **Input (Stdin)**: `{"challenge":"...","target":"...","height":...}`
- **Output (Stdout)**: 
  - Progress: `{"type":"progress","hps":1250.5}`
  - Solution: `{"nonce":"...","soln":"...","hash":"..."}`

---
*Equium — The first Proof-of-Work token on Solana.*
