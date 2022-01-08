---
layout: post
title: On Proebsting's Law
excerpt_separator: <!--more-->
---

A friend recently learned about Proebsting's law and mentioned it to me off hand. If you aren't aware, Proebsting's law states:

> Compiler Advances Double Computing Power Every 18 Years

Which is to say, if you upgrade your compiler every 18 years, you would expect on average your code to double in performance on the same hardware.
This is in sharp contrast to Moore's law, and suggests that we should be cautious about the performance gains that compiler evolution brings. Proebsting [writes](https://proebsting.cs.arizona.edu/law.html):

> Perhaps this means Programming Language Research should be concentrating on something other than optimizations. Perhaps programmer productivity is a more fruitful arena.

I knew about the law's existence but I never really asked myself - do I believe in it?

<!--more-->

> Note: this article was published as a Gist in January 2021, but I decided to repost it in the blog form with minor edits.

# Can we measure this?

It occurred to me that I could try to do an experiment.
I could take a modern compiler and compare performance of generated code - along with perhaps a few other metrics - vs a 20-year-old one.

At least this was my initial intention; however I've long wanted to do *another* experiment which is to figure out how LLVM has changed over the years.
To combine these two I wanted to get an old version of LLVM and test it against a modern version.

To make this experiment a bit more interesting, I was going to test LLVM 1.0 - unfortunately, it only comes with 32-bit Linux binaries that I wasn't able to get to work fully due to lack of 32-bit system headers, and it segfaulted when compiling one of the source files. So we're going to test two versions of LLVM:

- LLVM 2.7. This is the first release of LLVM that contains a version of Clang that can compile C++ code.
- LLVM 11. This is the latest stable release of LLVM that I happen to have available.

LLVM 2.7 was released in April 2010, which was 11 years ago (10.5 years before the release of LLVM 11 in August 2020). So we wouldn't quite expect a 2x speedup according to Proebsting's law - only a 1.5x one.

We're going to compare these compilers on compile time and run time axis as follows:

- Using an amalgamated version of [meshoptimizer](https://github.com/zeux/meshoptimizer) library, we're going to build `libmeshoptimizer.o` several times for each compiler, with and without optimizations (-O0 through -O3), and note the build time.
- Using the resulting optimized .o file we're going to compile the meshoptimized demo program using modern clang, run it on a Stanford dragon mesh and compare timings for various algorithms.

The reason why we're going to compile the demo program separately is that demo program uses STL and I don't want to find versions of STL that are compatible with these older compilers.

> Note: I'm aware that this is not a rigorous or a scientific way to analyze the law; the law itself is also a bit tongue in cheek so who cares? Don't read too much into the results.

Let's go!

# Building library code

I've downloaded a binary release of LLVM 2.7 from [releases.llvm.org](https://releases.llvm.org/); LLVM 11 comes with Ubuntu 20. I'm running everything using WSL2 on a Linux partition to make sure the performance numbers are representative of real hardware.

Each compiler is used to build all meshoptimizer source (8.5 KLOC) as a single translation unit to simplify the build process, in four configurations: `-O0`, `-Os -DNDEBUG`, `-O2 -DNDEBUG` and `-O3 -DNDEBUG`.

Build time comparison:

Build | LLVM 2.7 | LLVM 11
------|----------|--------
O0    | 0.236s   | 0.267s (+13%)
Os    | 0.540s   | 0.992s (+84%)
O2    | 0.618s   | 1.350s (+118%)
O3    | 0.658s   | 1.443s (+119%)

Object size comparison:

Build | LLVM 2.7 | LLVM 11
------|----------|--------
O0    | 229.5 KB | 215.3 KB (-6%)
Os    | 80.9 KB  | 74.4 KB (-8%)
O2    | 86.2 KB  | 106.9 KB (+24%)
O3    | 85.5 KB  | 111.9 KB (+30%)

Based on this analysis we can observe that the debug compilation throughput was not impacted very significantly - over 10 years of development time clang+llvm got 15% slower in debug builds, which is not surprising and not particularly alarming. Release mode, however, is noticeably slower - 2.2x slower in O2/O3.

In terms of output size, the numbers look healthy - O2/O3 builds got ~25-30% larger but that by itself isn't a problem as long as we see matching performance increases - in `Os`, where size is important, the binary got 8% smaller.

# Runtime: basics in O0/Os/O2/O3

The problem when comparing runtime is that it's not clear what specific build we need to compare, and what code we need to benchmark.
meshoptimizer comes with lots of algorithms that have various performance characteristics. It would be interesting to analyze all of them, but since this article doesn't promise to be scientific, we're going to pick a few algorithms and measure them in all build configurations, and then select one configuration to dig into Proebsting's law further.

To get a basic understanding, let's pick just three algorithms - vertex cache optimization, simplification and index decompression. We're going to look closer into performance of other algorithms later, but it would be good to get a sense of the differences between the versions on a small set.

Vertex cache optimization:

Build | LLVM 2.7 | LLVM 11
------|----------|--------
O0    | 506ms    | 482ms (-5%)
Os    | 176ms    | 167ms (-5%)
O2    | 175ms    | 181ms (+3%)
O3    | 174ms    | 183ms (+5%)

Simplification:

Build | LLVM 2.7 | LLVM 11
------|----------|--------
O0    | 761ms    | 741ms (-3%)
Os    | 376ms    | 335ms (-11%)
O2    | 379ms    | 325ms (-14%)
O3    | 366ms    | 318ms (-13%)

Index decompression:

Build | LLVM 2.7 | LLVM 11
------|----------|--------
O0    | 21.3ms   | 18.9ms (-11%)
Os    | 7.0ms    | 4.6ms (-34%)
O2    | 5.1ms    | 4.6ms (-9%)
O3    | 5.2ms    | 4.6ms (-12%)

The picture that is beginning to emerge here seems rather grim. We see speedups in the 10-15% range in optimized builds, with an exception of index decompress in Os that seems more like an outlier, where likely `-Os` inlining heuristics in LLVM 11 result in the same code across different optimization levels; we also see speedups in the 5% range in unoptimized builds.

Now, it's important that in addition to the disclaimer about the comparison not being particularly scientific the reader also understands one extra detail - all algorithms in meshoptimizer are carefully optimized. This isn't a run-of-the-mill C++ code - this is the code that was studied under various profilers and tweaked until, while it remained reasonably concise, the performance was deemed worthy.

It is possible in theory that code that's less carefully optimized exhibits different behavior, or that the benchmarks chosen here are simply not as amenable to compiler optimization as they could be - the lack of prominent difference between different optimization levels is also noteworthy (although O3 in particular has been stufied before in academic research and the value of that mode was inconclusive).

To try to get a more complete picture, let's now look at more algorithms and compare them in O2 build only.

# Runtime: algorithms in O2

We're going to first take a look at a more complete set of algorithms from meshoptimizer library; this isn't every single algorithm in existence as some of the algorithms have performance characteristics that aren't very distinct compared to other algorithms already presented here. This also excludes vertex decompression which is going to be mentioned separately.

Algorithm | LLVM 2.7 | LLVM 11
----------|----------|---------
Reindex   | 92ms     | 86ms (-7%)
Cache     | 175ms    | 183ms (+4%)
CacheFifo | 49ms     | 48ms (-2%)
Overdraw  | 57ms     | 52ms (-8%)
Stripify  | 46ms     | 36ms (-20%)
Meshlets  | 519ms    | 545ms (+5%)
Adjacency | 250ms    | 188ms (-25%)
Simplify  | 380ms    | 323ms (-15%)
SimplifySloppy | 61ms | 45ms (-26%)
SpatialSort | 22ms   | 19ms (-14%)
IndexEncode | 29ms   | 26ms (-11%)
IndexDecode | 5.2ms  | 4.6ms (-12%)

Overall the picture here is not very different from what we've already established - LLVM 11 seems to produce code that's 10-15% faster on most benchmarks. There are a couple outliers where the performance gain is more substantial, up to 25%, and a couple benchmarks where LLVM 11 actually generates consistently *slower* code, up to 5% - this is not a measurement error.

I've reran the outliers using -O3 with the following results, that made the gap a bit less wide but still substantial:

Algorithm | LLVM 2.7 | LLVM 11
----------|----------|---------
Stripify  | 44ms     | 35ms (-20%)
Adjacency | 212ms    | 174ms (-18%)
SimplifySloppy | 52ms | 44ms (-15%)

These gains are certainly welcome, although it is unfortunate that they seem to come at the cost of 2x slower compilation. This takes me back to "The death of optimizing compilers" by Daniel J. Bernstein - I wonder if there's a happier middle ground that can be found, one where the compiler gives more control over optimization decisions to the developer and allows tuning the code to reach gains that can be seen here at a lower complexity and compilation performance cost.

# Runtime: SIMD

All of the algorithms presented before were scalar, implemented using portable C++. While portions of some of these can be vectorized in theory, in practice clang 11 even at -O3 struggles with generating efficient SIMD code for most/all of them.

meshoptimizer does have several algorithms that have first-class SIMD versions, implemented using SSE/NEON/Wasm intrinsics. Their performance was compared using `codecbench`, a utility that comes with meshoptimizer and outputs performance in GB/sec - so the numbers in the following tables are reversed, larger is better.

Algorithm | LLVM 2.7 | LLVM 11
----------|----------|--------
vertex decode | 2.3 GB/s  | 3.0 GB/s (+30%)
filter-oct8   | 2.6 GB/s  | 2.8 GB/s (+8%)
filter-oct12  | 4.1 GB/s  | 4.2 GB/s (+2%)
filter-quat12 | 2.4 GB/s  | 2.6 GB/s (+8%)
filter-exp    | 13.2 GB/s | 13.6 GB/s (+3%)

All of the filters are typical SIMD streaming kernels - there's no branches or complex data dependencies. Perhaps unsurprisingly, the delta in performance of the compiled code is thus not very significant. The vertex decode is substantially more complicated - it contains function calls, branches, mix of scalar and vector instructions and in general can be more challenging for the optimizer.

It's worth noting that on this particular example, using `-O3` with LLVM 2.7 brings the performance up from 2.3 GB/s to 2.7 GB/s, while having no effect on LLVM 11 - bringing the delta between LLVM 11 and LLVM 2.7 back to ~10% range.

It's undoubtedly possible to find examples of loops that LLVM 2.7 couldn't vectorize (by virtue of not having an autovectorizer) and LLVM 11 can - unfortunately, my experience even on streamlined kernels like the aforementioned filters force me to maintain a deep distrust towards the auto-vectorizer (out of the 4 filter kernels above, clang 11 can not vectorize even a single one, and gcc 10 can only vectorize 'exp' - one out of 4). I would claim that any gains due to auto-vectorization can't be counted as significant until programmers are given better tools to make these optimizations more predictable and reliable.

# Conclusion?

The overall picture seems to be as follows.

LLVM 11 tends to take 2x longer to compile code with optimizations, and as a result produces code that runs 10-20% faster (with occasional outliers in either direction), compared to LLVM 2.7 which is more than 10 years old. This may be a general rule, something specific to highly tuned code, or something specific to meshoptimizer algorithms.

Without spending more than an evening it's hard to disambiguate the reasons. And this post definitely doesn't pretend to be a thorough research - it's just a fun little study of how competitive clang 2.7 looks like in 2021. Without a doubt, the amazing community behind LLVM didn't spend the last decade for naught - but if you still believe in the sufficiently smart optimizing compiler, it may be time to reconsider the extent to which you can rely on the compiler to make your code faster year after year, as if anything Proebsting's law should probably be reformulated as:

> Compiler Advances Double Computing Power Every 50 Years, And The Interval Keeps Growing

It's important to recognize that there are many forces that together define the rate at which software performance changes - between hardware getting faster (yes, even in the last 10 years, despite what articles like "Free Lunch Is Over" would make you believe), compilers getting better, software development practices frequently  getting out of hand and a large discrepancy between the expertise of the software developers wrt optimization, compiler advances are just one, rather small, piece of the puzzle. Perhaps Daniel Bernstein was right after all.
