---
layout: post
title: Quicksort killer sequence
---

Today I'm going to describe a not very practical but neat experiment, the result of which is a sequence that's awfully slow to sort using Microsoft STL implementation; additionally, the method of generating such sequence naturally extends to any other quicksort-like approach.

First, a quick refresher on how std::sort [in Microsoft STL] works. It is a variant of introsort with insertion sort for small chunks. It proceeds as follows:

* For small sequences (32 elements or less), it uses insertion sort, which has O(n<sup>2</sup>) average complexity, but has a better constant than a quick sort;

* For other sequences, a median of either three or nine elements, depending on the sequence size, is selected as a pivot;

* The array is partitioned in place, resulting in three chunks: the leftmost chunk has all elements that are less than the pivot, the middle chunk has all elements that are equal to the pivot, and the right chunk has all elements that are greater than the pivot;

* Left and right chunks are sorted recursively (actually, only the smaller one is sorted via a recursive call, but that's not significant);

* Finally, if the recursion depth is too big (more than 1.5\*log2(N)), the algorithm switches to heap sort, which has a worst-case complexity of O(n*log(n)).

This, given a careful implementation, results in a good general sorting function - it uses quicksort (which has a lower constant than heapsort), but falls back to heap sort on inputs that sort slowly with quicksort. However, due to unfortunate debug checks inside pop_heap function in MSVC2005 and 2008, the heap sort is quadratic in debug builds (this has been fixed in MSVC2010), so if we can make a sequence that'll make quicksort quadratic, this introsort implementation will also go quadratic in debug builds.

Since all quicksort-like sorts only depend on the order between elements (they're comparison-based), we can build the sequence of any type (i.e. a list of strings), and then make a sequence of some other type (i.e. integer list) with the same order; the number of comparisons will be the same.

Each quicksort-like sort has the following algorithm:

1. Select the median(s) either using pseudo-random numbers or some fixed set of elements inside the given range;

2. Partition the range in several chunks, with rightmost chunk consisting of all elements larger than the largest median (my method can be naturally extended to multi-pivot sorts);

3. Recursively sort the chunks.

Our goal, in order to make the worst possible sequence, is to maximize the size of the rightmost part; then the recursive call depth will be linear in terms of original element count, and the whole routine will be quadratic. To achieve that, we're going to incrementally build the strings in the list with the following algorithm:

1. Get the locations of median candidates for the first sorting pass (i.e. not including recursive calls);

2. One of them (the middle one, assuming that it's moved appropriately) is the median (pivot); we append the following letters to all strings:
 * 'a' to all median candidates to the left of the pivot;
 * 'b' to the pivot itself;
 * 'c' to all other elements.

3. With the previous pass we maximize the amount of elements that are larger than the pivot; after this, we proceed recursively.

In order to get the information about the median candidates, the median and the partition results, we need to slightly instrument the sorting function; I made the following interface:

```cpp
struct sort_context
{
    virtual bool less(const element& lhs, const element& rhs) { return lhs.last < rhs.last; }
    virtual void partition_begin() {}
    virtual void partition_median(const element* med) {}
    virtual void partition_end(const element* right_begin, const element* right_end) {}
};

struct predicate
{
    sort_context* context;

    bool operator()(const element& lhs, const element& rhs) const
    {
        return context->less(lhs, rhs);
    }
};
```

The sorting function should call partition_begin before each sorting pass, partition_median after the median is selected, and partition_end after the array is partitioned, passing the range of the rightmost chunk.

Then we can implement the function that retrieves indices of median candidates:

```cpp
std::pair<std::vector<size_t>, size_t> get_first_median_positions(element* data, size_t count)
{
    struct median_context: sort_context
    {
        bool inside;
        unsigned int counter;

        const element* median;
        std::vector<const element*> positions;

        median_context(): inside(false), counter(0), median(0)
        {
        }

        virtual bool less(const element& lhs, const element& rhs)
        {
            if (inside && counter == 0)
            {
                positions.push_back(&lhs);
                positions.push_back(&rhs);
            }

            return sort_context::less(lhs, rhs);
        }

        virtual void partition_begin()
        {
            assert(!inside);
            inside = true;
        }

        virtual void partition_median(const element* med)
        {
            assert(inside);
            inside = false;
            if (counter++ == 0) median = med;
        }
    };

    // collect median data
    median_context c;
    sort(data, count, &c);

    if (!c.median)
    {
        assert(c.positions.size() == 0);
        return std::make_pair(std::vector<size_t>(), 0);
    }

    // sort & remove duplicates
    std::sort(c.positions.begin(), c.positions.end());
    c.positions.erase(std::unique(c.positions.begin(), c.positions.end()), c.positions.end());

    // convert from pointers to offsets
    std::vector<size_t> result(c.positions.size());

    for (size_t i = 0; i < result.size(); ++i) result[i] = c.positions[i] - data;

    // get median position
    std::vector<const element*>::iterator median = std::find(c.positions.begin(), c.positions.end(), c.median);
    assert(median != c.positions.end());

    return std::make_pair(result, median - c.positions.begin());
}
```

a function that sorts the array and returns the partition information for the first pass:

```cpp
std::pair<size_t, size_t> get_first_partition_right_modify(element* data, size_t count)
{
    struct partition_context: sort_context
    {
        unsigned int counter;
        const element* begin;
        const element* end;

        partition_context(): counter(0), begin(0), end(0)
        {
        }

        void partition_end(const element* right_begin, const element* right_end)
        {
            if (counter++ != 0) return;

            begin = right_begin;
            end = right_end;
        }
    };

    // get partitioning data
    partition_context c;
    predicate pred = {&c};
    std::sort_instrumented(data, data + count, pred);

    // get indices
    return (c.begin == 0 && c.end == 0) ? std::make_pair(0, 0) : std::make_pair(c.begin - data, c.end - data);
}
```

and finally the main function, that uses the above helpers:

```cpp
void update_array(element* data, size_t count)
{
    // get positions of the first median candidates (along with the median itself)
    std::pair<std::vector<size_t>, size_t> p = get_first_median_positions(data, count);

    if (p.first.empty()) return;

    // fill elements as follows:
    // - elements from median candidates before median get an 'a' appended
    // - median element gets a 'b' appended
    // - all other elements get a 'c' appended (so that they go into the right half after partition)
    std::map<size_t, char> actions;

    for (size_t i = 0; i < p.second; ++i) actions[p.first[i]] = 'a';
    actions[p.first[p.second]] = 'b';
    char action_otherwise = 'c';

    for (size_t i = 0; i < count; ++i)
    {
        std::map<size_t, char>::iterator ait = actions.find(i);

        data[i].last = (ait == actions.end()) ? action_otherwise : ait->second;
        *data[i].data += data[i].last;
    }

    // copy the elements to preserve the original data
    std::vector<element> copy(data, data + count);

    // get the right partition (left should be very small so we don't care)
    std::pair<size_t, size_t> partition = get_first_partition_right_modify(&copy[0], count);

    // process the right half
    update_array(&copy[0] + partition.first, partition.second - partition.first);
}
```

Note that as an optimization, the predicate only compares the last characters of the strings; since after each partition the contents of the right chunk consists of equal elements, the only difference is in appended character (which is one of 'a', 'b', 'c').

The only task that remains is to convert the string array to the integer array with the same order; this is straightforward, except that we have to use std::multiset for sorting since std::sort is slow on this set of data (which was the goal, after all :):

```cpp
std::vector<size_t> generate_array(size_t count)
{
    // create element array with empty strings
    element* data = new element[count];

    for (size_t i = 0; i < count; ++i)
    {
        data[i].data = new std::string;
        data[i].last = 0;
    }

    // update it to make worst possible order
    update_array(data, count);

    // make a sorted copy using std::multiset because std::sort is slow on this data (we prepared the data this way!)
    std::multiset<element> copy_set(data, data + count);
    std::vector<element> copy(copy_set.begin(), copy_set.end());

    // create an order remap
    std::map<std::string*, size_t> order;

    for (size_t i = 0; i < copy.size(); ++i) order[copy[i].data] = i;

    // create an integer array with the same order
    std::vector<size_t> result;

    for (size_t i = 0; i < count; ++i) result.push_back(order[data[i].data]);

    // cleanup
    for (size_t i = 0; i < count; ++i) delete data[i].data;
    delete[] data;

    return result;
}
```

Here is [the full source code](https://gist.github.com/zeux/148aed5d4bbc8c74a7f4) for this post. It contains the above code for generating the killer sequence for a quick sort implementation, and additionally the instrumented sorting function from MSVC2008 STL. This code may not compile on other compilers because of the MS-specific parts of the sorting function itself, but otherwise should work fine.
