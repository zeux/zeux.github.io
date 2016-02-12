---
layout: post
title: Fighting against CRT heap and winning
---

Memory management is one of (many) cornerstones of tech quality for console games. Proper memory management can decrease amount of bugs, increase product quality (for example, by eliminating desperate pre-release asset shrinking) and generally make life way easier – long term, that is. Improper memory management can wreak havoc. For example, any middleware without means to control/override memory management is, well, often not an option; any subsystem that uncontrollably allocates memory can and will lead to problems and thus needs redesigning/reimplementing. While you can tolerate more reckless memory handling on PC, it often results in negative user experience as well.

In my opinion, there are two steps to proper memory management. First one is global and affects all code – it's memory separation and budgeting. Every subsystem has to live in its own memory area of fixed size (of course, size can be fixed for the whole game or vary per level, this is not essential). This has several benefits:

* Memory fragmentation is now local – subsystems don't fragment each other's storage, thus fragmentation problems happen less frequently and can be reproduced and fixed faster

* Fixed sizes mean explicit budgets – because of them out of memory problems are again local and easily tracked to their source. For example, there is no more “game does not fit in video memory, let's resize some textures” - instead, you know that i.e. level textures fit in their budget perfectly, but the UI artists added several screen-size backgrounds, overflowing UI texture budget

* Because each subsystem lives in its own area, we have detailed memory statistics for no additional work, which again is a good thing for obvious reasons

* If memory areas have fixed sizes, they either have fixed addresses or it's easy to trace address range for each of them – this helps somewhat in debugging complex bugs

Second one is local to each subsystem – once you know that your data lives in a fixed area, you have to come up with a way to lay your data in this area. The exact decisions are specific to the nature of data and are up to the programmer; this is out of this post's scope.

Memory is divided into regions, each region is attributed to a single subsystem/usage type – if we accept this, it becomes apparent that any unattributed allocations (i.e. any allocations into global heap) are there either because nobody knows where they should belong or because the person who coded those does not want to think about memory – which is even worse (strict separation and budgeting makes things more complicated in short term by forcing people to think about memory usage – but that's a good thing!). Because of this global heap contains junk by definition and thus should ideally be eliminated altogether, or if this is not possible for some reason, should be of limited and rather small size.

Now that we know the goal, it's necessary to implement it – i.e. we want to have a way to replace allocations in global heap with either fatal errors or allocations in our own small memory area. On different platforms there are different ways to do it – for example, on PS3 there is a documented (and easy) way to override CRT memory management functions (malloc/free/etc.); on other platforms with GNU-based toolchain there is often a `--wrap` linker switch – however, on some platforms, like Windows (assuming MSVC), there does not seem to be a clean way to do it. In fact, it seems that the only known solution is [to modify the CRT code](http://benjamin.smedbergs.us/blog/2008-01-10/patching-the-windows-crt/). I work with statically linked CRT, so this would mean less distribution problems, but more development ones – I'd have to either replace prebuilt CRT libraries (which is out of the question because it makes working with other projects impossible) or ignore them and link my own, which is better – but still, the process required building my own (hacked) version of CRT. I did not like the approach, so I came up with my own.

First, some disclaimers. This code is tested for statically linked Win32 CRT only – it requires some modifications to work on Win64 or with dynamically linked CRT – I might do the Win64 part some day, but not DLL CRT. Also I'm not too clear on EULA issues; because of this, I'll post my entire code except for one function that's essentially ripped from CRT and fixed so that it compiles – read further for more details. Finally, there may be some unresolved issues with CRT functions I don't currently use (though I think my solution covers most of them) – basically, this is a demonstration of approach with proof-of-concept code, and if you decide to use it you're expected to fix the problems if they arise :)

Our first priority is to replace CRT allocation functions without modifying libraries. There are basically two ways to do something like it – link time and run time. Link time approach involves telling the linker somehow that instead of existing functions it should use the ones supplied by us. Unfortunately, there does not seem to be a way to do this except `/FORCE:MULTIPLE`, which results in annoying linker warnings and disables incremental linking. Run time way involves patching code after the executable is started – hooking libraries like Detours do it, but we don't need such a heavyweight solution here. In fact, all that's needed is a simple function:

```cpp
static inline void patch_with_jump(void* dest, void* address)
{
    // get offset for relative jmp
    unsigned int offset = (unsigned int)((char*)address – (char*)dest – 5);
    
    // unprotect memory
    unsigned long old_protect;
    VirtualProtect(dest, 5, PAGE_READWRITE, &old_protect);
    
    // write jmp
    *(unsigned char*)dest = 0xe9;
    *(unsigned int*)((char*)dest + 1) = offset;
    
    // protect memory
    VirtualProtect(dest, 5, old_protect, &old_protect);
}
```

This function replaces first 5 bytes of code contained in dest with jump to address (the jump is a relative one so we need to compute relative offset; also, the code area is read-only by default, so we unprotect it for the duration of patching). The primitive for stubbing CRT functions is in place – now we need to figure out where to invoke it. At first I thought that a static initializer (specially tagged so that it's guaranteed to execute before other initializers) would be sufficient, but after looking inside CRT source it became apparent that heap is initialized and (which is more critical) used before static initialization. Thus I had to define my own entry point:

```cpp
int entrypoint()
{
    int mainCRTStartup();
    
    patch_memory_management_functions();
    
    return mainCRTStartup();
}
```

Now to patch the functions. We're interested in heap initialization, heap termination and various (de)allocation utilities. There is `_heap_init`, `_heap_term` and lots of variants of malloc/free and friends – they are all listed in source code. Note that I stubbed all `_aligned_*` functions with `BREAK()` (`__asm int 3`), because neither CRT code nor my code uses them – of course, you can stub them if you need.

There are several highlights here. First one I stumbled upon is that `_heap_term` is not getting called! At least not in static CRT. After some CRT source digging I decided to patch `__crtCorExitProcess` – it's useful only for managed C++, and it's the last thing that gets called before `ExitProcess`. The second one is in function `_recalloc`, that's specific to the allocator you're using to replace the default one. The purpose of `_recalloc` is to reallocate the memory as realloc does, but cleaning any additional memory – so if you do `malloc(3)` and then `_recalloc(4)`, `((char*)ptr)[3]` is guaranteed to be 0. My allocator aligns everything to 4 bytes and has a minimal allocation size limit; the original size that was passed to allocation function is not stored anywhere. It's easy to fix it for CRT because `_recalloc` is used in CRT only for blocks allocated with calloc, and I hope `_recalloc` is not used anywhere else. By the way, there is a bug in CRT related to `_recalloc` – `malloc(0)` with subsequent `_recalloc(1)` does not clear first byte (because for `malloc(0)` block with size 1 is created); moreover, more bugs of such nature are theoretically possible on Win64. Personally I find `calloc` weird and `_recalloc` disgusting; luckily it's Windows-only.

Ok, now we're done – are we? Well, everything went well until I turned leak detection on. It turns out that there are lots of allocations left unfreed by CRT – amazingly, there is a `__freeCrtMemory` function that frees some of those, but it's compiled in only in `_DEBUG`, and it's called only if CRT debugging facilities are configured to dump memory leaks on exit. Because of this I needed to copy the code, modify it slightly so that it compiles and invoke the function before heap termination. However, this function does not free everything – there were some more allocations left, that I needed to handle myself. You can see the code in `cleanup_crt_leaks()`. After cleaning up leaks `printf()`, which was used to output leaks to console, became unusable (oh, horror!), so I came up with the following function:

```cpp
void debug_printf(const char* format, …)
{
    char buf[4096];
    
    va_list arglist;
    va_start(arglist, format);
    wvsprintfA(buf, format, arglist);
    va_end(arglist);
    
    // console output
    HANDLE handle = GetStdHandle(STD_OUTPUT_HANDLE);
    WriteFile(handle, buf, (unsigned long)strlen(buf), NULL, NULL);


    // debug output
    OutputDebugStringA(buf);
}
```

Finally, the last problem is that some CRT code checks global variable _crtheap prior to allocation, so we have to initialize it to something (that affects fopen() and other functions that use dynamically created critical sections).

Well, now it works and I'm quite happy with the results. Of course it's slightly hackish, but CRT code is such a mess that it blends in nicely. The more or less complete source code [is here](https://gist.github.com/zeux/9e05771f7edca8165a3e). Note that if you're using C++ `new`/`delete` and you have not overridden them globally for some reason, you might want to patch `_nh_malloc`/`_heap_alloc` with `malloc_stub` as well.
