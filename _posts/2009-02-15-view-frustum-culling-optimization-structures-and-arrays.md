---
layout: post
title: View frustum culling optimization - Structures and arrays
redirect_from: "/2009/02/15/view-frustum-culling-optimization-–-structures-and-arrays/"
---

Last week I've tried my best at optimizing the underlying functions without touching the essence of algorithm (if there was a function initially that filled a 8-vector array with AABB points, optimizations from previous post could be done in math library). It seems the strategy has to be changed.

There are several reasons why the code is still slow. One is branching. We'll cover that in the next issue though. Another one has already been discussed on this blog related to shaders – we have 4-way SIMD instructions, but we are not using them properly. For example, our point transformation function wastes 1 scalar operation per each `si_fma`, and requires additional .w component fixup after that. Our dot product function is simply horrible. Once again we're going to switch layout for intermediate data from Array of Structures to Structure of Arrays.

We have 8 AABB points, so we'll need 6 vectors – 2 vectors per each component. Do we need all 6? Nah. Since it's an AABB, we can organize stuff so that we need only 4 like this:

```
x X x X
y y Y Y
z z z z
Z Z Z Z
```

Note that vectors for x and y components are shared between two 4-point groups. Of course this sharing will go away after we transform our points to world space – but that makes it easier to generate SoA points from min/max vectors.

How do we generate them? Well, we already know the solution for Z – there is some magical `si_shufb` instruction, that worked for us before. It's time to know what exactly it does, as it can be used to generate x/y vectors too.

What `si_shufb(a, b, c)` does is it takes a/b registers, and permutes their contents using c as pattern, yielding a new value. Permutation is done at a byte level - each byte of c corresponds to a resulting byte, which is computed one of the following ways:

1. 0x0v corresponds to a byte of left operand with index v
2. 0x1v corresponds to a byte of right operand with index v
3. 0x80 corresponds to a constant 0x00
4. 0xC0 corresponds to a constant 0xFF
5. 0xE0 corresponds to a constant 0x80
6. other values result in one of the above, the exact treatment is out of the scope

This is a superset of Altivec vec_perm instruction, and can be used to do very powerful things, as we'll realize soon enough. For example, you can implement usual GPU-style swizzling like so:

```cpp
src_zxxx = si_shufb(src, src, ((qword)(vec_uint4){0x08090a0b, 0×00010203, 0×00010203, 0×00010203}));
```

First four bytes of my pattern correspond to bytes 8-11 of left argument, all other four-byte groups correspond to bytes 0-3 of left argument. This is equal to applying .zxxx swizzle. As you can probably see, the code can get very obscure if you use shuffles a lot, so I've made some helper macros:

```cpp
// shuffle helpers
#define L0 0×00010203
#define L1 0×04050607
#define L2 0x08090a0b
#define L3 0x0c0d0e0f


#define R0 0×10111213
#define R1 0×14151617
#define R2 0x18191a1b
#define R3 0x1c1d1e1f

#define SHUFFLE(l, r, x, y, z, w) si_shufb(l, r, ((qword)(vec_uint4){x, y, z, w}))

// splat helper
#define SPLAT(v, idx) si_shufb(v, v, (qword)(vec_uint4)(L ## idx))
```

SHUFFLE is for general shuffling, SPLAT is for component replication (.yyyy-like swizzles). Note that in previous post SPLAT was used in transform_point to generate .xxxx, .yyyy and .zzzz swizzles from AABB point.

Let's generate AABB points then.

```cpp
// get aabb points (SoA)
qword minmax_x = SHUFFLE(min, max, L0, R0, L0, R0); // x X x X
qword minmax_y = SHUFFLE(min, max, L1, L1, R1, R1); // y y Y Y
qword minmax_z_0 = SPLAT(min, 2); // z z z z
qword minmax_z_1 = SPLAT(max, 2); // Z Z Z Z
```

That was easy. Now if we want first 4 points, we use minmax_x, minmax_y, minmax_z_0; for the second group, we use minmax_x, minmax_y, minmax_z_1.

Now, we have 2 groups of 4 points in each, SoA style – we have to transform them to world space. It's actually quite easy – remember the first scalar version? If you've glanced at the code, you've seen a macro for computing single resulting component:

```cpp
#define COMP(c) p->c = op.x * mat->row0.c + op.y * mat->row1.c + op.z * mat->row2.c + mat->row3.c
```

As it turns out, this can be converted to SoA style multiplication almost literally – you just need to think of op.x, op.y, op.z as of vectors with 4 values of some component; mat->rowi.c has to be splatted over all components. The resulting function becomes:

```cpp
static inline void transform_points_4(qword* dest, qword x, qword y, qword z, const struct matrix43_t* mat)
{
#define COMP(c) \
    qword res_ ## c = SPLAT((qword)mat->row3, c); \
    res_ ## c = si_fma(z, SPLAT((qword)mat->row2, c), res_ ## c); \
    res_ ## c = si_fma(y, SPLAT((qword)mat->row1, c), res_ ## c); \
    res_ ## c = si_fma(x, SPLAT((qword)mat->row0, c), res_ ## c); \
    dest[c] = res_ ## c;


    COMP(0);
    COMP(1);
    COMP(2);
    
#undef COMP
}
```

Note that it's not really that much different from the scalar version, only now it transforms 4 points in 9 `si_fma` and 12 `si_shufb` instructions. We're going to transform 2 groups of points, so we'll need 18 `si_fma` instructions, `si_shufb` can be shared – luckily, the compiler does it for us so we just need to call transform_points_4 twice:

```cpp
// transform points to world space
qword points_ws_0[3];
qword points_ws_1[3];


transform_points_4(points_ws_0, minmax_x, minmax_y, minmax_z_0, transform);
transform_points_4(points_ws_1, minmax_x, minmax_y, minmax_z_1, transform);
```

Previous vectorized version required 24 `si_fma` and 24 `si_shufb`, plus 8 correcting `si_selb` (to be fair, it could be actually optimized to require 6 `si_shufb` + 8 `si_selb`, but it's still not a win over SoA). Note that 18 `si_fma` + 12 `si_shufb` does not mean 30 cycles. SPUs are capable of dual-issuing some instructions – there are two groups of instructions, one group runs at even pipeline, another one – at odd. `si_fma` and `si_shufb` run on different pipelines, so the net throughput will be closer to 18 cycles (slightly larger than that if `si_shufb` latency can't be hidden).

Now all that's left is to calculate dot products with a plane. Of course we'll have to calculate them 4 at a time. But wait – in our case execution of inner loop terminated after the first iteration. So previously we were doing only one (albeit ugly) dot product, and now we're doing 4, or even 8! Isn't that a little bit excessive? Well, that's not – but we'll save a more detailed explanation for the later post, for now let the results speak for themselves.

In order to calculate 4 dot products, we'll make a helper function:

```cpp
static inline qword dot4(qword v, qword x, qword y, qword z)
{
    qword result = SPLAT(v, 3);


    result = si_fma(SPLAT(v, 2), z, result);
    result = si_fma(SPLAT(v, 1), y, result);
    result = si_fma(SPLAT(v, 0), x, result);

    return result;
}
```

And call it twice. Again, we'll be doing four splats twice, but compiler is smart enough to eliminate this. After that we'll have to compare all 8 dot products with zero, and return false if all of those are negative.

```cpp
// for each plane...
for (int i = 0; i < 6; ++i)
{
    qword plane = (qword)frustum->planes[i];


    // calculate 8 dot products
    qword dp0 = dot4(plane, points_ws_0[0], points_ws_0[1], points_ws_0[2]);
    qword dp1 = dot4(plane, points_ws_1[0], points_ws_1[1], points_ws_1[2]);

    // get signs
    qword dp0neg = si_fcgt((qword)(0), dp0);
    qword dp1neg = si_fcgt((qword)(0), dp1);

    if (si_to_uint(si_gb(si_and(dp0neg, dp1neg))) == 15)
    {
        return false;
    }
}
```

`si_fcgt` is just a floating-point greater comparison; I'm abusing the fact that 0.0f is represented as a vector with all bytes equal to zero here. `si_fcgt` operates like SSE comparisons and returns 0xffffffff for elements where the comparison result is true, and 0 for others. After that I and the results together, and then use `si_gb` instruction to gather bits of results. `si_gb` takes least significant bit from each element and inserts it into corresponding bit of the result; we get a 4-bit value in preferred slot, everything else is zeroed out. If it's equal to 15, then `si_and` returned a mask where all elements are 0xffffffff, which means that all dot products are less than zero, so the box is outside.

Note that `si_gb` is like `_mm_movemask_ps`, only it takes least significant bits instead of most significant – in case of SSE, we don't need to do comparisons. We can avoid comparisons here by anding dot products directly, and then moving the sign bit to least significant bit (it can be done by rotating each element 1 bit to the left, that's achieved by `si_roti(v, 1)`), but this is slightly slower, so we won't do it.

Now, the results. The code runs at 376 cycles, which is more than 2 times faster than the previous version, and almost 4 times faster than the original. This speedup is partially because we're doing things more efficiently, partially because we got rid of branches; we'll discuss this the next week. A million calls takes 117 msec, which is still worse than x86 results – but it's not the end of the story. Astonishingly, applying exactly the same optimizations to SSE code results in 81 msec for gcc (which is 30% faster than naively vectorized version), and in 104 msec for msvc8 (which is 40% slower!).

The fastest version is still produced by msvc8 from previous version. This should not be very surprising, as we changed inner loop from performing one dot-product to performing 8 at once, so that shows. We can optimize it in this case by adding early out – after we compute first 4 dot products, we'll check if all of them are positive; if some of them are not, we can safely skip additional 4 dot products and continue to the next iteration. It results in 87 ms for msvc8 and 65 ms for gcc, with gcc-compiled SoA finally being faster than all previous approaches. Of course, this is a worst case for SoA – in case inner loops actually did not terminate after first iteration the performance gain would be greater. Adding the same optimization to SPU code makes it slightly (by 3 cycles) slower; the penalty is tens of cycles if the early out does not happen and we have to compute all 8 dot products, so it's definitely not worth it.

The current source can be [grabbed here](https://gist.github.com/zeux/d0b700f0e8e700bec5c8).

That's all for now – stay tuned for the next weekend's post!

View Frustum Culling series contents:

>1. [Introduction](/2009/01/31/view-frustum-culling-optimization-introduction/)
2. [Vectorize me](/2009/02/08/view-frustum-culling-optimization-vectorize-me/)
3. **Structures and arrays**
4. [Never let me branch](/2009/03/01/view-frustum-culling-optimization-never-let-me-branch/)
5. [Representation matters](/2009/03/15/view-frustum-culling-optimization-representation-matters/)
6. [Balancing the pipes](/2010/09/11/view-frustum-culling-optimization-balancing-the-pipes/)
