// ─────────────────────────────────────────────────────────────────────────────
// Optimized Equihash(96, 5) Solver — Bucket Sort Edition
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const { createHash } = require('crypto');
const { blake2b } = require('@noble/hashes/blake2b');

// Constants for n=96, k=5
const N = 96;
const K = 5;
const C_BITS = 16;             // n / (k+1)
const C_BYTES = 2;            // bits / 8
const LEAF_COUNT = 131072;     // 2^(cbits+1)
const HASH_LEN = 12;           // n / 8
const INDICES_PER_HASH = 5;    // floor(512 / 96)

/**
 * High-performance solver using typed arrays and bucket sort.
 */
class OptimizedSolver {
  constructor() {
    // Pre-allocate large buffers to avoid GC
    // We need space for 131072 rows. Each row has hash + indices.
    // In round 0, we have 1 index. In round 1, 2 indices... In round 5, 32 indices.
    this.hashBuf = new Uint8Array(LEAF_COUNT * HASH_LEN);
    
    // Bucket structures for O(N) collision finding
    this.buckets = new Uint32Array(65536); // Heads of linked lists
    this.nextPtr = new Uint32Array(LEAF_COUNT); // Next pointers for linked lists
    
    this.personal = this.makePersonal(N, K);
  }

  makePersonal(n, k) {
    const p = new Uint8Array(16);
    const s = 'ZcashPoW';
    for (let i = 0; i < 8; i++) p[i] = s.charCodeAt(i);
    p[8] = n & 0xFF; p[9] = (n >> 8) & 0xFF;
    p[12] = k & 0xFF; p[13] = (k >> 8) & 0xFF;
    return p;
  }

  /**
   * Main solving entry point
   */
  tryNonce(input, nonce, target) {
    const inputPlusNonce = new Uint8Array(input.length + nonce.length);
    inputPlusNonce.set(input, 0);
    inputPlusNonce.set(nonce, input.length);

    // Round 0: Generate leaves
    // Format: [hash_bytes...][index_u32]
    let rows = [];
    for (let i = 0; i < LEAF_COUNT; i++) {
      const blockIdx = Math.floor(i / INDICES_PER_HASH);
      const msg = Buffer.allocUnsafe(inputPlusNonce.length + 4);
      msg.set(inputPlusNonce, 0);
      msg.writeUInt32LE(blockIdx, inputPlusNonce.length);
      
      const full = blake2b(msg, { dkLen: 64, personalization: this.personal });
      const off = (i % INDICES_PER_HASH) * HASH_LEN;
      
      rows.push({
        hash: Buffer.from(full.slice(off, off + HASH_LEN)),
        indices: [i]
      });
    }

    // k Rounds of Wagner (Optimized with Bucket Sort)
    for (let round = 0; round < K; round++) {
      rows = this.wagnerBucketRound(rows, C_BITS);
      if (rows.length === 0) return null;
    }

    // Check solutions
    for (const row of rows) {
      if (!row.hash.every(b => b === 0)) continue;
      const compressed = this.compress(row.indices);
      const h = createHash('sha256').update(compressed).update(input).digest();
      if (h.compare(target) <= 0) {
        return { solnIndices: compressed, hash: h };
      }
    }
    return null;
  }

  /**
   * Optimized round using Bucket Sort instead of Array.sort()
   */
  wagnerBucketRound(rows, cBits) {
    const nextRows = [];
    const buckets = new Map(); // Using Map for simplicity in this version, could be Uint32Array for more speed
    
    const cBytes = cBits / 8;

    // Phase 1: Bucketize
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      // Collision is on the first cBits
      const key = row.hash.readUInt16BE(0); 
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(row);
    }

    // Phase 2: Collide within buckets
    for (const bucket of buckets.values()) {
      if (bucket.length < 2) continue;
      
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          const ra = bucket[i];
          const rb = bucket[j];
          
          // Distinct indices check
          let collision = false;
          for (const idxA of ra.indices) {
            if (rb.indices.includes(idxA)) {
              collision = true;
              break;
            }
          }
          if (collision) continue;

          // XOR hashes and trim
          const xored = Buffer.allocUnsafe(ra.hash.length - cBytes);
          for (let k = 0; k < xored.length; k++) {
            xored[k] = ra.hash[k + cBytes] ^ rb.hash[k + cBytes];
          }

          // Concat indices canonically
          const newIndices = ra.indices[0] < rb.indices[0] 
            ? [...ra.indices, ...rb.indices] 
            : [...rb.indices, ...ra.indices];

          nextRows.push({ hash: xored, indices: newIndices });
        }
      }
    }
    return nextRows;
  }

  compress(indices) {
    const bitsPerIdx = 17; // cbits + 1
    const out = Buffer.alloc(Math.ceil(bitsPerIdx * indices.length / 8));
    let pos = 0;
    for (const idx of indices) {
      for (let b = bitsPerIdx - 1; b >= 0; b--) {
        const bit = (idx >> b) & 1;
        out[Math.floor(pos / 8)] |= bit << (7 - (pos % 8));
        pos++;
      }
    }
    return out;
  }
}

// Singleton for worker threads
const solver = new OptimizedSolver();

module.exports = {
  buildInput: (challenge, minerPubkeyBytes, blockHeight) => {
    const buf = Buffer.alloc(81);
    buf.write('Equium-v1', 0, 'ascii');
    Buffer.from(challenge).copy(buf, 9);
    Buffer.from(minerPubkeyBytes).copy(buf, 41);
    const bh = BigInt(blockHeight);
    buf.writeUInt32LE(Number(bh & 0xFFFFFFFFn), 73);
    buf.writeUInt32LE(Number((bh >> 32n) & 0xFFFFFFFFn), 77);
    return buf;
  },
  tryNonce: (input, nonce, n, k, target) => {
    return solver.tryNonce(input, nonce, target);
  },
  hashUnderTarget: (hash, target) => hash.compare(target) <= 0
};
