---
layout: post
title: Taking testing seriously
---

As I've written [in the previous post](/2010/09/25/testing-libraries-is-important/), there is a long way to go from first tests to the complete testing suite. Without further ado, here is the list of things I consider important for a test suite of a middleware product. Some of the items here are only relevant for the case where you want an automatic continuous integration-style testing - they're marked with asterisk (*****).

* Get a good testing framework. With a good framework you have to be able to add a new test in a couple of lines of code, and add a new check in a single line of code. Extra bonus points for libraries that do not require code generation, since this makes building pipeline easier. You can look at the existing frameworks (my personal recommendation is [UnitTest++](http://unittest-cpp.sourceforge.net/)), or write your own - it's actually extremely easy to do, my frameworks are usually less than 10 kb of code. This is needed to reduce test writing friction - the more tests you write, the better.

* Augment the framework by adding domain-specific testing helpers. For example, [pugixml](http://code.google.com/p/pugixml) is about processing XML documents, so I have a special TEST_XML(name, "xml contents") test declaration macro, that automatically declares a test with loaded document; I also have a set of XPath-related checking macros, i.e. CHECK_XPATH_STRING(context, "concat('a', 'b')", "ab").

* ***** Assertions, crashes and hangs should result in test failures instead of halting the whole process (although there should be a separate switch that crashes the whole thing so that you can attach a debugger). This is usually easily done on top of any framework, on Windows you can override unhandled exception filter; hangs are usually dealt with by external code (i.e. test runner).

* Replace the allocation functions with special versions that check memory leaks automatically; you can either do the test after the application runs to completion, or (preferably) check that each tests deallocates all the memory it allocates (which may fail if your library has global caches). Allocation function replacement can be done at the library level (your library does all allocations through an overridable interface, right? RIGHT?), or you can just override operator new/delete - though you're going to have problems with STL allocations (i.e. some of the memory allocated by iostreams is not freed in some MSVCRT configurations to make applications exit faster).

* Depending on your application allocation policy, you can also replace the allocations to do one of the following:

  1. Always allocate memory such that the memory immediately past the user block is the page without write access.
  2. Never deallocate memory, instead mark deallocated memory as no-access.

This helps ensure the correct handling of allocated memory (page protection can be done with VirtualProtect/mprotect calls).

* Reduce test output as much as possible. In case the tests succeed, you should stick with just outputting a single line of information, i.e. 'SUCCESS: N tests passed'. On the other hand, if some of the tests fail, give as much information as you can - names of failing tests, file/line/callstack information of failing checks, actual tested values - these can often reduce the time to fix the code.

* Single click test - you should have a single command that builds the whole library together with tests (incremental/distributed building is a must for even moderately sized libraries), runs the tests and outputs test results. All files that are necessary for testing should be included with the tests, together with testing scripts. Ideally, you should be able to run the tests on any machine quickly, provided it has the necessary development tools installed (i.e. a compiler).

* If your library can be compiled in several configurations, test all of them - in fact, ideally you should test all configuration combinations. This ensures that you don't have code that simply does not work in some weird configuration combo, which may very well be required by one of your users. Also this forces you to reduce the configuration combination count, which is (arguably) a good thing.

* If your library should support several compilers, test all of them (or at least as much as you can handle) - many C++ constructs are treated slightly differently by different compilers, and don't even get me started on the standard library. Test all versions of all supported compilers to be sure you actually support them, since every commit can break the compilation.

* If your library is cross-platform, test all supported platforms (or at least as much as you can handle). Don't forget to test 64-bit targets; also, if possible, test on both little-endian and big-endian platforms (see below).

* Single click full test - again, ideally testing all of the platforms with all compilers and configurations should be automatic - you should be able to run a single command, go watch a movie, and then return to see the test report. Speaking of test report - if you have more than a couple of platforms/configurations, you should construct a report which gives a birds-eye view on the state of your library. It should ideally fit on a single page, or a couple of pages, so you can immediately tell if something is wrong; keep the full build log near the summary report to be able to dig in should a problem arise.

* ***** If there are many people working on the project, you should really invest your time in a continious integration process. Usually a separate machine that runs basic tests (i.e. major configurations on most important platforms) after each commit and does full-blown tests during the night is good enough. You do not need any special software to pull that off, although it may help - I do not have any positive experience with CI software so can't really recommend anything except the DIY approach.

* Code coverage is important. If some code is not executed by the tests, you do not have any evidence that it works at all. Remember how I talked about the safety net? Well, there are holes in the safety net wherever there is no coverage. You can use free tools like **gcov** (although it only works with MinGW/gcc compilers) to do that; it's trivial to write a simple gcov information parser to include the coverage statistics in your test report.

* Code coverage is not everything. Even if all code lines and/or branches run under the tests, it's not the proof of code correctness. I did a curious experiment once - I ran a script which commented out each line or a consecutive pair of lines in the source code in turn, and then ran the tests; if the tests passed, it meant that the coverage is not complete. While this is certainly not a ideal approach, and is not possible at all unless your code is around 10-30k LOC, it did help me find some redundant code, and I even caught one bug (memory allocation failure was not handled correctly in a function) with this.

* And at last, but certainly not at least - after you've done all of these, maintain the test suite. These things tend to break if they're left by themselves - read the overnight test report every morning, pay attention to every test failure, and make sure they are solved as fast as possible. Otherwise, all of the above would be in vain.

Well, that's it, basically. With all these steps, you'll be able to say, that you've done everything you could to ensure your product's quality. While this does not mean that you won't have any bugs, at least this means that you won't have any bugs you could have anticipated.

Finally, I'll summarize the [pugixml](http://code.google.com/p/pugixml) test setup.

All test code and data is in Subversion repository, so everyone can check it out and build. The tests are built with the help of [Jamplus](http://www.jamplus.org/) build framework - they are automatic, except the fact that you should install jamplus and additionally configure all necessary compilers on Windows - there is no way most of them can be automatically configured. All pugixml allocations go through special allocators, that use both of the page protection approaches I outlined above. Since I don't use CI, I don't guard myself against the asserts, crashes or hangs, although sometimes I feel I should do it.

At the higher level, there are several scripts that launch jamplus with all toolsets that are supported on the current platform, with the desired configuration combinations. All configurations of a single toolset are built in a single jam run, which gives me maximum parallelism. Each script produces a log with special markers for each configuration test result.

There is a top-level script, which launches the test on all platforms with all toolsets, merges the output logs by concatenation, and then invokes the script that parses the log and produces the HTML report, a screenshot of which you can see at the beginning of the post (it's clickable!). I run the local single-toolset single-configuration tests after each change; the full test suite is run manually after several changes (i.e. each 20 revisions or so).

To test the library on different platforms, I use VirtualBox; I have several virtual machines (one for each OS, two for Linux/FreeBSD because of 32/64 bitness), each is configured so that it launches a special listener script on startup, which receives the build command over the socket, runs the build, outputs the result through the socket, and shutdowns itself. In addition to the usual platforms (x86/x64 on Linux, FreeBSD, Solaris and MacOS X), I use MacOS X to run the tests in big-endian environment - MacOS X lets you run the programs compiled for PowerPC architecture (they're emulated, but it's good enough).

So, that's it. I hope the description of the important points for testing process and the testing process itself was of some use to you; if you're interested in the details (i.e. in automatically running tests via VirtualBox), you can [look at the source](http://code.google.com/p/pugixml/source/browse/#svn/trunk/tests) - look for .pl and .sh files, since most of the scripts are in Perl, with additional /bin/sh help. While the minimalism of my library allowed me to give extreme attention to testing, I believe that proper testing process is critical for the code quality of any other library, regardless of the size; here, at work, we lack in test coverage, but we still have a CI process that tests all platforms with all configurations automatically, and it was very helpful - I've certainly never regretted the invested time.
