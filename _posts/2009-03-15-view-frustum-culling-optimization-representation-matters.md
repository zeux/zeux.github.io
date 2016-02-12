---
layout: post
title: View frustum culling optimization - Representation matters
redirect_from: "/2009/03/15/view-frustum-culling-optimization-–-representation-matters/"
---

Before getting into professional game development I've spent a fair amount of time doing it for fun (in fact, I still do it now, although less intensively). The knowledge came from a variety of sources, but the only way that I knew and used to calculate frustum planes equations was as follows – get the equations in clip space (they're really simple – (1, 0, 0, 1), (0, -1, 0, 1), etc.) and then get world space ones by transforming the planes with inverse transpose of view projection camera matrix [correction: in fact, you need to transform with inverse transpose of inverse view projection matrix, which equals to just transpose of view projection matrix]. It's very simple and intuitive – if you know a simple way to express what you need in some space, and a simple way to transform things from that space to your target one, you're good to go.

Imagine my surprise when I started doing game development as a day job and after some time accidentally stumbled upon a piece of our codebase that calculated frustum planes in a completely different way. Given a usual perspective camera setup, it calculated frustum points via some trigonometry (utilizing knowledge about vertical/horizontal FOV angles, near/far distances and the fact that it's a perspective camera without any unusual alterations), and then used them to obtain the equations. I thought it to be very weird – after all, it's more complex and is constrained to specific camera representation, whereas clip space method works for any camera that can be set up for rendering (orthographic projection, oblique-clipping, etc.).

But as it turns out, the same thing can be said about our culling code. It's quite good at culling given box against an arbitrary set of planes (i.e. if you use it for portal/anti-portal culling with arbitrary shape of portals/occluders), but since we have a usual frustum, maybe we can improve it by going to clip space, entirely skipping world space? Let's try it.

We're going to transform AABB points to clip space, and then test them against frustum planes in clip space. Note that we can't divide by w after transforming – that will lead to culling bugs because post-projective space exhibits a discontinuity at the plane with equation z = 0 in view space; however, this is not needed – the frustum plane equations in clip space are as follows:

```
x >= -w, x <= w: left/right planes
y >= -w, y <= w: top/bottom planes
z >= 0, z <= w: near/far planes
```

Note that if you're using OpenGL clip space convention, the near plane equation is z >= -w; this is a minor change to the culling procedure.

First, to transform points to clip space, we're going to need a world view projection matrix – I hope the code does not require any additional explanations:

```cpp
static inline void transform_matrix(struct matrix_t* dest, const struct matrix_t* lhs, const struct matrix_t* rhs)
{
#define COMP_0(c) \
    qword res_ ## c = si_fm((qword)lhs->row2, SPLAT((qword)rhs->row ## c, 2)); \
    res_ ## c = si_fma((qword)lhs->row1, SPLAT((qword)rhs->row ## c, 1), res_ ## c); \
    res_ ## c = si_fma((qword)lhs->row0, SPLAT((qword)rhs->row ## c, 0), res_ ## c); \
    dest->row ## c = (vec_float4)res_ ## c;


#define COMP_1(c) \
    qword res_ ## c = si_fma((qword)lhs->row2, SPLAT((qword)rhs->row ## c, 2), (qword)lhs->row3); \
    res_ ## c = si_fma((qword)lhs->row1, SPLAT((qword)rhs->row ## c, 1), res_ ## c); \
    res_ ## c = si_fma((qword)lhs->row0, SPLAT((qword)rhs->row ## c, 0), res_ ## c); \
    dest->row ## c = (vec_float4)res_ ## c;

    COMP_0(0);
    COMP_0(1);
    COMP_0(2);
    COMP_1(3);

#undef COMP_0
#undef COMP_1
}
```

After that we'll transform the points to clip space, yielding 2 groups with 4 vectors (x, y, z, w) in each one; the code is almost the same as in the previous post, only we now have 4 components:

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
```

```cpp
// transform points to clip space
qword points_cs_0[4];
qword points_cs_1[4];

transform_points_4(points_cs_0, minmax_x, minmax_y, minmax_z_0, &clip);
transform_points_4(points_cs_1, minmax_x, minmax_y, minmax_z_1, &clip);
```

If all 8 clip-space points are outside left plane, i.e. if for all 8 points p.x <= -p.w, then the box is completely outside. Since we're going to use SoA layout, such tests are very easy to perform. We'll need a vector which contains -w for 4 points; SPU do not have a special negation instruction, but you can easily emulate it either by subtracting from zero or by xoring with 0x80000000. Theoretically xor is better (it has 2 cycles of latency, subtract has 6), but in our case there is no difference in speed; I'll use xor nonetheless:

```cpp
// calculate -w
qword points_cs_0_negw = si_xor(points_cs_0[3], (qword)(vec_uint4)(0×80000000));
qword points_cs_1_negw = si_xor(points_cs_1[3], (qword)(vec_uint4)(0×80000000));
```

Now we'll calculate “not outside” flags for each plane; the method is exactly the same as in previous post (as is the final result computation), only now we're not doing dot products.

```cpp
// for each plane…
#define NOUT(a, b, c, d) si_orx(si_or(si_fcgt(a, b), si_fcgt(c, d)))

qword nout0 = NOUT(points_cs_0[0], points_cs_0_negw, points_cs_1[0], points_cs_1_negw);
qword nout1 = NOUT(points_cs_0[3], points_cs_0[0], points_cs_1[3], points_cs_1[0]);
qword nout2 = NOUT(points_cs_0[1], points_cs_0_negw, points_cs_1[1], points_cs_1_negw);
qword nout3 = NOUT(points_cs_0[3], points_cs_0[1], points_cs_1[3], points_cs_1[1]);
qword nout4 = NOUT(points_cs_0[2], (qword)(0), points_cs_1[2], (qword)(0));
qword nout5 = NOUT(points_cs_0[3], points_cs_0[2], points_cs_1[3], points_cs_1[2]);

#undef NOUT
```

This is the final version. It runs at 104 cycles per test, so it's slightly faster than the last version. But this method is better for another reason – we've calculated clip space positions of box vertices as a by-product (also we've calculated world view projection matrix, but it's likely to be of little further use, because usually shader constant setup happens at a later point in another module). Some things you can do with them:

* Feed them as an input to the rasterizer to do rasterization-based occlusion culling (simple depth buffer, HOM, etc.). This is the road I have not taken yet, though I hope I will do it some day.

* Use them for screen size culling – if your bounding box when projected to the screen is small enough (i.e. less than 3x3 pixels), you usually can safely throw it away. This is what I do in our production code; it involves dividing positions by w (don't forget to discard the size culling results if any point has w < epsilon!), computing min/max x/y for the results, subtracting min from max and checking if the difference along each axis is less than threshold. The actual implementation is left as an exercise to the reader.

This concludes the computation part of view-frustum culling. There is still something to do here – there is p/n-vertex approach which I did not implement (but I'm certain that it won't be a win over my current methods on SPUs); there are minor potential improvements to the current code that are not worth the trouble for me; all implemented tests return only binary result (outside / not outside), a ternary version can help in hierarchical culling (though this can be achieved with a minor modification to all presented code). There might be something else I can't think of now – post a comment if you'd like to hear about other VFC-related topics!

I'm going to write one final post regarding VFC, which deals with the code that will use is_visible to perform culling of the given batch array – the topics include DMA and double buffering; after that the whole VFC series will be over and I'm going to switch to something different.

The complete source for this post can be [grabbed here](https://gist.github.com/zeux/1fb08fb04ae97c79852e).

View Frustum Culling series contents:

>1. [Introduction](/2009/01/31/view-frustum-culling-optimization-introduction/)
2. [Vectorize me](/2009/02/08/view-frustum-culling-optimization-vectorize-me/)
3. [Structures and arrays](/2009/02/15/view-frustum-culling-optimization-structures-and-arrays/)
4. [Never let me branch](/2009/03/01/view-frustum-culling-optimization-never-let-me-branch/)
5. **Representation matters**
6. [Balancing the pipes](/2010/09/11/view-frustum-culling-optimization-balancing-the-pipes/)