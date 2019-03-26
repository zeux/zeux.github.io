---
layout: post
title: View frustum culling optimization - Balancing the pipes
---

Last time (I don't blame you if you forgot, that was a year and a half ago) I described the view frustum culling solution, which involved projecting the box to clip space and testing the points against plane equations there. This is more or less the solution we used at work at the time; the production version has two additional features, size culling (after the culling operation we have the clip-space extents, so we can test if the box screen-space area is too small) and occlusion culling (boxes are tested against the software Z-buffer, again, using the clip-space extents). However, we're going to keep things simple and see if we can optimize the simple culling function further.

The fastest version back then stopped at 104 cycles per test. Let's look at the code, count the instructions, and think about the further optimization possibilities.

The full version of previous code [is here](https://gist.github.com/zeux/1fb08fb04ae97c79852e).

SPU instructions can be separated into several groups; instruction in each group usually share the latency and the pipeline. SPU have two pipelines - even and odd. The instruction set is separated into odd and even instructions; even instructions should execute on even pipe, odd - on odd pipe. SPU can execute two instructions per cycle, if they are executed on different pipes, if there are no stalls due to register dependencies, and if the addresses of instructions are "even" and "odd", respectively (all instructions are 4-byte, so even/odd distinction refers to the offset modulo 8 - it can be either 0 or 4).

> Obviously, the information described here is SPU-specific, but only up to a point. Latency hiding is very useful on many other architectures, and optimizing for proper pipe utilization is often useful even in pixel shaders.

The ultimate goal, of course, is to have each cycle completely busy - so that on each cycle there are two instructions to execute. Obviously, this is hard to do in practice, because of register dependencies, and lack of instruction balance.

Register dependencies problem refers to the fact that each instruction has some latency. Generally, after an instruction is issued, the next instruction can be issued on the next cycle (or on the same cycle, if dual-issue restrictions above are met). However, the actual result of the instruction is usually made available only after several cycles; trying to read from the destination register before the instruction has written new data into it results in stalls. For example, let's take vector-matrix multiplication as an example. We have four columns of a matrix in registers c0 through c3, and the column vector in register p. Then the transformation code (which resembles the code from [the earlier article in this series](/2009/02/08/view-frustum-culling-optimization-–-vectorize-me/), look for transform_point) might look like this:

```
shufb px, p, p, const_splat_x
shufb py, p, p, const_splat_y
shufb pz, p, p, const_splat_z

fma result, pz, c2, c3
fma result, py, c1, result
fma result, px, c0, result
```

Wow, this is fast! Only three instructions for actual math, and three for splatting the components. Yeah, but fma has 6-cycle latency, so there is a 5-cycle stall after each fma (and there is a 3-cycle stall before first fma, because shufb has 4-cycle latency). So this code transforms the point in 24 cycles. We can modify the code to slightly reduce the stalls:

```
shufb px, p, p, const_splat_x
shufb py, p, p, const_splat_y
shufb pz, p, p, const_splat_z

fm tempx, px, c0
fm tempy, py, c1
fa tempxy, tempx, tempy
fma result, pz, c3, tempxy
```

We waste 1 cycle before the first fm (dependency on px), 5 cycles before the first fa (dependency on tempy) and 5 cycles before the fma (dependency on tempxy). So we won approximately 6 cycles. This is still not much, and so the proper way to speed this up is to add other code to hide latencies. For example, if we have to transform 6 points, then we can just replicate each instruction 6 times (of course, we'll use 6x more registers) and eliminate all latency stalls; that way we can transform 6 points in approximately 41 cycle (6 instructions * 6 points = 36 cycles, +5 cycles of latency for the last point), which is much better.

The next goal for full pipe utilization after register dependencies are eliminated is to make sure that pipes are evenly balanced. As I've written before, each instruction executes on one pipe; for example, all floating-point instructions execute on even pipe (here is [a useful document](http://www.insomniacgames.com/tech/articles/0907/files/spu_instruction_cheat_sheet.pdf) that has latency and pipe information for all SPU instructions). If your code executes in 100 cycles, and has 80 floating-point instructions, then there is not much you can do (unless you can remove some of those).

Let's check the code for the function from the above. I've run a simple perl script to count the instructions in an assembly fragment (did I mention I love Perl one-liners?):

```
perl -e "while (<>) { $x{$2}++ if (/^.+?:(\s+\S+){4}\s+(\S+)/); } print qq{$_ $x{$_}\n} foreach (sort keys %x);" <file.s
```

and got this:

```
and 5
bi 1
fcgt 12
fm 3
fma 33
hbr 1
il 1
ila 1
ilhu 4
iohl 3
lqd 10
lqr 2
or 6
orx 6
shufb 32
xor 2
```

We have 48 floating-point instructions (even), 12 loads (odd), 13 per-component bitwise operations (even), 6 orx (this is a bitwise operation that operates on the whole quadword at once; generally, such operations are odd), 32 shufb (odd) and 11 other instructions that deal with constant formations and return from functions, which we'll ignore for now (pretend they don't exist). So there are 61 even instructions and 48 odd instructions - the code is more or less balanced, but it could've been better. There are two problems in the code that are easy to fix.

The first problem is that we call transform_points4 twice; while the shuffles are shared between the calls (each call to transform_points has 16 shuffles, but they are the same across two calls, because they operate on the same view projection matrix), some math could be shared but is not. We call the function like so:

```cpp
static inline void transform_points_4(qword* dest, qword x, qword y, qword z, const struct matrix_t* mat)
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
    COMP(3);
    
#undef COMP
}

transform_points_4(points_cs_0, minmax_x, minmax_y, minmax_z_0, &clip);
transform_points_4(points_cs_1, minmax_x, minmax_y, minmax_z_1, &clip);
```

Note that X and Y vectors for two groups of points are the same, which is expected because in local space our box is an AABB (each group of 4 points represents points of the face with normal pointing up or down the Z axis). However, we start doing multiply-add operations with Z component, which prevents sharing the calculations.

Rearranging the computations in xyz or yxz order enables us to share 8 floating points operations with the previous call:

```cpp
res_ ## c = si_fma(x, SPLAT((qword)mat->row0, c), res_ ## c); \
res_ ## c = si_fma(y, SPLAT((qword)mat->row1, c), res_ ## c); \
res_ ## c = si_fma(z, SPLAT((qword)mat->row2, c), res_ ## c); \
```

Another minor annoyance is that we have to negate the w component and to compare Z with 0. The point of the code in question:

```cpp
// calculate -w
qword points_cs_0_negw = si_xor(points_cs_0[3], (qword)(vec_uint4)(0x80000000));
qword points_cs_1_negw = si_xor(points_cs_1[3], (qword)(vec_uint4)(0x80000000));

// for each plane...
#define NOUT(a, b, c, d) si_orx(si_or(si_fcgt(a, b), si_fcgt(c, d)))

qword nout0 = NOUT(points_cs_0[0], points_cs_0_negw, points_cs_1[0], points_cs_1_negw);
qword nout1 = NOUT(points_cs_0[3], points_cs_0[0], points_cs_1[3], points_cs_1[0]);
qword nout2 = NOUT(points_cs_0[1], points_cs_0_negw, points_cs_1[1], points_cs_1_negw);
qword nout3 = NOUT(points_cs_0[3], points_cs_0[1], points_cs_1[3], points_cs_1[1]);
qword nout4 = NOUT(points_cs_0[2], (qword)(0), points_cs_1[2], (qword)(0));
qword nout5 = NOUT(points_cs_0[3], points_cs_0[2], points_cs_1[3], points_cs_1[2]);

#undef NOUT
```

is to calculate, for each plane, if any point is not outside the plane, i.e. if there is any point with i.e. z < w for far plane. The code does it by computing z < w for all points, and then or-ing together the results. Instead we can abuse the fact that for negative numbers, the sign (most significant) bit is 1. For far plane we can take w - z instead; now, if it is negative for all points, then z < w does not hold for all points, and the point is outside. We can take w - z for all points, `and` together the results, and check the most significant bit - it is 1 iff the point is outside.

SPU does not have a horizontal-and instruction (a straightforward way to do the above would be to do something like `si_andx(si_and(..., ...))`), but we can replace this with the equivalent:

```cpp
not(andx(and(a, b), and(c, d))) == orx(not(and(a, b)), not(and(c, d)))
```

Fortunately, there is a not(and(a, b)) instruction available, so we can write the code as follows:

```cpp
// for each plane...
#define NOUT(op, idx0, idx1) si_orx(si_nand(op(points_cs_0[idx0], points_cs_0[idx1]), op(points_cs_1[idx0], points_cs_1[idx1])))

qword nout0 = NOUT(si_fa, 0, 3); // (x + w) >= 0 for any point
qword nout1 = NOUT(si_fs, 3, 0); // (w - x) >= 0 for any point
qword nout2 = NOUT(si_fa, 1, 3); // (y + w) >= 0 for any point
qword nout3 = NOUT(si_fs, 3, 1); // (w - y) >= 0 for any point
qword nout4 = si_orx(si_nand(points_cs_0[2], points_cs_1[2])); // z >= 0 for any point
qword nout5 = NOUT(si_fs, 3, 2); // (w - z) >= 0 for any point

#undef NOUT
```

With these two modifications, we remove 10 floating-point operations and two xor's (and replace or with nand, which are similar); we have to convert the most-significant bit of the result to a 0/1 mask, which can be done with a single arithmetic right shift:

```cpp
return si_to_int(nout) >> 31;
```

In total we saved 11 even instructions, so now there are 50 even and 48 odd instructions - much better. The performance of is_visible slightly improved (by 7 cycles, to be precise), so it is now 97 cycles. Why are there 50 even instructions, but at least twice more cycles? Well, the code still has some register dependency stalls; also, while the amount of work on both pipes is now roughly equal, this work has to be done at different times throughout the execution - i.e. this code:

```
shufb
...
shufb
fma
...
fma
```

is slower than this code:

```
fma
shufb
...
fma
shufb
```

because the first one issues 1 instruction per cycle (given no register dependencies), and the second one issues 2. There are several ways to fix this, the easiest one being - do more operations in the function and have the compiler rearrange the instructions to better utilize dual pipelining. Additionally some calculations may be shared - for example, the constant formation.

Making this change is trivial - just rename the old function to is_visible_impl and make it inline, and add a new function:

```cpp
__attribute__((noinline)) void is_visible(qword* result, const struct matrix_t* transform, const struct aabb_t* aabb, unsigned int count, const struct matrix_t* frustum)
{
    for (unsigned int i = 0; i < count; i += 4)
    {
        qword r0 = si_from_uint(is_visible_impl(transform + i + 0, aabb + i + 0, frustum));
        qword r1 = si_from_uint(is_visible_impl(transform + i + 1, aabb + i + 1, frustum));
        qword r2 = si_from_uint(is_visible_impl(transform + i + 2, aabb + i + 2, frustum));
        qword r3 = si_from_uint(is_visible_impl(transform + i + 3, aabb + i + 3, frustum));

        result[i + 0] = r0;
        result[i + 1] = r1;
        result[i + 2] = r2;
        result[i + 3] = r3;
    }
}
```

Note that the frustum is the same for all AABB/matrix pairs, which makes sense for common usage patterns.

This code runs at 74 cycles per iteration at 1024 iterations, which is much closer to the optimal 50. Of course, the code size is larger now, and we'll have to restructure the calling code.

There is another technique that can reduce stalls and improve dual-issue rate, which is called software pipelining. I currently don't know if it will prove useful for this case; if it will, I'll demonstrate it on this code, otherwise I'll show it on a different (simpler) code.

The complete source for this post can be [grabbed here](https://gist.github.com/zeux/ef12716faf6e3b54a2b3).

View Frustum Culling series contents:

>1. [Introduction](/2009/01/31/view-frustum-culling-optimization-introduction/)
2. [Vectorize me](/2009/02/08/view-frustum-culling-optimization-vectorize-me/)
3. [Structures and arrays](/2009/02/15/view-frustum-culling-optimization-structures-and-arrays/)
4. [Never let me branch](/2009/03/01/view-frustum-culling-optimization-never-let-me-branch/)
5. [Representation matters](/2009/03/15/view-frustum-culling-optimization-representation-matters/)
6. **Balancing the pipes**