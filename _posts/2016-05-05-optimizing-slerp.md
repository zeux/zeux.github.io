---
layout: post
title: Optimizing slerp
---

In the last article ([Approximating slerp](/2015/07/23/approximating-slerp/)) we discussed a need for a fast and reasonably precise quaternion interpolation method. By looking at the data we arrived at two improvements to `nlerp`, a less precise one and a more precise one. Let's look at their implementations and performance!

We will implement three functions - `nlerp`, which is the baseline normalized linear interpolation, `fnlerp`, which will use the simpler approximation for the interpolation parameter, and `onlerp` which will use the more exact approximation from the previous article. While implementing these functions seems trivial given the results of the hard work, we will focus on vectorized version using SSE2. This post demonstrates what is probably the most important way to vectorize computations - it's frequently pretty simple to implement, yields very good results and scales to arbitrary SIMD width.

## Scalar first

Perhaps counter-intuitively, our path to SIMD implementation will start at a scalar one. We will not just use it for comparisons - we will actually directly convert it to a SIMD version. Since we derived all the coefficients and equations in the last article, all implementations are pretty straightforward; here's one of them:

```cpp
Q onlerp(Q l, Q r, float t)
{
    float ca = dot(l, r);

    float d = fabsf(ca);
    float A = 1.0904f + d * (-3.2452f + d * (3.55645f - d * 1.43519f));
    float B = 0.848013f + d * (-1.06021f + d * 0.215638f);
    float k = A * (t - 0.5f) * (t - 0.5f) + B;
    float ot = t + t * (t - 0.5f) * (t - 1) * k;

    return unit(lerp(l, r, 1 - ot, ca > 0 ? ot : -ot));
}
```

As you can see, this is similar to `nlerp` - it handles quaternion double-cover and normalizes the quaternion after interpolating - but instead of using `t` it tries to find a better fit by adjusting it using approximation we derived. Note that, similarly to `nlerp` but unlike `slerp` this function does not have a singularity at `t=0`.

This is more expensive to compute than `nlerp`; note though that some of the extra computations only depend on `t` and thus can be performed once for cases where you have to interpolate a lot of quaternions with the same `t` (which is the case for some types of animation sampling).

Instead of measuring performance, let's look at the performance modeled by [Intel Architecture Code Analyzer](https://software.intel.com/en-us/articles/intel-architecture-code-analyzer) which is a great tool that allows you to place special markers in your code and look at the approximate scheduling on the target Intel CPU of your choice. These numbers are approximate but they let me skip setting up the benchmark and interpreting the timing results. [^1]

To model performance, we will look at a loop that reads two streams of data - one quaternion stream and one stream with interpolation coefficients - performs the interpolation from the base quaternion and writes the result into the fourth stream. Adding the IACA markers is pretty straightforward:

```cpp
static void run(Q* dest, const Q& l, const Q* r, const float* t, size_t size, F f)
{
    for (size_t i = 0; i < size; ++i)
    {
        IACA_START
        dest[i] = f(l, r[i], t[i]);
        IACA_END;
    }
}
```

We'll be measuring the throughput, not the latency, since we're assuming that you're running the interpolation many times on big arrays of data. And here are the results:

| Function | Cycles/element
|----------|------
| nlerp | 14.15
| fnlerp | 18.35
| onlerp | 22.95

As you can see, while our approximations add some overhead the functions remain relatively fast. Why is there no `slerp` in the table? Ah, that's because IACA can't really measure performance of code that uses standard trigonometric instructions. They are implemented in the standard library and the implementation is not being inlined so there's no code to analyze! Anecdotally, `slerp` is about 3x slower than `onlerp` in this test, although the results will vary greatly based on the architecture and the standard library implementations (e.g. with x87 FPU the difference should be much more dramatic).

## When's the last time you had ONE value to interpolate?

Now let's outline the process that we will use to vectorize the code. We always start with the scalar function. Now, the scalar function does the scalar transformation once - in our case it performs a quaternion interpolation on two quaternions. The vectorized implementation will work on N items by performing the scalar transformation N times, where N is usually the SIMD width (4 in our case since SSE2 registers are 4 floats wide).

The data flow of the vectorized function will be otherwise the same - instead of using `float` variables, we will use variables of vector type; whenever a scalar function performed the multiplication between two floats we will multiply two SIMD registers. Here's how you convert a quaternion dot product:

```cpp
// ca = l.x * r.x + l.y * r.y + l.z * r.z + l.w * r.w
__m128 ca =
    _mm_add_ps(
        _mm_add_ps(_mm_mul_ps(lX, rX), _mm_mul_ps(lY, rY)),
        _mm_add_ps(_mm_mul_ps(lZ, rZ), _mm_mul_ps(lW, rW)));
```

Note that this is the exact same computation we performed in the scalar version - but since we're using SIMD registers we're doing 4 dot products at once. Also in this instance we're grouping the operands a bit differently for addition to reduce latency a bit - since addition is left-associative, `a + b + c + d` is evaluated as `((a + b) + c) + d`, which creates dependencies between all addition operations; `(a + b) + (c + d)` is in some cases faster.

Whenever there is a branch in the scalar version, we have a problem - we're essentially running N computations on the data in parallel, and if the branch condition is different for different computations then we'd like to execute different SIMD instructions on different parts of the registers, but most SIMD instruction sets can't do that. Instead, we'll remove all branches by computing both sides of the branch and then selecting the result using bitwise operators; here's an example [^2]:

```cpp
// rt = ca > 0 ? ot : -ot
__m128 rt0 = ot;
__m128 rt1 = _mm_sub_ps(_mm_setzero_ps(), ot);
__m128 rtMask = _mm_cmpgt_ps(ca, _mm_setzero_ps());
__m128 rt = _mm_or_ps(_mm_andnot_ps(rtMask, rt0), _mm_and_ps(rtMask, rt1));
```

This is mostly straightforward except for the fact that SSE2 does not have a bitwise select so we have to emulate it using primitive bitwise operations.

With all the computations out of the way, the final problem is loading and saving the data. What we are using here is essentially SoA (structures of arrays) layout of data - instead of putting all 4 components of a quaternion in a SSE register, we're putting 4 X components in a register. Frequently the data is laid out using AoS (arrays of structures). In some cases changing layout of your data in memory is more optimal but for now we will just convert from one to the other by loading 4 quaternions into 4 SSE registers and then transposing the resulting 4x4 "matrix" - columns become rows, rows become columns, and individual components are nicely grouped in one register:

```cpp
__m128 lX = _mm_load_ps(&l[0].x);
__m128 lY = _mm_load_ps(&l[1].x);
__m128 lZ = _mm_load_ps(&l[2].x);
__m128 lW = _mm_load_ps(&l[3].x);

_MM_TRANSPOSE4_PS(lX, lY, lZ, lW);
```

After we compute the results, we can use the same transpose macro (`_MM_TRANSPOSE4_PS` is a standard SSE2 macro that expands into multiple permutation instructions) to convert results to AoS to store them. When I'm vectorizing code I usually start like this and then gradually convert more and more internal structures to use SoA layout internally while keeping SoA <-> AoS conversions at the interface.

## AoSoA

One important digression is that usually people think of big arrays of data when they see the term "SoA" - this is not the case here! A technique that's almost always better is to use so called "block SoA", where your arrays are always pretty short - e.g. 4/8 elements -
and your actual data is composed of arrays of these structures. Some people refer to this as AoSoA - array of structures of arrays.

For example, given this structure:

```cpp
struct ContactLimiter
{
    Vector2 normalProjector1;
    Vector2 normalProjector2;
    float angularProjector1;
    float angularProjector2;
};

std::vector<ContactLimiter> limiters;
```

Here's how you would convert it to AoSoA:

```cpp
template <int N>
struct ContactLimiter
{
    float normalProjector1X[N];
    float normalProjector1Y[N];
    float normalProjector2X[N];
    float normalProjector2Y[N];
    float angularProjector1[N];
    float angularProjector2[N];
}

std::vector<ContactLimiter<4>> limiters;
```

That way you can write a function that processes 4 limiters at a time without having to go between AoS and SoA. Naturally, all of this means that you have to face extra complexity when dealing with data sizes that are not divisible by your group width. Two frequently used options are:

1. Process as much data as you can (`size / N`) in blocks of N using SIMD; process the rest using scalar code
2. Pad the arrays with dummy data until its size is divisible by N; don't use the extra few items at the end

Option 2 is usually best since it uses just one version of the code and is easier to implement; however, it requires the processing to not have any side effects which could be problematic in certain cases.

## Finishing touches

With the major structural work out of the way, the final two issues to tackle are quaternion double-cover and normalization.

Double-cover is pretty straightforward to handle - in fact, there's code above that shows what we can do - however, the comparisons and selects and negates are all excessive for the simple use case that we have - it's sufficient to use a few bitwise operations to negate a value if another value is negative since in floating-point sign is just a bit:
 
```cpp
// rt = ca > 0 ? ot : -ot
__m128 signMask = _mm_castsi128_ps(_mm_set1_epi32(0x80000000));
__m128 rt = _mm_xor_ps(ot, _mm_and_ps(signMask, ca));
```

Normalization requires a bit more care. While we could use division and square root instructions available in SSE2, they're pretty slow. What we actually need in our case is an inverse square root of `dot(q, q)` - once we compute that, we can multiply `q` by that instead of using a slower division at a minor precision cost (`a / b` is more precise than `a * (1 / b)` because the second expression rounds twice, losing 0.5 ULPs at every step). However, if we use `_mm_rsqrt_ps` blindly, the error that we get from our function increases ~4x! Considering that we went through some trouble to reduce the error by an extra order of magnitude, this is definitely non-ideal.

This is of course because `_mm_rsqrt_ps` is just an approximation that has limited precision - improving that requires using a Newton-Raphson iteration step, as suggested by [Intel Architecture Optimization](ftp://download.intel.com/design/pentiumii/manuals/24512701.pdf) manual:

```cpp
__m128 us0 = _mm_rsqrt_ps(un);
__m128 us1 = _mm_mul_ps(_mm_mul_ps(_mm_set1_ps(0.5f), us0), _mm_sub_ps(_mm_set1_ps(3.f), _mm_mul_ps(_mm_mul_ps(us0, us0), un)));
```

With that the results are still faster than using `_mm_sqrt_ps`/`_mm_div_ps` and the precision is back to normal.

## Going wider

Here's an interesting property of the code that we ended up with. Since instead of putting each quaternion in its own SIMD register we put 4 scalars from the scalar code into a register, our code is more or less agnostic to the SIMD width. It's not a stretch to change the code to use AVX2 which has 8-wide registers - in fact, the process is mostly mechanical:

* Replace `__m128` with `__m256`
* Replace `_mm_` with `_mm256_`
* Replace `si128` with `si256` (damn it, Intel)
* Multiply offsets in `load`/`store` instructions by 2

After this we are left with one final piece - we don't have a macro to transpose elements. Since we load 8 quaternions into 4 AVX2 registers, we need a special transposition macro. We could implement one that orders the elements like we need:

```cpp
x0 y0 z0 w0 x1 y1 z1 w1        x0 x1 x2 x3 x4 x5 x6 x7
y2 y2 z2 w2 y3 y3 z3 w3   ->   y0 y1 y2 y3 y4 y5 y6 y7
z4 y4 z4 w4 z5 y5 z5 w5   ->   z0 z1 z2 z3 z4 z5 z6 z7
w6 y6 z6 w6 w7 y7 z7 w7        w0 w1 w2 w3 w4 w5 w6 w7
```

Unfortunately AVX2 does not have a very good supply of cross-lane operations - in other words, most AVX2 instructions work within separate 128-bit halves. However, it's easy to create a operation (called `_MM_TRANSPOSE8_LANE4_PS` in the code) that transposes two blocks of 4x4 elements like this:

```cpp
x0 y0 z0 w0 x1 y1 z1 w1        x0 x2 x4 x6 x1 x3 x5 x7
y2 y2 z2 w2 y3 y3 z3 w3   ->   y0 y2 y4 y6 y1 y3 y5 y7
z4 y4 z4 w4 z5 y5 z5 w5   ->   z0 z2 z4 z6 z1 z3 z5 z7
w6 y6 z6 w6 w7 y7 z7 w7        w0 w2 w4 w6 w1 w3 w5 w7
```

And then swizzle the input 't' array in the correct order like this:

```cpp
_mm256_permutevar8x32_ps(tt, _mm256_setr_epi32(0, 2, 4, 6, 1, 3, 5, 7))
```

We'll do just that, and this is the final step we need to take to make an AVX2 version of our lerping functions that works on 8 quaternion pairs at a time.

## FMA

... no, not [*that* FMA](https://en.wikipedia.org/wiki/Fullmetal_Alchemist). One last thing that we can do is take advantage of fused multiply-add instructions available on some architectures (like Haswell). This instruction computes the expression `a * b + c` at the cost of one multiplication (with slightly higher precision).

It's pretty trivial to identify these expressions in our code - it has a fair share of them, used for computing the dot product between two quaternions, computing interpolation coefficients, etc.

However, since we're using clang we don't need to do that - we can ask it to automatically fuse instructions whenever possible by passsing these command-line arguments:

```cpp
-mfma -ffast-math
```

The reason we need to pass `-ffast-math` is that this optimization changes the output of the program since the precision is different. In our case this is not something to be concerned about - in fact, using FMA reduces the error slightly (as expected).

## Results

Ok, all the hard work is done  - let's see what we got in the end. We'll use IACA again to measure the performance of a loop - for SSE2 versions every loop iteration is processing 4 quaternions instead of 1, so we'll divide the numbers we get from IACA by 4 (and for the AVX2 version we'll divide by 8).

| Function | Cycles/element
|----------|------
| nlerp | 14.15
| fnlerp | 18.35
| onlerp | 22.95
| nlerp4 | 4.76
| fnlerp4 | 6.14
| onlerp4 | 7.19
| onlerp8 | 3.65
| onlerp8 FMA | 2.63

Our SSE2 code is 2.5-3x faster than scalar, which is reasonable - we still lose time on AoS <-> SoA conversion. The AVX2 code is even more impressive, at 6x faster than scalar - the AVX2 function takes roughly as many cycles as the SSE2 function but processes twice as many elements per iteration! And FMA version is allegedly a full cycle faster.

Keep in mind that these timings are estimated, not measured. My ghetto measurements don't agree with these numbers, but they are performed in a setting where other factors, such as memory access time, may play a significant factor in determining the execution time.

All of the above code and more is [available here](https://gist.github.com/zeux/1935b5f6d1c8c311e68bbd4a13955dfa). Note that the SIMD code is admittedly pretty ugly - the intrinsic names, sign bit manipulations etc. obscure the meaning of the code which is unfortunate because really the SIMD code is very much like the scalar code and the process of converting one to the other is pretty automatic, even if the results look wildly different. But that's a problem for another time.

[^1]: I do have some benchmarking code in the Gist with the sources, but I did not spend any effort to make the results stable.
[^2]: There is a more efficient way to do this in this specific case by just manipulating the sign bit but this was the only branch that I could show the technique on.
