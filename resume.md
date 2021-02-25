---
layout: default
title: Resume
---

## Resume

Expert on game engine technology, including rendering, performance, language runtimes and compilers, simulation, networking. Effectively combines technical leadership and individual contributions in high-profile areas to build and execute the technical vision. Especially enjoys contributing to high-impact technology platforms. Writing code is a pastime.

If you reach out to me with an IC role then you need to re-read the paragraph above and my work history. Please be respectful of my time.

## Work history

### Roblox - Technical Fellow (April 2019 - present)

- Design and implementation of new Lua VM (optimizing bytecode compiler, fast interpreter, gradual typing proof of concept)
- Ongoing research & development of language-related improvements (actor-based parallelism, garbage collection, JIT)
- Improve internal engine technology and satellite projects through review and mentorship
- Technical guidance for all internal projects that involve or interface with "native" (C++) stack
- Influence the state of graphics hardware/APIs through advisory panels/boards
- Contribute to open standards such as WebAssembly and glTF

### Roblox - Technical Director (April 2014 - March 2019)

- Guide internal projects that involve the native (C++) stack: design review, code review, mentoring, hiring, middleware evaluation, performance analysis and recommendations, etc. etc.
- Improve network bandwidth by optimizing gameplay and physics data (general-purpose compression, repacking data for better compression, redesigned GUID replication, custom packed physics transform compressors)
- Implement always-enabled memory and performance profiling systems for internal and external use (category-based memory tracking, instrumentationbased profiling based on open-source but *very* substantially improved microprofile library)
- Define direction for future Roblox lighting engine by implementing various prototypes and guiding the team in shipping the results (Forward+ with tiled shadow maps, custom GPU-based voxel system, HDR, physically based BRDFs)
- Implement multi-API shader recompilation system to reduce shader maintenance (single source of truth, offline shader optimization passes, custom SPIRV transform pipelines for Vulkan)
- Extend rendering backend to support Metal and Vulkan (also persevere through myriads of Android issues and ship support for Vulkan on Android 7.x and above)
- Implement new voxel terrain system (custom pseudo dual contouring mesher, rendering/physics/networking/storage support, cache efficient KDTree for physics, level of detail support, fast navigation data rasterizer, in-memory hyper compressed format, screen space reflections, material blending, detiling, miscellaneous shader work)
- Implement VR support in Roblox engine (OpenVR/libOVR, stereo rendering optimizations, custom tracking, prediction and reprojection support for Google Cardboard)
- Implement custom Lua parsing and linting framework, used to detect likely issues in script code and as foundation for autocomplete
- Implement efficient character shadows for low-end mobile platforms (prefiltered shadowmaps with 8-bit depth, optimized for small number of casters)

### Roblox - Senior Rendering Engineer (August 2012 - March 2014)

- Worked on porting ROBLOX client to iOS (performance/memory optimization, OpenGL ES2 support, improving stability, etc.)
- Developed an adaptive rendering system that optimizes user-generated content on the fly to balance CPU/GPU usage (automatic static and dynamic geometry batching, character texture compositing, material and batch LOD)
- Developed a custom compressed binary format optimized for specific ROBLOX needs to significantly improve load/save times (generic DOM serialization with special packing to optimize for loading efficiency and compression ratio with transparent versioning/compatibility)
- Developed a novel approach to lighting the environment using CPU-based voxel computations (sun shadows, sky occlusion, local point/spot lights with shadow support)
- Optimized client and server for performance, memory and load times (clientside CPU and GPU optimizations for a wide range of hardware, significant reduction of render farm size)
- Rewritten the low level rendering engine from scratch, replacing Ogre3D with an in-house solution (significantly improved performance and load times, 10x less code to maintain; D3D9/GL/GLES2)

### Sperasoft Inc. - Senior Software Engineer (February 2011 - June 2012)

> Note: Sperasoft was/is an outsourcing company; all of my work in this period was for EA Sports for FIFA franchise.

- Helped ship FIFA Street, UEFA 2012 and FIFA 13
- Implemented a load-time light baking system (various types of lights, including area lights; soft shadows with translucency support; DXT compression; platform-specific optimizations and scheduling tweaks to maintain game framerate while baking)
- Implemented various visual effects (environment reflections, specular convolution prototype, special support for planar shadows on walls; translucent player shadows via stippling; layered fog)
- Implemented 3D crowd rendering (instancing; vectorized code for culling/updating; geometry LOD)
- Optimized games for performance, memory and load times (including SPU optimizations, shader tweaking, GUI rendering optimizations, massive code size savings, etc.)
- Helped fix complicated bugs involving deadlocks, race conditions, memory stomps.

### Saber Interactive - Senior PS3 Engine Programmer (November 2010 - February 2011)

- Ported several rendering-related subsystems to SPU (trails, decals, instanced object rendering)
- Improved shader bytecode support (less memory and better memory layout, faster setup)
- Optimized various SPU jobs (culling, command buffer generation)
- Optimized Battle: Los Angeles game for PS3 (better scheduling of parallel tasks, less GPU synchronization stalls, SPU post-processing optimizations, various code optimizations)
- Helped resolve many TRC issues

### Creat Studios - Lead Engine Programmer (December 2009 - October 2010)

- Managed the engine team (Xbox360/PS3 engine for all CREAT games) - 4 people.
- Optimized Box2D physics engine for PS3 (SPU port, parallelism & optimization).
- Optimized some post-processing code using SPU (water rendering).
- Optimized scene rendering (improved SPU parallelism, shader and command buffer memory optimization)
- Optimized loading time for several projects
- Improved stability and performance of asset build pipeline
- Shipped the following titles: Wakeboarding HD (PS3), HamsterBall (PS3), TerRover (PS3), SkyFighter (PS3)

### Creat Studios - Senior Programmer (November 2007 - November 2009)

- Developed the engine for XBox360/PS3 platforms (+ PSP/Wii).
- Designed and developed the material system
- Implemented a fast and light-weight SPU job scheduling system
- Developed and optimized scene rendering subsystem (SPU command buffer generation, SPU-based occlusion culling via software rasterization, a lot of other optimizations)
- Implemented various shadowing solutions (directional light shadows - Perspective Shadow Maps, Cascaded Shadow Maps, omni-directional light shadows).
- Designed and developed particle system support (custom dynamics based on splines and other artist-tweakable parameters; Maya particles support; SPU optimization of particle simulation and rendering)
- Developed the animation system (blend trees, animation sampling optimizations, SPU morph targets)
- Implemented many rendering algorithms and effects (water rendering, several post-processing effects, various lighting solutions)
- Optimized a lot of engine and game code (PPU, SPU, RSX)
- Optimized memory consumption
- Developed a pipeline for graphics data export (geometry, textures, animations - export from intermediate format, custom platform-specific layout and optimizations).
- Supported game projects throughout the release cycles, resolved many TRC issues.
- Shipped the following titles: Cuboid (PS3), Magic Ball (PS3), Smash Cars (PS3), Digger HD (PS3), Mushroom Wars (PS3)

### Creat Studios - Programmer (April 2007 - October 2007)

- Game logic for Aqua Teen Hunger Force (PS2) project (shipped)
