---
layout: post
title: VPEXPANDB on NEON with Z3
excerpt_separator: <!--more-->
---

When working on vertex compressor for [meshoptimizer](https://github.com/zeux/meshoptimizer) in 2018, one of the goals was to make a bitstream that can be decompressed using (short) SIMD vector operations. This led to a host of design decisions in terms of how the data is structured, and some challenges when mapping the decoder flow onto various SIMD architectures. The most significant issue has to do with implementing an operation that often doesn't have a straightforward implementation: byte expansion.

<!--more-->

Without going into the [details of the bitstream format](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_meshopt_compression/README.md#mode-0-attributes), we get a byte mask (with 16 bit elements, one per each vector byte) from an earlier stage of decoding process, and for every 1 in the mask we need to read a byte from the input stream and place that into the corresponding byte in the SIMD register. For example, a mask with three bits, `0000_0100_0011_0000`, leads to reading three bytes from the current position in the stream, creating a vector `xxxxxxxx_xxAAxxxx_xxxxBBCC_xxxx`, and advancing the stream position by 3.

# Baseline implementation: SSSE3/AVX-512

The bitstream was designed to be quickly decodable on mainstream Intel/AMD processors, so there must be an efficient lowering for some reasonable version of SSE instruction set. By structuring the bitstream to make sure we can always read 16 bytes from valid positions in the stream, we can load 16 bytes after the current position in the stream, but we then need to move the bytes corresponding to the ones set in the mask in their right locations. The general way to do this is to use `PSHUFB` (SSSE3) instruction which can perform an arbitrary byte shuffle on the source 16-byte register, yielding any 16-byte permutation as a result.

Computing the shuffle masks from bit masks is difficult to do efficiently, so instead we'll precompute the masks and store them in a table. There's a grand total of 2<sup>16</sup> masks which would require a 1MB lookup table, which is not very space or performance efficient, but we can instead precompute the table for an 8-bit mask, which requires just 4KB of space. From there on we need to be able to synthesize a full shuffle mask, and the number of bits set in the first half determines the offset that the second mask should pull data from: for example, if the first 8 bits have 5 bits set, and the second 8 bits only have one, then the corresponding byte in the second half of the vector needs to be read from an offset +5 in the input stream.

Importantly, the mask originally comes as a result of vectorized comparisons, with one byte for each comparison result (containing `0b11111111` or `0b00000000`); however we can easily convert it to a 16-bit mask in a general purpose register using `PMOVMSKB` (SSE) instruction.

To compute the offset we thus need to have an 8-bit population count - something that's available as an instruction on modern x64 CPUs, but something that's also easy to precompute a 256-byte table for. Conveniently, to figure out how much to advance the stream after reading the data, we also need the population count - we need to shift the position by the total number of bits set in the 16-bit masks, which can be computed as a sum of two 8-bit population counts.

Overall, this requires a bit of setup, but is reasonably efficient, with the following pseudo-code:

```c++
static uint8_t kTableShuffle[256][8]; // 8-bit shuffle masks
static uint8_t kTableCount[256]; // 8-bit population counts

// mask is __m128i

int mask16 = _mm_movemask_epi8(mask);
uint8_t mask0 = uint8_t(mask16 & 255);
uint8_t mask1 = uint8_t(mask16 >> 8);

__m128i sm0 = _mm_loadl_epi64(&kTableShuffle[mask0]);
__m128i sm1 = _mm_loadl_epi64(&kTableShuffle[mask1]);
__m128i sm1off = _mm_set1_epi8(kTableCount[mask0]);

__m128i sm1r = _mm_add_epi8(sm1, sm1off);
__m128i smfull = _mm_unpacklo_epi64(sm0, sm1r);

__m128i data16 = _mm_loadu_si128(data);
__m128i result = _mm_shuffle_epi8(data16, smfull);

data += kDecodeBytesGroupCount[mask0] + kDecodeBytesGroupCount[mask1];
```

This approach works well on Intel/AMD hardware, however it does take a bunch of setup - to compute the shuffle mask from the two halves of the 16-bit mask, we need to load two halves of it from memory and reconstruct the full mask with ~4 additional instructions. I didn't know about this initially, but byte expansion is very useful in contexts like this and so AVX-512 includes a dedicated instruction that matches our desired semantics perfectly, VPEXPANDB, which allows us to eliminate all the setup and replace all of the above with:

```c++
// mask is __mmask16

__m128i data16 = _mm_loadu_si128(data);
__m128i result = _mm_mask_expand_epi8(_mm_setzero_si128(), mask, data16);

data += _mm_popcnt_u32(mask);
```

> Note: AVX-512 has other fantastic instructions that help in other areas of the decoder, such as VPMULTISHIFTQB; overall, using AVX-512 allows us to make the decoder >10% faster on an Intel CPU - all this while still using 128 bit SIMD vectors, and as such without the risk for associated frequency adjustments. Unfortunately, AVX-512 is not widely supported but I'm looking forward to benchmarking this on Zen4 in the future.

# NEON emulation

Unfortunately, NEON doesn't have anything as powerful as byte expansion instructions, so we need to use something similar to the baseline SSE implementation. Most instructions translate without issues, and shuffle can be implemented using table lookup instruction `TBL`, but `PMOVMSKB` presents a challenge.

This problem comes up frequently when porting SSE code to NEON, as `PMOVMSKB` is incredibly useful in many algorithms; until recently, a reasonable generic alternative involved using horizontal add instruction (only available on AArch64). In our case the problem is made a little bit simpler - instead of a 16-bit mask we actually need two 8-bit masks, as we're going to use them to compute load offsets anyway, and we know that the input is a 16-byte register with each byte containing all 1s or 0s, which simplifies the emulation and makes it pretty reasonable:

```c++
static const uint8_t kByteMask[16] = {1, 2, 4, 8, 16, 32, 64, 128, 1, 2, 4, 8, 16, 32, 64, 128};
 
uint8x16_t byte_mask = vld1q_u8(kByteMask);
uint8x16_t masked = vandq_u8(mask, byte_mask);

uint8_t mask0 = vaddv_u8(vget_low_u8(masked));
uint8_t mask1 = vaddv_u8(vget_high_u8(masked));
```

However, it still requires two horizontal adds and horizontal adds aren't particularly cheap: 4 cycles of latency per Cortex-X2 optimization guide. [A recent blog post from Google Cloud team](https://community.arm.com/arm-community-blogs/b/infrastructure-solutions-blog/posts/porting-x86-vector-bitmask-optimizations-to-arm-neon) presents a more efficient replacement for many uses of `PMOVMSKB` by using a narrowing shift, which allows to create a 64-bit mask from a 128-bit vector, and then change the rest of the algorithm to adjust the operations to expect the bits in the right places. This results in significant speedups on a number of algorithms - unfortunately, it's less useful for our case, because we ultimately need two 8-bit masks instead of a single 64-bit one.

A further complication here is that horizontal adds aren't universally supported. On ARMv7, these are not available and a longer instruction sequence using paired adds must be used instead; additionally, [Microsoft does not implement horizontal adds](https://developercommunity.visualstudio.com/comments/446737/view.html) in their NEON headers, so when targeting Windows on ARM we again can't use the most efficient sequence.

# Sometimes all it takes is a MUL

For a while, the above is the version that was used in native NEON builds. The same issue had to be solved in the WebAssembly version of the decoder - while WebAssembly SIMD proposal now implements [i8x16.bitmask instruction](https://github.com/WebAssembly/simd/pull/201), the earlier versions of the proposal didn't have it (the shuffle instruction was also initially absent, which would have put the SIMD decoder at risk, but [v8x16.swizzle
instruction](https://github.com/WebAssembly/simd/pull/71) was added relatively early - as an aside, WebAssembly SIMD proposal process was very enjoyable).

Because of this, the WebAssembly version used a rather slow scalar fallback that used many 64-bit ors and shifts to move the bits to the right places. Before I got around to replacing it with `i8x16.bitmask`, someone named `0b0000000000000` [shared a much more efficient, if cryptic, solution with me](https://twitter.com/0b0000000000000/status/1376568414634840065):

```c++
usize MoveMask(U8x16 m) {
  alignas(16) uint64 xy[2];
  wasm_v128_store(xy, m);

  constexpr uint64 magic = 0x103070F1F3F80ULL;
  uint64 lo = ((xy[0] * magic) >> 56);
  uint64 hi = ((xy[1] * magic) >> 48) & 0xFF00;
  return (hi + lo);
}
```

Since we need 8-bit masks anyway, this results in the following NEON code:

```c++
const uint64_t magic = 0x000103070f1f3f80ull;

uint64x2_t mask2 = vreinterpretq_u64_u8(mask);

mask0 = uint8_t((vgetq_lane_u64(mask2, 0) * magic) >> 56);
mask1 = uint8_t((vgetq_lane_u64(mask2, 1) * magic) >> 56);
```

It does assume that 64-bit multiplication is efficient, however on ARMv7 this ends up being about the same speed as the less efficient NEON implementation with paired adds, and it's consistently faster compared to horizontal adds on AArch64 (on the entire algorithm, of which all of the above is only a part of, it results in ~2% faster decoding on Apple M2 and ~3% faster decoding on Amazon Graviton 2; it also compiles into the same efficient code on MSVC where the lack of horizontal adds is not an issue anymore).

Ok, but... why does this code even work? Where do we get the magic constant from? And how did `0b0000000000000` arrive at this idea?

# Enter Z3

The fact that the multiplication gets us what we want is possible to see if we look at what happens when we multiply the magic constant by 255 - since all input bytes are either 00000000 or 11111111, the multiplication result is the sum of `(255*magic) << (k*8)` for each k that signifies a non-zero input byte:

```c
0x000103070f1f3f80 * 255 = 0x0102040810204080
```

We can see that the result has one bit set in each resulting byte; this means that this value can be shifted by any multiple of 8 and the resulting values can be OR'd together (which is the same as adding them because there's no carry involved); doing so results in the top 8 bits of the value corresponding to the values of `k` where the byte was non-zero - exactly what we need to get our bitmask!

There are a few ways to derive this in reverse; I'm not sure what exact method `0b0000000000000` used, however we can simultaneously devise the magic constant, and validate that the multiplication gives us what we want, by using [Z3 theorem prover](https://github.com/Z3Prover/z3).

A full introduction to Z3 is neither inside the scope of this article nor [is it mine to give](https://theory.stanford.edu/~nikolaj/programmingz3.html) - however, what Z3 allows us to do in this case is to give the solver our problem statement:

- Given a 64-bit integer `x`, such that every byte of `x` is either `11111111` or `00000000`
- Given a 64-bit integer `y` that is computed as `y = x * magic`
- Ensure that each of the top 8 bits of `y` is set iff the corresponding byte of `x` is `11111111`

We can then give Z3 a fixed `magic` value and verify that this holds for every `x` - something that we could check by bruteforcing all 256 permutations of `x` in this case, but that can be impractical in some other cases - or, instead, ask Z3 to find a `magic` value that satisfies the conditions for any `x`, or report to us that it does not exist.

Z3 can be used via a SMT interface, but I'd recommend avoiding it and using Python Z3 module instead. With the following short program, in a couple seconds the solver gives us the answer:

```python
from z3 import *

def same8(v):
  return Or(v == 0, v == 0xff)

magic = BitVec('magic', 64)

x = BitVec('x', 64)
y = x * magic

solve(ForAll([x],
  Or(
    # x has bytes that aren't equal to 0xff or 0x00
    Not(And([same8((x >> (i * 8)) & 0xff) for i in range(8)])),
    # every byte of x has bits that are equal to a corresponding top bit of y
    And([(x >> (i * 8)) & 1 == (y >> (56 + i)) & 1 for i in range(8)])
)))
```

```sh
$ python3 bitmask.py 
[magic = 284803830071168]
```

We can also ask the solver to find the constant for a slightly different version of the problem - for example, if all bytes are either 0 or 1, we can just tweak the `same8` function and have the solver give us the new constant, 0x102040810204080, which we have seen before. Or, to see something that is harder to get the intuition for, if we change the code to remove the `same8` condition and just expect to find a constant that, after multiplication, moves the top bits of every byte to the top 8 bits (for a more general emulation of movemask), Z3 will print `no solution` - for any magic constant, given arbitrary input bits due to carry propagation there's some value of `x` for which the equality doesn't hold.

Z3 is probably not the best tool for every problem like this - you need to know the shape of the solution you're looking for, and in certain cases the problem constraints are such that a solution simply does not exist. However, it's surprisingly versatile; it can be used to validate optimizations, discover vulnerabilities in hash functions, and that's before you venture outside of the domain of bit vecs and explore the full power of predicate logic.

# Removing the shift

The solution we've came up with so far requires two 64-bit multiplies and a shift. Is that the best we can do, or can we try to remove the shift?

Well, we can't remove the shift as it is - Z3 will happily tell us that it's impossible to find a magic constant that will move bits from the end of a number into the beginning (although it's also obvious without Z3). However, by using a 128-bit multiplication instruction, we can adjust the magic constant such that the 8 bit result lands into the top 64-bit half of the result. This can be accessed conveniently on GCC/clang with the `__int128` extension, resulting in the following code:

```c++
const unsigned __int128 magic = 0x0103070f1f3f8000ull;

uint64x2_t mask2 = vreinterpretq_u64_u8(mask);

mask0 = uint8_t((vgetq_lane_u64(mask2, 0) * magic) >> 64);
mask1 = uint8_t((vgetq_lane_u64(mask2, 1) * magic) >> 64);
```

The shift instruction gets optimized away, resulting in just two `UMULH` instructions in addition to vector->scalar moves, and an extra ~1% throughput improvement on Apple M2. However, UMULH may not be as fast as the regular multiplication; Cortex-X2 optimization guide lists it as having 1 extra cycle of latency, and using this on Amazon Graviton 2 actually results in ~2% throughput reduction. On MSVC, the same optimization requires using `_umul128` intrinsic so overall this solution is unfortunately not as portable as the original optimization.

# Conclusion

These few lines of meshoptimizer code had an interesting journey - starting with an SSSE3 implementation, which was the mental model I had at the time, discovering that the core idea, byte expansion, is so common that of course AVX-512 has a dedicated instruction, wrestling with NEON emulation of movemask, enhancing WebAssembly SIMD proposal (this snippet was one of the use cases for addition of swizzle and bitmask) and finally discovering that in some cases, a plain old 64-bit multiply is as powerful as a SIMD instruction or two.

The performance gains quoted here may seem small - but as often happens with performance tuning, to get solid wins for the entire algorithm you need to optimize all individual parts to get cumulative gains! Getting a few % of throughput gains on the entire algorithm merely from tuning something as small as movemask emulation is pretty exciting from that perspective.

To reproduce the performance measurements, you can clone meshoptimizer from GitHub and run `make config=release codecbench && ./codecbench`; the relevant throughput measurement is the first one (vtx), and the source code is in `src/vertexcodec.cpp`, most notably `decodeBytesGroupSimd` function.

While the specific code snippets presented here are probably not as generally useful unless you're writing a SIMD-friendly compressor, I hope that the introduction to Z3 motivates other people to use theorem provers more, both to discover numeric properties that might not be obvious at first glance, and to validate code transformations. The single program shared here likely represents a tiny fraction of Z3 power and utility - feel free to share other fun things you've used Z3 for in the comments!
