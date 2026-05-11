// ─────────────────────────────────────────────────────────────────────────────
// miner.js — Main mining loop (CommonJS)
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const { Worker } = require('worker_threads');
const { spawn }  = require('child_process');
const crypto     = require('crypto');
const path       = require('path');
const os         = require('os');
const { Connection } = require('@solana/web3.js');
const { fetchConfig, submitMine } = require('./chain');

const WORKER_SCRIPT = path.join(__dirname, 'worker.js');

// ── ANSI colors ──────────────────────────────────────────────────────────────
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  cyan:    '\x1b[36m',
  red:     '\x1b[31m',
  magenta: '\x1b[35m',
  blue:    '\x1b[34m',
};
const f = (c, s) => `${c}${s}${C.reset}`;

function banner() {
  console.log('');
  console.log(f(C.cyan + C.bold, '  ╔══════════════════════════════════════════════╗'));
  console.log(f(C.cyan + C.bold, '  ║       EQUIUM ($EQM) Node.js CPU Miner        ║'));
  console.log(f(C.cyan + C.bold, '  ║    Equihash(96,5) · Multi-threaded · Solana  ║'));
  console.log(f(C.cyan + C.bold, '  ╚══════════════════════════════════════════════╝'));
  console.log('');
}

function log(level, msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const prefix = {
    info:  f(C.cyan,             '[INFO]'),
    ok:    f(C.green,            '[ OK ]'),
    warn:  f(C.yellow,           '[WARN]'),
    err:   f(C.red,              '[ERR ]'),
    mine:  f(C.magenta + C.bold, '[MINE]'),
    hash:  f(C.dim,              '[HASH]'),
  }[level] || '[    ]';
  console.log(`${f(C.dim, ts)} ${prefix} ${msg}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function formatEqm(baseUnits) {
  return (Number(baseUnits) / 1_000_000).toFixed(6).replace(/\.?0+$/, '');
}

// ── Worker pool ──────────────────────────────────────────────────────────────

function spawnWorkers(config, wallet, numThreads) {
  const challengeHex   = config.currentChallenge.toString('hex');
  const targetHex      = config.currentTarget.toString('hex');
  const minerPubkeyHex = wallet.publicKey.toBytes().toString('hex').replace(/,/g,'');  // ensure raw hex
  // toBytes() returns Uint8Array; convert properly:
  const pkBytes = wallet.publicKey.toBytes();
  const pkHex   = Buffer.from(pkBytes).toString('hex');
  const blockHeight = config.blockHeight.toString();
  const n = config.equihashN;
  const k = config.equihashK;

  const workers = [];
  for (let i = 0; i < numThreads; i++) {
    const w = new Worker(WORKER_SCRIPT, {
      workerData: {
        challengeHex,
        targetHex,
        minerPubkeyHex: pkHex,
        blockHeight,
        n, k,
        startNonce: (i * 0x10000) >>> 0,
        workerId: i,
      },
    });
    workers.push(w);
  }
  return workers;
}

function killAll(workers) {
  for (const w of workers) { try { w.terminate(); } catch {} }
}

/**
 * Run one mining round.
 * Monitors for round changes in the background.
 */
function mineRound(connection, config, wallet, numThreads, useGpu, onHashrate) {
  return new Promise((resolve) => {
    const workers = spawnWorkers(config, wallet, numThreads);
    const hpsPerWorker = new Array(numThreads).fill(0);
    const currentHeight = config.blockHeight;
    let done = false;

    function totalHps() { return hpsPerWorker.reduce((a, b) => a + b, 0); }

    // ── GPU BINARY TASK (CUDA/C++) ──
    let gpuProcess = null;
    if (useGpu) {
      const gpuBin = os.platform() === 'win32' ? './binary/gpu_miner_cuda.exe' : './binary/gpu_miner_cuda';
      gpuProcess = spawn(gpuBin, [], { stdio: ['pipe', 'pipe', 'inherit'] });
      
      gpuProcess.on('error', (err) => {
        log('err', `Could not start GPU miner: ${err.message}. Did you run build-gpu-cuda?`);
      });

      // Send work to GPU
      const work = {
        challenge: config.currentChallenge.toString('hex'),
        target:    config.currentTarget.toString('hex'),
        height:    currentHeight.toString() // Convert BigInt to string
      };
      gpuProcess.stdin.write(JSON.stringify(work) + '\n');

      gpuProcess.stdout.on('data', (data) => {
        try {
          const res = JSON.parse(data.toString());
          if (res.type === 'progress') {
            onHashrate(totalHps() + (res.hps || 0)); // Add GPU hps to total
          } else if (res.nonce && !done) {
            done = true;
            if (gpuProcess) gpuProcess.kill();
            killAll(workers);
            resolve({ 
              solved: true, 
              workerId: 'CUDA_GPU', 
              nonceHex: res.nonce, 
              solnIndicesHex: res.soln,
              hashHex: res.hash 
            });
          }
        } catch {}
      });
    }

    // ── Round Monitor ──
    const monitorInterval = setInterval(async () => {
      if (done) return;
      try {
        const fresh = await fetchConfig(connection);
        if (fresh.blockHeight !== currentHeight) {
          done = true;
          if (gpuProcess) gpuProcess.kill();
          clearInterval(monitorInterval);
          killAll(workers);
          resolve({ solved: false, reason: 'round_changed' });
        }
      } catch {}
    }, 5000);

    for (const w of workers) {
      w.on('message', (msg) => {
        if (done) return;
        if (msg.type === 'solution') {
          done = true;
          clearInterval(monitorInterval);
          killAll(workers);
          resolve({ solved: true, ...msg });
        } else if (msg.type === 'progress') {
          const now = Date.now();
          hpsPerWorker[msg.workerId] = msg.hps;
          
          // Only update UI every 500ms to prevent terminal scrambling
          if (!this._lastUiUpdate || now - this._lastUiUpdate > 500) {
            this._lastUiUpdate = now;
            const total = totalHps();
            process.stdout.write(`\r  ${f(C.yellow, '⚙')} HPS: ${f(C.green, total.toFixed(2).padStart(10))} | Round: ${f(C.cyan, String(currentHeight))}          `);
          }
        }
      });
      w.on('error', (err) => {
        if (!done) log('err', `Worker ${w.threadId} error: ${err.message}`);
      });
    }
  });
}

// ── Main export ───────────────────────────────────────────────────────────────

async function startMiner(opts) {
  const { rpcUrl, wallet, threads, maxBlocks, useGpu } = opts;
  
  // If GPU is enabled and threads not specified, default to 0 CPU threads
  let numThreads = threads;
  if (numThreads === undefined) {
    numThreads = useGpu ? 0 : os.cpus().length;
  }

  banner();
  log('info', `RPC:     ${f(C.cyan, rpcUrl)}`);
  log('info', `Wallet:  ${f(C.cyan, wallet.publicKey.toBase58())}`);
  log('info', `CPU:     ${numThreads > 0 ? f(C.cyan, String(numThreads)) : f(C.red, 'DISABLED')}`);
  if (useGpu) log('info', `GPU:     ${f(C.green, 'ENABLED')}`);
  console.log('');

  const connection = new Connection(rpcUrl, 'confirmed');

  let blocksMined = 0;
  let lastBlockHeight = -1n;
  let tryNum = 0;

  while (true) {
    // ── Fetch round ──────────────────────────────────────────────────────────
    let config;
    try {
      config = await fetchConfig(connection);
    } catch (e) {
      if (e.message && e.message.includes('not found')) {
        log('warn', `${f(C.yellow, 'Program not initialized yet.')} Waiting for admin to call initialize...`);
        log('warn', `  (This is normal — the Equium protocol just launched. Retrying in 30s)`);
        await sleep(30000);
      } else {
        log('err', `Failed to fetch config: ${e.message}`);
        await sleep(5000);
      }
      continue;
    }

    if (!config.miningOpen) {
      log('warn', 'Mining is not open yet. Retrying in 10s...');
      await sleep(10000);
      continue;
    }

    const blockHeight = config.blockHeight;

    tryNum++;
    const roundStr = `Round ${f(C.yellow + C.bold, `#${blockHeight}`)} | reward ${f(C.green, formatEqm(config.currentEpochReward))} EQM | target ${f(C.dim, config.currentTarget.toString('hex').slice(0, 16) + '…')}`;
    log('info', roundStr);

    let lastHps = 0;
    const result = await mineRound(connection, config, wallet, numThreads, useGpu, (hps) => {
      lastHps = hps;
      const statusLine = `  ${f(C.cyan, '⚙ Hashing:')} ${roundStr} | ${f(C.magenta + C.bold, `${hps.toFixed(2)} H/s`)}`;
      process.stdout.write(`\r${statusLine}   `);
    });

    process.stdout.write('\r' + ' '.repeat(120) + '\r');

    if (!result.solved) {
      if (result.reason === 'round_changed') {
        log('warn', `Round #${blockHeight} finished (found by someone else) | Final Hashrate: ${lastHps.toFixed(2)} H/s`);
      }
      continue;
    }

    log('ok', `✓ SOLUTION FOUND (worker ${result.workerId})`);
    if (result.nonceHex) {
      log('ok', `  nonce: ${String(result.nonceHex).slice(0, 16)}…`);
    }
    if (result.solnIndicesHex) {
      log('ok', `  soln:  ${String(result.solnIndicesHex).slice(0, 16)}…`);
    }
    if (result.hashHex) {
      log('ok', `  hash:  ${result.hashHex}`);
    }

    // Check round didn't advance while we were solving
    try {
      const fresh = await fetchConfig(connection);
      if (fresh.blockHeight !== blockHeight) {
        log('warn', 'Round changed before submission — starting next round');
        continue;
      }
    } catch {}

    log('info', 'Submitting mine transaction...');
    try {
      const sig = await submitMine(connection, wallet, result.nonceHex, result.solnIndicesHex);
      blocksMined++;
      console.log('');
      log('mine', f(C.green + C.bold, `⛏  MINED! Block #${blockHeight} → +${formatEqm(config.currentEpochReward)} EQM`));
      log('mine', `  sig: ${f(C.cyan, sig)}`);
      log('mine', `  Session total: ${blocksMined} block(s)`);
      console.log('');
    } catch (e) {
      log('err', `Transaction failed: ${e.message}`);
    }

    if (maxBlocks > 0 && blocksMined >= maxBlocks) {
      log('ok', `Reached --max-blocks ${maxBlocks}. Exiting.`);
      process.exit(0);
    }

    await sleep(2000);
  }
}

module.exports = { startMiner };
