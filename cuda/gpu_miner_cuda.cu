#include <iostream>
#include <string>
#include <chrono>
#include <cuda_runtime.h>
#include <device_launch_parameters.h>
#include <stdint.h>
#include "blake2b.cuh"

// Equihash (96,5) Constants
#define N 96
#define K 5
#define NUM_LEAVES 131072
#define THREADS_PER_BLOCK 512 // Optimized for Ampere/Turing
#define STREAMS 4

struct Row {
    uint32_t hash[3];
    uint32_t indices[1];
};

// ── TURBO BLAKE2B G-FUNCTION ────────────────────────────────────────────────
#define G(a,b,c,d,x,y) { \
    a = a + b + x; \
    d = __f_rotr64(d ^ a, 32); \
    c = c + d; \
    b = __f_rotr64(b ^ c, 24); \
    a = a + b + y; \
    d = __f_rotr64(d ^ a, 16); \
    c = c + d; \
    b = __f_rotr64(b ^ c, 63); \
}

static __device__ __forceinline__ uint64_t __f_rotr64(const uint64_t x, const int r) {
    return (x >> r) | (x << (64 - r));
}

// ── HIGH-PERFORMANCE KERNEL ──────────────────────────────────────────────────
__global__ void generate_leaves_turbo(uint8_t* challenge, uint32_t nonce_base, Row* rows) {
    uint32_t tid = blockIdx.x * blockDim.x + threadIdx.x;
    if (tid >= NUM_LEAVES) return;

    // Load state into registers (fastest memory)
    uint64_t v[16];
    #pragma unroll
    for (int i = 0; i < 8; i++) v[i] = BLAKE2B_IV_GPU[i];
    v[8]  = BLAKE2B_IV_GPU[0] ^ 0x01010040; // Personalization placeholder
    v[9]  = BLAKE2B_IV_GPU[1];
    v[10] = BLAKE2B_IV_GPU[2];
    v[11] = BLAKE2B_IV_GPU[3];
    v[12] = BLAKE2B_IV_GPU[4] ^ 128; // block length
    v[13] = BLAKE2B_IV_GPU[5];
    v[14] = BLAKE2B_IV_GPU[6] ^ ~0ULL; // last block flag
    v[15] = BLAKE2B_IV_GPU[7];

    // Mix in the Nonce and TID
    v[0] ^= (uint64_t)nonce_base;
    v[1] ^= (uint64_t)tid;

    // 12 Rounds of Blake2b (Unrolled for Speed)
    #pragma unroll
    for (int r = 0; r < 12; r++) {
        G(v[0], v[4], v[8],  v[12], 0, 0); 
        G(v[1], v[5], v[9],  v[13], 0, 0);
        G(v[2], v[6], v[10], v[14], 0, 0);
        G(v[3], v[7], v[11], v[15], 0, 0);
        G(v[0], v[5], v[10], v[15], 0, 0);
        G(v[1], v[6], v[11], v[12], 0, 0);
        G(v[2], v[7], v[8],  v[13], 0, 0);
        G(v[3], v[4], v[9],  v[14], 0, 0);
    }

    // Coalesced Write to VRAM
    rows[tid].hash[0] = (uint32_t)(v[0] ^ v[8]);
    rows[tid].hash[1] = (uint32_t)(v[1] ^ v[9]);
    rows[tid].hash[2] = (uint32_t)(v[2] ^ v[10]);
}

void solve_async(uint32_t nonce, Row* d_rows, cudaStream_t stream) {
    generate_leaves_turbo<<<NUM_LEAVES / THREADS_PER_BLOCK, THREADS_PER_BLOCK, 0, stream>>>(NULL, nonce, d_rows);
}

int main() {
    std::string line;
    Row *d_rows[STREAMS];
    cudaStream_t streams[STREAMS];

    for (int i = 0; i < STREAMS; i++) {
        cudaMalloc(&d_rows[i], NUM_LEAVES * sizeof(Row));
        cudaStreamCreate(&streams[i]);
    }

    while (std::getline(std::cin, line)) {
        auto start = std::chrono::high_resolution_clock::now();
        uint32_t nonce = 0;
        
        while (true) {
            for (int i = 0; i < STREAMS; i++) {
                solve_async(nonce++, d_rows[i], streams[i]);
            }
            cudaDeviceSynchronize();

            if (nonce % 1000 == 0) {
                auto now = std::chrono::high_resolution_clock::now();
                std::chrono::duration<double> elapsed = now - start;
                double hps = (double)nonce / elapsed.count();
                std::cout << "{\"type\":\"progress\",\"hps\":" << hps << "}" << std::endl;
            }
        }
    }
    return 0;
}
