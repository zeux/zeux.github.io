---
layout: post
title: View frustum culling optimization - Vectorize me
redirect_from: "/2009/02/08/view-frustum-culling-optimization-–-vectorize-me/"
---

Last week I've posted some teaser code that will be transformed several times, each time yielding a faster one - “faster” in terms of “taking less cycles for the test case on SPU”. A lot of you probably looked at my admittedly lame excuse for, uhm, math library and want to ask – why the hell do you use scalar code? We're going to address the problem in this issue. This is probably a no-brainer for most of my readers, but this is a good opportunity to introduce some important points about SPUs and introduce some actual vector code before diving further.

But first, we need some background information on SPUs. For the todays post, there is a single important thing to know about SPUs – they are vector processors. Unlike most common architectures (PowerPC, x86, etc.), SPUs have only one register set, which consists of 128-bit vectors. The current implementation has 128 of them, and each register is treated differently in different instructions (you have different instructions for adding two registers as if they contained 4 single precision floats or 16 8-bit integers). The important point is that, while you can compile a piece of scalar code for SPU, it's going to use vector registers and vector instructions; the scalar values are assumed to reside in so called preferred slot – for our current needs, we only care about preferred slot for 32-bit scalars, which is the first one (index 0). Register components are numbered from least address in memory onwards, which is really refreshing after SSE little-endian madness.

This actually goes slightly further – not only all registers are 16-byte, but all memory accesses (I'm obviously talking about local storage access here – though the same mostly applies to DMA; I'll be probably discussing something DMA-related after VFC series ends) should be – you can only load/store a full register's worth of data from/to 16b-aligned location. Of course, you can implement a workaround for scalar values – for loading, load the 16 byte chunk the value is in, and then shift it in the register so that it resides in preferred slot; for saving, load the destination 16 byte chunk, insert desired value in it via shifting/masking, and then store the whole chunk back. In fact, this is exactly what compiler does. Moreover, for our struct vector3_t, loading three components in registers will generate such load/shift code for every component, since compiler does not know the alignment (the whole vector could be in one 16 byte chunk, or it could be split in half between any two components).

In order to leverage available power, we have to use available vector instructions. SPUs have a custom instruction set, which is [well documented](http://www-01.ibm.com/chips/techlib/techlib.nsf/techdocs/76CA6C7304210F3987257060006F2C44). For now, it's important to know that there is a fused multiply-add instruction, which computes a*b+c, and there is no dot product instruction (or floating-point horizontal sum, for that matter). In fact, on current generation of consoles, XBox360 is pretty unique in that it does have a dot product instruction.

So, our code is bad because we have lots of scalar memory accesses and lots of scalar operations, which are not using available processing power properly. Let's change this!

One option is to code in assembly; this has obvious benefits and obvious pitfalls, and we'll use intrinsics instead. For SPUs, we have three intrinsics sets to choose from – Altivec emulated (vec_*, the same as we use on PPU), generic type-aware (spu_*) and low-level (si_*). GCC compiler provides several vector types as language extensions (some examples are 'vector float' and 'vector unsigned char', which correspond to 4 32-bit floats and 16 8-bit unsigned integers, respectively); a single spu_* instruction translates to different assembly instructions depending on a type, while si_* instructions operate on abstract register (it has type 'qword', which corresponds to 'vector signed char') – i.e. to add two vectors, you can use spu_add(v1, v2) with typed registers, or one of si_a, si_ah, si_fa, si_dfa to add registers as 32-bit integer, 16-bit integer, 32-bit floating point or 64-bit floating point, respectively. We'll be using si_* family for several reasons – one, they map to assembly exactly, so getting used to si_* instructions make it much easier to read (and possibly write) actual assembly, which is very useful when debugging or optimizing code, two, spu_* family is not available in C, as it uses function overloading. I'll explain specific intrinsics as we start using them.

First thing we'll do is dispose of redundant vector3_t/plane_t structures (in a real math library, we won't do this of course, but this is a sample), and replace them with qwords. This way, everything will be properly aligned, and we won't need to write load/store instructions ourselves (as opposed to something like `struct vector3_t { float v[4]; }`).

Then, we have to generate an array of points. Each resulting point is a combination of aabb->min and aabb->max – for each component we select either minimum or maximum value. As it turns out, there is the instruction that does exactly that – it accepts two registers with actual values and a third one with pattern; for each bit in pattern, it takes left bit for 0 and right bit for 1 – it's equivalent to `(a & ~c) | (b & c)`, only in one instruction.

The code becomes

```cpp
// get aabb points
qword points[] =
{
    min,                                                   // x y z
    si_selb(min, max, ((qword)(vec_uint4){~0, 0, 0, 0})),  // X y z
    si_selb(min, max, ((qword)(vec_uint4){~0, ~0, 0, 0})), // X Y z
    si_selb(min, max, ((qword)(vec_uint4){0, ~0, 0, 0})),  // x Y z


    si_selb(min, max, ((qword)(vec_uint4){0, 0, ~0, 0})),  // x y Z
    si_selb(min, max, ((qword)(vec_uint4){~0, 0, ~0, 0})), // X y Z
    max,                                                   // X Y Z
    si_selb(min, max, ((qword)(vec_uint4){0, ~0, ~0, 0})), // x Y Z
};
```

Note that I'm using another gcc extension to form vector constants. This is very convenient and does not exhibit any unexpected penalties (the expected ones being additional constant storage and additional instructions to load them).

Then we have transform_point; we'll have to transform a given vector by matrix, and additionally to stuff a 1.0f in .w component of the result in order for the following dot product to work (I sort of hacked this in scalar version by using dot(vector3, vector4)). Vector-matrix SIMD multiplication is very well-known – we'll need add/multiply instructions, and ability to replicate a vector element across the whole vector. For this we'll use a si_shufb instruction – I'll leave the detailed explanation for the next issue, for now just assume that it works as desired :)

```cpp
static inline qword transform_point(qword p, const struct matrix43_t* mat)
{
    qword px = si_shufb(p, p, (qword)(vec_uint4)(0×00010203));
    qword py = si_shufb(p, p, (qword)(vec_uint4)(0×04050607));
    qword pz = si_shufb(p, p, (qword)(vec_uint4)(0x08090a0b));


    qword result = (qword)mat->row3;

    result = si_fma(pz, (qword)mat->row2, result);
    result = si_fma(py, (qword)mat->row1, result);
    result = si_fma(px, (qword)mat->row0, result);

    result = si_selb(result, ((qword)(vec_float4){0, 0, 0, 1}), ((qword)(vec_uint4){0, 0, 0, ~0}));

    return result;
}
```

We replicate point components, yielding three vectors, and then compute transformation result using si_fma (fused multiply-add; returns a * b + c) instruction. After that we combine it via selb to get 1.0f in the last component.  
  
Note that in this case we are fortunate to have our matrix laid out as it is – another layout would force us to transpose it prior to further computations to make vectorization possible. In scalar case, the layout does not make any difference.

Finally, we'll have to compute dot product. As there is no dedicated dot product instruction, we'll have to emulate it, which is not pretty.

```cpp
static inline float dot(qword lhs, qword rhs)
{
    qword mul = si_fm(lhs, rhs);


    // two pairs of sums
    qword mul_zwxy = si_rotqbyi(mul, 8);
    qword sum_2 = si_fa(mul, mul_zwxy);

    // single sum
    qword sum_2y = si_rotqbyi(sum_2, 4);
    qword sum_1 = si_fa(sum_2, sum_2y);

    // return result
    return si_to_float(sum_1);
}
```

First we get a component-wise multiplication result by using fm; then we'll have to compute horizontal sum. First we sum odd/even components together separately. For that, we rotate our register to the left by 8 bytes (si_rotqbyi) and add with the original. After that, we rotate the result left by 4 bytes (to get the second sum at the preferred slot) and add with the original.

For mul = (1, 2, 3, 4), we get the following values:

```
mul_zwxy = 3 4 1 2
sum_2 = 4 6 4 6
sum_2y = 6 4 6 4
sum_1 = 10 10 10 10
```

The result is converted to float via si_to_float cast intrinsic – it just tells the compiler to reinterpret result as if it was a float (actual scalar value is assumed to be in preferred slot), this usually does not generate any additional instructions.

Note that in case of SPU, there is only one register set – thus there is no penalty for such vector/scalar conversion. This code will not perform very well for other architectures – for example, on PowerPC converting vector to float in this way causes a LHS (Load Hit Store; it occurs when you read from the same address you just wrote into) because vector should be stored to stack to load vector element into float register; LHS causes a huge stall (40-50 cycles) and thus performance can be compromised here. For this reason, if your PPU/VMX math library has an optimized dot product function that returns float, don't use it in performance critical code – find another approach. It's interesting that if you think about it, you don't need dot products that much, as I'll show in the next issue.

Anyway, the current code runs at 820 cycles, which is 50% faster than scalar code. This equals to approximately 256 msec per million calls, the corresponding numbers for x86 being 136 msec for gcc and 74 msec for msvc8. Once x86 code is changed so that dot() function returns its result in a vector register, and resulting sign is then analyzed via `_mm_movemask_ps` instruction, timings change to 126/68, respectively. We've made some progress there, but our SPU implementation is still far from x86 in terms of speed though we're using the same techniques. I promise that the end result will be much more pleasing though :)

The current source can be [grabbed here](https://gist.github.com/zeux/218be90b7ce38c81777e).

That's all for now – stay tuned for the next weekend's post!

View Frustum Culling series contents:

>1. [Introduction](/2009/01/31/view-frustum-culling-optimization-introduction/)
2. **Vectorize me**
3. [Structures and arrays](/2009/02/15/view-frustum-culling-optimization-structures-and-arrays/)
4. [Never let me branch](/2009/03/01/view-frustum-culling-optimization-never-let-me-branch/)
5. [Representation matters](/2009/03/15/view-frustum-culling-optimization-representation-matters/)
6. [Balancing the pipes](/2010/09/11/view-frustum-culling-optimization-balancing-the-pipes/)