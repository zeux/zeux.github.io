---
layout: post
title: meshoptimizer 1.0 released
---

A short post today. If you're following me on any of the vast array of social accounts then you're probably aware, but if you're reading this blog through the ancient technology otherwise known as RSS, meshoptimizer v1.0 has been released yesterday!

In addition to the usual [release notes on GitHub](https://github.com/zeux/meshoptimizer/releases/tag/v1.0), I've also written a dedicated announcement that talks a little more about the last couple years of progress. If you're interested in graphics programming, you might find it interesting:

[meshoptimizer v1.0](https://meshoptimizer.org/v1)

It's a little strange to look back and think that it has been nine whole years since the library was originally created. The scope and quality have grown substantially since then, and what started as a small hobby project has slowly turned into an important technology used across the industry. The first release, confusingly numbered 0.5, was just under 1400 lines of code and had a fraction of the functionality that v1.0 provides today[^1]. I think "0.5" referred to the fact that parts of the code were salvaged from my toy engines I'd developed over the years and as such were somewhat well tested. I assume that what I was thinking at the time is that a few more improvements and a couple versions later and the library can reach 1.0!

What happened instead is a deep rabbit hole of algorithms, hardware details, inventions and new use cases. I've written about some of these on this blog, although it's always been a tradeoff that's difficult to navigate - do I write more code, or do I write more text *about* the code? Here's some of the articles published on the internals over the years:

- [Optimal grid rendering isn't optimal (2017)](https://zeux.io/2017/07/31/optimal-grid-rendering-is-not-optimal/)
- [Small, fast, web (2019)](https://zeux.io/2019/03/11/small-fast-web/)
- [Learning from data (2020)](https://zeux.io/2020/01/22/learning-from-data/)
- [VPEXPANDB on NEON with Z3 (2022)](https://zeux.io/2022/09/02/vpexpandb-neon-z3/)
- [Efficient jagged arrays (2023)](https://zeux.io/2023/06/30/efficient-jagged-arrays/)
- [Meshlet triangle locality matters (2024)](https://zeux.io/2024/04/09/meshlet-triangle-locality/)
- [Load-store conflicts (2025)](https://zeux.io/2025/05/03/load-store-conflicts/)
- [Billions of triangles in minutes (2025)](https://zeux.io/2025/09/30/billions-of-triangles-in-minutes/)

These only really cover a small portion of the research and work that went into the library. Perhaps someday I'll write more; it might be interesting to do something special for the 10th anniversary.

As always, feel free to drop me a note if you are [using meshoptimizer](https://github.com/zeux/meshoptimizer/discussions/986) or have ideas and suggestions for future versions. As I write in the full post linked above, v1.0 is an important milestone, but also 1.0 is just a number.

We continue.

[^1]: Ironically, because the initial version heavily relied on STL, compiling v1.0 - which has ten times as much source code - takes almost as much time in debug (1.1s vs 0.85s) and only twice as long in release (2.2s vs 1.1s).
