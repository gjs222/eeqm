#ifndef BLAKE2B_CUH
#define BLAKE2B_CUH

#include <stdint.h>
#include <cuda_runtime.h>

/**
 * Optimized BLAKE2b for CUDA
 * Based on your provided RFC 7693 implementation.
 */

__device__ const uint64_t BLAKE2B_IV_GPU[8] = {
    0x6a09e667f3bcc908ULL, 0xbb67ae8584caa73bULL,
    0x3c6ef372fe94f82bULL, 0xa54ff53a5f1d36f1ULL,
    0x510e527fad682d1aULL, 0x9b05688c2b3e6c1fULL,
    0x1f83d9abfb41bd6bULL, 0x5be0cd19137e2179ULL
};

__device__ const uint8_t BLAKE2B_SIGMA_GPU[12][16] = {
    {0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15},
    {14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3},
    {11,8,12,0,5,2,15,13,10,14,3,6,7,1,9,4},
    {7,9,3,1,13,12,11,14,2,6,5,10,4,0,15,8},
    {9,0,5,7,2,4,10,15,14,1,11,12,6,8,3,13},
    {2,12,6,10,0,11,8,3,4,13,7,5,15,14,1,9},
    {12,5,1,15,14,13,4,10,0,7,6,3,9,2,8,11},
    {13,11,7,14,12,1,3,9,5,0,15,4,8,6,2,10},
    {6,15,14,9,11,3,0,8,12,2,13,7,1,4,10,5},
    {10,2,8,4,7,6,1,5,15,11,9,14,3,12,13,0},
    {0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15},
    {14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3}
};

__device__ __forceinline__ uint64_t rotr64_gpu(uint64_t x, int n) {
    return (x >> n) | (x << (64 - n));
}

#define G_GPU(r,i,a,b,c,d) do { \
    a += b + m[BLAKE2B_SIGMA_GPU[r][2*i]];   d = rotr64_gpu(d^a, 32); \
    c += d;                                   b = rotr64_gpu(b^c, 24); \
    a += b + m[BLAKE2B_SIGMA_GPU[r][2*i+1]]; d = rotr64_gpu(d^a, 16); \
    c += d;                                   b = rotr64_gpu(b^c, 63); \
} while(0)

__device__ void blake2b_compress_gpu(uint64_t h[8], const uint64_t m[16], uint64_t t0, uint64_t f0) {
    uint64_t v[16];
    for (int i = 0; i < 8; i++) v[i] = h[i];
    v[8]=BLAKE2B_IV_GPU[0]; v[9]=BLAKE2B_IV_GPU[1]; v[10]=BLAKE2B_IV_GPU[2]; v[11]=BLAKE2B_IV_GPU[3];
    v[12]=BLAKE2B_IV_GPU[4]^t0; v[13]=BLAKE2B_IV_GPU[5];
    v[14]=BLAKE2B_IV_GPU[6]^f0; v[15]=BLAKE2B_IV_GPU[7];

    for (int r = 0; r < 12; r++) {
        G_GPU(r,0,v[0],v[4],v[8],v[12]);  G_GPU(r,1,v[1],v[5],v[9],v[13]);
        G_GPU(r,2,v[2],v[6],v[10],v[14]); G_GPU(r,3,v[3],v[7],v[11],v[15]);
        G_GPU(r,4,v[0],v[5],v[10],v[15]); G_GPU(r,5,v[1],v[6],v[11],v[12]);
        G_GPU(r,6,v[2],v[7],v[8],v[13]);  G_GPU(r,7,v[3],v[4],v[9],v[14]);
    }
    for (int i = 0; i < 8; i++) h[i] ^= v[i] ^ v[i+8];
}

#endif
