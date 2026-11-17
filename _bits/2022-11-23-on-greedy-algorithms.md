---
title: On greedy algorithms
---

I like greedy algorithms.

They are easy to implement, easy to reason about, and often pretty fast. A greedy algorithm makes a decision one by one and commits to it - no going back! Each decision is local and typically only evaluates a small set of choices. After the decision is made, you might need to update some tracking structures to reflect the change, and that's it.

A lot of fairly complex problems have a simple, first-cut solution, that is greedy. You can then improve on that solution incrementally by tweaking the heuristic.

And yet it may be hard to understand the behavior of greedy algorithms at the scale of the entire problem. Each decision is easy to reason about in isolation, but it's hard to know how the sequence of these decisions will affect the end result. Some locally optimal decisions, if made early, end up compromising a set of later decisions, locking down less optimal choices. Sometimes the heuristic must explicitly penalize locally optimal decisions, but it's often not obvious how to do it, or whether a given choice is poor globally[^1].

I've spent a little bit of time in the last two days looking at the clusterization algorithm in meshoptimizer. It's a greedy algorithm that fills the clusters with triangles one triangle at a time, and simultaneously tries to balance a lot of variables - how well packed the resulting triangle clusters (meshlets) are, how large they are, and how flat they are[^2]. Any decision made early may end up isolating a few triangles - these are expensive to pick up later, as you'll have to either have a lot of very "small" meshlets that are inefficient to render, or pack a lot of unrelated triangles into few meshlets, penalizing all forms of culling.

This is made harder by the fact that the incremental updates to connectivity structures done after each greedy step must be quick. Ideally I'd associate each triangle with the size of connected component and weigh triangles that are part of very small components higher - typical connectivity data structures for this are optimized for creating edges, not breaking edges, so I haven't tried this yet.

The process of tweaking the heuristics is simultaneously fun and frustrating. It's fun because, well, changes are easy to make! But even evaluating changes is difficult - it requires looking at statistics for a lot of different meshes and algorithm parameters because what improves one mesh might penalize another, and visual inspection is insufficient. And it's often the case that intuition betrays you - a heuristic seems to make perfect sense, and indeed it does work great locally - except that when looking at the global algorithm behavior, it ends up flat or worse.

It's the same mistake that the greedy algorithm makes, but it's difficult to change the perspective and think about the impact of a local change globally. If you're expecting tips & tricks for this, I have none :) I mostly wanted to share the experience.

[^1]: I write a little bit about it in [Learning from data](https://zeux.io/2020/01/22/learning-from-data/), where the choice of how to score most recently seen vertices directly affects how the global order may look like.
[^2]: Or rather how similar the triangle normals in the entire cluster look like - the more they all point in more or less the same direction, the more efficient [cluster cone culling](https://youtu.be/KckRq7Rm3Mw) can be.
