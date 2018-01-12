---
layout: post
title: Hashes, hazards and vfptr
redirect_from: "/2009/03/22/miscellanea/"
---

There is a bunch of small notes I'd like to share – none of them deserves a post, but I don't want them to disappear forever.

### Using hash table as a fixed-size cache

When I worked with Direct3D 10, I found state objects quite cumbersome to work with – they're very slow to create (or at least were back then) and the exact separation of states into objects was sometimes inconvenient from design point of view. Also I've already had a set of classes that divided states into groups and functions like setDepthState with redundancy checking, so I needed to write an implementation for existing interface. The solution I came up with was very simple and elegant, so I'd like to outline it once more (although I sort of mentioned it in the [original post](/2007/10/06/render-state-rant/)).

The natural thing to do here is to cache state object pointer inside state class, and recompute it if necessary (when binding newly created/modified state). There are two issues to solve here – 1. state object creation is expensive (even if you're creating an object with the same data several times in a row – in which case D3D10 runtime returns the same pointer – the call takes 10k cycles), 2. there is a limit on the amount of state objects (4096 for each type). Solving the first one is easy – just make a cache with key being state object description and value being the actual pointer; solving the second one is slightly harder because you'll have to evict entries from your cache based on some policy.The way I went with was to create a fixed size array (the size should be a power of two less or equal than 4096 and depends on the state usage pattern), make a hash function for state description and use this array as a cache indexed by hash. In case of cache collision the old state object got released.

I often use simple non-resizable hash tables (recent examples include path lookup table in flat file system and vertex data hash to compute index buffer from COLLADA streams), but I always insert collision handling code – but, as it turns out, in this case you can omit it and get some benefit at the same time.

### Direct3D 10 Read/Write hazard woes

While in some ways Direct3D 10 is clearly an improvement over Direct3D 9, in lots of areas the design could've been better. I surely can't count all deficiencies using my both hands, but some problems annoy me more than the others. One of the things that leads to possible performance/memory compromises is resource Read/Write hazard. There are several inputs for various stages (shader resources (textures, buffers), constant buffers, vertex/index buffers) and several output ones (render targets, depth surfaces, stream out buffers), and there are resources that can be bound to both input and output stage; for example, you can bind a texture to output stage as a render target, then render something to it, and then bind the same texture as a shader resource so that shader can sample rendered data from it. However, Direct3D 10 Runtime does not allow a resource to be bound to both input and output stage at the same time.

One disadvantage is that sometimes you'd like to do an in-place update of render target – for example, to do color correction or some other transformation. In fact, this is a perfectly well-defined operation – at least on NVidia hardware – if you're always reading the same pixel you're writing to; otherwise you'll get old value for some pixels and new one for others. Here there is an actual read/write hazard, but due to the specific hardware knowledge we can exploit it to save memory.

Another disadvantage is that a resource being bound to output pipeline stage does not mean it's being written to! A common example is soft particles – Direct3D 10 introduced cross-platform unified depth textures so that you can apply postprocessing effects that require scene depth without extra pass to output depth in a texture or MRT – you can use the same depth buffer you were using for scene render as a texture input to the shader. While this works perfectly for post processing (except for the fact that you can't read depth from MSAA surfaces – ugh...), it fails miserably for soft particles. You usually disable depth writes for particles so there is no real read/write hazard, but because the runtime thinks there is one you can't bind depth buffer so that HW performs depth test – you can only do depth testing in pixel shader yourself via discard. This disables early coarse/fine Z culling, which results in abysmal performance.

Luckily MSAA depth readback is supported in D3D10.1, and in D3D11 you can bind resources to output pipeline stages as read-only. Too bad there is no D3D11 HW yet, and D3D10.1 is not supported by NVidia...

### Knowing the class layout – vfptr

There are two weird points regarding class layout and vfptr (virtual function table pointer) that I'd like to note here – they are related to very simple cases, I'm not going to talk about multiple or god forbid virtual inheritance here.

Why do you need to know class layout? Well, it's useful while writing code so your classes can occupy less space, it's extremely useful while debugging obscure bugs, and you can't even start doing in-place loading/saving without such knowledge (I think I'll make a special post regarding in-place stuff soon). And don't even get me started on debuggers that can't display anything except registers and (if you're lucky) primitive locals – we used to have such debugger on PSP, and CodeWarrior for Wii is only slightly better.

Anyway, the first weird point is related to CodeWarrior – it had been like this on PS2, and it's like this on Wii – I doubt that'll ever change. You see, while on normal compilers there is no way to control vfptr placement – for simple classes without inheritance it always goes in the first word – on CodeWarrior it lies in the place of declaration – except that you can't declare vfptr in C++, so it lies in the place where the first virtual function is declared. Some examples follow:

```cpp
// layout is vfptr, a, b
struct Foo { virtual void foo1(); unsigned int a; unsigned int b; };

// layout is a, vfptr, b
struct Foo { unsigned int a; virtual void foo1(); unsigned int b; };

// layout is a, vfptr, b
struct Foo { unsigned int a; virtual void foo1(); unsigned int b; virtual void foo2(); };

// layout is a, b, vfptr
struct Foo { unsigned int a; unsigned int b; virtual void foo2(); };
```

Marvelous, isn't it? Now there is an entry in our coding standard at work which says “first virtual function declaration has to appear before any member declarations”.

The second point was discovered only recently and appears to happen with MSVC. Let's look at the following classes:

```cpp
struct Foo1 { virtual void foo1(); unsigned int a; float b; };
struct Foo2 { virtual void foo1(); unsigned int a; double b; };
```

Assuming sizeof(unsigned int) == 4, sizeof(float) == 4, sizeof(double) == 8, what are the layouts of the classes? A couple of days ago I'd say that:

```
Foo1: 4 bytes for vfptr, 4 bytes for a, 4 bytes for b; alignof(Foo1) == 4
Foo2: 4 bytes for vfptr, 4 bytes for a, 8 bytes for b; alignof(Foo2) == 8
```

And in fact this is exactly the way these classes are laid out in GCC (PS3/Win32), CodeWarrior (Wii) and other relatively sane compilers; MSVC however chooses the following layout for Foo2:

```
Foo2: 4 bytes for vfptr, 4 bytes of padding, 4 bytes for a, 4 bytes of padding, 8 bytes for b; alignof(Foo2) == 8
```

Of course the amount of padding increases if we replace double with i.e. __m128. I don't see any reason for such memory wastage, but that's the way things are implemented, and again I doubt this will ever change.

### Optimizing build times with Direct3D 9

Yesterday after making some finishing touches to D3D9 implementation of some functions in my pet project (which is coincidentally a game engine wannabe), I hit rebuild and could not help noticing the difference in compilation speed for different files. The files that did not include any heavy platform-specific headers (such as windows.h or d3d9.h) were compiled almost immediately, files with windows.h included were slightly slower (don't forget to define WIN32_LEAN_AND_MEAN!), and files with d3d9.h were slow as hell compared to them – the compilation delay was clearly visible. Upon examination I understood that including windows.h alone gets you 651 Kb of preprocessed source (all numbers are generated via cl /EP, so the source doesn't include #line directives; also WIN32_LEAN_AND_MEAN is included in compilation flags), and including d3d9.h results in a 1.5 Mb source.

Well, I care about compilation times, so I decided to make things right – after all, d3d9.h can't require EVERYTHING in windows.h and other headers it includes. After half an hour of work, I arrived with minid3d9.h (which can be [downloaded here](https://gist.github.com/zeux/4c763996ce8e45eb8077)).

Including minid3d9.h gets you 171 Kb of preprocessed source, which is much better. This file defines everything that's necessary for d3d9.h and also a couple of things my D3D9 code used (i.e. SUCCEDED/FAILED macros); you might need to add something else – it's not always a drop-in replacement. Also I've taken some measures that enable safe inclusion of this file after CRT/Platform SDK headers, but don't include it before them – generally, include it after everything else.

This decreased the full rebuild time by 30% for me (even though D3D9 code is less than 15% in terms of code size and less than 10% in terms of translation unit count) – I certainly expected less benefit! You're free to use this at your own risk; remember that I did not test in on 64-bit platform so perhaps it needs more work there.
