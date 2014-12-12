---
layout: post
title: Exit code trivia
---

Whenever there is an automated process involved, such as asset/code building, unit testing, automatic version packaging, bulk log processing, etc., there often is a set of command-line tools which do their thing and return the result. Then there is a calling process (which may be as simple as a batch file, or as complex as IncrediBuild), which launches the tool and acts upon success/failure.

In the world of command-line tools, success/failure is represented with exit code. However, it is important to understand that exit codes are to be treated carefully.

Here is a rough set of guidelines to handling exit codes:

* The canonical success code is 0, not 1. This is also true for return codes of functions - 0 always makes success. Never return 1 from your command-line tool to communicate success - no caller will expect this.

* Related to the above - there should be only one success code, i.e. everything else should be treated as error. There is no unambiguous encoding for several success values; the user probably does not care about details, the success is enough; for some system calls, like `system()`, cross-platform handling of different success values results in extra work (Windows returns the exit code as is, Linux returns a value that contains the exit code and additional information).

* In utmost majority of cases you don't need more than one error code either. The reasons are the same.

* Even if you decide to use several error codes, do not use negative numbers. Some negative numbers may be used as special values for functions that normally return exit codes - in fact, one such number is -1; the family of `spawn` functions return -1 on error, so if you return -1 from your tool, the resulting error will be unexpected - we had one such case with SCons, where the matters were additionally complicated by the fact that -1 raised an OSError exception, which was swallowed by the SCons internals for some weird reason).

* If the tool fails, returning an error code is not enough - you should output the additional error information, which should be as detailed as needed to be able to further investigate the issue (i.e. don't return 'file load failed' flag, print the name of file that the program failed to open, and the error code).

* As a somewhat related thing, if the tool succeeds, prefer less verbose output. An ideal tool is the tool that outputs zero lines of information if it succeeded (which reduces the clutter, enables easier detection of warnings, and generally makes people pay attention to the problems in the automated process because they are the only thing that's printed!). If you need debugging/statistics information, consider adding a separate command-line flag. If you need version information for diagnostics, output it when a special command-line flag is used, not for every build.

* Be careful with batch files. It is very easy to accidentally lose an exit code in the batch file. In fact, if you can avoid batch files completely or make them one-liners that call your script interpreter of choice, do it; if you can't, still try to go that way as far as possible.

So basically, if you only use 0 (success) and 1 (failure) exit codes, return additional failure information via stdout/stderr, and don't pollute stdout with things that are not indications of some problem, the users of your command line tool will love you.
