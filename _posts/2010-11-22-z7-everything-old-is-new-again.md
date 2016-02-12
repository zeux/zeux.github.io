---
layout: post
title: 'Z7: Everything old is new again'
---

Debug information is the data that allows the debugger to, uhm, debug your program. It consists of the information about all types used in the program, of source line information (what instruction originated from what source line), of variable binding information (to know where on the stack frame/in register pool each local variable is stored) and other things that help you debug your program.

There are two different ways to store the debug information for C/C++ code: one follows the 'separate compilation' model of C++ and stores debug information in the object file for each translation unit, another adopts the 'everything is a huge database' model and stores debug information for the whole project in a single database. The first approach is the one taken by GCC; MSVC, on the other hand, uses the second approach by default.

Here's how it works in practice: suppose you have an application project, `game`, that references two static library projects, `render` and `sound`. There is a single database file (which has .pdb extension) for each project - they usually are located in the same intermediate folder as object files - so in this example we have three PDB files, which by default are all called something like vc80.pdb, depending on the MSVS version - but, since you can change that, we'll assume they're called `game.pdb`, `render.pdb` and `sound.pdb`. While the files in all projects are compiling, the compiler computes the debugging information for the current translation unit and updates the corresponding .pdb file.

However, the debugger can't work with multiple pdb files - it wants a single PDB file. So the linker, in the process of linking the final application, in our case `game` project, merges all PDB files in a single file - let's call it `gamefinal.pdb`. The linker gets paths to all PDB files from object files (or from object files inside static libraries), reads debug information from them, generates a single PDB file, writes it to disk and stores the path to this file in the executable (exe or dll). Debugger reads the PDB path from the executable module and uses the debugging information from that file.

There are some nice properties of this system:

* The resulting debugging information is separate from the executable - you can generate it for all builds, including retail, but don't redistribute the pdb. In fact, **please always generate the debugging information for all builds!** Prior to Visual Studio 2010 the default settings for Release configuration excluded any debug information, which is unfortunate.

* The mechanism for discovering the "source" PDB files at link stage is flexible - I've described the default setup for freshly created projects, however you can modify it - you can have all projects update a single PDB file, or you can have 1 PDB per object file. Linker will work regardless of the setup.

However, there is a problem - what if several files are compiled in parallel? In case they refer to the same PDB file, we have to use some synchronization mechanism. This concern (perhaps there were other reasons that I'm not aware of) led to the following design - there is a server process, called `mspdbsrv.exe`, which handles PDB file operations and ensures safe concurrent access. Compiler uses the server to update PDB files, linker uses the server to read source PDB files and update the final PDB file. Some operations are apparently asynchronous - you can sometimes observe that even though the linker process has exited, the final PDB file processing is not finished, which can lead to file access errors.

So, now everything works fine, right? Almost.

When you're using distributed compilation, i.e. via IncrediBuild, the compiler processes are run on different machines. They update some PDB file locally, which is then transferred to your machine. However, this effectively disables the PDB server operations - instead of a single server process that updates all PDB files, there are now multiple server processes, one for each worker machine! This leads to disaster, which manifests in corrupted PDB files and can be easily observed if you try to use make/scons/jam/any other build system with MSVC + IncrediBuild + compiler-generated PDB files.

IncrediBuild has a special hack in order to make this work - when you compile the solution via Microsoft Visual Studio, IncrediBuild modifies the build command line by splitting the PDB file for each project into several files, making sure that all files with the same PDB name go to the same agent. You should be able to use the same hack for make/scons/jam, since you can declare that you tool behaves like cl.exe in IncrediBuild profile, but I don't know the details and couldn't get it to work.

It turns out that MSVC initially used the first debug information storage approach - i.e. it stored the debug information in object files. Moreover, this mode is still available via the /Z7 switch (this is the so-called 'old style debug information', or 'C7 Compatible' in the MSVC GUI - you can find the setting in Project Properties -> C++ -> General -> Debug Information Format). This has the following implications:

* Debug information is now local to translation unit - there are no races in case of concurrent compilation by design.

* The PDB server is no longer used during the compilation, because it is not needed.

* The linker reads debug information from object files directly, instead of looking for PDB path and opening the PDB (in fact, there is no PDB path in object files).

* Static libraries contain embedded object files, so a static library file is now self-contained - it contains all information that's necessary for linking

Obviously, the compile and link file access pattern change greatly. The change in compilation/linking times is hard to estimate - on one hand, with /Zi all debug information was consolidated in a single PDB file (per project), now it's scattered throughout object files (which, by the way, increases the size of intermediate files because now there is duplicate debug information), on the other hand the linker should read object files anyway, so locality should not be worse. Also, we eliminate a theoretical synchronization bottleneck (the PDB server), so multiprocess builds can get faster.

Here are my completely unscientific benchmark results on OGRE builds with cold cache in four build variants: /Zi (PDB files, single core build), /Zi /MP (PDB files, multicore build), /Z7 (no PDB files, single core build), /Z7 /MP (no PDB files, multicore build). For each configuration, I did a clean build of the OgreMain.dll using a new source folder every time, then I rebooted to force file cache cleanup, changed a single source file and did a build once again. Both compilation and linking times are included. The tests were done on a Core i7 920.

| | /Zi | /Zi /MP | /Z7 | /Z7 /MP |
|--|----|---------|-----|---------|
| clean cl | 6:45 | 1:51 | 6:32 | 1:32 |
| clean link | 0:20 | 0:20 | 0:17 | 0:17 |
| incremental cl | 0:15 | 0:15 | 0:08 | 0:08 |
| incremental link | 0:17 | 0:17 | 0:24 | 0:24 |

While there are some savings for the clean build, the total incremental build time is the same (which can be explained if this is the cost of reading old debug information - since it is moved from link time to compilation of the single changed source file). With that in mind, Z7 and Zi are probably more or less interchangeable - unless you need Edit & Continue support, which is not supported with old-style debug information. Still, I like the /Z7 approach better.
