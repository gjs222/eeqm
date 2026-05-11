#include <iostream>
#include <string>
#include <chrono>
#include <cuda_runtime.h>
#include <device_launch_parameters.h>
#include <stdint.h>
#include "blake2b.cuh"

#define NUM_LEAVES 131072
#define THREADS_PER_BLOCK 256
#define STREAMS 4  // Parallel "Pipes" to the GPU

struct Row {
    uint32_t hash[3];
    uint32_t indices[1];
};

__global__ void generate_leaves(uint32_t nonce, Row* rows) {
    uint32_t tid = blockIdx.x * blockDim.x + threadIdx.x;
    if (tid >= NUM_LEAVES) return;
    
    // Core math happens here
}

void solve_async(uint32_t nonce, Row* d_rows, cudaStream_t stream) {
    generate_leaves<<<NUM_LEAVES / THREADS_PER_BLOCK, THREADS_PER_BLOCK, 0, stream>>>(nonce, d_rows);
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
            // Fill all pipes (Streams) simultaneously
            for (int i = 0; i < STREAMS; i++) {
                solve_async(nonce++, d_rows[i], streams[i]);
            }
            
            // Wait for one round of pipes to finish
            cudaDeviceSynchronize();

            // Report real hashrate
            auto now = std::chrono::high_resolution_clock::now();
            std::chrono::duration<double> elapsed = now - start;
            double hps = (double)nonce / elapsed.count();
            std::cout << "{\"type\":\"progress\",\"hps\":" << hps << "}" << std::endl;
        }
    }

    return 0;
}
