---
layout: post
title: My own lighting shader with blackjack and hookers
---

So, yesterday we were discussing various lighting approaches at local IRC chat, and someone said that it was impossible to make a ps.2.0 single-pass lighting shader for 8 lights with diffuse, specular and attenuation, of course with normal map. Well, I told him he was actually wrong, and that I can prove it. Proving it turned out to be a very fun and challenging task. I am going to share the resulting shader and the lessons learned with you.

From the start I knew it was not going to be easy – ps.2.0 means that no arbitrary swizzles are available (which can in some cases restrict possible optimizations), and there is a limit of 64 arithmetic instructions. Add to that the fact that there is no instruction pairing as in ps.1.x (which is rather strange, as all hardware I know of is capable of pairing vector and scalar instructions).

I decided to compute lighting in world space, as I thought that passing all lighting data from VS to PS is going to consume too much interpolators. So I passed world-space view vector, world-space position and tangent to world space conversion matrix from VS to PS, and had PS transform normal to world space and compute everything else. This proved to be insufficient to reach target result, but I am going to show you the shader anyway, as it has some interesting ideas, some of which are still in the final shader.

[Here is the shader](https://gist.github.com/zeux/01d4555fb000fa25bc3c/b7b422f8f853eb591c2f69700db64ee529637d3b). Ignore stuff like bindings.h, TRILINEAR_SAMPLER, etc. – these are to allow FX Composer bindings of parameters.

Interesting things to note:

1. For world-space lighting, there is no need to do normal expansion (normal * 2 – 1), you can encode it into tangent space -> world space conversion matrix. Saves 1 instruction.

2. Vectorize like crazy. You can do a lot of stuff cheaper if you vectorize your calculations. For example, here we have 8 lights, that’s 2 groups, 4 lights in each one. You can save instructions on computing attenuation for 4 lights at once (you get 1 mad instruction for 4 lights, instead of 1 mad instruction per light), you can save a lot of instructions for specular computations (read below), etc.

3. If you want to add a lot of scalar values, dot is your friend. dot(value, 1) will add all components of value.

4. Be smart about replacing equations with equivalent ones. For example, naïve Phong specular equation is dot(R, V), where R is reflected light vector. In this case, you have to do reflect() for each light. Reflect is not quite cheap, and, as we have 8 lights and only 64 instructions, every instruction that’s executed per light is very expensive. But dot(reflect(L, N), V) is equal to dot(reflect(V, N), L) (V is a view vector), which requires only a single reflect().

5. Specular is expensive, because pow() call is expensive. Why? Because, sadly, pow() can’t be vectorized. pow() is interpreted as three instructions, log, mul, exp (pow(a, b) is equal to exp(log(a) * b)), and neither log, nor exp have vectorized form. The result is that you’ll waste at least two instructions per light only to compute specular power.

There are several solutions. The first one is to fix specular power to some convenient value. For example, pow(a, 16) can be implemented as 4 muls (and in fact HLSL compiler does it automatically), and muls can be vectorized – so you can compute specular power for all 4 lights for 4 instructions, which is much better.

However, there is a better solution, which is described here: [A Non-Integer Power Function on the Pixel Shader](http://www.gamasutra.com/features/20020801/beaudoin_01.htm). Basically, you can approximate the function pow(x, N) with pow(max(A*x + B, 0), M). A and B can be tuned such that the maximum error is low enough for the approximation to be useable in practice, and M can be made very small, for example I use M=2, and there are no artifacts for N=18 (the results ARE different, and it can be seen by switching between formulas in realtime, but the difference is small and no one will be able to tell that you use an approximation). Alternatively, you can have your artists tune A and B directly.

The net effect is that instead of several instructions per light, we compute specular power in 2 instructions – mad_sat to compute A*x+B, and mul to compute the result (remember, M=2).

Okay, we have a bunch of cool optimizations here. Are we done? Sadly, no, we are not. The presented shader compiles into 75 instructions. The problem is that per-light cost is still too high. We have to compute a unnormalized light vector (1 sub), compute its squared length (1 dp3), normalize it (1 rsq + 1 mul), compute dot(N, L) for diffuse lighting (1 dp3), compute dot(R, L) for specular lighting (1 dp3), and combine diffuse lighting with specified colors (1 mad). This is 7*8=56 instructions, which leaves 8 instructions, and we need much more. What can we do?

Well, we can simplify our calculations and replace light colors with light intensities. This will strip 8 instructions, but add 2 instructions for multiplying NdotL vector by intensity, and 1 instruction for summing all diffuse components together (dp3), which is still not enough – we need to reserve instructions for other things (for example, normal transformation takes 3 instructions, specular computation is 4 instructions for 8 lights, attenuation is 4 instructions for 8 lights, and there are still several other things left).

Yesterday, I gave up and went to sleep. But today, after some thinking, I felt like a barrier in my head collapsed – I knew why it did not work out, and I knew the better solution.

See, it is true that we have a lot of overhead per light source. The problem is not in the fact that we need to do a lot of calculations – the problem is in that we are using computation power inefficiently.

Let’s look at the instruction counts I presented earlier. Yes, it’s true that we do 1 sub per light – but sub is capable of processing 4-float vectors, and we are using it to subtract 3-component vectors, so we lose some power here. The same stays true for everything else – all dot products and mul for example.

And the barrier that collapsed in my head had an inscription “You have the mighty dot product, use it”. As it turned out, there is not a lot of sense in treating GPU assembly differently from for example SSE instructions. We do not have dot product in SSE. Trying to compute 4 dot products at once in a straightforward way in SSE is subject to miserable failure – most likely FPU will be faster. But if you change the way your data is organized, and instead of laying it in AoS order:

```
v1.x v1.y v1.z (unused)
v2.x v2.y v2.z (unused)
v3.x v3.y v3.z (unused)
v4.x v4.y v4.z (unused)
```

lay it out in SoA order:

```
v1.x v2.x v3.x v4.x
v1.y v2.y v3.y v4.y
v1.z v2.z v3.z v4.z
```

And lo and behold, a lot of slow dot product instructions are now just 3 muls and 2 adds – simple and fast.

> This was a triumph. I’m making a note here: HUGE SUCCESS.

I decided to try the same thing with my shader code. It solved all problems like magic. [The resulting code](https://gist.github.com/zeux/01d4555fb000fa25bc3c/f0879a95cef520ffff9e47b8139eb43700cf1514) while doing exactly the same calculations, now compiles in 54 instructions.

The reason is simple, of course. For example, where in the previous shader we computed squared lengths in 1 instruction per light, here we do it for 3 instructions for 4 lights, effectively using 25% less ALU. The new layout also made it possible to pass lights via interpolators (light data fits into 6 interpolators), which allowed to remove 1 sub instruction per light, and also 3 instructions for transforming normal into tangent space (at the expense of adding 1 expand instruction, of course).

Apart from the SoA data layout, which effectively is the reason why the new shader is so much smaller, there is only one trick - instead of normalizing each vector, we correct dot product results. This saves a couple of instructions for the entire shader.

The old shader did not fit into the instruction limit, the new one does, and it has 10 spare instructions. There is a bunch of things you could do with it. For example, you can implement parallax mapping – 10 instructions should be enough for several parallax steps. Note that one interpolator can be freed (view vector can be stored in COLOR interpolator at the expense of 1 additional instruction (expand from [0,1] to [-1,1])), so you can implement shadow mapping (for example, make first light source a directional one – this is straightforward, you just have to modify vertex shader to supply correct tangent-space direction, and place 0 in light_radius_inv to disable attenuation – and add shadows for it).  
  
There is also space for some small tweaks – i.e. disable specular for triangles with dot(N, L) < 0, make wrap-around lighting, add ambient lighting, have colored specular (use a per-light color instead of the global one), add specular attenuation, etc.

Note, that a couple of instructions can still be saved if you do not want light colors, only intensities (read above).

So, this was a pleasant experience, and I am glad that I decided to write this shader. Sadly, all articles I’ve read about shader optimizations (save for one, “Bump My Shiny Metal” by Andrew Aksyonoff in ShaderX 4) are about common and trivial stuff – vectorize your computations, inspect compiler output... I hope that this post was more interesting.
