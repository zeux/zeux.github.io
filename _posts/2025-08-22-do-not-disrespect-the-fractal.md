---
layout: post
title: Do not disrespect the fractal
---

Some people have a misconception that in software engineering, skill stops mattering for code quality from some level of seniority, and all of the value add shifts to architecture, high level design decisions, problem setting, or guiding others. And as long as you have staff/senior engineers design a system and oversee mid-level - and, for some work, junior - engineers, the output quality is the same as if you got senior folks to write everything instead.

What I believe, however, is that there's not as much macro vs micro distinction as people want to imagine - software is fractal. Experts will make micro decisions, regular decisions and macro decisions, that all together combine into high quality software. Decisions at every level influence the quality and, often, influence levels above and below. You *can* outsource lower levels to non-experts - given time or budget constraints, you may *have* to - but you are not getting the same result.

You also can't validate micro decisions from a macro vantage point. The process of making the micro decisions shapes your understanding of the problem; without having solved the problem from the ground up, you don't have precise visibility into the higher levels. Quality engineering involves constantly shifting between the levels, validating the results and structure by looking at how much pressure propagates to neighboring layers and where things bend vs break.

This is why you shouldn't replace engineers with LLMs even if you create a great plan and review the code. This is why you will not get software to improve if you outsource layers to non-experts. And this is also, I believe, why large teams routinely fail to make excellent software.

> I've been planning to write more, shorter, posts on this blog. This one has been in my head for a few weeks now; it's a little too long to be a tweet, so here you go!
> If you were hoping for more technical content, I've been busy working on [meshoptimizer v0.25](https://github.com/zeux/meshoptimizer/releases/tag/v0.25), so check that out instead :)
