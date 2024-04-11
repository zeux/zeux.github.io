---
layout: post
title: Meshlet triangle locality matters
excerpt_separator: <!--more-->
---

When working with mesh shaders, the geometry needs to be split into meshlets: small geometry chunks where each meshlet has a set of vertices and triangle indices that refer to the vertices inside each meshlet. Mesh shader then has to transform all vertices and emit all transformed vertices and triangles through the shader API to the rasterizer. When viewed through the lens of traditional vertex reuse cache, mesh shaders seemingly make the reuse explicit so you would think that vertex/triangle locality within one meshlet doesn't matter.

You would be wrong.

<!--more-->

# Construction

As covered [in an earlier post](/2023/01/16/meshlet-size-tradeoffs/), it's non-trivial to select an optimal meshlet configuration, as it presents a challenging balance between improving vertex reuse and maintaining reasonable meshlet culling rates; additionally, on different GPUs the meshlet execution maps differently to the underlying hardware, with various efficiency criteria[^1]. Once we do select a meshlet configuration, splitting geometry into meshlets becomes non-trivial: not only are there a lot of different possible ways to split a mesh into fixed-size meshlets, but it's not even clear what we need to optimize for!

[meshoptimizer](https://github.com/zeux/meshoptimizer) provides two algorithms for this task: `meshopt_buildMeshletsScan` and `meshopt_buildMeshlets`.

`meshopt_buildMeshletsScan` expects an index sequence that is optimized for vertex reuse, and splits it into meshlets such that a meshlet always corresponds to the longest subsequence that still satisfies meshlet limits; when a limit is exceeded, a new meshlet starts. This algorithm is very fast and is suitable to run at load time when working with mesh shaders using meshes that were optimized for the traditional rasterization pipeline, but can often produce too many meshlets or meshlets that are not spatially coherent.

`meshopt_buildMeshlets`, on the other hand, aggregates triangles into meshlets using heuristics that maximize topological and spatial proximity: the goal is to minimize the amount of border vertices that waste vertex reuse potential, and keep the triangles of a given meshlet clustered together (plus, optionally, keep the triangle normals of a given meshlet pointing in roughly the same direction to improve cone culling rejection rates).

`meshopt_buildMeshlets` is a better algorithm. On most meshes, it produces fewer meshlets than `meshopt_buildMeshletsScan` (usually by 1-3%), and the meshlets can be more easily culled by various meshlet culling techniques (resulting in 1-5% more meshlets culled). The `Scan` variant is really only provided for load-time use, where the extra cost of running the full `buildMeshlets` algorithm may be prohibitive.

# Discovery

As I was investigating results from a recent academic publication[^2], some things didn't quite add up. The testing was done using [niagara](https://github.com/zeux/niagara/), and depending on the algorithms being selected and the parameters they were run with, the meshes would sometimes get *more* meshlets but render *faster*. By itself this is not necessarily surprising: niagara uses a series of culling optimization steps; but what's surprising is that there would be cases where a particular split into *more* meshlets would produce as many output triangles or more, but render *faster*.

During mesh shading, the mesh shader itself does some amount of work that is somewhat sensitive to the meshlet contents - for example, vertex attributes need to be fetched from the vertex buffer using potentially arbitrary indices, which could cause a variable number of cache misses. The rasterization stage then will do triangle setup and culling, which is fixed function but still takes time; and of course, depending on the order of triangles the shading may get more or less efficient due to depth rejection.

To isolate as many effects as possible, I've changed niagara locally so that no culling was performed anywhere, the mesh shader only used built-in position output (no other attributes), and changed the mesh shader to simply output `vec4(0.0)` for all vertices, which ensured minimal cost and uniform load for mesh shader itself and eliminated fragment shader overhead. The performance difference between different meshlet algorithms remained and if anything became more pronounced - what was previously a couple percent difference in performance was now 10+%.

# Investigation

With a stable and more sensitive performance environment, it became easier to experiment; after a few different attempts, I tried to use `buildMeshletsScan` and it resulted in significantly faster (10%) rendering while producing a few more meshlets. Moreover, adjusting build parameters to produce *more* meshlets often resulted in a configuration where significantly more meshlets generated via `buildMeshletsScan` were faster to render than significantly fewer, generated via `buildMeshlets`.

Since the `Scan` algorithm doesn't do anything smart, this had to have been due to the order of triangles *inside* each meshlet affecting the rendering performance. I then validated this theory by running existing vcache (`meshopt_optimizeVertexCache*`) and vfetch (`meshopt_optimizeVertexFetch`) optimization algorithms that meshoptimizer provides *on meshlet triangle data itself*, reordering data inside each meshlet individually. This ended up "fixing" all confusing results observed so far - now fewer meshlets were never slower to render as long as each meshlet was carefully optimized, and `buildMeshlets` resulted in smaller rendering times, as it should.

Curiously, while vcache (reordering triangles so that new triangles refer to more recently seen vertices) provided the major benefit, vfetch (reordering index values so that the sequence of indices inside the meshlet is relatively sequential) also helped a little bit - the numbers were on the order of 10-15% improvement from vcache optimization and 1-2% from vfetch optimization, depending on the mesh. This is despite the fact that, since the mesh shader simply emitted zero position for each vertex, the shader itself did not depend on these values at all - it simply copied them to rasterizer buffers (using `gl_PrimitiveIndicesEXT` API).

Unfortunately, this is where the detailed investigation hits a wall. Clearly, the values that are being fed to the rasterizer need to be somewhat local to get better performance, but the exact mechanism here is uncertain. Unfortunately, this happens in a fixed-function stage where APIs provide no official counters, and [NSight Graphics](https://developer.nvidia.com/nsight-graphics) only gives one counter of significance[^3] that is changing in this workload (ISBE allocation stalled), which is an indication that for meshes that are slower to render, the mesh shader spends more time waiting for available space in rasterization queue that connects mesh shader with fixed-function rasterization hardware. This is not very useful because it is possible that the problem is the size of the queue (for example, triangle indices are compacted in some way inside the queue), or that the rasterizer itself benefits from locality (for example, by caching edge equations in a short window of triangles), or both. The mesh shader active execution time was unchanged so the problem must be scoped to the rasterizer's triangle setup, but that's as much as can be said with certainty.

> Note: NSight also shows a delta in PES+VPC throughput, but this can similarly be attributed to both rasterizer not being as efficient on a different index sequence as well as not being fed quickly enough from mesh shading stage due to size limitations.

It's worth noting that AMD never mentions anything of this sort in their mesh shader optimization materials, and on my integrated AMD RDNA2 GPU there was no difference one way or the other: performance of more densely packed meshlet sequences was better regardless of the triangle order within each meshlet.[^4] 

# Solution

One of my hypotheses was that mesh shader outputs data in a buffer that uses triangle strips as a storage format. This was motivated by the fact that when `NV_mesh_shader` Vulkan extension was introduced, using mesh shaders through it reflected the number of mesh shader invocations in the pipeline statistic that normally corresponds to geometry shaders, suggesting that both use the same hardware - and geometry shaders' native output format is triangle strips. This initially seemed like a good lead, especially since using `meshopt_optimizeVertexCacheStrip` (which isn't strictly speaking producing a perfect strip order but usually produces an order fairly close to one) performed better than `meshopt_optimizeVertexCache` - however, after digging deeper and comparing performance of various orders with the number of shared edges between consecutive triangles, the theory got invalidated. I still suspect that the rasterizer stores triangles encoded in some way to reduce space which happens to benefit both strips and lists with good locality, but it's hard to know for sure[^5].

Ultimately, since we're dealing with the behavior of a fixed function unit that can only be observed by comparing performance (a mesh-specific and flimsy indicator!), I ended up experimenting for a while with a few different ways to optimize triangle sequences for locality and implemented an optimization algorithm that reorders triangles to maximize recency of seen vertices within a short window as well as reordering index values to be sequential. The algorithm is [now available in meshoptimizer](https://github.com/zeux/meshoptimizer/pull/673) as `meshopt_optimizeMeshlet` which should be [a one-line addition](https://github.com/zeux/niagara/commit/3f1098b85c9334af28614b4a6e6e959ef2f1f73b#diff-a206f3ac437c314db451b081ccbb792cec98d9b4b18766e28340e99f166dd254) to a meshlet optimization pipeline.

In the future, if more hardware details are disclosed or other vendors are found to have similar, but better documented, behavior, the algorithm can be improved further - for now, it provides a significant speedup on NVidia hardware (in a 100% rasterizer bound workload mentioned above it accelerated rendering by 10-15%; more realistically, when triangles end up actually rasterized, mesh shader is running vertex transformation and cluster culling is active, I've measured 3-5% improvement depending on the mesh on triangle-dense scenes in niagara - still a good win for something like a shadow pass!), without any detrimental effects on AMD.

# Conclusion

If you are working with meshlets, it's highly recommended to update to the latest version of meshoptimizer (or rather to the latest commit, this will be part of `0.21` that hasn't been released yet) and use the newly added `meshopt_optimizeMeshlet` function on each meshlet as part of your geometry processing pipeline. Similarly to all other optimization algorithms, it affects triangle order but doesn't affect appearance otherwise.

It's a little frustrating that these optimizations have to be discovered and developed blindly, without much information about what helps and what hurts performance from IHVs; hopefully one day NVidia will publish more detailed performance optimization guides![^6]

[^1]: AMD recently published [a blog post](https://gpuopen.com/learn/mesh_shaders/mesh_shaders-optimization_and_best_practices/) as well as [a GDC talk](https://www.youtube.com/watch?v=MQv76-q2cm8) that goes into specifics of mesh shader behavior on AMD hardware; this post will be mostly concerned with NVidia.
[^2]: This probably needs another review post, but the summary is that you should keep using the latest meshoptimizer versions for meshlet building.
[^3]: In theory, NSight Graphics Pro might have more metrics but it's not publicly available; if someone from NVidia wants to send me a build or explain what is going on, that would be great!
[^4]: I do not have an Intel Arc GPU or Apple M3 to test; for now, I am assuming this is unique to NVidia GPUs.
[^5]: In a [similar situation with hardware vertex reuse](/2020/01/22/learning-from-data/), I was able to use pipeline statistics as an accurate reflection of what happens in hardware; this allowed doing very small modifications on synthetic index buffers to understand the behavior. Doing the same analysis with only performance as a guide is very difficult and error-prone. 
[^6]: Surely with the recent ML developments gaming and graphics are just a passion project for NVidia, so it's okay to be more open ;-)
