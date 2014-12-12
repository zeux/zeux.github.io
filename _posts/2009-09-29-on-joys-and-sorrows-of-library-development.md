---
layout: post
title: On joys and sorrows of library development
redirect_from: "/2009/09/29/on-joys-and-sorrows-of-library-development-–-part-1/"
---

This may come as a surprise, but I am not dead. In fact, what you see is a new post! As usual I have a lot of interesting themes to cover, and barely enough time to spare. While I'm at it, let me tell you about NDAs. I hate NDAs with a passion – I've got some things to blog about that are partially covered by NDA (of course, the interesting parts are NOT); also I've been thinking that this is a non-issue and basically that I can blog about things that are not quite critical, but half a year ago or so I was forced to remove a blog post; the reasons are not exactly clear but it seems that it was because of a single sentence that mentioned something that's NOT secret in my point of view and was NOT relevant to post contents. For this reason I'm hesitant to write about some topics so I'll either skip them altogether (which is a shame) or find a way to omit all details that might seem sensitive to people. Also I'm not sure if blogging about post removal due to NDA is an NDA violation?..

Anyway, the topic for today is something different – I'll write a bit about library development. 

In past few years I've developed and maintained a C++ XML parser [PugiXML](http://code.google.com/p/pugixml). This is a tiny library which focuses on performance and ease of use. We've had tremendous speedups of export process after converting from [TinyXML](http://www.grinninglizard.com/tinyxml/), and I know lots of other success stories. PugiXML is portable (lots of platforms and compilers are supported, I've gone through special efforts to support MSVC6 and old CodeWarriors), console-aware (i.e. you can toggle off STL/exception support, override memory management, etc.), small, robust, etc. It even features an XPath evaluator!

PugiXML was born as a project to clean up [pugxml](http://www.codeproject.com/KB/cpp/pugxml.aspx) – initial idea was to strip pugxml header from sources (thus reducing compilation/linking times), slightly cleanup interface and use it. What followed was an almost complete rewrite of the code, bringing the parser closer to standard compliance, adding useful features for DOM inspection, and greatly improving speed. There are bits of code left from pugxml, and interface is very similar, but it's quite a different project now. As far as I know, the only parser in use that beats PugiXML at parsing speed is [RapidXML](http://rapidxml.sourceforge.net/), and the only major problem with PugiXML is that it's Unicode support is pretty much limited by UTF8. Though both of those may change at some point in the future :)

I'm going to write some stuff here that may be of interest to other people.

1. Interface

The initial API was taken as-is from pugxml; in the hindsight, this was both a good (since it offered a very simple transition for pugxml users) and bad thing. It's a bad thing because the interface is seriously cluttered.

For example, there are at least four methods of traversing children nodes: you can use the `next_sibling()` function (the DOM is structured as a graph of nodes, with nodes connected via pointers; each node contains a pointer to both right and left siblings, the function gets the right one), you can use the node iterator, you can use `xml_tree_walker` (which is a Visitor-like interface), and finally you can grab all child elements via an insert iterator with `all_elements_by_name()`. Oh, and you can use XPath, which makes five methods.

As another example, every method for string-based queries (i.e. `xml_node::attribute(const char*)`, which means “give me the first attribute with the following name) has a corresponding method which uses wildcard matching instead of string comparison (i.e. `node.attribute_w(“foo*ba?”)` will match foobar or fooatbaz).

Overall, it's not that much (I have a friend who's been working with a codebase that has an interface with 760+ virtual functions, so I'm not easily scared) and it does not stand in the way while you're using the library, but it certainly does not help maintaining and developing it.

But the worst part is that I can't remove any of those functions. For example, I consider tree walker to be a bad abstraction; it's rarely usable, and if it is, it's easy to write it outside the library. If I had a full API usage statistics, I could've made a conscious decision – either nobody uses it and I remove it, or there are very few who do and I extract it into an external helper class in an external header (possibly changing the interface slightly), or it's a feature that is used in every second application that uses my library and I can't do anything. The problem is I have no statistics, so I can't do anything.

Other than that, I feel the interface to be good (I use it relatively often both in my pet projects and at work, so if there was something that annoyed me I would've fixed that); the best decision for me is pointer abstraction – in pugixml you don't work with pointers to node (as with TinyXML), you work with tiny pointer wrapper class (the size is equal to that of a pointer) that's passed by value; the point is that there is no null pointer exception, all operations on “null” nodes/attributes are perfectly defined. Of course, the same could be done with a pointer API by using a dummy object instead of null pointer, what matters is the decision to protect the user. Also I find that this makes parsing code much more concise – you don't have to do error handling for every API call!

2. Performance

The parsing performance is very good, on COLLADA files it's hundreds of megabytes per second (probably closer to gigabyte); the bottleneck is always HDD read speed unless the file is cached. Of course, it's still slightly slower than it could be; also the performance comes for a price of not being fully standard compliant – it manifests in allowing certain XML standard violations, such as disallowed Unicode symbols in attribute/node names, multiple node attributes with the same name, etc. This means that while any correct XML file will be parsed, some malformed ones will not be rejected. Up to some point there even were flags to make parser pass certain standard violations (i.e. there was a mode that could handle HTML-style unclosed tags by scanning for matching open tag and automatically closing all descendants), but I removed them to reduce clutter (that was at the point when parser was used by me and a couple of friends so no harm done).

The memory consumption is also good enough (when we switched from TinyXML at work, we got ~2x improvement in terms of memory required to parse a DOM tree), although it could be better. Surprisingly this was achieved without any tricks that I love (take the pointer, take lower N bits, stuff something useful in there, pretend that everything was that way) and almost without any bit-packing.

All good things come at a price – the parser currently requires that the whole XML file is a large contiguous chunk of memory (i.e. if you have a 200 Mb file to parse, you have to have a 200 Mb chunk of address space); also, this chunk dies with the document so in the worst case PugiXML can lose in peak memory consumption if you modify your tree too much (i.e. load a 200 Mb document from file, remove all nodes, add an equivalent amount of contents by hand – the memory overhead of PugiXML will be i.e. 400 Mb (larger than that because nodes take some space too), the memory overhead of a typical parser will be 200 Mb). Of course this is almost never a problem in practice.

Next time: performance highlights (tricks to make parsing fast, saving performance), user requests, documentation, portability concerns
