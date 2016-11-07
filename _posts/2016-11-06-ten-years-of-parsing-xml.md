---
layout: post
title: Ten years of parsing XML
---

Exactly ten years ago, the first version of my XML parser, [pugixml](http://pugixml.org), got released to the public.

pugixml was born out of frustration with status quo - ten years ago, XML parsers ranged from "slow" to "super slow". Expat had decent performance, but was based on SAX (stream parsing with callbacks), which made parsing some documents like COLLADA very inconvenient. TinyXML was extremely memory hungry and extremely slow. There was a library on CodeProject, called pugxml, that was a bit faster than TinyXML and used an interesting parsing approach - in-situ or inplace parsing, that I describe in more detail in my article in POSA, ["Parsing XML at the Speed of Light"](http://www.aosabook.org/en/posa/parsing-xml-at-the-speed-of-light.html).

I was not satisfied with the performance or the code, but it was a good start. I decided to fork pugxml, call it pugixml[^1] ("i" for "improved"), clean it up a bit and make it faster. I never imagined this would start a ten year long journey.

The source code started as a single 1800 LOC source file and a small header, and is at ~12500 LOC today[^2]. While I am trying to focus on features that are important and avoid bloat, the first version was extremely bare-bones - it did not even support mutable trees - while today it features multiple UTF encodings, two mutable tree representations and an XPath 1.0 query engine. It quickly became apparent that the only way to guarantee quality is to create a very comprehensive unit test suite - which is at ~14700 LOC and covers close to 99% source lines. In addition to that pugixml has been extensively tested using both afl-fuzz and LLVM libFuzzer, was checked using many static analyzers and underwent security audits by actual human beings.

During development, pugixml went through two version control systems (from SVN through git-svn to pure Git), three documentation generators (from Doxygen to Boost Quickbook + DocBook to AsciiDoc) and two build systems (from Jamplus to CMake + Make). In terms of performance it got faster and leaner with pretty much every version - the parsing engine has been carefully tuned for several compilers over these years, and the memory consumption also decreased over time, with the latest version introducing a new compact tree representation. As a result, while it's not necessarily faster than every single other XML parser out there in all cases, it sure is in most, and is very competitive from memory standpoint as well ([benchmark results](http://pugixml.org/benchmark/)).

Initially pugixml supported just one compiler (Microsoft Visual C++) and just one platform (Windows). Today it supports more than a dozen platforms and quite a few compilers, ranging all the way from Microsoft Visual C++ 6[^3] to newest C++14 compilers, and including some pretty esoteric toolchains (like Wind River). C++ being what it is, this takes some effort to maintain and test, but the library is there for you on any platform you choose to port your application to, and I happily accept portability patches, including warning fixes (with the goal of being warning-free on as wide of a range of compilers/compiler options as feasible).

pugixml tries to strike a balance between ease of use and robustness on the interface side as well as efficiency and portability on the implementation side. There are definitely some tradeoffs that are not made optimally, and once in a while I lament about a certain part of the API that is hard to take away now, but overall I hear very positive feedback from the users of the library.

I started from a SVN repository with a .zip file download, and now you can get pugixml as a package in many Linux distributions as well as Homebrew and NuGet. The best part is that most of that is not my initiative - several people maintain Linux packages which is great because I don't have resources to do all that myself.

Nothing makes me happier and prouder than e-mails from the wild - talking about successful integration or replacement of another XML parser, significant performance or memory gains achieved using pugixml, a weird embedded system where the compiler's interpretation of trivial C++ constructs is sometimes unconventional, or just a note saying that API is nice to use.

I have heard from individuals and companies, big and small; people who make small applications and companies that make end-user products with extremely wide reach, like Skype; people who work in aerospace for different countries; people who have kilobytes of stack space on their embedded devices and people who have gigabytes of XML data to parse (thankfully the last two categories don't intersect). Many users are incredibly helpful and dedicated - one of the crazier bugs I had to fix involved compiling pugixml on SPARC64 in QEMU to investigate and fix a floating-point alignment [issue](https://github.com/zeux/pugixml/issues/48), with the person who reported it preparing the QEMU image with git, gcc, gdb and pugixml already inside it.

I learned an incredible amount over these 10 years, and a big part of that is due to my work on pugixml. While the pace of pugixml development has definitely been slowing down, there are some big features that I occasionally implement, and I expect to continue maintaining, improving and polishing it in the future - so here's to another 10 years!

[^1]: No, I am not really sure how to pronounce it.
[^2]: It's still a single source file and a small header - this simplifies integration and forces me to keep source reasonably small
[^3]: Yes, I still maintain support for this compiler. It is mostly straightforward, except for working around the template mangling issue where every single template argument has to be present in the function signature, otherwise a wrong instantiation may be used.
