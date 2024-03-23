---
layout: post
title: Condvars and atomics do not mix
excerpt_separator: <!--more-->
---

When using `std::condition_variable`, there's an easy to remember rule: all variables accessed in wait predicate must be changed under a mutex.
However, this is easy to accidentally violate by throwing atomics in the mix.

<!--more-->

> This post is much shorter than usual, and it was originally written in 2022 and published [on Cohost](https://cohost.org/zeux/post/520125-condition-variables). Originally my plan was to use Cohost for shorter notes like this one, and this blog post for long-form carefully detailed content. However, Cohost has an uncertain future and various limitations, and restricting this blog to long form posts results in very few articles that actually end up being written! As such, I'm going to experiment with posting shorter technical content like this more regularly in the coming months, including reposting my earlier Cohost posts (of which this is one of).

Consider how a typical job pool worker function might look like:

```c++
std::unique_lock<std::mutex> lock(m_mutex);

while (true) {
    m_has_work.wait(lock, [this] {
        return m_queue.size() > 0;
    });

    // Get the job from the queue and execute it
}
```

This code is conserving CPU resources in case the work queue is empty by waiting on `m_has_work` which is a `std::condition_variable`. The problem though is that to cleanly terminate this thread, the main thread needs to call `join()` on the `std::thread` object running this code - but if the thread is waiting for work, `join()` will hang because work never arrives! No problem, let's add `std::atomic<bool> m_kill_flag`, and change the loop accordingly:

```c++
m_has_work.wait(lock, [this] {
    return m_kill_flag || m_queue.size() > 0;
});

if (m_kill_flag) break;
```

Now all we need to do is raise the flag before joining the threads:

```c++
// Notify all workers that they need to die right now.
m_kill_flag = true;
m_has_work.notify_all();

// Wait for all workers to die.
for (size_t i = 0; i < m_threads.size(); i++)
    m_threads[i].join();
```

All good? Not so fast! This code has a race condition, and may occasionally hang!

The fact that `m_kill_flag` is an atomic here is doing us a disservice: if we change it to a regular bool, then Clang's thread sanitizer dutifully complains that the write to the boolean is unprotected:

```
WARNING: ThreadSanitizer: data race (pid=88143)
  Read of size 1 at 0x00016d231114 by thread T5 (mutexes: write M32):
...
  Previous write of size 1 at 0x00016d231114 by main thread:
```

The boolean is read under the mutex, but it was written without the mutex being held. It may feel like an overkill to grab a mutex to toggle a boolean, and using `std::atomic` fixes ThreadSanitizer report - but doesn't fix the race.

Consider that `wait(pred)` is equivalent to a loop like this:

```c++
while (!pred()) cvar.wait();
```

What can happen in case above is that the thread checks the kill flag, which hasn't been set to true yet, but before it gets the chance to park the thread (`cvar.wait()` will add the thread to a list of threads waiting on the cvar so that `notify_all` can wake it), the main thread sets the flag to true and calls `notify_all`. The notification state isn't "sticky" - `notify_all` will not wake threads that aren't currently waiting on the condition variable!

After this main thread proceeds to call join, and the worker thread calls `cvar.wait()` as it missed both setting of the flag to true and the attempt to notify the variable. Thus the thread waits on condition variable forever, and main thread waits to join the thread forever - a deadlock, that unfortunately escapes ThreadSanitizer's attention because `std::atomic` silences the report.

The correct way to go here is to ditch the atomic and grab the mutex in the destructor:

```c++
// Notify all workers that they need to die right now.
{
    std::unique_lock<std::mutex> lock(m_mutex);
    m_kill_flag = true;
    m_has_work.notify_all();
}
```

This ensures that the state of kill flag can't change between checking the predicate state, and the work that the condition variable does to atomically unlock the mutex and add the thread to the condition variable wait list, fixing the race.

> Note that `notify_all` can also be called outside of the scope; the code above results in a small loss of efficiency, as threads that get woken will attempt to grab the mutex that's being held by the main thread. That said, the threads will serialize with each other on wakeup so it's not likely to be a significant issue in this case, but it's something to keep in mind in other cases, especially when using `notify_one`.

Of course, there's no general rule of thumb that any code mixing atomics and condition variables has races like this - but whenever this mix happens it can be useful to do a very careful audit of the code. Atomics provide what I like to call "physical" atomicity - individual variables will be in a coherent state - but what's often desired is "logical" atomicity, where whole system invariants continue to hold, and issues around this are easy to miss especially when tools like ThreadSanitizer only check individual accesses.
