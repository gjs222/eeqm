// ─────────────────────────────────────────────────────────────────────────────
// chain.js — Solana RPC interactions (CommonJS)
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_SLOT_HASHES_PUBKEY,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');

const {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} = require('@solana/spl-token');

const {
  PROGRAM_ID,
  MINT_ADDRESS,
  CONFIG_SEED,
  VAULT_SEED,
  CONFIG_LAYOUT,
  MINE_DISCRIMINATOR,
} = require('./config');

const PROGRAM_PK = new PublicKey(PROGRAM_ID);
const MINT_PK    = new PublicKey(MINT_ADDRESS);

// ── PDA helpers ──────────────────────────────────────────────────────────────

function deriveConfigPda() {
  const [pda] = PublicKey.findProgramAddressSync([CONFIG_SEED], PROGRAM_PK);
  return pda;
}

function deriveVaultPda() {
  const [pda] = PublicKey.findProgramAddressSync([VAULT_SEED], PROGRAM_PK);
  return pda;
}

// ── Config parsing ───────────────────────────────────────────────────────────

async function fetchConfig(connection) {
  const configPda = deriveConfigPda();
  const info = await connection.getAccountInfo(configPda);
  if (!info) throw new Error('EquiumConfig PDA not found — wrong cluster or program not deployed?');
  if (info.data.length === 0) throw new Error('EquiumConfig not found (account has no data — admin has not called initialize yet)');
  if (info.data.length < 267 + 32) throw new Error(`EquiumConfig account too small (${info.data.length} bytes) — may be a different program version`);

  const d = info.data;
  const L = CONFIG_LAYOUT;

  return {
    mint:                  new PublicKey(d.slice(L.MINT,              L.MINT + 32)),
    mineableVault:         new PublicKey(d.slice(L.MINEABLE_VAULT,    L.MINEABLE_VAULT + 32)),
    mineableVaultBump:     d[L.MINEABLE_VAULT_BUMP],
    configBump:            d[L.CONFIG_BUMP],
    genesisSlot:           d.readBigUInt64LE(L.GENESIS_SLOT),
    equihashN:             d.readUInt32LE(L.EQUIHASH_N),
    equihashK:             d.readUInt32LE(L.EQUIHASH_K),
    currentTarget:         Buffer.from(d.slice(L.CURRENT_TARGET,    L.CURRENT_TARGET + 32)),
    blockHeight:           d.readBigUInt64LE(L.BLOCK_HEIGHT),
    currentChallenge:      Buffer.from(d.slice(L.CURRENT_CHALLENGE, L.CURRENT_CHALLENGE + 32)),
    currentRoundOpenSlot:  d.readBigUInt64LE(L.CURRENT_ROUND_OPEN_SLOT),
    lastWinner:            new PublicKey(d.slice(L.LAST_WINNER,       L.LAST_WINNER + 32)),
    currentEpochReward:    d.readBigUInt64LE(L.CURRENT_EPOCH_REWARD),
    nextHalvingBlock:      d.readBigUInt64LE(L.NEXT_HALVING_BLOCK),
    nextRetargetBlock:     d.readBigUInt64LE(L.NEXT_RETARGET_BLOCK),
    cumulativeMined:       d.readBigUInt64LE(L.CUMULATIVE_MINED),
    emptyRounds:           d.readBigUInt64LE(L.EMPTY_ROUNDS),
    miningOpen:            d[L.MINING_OPEN] !== 0,
    admin:                 new PublicKey(d.slice(L.ADMIN, L.ADMIN + 32)),
    adminRenounced:        d[L.ADMIN_RENOUNCED] !== 0,
  };
}

// ── Transaction ───────────────────────────────────────────────────────────────

function encodeVecU8(buf) {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(buf.length, 0);
  return Buffer.concat([lenBuf, buf]);
}

function buildMineInstruction(minerPk, configPda, vaultPda, minerAta, nonce, solnIndices) {
  const data = Buffer.concat([
    MINE_DISCRIMINATOR,
    nonce,
    encodeVecU8(solnIndices),
  ]);

  const keys = [
    { pubkey: minerPk,                     isSigner: true,  isWritable: true  },
    { pubkey: configPda,                   isSigner: false, isWritable: true  },
    { pubkey: MINT_PK,                     isSigner: false, isWritable: false },
    { pubkey: vaultPda,                    isSigner: false, isWritable: true  },
    { pubkey: minerAta,                    isSigner: false, isWritable: true  },
    { pubkey: TOKEN_PROGRAM_ID,            isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId,     isSigner: false, isWritable: false },
    { pubkey: SYSVAR_SLOT_HASHES_PUBKEY,  isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({ keys, programId: PROGRAM_PK, data });
}

async function submitMine(connection, wallet, nonceHex, solnIndicesHex) {
  const configPda = deriveConfigPda();
  const vaultPda  = deriveVaultPda();
  const minerAta  = getAssociatedTokenAddressSync(MINT_PK, wallet.publicKey, false, TOKEN_PROGRAM_ID);

  const ix = buildMineInstruction(
    wallet.publicKey,
    configPda,
    vaultPda,
    minerAta,
    Buffer.from(nonceHex, 'hex'),
    Buffer.from(solnIndicesHex, 'hex'),
  );

  const tx = new Transaction().add(ix);
  return sendAndConfirmTransaction(connection, tx, [wallet], {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
}

module.exports = { deriveConfigPda, deriveVaultPda, fetchConfig, submitMine };
