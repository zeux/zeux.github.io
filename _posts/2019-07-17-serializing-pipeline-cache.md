---
layout: post
title: Robust pipeline cache serialization
excerpt_separator: <!--more-->
---

When writing a Vulkan renderer, one has to learn a lot of new concepts. Some of them are easier to deal with than others, and one of the pretty straightforward additions is the pipeline cache. To make sure pipeline creation is as efficient as possible, you need to create a pipeline cache and use it whenever you need to create a new pipeline. To make sure subsequent runs of your application don't have to spend the time repeatedly compiling the shader microcode, you need to save the pipeline cache data to a file, and load it next time your application starts. How hard can this possibly be?

<!--more-->

Pretty hard, as it turns out.

# What's in a pipeline cache?

Pipeline cache data is a (mostly) opaque blob; you create a `VkPipelineCache` object, possibly giving it the initial blob to start with, and then at some point you can retrieve the data blob from this object.

While we don't know much about the contents of the blob short of reading graphics driver source code[^1], the pipeline cache data is guaranteed to start with a structure that identifies the device and looks something like this:

```c++
struct VkPipelineCacheHeaderOne
{
    uint32_t length; // == sizeof(VkPipelineCacheHeaderOne)
    uint32_t version; // == VK_PIPELINE_CACHE_HEADER_VERSION_ONE
    uint32_t vendorID;
    uint32_t deviceID;
    uint8_t uuid[VK_UUID_SIZE];
};
```

The header is followed by driver-specific information that typically contains bits of shader microcode, the format of which depends on the GPU, and auxiliary data that may contain arbitrary driver defined structures. Some drivers treat this blob as a structured file stream and read data from it, some drivers store raw structures defined in driver source in that blob and use `memcpy` or pointer casts to navigate the data; needless to say, a driver update may invalidate the way the data is stored.

Now, in theory, the application just needs to use `vkGetPipelineCacheData` to retrieve a data blob after the application reaches a steady state (for example before the application exits...), save the blob to a file, and then pass this blob using `VkPipelineCacheCreateInfo::pInitialData` when creating the pipeline cache on the next run. If the contents of the blob doesn't work for the current version of the driver - maybe the driver was updated, or maybe the user switched to a different GPU - the driver is supposed to ignore the initial data and create an empty pipeline cache.

In practice, theory and practice are a bit different. The rule of thumb in practice is that a driver will only be able to correctly handle the *exact* blob that the *exact* same driver gave your application previously. Which is where the problems begin[^2].

# Is the driver the same?

The specification assumes that the cache isn't compatible between different devices (which is why vendorID and deviceID are present in the header), and relies on the driver to establish a pipeline UUID - which is a 16-byte GUID - that accurately identifies the full set of factors that lead to being able to interpret a pipeline cache blob - you can think of this as a version number of the pipeline cache format. For example, during a driver upgrade, it may be the case that the pipeline cache format is *not* updated, in which case the UUID typically shouldn't change, which means that the application won't need to recompile the shaders from scratch.

However, drivers in the wild tend to exhibit two types of problems.

Some, older, drivers neglect to verify the UUID correctly. As a result, during a driver update application may try to give the blob with a stale UUID to the driver, the driver will try to interpret this as recent data and as a result, `vkCreatePipelineCache` may crash. Note that in general `vkCreatePipelineCache` doesn't provide a guarantee that it accepts *arbitrary* data and can handle it cleanly.

Some drivers, including pretty recent ones, may neglect to update UUID in a driver update that actually breaks compatibility of the shader pipeline binary. This can happen during a driver version update (although this is rare), or - something that happens trivially on current drivers of at least one major vendor - between driver binaries that are built from the same version for different ABI. If a 32-bit driver and a 64-bit driver that ship on the same system have the same pipeline UUID, then *saving* the cache from a 32-bit version of the application and *loading* it from a 64-bit version may cause the driver to crash - which is *exactly* what happens when you ship a 32-bit version of your application and then update it to 64-bit following Google's guidelines.

# Is the data the same?

Now that we know what awaits us when it comes to header validation, what's next is validating the data. After calling `vkGetPipelineCacheData`, application saves the blob, and loads the exact same blob on the next run.

It turns out that saving data to a file is [basically impossible to do well](https://danluu.com/deconstruct-files/). Filesystem issues as well as process stability issues may in some cases lead to files that are partially written, have chunks filled with zeroes at the end (or even with garbage), or, as a special case, are created but stay zero-size. On mobile, this can be complicated by the fact that the application is likely to be terminated abruptly at an arbitrary point in time by the user or the OS, something that happens less frequently on desktop; on Android it's also common to use multi-process (multi-activity) applications and if your pipeline cache code runs in both processes and shares the same output file, these challenges become even harder to solve.

The reason why zero-size files are particularly interesting is that there is at least one driver version that we've ran into where passing a non-NULL `pInitialData` and `initialDataSize == 0` returns an error during pipeline cache creation. Which brings us to the final caveat.

# Error handling is hard

While the spec says that `vkCreatePipelineCache` should basically always succeed, short of running out of memory, such statements in the spec are rarely accurate. When creating the pipeline cache, the driver is supposed to ignore initial data if it's incompatible (for example if it's zero sized, if the stored UUID didn't match the expected UUID, or if deserialization failed for any other reason); some drivers, instead, fail to create the pipeline cache.

The user definitely isn't at fault here, so aborting the application would not be polite; while it's generally possible to proceed without a pipeline cache, that's usually a terrible idea because that means that each pipeline has to be recompiled from scratch. That is, pipeline caches have utility even if they are not serialized to disk because they allow the driver to cache the results of compilation across pipeline objects in memory.

All of this naturally leads to...

# It's not paranoia if they are really out to get you

... the solution. When serializing pipeline cache data to the file, we use a header that is filled with enough information to be able to validate the data, with the pipeline cache data following immediately afterwards:

```c++
struct PipelineCachePrefixHeader
{
    uint32_t magic;    // an arbitrary magic header to make sure this is actually our file
    uint32_t dataSize; // equal to *pDataSize returned by vkGetPipelineCacheData
    uint64_t dataHash; // a hash of pipeline cache data, including the header

    uint32_t vendorID;      // equal to VkPhysicalDeviceProperties::vendorID
    uint32_t deviceID;      // equal to VkPhysicalDeviceProperties::deviceID
    uint32_t driverVersion; // equal to VkPhysicalDeviceProperties::driverVersion
    uint32_t driverABI;     // equal to sizeof(void*)

    uint8_t uuid[VK_UUID_SIZE]; // equal to VkPhysicalDeviceProperties::pipelineCacheUUID
};
```

The hash of the pipeline cache data will allow us to validate the integrity of the data; to reduce the chance of an I/O error *actually* causing an integrity issue, we create a temporary file, write this header to the file followed by the pipeline cache data, and then move the file to the target location using `rename`.[^3]

When loading the pipeline cache, we read the header, read the data, validate the data read using `dataSize` and `dataHash`, then validate that the data can be safely passed to the driver by comparing the remaining fields with the properties of the device[^4].

If the data is valid, `vkCreatePipelineCache` is called with the correct initial data. Crucially, if this call fails, this suggests that the driver implements additional checks that our logic didn't detect on its own - instead of proceeding without the pipeline cache, we create an empty pipeline cache in this case by calling `vkCreatePipelineCache` again, with no initial data.

We also create the empty pipeline cache if the pipeline cache file was not found or our validation logic classified the data as unusable.

> Note: because we incorporate `driverVersion` into the header, any driver update will cause pipeline cache to be rebuilt; we include this check because this completely eliminates issues where pipeline cache UUID doesn't update even if it should - typically `driverVersion` is updated as part of build process, whereas UUID update is more manual. For applications that target desktop exclusively this can be too aggressive - in general desktop drivers are likely to be more well behaved with respect to handling pipeline cache validity so not all of this advice applies.

# Conclusion

~~Friends don't let friends ship Vulkan on Android~~ Vulkan drivers are not always correct and don't always follow the specification to the letter. Pipeline cache data is an especially fragile part of the Vulkan renderer because I/O is challenging to get right, and there's often minimal to no integrity checks in the driver. However, with enough application-side validation, you *can* eliminate stability issues coming from the pipeline cache handling in practice - it just takes work.

Good luck. ~~You're going to need it.~~

---
[^1]: Which you can absolutely do these days! For example, [here's an implementation of vkGetPipelineCacheData for radv](https://github.com/mesa3d/mesa/blob/1d5ee315536d4563714b35004d9efc1bd6621f53/src/amd/vulkan/radv_pipeline_cache.c#L525).
[^2]: The remainder of this article is based on the experience of continuously shipping [Roblox](https://corp.roblox.com/) client on Android with Vulkan support and surviving through various Android OS updates, driver updates and in general dealing with both early and current Vulkan drivers from all major vendors.
[^3]: In theory `rename` is supposed to be atomic, but in practice the exact semantics and guarantees vary with the file system; hash is useful as a way to perform a robust comparison.
[^4]: Depending on the application you may want to also use different file names based on, for example, `vendorID` or `driverABI`; this is more interesting on desktop and less interesting on mobile.
