// ─────────────────────────────────────────────────────────────────────────────
// worker.js — runs in a worker_threads thread
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const { workerData, parentPort } = require('worker_threads');
const { randomBytes } = require('crypto');
const { tryNonce, buildInput } = require('./equihash/solver');

const {
  challengeHex,
  targetHex,
  minerPubkeyHex,
  blockHeight,
  n,
  k,
  startNonce,
  workerId,
} = workerData;

const challenge   = Buffer.from(challengeHex,   'hex');
const target      = Buffer.from(targetHex,       'hex');
const minerPubkey = Buffer.from(minerPubkeyHex,  'hex');

// Build input block once (fixed for this round)
const input = buildInput(challenge, minerPubkey, BigInt(blockHeight));

// Nonce construction:
//   bytes 0-3:   counter (LE u32) — increments each attempt
//   bytes 4-7:   workerId (LE u32) — separates threads
//   bytes 8-15:  timestamp (LE u64) — separates restarts
//   bytes 16-31: random padding — uniqueness
const randomPad = randomBytes(16);
const tsBytes   = Buffer.alloc(8);
const now = BigInt(Date.now());
tsBytes.writeUInt32LE(Number(now & 0xFFFFFFFFn), 0);
tsBytes.writeUInt32LE(Number((now >> 32n) & 0xFFFFFFFFn), 4);

function makeNonce(counter, wid) {
  const nonceBuf = Buffer.alloc(32);
  nonceBuf.writeUInt32LE(counter >>> 0, 0);
  nonceBuf.writeUInt32LE(wid >>> 0, 4);
  tsBytes.copy(nonceBuf, 8);
  randomPad.copy(nonceBuf, 16);
  return nonceBuf;
}

const REPORT_INTERVAL = 1;
let attempts  = 0;
let counter   = startNonce;
let lastReport = Date.now();

while (true) {
  const nonceBuf = makeNonce(counter, workerId);
  counter = (counter + 1) >>> 0;
  attempts++;

  const result = tryNonce(input, nonceBuf, n, k, target);

  if (result) {
    parentPort.postMessage({
      type: 'solution',
      workerId,
      nonceHex:      nonceBuf.toString('hex'),
      solnIndicesHex: result.solnIndices.toString('hex'),
      hashHex:        result.hash.toString('hex'),
      attempts,
    });
    break;
  }

  if (attempts % REPORT_INTERVAL === 0) {
    const now2 = Date.now();
    const elapsed = (now2 - lastReport) / 1000;
    const hps = REPORT_INTERVAL / elapsed;
    lastReport = now2;
    parentPort.postMessage({
      type: 'progress',
      workerId,
      attempts,
      hps: Math.round(hps * 100) / 100,
    });
  }
}
