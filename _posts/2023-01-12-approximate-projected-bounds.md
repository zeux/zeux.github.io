---
layout: post
title: Approximate projected bounds
excerpt_separator: <!--more-->
---

When working with various forms of culling, it can be useful to project the object bounds to screen space. This is necessary to implement various forms of occlusion culling when using a depth pyramid, or to be able to reject objects or clusters that don't contribute to any pixels. The same operation can also be used for level of detail selection, although it's typically faster to approximate the projected area on screen - here we're interested in efficient conservative projected bounds. "Conservative" means that the resulting bounds must contain the original object. "Efficient" means that we'll need to restrict ourselves to projecting 3D bounds that are known to contain the object - naturally, two common choices are a sphere and a box.

<!--more-->

## Near clipping

Perspective projection has a singularity on the plane that is orthogonal to camera direction and goes through the camera position. Points on that plane have W=0 in homogeneous space, and attempts to perform a post-perspective divide will result in Inf/NaN. As such, graphics hardware clips rasterized triangles to near plane (post-perspective Z>0). When the object bounds intersect near plane in 3D, in order to compute the precise projected bounds we would need to compute the bounds of the clipped volume. This can be computationally intensive, and is also entirely unnecessary when the result is used for culling - if the object intersects the camera plane, the odds of it being culled are nil. As such we're going to assume that we will reject objects that intersect the near plane for simplicity.

## Sphere projection

Spheres are convenient to transform - e.g. a world-space sphere can be converted to view-space with just one matrix transformation, as the sphere retains its radius under such a transform. Unfortunately, after projection the sphere is not a disk - however, it is possible to analytically derive the precise bounds of such projection. [2D Polyhedral Bounds of a Clipped, Perspective-Projected 3D Sphere (Michael Mara, Morgan McGuire) ](https://jcgt.org/published/0002/02/05/) does precisely that. While that paper comes with source code, it solves a more generic problem - you can refer to that paper for derivation, but we can take that source code and specialize it for the task at hand, where we focus on screen-space bounds and ignore near clipping.

```glsl
// 2D Polyhedral Bounds of a Clipped, Perspective-Projected 3D Sphere. Michael Mara, Morgan McGuire. 2013
bool projectSphereView(vec3 c, float r, float znear, float P00, float P11, out vec4 aabb)
{
    if (c.z < r + znear) return false;

    vec3 cr = c * r;
    float czr2 = c.z * c.z - r * r;

    float vx = sqrt(c.x * c.x + czr2);
    float minx = (vx * c.x - cr.z) / (vx * c.z + cr.x);
    float maxx = (vx * c.x + cr.z) / (vx * c.z - cr.x);

    float vy = sqrt(c.y * c.y + czr2);
    float miny = (vy * c.y - cr.z) / (vy * c.z + cr.y);
    float maxy = (vy * c.y + cr.z) / (vy * c.z - cr.y);

    aabb = vec4(minx * P00, miny * P11, maxx * P00, maxy * P11);
    // clip space -> uv space
    aabb = aabb.xwzy * vec4(0.5f, -0.5f, 0.5f, -0.5f) + vec4(0.5f);

    return true;
}
```

Note that in this implementation we assume that the projection is symmetrical for simplicity, and as such only two elements of the projection matrix (P00 and P11) are necessary. Symmetrical projections are the most common ones, but it's easy to incorporate asymmetrical projections that may occur in VR rendering at a small added cost of four extra additions at the end. The function also converts the output from clip space (where coordinates range from [-1..1] and Y goes up) to normalized screen space or UV space, where coordinates range from [0..1] and Y goes down; if desired this transform can be folded into the projection transform for a small profit.

All in all this requires ~30 FLOPs for the transform plus 12 FLOPs for the final conversions.[^1] Note that `c` is a view-space center of the sphere above - when the sphere is in world space instead, we'll need to transform it to view space first, which takes ~18 FLOPs, for a grand total of 60 FLOPs.

## Naive box projection

If the input is an AABB, things become more difficult. Unlike a sphere, that retains the properties of being a sphere after transformation, an axis-aligned bounding box stops being axis-aligned - this makes precise calculation of the projected bounds difficult as any corner of the bounding box can be extremum, and the problem lacks symmetry. Because of this, a typical method requires projecting all 8 corners, performing a perspective divide, and computing min/max of the resulting values. To perform near plane rejection, before doing the divide we need an "early" out if any transformed vectors have `.w < znear`.

Here's a pseudo-code for what this entails, assuming a world-space input:

```glsl
bool projectBox(vec3 bmin, vec3 bmax, float znear, mat4 viewProjection, out vec4 aabb)
{
    vec4 P0 = vec4(bmin.x, bmin.y, bmin.z, 1.0) * viewProjection;
    vec4 P1 = vec4(bmin.x, bmin.y, bmax.z, 1.0) * viewProjection;
    vec4 P2 = vec4(bmin.x, bmax.y, bmin.z, 1.0) * viewProjection;
    vec4 P3 = vec4(bmin.x, bmax.y, bmax.z, 1.0) * viewProjection;
    vec4 P4 = vec4(bmax.x, bmin.y, bmin.z, 1.0) * viewProjection;
    vec4 P5 = vec4(bmax.x, bmin.y, bmax.z, 1.0) * viewProjection;
    vec4 P6 = vec4(bmax.x, bmax.y, bmin.z, 1.0) * viewProjection;
    vec4 P7 = vec4(bmax.x, bmax.y, bmax.z, 1.0) * viewProjection;

    if (min(P0.w, P1.w, P2.w, P3.w, P4.w, P5.w, P6.w, P7.w) < znear) return false;

    aabb.xy = min(
        P0.xy / P0.w, P1.xy / P1.w, P2.xy / P2.w, P3.xy / P3.w,
        P4.xy / P4.w, P5.xy / P5.w, P6.xy / P6.w, P7.xy / P7.w);
    aabb.zw = max(
        P0.xy / P0.w, P1.xy / P1.w, P2.xy / P2.w, P3.xy / P3.w,
        P4.xy / P4.w, P5.xy / P5.w, P6.xy / P6.w, P7.xy / P7.w);

    // clip space -> uv space
    aabb = aabb.xwzy * vec4(0.5f, -0.5f, 0.5f, -0.5f) + vec4(0.5f);

    return true;
}
```

This is substantially more expensive than the equivalent computation for a sphere - each vector-matrix transform requires 18 FLOPs (as resulting `.z` is unused), so the entire function requires 144 FLOPs just to do the transformation, 16 FLOPs for post-perspective divide, 35 FLOPs for various min/max computations and 8 FLOPs for final conversions of the result - a grand total of 203 operations![^2]

> Update: After the article was published, several people noted that it's also possible to slightly reduce the overhead here using point classification: using the technique from [Fast Projected Area Computation for
Three-Dimensional Bounding Boxes](https://arbook.icg.tugraz.at/schmalstieg/Schmalstieg_031.pdf), once the camera position in bounding box space is known, you can classify silhouette edges via a table lookup, which gives 6 (or, rarely, 4) silhouette vertices that then need to be transformed as above. This leaves the transformation precise, but requires additional code and table data so may or may not be worthwhile on a GPU compared to the methods below. Thanks to Eric Haines and Alan Hickman for correction!

## Optimized box projection

The original version of this article provided a way to reduce the amount of computation in the naive projection by eliminating redundant multiplications, but Aslan Dzodzikov suggested a much more efficient version in the comments. Instead of computing the corners by multiplying the world-space corner of AABB by the matrix, we can take advantage of the distributive property of matrix multiplication and note that `vec4(bmin.x, bmin.y, bmax.z, 1.0) * viewProjection == vec4(bmin.x, bmin.y, bmin.z, 1.0) * viewProjection + vec4(0, 0, bmax.z - bmin.z, 0) * viewProjection`. This allows us to only compute one full vector-matrix product and three products that reduce to row/column multiplication, and the rest of the computation is just vector additions:

```glsl
bool projectBox(vec3 bmin, vec3 bmax, float znear, mat4 viewProjection, out vec4 aabb)
{
    vec4 SX = vec4(bmax.x - bmin.x, 0.0, 0.0, 0.0) * viewProjection;
    vec4 SY = vec4(0.0, bmax.y - bmin.y, 0.0, 0.0) * viewProjection;
    vec4 SZ = vec4(0.0, 0.0, bmax.z - bmin.z, 0.0) * viewProjection;

    vec4 P0 = vec4(bmin.x, bmin.y, bmin.z, 1.0) * viewProjection;
    vec4 P1 = P0 + SZ;
    vec4 P2 = P0 + SY;
    vec4 P3 = P2 + SZ;
    vec4 P4 = P0 + SX;
    vec4 P5 = P4 + SZ;
    vec4 P6 = P4 + SY;
    vec4 P7 = P6 + SZ;

    if (min(P0.w, P1.w, P2.w, P3.w, P4.w, P5.w, P6.w, P7.w) < znear) return false;

    aabb.xy = min(
        P0.xy / P0.w, P1.xy / P1.w, P2.xy / P2.w, P3.xy / P3.w,
        P4.xy / P4.w, P5.xy / P5.w, P6.xy / P6.w, P7.xy / P7.w);
    aabb.zw = max(
        P0.xy / P0.w, P1.xy / P1.w, P2.xy / P2.w, P3.xy / P3.w,
        P4.xy / P4.w, P5.xy / P5.w, P6.xy / P6.w, P7.xy / P7.w);

    // clip space -> uv space
    aabb = aabb.xwzy * vec4(0.5f, -0.5f, 0.5f, -0.5f) + vec4(0.5f);

    return true;
}
```

To compute each of `SX/SY/SZ` we need 4 FLOPs (since resulting `.z` is unused, and the matrix multiplication reduces to a row/column multiplication); the matrix transform requires 18 FLOPs and the rest of the calculations require 7\*3 = 21 FLOPs, so the transformation requires 51 FLOPs in total. The rest of the computation remains as is, with 16+35+8 FLOPs to compute the bounds, which adds up to 110 FLOPs - about half as many as the naive computation! The result is still precise, although may not be exactly equal to the naive computation due to round-off errors.

## View-space approximations

In order to improve these results further we would need to convert the box to something that is easier to deal with - namely, another axis-aligned box, but this time in view space. Converting AABBs between different spaces [has been discussed on this blog before](/2010/10/17/aabb-from-obb-with-component-wise-abs/), and requires an additional vector transform by a 3x3 matrix which is a component-wise modulus of the original rotation matrix. Note that this transformation is conservative but not precise - the resulting bounding volume and, as a result, the projected bounds are going to be larger.

Once the AABB we have is in view space, a number of things become easier. To perform the near clipping rejection, we simply need to look at the minimum Z coordinate for the AABB - no need to compute it from scratch! For the actual projection, the first step is to notice that out of 8 corners, 4 of them on the "front" side (minimum Z) and 4 of them on the "back" side (maximum Z) share the denominator during post-perspective division. Additionally, when computing, for example, the maximum X for the projection, we obviously only need to consider the "right" side of the box - now that we work in view space, it's easy to know which vertices may be extremum! - and all vertices on the right side share the same view-space X. As such, to compute the max X, we simply need to consider two values:

```glsl
float maxx = max(viewmax.x / viewmax.z, viewmax.x / viewmin.z);
```

However, we can simplify this a little further: since `viewmax.z >= viewmin.z`, and both are positive, we know exactly which of them to divide by based on the sign of `viewmax.x`:

```glsl
float maxx = viewmax.x / (viewmax.x >= 0 ? viewmin.z : viewmax.z);
```

With this, we're ready to implement the entire function:

```glsl
bool projectBoxView(vec3 c, vec3 r, float znear, float P00, float P11, out vec4 aabb)
{
    if (c.z - r.z < znear) return false;

    // when we're computing the extremum of projection along an axis, the maximum
    // is reached by front face for positive and by back face for negative values
    float rminz = 1 / (c.z - r.z);
    float rmaxz = 1 / (c.z + r.z);
    float minx = (c.x - r.x) * (c.x - r.x >= 0 ? rmaxz : rminz);
    float maxx = (c.x + r.x) * (c.x + r.x >= 0 ? rminz : rmaxz);
    float miny = (c.y - r.y) * (c.y - r.y >= 0 ? rmaxz : rminz);
    float maxy = (c.y + r.y) * (c.y + r.y >= 0 ? rminz : rmaxz);

    aabb = vec4(minx * P00, miny * P11, maxx * P00, maxy * P11);
    // clip space -> uv space
    aabb = aabb.xwzy * vec4(0.5f, -0.5f, 0.5f, -0.5f) + vec4(0.5f);

    return true;
}

bool projectBoxApprox(vec3 min, vec3 max, mat4 view, float znear, float P00, float P11, out vec4 aabb)
{
    vec4 c = vec4((min + max) * 0.5, 1.0) * view;
    vec3 s = (max - min) * 0.5;
    vec3 r = s * mat3(abs(view[0].xyz), abs(view[1].xyz), abs(view[2].xyz));
    
    return projectBoxView(c.xyz, r, znear, P00, P11, aabb);
}
```

The view-space projection takes 17 FLOPs to implement the core projection, plus 12 FLOPs to transform the result; to project a box to view-space, we need to convert the box to center+radius form (12 FLOPs, although this may not be necessary if the AABB is already stored as center+radius), and do the matrix multiplications (18 FLOPs for center and 24 FLOPs for radius), for a grand total of 83 FLOPs, which is ~30% fewer operations than the optimized precise version. Note that in the `projectBoxApprox` code above we choose to precompute reciprocals of min/max Z to reduce the cost - this technically increases the number of floating-point operations by 2 by trading 4 divisions by 2 reciprocal operations and 4 multiplies, which is usually a good tradeoff on GPUs.

## Evaluation

So far we've ended up with two projection functions for bounding boxes, an optimized precise variant and a view space approximation. We can also adapt `projectBoxView` to serve as a sphere approximation - which is to say, by approximating a sphere with a box with the same radius, we still retain the conservative nature of the projection, and trade off some computational time for precision.

`projectBoxView` takes ~29 FLOPs instead of ~42 FLOPs for `projectSphereView`, but that assumes that we're already starting with a view-space sphere. It's likely that we need to transform the sphere to view space instead, which adds 18 FLOPs for a matrix transform, for 47 FLOPs vs 60 FLOPs - or a ~27% speedup, at least as far as operation count is concerned - which is similar to the FLOPs delta between `projectBoxApprox` and `projectBox`.

As noted before, FLOPs are not an accurate measure of performance. To get a better sense of performance of different variants on a real GPU, we will use [AMD Radeon GPU Analyzer](https://github.com/GPUOpen-Tools/radeon_gpu_analyzer), compile each of the four variants and measure the instruction count[^3], as well as use [PVRShaderEditor](https://developer.imaginationtech.com/pvrshadereditor/) to estimate cycle count on PowerVR Series6 GPUs and [Mali Offline Compiler](https://developer.arm.com/Tools%20and%20Software/Mali%20Offline%20Compiler) to estimate cycle count on ARM Mali-G78.

Function | FLOPs | GCN instructions | PVR cycles | Mali cycles
-----|-------|-------------
projectBox | 110 | 138 | 73 | 0.91
projectBoxApprox | 83 | 102 | 36 | 0.64
projectSphere | 60 | 86 | 38 | 0.59
projectSphereApprox | 47 | 82 | 26 | 0.41

We can see that while the bounding box approximation is yielding meaningful ALU savings, the sphere approximation is much closer to the precise sphere projection and will likely yield similar performance.

Importantly, both approximations convert the primitive into a view-space bounding box and as such they yield larger bounds. To evaluate this, I've integrated all 4 methods into [niagara](https://github.com/zeux/niagara), and looked at the ratio of screen space bounds areas that approximations return, as well as the impact the approximations have on occlusion culling efficiency.

Unfortunately, both approximations end up returning ~1.65x larger bounds in terms of area, which results in ~10% reduction in occlusion culling efficiency. As such, even for the box projection, savings in ALU on the approximation are likely to be negated by the reduction in efficiency in later rendering stages, assuming the projection results are used for geometry culling downstream.

## Conclusion

Despite the title of the article, it looks like in general, when computing projected bounds, it's enough to approximate them by rejecting the cases when the primitive intersects the near plane - and in all other cases computing precise bounds, when done carefully with well optimized code, is reasonably close to view space approximations in performance while providing a much more accurate result. A more accurate result allows more precise culling, which is likely to be a net benefit overall.

---
[^1]: In this post we simplify the reasoning about the execution cost and treat every primitive operation as a single FLOP. The real performance implications are a little more nuanced, as division and square root are typically more expensive, and some multiplies and adds in the code above can be fused.

[^2]: Again, these are approximate. For example on AMD GPUs, division is actually two operations, one of which (1/x) is comparatively expensive, and the computation above assumes `min(x, y)` is a single operation whereas it may actually require two - compare and select.

[^3]: While measuring instruction count is better than measuring FLOPs as it takes into account the compiler and hardware specifics, it's still a bad approximation of the real performance as some GCN instructions have different throughput and scheduling constraints. Unfortunately, RGA does not output cycle estimates.