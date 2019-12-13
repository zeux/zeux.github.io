---
layout: post
title: Three years of Metal
excerpt_separator: <!--more-->
---

3 years ago, we ported our renderer to Metal. It didn’t take much time, it was a blast and it worked really well on iOS. Today Metal is in better shape than ever - and I’d like to talk a bit about that.

But first, if you have not read the original article, [you might want to start with that](/2016/12/01/metal-retrospective/); most of that still holds today.

<!--more-->

# Metal in 2019

The biggest changes that happened to Metal from my point of view in the last 3 years are about adoption at a massive scale.

3 years ago, a quarter of iOS devices had to use OpenGL. Today, for our audience, this number is ~2% - which means our OpenGL backend barely matters anymore. We still maintain it but this will not continue for long.

The drivers are also better than ever - generally speaking we don’t see driver issues on iOS, and when we do they often happen on early prototypes, and by the time the prototypes make their way to production, the issues are usually fixed.

We’ve also spent some time improving our Metal backend, focusing on three areas:

## Reworking the shader compilation toolchain

One other thing that happened in the last three years is the release and development of Vulkan. While it would seem that the APIs are completely different (and they are), Vulkan ecosystem gave the rendering community a fantastic set of open-source tools that, when combined, result in an easy-to-use production quality compilation toolset.

We used the libraries to build a compilation toolchain that can take HLSL source code (using various DX11 features including compute shaders), compile it to SPIRV, optimize the said SPIRV, and convert the resulting SPIRV to MSL (Metal Shading Language). It replaces our previous toolchain that could only use DX9 HLSL source as an input and had various correctness issues for complicated shaders.

It is somewhat ironic that Apple didn’t have anything to do with this, but here we are. Huge thanks to the contributors and maintainers of [glslang](https://github.com/KhronosGroup/glslang), [spirv-opt](https://github.com/KhronosGroup/SPIRV-Tools) and [SPIRV-Cross](https://github.com/KhronosGroup/SPIRV-Cross). We have contributed a set of patches to these libraries to help us ship the new toolchain as well, and use it to retarget our shaders to Vulkan, Metal and OpenGL APIs.

## macOS support

macOS port was always a possibility but wasn’t a big focus for us until we started missing some features and decided that we should invest into Metal on macOS to get faster renderer and unlock some future projects.

From the implementation perspective, this wasn’t very hard at all. Most of the API is exactly the same; other than window management, the only area that required substantial tweaks was memory allocation. On mobile, there’s a shared memory space for buffers and textures whereas on desktop, the API assumes a dedicated GPU with its own video memory.

It’s possible to quickly work around that by using managed resources, where the Metal runtime takes care of copying the data for you. This is how we shipped our first version, but we later reworked the implementation to more explicitly copy resource data using scratch buffers so that we could minimize the system memory overhead.

The biggest difference between macOS and iOS was stability. On iOS we were dealing with just one driver vendor on one architecture, whereas on macOS we had to support all three vendors (Intel, AMD, NVidia). Additionally, on iOS we - luckily! - skipped the *first* version of iOS where Metal was available, iOS 8, and on macOS this was not practical because we would get too few users to use Metal at the time. Because of the combination of these issues, we have hit many more driver issues in both relatively innocuous and relatively obscure areas of the API on macOS.

We still support all versions of macOS Metal (10.11+), although we started removing support and switching to legacy OpenGL backend for some versions with known shader compiler bugs that are hard for us to work around, e.g. on 10.11 we now require macOS 10.11.6 for Metal to work.

The performance benefits were in line with our expectations; in terms of market share, today we are at ~25% OpenGL and ~75% Metal users on macOS platform, which is a pretty healthy split. This means that at some point in the future it may be practical for us to stop supporting desktop OpenGL at all, as no other platforms we support use it, which is great in terms of being able to focus on APIs that are easier to handle and get good performance with.

## Iterating on performance and memory consumption

We are historically pretty conservative with the graphics API features that we use, and Metal is no exception. There are several big feature updates that Metal has acquired over the years, including improved resource allocation APIs with explicit heaps, tile shaders with Metal 2, argument buffers and GPU-side command generation, etc.

We mostly don’t use any of the newer features - so far, the performance has been reasonable, and we’d like to focus on improvements that apply across the board, so something like tile shaders, that requires us to implement very special support for it throughout the renderer and is only accessible on newer hardware, is less interesting.

Having said that, we spent some amount of time tuning various parts of the backend to just run *faster* - using completely asynchronous texture uploads to reduce stuttering during level loads, which was completely painless, doing the aforementioned memory optimizations on macOS, optimizing CPU dispatch in various places of the backend by reducing cache misses etc., and - one of the only newer features we have explicit support for - using memoryless texture storage when available to significantly reduce the memory required for our new shadow system.

# Future

Overall, the fact that we didn’t have to spend too much time on Metal improvements is actually a good thing - the code that was written 3 years ago, largely speaking, works and is fast and stable, which is a great sign of a mature API. Porting to Metal was a great investment, given the amount of time it took and the continuous benefits it gives us and our users.

We constantly reevaluate the balance between the amount of work we do for different APIs - it is very likely that we will need to dive deeper into more modern parts of Metal API for some of the future rendering projects; if it does happen, there's probably going to be another post about this!
