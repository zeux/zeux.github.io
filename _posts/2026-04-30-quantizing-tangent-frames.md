---
layout: post
title: Quantizing tangent frames
---

I've been working on [tangent space generation](https://github.com/zeux/meshoptimizer/#tangent-spaces) recently, and also pondering the tradeoffs between QTangent and normal-angle storage. So when, in a completely unrelated discussion, someone said "you could store tangent and normal as two RGB10A2 attributes", I decided I should measure this once and for all and write it up.

This is going to be a quick post that doesn't intend to do any original research. Instead it aggregates the research that other people have done, and examines different representations from accuracy point of view. Some of these are common or obvious, but some are sufficiently obscure that people may not have heard of them.

So say you have a vertex and you would like to store tangent frames in it. Memory is at a premium and memory bandwidth is always valuable to conserve; what representation do you choose?

# Bitangent and orthogonality

First of all, we will assume that your tangent frames are orthogonal: tangent is orthogonal to the normal, and bitangent[^1] is orthogonal to both of them. The former is generally true if you use MikkTSpace for tangent construction[^2]. The latter is *not* generally true even if you use MikkTSpace - as it will happily generate a tangent frame with bitangent and tangent not really orthogonal to each other, and is correct to do so when the UV mapping is non-uniform. However, almost every production renderer in existence throws bitangents away and reconstructs them as `cross(normal, tangent.xyz) * tangent.w`; yours should too - this is a common convention and an extra vector is too much overhead to store.

Note that the tangent is a *4 component* value: a normalized vector, and a tangent frame orientation. The orientation is always either +1 or -1, and it's important to preserve it to be able to handle arbitrary UV orientation; even if your texture mapping is not "mirrored" in a traditional sense, you still may have areas of the mesh where the orientation is reversed.

In what follows, we will assume orthonormal[^3] frames: T, B and N are normalized and orthogonal to each other, forming a basis.

# Baseline

Since we only have two separate vectors to store, and they are normalized, their components are between -1 and 1. Thus, you could store them separately from each other, using three components per vector and an [SNORM encoding](/2010/12/14/quantizing-floats/); it's not entirely unreasonable to use 10 bits per component, and the orientation bit can land in one of the 4 bits we have spare. This can be our baseline.

What we can do for each encoding scheme is run it over the tangent frames of a typical mesh, encode & decode tangents and normals, and then measure the deviation between the original, 32-bit floating point vectors, and the reconstructed versions. There are different ways to look at the error but we'll look purely at the angular deviation, in degrees, and look at average and maximum errors for the two vectors separately; since bitangent is computed via a cross product, its error could be a little higher.

This gives us our first result (results are somewhat mesh-dependent but I will be using a not-too-remarkable mesh asset that exhibits similar error properties as other meshes in my dataset):

| codec | bits | n_avg | n_max | t_avg | t_max |
| --- | ---: | ---: | ---: | ---: | ---: |
| snorm10x6 | 60 | 0.0310 | 0.0949 | 0.0326 | 0.0907 |

~0.03 degrees average error for both vectors is pretty decent; however, we are using 8 bytes for this. In the rest of the post, we will look at a few 4-byte encodings instead; if you have 8 bytes to spare, this encoding is not optimal in that you could get a much lower error using the same 8 bytes, but you might not care - this error is usually small enough. In case you have tighter error tolerances than the rest of the post assumes, you can trivially extend the techniques listed below to use more bits; for example, you can often find a 16-bit gap somewhere else in your vertex (say, as a fourth component of quantized position), in which case you could expand many of the techniques below to 48 bits (16+32) and have dramatically smaller errors too.

# Octahedron encoding

[Octahedron (octahedral?) encoding](https://knarkowicz.wordpress.com/2014/04/16/octahedron-normal-vector-encoding/) gives us a way to encode each unit vector using just two components; and because we have 32 bits, we could use 8 bits per component! Well, almost, because we also need to store an orientation bit somewhere, or reduce the bit count; for now, let's see what happens if we assume the extra bit can magically go somewhere else and use 8-bit octahedral encoding for two vectors:

| codec | bits | n_avg | n_max | t_avg | t_max |
| --- | ---: | ---: | ---: | ---: | ---: |
| oct8x4 | 32 | 0.2849 | 0.9113 | 0.2882 | 0.9117 |

The good news is that we are using half as much space as we used to; the bad news is that our error is up to 10x higher than it used to be. This is not an apples-to-apples comparison as we'll see in a bit, in that not only did we switch the encoding, but we also dropped the bit count from 10 bit per axis to 8 bits for each of the two octahedral channels. This can still be a reasonable option if we had more bits to spare; for example, with 48 bits you could do 12-bit octahedral encoding for each vector in theory. But this is just a stepping stone and I mention it here not because you should use it, but to introduce the concepts gradually.

As an aside, if you use octahedron encoding, you should be aware of two important variants:

- [Nicer decoding function courtesy of Rune Stubbe](https://twitter.com/Stubbesaurus/status/937994790553227264); it is described in the post linked above, in case the Twitter link ever bursts into flames. You should *always* be using this decoding method if you need octahedron decoding.
- [Signed octahedron encoding by John White](https://johnwhite3d.blogspot.com/2017/10/signed-octahedron-normal-encoding.html). This method allows you to use an *odd* number of bits when encoding a vector; for example, here we could encode normal with octahedron encoding with 8 bits per channel, and tangent with signed-octahedron encoding with 7 bits per channel (and 1 sign bit); this would leave us 1 bit for orientation. We will come back to this.

# Quaternion encoding

Because the TBN is an orthonormal basis, we can represent it in any way that a rotation matrix can be represented; in particular, quaternions are a very useful representation. Crytek published [Spherical Skinning with Dual-Quaternions and QTangents](https://pdfs.semanticscholar.org/73b6/fa8f3ab6348975c3715c2f2d152f6b5c5296.pdf) that presents the method, where a quaternion is constructed from the matrix and can also optionally carry the orientation sign, if it's flipped into a canonical form with `w > 0`[^4]. After decoding the quaternion, we can reconstruct `w` with `sqrt` and then reconstruct the original vectors using a [quaternion-to-matrix formula](https://www.johndcook.com/blog/2025/05/07/quaternions-and-rotation-matrices/).

To store all 4 quaternion components, we must make do with just 8 bits per component, with or without aforementioned orientation packing:

| codec | bits | n_avg | n_max | t_avg | t_max |
| --- | ---: | ---: | ---: | ---: | ---: |
| quat8x4 | 32 | 0.3208 | 0.8738 | 0.3296 | 0.9022 |

This is pretty underwhelming; we are getting similar results to two-vector encoding. The quaternion we are encoding is unit-length, so it can be tempting to drop the fourth component, `.w`, and reconstruct it; this affords us 10 bits per component instead of 8. Unfortunately, while it slightly improves on the average error, it makes the worst case error much worse: reconstruction of any specific quaternion component has regions of instability where the input `.w` is small, and reconstructing it from quantized `xyz` results in 0 - which can rotate the input vector too much.

A [classical solution](https://marc-b-reynolds.github.io/quaternions/2017/05/02/QuatQuantPart1.html#:~:text=Smallest%20three) to this involves dropping the *maximum* (absolute) component and storing its index which uses an extra 2 bits. In this form we could use 10 bits per axis for the three smallest value, and adjust the quantization range as their absolute value can't exceed `sqrt(2)/2`; if we hand-wave away the orientation bit which we don't quite have space for here, we could use 10 bits per axis and a 2-bit axis index:

| codec | bits | n_avg | n_max | t_avg | t_max |
| --- | ---: | ---: | ---: | ---: | ---: |
| quat10x3+a2 | 32 | 0.0632 | 0.2046 | 0.0640 | 0.1988 |

This is getting quite reasonable; our errors are only ~2x larger than the original 8-byte representation, and we only use 32 bits for the quaternion, plus an extra orientation bit that surely you can stash somewhere else in the vertex. Unfortunately, quaternions encoded like this are a little awkward to decode on the GPU because you need to swizzle the vector based on the axis index. We could use the Cayley transform described in the article linked above, which is much nicer algebraically and *actually* has a spare bit for the orientation, but it produces larger errors in this case which is not ideal:

| codec | bits | n_avg | n_max | t_avg | t_max |
| --- | ---: | ---: | ---: | ---: | ---: |
| quat10x3-cayley | 30 | 0.1191 | 0.3202 | 0.1198 | 0.3202 |

An important property of all of these results is that the error for normal and tangent is the same. Because we are encoding a rotation, all axes of that rotation suffer equally under quantization. I'm going to make an empirical observation/argument that what we *want* here is a slightly asymmetric encoding: a lower error for normals may be desirable. Intuitively, changing the tangent direction affects the rotation of the extra normal map features whereas changing the normal direction affects lighting even if the normal map is flat; in addition, on densely tessellated meshes where normal quantization is more likely to produce visible artifacts, you're less likely to have a meaningful normal map. Finally, if the normal map is *not* flat, the quality of the normals in the normal map are also subject to quantization artifacts; although BC5 should have something like ~11 bits per channel of effective precision so perhaps tangent encoding still might be a limiting factor.

I guess my point is: are you really going to notice if the tangent vector is rotated by an extra third of a degree? Let's assume you won't.

# Tangent angle encoding

This is likely an older technique, but the earliest concrete reference I could find was in [Rendering the Hellscape of DOOM Eternal](https://advances.realtimerendering.com/s2020/RenderingDoomEternal.pdf), slide 35, and it proceeds as follows: let's encode the normal as a unit vector, for which we already know to use octahedron encoding. Given a normal vector, we can construct an arbitrary orthogonal basis; tangent vector lies in the same plane and can be expressed as a single 2D rotation angle.

DOOM encodes all three components (two normal components and tangent angle) in a byte; this is a little below our quality bar. But the important part here is that this allows us to vary the bit count we use for normal components independently from the tangent angle to hit our 32-bit limit.

Which basis should you use? It does not seem to matter that much. DOOM uses a pretty basic construction that's a subset of Hughes-Möller; for an overview of older methods I recommend [Perpendicular possibilities](https://blog.selfshadow.com/2011/10/17/perp-vectors/). The current state of the art seems to be Pixar-Duff modification of Frisvad basis construction, described in [Building an Orthonormal Basis, Revisited](https://jcgt.org/published/0006/01/01/); it only has a single point of discontinuity and is pretty cheap to reconstruct.

What *does* seem to matter a lot is that during encoding you need to build a basis from the *reconstructed* normal. Because during decoding we will not have access to our original normal, and only have a reconstructed version from the quantized representation, it is critical that the angle that we store is computed in the basis that's built from the same normal. If you use simpler basis construction, the reconstructed normal may change to a different basis region and produce a completely different coordinate space (for example, if the basis changes when `abs(Nx) > abs(Nz)`, it is possible that the original normal and the reconstructed normal disagree on which component is larger). If you use Duff/Frisvad construction, this is less likely, however there are areas of the sphere where the basis rotates quite violently, and this rotation will amplify the error if angle is encoded improperly.

Other than that, this method is straightforward; and we now have a few different bit allocation alternatives. Let's look at a few examples:

| codec | bits | n_avg | n_max | t_avg | t_max |
| --- | ---: | ---: | ---: | ---: | ---: |
| oct11x2+a10 | 32 | 0.0272 | 0.1136 | 0.0909 | 0.2065 |
| oct11x2+a9 | 31 | 0.0272 | 0.1136 | 0.1775 | 0.3588 |
| oct10x2+a11 | 31 | 0.0662 | 0.2256 | 0.0642 | 0.2256 |
| oct10x2s+a10 | 31 | 0.0444 | 0.1371 | 0.0954 | 0.2149 |

Note that in the first row, we are ignoring the problem of orientation bit storage: 11 bits * 2 components + 10 bits for the angle = 32 bits, which is our limit. However in the next three variants we explore different versions to steal this bit back: steal it from the angle (worse tangent precision), steal it from the normal (which gives us an extra angle bit for free), and use aforementioned signed octahedron encoding which uses 10 bits * 2 components + 1 sign bit + 10 bits for the angle for the grand total of 31 bits, with one bit to spare for the orientation. In other words, the last three methods are complete and require no additional storage, whereas the first one is cheating a little bit to give a cleaner picture of the resulting errors.

While in all of these, the tangent error is a little (2-3x) worse than our original `snorm10` baseline, it's unlikely to matter in practice; and the other methods are fairly close to `snorm10` in terms of normal error, and in fact the 11-bit octahedral encoding improves on it -- again, despite using half the memory.

Out of these, my personal recommendation would probably be `oct11x2+a9`: it should have enough precision for the tangent angle in practice, and it allows us to store the orientation bit inline which results in a complete tangent storage you can simply plug in. To decode this, you need to do some trigonometry... it may be cheap or expensive depending on your GPU. Which brings us to the final option on the table.

# Tangent diamond encoding

Described in Jeremy Ong's post [Tangent Spaces and Diamond Encoding](https://www.jeremyong.com/graphics/2023/01/09/tangent-spaces-and-diamond-encoding/#:~:text=%E2%80%9CDiamond%20Encoding), this is a very neat technique that can be seen as a version of tangent angle encoding, but whereas tangent angle requires `sincos` to reconstruct, here we project the direction onto a unit square in 2D space, and encode the direction in a manner similar to octahedron encoding. This gets us cheaper decoding at the expense of slightly uneven angular error.

Other than that everything relevant for tangent angle encoding applies here too: you need to select the orthogonal basis although the particular method to do it may not matter as much; and it's critical that the basis is selected based on reconstructed normal vector, which will be encoded using quantized octahedron encoding. Because we encode the diamond value separately, we have the same freedom of bit allocation.

> In that post, Jeremy argues that orientation bit could be stored elsewhere. While I handwaved the bit away in some encodings above, primarily because I was leading to the encodings that I actually like, I would *not* recommend this unless you work with very specific types of content where mirrored UVs just don't show up. Having looked at hundreds of meshes in the last few weeks, you *will* encounter plenty of meshes with both UV orientations, you *will* encounter cases where orientation changes quickly in local proximity, and you *may* even encounter meshes where orientation diverges within a triangle, making per-meshlet orientation storage impossible![^5]. Just find a bit somewhere ;)

With that in mind, let's look at the same options we've examined earlier; as a reminder, the first one needs 32 bits and doesn't have space for orientation bit (store it elsewhere!), whereas the last three reserve the orientation bit and reallocate the other bits between normal and diamond storage:

| codec | bits | n_avg | n_max | t_avg | t_max |
| --- | ---: | ---: | ---: | ---: | ---: |
| oct11x2+d10 | 32 | 0.0272 | 0.1136 | 0.0864 | 0.2374 |
| oct11x2+d9 | 31 | 0.0272 | 0.1136 | 0.1691 | 0.4485 |
| oct10x2+d11 | 31 | 0.0662 | 0.2256 | 0.0614 | 0.2324 |
| oct10x2s+d10 | 31 | 0.0444 | 0.1371 | 0.0912 | 0.2431 |

Perhaps unsurprisingly, the normal errors are exactly as they were: we are storing the normal in the exact same fashion! As far as the tangent error, the diamond storage holds up very well: the average errors are in fact a little smaller, whereas the maximum errors are a little larger. We would reasonably expect the maximum angular errors to be larger because the encoding is not uniform from the rotation perspective, but the extra error here is mostly quite reasonable. As before if I had to pick one, I would pick `oct11x2+d9`, with my next choice `oct10x2s+d10` if tangent quality is critical.

# Conclusion

As I promised, this post does not contain original research :) because of this I've also avoided showing any specific shader code for decoding. If you're interested in implementing any of this, please consult the excellent articles linked throughout the post for specifics! You need to be careful with encoding the angle/diamond based methods as I mentioned and reconstruct the basis from the decoded normal during encoding, but otherwise all of these should be easy and quick to try out.

Eyeballing the diamond encoding method, decoding a tangent frame encoded in this fashion needs ~50 ALU ops including bit manipulation if Duff/Frisvad tangent frame construction is used; this may seem high, but it's probably still cheaper than using extra vertex data and there are ways to optimize this further: if you are using texture buffers (or Metal's `unpack_unorm10a2_to_float`), then RGB10A2 decoding might be "free" in which case `oct10s+d10` is a neat representation since it only requires you to separate the sign for signed octahedron decoding from the tangent orientation, and could be 20% cheaper or so overall.

If this does still seem high, you would need to measure the resulting decoding cost and decide. Quaternion representations should be a bit cheaper to decode, but inability to redistribute the encoded bit count and inability to fit the extra bit into the 3x10+2 bit encoding is certainly not ideal.

But if you are still using 8-byte or larger tangent frames, consider that DOOM Eternal uses just three bytes, repent, and quantize away!

For convenience, here's the full table with all experiments above, although do note that some of these use the full 32 bits without space for the orientation bit, which you would need to find space elsewhere in the vertex for.

| codec | bits | n_avg | n_max | t_avg | t_max |
| --- | ---: | ---: | ---: | ---: | ---: |
| snorm10x6 (baseline) | 60 | 0.0310 | 0.0949 | 0.0326 | 0.0907 |
| oct8x4 | 32 | 0.2849 | 0.9113 | 0.2882 | 0.9117 |
| quat8x4 | 32 | 0.3208 | 0.8738 | 0.3296 | 0.9022 |
| ***quat10x3+a2*** | 32 | 0.0632 | 0.2046 | 0.0640 | 0.1988 |
| quat10x3-cayley | 30 | 0.1191 | 0.3202 | 0.1198 | 0.3202 |
| oct11x2+a10 | 32 | 0.0272 | 0.1136 | 0.0909 | 0.2065 |
| oct11x2+a9 | 31 | 0.0272 | 0.1136 | 0.1775 | 0.3588 |
| oct10x2+a11 | 31 | 0.0662 | 0.2256 | 0.0642 | 0.2256 |
| oct10x2s+a10 | 31 | 0.0444 | 0.1371 | 0.0954 | 0.2149 |
| oct11x2+d10 | 32 | 0.0272 | 0.1136 | 0.0864 | 0.2374 |
| **oct11x2+d9** | 31 | 0.0272 | 0.1136 | 0.1691 | 0.4485 |
| oct10x2+d11 | 31 | 0.0662 | 0.2256 | 0.0614 | 0.2324 |
| **oct10x2s+d10** | 31 | 0.0444 | 0.1371 | 0.0912 | 0.2431 |

[^1]: If you have been referring to these as binormals then I would respectfully ask you to [reconsider](https://terathon.com/blog/tangent-space.html#:~:text=Bitangent%20versus%20Binormal).
[^2]: Since I know too much about MikkTSpace now - for UV-degenerate triangles MikkTSpace will use tangent vector (1 0 0) which is not necessarily orthogonal to the normal as a fallback; but force orthogonalization in these cases is unlikely to hurt, and this is a topic of a separate discussion.
[^3]: Unit-length vectors are technically also a simplification; but again one that is commonly accepted. In some cases it can be useful to be able to represent zero-length tangent vectors; this can be incorporated via an extra bit or a sentinel value in some of the encodings described.
[^4]: This requires slightly tweaking `w` when it's exactly equal to 0, and requires a bit of extra care if quantization is used.
[^5]: Okay, this is a MikkTSpace special that is perhaps not hugely relevant here because it only shows up on UV-degenerate triangles where one or two corners have fallback tangents anyway, and these frames are not orthogonal. Still you should probably switch to meshoptimizer's tangent space generation where this problem is fixed ;)
