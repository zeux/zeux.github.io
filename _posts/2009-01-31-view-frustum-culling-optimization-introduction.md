---
layout: post
title: View frustum culling optimization - Introduction
---

Here I come again, back from almost a year long silence – and for some weird reason a visitor counter shows that people are still reading my blog! This was an eventful year for me – I worked on lots of things at work and on some at home, got 3 more shipped titles to put in my CV, started really programming on PS3 (including many RSX-related adventures, optimizations and, recently, SPU coding, which I happen to enjoy a lot), and, as some of you will probably guess from the code below, started using Vim. Some other (good) changes gave me more free time, so this post is a first one in a new one-post-in-a-week series (which will hopefully not be the, uh, last one also).

I have a small piece of code at work, which performs simple frustum culling for a given OBB. Initially it was written in an unoptimized (and cross-platform) way, later it was rewritten for Altivec with interesting optimizations, which yielded 3x performance boost, IIRC, and recently it was rewritten again for SPU. I considered this series of code transformation an interesting one, so I thought I'd expand it slightly (adding more intermediate stages), pretend it always was on SPU, and write several posts about it.

This post is a teaser, featuring testing methodology, source data, algorithm and initial (unoptimized) version of code, with unoptimized underlaying math library. Each code snippet will be short and self-contained, since the problem at hand is simple enough. Later posts in series will each feature some performance-related transformation (which can be obviously applied to lots of algorithms), with the last post giving more or less the current version of my code at work.

So, let's get started!

It starts simple - we have a handful of meshes, with each mesh having some kind of bounding volume and a local-to-world transformation. The task at hand is to determine, for a given frustum, whether the mesh is potentially visible (inside/intersecting with the frustum). The test has to be conservative – i.e. it can answer “visible” for meshes which are actually invisible – but it does not have to be exact. In fact, for many meshes the bounding volume itself is inexact, but additionally the algorithm can sacrifice some accuracy in order to be faster.

For our case, the bounding volume is AABB (axis-aligned bounding box) - “axis-aligned” here means that box axes are aligned to mesh local space axes, so in world space this is OBB. We're testing it against an arbitrary frustum – it can be a usual perspective/orthogonal one, or something more fancy (for example, our reflection/refraction rendering passes use perspective projection with oblique clipping, so near/far planes are not perpendicular to the viewing direction, and in fact they are not parallel at all!). Frustum is defined by a 4x4 matrix, though obviously we're free to convert it to any other representation we like.

There are two common approaches to testing if the box is inside frustum or not. First, equations of all 6 frustum planes are extracted. Then, for each plane it's determined if the box is completely outside (i.e. in the negative half-space, if planes' normals are pointing inside the frustum) or not; if the box is not completely outside for all planes, it's reported visible, otherwise it's reported invisible. This can be extended to differentiate “completely inside” and “partially inside” results, though we don't need it, since we're going to render both groups of meshes anyway.

Two approaches differ in the methodology of box-plane testing – one (bruteforce) is testing all 8 vertices of the box, another one is taking a single point (the p-vertex) and testing it, which is enough  to give the correct answer if the correct p-vertex is chosen. The series will concentrate on the bruteforce approach, at least for now.

The naïve version of the algorithm first extracts the plane equations, using frustum combined view projection matrix (this is done once for each frustum, so it is not performance sensitive; as such, the code for this is omitted and frustum is assumed to have 6 computed plane equations initially). Then it applies the described bruteforce algorithm as follows:

```cpp
bool is_visible(struct matrix43_t* transform, struct aabb_t* aabb, struct frustum_t* frustum)
{
    // get aabb points
    struct vector3_t points[] =
    {
        { aabb->min.x, aabb->min.y, aabb->min.z },
        { aabb->max.x, aabb->min.y, aabb->min.z },
        { aabb->max.x, aabb->max.y, aabb->min.z },
        { aabb->min.x, aabb->max.y, aabb->min.z },


        { aabb->min.x, aabb->min.y, aabb->max.z },
        { aabb->max.x, aabb->min.y, aabb->max.z },
        { aabb->max.x, aabb->max.y, aabb->max.z },
        { aabb->min.x, aabb->max.y, aabb->max.z }
    };

    // transform points to world space
    for (int i = 0; i < 8; ++i)
    {
        transform_point(points + i, transform);
    }

    // for each plane…
    for (int i = 0; i < 6; ++i)
    {
        bool inside = false;

        for (int j = 0; j < 8; ++j)
        {
            if (dot(points + j, frustum->planes + i) > 0)
            {
                inside = true;
                break;
            }
        }

        if (!inside)
        {
            return false;
        }
    }

    return true;
}
```

It uses five predefined data structures (vector3_t, matrix43_t, aabb_t, frustum_t and plane_t which is the type of frustum->planes array elements); those, and the (again, naïve) code of two used functions is available [here (along with the rest of the code)](https://gist.github.com/zeux/a3114def35a16ad63e6b).

Note that matrix43_t is laid out so that three translation components are adjacent to each other in memory (I don't use the term “whatever major” here because it's very misleading); in our real code, rows actually consist of four components, with the fourth one being undefined for matrix43_t (of course, all operations should proceed as if the column was filled with 0 0 0 1). Similarly, vector3_t has four components, with the fourth one being undefined (this affects aabb_t). This is something that is assumed to stay this way forever, so all of our discussed code will somehow work around that when needed. From the next post and onwards, data layout of the sample code will be exactly the same as in our engine, I've omitted padding fields in today's version for simplicity.

The testing methodology is simple – I compile the code for SPU using a compiler from Sony's toolchain with -O3 level of optimization (the code is C99, by the way), and then run it via SPU simulator. This is an extremely useful tool that's provided by Sony for PS3 developers, which can run a SPU program and, for example, report run statistics – cycles elapsed, various stalls, etc. As far as I know, IBM has a public simulation suite with comparable capabilities, but since it requires Linux I never bothered to test it out. The number of cycles that the tool reports is then slightly reduce to account for some startup overhead (which is 34 cycles), so the number that I present here is the number of cycles for non-inlined call, with included function call overhead. For the reference, I'll include expected run time on a million OBBs (on one SPU, obviously), and corresponding run times of more or less the same code for PC (on my Core2 Duo 2.13 GHz), compiled with gcc 4.3.0 and MSVC 8.0 (SPU intrinsics will be replaced with SSE1 code). Those are only for reference, don't quote me on them :)

The cycle count for this naïve code is 1204, which (given a 3.2 GHz SPU) translates to 376 msec per million calls. The same code gives me roughly 84 msec when compiled with gcc (switches -O3 -msse) and 117 msec when compiled with cl (switches /O2 /fp:fast /arch:SSE). The test runs on the same data each time (taking care that processing is actually being performed), which excludes cache misses from the picture; the actual data is the same for SPU and PC tests and consists of a small box being completely inside the frustum – so that's a worst case for the outer loop (we have to test the box against all planes only to report that it's actually visible), although that's a best case for the inner loop (the first vertex tested for each plane is inside, so we can bail out early). I don't have any real-world average statistics on iteration counts of those loops; anyway, eventually we're going to eliminate some, and then all of those branches, so that the code will perform at constant speed.

That's all for now – stay tuned for the next weekend's post!

View Frustum Culling series contents:

>1. **Introduction**
2. [Vectorize me](/2009/02/08/view-frustum-culling-optimization-vectorize-me/)
3. [Structures and arrays](/2009/02/15/view-frustum-culling-optimization-structures-and-arrays/)
4. [Never let me branch](/2009/03/01/view-frustum-culling-optimization-never-let-me-branch/)
5. [Representation matters](/2009/03/15/view-frustum-culling-optimization-representation-matters/)
6. [Balancing the pipes](/2010/09/11/view-frustum-culling-optimization-balancing-the-pipes/)
