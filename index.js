#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// index.js — CLI entry point (CommonJS)
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

// ── NUCLEAR FIX: Manually inject a working UUID generator into the cache ────
// This bypasses the broken ESM-only 'uuid' package entirely.
const Module = require('module');
const crypto = require('crypto');

// A simple UUID v4 generator
const mockUuid = {
  v4: () => {
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
      (c ^ crypto.randomBytes(1)[0] & 15 >> c / 4).toString(16)
    );
  }
};

// Force the mock into the module cache
const uuidPath = require.resolve('uuid', { paths: [process.cwd(), __dirname] });
require.cache[uuidPath] = {
  id: uuidPath,
  filename: uuidPath,
  loaded: true,
  exports: mockUuid
};

// Intercept all future require('uuid') calls
const originalRequire = Module.prototype.require;
Module.prototype.require = function(path) {
  if (path === 'uuid') return mockUuid;
  return originalRequire.apply(this, arguments);
};
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();

const { program } = require('commander');
const { Keypair } = require('@solana/web3.js');
const { startMiner } = require('./src/miner');
const C = require('./src/config');
const { fetchConfig } = require('./src/chain');
const bs58 = require('bs58');
const pkg = require('./package.json');

// ── Private key loader ────────────────────────────────────────────────────────
// Accepts any of the three common formats:
//   1. Base58 string  (64 bytes → 88 chars, exported from Phantom / Solflare)
//   2. Hex string     (128 hex chars = 64 bytes)
//   3. JSON array     ([n0, n1, … n63]) — the old keypair-file format

function loadPrivateKey(raw) {
  if (!raw || raw.trim() === '') {
    console.error('\n  ❌  No private key provided.');
    console.error('  Pass --private-key <key> or set PRIVATE_KEY in .env\n');
    process.exit(1);
  }

  raw = raw.trim();
  let secretKey;

  // ── JSON array: [0,1,2,...63]  ──────────────────────────────────────────────
  if (raw.startsWith('[')) {
    try {
      const arr = JSON.parse(raw);
      secretKey = Uint8Array.from(arr);
    } catch {
      console.error('\n  ❌  Could not parse private key as JSON array.\n');
      process.exit(1);
    }
  }
  // ── Hex string: 128 lowercase/uppercase hex chars ──────────────────────────
  else if (/^[0-9a-fA-F]{128}$/.test(raw)) {
    secretKey = Buffer.from(raw, 'hex');
  }
  // ── Base58 string (Phantom / Solflare export) ──────────────────────────────
  else {
    try {
      // bs58 is a dependency of @solana/web3.js — always available
      const bs58 = require('bs58');
      // bs58 default export varies by version; handle both
      const decode = typeof bs58.decode === 'function' ? bs58.decode : bs58.default.decode;
      secretKey = decode(raw);
    } catch (e) {
      console.error(`\n  ❌  Could not decode private key: ${e.message}`);
      console.error('  Expected: base58 string, 128-char hex, or JSON number array.\n');
      process.exit(1);
    }
  }

  if (secretKey.length !== 64) {
    console.error(`\n  ❌  Private key must be 64 bytes (got ${secretKey.length}).`);
    console.error('  Make sure you are pasting the PRIVATE key, not the public key.\n');
    process.exit(1);
  }

  try {
    return Keypair.fromSecretKey(secretKey);
  } catch (e) {
    console.error(`\n  ❌  Invalid private key: ${e.message}\n`);
    process.exit(1);
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────

program
  .name('equium-miner')
  .description('CPU miner for Equium ($EQM) — Equihash(96,5) on Solana')
  .version(pkg.version)
  .option(
    '--rpc-url <url>',
    'Solana RPC endpoint (Helius recommended)',
    process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
  )
  .option(
    '--private-key <key>',
    'Wallet private key — base58 (Phantom export), 128-char hex, or JSON array',
    process.env.PRIVATE_KEY || '',
  )
  .option(
    '--threads <n>',
    'Number of CPU threads (0 = all cores)',
    (v) => parseInt(v, 10),
    parseInt(process.env.THREADS || '0', 10),
  )
  .option(
    '--max-blocks <n>',
    'Stop after this many mined blocks (0 = run forever)',
    (v) => parseInt(v, 10),
    0,
  )
  .option(
    '--gpu',
    'Enable GPU mining (Requires Node.js 22+ with --experimental-webgpu)',
    false,
  );

program.parse();
const opts = program.opts();

const wallet = loadPrivateKey(opts.privateKey);

startMiner({
  rpcUrl:    opts.rpcUrl,
  wallet,
  threads:   opts.threads,
  maxBlocks: opts.maxBlocks,
  useGpu:    opts.gpu,
}).catch((err) => {
  console.error('\n  ❌  Fatal:', err.message);
  process.exit(1);
});
