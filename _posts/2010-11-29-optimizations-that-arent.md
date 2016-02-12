---
layout: post
title: Optimizations that aren't
---

We all like it when our code is fast. Some of us like the result, but dislike the process of optimization; others enjoy the process. However, optimization for the sake of optimization is wrong, unless you're doing it in your pet project. Optimized code is sometimes less readable and, consequently, harder to understand and modify; because of that, optimization often introduces subtle bugs.

Since optimization is not a process with only positive effects, in production it's important that optimization process follows certain guidelines that make sure the optimization does more good than bad. An example set of optimization steps would be:

1. Make sure that the code you're optimizing works. If possible, it should be covered by tests; otherwise one can resort to saving the results that the code produces, i.e. a data array for a particular input or a screenshot.

2. Measure the performance of the target code in a specific situation, for example on a fixed set of input data, or, in case of games, at the very beginning of the level, or measure the average/maximum timings across the whole level.

3. Verify that the measurements are precise enough, i.e. don't have a very large variation between runs.

4. Verify that the performance is inadequate for your target requirements (you can't start optimizing if you don't know your target requirements). It's important that the measured situation is common enough - ideally you should measure in the worst possible circumstances for the code, which are still possible in the target product (i.e. if the unit number cap is 1000, profile with 1000 units). If necessary, make several measures in different situations.

5. Record the timings/memory statistics/other performance-related information.

6. Optimize the code using any available means, starting with the ones that are easier to code and minimally affect maintainability. In game development, if there is a substantial gain that is necessary, maintainability reasons should probably be cast aside.

7. Check that the code still works (run unit tests, compare the results with that from 1.)

8. Measure using the same data from 2., compare the results, repeat the process if necessary.

There are two absolutely crucial things here - make sure that the code still works, and have proper profiling before- and after- results. Often it's useful to make a note of the results after each significant chunk of optimization, and save the results somewhere - some optimizations might get in the way later, and with the records you'll probably be able to separate critical optimizations from less critical.

If you did not verify the code, it's possible that the code now does something different - such optimization is usually bad (one exception is rendering algorithms, where usually you can replace 'is exactly the same' with 'looks something like' or even 'is noticeably different, but the artists like it better/can live with it').

If you did not profile the code, you don't know if it works faster, and if it does, if it is considerably faster. Such optimization is worthless.

I have an actual story about that. Unfortunately, the information I have is incomplete - I have the code with an "optimization" that considerably decreases the actual performance, but I don't have the change history. Still.

There is (was?) a COLLADA Exporter by Feeling Software, which, given an input Maya scene, produces a COLLADA XML document. This process is done at export time, which is either triggered by the artist manually, or is done automatically during the build process. The performance requirements for such tools are obviously different from the ones of a game - but optimizing the content pipeline response time is arguably equally important to optimizing game framerate, because faster iteration times and a good team mean more iterations, and more iterations mean more polished product.

Back at CREAT Studios, we used COLLADA pipeline for Maya/Max export; we tried to avoid touching the code, but sometimes we could not avoid it. An awesome export response time for a mesh is one second; a good one is ten seconds. We had some models that exported for several minutes. After some profiling several issues showed up - and here is one of them.

During the export, there are several parts of a document that can reference the same nodes from Maya DAG (Directed Acyclic Graph, pretty much the entire scene in Maya is a DAG); it is necessary to 'sample' the said nodes (i.e. to get the values of some attributes for these nodes for different time values). Sampling can be slow in Maya, because it can involve complex updates of the DAG - to accelerate that, there is a special class, CAnimCache, that caches the sampling requests. The key for the sampling request is a pair (object, attribute), the value is the list of attribute values and several flags. object is represented as MObject, plug is represented as MPlug.

The cache is organized as follows: there is an associative container with the key being the object, and the value being a list of parts. Each part holds the attribute and the cached value:

```cpp
struct Part { MPlug plug; FloatList values; };
struct Node { MObject node; vector<Part> parts; };

struct Cache
{
    map<MObject, Node*> cache;
};
```

The code looks reasonable - the cache lookup is logarithmic in terms of object count and then linear in attribute count - objects usually have a modest amount of attributes, it should be fast enough. The cache key could probably be a pair of pointers, but oh well.

Still, somebody thought that this code is not fast enough. I do not know if the necessary performance tests were made - I guess they were not, or maybe the map was not a map but a vector when the change was made - anyway, somebody thought that this code is not fast enough, specifically that the map lookup is slow.

It's easy to optimize the map lookup if we assume that the consecutive cache lookups happen with the same object, but with a different attribute - this is a reasonable assumption and it holds in practice. So, the code was modified and looked like this:

```cpp
struct Cache
{
    map<MObject, Node*> cache;
    Node* search;

    Cache(): search(NULL) {}
    
    bool FindCacheNode(const MObject& node)
    {
        iterator it = cache.find(node);
        if (it != cache.end())
        {
            search = it->second;
            return true;
        }
        return false;
    }

    void CachePlug(const MPlug& plug)
    {
        if (search == NULL || search->node != plug.node()) FindCacheNode(plug.node());
        if (search == NULL)
        {
            search = new Node(plug.node());
            cache.insert(plug.node(), search);
        }
        
        /* additional processing of the search node */
    }
};
```

Can you spot the problem?

At the first call to CachePlug, search is NULL, so the function FindCacheNode is called, which does not find the node. search is still NULL, so a new node is inserted; now search points to this node.

At the next call to CachePlug with a different MObject, search is non-NULL, but the node is different, so FindCacheNode is called again. It can't find the desired node - after all, nobody inserted it! - so it returns false... **without resetting search to NULL!**. In fact, nobody ever resets search to NULL - so nobody adds new Node's - so the map always has one element, and the parts vector contains all attributes of all nodes in the scene! As you can imagine, this makes all functions from the cache linear in terms of scene object count, and thus the whole export process quadratic. All functions still worked, but the export was slow for large scenes.

It is hard to reconstruct the sequence of events without a change history - however, one thing is certain. At some point here somebody did an optimization without any prior profiling (map lookup could not be a serious factor - after I fixed the bug, the functions from this class were nowhere near the profile top), and without any profiling after the change - otherwise he'd spot the bug.

The code travels in sometimes unexpected ways. A year ago I found the same issue in OpenCOLLADA, which inherited some code from Feeling Software exporter. (it was fixed after my report).

Optimization without profiling is wrong. Profiling without measuring and comparing the results is wrong. Please do not do either of that. And please, look at your code in the profiler once in a while, even if the performance is tolerable - you'll find things you didn't expect.

P.S. The credit to discovering the optimization bug actually goes to Peter Popov (of the Linux RSX fame).
