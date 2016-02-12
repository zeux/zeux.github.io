---
layout: post
title: Robust unit cube clipping for shadow mapping
---

Shadow mapping is my primary area of interest in computer graphics, so expect more posts on this topic. Today I’d like to tell about robust unit cube clipping regarding different projection matrix building techniques.

The task at hand is relatively simple – given a set of points representing shadow receivers and a set of points representing shadow casters, build a matrix that, while used for shadow rendering, maximizes shadow map utilization (both in terms of shadow map area and depth precision) and at the same time eliminates all shadow clipping artifacts. I have not implemented anything except directional light support properly, so expect another post sooner or later.

Note that all points are assumed to be in world space, and for a lot of algorithms it’s preferred to take vertices of convex hull of receivers, clipped by view frustum, instead of actual receivers’ vertices – it’s not always required, but for the sake of simplicity we will assume that all receivers’ points are inside view frustum. Of course casters’ points are arbitrary.

### Uniform Shadow Mapping

Uniform shadow mapping is shadow mapping with a simple orthographic projection, without any perspective reparametrization. As unit cube clipping is an operation that’s usually done *after* constructing some approximate matrix, let’s suppose we already have a view and projection matrix for our light configuration – note that in case of uniform light the only thing we care about is that view matrix has the same direction as the light, and the projection matrix represents some orthographic projection – everything else is irrelevant, so we can take arbitrary view position, more or less arbitrary up vector, construct a view matrix, and assume that projection matrix is actually identity matrix.

Now let’s construct two axis-aligned bounding boxes, one for receiver points, transformed to our light post-perspective space, another one for caster points, again in light PPS. Note that projection is orthographic, therefore there is no post-perspective division employed, and there are no singularities during AABB construction.

Now we have to build a new matrix that transforms our light viewprojection matrix to minimize shadow map wastage and Z precision loss, while preserving shadows. The actual choice of values depends on some states that are set while applying shadow map to scene.

At first, let’s deal with XY extents. Many papers propose choosing receivers’ XY extents, because we don’t care about points of casters that are outside receivers’ extents – i.e. can’t cast shadows on receivers. This provides correct results, but we can do slightly better – we can select intersection of casters’ and receivers’ XY extents:

```cpp
float min_x = max(receivers.min_x, casters.min_x);
float min_y = max(receivers.min_y, casters.min_y);
float max_x = min(receivers.max_x, casters.max_x);
float max_y = min(receivers.max_y, casters.max_y);
```

What we get here is that if casters’ extents are “wider” than receivers’, we get the same extents as before. However, if you have a big receiver and relatively small casters on it, this will select smaller extents. Note that extents are always correct – they enclose all points that BOTH some caster and some receiver could project to – i.e. all points there you potentially could need shadow. Everywhere else there is no shadow.

Whether this is beneficial depends on scene type – you’ll usually get no benefit from this approach in real-life scenes if there is a single shadow map for the whole view – but if you have some kind of frustum splitting approach, depending on your scene, this could lead to quality improvement.

There is still a problem left – if you have CLAMP filtering set for your shadow map, this approach will cause visual bugs, because now some of receivers’ points are actually out of shadow map – so if there is a caster that fills border pixels with Z value that produces shadow, the shadow  will stretch outwards. Solution? Either use BORDER filtering or when rendering to NxN shadowmap set a viewport with X = 1, Y = 1, width = N-2, height = N-2 – this will make sure that border pixels are not affected with casters. This is a small price to pay for potentially tighter frustum.

Now we have tight XY extents, and we’ll have to solve problems with Z.

Let’s suppose we’ve chosen ZN and ZF as our Z extents. This would mean that:

1. All casters are clipped by ZN and ZF
2. Shadow map contain depth values in range [0..1] in light PPS
3. All receivers points that have Z < ZN will have Z < 0 in light PPS
4. All receivers points that have Z > ZF will have Z > 1 in light PPS

At first, we can’t let our casters be clipped by near plane – this would produce artifacts – so the resulting ZN value has to be less or equal to casters’ minimal Z value. If there are no receivers with Z < casters.min_z, there is no sense to push ZN further (to decrease ZN, that is). If there ARE receivers left with Z < casters.min_z, then there should not be any shadows there. Let’s look at our shadow test.

```cpp
float is_in_shadow = shadowmap_depth < pixel_depth ? 1 : 0;
```

For receivers’ points with Z < ZN, pixel_depth is below 0, and the test always returns false, so is_in_shadow = 0 – this is actually what we want. So there is no need to make ZN less than casters.min_z, thus ZN = casters.min_z.

For receivers’ points with Z > ZF, the situation is opposite – pixel_depth is above 1, and the test always returns true, thus making all receivers points with Z > ZF shadowed. This means that there should be no receivers’ points with Z > ZF, so ZF is greater or equal than receivers.max_z.

Is there any reason to push ZF beyond that? No. No, because we don’t care about casters points that have Z > receivers.max_z – they are not going to cast shadows on any receiver anyway. Thus ZF = receivers.max_z.

Now that we have our XY and Z extents, we construct a scaling/biasing matrix that maps [min_x..max_x] x [min_y..max_y] x [ZN .. ZF] to [-1..1] x [-1..1] x [0..1] (or to [-1..1] x [-1..1] x [-1..1] in case you’re using OpenGL), and multiply your light viewprojection matrix by this matrix. By the way, the scaling/biasing matrix is of course equal to the corresponding orthographic projection matrix, so you can use existing functions like D3DXMatrixOrthoOffCenterLH to compute it.

Now that we’ve solved the problem for uniform shadow mapping, let’s move on to various perspective reparametrization algorithms.

### Trapezoidal Shadow Mapping

The brief outline of TSM algorithm is as follows – construct light viewprojection matrix, transform receivers’ points to light PPS, approximate them by a trapezoid, construct a matrix that maps trapezoid to unit cube, multiply light viewprojection matrix by the trapezoid mapping matrix.

Thus applying unit cube clipping to TSM is very simple – you first construct a tight frustum for uniform shadow mapping (see above), and then use it for TSM, with no further corrections. This produces correct extents in the resulting matrix.

As we selected XY extents as intersection of casters’ and receivers’ extents, the slightly more correct approach would be to use not the receivers’ points for trapezoidal approximation, but rather points of the receivers’ volume, clipped by planes that correspond to the chosen XY extents. However, my experiments resulted in no significant quality improvement – texel distribution was good enough without this step.

Also note, that as TSM produces a frustum with relatively high FOV, the distortion of post-perspective W coordinate can affect Z coordinate badly. Some solutions for these problems are already presented in the original TSM paper (though expect another post about various methods for fixing Z errors).

### Light-space Perspective Shadow Mapping

The brief outline of LiSPSM algorithm is as follows – construct light space with certain restrictions, transform all “interesting” points in the light space, build a perspective frustum that encloses all points, transform it back from light space to world space.

The problem is that if you treat only receivers’ points as “interesting”, you get shadow clipping due to Z extents; if you treat both receivers’ and casters’ points as “interesting”, the shadows are correct, but you get worse texel distribution. Also you can’t really fix Z extents AFTER you’ve computed the frustum – because perspective projection has singularities for points on plane with Z == 0, and occasionally some caster point gets near this plane and you get very high post-perspective Z extents, which screw the Z precision.

In short, I don’t know a good solution. If the light faces the viewer, we can use the approach for normal positional light for PSM (read below). Otherwise, it does not seem we can do anything. Currently I focus my frustum on both casters’ and receivers’ points. If you know a solution, I’d be more than happy to hear it.

### Perspective Shadow Mapping

Note that I am not going to describe unit cube clipping for the PSM from the original paper by Stamminger and Drettakis, because there is a much better PSM algorithm, described in GPU Gems 1 by Simon Kozlov (Chapter 14, “Perspective Shadow Maps: Care and Feeding”).

The brief outline of the algorithm is as follows – construct virtual camera which is essentially a real camera slid back a bit to improve quality (to improve zf/zn ratio), transform light to virtual camera PPS. If it’s a directional light in PPS (which means that light’s direction was orthogonal to view direction), construct uniform shadow mapping matrix for the light direction in PPS (of course you should transform all casters and receivers to PPS). The resulting matrix should first transform incoming points to virtual camera PPS, and then transform them by uniform shadow mapping matrix.

If light is a positional one in PPS (which, of course, happens most often), then at first compute a bounding cone with center in light PPS around all receivers’ points (transformed to PPS again, of course). Then we have two cases – either light in PPS becomes an inverted one – that happens if light is shining from behind the viewer, i.e. Z coordinate of light direction in view space is positive – or light is a normal one. For further reference I suggest you read Stamminger and Drettakis paper (STAMMINGER M., DRETTAKIS G.: Perspective shadow maps. In Proceedings of SIGGRAPH(2002), pp. 557.562.). 

If light is a normal one, then all casters that can possibly cast shadows on visible receivers’ regions are in front of virtual camera’s near plane – so we can construct a normal shadow mapping matrix from bounding cone parameters. If light is an inverted one, then usual shadow mapping matrix will not contain all casters; therefore Kozlov proposes to use an “inverse projection matrix” which is constructed by specifying –z_near as near plane value and z_near as far plane value. Again, for further reference I suggest you read his paper.

Now, we want to perform unit cube clipping, and there are actually three cases we have to resolve (directional light in PPS, positional light in PPS, inverted positional light in PPS). Why do we have problems? Well, at first, while all receivers points are inside original view frustum (and thus they are inside virtual view frustum), because we clipped receivers’ volumes, caster points are arbitrary, and so there are singularities for caster points with view space Z close to 0.

In case of normal positional light in PPS (directional light that shines in our face), we don’t care about casters that are beyond near plane; so we can clip our casters by near plane, and all caster points will be well-defined in post-projective space, which means that after we’ve computed the projection in PPS from bounding cone, we can find receivers’ and casters’ extents and use the same algorithm we had for uniform shadow mapping – just multiply the light matrix in PPS by unit cube clipping matrix (this will extend light frustum in PPS to hold all needed caster points).

Theoretically, you’ll need precise geometrical clipping of caster volumes by near plane. However, in practice, for my test scenes the simple approach of computing extents only for points in front of near plane worked well. Your mileage may vary.

In case of inverted positional light in PPS, we can no longer clip by near plane, because we’ll clip away potential casters. What we’d like to do instead is to take Z extents as in normal unit cube clipping for all caster points, and modify the shadow mapping matrix as usual. Why can’t we do that (and, as a matter of fact, why could not we do that for normal positional light in PPS, why do we need camera clipping)?

Well, the problem is, that if there are caster points with view-space Z near 0, the PPS Z extents of casters become very huge. As we use casters’ minimal Z value as our Z near value, this can lead to huge extents of unit cube clipping matrix, which makes Z precision very bad. For positional light in PPS, we avoid this by clipping casters by near plane, so that we no longer have casters with very big coordinates in PPS.

Luckily, with inverse projection matrix we can easily solve that – just clip casters’ minimal Z value with some small negative value, i.e. -10. (Note: here and below, “casters’ minimal Z value” refers to minimal Z value of casters transformed first to virtual camera PPS, and  then by shadow mapping matrix).

Why does it work? Well, with normal perspective matrix, if we decrease Z near value’s magnitude (i.e. decrease the actual Z near value, as it’s positive for normal matrix), we enlarge our viewing frustum. It turns out that for inverse projection matrix, decreasing Z near value’s magnitude again enlarges viewing frustum – and clipping Z near by some negative value decreases its magnitude, while increasing the actual value.

Finally, if the light is a directional one in PPS, we can clip casters by camera’s near plane too, as we did in case of normal positional light.

Recap:

1. If light is a directional one in PPS, construct uniform shadow mapping matrix as in first part of this post, only using casters clipped by camera near plane (either by geometrical clipping or just by throwing away caster points which are beyond near plane).

2. If light is a positional one in PPS, construct bounding cone with center in light’s position that holds all receiver points. Then, for normal (non-inverted) light, construct shadow mapping matrix (view matrix: simple view matrix with eye position = light’s position, view direction = bounding cone direction, and arbitrary up vector; projection matrix: matrix with FOV wide enough to hold the whole bounding cone, and Z extents that encompass all receiver points), and perform unit cube clipping, only using casters clipped by camera near plane.

For inverted light, construct an inverted projection matrix instead of a normal one, and instead of clipping casters clip casters’ minimal Z value.

Thanks to Simon Kozlov for suggesting solution for shadow clipping problems, basically all the text in this section consists of his ideas.

### eXtended Perspective Shadow Mapping

I am not going to describe algorithm and clipping problems in details, as they are well summarized in the original paper. The only mention I will make is that at the step 11 of the algorithm, all points with w < epsilonW are clipped. This sometimes causes clipping of shadows. The solution is to modify the extents building procedure as follows: instead of throwing away points with w < epsilonW completely, just don’t compute Z bounds for them. This is a hack, and it works only because we’re doing 2D rectangle intersection while doing unit cube clipping.

The author of the algorithm knows about the problem. We discussed several approaches that lead to fixing it, and this was the best one we could come up with for now.
