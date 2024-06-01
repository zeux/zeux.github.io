---
layout: post
title: X is justifiably slow
excerpt_separator: <!--more-->
---

I regularly hear or read statements like this: "X is slow but this is to be expected because it needs to do a lot of work". It can be said about an application or a component in a larger system, and can refer to other resources that aren't time. I often find these profoundly unhelpful as they depend much more on the speaker's intuition and understanding of the problem, than X itself.

<!--more-->

> This post is much shorter than usual, and it was originally written in 2022 and published [on Cohost](https://cohost.org/zeux/post/357091-x-is-justifiably-slo). I'm going to experiment with posting shorter technical content like this more regularly in the coming months, including reposting my earlier Cohost posts (of which this is one of).

X[^1] may be slow because it's using an inefficient algorithm. When a database query takes a while to return a large volume of results, it may be because there's no index for that query - the query engine might be relatively well optimized, but the poor algorithmic complexity wins.

X may be slow because it's using an inefficient implementation of an algorithm. It's common to see 10x gaps or more between different implementations of the same idea, and without profiling the code it's hard to know whether something unexpected is taking the majority of time.

X may be slow because it's not taking advantage of the hardware. Modern hardware is incredibly fast, and many people don't have a good intuition for just how fast computers they use day to day are. The performance deficit between a reasonable serial implementation and code that uses efficient SIMD and multithreading can be significant - it's not particularly outlandish to see 100x delta on modern multi core chips with wide SIMD on computationally intensive problems - and replacing drastically cache inefficient algorithms with cache efficient ones can also yield dramatic speedups.

X may be slow because it's actually doing the work, but doing the work isn't necessary. Maybe X has no cache in front of it, or the cache hit rate is 10x worse than it should be, or maybe the cache retrieval itself is slow even though it doesn't need to be.

X may not even use the right framing for a problem. C++ compilers are notoriously slow, but it's not because the process of code compilation is fundamentally slow - it's because every element of the stack often carries profound inefficiencies that can be corrected by reframing the problem (which may require significant changes to the formulation - maybe instead of C++ you need to compile a different language!).

And yet there are cases when "X is slow because it's doing a lot of work" is actually probably right - when the problem has been well explored and can't be reframed, when the implementation is thoroughly profiled and optimized, and especially when you can do some sort of speed of light calculation[^2], eg "on this system we can't read memory faster than 50 GB/s, and yes we do need to read this much memory because we've already compressed the data to the extent feasible".

It can be very difficult to tell the difference, which is why I get annoyed a little bit every time I hear this, because the odds that enough analysis has been done on the particular implementation of the particular solution on the specific hardware and the exact data that's being processed before the statement is made are slim.

[^1]: As should be obvious from the framing, X here is a variable, not a web site formerly known as Twitter.
[^2]: [LLM inference speed of light](https://zeux.io/2024/03/15/llm-inference-sol/) post provides a practical example of such exercise.
