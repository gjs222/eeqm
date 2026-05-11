// ─────────────────────────────────────────────────────────────────────────────
// config.js — Protocol constants (mirrors Rust source exactly)
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
const { createHash } = require('crypto');

const PROGRAM_ID   = 'ZKGMUfxiRCXFPnqz9zgqAnuqJy15jk7fKbR4o6FuEQM';
const MINT_ADDRESS = '1MhvZzEe8gQ8Rb9CrT3Dn26Gkn9QRErzLMGkkTwveqm';

// PDA seeds — matches state.rs
const CONFIG_SEED = Buffer.from('equium-config');
const VAULT_SEED  = Buffer.from('equium-vault');

// Equihash parameters (lib.rs DEFAULT_N / DEFAULT_K)
const DEFAULT_N = 96;
const DEFAULT_K = 5;

// Input block personalization prefix (challenge.rs)
const PERSONALIZATION = Buffer.from('Equium-v1');  // 9 bytes

// I_LEN = 9 + 32 + 32 + 8 = 81
const I_LEN = 81;

// Anchor instruction discriminator = first 8 bytes of sha256("global:<name>")
function instructionDiscriminator(name) {
  return createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

const MINE_DISCRIMINATOR = instructionDiscriminator('mine');

// ── Config account layout offsets (manual Borsh — no schema dep) ─────────────
// After 8-byte Anchor discriminator:
const CONFIG_LAYOUT = {
  DISC:                   0,
  MINT:                   8,
  MINEABLE_VAULT:        40,
  MINEABLE_VAULT_BUMP:   72,
  CONFIG_BUMP:           73,
  GENESIS_SLOT:          74,
  GENESIS_UNIX_TS:       82,
  EQUIHASH_N:            90,
  EQUIHASH_K:            94,
  CURRENT_TARGET:        98,
  BLOCK_HEIGHT:         130,
  CURRENT_CHALLENGE:    138,
  CURRENT_ROUND_OPEN_SLOT: 170,
  CURRENT_ROUND_OPEN_TS:   178,
  LAST_WINNER:          186,
  CURRENT_EPOCH_REWARD: 218,
  NEXT_HALVING_BLOCK:   226,
  NEXT_RETARGET_BLOCK:  234,
  LAST_RETARGET_TS:     242,
  CUMULATIVE_MINED:     250,
  EMPTY_ROUNDS:         258,
  MINING_OPEN:          266,
  ADMIN:                267,
  ADMIN_RENOUNCED:      299,
};

module.exports = {
  PROGRAM_ID,
  MINT_ADDRESS,
  CONFIG_SEED,
  VAULT_SEED,
  DEFAULT_N,
  DEFAULT_K,
  PERSONALIZATION,
  I_LEN,
  MINE_DISCRIMINATOR,
  CONFIG_LAYOUT,
  instructionDiscriminator,
};
