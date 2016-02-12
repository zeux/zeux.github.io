---
layout: post
title: View frustum culling optimization - Never let me branch
redirect_from: "/2009/03/01/view-frustum-culling-optimization-–-never-let-me-branch/"
---

In previous iteration we converted the code to SoA instead of AoS, which enabled us to transform OBB points to world space relatively painlessly, and eliminated ugly and slow dot product, thus making the code faster. Still, the code is slow. Why?

Well, as it appears, the problem is branching.

I wanted to write a long post about branches and why they are often a bad idea for PPU/SPU, but it turns out that Mike Acton beat me to it – be sure to read his articles for detailed explanation: [part 1](http://www.cellperformance.com/articles/2006/07/tutorial_branch_elimination_pa.html) [part 2](http://www.cellperformance.com/articles/2006/04/background_on_branching.html) [part 3](http://www.cellperformance.com/articles/2006/04/benefits_to_branch_elimination.html) - so I'll make it short. For our case, there are two problems with branching:

First, code performance depends on input data. Visible boxes are worst case (this is the one the cycle count is for); invisible boxes are faster, with the fastest case (where the box is behind the first plane) taking 128 cycles. Because of this, it's hard to estimate the run time of culling, given the number of objects – upper bound is three times bigger than lower bound.

Second, branches divide the code in blocks, and compiler has problems performing optimizations between blocks. We have a constant-length loop, inside we compute 8 dot products for a single plane, then check if all of them are negative, and in this case we early-out. Note that there are a lot of dependencies in computation of dot products – `si_fma`s in dot4 depend on the result of previous `si_fma`s, `si_fcgt` depends on the result of dot4, etc. Here is an example of disassembly for performing a single dot4 operation, assuming that we already have SPLAT(v, i) in registers:

```
fma res, v2, z, v3
fma res, v1, y, res
fma res, v0, x, res
```

Pretty reasonable? Well, not exactly. While we have 3 instructions, each one depends on the result of the previous one, so we can use our result in 18 cycles instead of 3 (fma latency is 6 cycles). If we need to compute 6 dot4, and we have some sort of branching after each one, like we had in the code for previous attempt, we'll pay the cost of 18 cycles for each iteration (of course, there'll also be some cost associated with comparison and branching). On the other hand, if we computed all 6 dot4 without any branches, the code could've looked like:

```
fma res[0], v2[0], z[0], v3[0]
fma res[1], v2[1], z[1], v3[1]
…
fma res[5], v2[5], z[5], v3[5]


fma res[0], v1[0], y[0], res[0]
…
fma res[5], v1[5], y[5], res[5]

fma res[0], v0[0], x[0], res[0]
…
fma res[5], v0[5], x[5], res[5]
```

This code has 18 instructions, and all results are computed in 24 cycles – but we're computing 6 dot4 instead of 1! Also 24 cycles is the latency for res[5] – we can start working on res[0] immediately after last fma gets issued.

The problem is not only related to instruction latency (in our case, register dependencies), but also to pipeline stalls – SPU has two pipelines (even and odd), and can issue one instruction per pipeline per cycle for, uhm, perfect code – each type of instruction can be issued only on one of the pipes, for example arithmetic instructions belong to even pipe, load/store/shuffle instructions belong to odd one. Because of this shuffles can be free if they dual-issue with arithmetics and do not cause subsequent dependency stalls.

Compiler tries to rearrange instructions in order to minimize all stalls – register dependencies, pipeline stalls and some other types – but it is often not allowed to do it between branches. Because of this it's best to eliminate all branches – compiler will be left with a single block of instructions and will be able to do a pretty good job hiding latencies/dual-issuing instructions. This is often critical – for example, our current version wastes almost half of cycles while waiting for results because of register dependency.

Of course, eliminating branches is often a tradeoff – sometimes it makes worst-case run faster, but best-case now runs slower, as we observed last time with x86 code. The decision depends on your goals and on frequency of various cases – remember that branchless code will give you a guaranteed (and usually acceptable) lower bound on performance.

So, in order to eliminate branches, we'll restructure our code a bit – instead of checking for each plane if all points are outside, we'll check if any point is inside, i.e. if the box is not outside of the plane:

```cpp
static inline qword is_not_outside(qword plane, const qword* points_ws_0, const qword* points_ws_1)
{
    qword dp0 = dot4(plane, points_ws_0[0], points_ws_0[1], points_ws_0[2]);
    qword dp1 = dot4(plane, points_ws_1[0], points_ws_1[1], points_ws_1[2]);


    qword dp0pos = si_fcgt(dp0, (qword)(0));
    qword dp1pos = si_fcgt(dp1, (qword)(0));

    return si_orx(si_or(dp0pos, dp1pos));
}
```

`si_orx` is a horizontal or (or across) instruction, which ors 4 32-bit components of source register together and returns the result in preferred slot, filling the rest of vector with zeroes. Thus is_not_outside will return 0xffffffff in preferred slot if box is not outside of plane, and 0 if it's outside.

Now all we have to do is to call this function for all planes, and combine the results – we can do it with `si_and`, since the box is not outside of the frustum only if it's not outside of all planes; if any is_not_outside call returns 0, we have to return 0.

```cpp
// for each plane…
qword nout0 = is_not_outside((qword)frustum->planes[0], points_ws_0, points_ws_1);
qword nout1 = is_not_outside((qword)frustum->planes[1], points_ws_0, points_ws_1);
qword nout2 = is_not_outside((qword)frustum->planes[2], points_ws_0, points_ws_1);
qword nout3 = is_not_outside((qword)frustum->planes[3], points_ws_0, points_ws_1);
qword nout4 = is_not_outside((qword)frustum->planes[4], points_ws_0, points_ws_1);
qword nout5 = is_not_outside((qword)frustum->planes[5], points_ws_0, points_ws_1);


// merge "not outside" flags
qword nout01 = si_and(nout0, nout1); 
qword nout012 = si_and(nout01, nout2); 

qword nout34 = si_and(nout3, nout4); 
qword nout345 = si_and(nout34, nout5); 

qword nout = si_and(nout012, nout345);

return si_to_uint(nout);
```

I changed return type for is_visible to unsigned int, with 0 meaning false and 0xffffffff meaning true; this won't change client code, but slightly improves performance.

Now when we compute everything in a single block, compiler schedules instructions in a way that we waste close to zero cycles because of latency. The new branchless version runs at 119 cycles, which is more than 3 times faster than the previous version, and 10 times faster than initial scalar version. This results in 37 msec for million calls, which is almost 2 times faster than fastest result on x86 (finally!). Moreover, this is slightly faster than the best case of previous version – so there is no tradeoff here, new version is always faster than old one. Note that eliminating branches is not worth it for x86 code (i.e. it does not make worst case faster, which is expected, if you remember that we had to do 2 checks per plane in order to make SoA approach faster than AoS).

The current source can be [grabbed here](https://gist.github.com/zeux/9707c36deb26e8297e28).

That's all for now – stay tuned for the next weekend's post! I plan to post something not VFC-related the next week, then another VFC post the week after that. If you're starting to hate frustums, SPU, me and my blog - sorry about that, but we'll be done with VFC some day, I swear! :)

View Frustum Culling series contents:

>1. [Introduction](/2009/01/31/view-frustum-culling-optimization-introduction/)
2. [Vectorize me](/2009/02/08/view-frustum-culling-optimization-vectorize-me/)
3. [Structures and arrays](/2009/02/15/view-frustum-culling-optimization-structures-and-arrays/)
4. **Never let me branch**
5. [Representation matters](/2009/03/15/view-frustum-culling-optimization-representation-matters/)
6. [Balancing the pipes](/2010/09/11/view-frustum-culling-optimization-balancing-the-pipes/)