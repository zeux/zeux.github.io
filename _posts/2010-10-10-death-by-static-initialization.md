---
layout: post
title: Death by static initialization
---

The language war in game development is long over - and the winner is C++. The utmost majority of code that's going to run on the users side (engine code and game code) is written in C++. This is mostly not because the language is good, but because there is no better alternative.

Many features of C++ carry some penalty in different areas - performance, memory overhead, compilation time, code flow clearness, etc. The great thing about the language is that you usually can avoid using the feature where you don't need it or would rather do without.

One powerful feature in C++ (which is, by the way, present in most high-level languages, like Java, C#, Python, etc.) is static initialization. In the days of C the only code that ran before the main() was the CRT startup code - basically, nothing interesting ever happened outside of main(). Since in C++ constructors of global variables are executed before main(), you can theoretically run the entire game before main (not that that is a good idea).

The use of static initializers is usually discouraged; while useful for removing some glue code, like various entity registration (one of the examples is auto-registering unit tests via globals' constructors - many C++ test frameworks use this approach, mine included), static initialization has several problems:

* The order of execution between translation units is not defined for static constructors; using a global variable from constructor of another global variable leads to undefined behavior.

* The code flow is no longer obvious - i.e. you can get crashes or stalls in the code that's running before main().

* In order to do anything interesting before main(), you usually have to initialize some of your subsystems (i.e. a logging facility), which leads to more and more code being put into static initializers, which does not help things.

* Static initializers only run if the translation unit they're in is linked to the executable; because of this, the automatic use of static initializers that are compiled to a static library is sometimes impossible (you have to touch at least one symbol from the object file in question).

However, while working on one of our titles, I found another problem with static initializers - sometimes they cost you in memory. I'm working on console titles; memory is a scarce resource on current generation consoles, so whenever I see a chunk of memory that's 1 Mb or more, and that's not supposed to be there, I try to remove it.

> Some of you probably think that a megabyte is such a tiny amount of memory that it's no use fussing about it; well, the harsh reality of game development is that most optimizations consist of shaving off a percent of available performance/memory a lot of times - there often is no single 50% or even 10% bottleneck.

Because of that I sometimes look at the game executable file to see what's the memory overhead of just loading our code to the target console, and what this overhead comes from. We have a GCC-based toolchain, so there is a variety of tools available; the relevant tools for these tasks are `size` (gives section sizes, which is good for a general overview) and `nm` (gives a sorted list of symbols, enabling a more detailed analysis).

Imagine my surprise, when I found that slightly more than a megabyte in our 6 Mb ELF contains static initialization code! I found this using a simple command-line (did I mention I love Perl one-liners?):

```
nm --print-size game.elf | perl -ne "$sum += hex($1) if (/^\S+\s+(\S+).*static_init/); END { print $sum; }"
```

We do not have that much static initialized objects; in fact, almost the only place where we do have them is our serialization system. We have an in-place serialization framework that can save (on Windows PC) a graph of C++ objects to the file so that the objects have the same memory layout as on the target platform, so we can load the file to memory (on console), do pointer fixup and start using the objects.

Unfortunately, due to popular demands of many programmers, the system has to support polymorphic objects and multiple inheritance; this means that, in addition to pointer fixup, we have to fixup pointers to virtual function tables - moreover, because of multiple inheritance, there may be more than one vtbl pointer in a single object! Because of this, the system executes a special constructor for each object via placement new; the constructor itself does nothing except it guarantees that it does not initialize any fields/aggregate objects, so that the values from the file are left intact; however, for objects with vfptrs, compiler adds the relevant code to the constructor.

The only problem now is to call the right constructor for each object. We have an RTTI system for this (it's not RTTI in the usual sense - you can't get the object's type in runtime - but you can, in compilation time, get a type identifier, which is a CRC32 of the type name, which is the same across all platforms). There is a table of functions, that's indexed by type RTTI identifier; you can get a function by the identifier, then execute the function on a chunk of memory, and you'll get the initialized chunk of memory - all that without knowing the type at compile time.

Well, that's cute and stuff, but how do we fill the table? In essence, we have to call this:

```cpp
template <class T> static void registerClassByType()
{
    _registerClass(T::rttiType(), sizeof(T), T::_Creator, T::_Destructor);
}
```

for each serializable type. For this, we have the following auto-registration class:

```cpp
template <class ClassType> struct AutoRegister
{
    void ping() {}

    AutoRegister()
    {
        ClassesTable::registerClassByType<ClassType>();
    }

    static AutoRegister registrator;
};

template <class ClassType> AutoRegister<ClassType> AutoRegister<ClassType>::registrator;
```

Now, if we ensure that this class has a proper instantiation (which is done by calling `AutoRegister::registrator.ping()`), we're set. The ping call is performed from a function, that's generated from a macro inside the class declaration:

```cpp
struct Foo
{
    RTTI(Foo);
};
```

... and herein lies the problem. You see, the compiler has to generate the code that calls the static initializer. The problem is, the compiler has to generate it inside each translation unit (if the ping() is instantiated in the unit, of course) - because the compiler does not know if there are other calls to the same initializer in other translation units, because object files are compiled in isolation. This can result in several calls to the same static initializer; the compiler, linker and CRT have to ensure that each initializer is called only once.

There are two approaches to this problem:

* Generate a separate section for each static initializer call; mark the section so that the linker puts all these sections together, and CRT gets a pointer to the section block start/end. This is the approach taken by Microsoft compilers; the section, in our case, is called .CRT$XCx, with the last x substituted with some uppercase letter (which controls the initialization order - see crt0dat.c from CRT sources for more details). There is only a single call to each initializer because the linker merges the sections referring to the same initializer.

* Generate a separate function for each translation unit; the function contains calls to all initializers in the declaration order, and looks like this (on x86, with two static initializers in one translation unit):

```asm
	pushl	%ebp
	movl	%esp, %ebp
	subl	$8, %esp
	
	cmpb	$0, __ZGVN12AutoRegisterIiE11registratorE
	je	L8
L4:
	cmpb	$0, __ZGVN12AutoRegisterIjE11registratorE
	je	L9
	leave
	ret

L9:
	movb	$1, __ZGVN12AutoRegisterIjE11registratorE
	leave
	jmp	__Z19registerClassByTypeIjEvv

L8:
	movb	$1, __ZGVN12AutoRegisterIiE11registratorE
	call	__Z19registerClassByTypeIiEvv
	jmp	L4
```

There is only a single call to each initializer because of branches inside this function.

As you can see, in the second case the linker can not merge anything - there is a big function for each translation unit; so if you have a single serializable class, that has its header included in 1000 translation units, it contributes roughly 5 instructions in the x86 case; on our target platform the overhead is 9 instructions per initializer (36 bytes).

The problem manifests itself when there is a moderate to large amount of files, and when each file includes a lot of serializable object headers; unfortunately, while our engine code has sensible include structure, so it generates <50k of initialization code, the game code tends to have spaghetti includes; thus, while each class instantiation only costs 36 bytes, for a huge number of files the total amount of initialization code became a problem. Eventually we got rid of the automatic type registration, making it semi-automatic (you had to manually register a type, but all types that are referenced by it got registered automatically), and reduced our executable by 1+ Mb.

C++ is a powerful language; but some of its powers cost you dearly. A low-level C++ programmer must be aware of various code generation subtleties, employ various analysis tools to notice the problems early, and use certain C++ features sparingly. In other words, "Constant vigilance"!
