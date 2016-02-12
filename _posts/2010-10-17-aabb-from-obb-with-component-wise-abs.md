---
layout: post
title: AABB from OBB with component-wise abs
---

This post is about a neat trick that is certainly not of my invention, but that should really be more well-known; at least, I haven't heard of it till I stumbled across it while reading Box2D sources.

There are a lot of bounding volumes out there; the most widespread are certainly spheres and boxes, which come in two flavors - axis-aligned bounding boxes (AABB) with faces parallel to the coordinate planes, and oriented bounding boxes (OBB), which is essentially a AABB and an orientation matrix.

It's common to use AABB in spatial subdivision structures, like octrees, kD-trees, ABT and so on - the intersection test between two AABB is pretty straightforward. However, when dealing with dynamic meshes, it is needed to recalculate the AABB of the mesh when the mesh transformation changes.

Assuming that the mesh has a local bounding box (which is an AABB), the usual way to get world-space AABB for the mesh is as follows:

1. Get 8 corners of the mesh AABB
2. Transform all corners to the world space with the mesh transformation matrix
3. Find the component-wise minimum and maximum of the resulting 8 vectors

However, there is a better way, which reduces the amount of floating-point operations to one quarter of the above. It's easily derived once we slightly change the AABB representation - while AABB are commonly represented with two vectors, min and max, let's assume that our box is represented with the center and extent vector:

```
min = center - extent
max = center + extent
```

or

```
center = (min + max) / 2
extent = (max - min) / 2
```

Now, the 8 corners of the original AABB are in the form of center + (±extent.x, ±extent.y, ±extent.z). Transforming those by the matrix M is thus

```
M * (center + (±extent.x, ±extent.y, ±extent.z))
```

Let's expand the matrix-vector multiplication; the result looks like this:

```
M00 * (center.x ± extent.x) + M01 * (center.y ± extent.y) + M02 * (center.z ± extent.z) + M03
```
(and likewise for other two components)

We can slightly rearrange the equation to get this:
```
(M00 * center.x + M01 * center.y + M02 * center.z + M03) + (±M00 * extent.x + ±M01 * extent.y + ±M02 * extent.z)
```
(and likewise for other two components)

Now, the left part is shared by all 8 points, and is equal to M * center (i.e. to the AABB center, transformed to the world space); this is the center of the new AABB.

The right part is different for all points; however, it's obvious that, since extent vector has non-negative components, that the minimum of the right part is reached when all of ±M00, ±M01, ±M02 are negative, and the maximum is reached when all of them are positive. Thus, the maximum of the right part is:

```
abs(M00) * extent.x + abs(M01) * extent.y + abs(M02) * extent.z
```
(likewise for other two components).

Note that this is the matrix-vector multiplication, with the matrix being the component-wise absolute value of the original transformation matrix, and the vector being the extent vector (which has to be transformed as if it is a direction, i.e. without taking matrix translation into account).

The resulting code looks like this (this is F# with SlimDX math classes):

```ocaml
let matrix_abs (matrix: Matrix) =
    let mutable m = Matrix()
    for i in 0..3 do
        for j in 0..3 do
            m.[i, j] <- abs matrix.[i, j]
    m

let transform_aabb_fast (aabb: BoundingBox) matrix =
    let center = (aabb.Minimum + aabb.Maximum) / 2.f
    let extent = (aabb.Maximum - aabb.Minimum) / 2.f

    let new_center = Vector3.TransformCoordinate(center, matrix)
    let new_extent = Vector3.TransformNormal(extent, matrix_abs matrix)

    BoundingBox(new_center - new_extent, new_center + new_extent)
```

Instead of 8 shuffles, 8 matrix-point multiplications and 8 vector min+max operations, we need to convert the AABB to and from center+extent representation (extent can be alternatively computed as aabb.Maximum - center) and do one matrix-point and one matrix-direction multiplications, which is usually faster.

In case the original mesh bounding volume was an OBB (in my experience, this is usually not necessary, as local-space AABB give a good enough approximation for common cases, but still), this can be applied in the same way - you'll have to get a full transformation matrix by multiplying the OBB and mesh transformation matrices.

When I've seen this in Box2D, at first I did not understand why the code works at all - the meaning of component-wise absolute value is not immediately obvious. Now I know; and I hope that this was of some interest to you.
