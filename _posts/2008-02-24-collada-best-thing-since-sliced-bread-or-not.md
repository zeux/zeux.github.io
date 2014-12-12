---
layout: post
title: 'COLLADA: Best thing since sliced bread or not?'
---

About half a year ago, our team at work that develops the engine decided to try and switch from the proprietary Maya export plugin (it exported geometry, animation and materials) to COLLADA. The old export pipeline was somewhat obscure, lacked some useful optimizations, and (what’s most important) lacked any convenient way to setup materials. That was not a problem for platforms with more or less fixed functionality, but with next-generation consoles (or should I say current-generation already?) it’s quite different.

So the switch has been made (it did not take half a year, it’s just that I’m writing about it only now), and I’m going to share some experience gained throughout the process.

What is COLLADA exactly? It’s an asset interchange format, based on XML (with complete XML Schema and specification), and a series of tools – exporters from popular DCC software (Maya, 3d Studio Max, XSI, Blender, etc.), viewers, libraries for loading/saving/manipulating COLLADA DOM tree.

This means several important things. First, it’s an asset interchange format, which means that it is not supposed to be used as a format for the retail assets. DCC saves COLLADA file, the custom tool loads it, reads useful information from it, applies optimizations (possibly platform-specific), and saves to some binary format.  Second, you don’t have to write the export plugin for any DCC tool you use – in theory, all you do is write the said tool that converts .dae to your format and it magically works with all possible tools. Third, it’s slowly becoming something like an industry standard – every popular DCC has an export plugin, some well-known tools can read DAE files (i.e. FXComposer), it has support of well-known companies like Sony, and more and more engines are adopting it.

But that, of course, does not mean that it is a perfect solution.

So, what exactly are COLLADA advantages (why do you want to use it)?

* You get a more or less DCC-independent pipeline. Even if your artists only ever use Maya, it does not mean that you’ll never need 3dsmax support (our engine is now being used by a company which only has 3dsmax-aware artists, so the task “support 3dsmax as geometry/animation export tool” has appeared – and it took a day or two).

* It is an additional layer of abstraction between DCC and your builder. This means that tedious work with DCC APIs is now inside the exporter, which is (ideally) the code you shouldn’t even know about. As a result, export pipeline is much simpler.

* There is a built-in custom material support (ColladaFX). Basically, it allows you to specify a material created from hardware shader (Cg/CgFX), and supplies the artist with convenient way of tweaking the shader parameters (with viewport preview as an added bonus).

* DCC plugins usually support importing DAE files. Why is this important? In old pipeline, we had the proprietary plugin export the .sb file, then a platform-independent tool applied some optimizations (reducing scene graph, removing redundant stuff from scene, merging meshes, etc.), and then the platform-specific exporter read that file and converted it to platform-specific format (stripifying, cache optimization, vertex packing, etc.). Obviously, any kind of visual feedback is lost at the moment you export .sb from Maya, so a special viewing/introspection tool was developed. If you use COLLADA and manage to write some export tools such that they only modify .dae file, you can later import it in your DCC tool. If your pipeline is made of a series of such builders, and (!) you save result of each builder, debugging the pipeline becomes much easier.

Well, so I’ve told all the good things about COLLADA I know of. Unfortunately, there is a number of things that are not so good.

* Scheme is complex and redundant in many ways. Writing a complete (able to parse any compliant COLLADA file) parser is hard, so either use an existing library (FCollada?) or parse only the subset of scheme your DCC tool exports. I prefer the latter approach, because it’s simpler for me and also is much faster in terms of performance.

* DCC export is sometimes quite slow (in case of Maya, for example, the export usually takes two times as long as the code that parses the file, builds the platform-specific structures and saves them). So cache your .dae files (we’re using SCons as a build system, and a network cache, so it’s not as frustrating as it could be).

* It is an additional layer of abstraction between DCC and your builder. This means that every time you encounter a bug, it could be either the export plugin or your builder (or, uh, a series of your builders). And if you use some DAE-parsing library, it could be that it is the source of problem. Fortunately, such cases are rare.

* Export plugins sometimes are not very top-quality. For example, lack of pivot animation export in ColladaMaya, ColladaFX support, bugs, etc.

* It is just an export plugin, do not expect any miracles. For example, if 3dsmax gives you TBN that does not make sense, COLLADA is not going to fix it.

* ColladaFX is very bad from the usability standpoint:

  * It’s hard for artists to create a new material and to correctly setup binding to geometry (for example, Maya TBN shader binding is not quite clear because of Cg).

  * It’s much harder for them to use it in 3dsmax because of even less convenient interface and some problems with parameter binding – just ask your artist to setup an existing model with ColladaFX materials in 3dsmax and you’ll know why

  * Perhaps it’s slightly better with CgFX, but since we don't use it, I can't say for sure.

* ColladaFX implementation is quite bad:

  * There are frequent crashes in 3dsmax (we fixed some of them and are considering submitting a patch).

  * Cg materials did not even export correctly because of exporter bug in 3dsmax! We submitted a patch that should already be in trunk.

  * ColladaFX materials export from Maya did not work with batch build.

So, generally, ColladaFX seems great on paper, but requires a lot of work, both in technical implementation and usability areas. We are considering rewriting the Maya interface part from scratch.

Fortunately, COLLADA exporter plugins we're using are open-source, so we debug them if they do not work, fix bugs (isn't it exciting?!) and add functionality as we feel appropriate (though of course this complicates the process of updating plugin versions).

Let’s summarize the above. If you do not have any established and well-working export pipeline and are not planning a custom DCC plugin for material setup or things like that – I’d definitely recommend COLLADA, because it’ll be easier than a custom plugin if you don’t have the relevant experience, and it will make it possible to support several DCC tools, which is a good thing. If you have a well established export pipeline that you’re happy about, there is obviously no need to use COLLADA. In other cases the answer is more complex. I myself am quite happy because of transition to COLLADA, because it made everything better, and the major disappointment of COLLADA was ColladaFX, which we did not have an equivalent for anyway (and export of default materials like Phong/Blinn/Lambert works just fine), but of course your mileage may vary.

If you are using COLLADA and have different experience about any of the enlisted areas, please write a comment! For example, do you use ColladaFX? Do you use FCollada and/or ColladaDOM and does it help you? Perhaps you use Feeling Software proprietary export plugins and have something good (or bad) to say about them?
