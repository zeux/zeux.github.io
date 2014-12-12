---
layout: post
title: 'COLLADA: quick update'
---

Time's running fast. Two weeks has passed since my post about COLLADA, and I've found a killer bug in FCollada TBN generation code.

As 3dsmax native API does not provide support for returning TBN (I do not know about Maya, perhaps it does not too), Feeling Software implemented their own algorithm for TBN calculation, based on source found in Maya 7.0 documentation, "Appendix A: Tangent and binormal vectors". Of course, relying on NVMeshMender would be too easy.

And after three years of Feeling Software's Collada plugins, there is a bug in TBN generation code. You can [read the full details here](http://sourceforge.net/forum/forum.php?thread_id=1966038&forum_id=460918) (the poster is me), but to keep it simple - returned tangent/binormal are opposite to the correct ones because of incorrect sign in equations (proof with asset files and comparison between Maya reference code and FCollada is also in the post). Well, perhaps it's just that I misunderstand something, but I definitely think it is a bug - there's just too many things to back it up.

And suddenly I can't post a bug report on Feeling Software forum, and through I get to know that Collada free support is discontinued. Given that other alternatives to DAE export from Max/Maya are just not worth the trouble, this means that suddenly COLLADA starts to feel much less attractive than before.

I'm even considering writing a small (geometry, node hierarchy, skin controller and sampled & baked animation - should not be that hard) plugin for 3dsmax/Maya...
