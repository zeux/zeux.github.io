---
layout: default
title: About
---
## Work

I’m a technical fellow at [Roblox](https://corp.roblox.com/). Previously I worked as a rendering engineer at [Sperasoft, Inc.](https://sperasoft.com/) on FIFA 13 and FIFA Street titles, as a PS3 programmer at [Saber Interactive](http://www.saber3d.com/) and as a lead engine developer at [Creat Studios](http://www.creatstudios.com/); during my career I’ve helped ship many games on PS2/PS3/XBox 360/PC. [More...](/resume/)

> Games in reverse chronological order:
>
> FIFA 13 (<small>PC/PS3/X360</small>),
> UEFA EURO 2012 (<small>PC/PS3/X360</small>),
> FIFA Street 2012 (<small>PS3/X360</small>),
> Battle: Los Angeles (<small>PC/PS3/X360</small>),
> SkyFighter (<small>PS3</small>),
> TerRover (<small>PS3</small>),
> Hamster Ball (<small>PS3</small>),
> Wakeboarding HD (<small>PS3</small>),
> Mushroom Wars (<small>PS3</small>),
> Digger HD (<small>PS3</small>),
> Smash Cars (<small>PS3</small>),
> Magic Ball (<small>PS3</small>),
> Cuboid (<small>PS3</small>),
> Mahjong Tales (<small>PS3</small>),
> Aqua Teen Hunger Force (<small>PS2</small>)

## Projects

I'm also working on a wide variety of open-source projects, most of which are hosted [on GitHub](https://github.com/zeux/). Here's a short selection:

### pugixml

[pugixml](http://pugixml.org/) is a light-weight C++ XML processing library with an extremely fast and memory efficient DOM parser and XPath 1.0 support. It is used in a wide range of applications, including various embedded systems, video game engines, offline renderers, web backends and robotics/space software. A lot of effort goes into making sure pugixml has an easy-to-use API, has as few defects as possible and runs on all widespread platforms.

### meshoptimizer

[meshoptimizer](http://github.com/zeux/meshoptimizer) is a library that can optimize geometry to render faster on GPUs by reordering vertex/index data. The library has algorithms that optimize vertex reuse, vertex access locality and overdraw, resulting in fewer vertex/fragment shader invocations and fewer cache misses when loading vertex data.

### volk

[volk](http://github.com/zeux/volk) is a meta-loader for Vulkan. It allows you to write a Vulkan application without adding a dependency to the Vulkan loader, which can be important if you plan to support other rendering APIs in the same applications; additionally it provides a way to load device entrypoints using vkGetDeviceProcAddr which can reduce the draw call dispatch overhead by bypassing the loader dispatch thunks.

### qgrep

[qgrep](http://github.com/zeux/qgrep) is a fast grep that uses an incrementally updated index to perform fast regular-expression based searches in large code bases. It uses [RE2](http://code.google.com/p/re2/) and [LZ4](http://code.google.com/p/lz4/) along with a lot of custom optimizations to make sure queries are as fast as possible. Additionally it features a Vim plugin for great search experience in the best text editor ;)

### codesize

[codesize](http://github.com/zeux/codesize) is a tool that shows the memory impact of your code using a hierarchical display adapted to work well in large C++ codebases. It works by parsing debug information from PDB/ELF/Mach-O files. The purpose of the tool is to let the developer quickly find areas in the codebase that can be improved to gain memory by reducing code size, which is particularly important on memory-constrained platforms.

## Publications

Here are some talks and publications I've done over the years:

* SIGGRAPH 2020, "Large Voxel Landscapes on Mobile". [Slides](/data/siggraph2020.pdf) [Video](https://www.youtube.com/watch?v=LktNeVkofKU)
* Game Developers Conference 2020, "Rendering Roblox: Vulkan Optimisations on Imagination PowerVR GPUs". [Slides](/data/gdc2020_pvr.pdf) [Video](https://www.gdcvault.com/play/1026753/Rendering-Roblox-Vulkan-Optimisations-on)
* Game Developers Conference 2020, "Optimizing Roblox: Vulkan Best Practices for Mobile Developers". [Slides](/data/gdc2020_arm.pdf) [Video](https://www.youtube.com/watch?v=BXlo09Kbp2k)
* Reboot Develop Red 2019, "Getting Faster and Leaner on Mobile: Optimizing Roblox with Vulkan". [Slides](/data/reboot2019.pdf) [Video](https://www.youtube.com/watch?v=hPW5ckkqiqA)
* GPU Zen 2: Advanced Rendering Techniques (2019), Chapter "Writing an efficient Vulkan renderer" [Read online](/2020/02/27/writing-an-efficient-vulkan-renderer/) or [buy the book](https://www.amazon.com/GPU-Zen-Advanced-Rendering-Techniques/dp/179758314X)
* Game Developers Conference 2018, "Vulkan on Android: Gotchas and best practices". [Slides](/data/gdc2018.pdf) [Video](https://www.youtube.com/watch?v=Aeo62YzofGc)
* The Performance of Open Source Applications (2013), Chapter 4: Parsing XML at the Speed of Light. [Read online](http://aosabook.org/en/posa/parsing-xml-at-the-speed-of-light.html) or [buy the book](http://aosabook.org/en/buy.html#posa) (all royalties are donated to [Amnesty International](http://www.amnesty.org/))
* Russian Game Developers Conference 2010, "Job scheduler: as simple as possible". [Slides](/data/kri2010_en.pdf)
* Russian Game Developers Conference 2009, "SPU Render". [Slides](/data/kri2009_en.pdf)
* Russian Game Developers Conference 2008, "Baking graphics resources for next-generation platforms". [Slides in Russian](/data/kri2008.pdf)

I also have a [blog](https://zeux.io) with technical posts on various subjects (you are reading it!).

## Biography

Arseny Kapoulkine has worked on game technology for the past decade. Having worked on rendering, physics simulation, language runtimes, multithreading and many other areas, he is still discovering exciting problems in game development that require low-level thinking. After helping ship many titles on PS3 including several FIFA games, he joined [Roblox](https://corp.roblox.com/) in 2012 and has been working on the in-house engine ever since, helping young game developers achieve their dreams.

## Contacts
You can reach me by e-mail at `arseny.kapoulkine@gmail.com` or on Twitter [@zeuxcg](https://twitter.com/zeuxcg).
