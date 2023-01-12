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

Spheres are convenient to transform - e.g. a world-space sphere can be converted to view-space with just one matrix transformation as long as it's composed of rotation and translation, as the sphere retains its radius under such a transform. Unfortunately, after projection the sphere is not a disk - however, it is possible to analytically derive the precise bounds of such projection. [2D Polyhedral Bounds of a Clipped, Perspective-Projected 3D Sphere (Michael Mara, Morgan McGuire) ](https://jcgt.org/published/0002/02/05/) does precisely that. While that paper comes with source code, it solves a more generic problem - you can refer to that paper for derivation, but we can take that source code and specialize it for the task at hand, where we focus on screen-space bounds and ignore near clipping.

```glsl
// 2D Polyhedral Bounds of a Clipped, Perspective-Projected 3D Sphere. Michael Mara, Morgan McGuire. 2013
bool projectSphere(vec3 c, float r, float znear, float P00, float P11, out vec4 aabb)
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

Note that in this implementation we assume that the projection is symmetrical for simplicity, and as such only two elements of the projection matrix (P00 and P11) are necessary. Symmetrical projections are the most common ones, but it's easy to incorporate asymmetrical projections that may occur in VR rendering at a small added cost of four extra additions at the end. The function also converts the output from clip space (where coordinates range from [-1..1] and Y goes up) to normalized screen space or UV space, where coordinates range from [0..1] and Y goes down.

All in all this requires ~30 FLOPs for the transform plus 12 FLOPs for the final conversions.[^1] Note that `c` is a view-space center of the sphere above - when the sphere is in world space instead, we'll need to transform it to view space first, which takes ~18 FLOPs, for a grand total of 60 FLOPs.

## Box projection

If the input is an AABB, things become more difficult. Unlike a sphere, that retains the properties of being a sphere after transformation, an axis-aligned bounding box stops being axis-aligned - this makes precise calculation of the projected bounds difficult as any corner of the bounding box can be extremum, and the problem lacks symmetry. Because of this, a typical method requires projecting all 8 corners, performing a perspective divide, and computing min/max of the resulting values. To perform near plane rejection, before doing the divide we need an "early" out if any transformed vectors have `.w < znear`.

Here's a pseudo-code for what this entails, assuming a world-space input:

```glsl
vec4 P0 = vec4(min.x, min.y, min.z, 1.0) * ViewProjection;
vec4 P1 = vec4(min.x, min.y, max.z, 1.0) * ViewProjection;
...
vec4 P7 = vec4(max.x, max.y, max.z, 1.0) * ViewProjection;

if (min(P0.w, P1.w, ..., P7.w) < znear) return false;

float minx = min(P0.x / P0.w, ..., P7.x / P7.w);
// repeat for miny/maxx/maxy
```

This is substantially more expensive than the equivalent computation for a sphere - each vector-matrix transform requires 24 FLOPs, so the entire function requires 192 FLOPs just to do the transformation, 16 FLOPs for post-perspective divide, 35 FLOPs for various min/max computations and 8 FLOPs for final conversions of the result - a grand total of 251 operations![^2]

There is some amount of redundancy in the transformations above - the bulk of operations is dealing with the matrix multiplication, and a large amount of individual elements that are being multiplied there are shared between transforms of individual corners. If we eliminate this redundancy (given enough registers, a sufficiently smart compiler may do that for us), we end up with "only" 24 multiplications and 96 additions for transforms, saving 72 FLOPs, which would bring the total down to 179 FLOPs - still, a hefty cost. Additionally this doesn't help us much if the target platform implements multiply-add instructions, which all GPUs do, as it replaces 96 MADs with 24 MULs and 96 ADDs, and doesn't free us from having to do 16 divisions.

## View-space AABB

In order to improve these results we need to convert the box to something that is easier to deal with - namely, another axis-aligned box, but this time in view space. Converting AABBs between different spaces [has been discussed on this blog before](/2010/10/17/aabb-from-obb-with-component-wise-abs/), and requires an additional vector transform by a 3x3 matrix which is a component-wise modulus of the original rotation matrix.

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
bool projectBox(vec3 c, vec3 r, float znear, float P00, float P11, out vec4 aabb)
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

bool projectBoxWorld(vec3 min, vec3 max, mat4x4 view, float znear, float P00, float P11, out vec4 aabb)
{
    vec4 c = vec4((min + max) * 0.5, 1.0) * view;
    vec3 r = ((max - min) * 0.5) * mat3x3(abs(view[0].xyz), abs(view[1].xyz), abs(view[2].xyz));
    
    return projectBox(c.xyz, r, znear, P00, P11, aabb);
}
```

The view-space projection takes 17 FLOPs to implement the core projection, plus 12 FLOPs to transform the result; to project a box to view-space, we need to convert the box to center+radius form (12 FLOPs, although this may not be necessary if the AABB is already stored as center+radius), and do the matrix multiplications (18 FLOPs for center and 24 FLOPs for radius), for a grand total of 83 FLOPs, which is 2-3x better than the precise version. Note that in the `projectBox` code above we choose to precompute reciprocals of min/max Z to reduce the cost - this technically increases the number of floating-point operations by 2 by trading 4 divisions by 2 reciprocal operations and 4 multiplies, which is usually a good tradeoff on GPUs.

## Conclusion

Finally, it's worth noting that instead of using precise `projectSphere` version to project a sphere, we can use `projectBox` - which is to say, by approximating a sphere with a box with the same radius, we still retain the conservative nature of the projection, and trade off some computational time for precision.

This is not that significant of a win in practice, however - `projectBox` takes ~29 FLOPs instead of ~42 FLOPs for `projectSphere`, but that assumes that we're already starting with a view-space sphere. It's likely that we need to transform the sphere to view space instead, which adds 18 FLOPs for a matrix transform, for 47 FLOPs vs 60 FLOPs. This is a good time to mention, for the third time, that these counts of operations are a mere approximation of the real execution cost. Indeed, if we compile both versions of sphere projection using Mali offline compiler, we'll see that both versions have the same number of estimated cycles - however, the approximate version yields larger bounds. On a test scene from [niagara](https://github.com/zeux/niagara), the approximation of sphere with a box returns, on average, bounds that are ~1.7x larger in terms of area, which results in a reduction of occlusion culling efficiency by ~10% - not a good tradeoff!

Thus when the input is a sphere, the precise version is also, on the balance, the best version; the view-space approximation, however, can still be useful when the input is an AABB, as the approximation is much cheaper to compute than the precise bounds.

[^1]: In this post we simplify the reasoning about the execution cost and treat every primitive operation as a single FLOP. The real performance implications are a little more nuanced, as division and square root are typically more expensive, and some multiplies and adds in the code above can be fused.

[^2]: Again, these are approximate. For example on AMD GPUs, division is actually two operations, one of which (1/x) is comparatively expensive, and the computation above assumes `min(x, y)` is a single operation whereas it may actually require two - compare and select.
