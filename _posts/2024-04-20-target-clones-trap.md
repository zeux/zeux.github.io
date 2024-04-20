---
layout: post
title: target_clones is a trap
excerpt_separator: <!--more-->
---

In Luau, modulo operator `a % b` is defined as `a - floor(a / b) * b`, the definition inherited from Lua 5.1. While it has some numeric issues, like behavior for `b = inf`, it's decently fast to compute so we have not explored alternatives yet.

That is, it would be decently fast to compute if `floor` was fast.

<!--more-->

> This post is much shorter than usual, and it was originally written in 2022 and published [on Cohost](https://cohost.org/zeux/post/321642-target-clones-is-a-t). I'm going to experiment with posting shorter technical content like this more regularly in the coming months, including reposting my earlier Cohost posts (of which this is one of).

For example, on A64 the codegen for the [relevant C function](https://github.com/luau-lang/luau/blob/master/VM/src/lnumutils.h#L37-L40) is short and sweet, and the function is trivially inlineable:

```nasm
luai_nummod(double, double):
        fdiv    d2, d0, d1
        frintm  d2, d2
        fmsub   d0, d2, d1, d0
        ret
```

Unfortunately, on Intel architectures this isn't as simple. When compiling the native C source code with `-msse4.1` command line switch, the codegen is also simple but it uses `roundsd` instruction that requires SSE4.1 to function: an instruction set that debuted 15 years ago and yet you can't rely on it being present still.

```nasm
luai_nummod(double, double):
        movapd  xmm2, xmm0
        divsd   xmm2, xmm1
        roundsd xmm2, xmm2, 9
        mulsd   xmm1, xmm2
        subsd   xmm0, xmm1
        ret
```

Without SSE4.1, MSVC can be coerced to generate a lengthy inline SSE2 sequence with fast math pragmas, but clang insists on calling the libc function which has a substantial penalty[^1].

Ideally what we want is to synthesize two versions of the function, one with SSE4.1 and one with SSE2, and have the compiler call the right one automatically based on the hardware we're targeting at build time or are running at compile time. Fortunately, gcc 6.0 (2016) introduced a `target_clone` attribute precisely for this purpose. You can simply add the following attribute to our function:

```
__attribute__((target_clones("default", "sse4.1")))
```

and the compiler will generate two versions of the function itself, and a helper "resolver" function (see [GNU indirect function (ifunc) mechanism](https://maskray.me/blog/2021-01-18-gnu-indirect-function)) that is ran at process startup, computes the function pointer we're going to use, and stores the result in procedure linkage table (PLT) which is used to call the function via indirect calls.

Perfect - so we just add the attribute for gcc/clang and we're done!

... well.

While the attribute was implemented in gcc6 in 2016, and clang does have an implementation for that attribute, clang only supports it starting from clang 14 (released in 2022, and as such might not be your production compiler yet).

Additionally, in clang 14 there seems to be a problem that prevents use of this attribute on inline functions, as multiple resolvers are generated and they aren't correctly marked with flags for linker to merge them. This is often not a problem but it is a problem in this case - for targets like AArch64 that don't need the dispatch to begin with, or for x64 with SSE4.1 used as a compilation target, we'd like the resulting function to be inlinable. The issue seems to be fixed in clang 15.

What's more, this feature is really less of a gcc feature and more of a glibc feature. When glibc is not available, this feature doesn't seem to exist - this notably includes macOS. While by default clang on macOS enables SSE4.1 these days, when targeting earlier versions of macOS using `-mmacosx-version-min=10.11`, SSE4.1 code generation gets disabled by default[^2].

Of course, even on Linux this can be a problem. Some distributions, like Alpine Linux, use [musl libc](https://musl.libc.org/) and the toolchain there doesn't support ifunc and as a consequence target_clones doesn't work either[^3].

> Now would be a great time to mention that `ifunc` was one of the mechanisms used in the recent - as of 2024 when this was reposted, not as of 2022 when this was written! - [xz backdoor](https://en.wikipedia.org/wiki/XZ_Utils_backdoor)... Something tells me `ifunc` is not coming to musl based distributions any time soon.

So yes, the `target_clones` attribute exists, and it solves the problem pretty elegantly... when it is supported, which, even 6 years after it was introduced in gcc, still is "pretty rarely". It's unfortunate that SIMD in C is full of portability problems like this - for a language that prides itself in unlocking the maximum performance, actually reaching that performance can be rather painful.

In 2023, we ended up solving the efficiency problem without using `target_clones` via manual CPUID dispatch [to set up a function pointer](https://github.com/luau-lang/luau/blob/68bd1b2349e188c374f04e00b0b5de39e18aa5c3/VM/src/lbuiltins.cpp#L1529-L1533) in cases where SSE4.1-friendly computations were part of builtin functions, a mechanism that deserves a separate post eventually.

[^1]: gcc can generate the inline SSE2 version with `-ffast-math` but that switch is unsafe to enable globally, so absent a way to enable it just for one function we're still out of luck.

[^2]: This is intentional as OSX 10.11 still supports iMacs released in 2007, that have Core 2 Duo (T7700) CPU - these support up to SSSE3, but `roundsd` is from SSE4.1.

[^3]: It's not fully clear to me which components of the system on Alpine really present the problem - this ostensibly should be a linker feature, not a libc feature, but I digress.
