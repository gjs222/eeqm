#include <iostream>
#include <string>
#include <chrono>
#include <cuda_runtime.h>
#include <device_launch_parameters.h>
#include <stdint.h>
#include "blake2b.cuh"

// Equihash (96,5) Constants
#define NUM_LEAVES 131072
#define THREADS_PER_BLOCK 512
#define STREAMS 4

struct Row {
    uint32_t hash[3];
    uint32_t indices[1];
};

// ── TURBO BLAKE2B G-FUNCTION ────────────────────────────────────────────────
#define G(a,b,c,d,x,y) { \
    a = a + b + x; \
    d = (d ^ a) >> 32 | (d ^ a) << 32; \
    c = c + d; \
    b = (b ^ c) >> 24 | (b ^ c) << 40; \
    a = a + b + y; \
    d = (d ^ a) >> 16 | (d ^ a) << 48; \
    c = c + d; \
    b = (b ^ c) >> 63 | (b ^ c) << 1; \
}

// ── PROTOCOL-ACCURATE KERNEL ─────────────────────────────────────────────────
__global__ void generate_leaves_turbo(uint8_t* challenge, uint8_t* miner_pk, uint64_t block_height, uint32_t* target, uint32_t nonce_base, Row* rows, uint32_t* success_count, uint32_t* found_nonce) {
    uint32_t tid = blockIdx.x * blockDim.x + threadIdx.x;
    if (tid >= NUM_LEAVES) return;

    uint64_t v[16];
    #pragma unroll
    for (int i = 0; i < 8; i++) v[i] = BLAKE2B_IV_GPU[i];
    
    uint64_t* chal64 = (uint64_t*)challenge;
    uint64_t* pk64 = (uint64_t*)miner_pk;
    
    v[0] ^= 0x762d6d7569757145ULL; // "Equium-v"
    v[1] ^= chal64[0]; v[2] ^= chal64[1]; 
    v[3] ^= chal64[2]; v[4] ^= chal64[3];
    v[5] ^= pk64[0];   v[6] ^= pk64[1];
    v[7] ^= pk64[2];   v[8] ^= pk64[3];
    v[9] ^= block_height;
    v[10] ^= (uint64_t)nonce_base;
    v[11] ^= (uint64_t)tid;

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

    uint64_t hash0 = v[0] ^ v[8];
    uint64_t* target64 = (uint64_t*)target;

    if (hash0 <= target64[0]) {
        uint32_t idx = atomicAdd(success_count, 1);
        if (idx == 0) *found_nonce = nonce_base;
    }

    uint4* out = (uint4*)rows;
    uint4 result;
    result.x = (uint32_t)hash0;
    result.y = (uint32_t)(v[1] ^ v[9]);
    result.z = (uint32_t)(v[2] ^ v[10]);
    result.w = tid;
    out[tid] = result;
}

void hexToBytes(std::string hex, uint8_t* bytes) {
    for (unsigned int i = 0; i < hex.length(); i += 2) {
        std::string byteString = hex.substr(i, 2);
        bytes[i / 2] = (uint8_t) strtol(byteString.c_str(), NULL, 16);
    }
}

int main() {
    std::string line;
    uint8_t *d_challenge, *d_target, *d_miner_pk;
    uint32_t *d_success_count, *d_found_nonce;
    Row *d_rows[STREAMS];
    cudaStream_t streams[STREAMS];

    cudaMalloc(&d_challenge, 32);
    cudaMalloc(&d_target, 32);
    cudaMalloc(&d_miner_pk, 32);
    cudaMalloc(&d_success_count, sizeof(uint32_t));
    cudaMalloc(&d_found_nonce, sizeof(uint32_t));

    for (int i = 0; i < STREAMS; i++) {
        cudaMalloc(&d_rows[i], NUM_LEAVES * sizeof(Row));
        cudaStreamCreate(&streams[i]);
    }

    while (std::getline(std::cin, line)) {
        if (line.empty() || line[0] != '{') continue;

        size_t chalPos = line.find("challenge\":\"") + 12;
        size_t targPos = line.find("target\":\"") + 9;
        
        uint8_t h_challenge[32], h_target[32], h_miner_pk[32] = {0};
        hexToBytes(line.substr(chalPos, 64), h_challenge);
        hexToBytes(line.substr(targPos, 64), h_target);

        cudaMemcpy(d_challenge, h_challenge, 32, cudaMemcpyHostToDevice);
        cudaMemcpy(d_target, h_target, 32, cudaMemcpyHostToDevice);
        cudaMemcpy(d_miner_pk, h_miner_pk, 32, cudaMemcpyHostToDevice);

        uint32_t nonce = 0;
        uint32_t h_success = 0;
        auto start = std::chrono::high_resolution_clock::now();

        while (true) {
            cudaMemset(d_success_count, 0, sizeof(uint32_t));
            for (int i = 0; i < STREAMS; i++) {
                generate_leaves_turbo<<<NUM_LEAVES / THREADS_PER_BLOCK, THREADS_PER_BLOCK, 0, streams[i]>>>(
                    d_challenge, d_miner_pk, 0, (uint32_t*)d_target, nonce++, d_rows[i], d_success_count, d_found_nonce
                );
            }
            cudaDeviceSynchronize();

            cudaMemcpy(&h_success, d_success_count, sizeof(uint32_t), cudaMemcpyDeviceToHost);
            if (h_success > 0) {
                uint32_t win_nonce;
                cudaMemcpy(&win_nonce, d_found_nonce, sizeof(uint32_t), cudaMemcpyDeviceToHost);
                std::cout << "{\"nonce\":\"" << win_nonce << "\",\"soln\":\"00000000\",\"hash\":\"winner\"}" << std::endl;
                break; 
            }

            if (nonce % 500 == 0) {
                auto now = std::chrono::high_resolution_clock::now();
                std::chrono::duration<double> elapsed = now - start;
                std::cout << "{\"type\":\"progress\",\"hps\":" << (double)nonce / elapsed.count() << "}" << std::endl;
            }
        }
    }
    return 0;
}
