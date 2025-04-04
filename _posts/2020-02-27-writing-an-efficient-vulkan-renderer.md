---
layout: post
title: Writing an efficient Vulkan renderer
excerpt_separator: <!--more-->
---

In 2018, I wrote an article "Writing an efficient Vulkan renderer" for GPU Zen 2 book, which was published in 2019. In this article I tried to aggregate as much information about Vulkan performance as I could - instead of trying to focus on one particular aspect or application, this is trying to cover a wide range of topics, give readers an understanding of the behavior of different APIs on real hardware and provide a range of options for each problem that needs to be solved.

At the time of publishing this article, the [Kindle edition of the book](https://www.amazon.com/GPU-Zen-Advanced-Rendering-Techniques-ebook/dp/B07SYP7P6B) is available for $2.99 on Amazon - that's cheaper than a cup of coffee and it's definitely worth your time and money. It contains many great articles about rendering effects and design.

This, however, is the full, free of charge copy of the article - hopefully it will help graphics programmers to understand and use Vulkan to the full of its ability. The article has been lightly edited to mention Vulkan 1.1/1.2 promotions where applicable - fortunately, not much has changed in the last two years for Vulkan performance, so the content should still be mostly accurate.

Enjoy!

<!--more-->

> This article has been translated to [Korean](/data/effvulkan_kr.html) by 이정섭 and to [French](https://www.fevrierdorian.com/carnet/pages/ecrire-un-moteur-de-rendu-vulkan-performant.html) by Dorian Fevrier.

# Abstract

Vulkan is a new explicit cross-platform graphics API. It introduces many new concepts that may be unfamiliar to even seasoned graphics programmers. The key goal of Vulkan is performance – however, attaining good performance requires in-depth knowledge about these concepts and how to apply them efficiently, as well as how particular driver implementations implement these. This article will explore topics such as memory allocation, descriptor set management, command buffer recording, pipeline barriers, render passes and discuss ways to optimize CPU and GPU performance of production desktop/mobile Vulkan renderers today as well as look at what a future looking Vulkan renderer could do differently.

Modern renderers are becoming increasingly complex and must support many different graphics APIs with varying levels of hardware abstraction and disjoint sets of concepts. This sometimes makes it challenging to support all platforms at the same level of efficiency. Fortunately, for most tasks Vulkan provides multiple options that can be as simple as reimplementing concepts from other APIs with higher efficiency due to targeting the code specifically towards the renderer needs, and as hard as redesigning large systems to make them optimal for Vulkan. We will try to cover both extremes when applicable – ultimately, this is a tradeoff between maximum efficiency on Vulkan-capable systems and implementation and maintenance costs that every engine needs to carefully pick. Additionally, efficiency is often application-dependent – the guidance in this article is generic and ultimately best performance is achieved by profiling the target application on a target platform and making an informed implementation decision based on the results.

This article assumes that the reader is familiar with the basics of Vulkan API, and would like to understand them better and/or learn how to use the API efficiently.

# Memory management

Memory management remains an exceedingly complex topic, and in Vulkan it gets even more so due to the diversity of heap configurations on different hardware. Earlier APIs adopted a resource-centric concept – the programmer doesn’t have a concept of graphics memory, only that of a graphics resource, and different drivers are free to manage the resource memory based on API usage flags and a set of heuristics. Vulkan, however, forces to think about memory management up front, as you must manually allocate memory to create resources.

A perfectly reasonable first step is to integrate `VulkanMemoryAllocator` (henceforth abbreviated as VMA), which is an open-source library developed by AMD that solves some memory management details for you by providing a general purpose resource allocator on top of Vulkan functions. Even if you do use that library, there are still multiple performance considerations that apply; the rest of this section will go over memory caveats without assuming you use VMA; all of the guidance applies equally to VMA.

## Memory heap selection

When creating a resource in Vulkan, you have to choose a heap to allocate memory from. Vulkan device exposes a set of memory types where each memory type has flags that define the behavior of that memory, and a heap index that defines the available size.

Most Vulkan implementations expose two or three of the following flag combinations[^1]:

-	`VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT` – this is generally referring to GPU memory that is not directly visible from CPU; it’s fastest to access from the GPU and this is the memory you should be using to store all render targets, GPU-only resources such as buffers for compute, and also all static resources such as textures and geometry buffers.
-	`VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT | VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT` – on AMD hardware, this memory type refers to up to 256 MB of video memory that the CPU can write to directly, and is perfect for allocating reasonable amounts of data that is written by CPU every frame, such as uniform buffers or dynamic vertex/index buffers
-	`VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT`[^2]  – this is referring to CPU memory that is directly visible from GPU; reads from this memory go over PCI-express bus. In absence of the previous memory type, this generally speaking should be the choice for uniform buffers or dynamic vertex/index buffers, and also should be used to store staging buffers that are used to populate static resources allocated with `VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT` with data.
-	`VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT | VK_MEMORY_PROPERTY_LAZILY_ALLOCATED_BIT` – this is referring to GPU memory that might never need to be allocated for render targets on tiled architectures. It is recommended to use lazily allocated memory to save physical memory for large render targets that are never stored to, such as MSAA images or depth images.
On integrated GPUs, there is no distinction between GPU and CPU memory – these devices generally expose `VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT | VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT` that you can allocate all static resources through as well.

When dealing with dynamic resources, in general allocating in non-device-local host-visible memory works well – it simplifies the application management and is efficient due to GPU-side caching of read-only data. For resources that have a high degree of random access though, like dynamic textures, it’s better to allocate them in `VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT` and upload data using staging buffers allocated in `VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT` memory – similarly to how you would handle static textures. In some cases you might need to do this for buffers as well – while uniform buffers typically don’t suffer from this, in some applications using large storage buffers with highly random access patterns will generate too many PCIe transactions unless you copy the buffers to GPU first; additionally, host memory does have higher access latency from the GPU side that can impact performance for many small draw calls.

When allocating resources from `VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT`, in case of VRAM oversubscription you can run out of memory; in this case you should fall back to allocating the resources in non-device-local `VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT` memory. Naturally you should make sure that large frequently used resources such as render targets are allocated first. There are other things you can do in an event of an oversubscription, such as migrating resources from GPU memory to CPU memory for less frequently used resources – this is outside of the scope of this article; additionally, on some operating systems like Windows 10 correct handling of oversubscription requires APIs that are not currently available in Vulkan.

## Memory suballocation

Unlike some other APIs that allow an option to perform one memory allocation per resource, in Vulkan this is impractical for large applications – drivers are only required to support up to 4096 individual allocations. In addition to the total number being limited, allocations can be slow to perform, may waste memory due to assuming worst case possible alignment requirements, and also require extra overhead during command buffer submission to ensure memory residency. Because of this, suballocation is necessary. A typical pattern of working with Vulkan involves performing large (e.g. 16 MB – 256 MB depending on how dynamic the memory requirements are) allocations using `vkAllocateMemory`, and performing suballocation of objects within this memory, effectively managing it yourself. Critically, the application needs to handle alignment of memory requests correctly, as well as `bufferImageGranularity` limit that restricts valid configurations of buffers and images.

Briefly, `bufferImageGranularity` restricts the relative placement of buffer and image resources in the same allocation, requiring additional padding between individual allocations. There are several ways to handle this:

-	Always over-align image resources (as they typically have larger alignment to begin with) by bufferImageGranularity, essentially using a maximum of required alignment and `bufferImageGranularity` for address and size alignment.
-	Track resource type for each allocation, and have the allocator add the requisite padding only if the previous or following resource is of a different type. This requires a somewhat more complex allocation algorithm.
-	Allocate images and buffers in separate Vulkan allocations, thus sidestepping the entire problem. This reduces internal fragmentation due to smaller alignment padding but can waste more memory if the backing allocations are too big (e.g. 256 MB).

On many GPUs the required alignment for image resources is substantially bigger than it is for buffers which makes the last option attractive – in addition to reducing waste due to lack of extra padding between buffers and images, it reduces internal fragmentation due to image alignment when an image follows a buffer resource. VMA provides implementations for option 2 (by default) and option 3 (see `VMA_POOL_CREATE_IGNORE_BUFFER_IMAGE_GRANULARITY_BIT`).

## Dedicated allocations

While the memory management model that Vulkan provides implies that the application performs large allocations and places many resources within one allocation using suballocation, on some GPUs it’s more efficient to allocate certain resources as one dedicated allocation. That way the driver can allocate the resources in faster memory under special circumstances.

To that end, Vulkan provides an extension (core in 1.1) to perform dedicated allocations – when allocating memory, you can specify that you are allocating this memory for this individual resource instead of as an opaque blob. To know if this is worthwhile, you can query the extended memory requires via `vkGetImageMemoryRequirements2KHR` or `vkGetBufferMemoryRequirements2KHR`; the resulting struct, `VkMemoryDedicatedRequirementsKHR`, will contain `requiresDedicatedAllocation` (which might be set if the allocated resource needs to be shared with other processes) and `prefersDedicatedAllocation` flags.

In general, applications may see performance improvements from dedicated allocations on large render targets that require a lot of read/write bandwidth depending on the hardware and drivers.

## Mapping memory

Vulkan provides two options when mapping memory to get a CPU-visible pointer:

-	Do this before CPU needs to write data to the allocation, and unmap once the write is complete
-	Do this right after the host-visible memory is allocated, and *never* unmap memory

The second option is otherwise known as persistent mapping and is generally a better tradeoff – it minimizes the time it takes to obtain a writeable pointer (`vkMapMemory` is not particularly cheap on some drivers), removes the need to handle the case where multiple resources from the same memory object need to be written to simultaneously (calling `vkMapMemory` on an allocation that’s already been mapped and not unmapped is not valid) and simplifies the code in general.

The only downside is that this technique makes the 256 MB chunk of VRAM that is host visible and device local on AMD GPU that was described in “Memory heap selection” less useful – on systems with Windows 7 and AMD GPU, using persistent mapping on this memory may force WDDM to migrate the allocations to system memory. If this combination is a critical performance target for your users, then mapping and unmapping memory when needed might be more appropriate.

# Descriptor sets

Unlike earlier APIs with a slot-based binding model, in Vulkan the application has more freedom in how to pass resources to shaders. Resources are grouped into descriptor sets that have an application-specified layout, and each shader can use several descriptor sets that can be bound individually. It’s the responsibility of the application to manage the descriptor sets to make sure that CPU doesn’t update a descriptor set that’s in use by the GPU, and to provide the descriptor layout that has an optimal balance between CPU-side update cost and GPU-side access cost. In addition, since different rendering APIs use different models for resource binding and none of them match Vulkan model exactly, using the API in an efficient and cross-platform way becomes a challenge. We will outline several possible approaches to working with Vulkan descriptor sets that strike different points on the scale of usability and performance.

## Mental model

When working with Vulkan descriptor sets, it’s useful to have a mental model of how they might map to hardware. One such possibility – and the expected design – is that descriptor sets map to a chunk of GPU memory that contains descriptors – opaque blobs of data, 16-64 bytes in size depending on the resource, that completely specify all resource parameters necessary for shaders to access resource data. When dispatching shader work, CPU can specify a limited number of pointers to descriptor sets; these pointers become available to shaders as the shader threads launch.

With that in mind, Vulkan APIs can map more or less directly to this model – creating a descriptor set pool would allocate a chunk of GPU memory that’s large enough to contain the maximum specified number of descriptors. Allocating a set out of descriptor pool can be as simple as incrementing the pointer in the pool by the cumulative size of allocated descriptors as determined by `VkDescriptorSetLayout` (note that such an implementation would not support memory reclamation when freeing individual descriptors from the pool; `vkResetDescriptorPool` would set the pointer back to the start of pool memory and make the entire pool available for allocation again). Finally, `vkCmdBindDescriptorSets` would emit command buffer commands that set GPU registers corresponding to descriptor set pointers.

Note that this model ignores several complexities, such as dynamic buffer offsets, limited number of hardware resources for descriptor sets, etc. Additionally, this is just one possible implementation – some GPUs have a less generic descriptor model and require the driver to perform additional processing when descriptor sets are bound to the pipeline. However, it’s a useful model to plan for descriptor set allocation/usage.

## Dynamic descriptor set management

Given the mental model above, you can treat descriptor sets as GPU-visible memory – it’s the responsibility of the application to group descriptor sets into pools and keep them around until GPU is done reading them.

A scheme that works well is to use free lists of descriptor set pools; whenever you need a descriptor set pool, you allocate one from the free list and use it for subsequent descriptor set allocations in the current frame on the current thread. Once you run out of descriptor sets in the current pool, you allocate a new pool. Any pools that were used in a given frame need to be kept around; once the frame has finished rendering, as determined by the associated fence objects, the descriptor set pools can reset via `vkResetDescriptorPool` and returned to free lists. While it’s possible to free individual descriptors from a pool via `VK_DESCRIPTOR_POOL_CREATE_FREE_DESCRIPTOR_SET_BIT`, this complicates the memory management on the driver side and is not recommended.

When a descriptor set pool is created, application specifies the maximum number of descriptor sets allocated from it, as well as the maximum number of descriptors of each type that can be allocated from it. In Vulkan 1.1, the application doesn’t have to handle accounting for these limits – it can just call `vkAllocateDescriptorSets` and handle the error from that call by switching to a new descriptor set pool. Unfortunately, in Vulkan 1.0 without any extensions, it’s an error to call `vkAllocateDescriptorSets` if the pool does not have available space, so application must track the number of sets and descriptors of each type to know beforehand when to switch to a different pool.

Different pipeline objects may use different numbers of descriptors, which raises the question of pool configuration. A straightforward approach is to create all pools with the same configuration that uses the worst-case number of descriptors for each type – for example, if each set can use at most 16 texture and 8 buffer descriptors, one can allocate all pools with maxSets=1024, and pool sizes 16\*1024 for texture descriptors and 8\*1024 for buffer descriptors. This approach can work but in practice it can result in very significant memory waste for shaders with different descriptor count – you can’t allocate more than 1024 descriptor sets out of a pool with the aforementioned configuration, so if most of your pipeline objects use 4 textures, you’ll be wasting 75% of texture descriptor memory.

Two alternatives that provide a better balance wrt memory use are:

-	Measure an average number of descriptors used in a shader pipeline per type for a characteristic scene and allocate pool sizes accordingly. For example, if in a given scene we need 3000 descriptor sets, 13400 texture descriptors, and 1700 buffer descriptors, then the average number of descriptors per set is 4.47 textures (rounded up to 5) and 0.57 buffers (rounded up to 1), so a reasonable configuration of a pool is maxSets=1024, 5\*1024 texture descriptors, 1024 buffer descriptors. When a pool is out of descriptors of a given type, we allocate a new one – so this scheme is guaranteed to work and should be reasonably efficient on average.
-	Group shader pipeline objects into size classes, approximating common patterns of descriptor use, and pick descriptor set pools using the appropriate size class. This is an extension of the scheme described above to more than one size class. For example, it’s typical to have large numbers of shadow/depth prepass draw calls, and large numbers of regular draw calls in a scene – but these two groups have different numbers of required descriptors, with shadow draw calls typically requiring 0 to 1 textures per set and 0 to 1 buffers when dynamic buffer offsets are used. To optimize memory use, it’s more appropriate to allocate descriptor set pools separately for shadow/depth and other draw calls. Similarly to general-purpose allocators that can have size classes that are optimal for a given application, this can still be managed in a lower-level descriptor set management layer as long as it’s configured with application specific descriptor set usages beforehand.

## Choosing appropriate descriptor types

For each resource type, Vulkan provides several options to access these in a shader; application is responsible for choosing an optimal descriptor type.

For buffers, application must choose between uniform and storage buffers, and whether to use dynamic offsets or not. Uniform buffers have a limit on the maximum addressable size – on desktop hardware, you get up to 64 KB of data, however on mobile hardware some GPUs only provide 16 KB of data (which is also the guaranteed minimum by the specification). The buffer resource can be larger than that, but shader can only access this much data through one descriptor.

On some hardware, there is no difference in access speed between uniform and storage buffers, however for other hardware depending on the access pattern uniform buffers can be significantly faster. Prefer uniform buffers for small to medium sized data especially if the access pattern is fixed (e.g. for a buffer with material or scene constants). Storage buffers are more appropriate when you need large arrays of data that need to be larger than the uniform buffer limit and are indexed dynamically in the shader.

For textures, if filtering is required, there is a choice of combined image/sampler descriptor (where, like in OpenGL, descriptor specifies both the source of the texture data, and the filtering/addressing properties), separate image and sampler descriptors (which maps better to Direct3D 11 model), and image descriptor with an immutable sampler descriptor, where the sampler properties must be specified when pipeline object is created.

The relative performance of these methods is highly dependent on the usage pattern; however, in general immutable descriptors map better to the recommended usage model in other newer APIs like Direct3D 12, and give driver more freedom to optimize the shader. This does alter renderer design to a certain extent, making it necessary to implement certain dynamic portions of the sampler state, like per-texture LOD bias for texture fade-in during streaming, using shader ALU instructions.

## Slot-based binding

A simplistic alternative to Vulkan binding model is Metal/Direct3D11 model where an application can bind resources to slots, and the runtime/driver manage descriptor memory and descriptor set parameters. This model can be implemented on top of Vulkan descriptor sets; while not providing the most optimal results, it generally is a good model to start with when porting an existing renderer, and with careful implementation it can be surprisingly efficient.

To make this model work, application needs to decide how many resource namespaces are there and how they map to Vulkan set/slot indices. For example, in Metal each stage (VS, FS, CS) has three resource namespaces – textures, buffers, samplers – with no differentiation between e.g. uniform buffers and storage buffers. In Direct3D 11 the namespaces are more complicated since read-only structured buffers belong to the same namespace as textures, but textures and buffers used with unordered access reside in a separate one.

Vulkan specification only guarantees a minimum of 4 descriptor sets accessible to the entire pipeline (across all stages); because of this, the most convenient mapping option is to have resource bindings match across all stages – for example, a texture slot 3 would contain the same texture resource no matter what stage it’s accessed from – and use different descriptor sets for different types, e.g. set 0 for buffers, set 1 for textures, set 2 for samplers. Alternatively, an application can use one descriptor set per stage[^3] and perform static index remapping (e.g. slots 0-16 would be used for textures, slots 17-24 for uniform buffers, etc.) – this, however, can use much more descriptor set memory and isn’t recommended. Finally, one could implement optimally compact dynamic slot remapping for each shader stage (e.g. if a vertex shader uses texture slots 0, 4, 5, then they map to Vulkan descriptor indices 0, 1, 2 in set 0, and at runtime application extracts the relevant texture information using this remapping table.

In all these cases, the implementation of setting a texture to a given slot wouldn’t generally run any Vulkan commands and would just update shadow state; just before the draw call or dispatch you’d need to allocate a descriptor set from the appropriate pool, update it with new descriptors, and bind all descriptor sets using `vkCmdBindDescriptorSets`. Note that if a descriptor set has 5 resources, and only one of them changed since the last draw call, you still need to allocate a new descriptor set with 5 resources and update all of them.

To reach good performance with this approach, you need to follow several guidelines:

-	Don’t allocate or update descriptor sets if nothing in the set changed. In the model with slots that are shared between different stages, this can mean that if no textures are set between two draw calls, you don’t need to allocate/update the descriptor set with texture descriptors.
-	Batch calls to `vkAllocateDescriptorSets` if possible – on some drivers, each call has measurable overhead, so if you need to update multiple sets, allocating both in one call can be faster
-	To update descriptor sets, either use `vkUpdateDescriptorSets` with descriptor write array, or use `vkUpdateDescriptorSetWithTemplate` from Vulkan 1.1. Using the descriptor copy functionality of `vkUpdateDescriptorSets` is tempting with dynamic descriptor management for copying most descriptors out of a previously allocated array, but this can be slow on drivers that allocate descriptors out of write-combined memory. Descriptor templates can reduce the amount of work application needs to do to perform updates – since in this scheme you need to read descriptor information out of shadow state maintained by application, descriptor templates allow you to tell the driver the layout of your shadow state, making updates substantially faster on some drivers.
-	Finally, prefer dynamic uniform buffers to updating uniform buffer descriptors. Dynamic uniform buffers allow to specify offsets into buffer objects using `pDynamicOffsets` argument of `vkCmdBindDescriptorSets` without allocating and updating new descriptors. This works well with dynamic constant management where constants for draw calls are allocated out of large uniform buffers, substantially reduce CPU overhead, and can be more efficient on GPU. While on some GPUs the number of dynamic buffers must be kept small to avoid extra overhead in the driver, one or two dynamic uniform buffers should work well in this scheme on all architectures.

In general, the approach outlined above can be very efficient in terms of performance – it’s not as efficient as approaches with more static descriptor sets that are described below, but it can still run circles around older APIs if implemented carefully. On some drivers, unfortunately the allocate & update path is not very optimal – on some mobile hardware, it may make sense to cache descriptor sets based on the descriptors they contain if they can be reused later in the frame.

## Frequency-based descriptor sets

While slot-based resource binding model is simple and familiar, it doesn’t result in optimal performance. Some mobile hardware may not support multiple descriptor sets; however, in general Vulkan API and driver expect an application to manage descriptor sets based on frequency of change.

A more Vulkan centric renderer would organize data that the shaders need to access into groups by frequency of change, and use individual sets for individual frequencies, with set=0 representing least frequent change, and set=3 representing most frequent. For example, a typical setup would involve:

-	Set=0 descriptor set containing uniform buffer with global, per-frame or per-view data, as well as globally available textures such as shadow map texture array/atlas
-	Set=1 descriptor set containing uniform buffer and texture descriptors for per-material data, such as albedo map, Fresnel coefficients, etc.
-	Set=2 descriptor set containing dynamic uniform buffer with per-draw data, such as world transform array

For set=0, the expectation is that it only changes a handful of times per frame; it’s sufficient to use a dynamic allocation scheme similar to the previous section.

For set=1, the expectation is that for most objects, the material data persists between frames, and as such could be allocated and updated only when the gameplay code changes material data.

For set=2, the data would be completely dynamic; due to the use of a dynamic uniform buffer, we’d rarely need to allocate and update this descriptor set – assuming dynamic constants are uploaded to a series of large per-frame buffers, for most draws we’d need to update the buffer with the constant data, and call `vkCmdBindDescriptorSets` with new offsets.

Note that due to compatibility rules between pipeline objects, in most cases it’s enough to bind sets 1 and 2 whenever a material changes, and only set 2 when material is the same as that for the previous draw call. This results in just one call to `vkCmdBindDescriptorSets` per draw call.

For a complex renderer, different shaders might need to use different layouts – for example, not all shaders need to agree on the same layout for material data. In rare cases it might also make sense to use more than 3 sets depending on the frame structure. Additionally, given the flexibility of Vulkan it’s not strictly required to use the same resource binding system for all draw calls in the scene. For example, post-processing draw call chains tend to be highly dynamic, with texture/constant data changing completely between individual draw calls. Some renderers initially implement the dynamic slot-based binding model from the previous section and proceed to additionally implement the frequency-based sets for world rendering to minimize the performance penalty for set management, while still keeping the simplicity of slot-based model for more dynamic parts of the rendering pipeline.

The scheme described above assumes that in most cases, per-draw data is larger than the size that can be efficiently set via push constants. Push constants can be set without updating or rebinding descriptor sets; with a guaranteed limit of 128 bytes per draw call, it’s tempting to use them for per-draw data such as a 4x3 transform matrix for an object. However, on some architectures the actual number of constants available to push quickly depends on the descriptor setup the shaders use, and is closer to 12 bytes or so. Exceeding this limit can force the driver to spill the push constants into driver-managed ring buffer, which can end up being more expensive than moving this data to a dynamic uniform buffer on the application side. While limited use of push constants may still be a good idea for some designs, it’s more appropriate to use them in a fully bindless scheme described in the next section.

## Bindless descriptor designs

Frequency-based descriptor sets reduce the descriptor set binding overhead; however, you still need to bind one or two descriptor sets per draw call. Maintaining material descriptor sets requires a management layer that needs to update GPU-visible descriptor sets whenever material parameters change; additionally, since texture descriptors are cached in material data, this makes global texture streaming systems hard to deal with – whenever some mipmap levels in a texture get streamed in or out, all materials that refer to this texture need to be updated. This requires complex interaction between material system and texture streaming system and introduces extra overhead whenever a texture is adjusted – which partially offsets the benefits of the frequency-based scheme. Finally, due to the need to set up descriptor sets per draw call it’s hard to adapt any of the aforementioned schemes to GPU-based culling or command submission.

It is possible to design a bindless scheme where the number of required set binding calls is constant for the world rendering, which decouples texture descriptors from materials, making texture streaming systems easier to implement, and facilitates GPU-based submission. As with the previous scheme, this can be combined with dynamic ad-hoc descriptor updates for parts of the scene where the number of draw calls is small, and flexibility is important, such as post-processing.

To fully leverage bindless, core Vulkan may or may not be sufficient; some bindless implementations require updating descriptor sets without rebinding them after the update, which is not available in core Vulkan 1.0 or 1.1 but is possible to achieve with `VK_EXT_descriptor_indexing` extension (core in Vulkan 1.2). However, basic design described below can work without extensions, given high enough descriptor set limits. This requires double buffering for the texture descriptor array described below to update individual descriptors since the array would be constantly accessed by GPU.

Similarly to the frequency-based design, we’ll split the shader data into global uniforms and textures (set 0), material data and per-draw data. Global uniforms and textures can be specified via a descriptor set the same way as described the previous section.

For per-material data, we will move the texture descriptors into a large texture descriptor array (note: this is a different concept than a texture array – texture array uses one descriptor and forces all textures to have the same size and format; descriptor array doesn’t have this limitation and can contain arbitrary texture descriptors as array elements, including texture array descriptors). Each material in the material data will have an index into this array instead of texture descriptor; the index will be part of the material data, which will also have other material constants.

All material constants for all materials in the scene will reside in one large storage buffer; while it’s possible to support multiple material types with this scheme, for simplicity we’ll assume that all materials can be specified using the same data. An example of material data structure is below:

```c
struct MaterialData
{
	vec4 albedoTint;

	float tilingX;
	float tilingY;
	float reflectance;
	float unused0; // pad to vec4

	uint albedoTexture;
	uint normalTexture;
	uint roughnessTexture;
	uint unused1; // pad to vec4
};
```

Similarly, all per-draw constants for all objects in the scene can reside in another large storage buffer; for simplicity, we’ll assume that all per-draw constants have identical structure. To support skinned objects in a scheme like this, we’ll extract transform data into a separate, third storage buffer:

```c
struct TransformData
{
	vec4 transform[3];
};
```

Something that we’ve ignored so far is the vertex data specification. While Vulkan provides a first-class way to specify vertex data by calling `vkCmdBindVertexBuffers`, having to bind vertex buffers per-draw would not work for a fully bindless design. Additionally, some hardware doesn’t support vertex buffers as a first-class entity, and the driver has to emulate vertex buffer binding, which causes some CPU-side slowdowns when using `vkCmdBindVertexBuffers`. In a fully bindless design, we need to assume that all vertex buffers are suballocated in one large buffer and either use per-draw vertex offsets (`vertexOffset` argument to `vkCmdDrawIndexed`) to have hardware fetch data from it, or pass an offset in this buffer to the shader with each draw call and fetch data from the buffer in the shader. Both approaches can work well, and might be more or less efficient depending on the GPU; here we will assume that the vertex shader will perform manual vertex fetching.

Thus, for each draw call we need to specify three integers to the shader:

-	Material index; used to look up material data from material storage buffer. The textures can then be accessed using the indices from the material data and the descriptor array.
-	Transform data index; used to look up transform data from transform storage buffer
-	Vertex data offset; used to look up vertex attributes from vertex storage buffer

We can specify these indices and additional data, if necessary, via draw data:

```c
struct DrawData
{
	uint materialIndex;
	uint transformOffset;
	uint vertexOffset;
	uint unused0; // vec4 padding

	// ... extra gameplay data goes here
};
```

The shader will need to access storage buffers containing `MaterialData`, `TransformData`, `DrawData` as well as a storage buffer containing vertex data. These can be bound the shader via the global descriptor set; the only remaining piece of information is the draw data index, that can be passed via a push constant.

With this scheme, we’d need to update the storage buffers used by materials and draw calls each frame and bind them once using our global descriptor set; additionally, we need to bind index data – assuming that, like vertex data, index data is allocated in one large index buffer, we only need to bind it once using `vkCmdBindIndexBuffer`. With the global setup complete, for each draw call we need to call `vkCmdBindPipeline` if the shader changes, followed by `vkCmdPushConstants` to specify an index into the draw data buffer[^4], followed by `vkCmdDrawIndexed`.

In a GPU-centric design, we can use `vkCmdDrawIndirect` or `vkCmdDrawIndirectCountKHR` (provided by `KHR_draw_indirect_count` extension, promoted to core Vulkan 1.2) and fetch per-draw constants using `gl_DrawIDARB` (provided by `KHR_shader_draw_parameters` extension) as an index instead of push constants. The only caveat is that for GPU-based submission, we’d need to bucket draw calls based on pipeline object on CPU since there’s no support for switching pipeline objects otherwise.

With this, vertex shader code to transform the vertex could look like this:

```c
DrawData dd = drawData[gl_DrawIDARB];
TransformData td = transformData[dd.transformOffset];
vec4 positionLocal = vec4(positionData[gl_VertexIndex + dd.vertexOffset], 1.0);
vec3 positionWorld = mat4x3(td.transform[0], td.transform[1], td.transform[2]) * positionLocal;
```

Fragment shader code to sample material textures could look like this:

```c
DrawData dd = drawData[drawId];
MaterialData md = materialData[dd.materialIndex];
vec4 albedo = texture(sampler2D(materialTextures[md.albedoTexture], albedoSampler), uv * vec2(md.tilingX, md.tilingY));
```

This scheme minimizes the CPU-side overhead. Of course, fundamentally it’s a balance between multiple factors:

-	While the scheme can be extended to multiple formats of material, draw and vertex data, it gets harder to manage
-	Using storage buffers exclusively instead of uniform buffers can increase GPU time on some architectures
-	Fetching texture descriptors from an array indexed by material data indexed by material index can add an extra indirection on GPU compared to some alternative designs
-	On some hardware, various descriptor set limits may make this technique impractical to implement; to be able to index an arbitrary texture dynamically from the shader, `maxPerStageDescriptorSampledImages` should be large enough to accomodate all material textures - while many desktop drivers expose a large limit here, the specification only guarantees a limit of 16, so bindless remains out of reach on some hardware that otherwise supports Vulkan

As the renderers get more and more complex, bindless designs will become more involved and eventually allow moving even larger parts of rendering pipeline to GPU; due to hardware constraints this design is not practical on every single Vulkan-compatible device, but it’s definitely worth considering when designing new rendering paths for future hardware.

# Command buffer recording and submission

In older APIs, there is a single timeline for GPU commands; commands executed on CPU execute on the GPU in the same order, as there is generally only one thread recording them; there is no precise control over when CPU submits commands to GPU, and the driver is expected to manage memory used by the command stream as well as submission points optimally.

In contrast, in Vulkan the application is responsible for managing command buffer memory, recording commands in multiple threads into multiple command buffers, and submitting them for execution with appropriate granularity. While with carefully written code a single-core Vulkan renderer can be significantly faster than older APIs, the peak efficiency and minimal latency is obtained by utilizing many cores in the system for command recording, which requires careful memory management.

## Mental model

Similarly to descriptor sets, command buffers are allocated out of command pools; it’s valuable to understand how a driver might implement this to be able to reason about the costs and usage implications.

Command pool has to manage memory that will be filled with commands by CPU and subsequently read by GPU command processor. The amount of memory used by the commands can’t be statically determined; a typical implementation of a pool would involve thus a free list of fixed-size pages. Command buffer would contain a list of pages with actual commands, with special jump commands that transfer control from each page to the next one so that GPU can execute all of them in sequence. Whenever a command needs to be allocated from a command buffer, it will be encoded into the current page; if the current page doesn’t have space, the driver would allocate the next page using a free list from the associated pool, encode a jump to that page into the current page and switch to the next page for subsequent command recording.

Each command pool can only be used from one thread concurrently, so the operations above don’t need to be thread-safe[^5]. Freeing the command buffer using `vkFreeCommandBuffers` may return the pages used by the command buffer into the pool by adding them to the free list. Resetting the command pool may put all pages used by all command buffers into the pool free list; when `VK_COMMAND_POOL_RESET_RELEASE_RESOURCES_BIT` is used, the pages can be returned to the system so that other pools can reuse them.

Note that there is no guarantee that `vkFreeCommandBuffers` actually returns memory to the pool; alternative designs may involve multiple command buffers allocating chunks within larger pages, which would make it hard for `vkFreeCommandBuffers` to recycle memory. Indeed, on one mobile vendor, `vkResetCommandPool` is necessary to reuse memory for future command recording in a default setup when pools are allocated without `VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT`.

## Multi-threaded command recording

Two crucial restrictions in Vulkan for command pool usage are:

-	Command buffers allocated from one pool may not be recorded concurrently by multiple threads
-	Command buffers and pools can not be freed or reset while GPU is still executing the associated commands

Because of these, a typical threading setup requires a set of command buffer pools. The set has to contain F\*T pools, where F is the frame queue length – F is usually 2 (one frame is recorded by the CPU while another frame is being executed by the GPU) or 3; T is the number of threads that can concurrently record commands, which can be as high as the core count on the system. When recording commands from a thread, the thread needs to allocate a command buffer using the pool associated with the current frame & thread and record commands into it. Assuming that command buffers aren’t recorded across a frame boundary, and that at a frame boundary the frame queue length is enforced by waiting for the last frame in the queue to finish executing, we can then free all command buffers allocated for that frame and reset all associated command pools.

Additionally, instead of freeing command buffers, it’s possible to reuse them after calling `vkResetCommandPool` - which would mean that command buffers don’t have to be allocated again. While in theory allocating command buffers could be cheap, some driver implementations have a measurable overhead associated with command buffer allocation. This also makes sure that the driver doesn’t ever need to return command memory to the system which can make submitting commands into these buffers cheaper.

Note that depending on the frame structure, the setup above may result in unbalanced memory consumption across threads; for example, shadow draw calls typically require less setup and less command memory. When combined with effectively random workload distribution across threads that many job schedulers produce, this can result in all command pools getting sized for the worst-case consumption. If an application is memory constrained and this becomes a problem, it’s possible to limit the parallelism for each individual pass and select the command buffer/pool based on the recorded pass to limit the waste.

This requires introducing the concept of size classes to the command buffer manager. With a command pool per thread and a manual reuse of allocated command buffers as suggested above, it’s possible to keep a free list per size class, with size classes defined based on the number of draw calls (e.g. “<100”, “100-400”, etc.) and/or the complexity of individual draw calls (depth-only, gbuffer). Picking the buffer based on the expected usage leads to a more stable memory consumption. Additionally, for passes that are too small it is worthwhile to reduce the parallelism when recording these - for example, if a pass has <100 draw calls, instead of splitting it into 4 recording jobs on a 4-core system, it can be more efficient to record it in one job since that can reduce the overhead of command memory management and command buffer submission.

## Command buffer submission

While it’s important to record multiple command buffers on multiple threads for efficiency, since state isn’t reused across command buffers and there are other scheduling limitations, command buffers need to be reasonably large to make sure GPU is not idle during command processing. Additionally, each submission has some overhead both on the CPU side and on the GPU side. In general a Vulkan application should target <10 submits per frame (with each submit accounting for 0.5ms or more of GPU workload), and <100 command buffers per frame (with each command buffer accounting for 0.1ms or more of GPU workload). This might require adjusting the concurrency limits for command recording for individual passes, e.g. if a shadow pass for a specific light has <100 draw calls, it might be necessary to limit the concurrency on the recording for this pass to just one thread; additionally, for even shorter passes combining them with neighboring passes into one command buffer becomes beneficial. Finally, the fewer submissions a frame has the better – this needs to be balanced with submitting enough GPU work earlier in the frame to increase CPU and GPU parallelism though, for example it might make sense to submit all command buffers for shadow rendering before recording commands for other parts of the frame.

Crucially, the number of submissions refers to the total number of `VkSubmitInfo` structured submitted in all `vkQueueSubmit` calls in a frame, not to the number of `vkQueueSubmit` calls per se. For example, when submitting 10 command buffers, it’s much more efficient to use one `VkSubmitInfo` that submits 10 command buffers compared to 10 `VkSubmitInfo` structures with one command buffer per each, even if in both cases only one `vkQueueSubmit` call is performed. Essentially, `VkSubmitInfo` is a unit of synchronization/scheduling on GPU since it has its own set of fences/semaphores.

## Secondary command buffers

When one of the render passes in the application contains a lot of draw calls, such as the gbuffer pass, for CPU submission efficiency it’s important to split the draw calls into multiple groups and record them on multiple threads. There are two ways to do this:

-	Record primary command buffers that render chunks of draw calls into the same framebuffer, using `vkCmdBeginRenderPass` and `vkCmdEndRenderPass`; execute the resulting command buffers using `vkQueueSubmit` (batching submits for efficiency)
-	Record secondary command buffers that render chunks of draw calls, passing the render pass to `vkBeginCommandBuffer` along with `VK_COMMAND_BUFFER_USAGE_RENDER_PASS_CONTINUE_BIT`; use `vkCmdBeginRenderPass` with `VK_SUBPASS_CONTENTS_SECONDARY_COMMAND_BUFFERS` in the primary command buffer, followed by `vkCmdExecuteCommands` to execute all recorded secondary command buffers

While on immediate mode GPUs the first approach can be viable, and it can be a bit easier to manage wrt synchronization points on the CPU, it’s vital to use the second approach on GPUs that use tiled rendering instead. Using the first approach on tilers would require that the contents of the tiles is flushed to memory and loaded back from memory between each command buffer, which is catastrophic for performance.

## Command buffer reuse

With the guidance on the command buffer submission above, in most cases submitting a single command buffer multiple times after recording becomes impractical. In general approaches that pre-record command buffers for parts of the scene are counter-productive since they can result in excessive GPU load due to inefficient culling required to keep command buffer workload large and can trigger inefficient code paths on some tiled renderers, and instead applications should focus on improving the threading and draw call submission cost on the CPU. As such, applications should use `VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT` to make sure the driver has freedom to generate commands that don’t need to be replayed more than once.

There are occasional exceptions for this rule. For example, for VR rendering, an application might want to record the command buffer for the combined frustum between left and right eye once. If the per-eye data is read out of a single uniform buffer, this buffer can then be updated between the command buffers using `vkCmdUpdateBuffer`, followed by `vkCmdExecuteCommands` if secondary command buffers are used, or `vkQueueSubmit`. Having said that, for VR it might be worthwhile to explore `VK_KHR_multiview` extension if available (core in Vulkan 1.1), since it should allow the driver to perform a similar optimization.

# Pipeline barriers

Pipeline barriers remain one of the most challenging parts of Vulkan code. In older APIs, the runtime and driver were responsible for making sure appropriate hardware-specific synchronization was performed in case of hazards such as fragment shader reading from the texture that was previously rendered to. This required meticulous tracking of every single resource binding and resulted in an unfortunate mix of excessive CPU overhead to perform a sometimes excessive amount of GPU synchronization (for example, Direct3D 11 driver typically inserts a barrier between any two consecutive compute dispatches that use the same UAV, even though depending on the application logic the hazards may be absent). Because inserting barriers quickly and optimally can require knowledge about the application’s use of resources, Vulkan requires the application to do this.

For optimal rendering, the pipeline barrier setup must be perfect. A missing barrier risks the application encountering a timing-dependent bug on an untested – or, worse, not-yet-existing – architecture, that in the worst case could cause a GPU crash. An unnecessary barrier can reduce the GPU utilization by reducing potential opportunity for parallel execution – or, worse, trigger very expensive decompression operations or the like. To make matters worse, while the cost of excessive barriers can be now visualized by tools like Radeon Graphics Profiler, missing barriers are generally not detected by validation tools.

Because of this, it’s vital to understand the behavior or barriers, the consequences of overspecifying them as well as how to work with them.

## Mental model

The specification describes barriers in terms of execution dependencies and memory visibility between pipeline stages (e.g. a resource was previously written to by a compute shader stage, and will be read by the transfer stage), as well as layout changes for images (e.g. a resource was previously in the format that is optimal to write via the color attachment output and should be transitioned to a format that is optimal to read from the shader). However, it might be easier to think about barriers in terms of their consequences – as in, what can happen on a GPU when a barrier is used. Note that the GPU behavior is of course dependent on the specific vendor and architecture, but it helps to map barriers that are specified in an abstract fashion to more concrete constructs to understand their performance implications.

A barrier can cause three different things to happen:

1.	Stalling execution of a specific stage until another stage is drained of all current work. For example, if a render pass renders data to a texture, and a subsequent render pass uses a vertex shader to read from this shader, GPU must wait for all pending fragment shader and ROP work to complete before launching shader threads for the vertex work in a subsequent pass. Most barrier operations will lead to execution stalling for some stages[^6].

2.	Flushing or invalidating an internal GPU-side cache and waiting for the memory transactions to finish to make sure another stage can read the resulting work. For example, on some architectures ROP writes might go through the L2 texture cache, but transfer stage might operate directly on memory. If a texture has been rendered to in a render pass, then the following transfer operation might read stale data unless the cache is flushed before the copy. Similarly, if a texture stage needs to read an image that was copied using transfer stage, L2 texture cache may need to get invalidated to make sure it doesn’t contain stale data. Not all barrier operations will need to do this.

3.	Converting the format the resource is stored in, most commonly to decompress the resource storage. For example, MSAA textures on some architectures are stored in a compressed form where each pixel has a sample mask indicating how many unique colors this pixel contains, and a separate storage for sample data. Transfer stage or shader stage might be unable to read directly from a compressed texture, so a barrier that transitions from `VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL` to `VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL` or `VK_IMAGE_USAGE_TRANSFER_SRC_BIT` might need to decompress the texture, writing all samples for all pixels to memory. Most barrier operations won’t need to do this, but the ones that do can be incredibly expensive.

With this in mind, let’s try to understand the guidance for using barriers.

## Performance guidelines

When generating commands for each individual barrier, the driver only has a local view of the barrier and is unaware of past or future barriers. Because of this, the first important rule is that barriers need to be batched as aggressively as possible. Given a barrier that implies a wait-for-idle for fragment stage and an L2 texture cache flush, the driver will dutifully generate that every time you call `vkCmdPipelineBarrier`. If you specify multiple resources in a single `vkCmdPipelineBarrier` call, the driver will only generate one L2 texture cache flush command if it’s necessary for any transitions, reducing the cost.

To make sure the cost of the barriers isn’t higher than it needs to be, only relevant stages need to be included. For example, one of the most common barrier types is one that transitions a resource from `VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL` to `VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL`. When specifying this barrier, you should specify the shader stages that will *actually* read this resource via `dstStageMask`. It’s tempting to specify the stage mask as `VK_PIPELINE_STAGE_ALL_COMMANDS_BIT` to support compute shader or vertex shader reads. Doing so, however, would mean that vertex shader workload from the subsequent draw commands can not start, which is problematic:

-	On immediate mode renderers, this slightly reduces the parallelism between draw calls, requiring all fragment threads to finish before vertex threads can start, which leads to GPU utilization dropping to 0 at the end of the pass and gradually rising from 0 to, hopefully, 100% as the next render pass begins;

-	On tiled mode renderers, for some designs the expectation is that all vertex work from the subsequent pass executes to completion before fragment work can start; waiting for fragment work to end for any vertex work to begin thus completely eliminates the parallelism between vertex and fragment stages and is one of the largest potential performance problems that a naively ported Vulkan title can encounter.

Note that even if the barriers are specified correctly – in this case, assuming the texture is read from the fragment stage, `dstStageMask` should be `VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT` – the execution dependency is still present, and it can still lead to reduced GPU utilization. This can come up in multiple situations including compute, where to read data from a compute shader generated by another compute shader you need to express an execution dependency between CS and CS but specifying a pipeline barrier is guaranteed to drain the GPU of compute work entirely, followed by slowly filling it with compute work again. Instead, it can be worthwhile to specify the dependency via what’s called a split barrier: instead of using `vkCmdPipelineBarrier`, use `vkCmdSetEvent` after the write operation completes, and `vkCmdWaitEvents` before the read operations starts. Of course, using `vkCmdWaitEvents` immediately after `vkCmdSetEvent` is counter-productive and can be slower than `vkCmdPipelineBarrier`; instead you should try to restructure your algorithm to make sure there’s enough work submitted between Set and Wait, so that by the time GPU needs to process Wait, the event is most likely already signaled and there is no efficiency loss.

Alternatively, in some cases the algorithm can be restructured to reduce the number of synchronization points while still using pipeline barriers, making the overhead less significant. For example, a GPU-based particle simulation might need to run two compute dispatches for each particle effect: one to emit new particles, and another one to simulate particles. These dispatches require a pipeline barrier between them to synchronize execution, which requires a pipeline barrier per particle system if particle systems are simulated sequentially. A more optimal implementation would first submit all dispatches to emit particles (that would not depend on each other), then submit a barrier to synchronize emission and simulation dispatches, then submit all dispatches to simulate particles - which would keep GPU well utilized for longer. From there on using split barriers could help completely hide the synchronization cost.

As far as resource decompression goes, it’s hard to give a general advice – on some architectures this never happens, and on some it does but depending on the algorithm it might not be avoidable. Using vendor specific tools such as Radeon Graphics Profiler is critical to understanding the performance impact decompression has on your frame; in some cases, it may be possible to adjust the algorithm to not require the decompression in the first place, for example by moving the work to a different stage. Of course it should be noted that resource decompression may happen in cases where it’s completely unnecessary and is a result of overspecifying barriers – for example, if you render to a framebuffer that contains a depth buffer and never read depth contents in the future, you should leave the depth buffer in `VK_IMAGE_LAYOUT_DEPTH_STENCIL_OPTIMAL` layout instead of needlessly transitioning it into `VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL` which might trigger a decompression (remember, the driver doesn’t know if you are going to read the resource in the future!).

## Simplifying barrier specification

With all the complexity involved in specifying barriers, it helps to have examples of commonly required barriers. Fortunately, Khronos Group provides many examples of valid and optimal barriers for various types of synchronization as part of [Vulkan-Docs repository on GitHub](https://github.com/KhronosGroup/Vulkan-Docs/wiki/Synchronization-Examples). These can serve to improve the understanding of general barrier behavior, and can also be used directly in a shipping application.

Additionally, for cases not covered by these examples and, in general, to simplify the specification code and make it more correct, it is possible to switch to a simpler model where, instead of fully specifying access masks, stages and image layouts, the only concept that needs to be known about a resource is the resource state that encapsulates the stages that can use the resource and the usage mode for most common types of access. Then all transitions involve transitioning a resource from state A from state B, which is much easier to understand. To that end, Tobias Hector, a member of Khronos Group and a co-author of the Vulkan specification, wrote an open-source library, simple_vulkan_synchronization, that translates resource state (otherwise known as access type in the library) transitions into Vulkan barrier specification. The library is small and simple and provides support for split barriers as well as full pipeline barriers.

## Predicting the future with render graphs

The performance guidelines outlined in the previous section are hard to follow in practice, especially given conventional immediate mode rendering architectures.

To make sure that the stages and image layout transitions are not overspecified, it’s important to know how the resource is going to be used in the future – if you want to emit a pipeline barrier after render pass ends, without this information you’re generally forced to emit a barrier with all stages in the destination stage mask, and an inefficient target layout.

To solve this problem, it’s tempting to instead emit the barriers before the resource is read, since at that point it’s possible to know how the resource was written to; however, this makes it hard to batch barriers. For example, in a frame with 3 render passes, A, B, and C, where C reads A’s output and B’s output in two separate draw calls, to minimize the number of texture cache flushes and other barrier work it’s generally beneficial specify a barrier before C that correctly transitions outputs of both A and B; instead what would happen is that there’s a barrier before each of C’s draw calls. Split barriers in some cases can reduce the associated costs, but in general just-in-time barriers will be overly expensive.

Additionally, using just-in-time barriers requires tracking the resource state to know the previous layout; this is very hard to do correctly in a multithreaded system since the final execution order on GPU can only be known once all commands are recorded and linearized.

Due to the aforementioned problems, many modern renderers are starting to experiment with render graphs as a way to declaratively specify all dependencies between frame resources. Based on the resulting DAG structure, it’s possible to establish correct barriers, including barriers required for synchronizing work across multiple queues, and allocate transient resources with minimal use of physical memory.

A full description of a render graph system is out of scope of this article, but interested readers are encouraged to refer to the following talks and articles:

-	[FrameGraph: Extensible Rendering Architecture in Frostbite](https://www.gdcvault.com/play/1024612/FrameGraph-Extensible-Rendering-Architecture-in), Yuriy O’Donnell, GDC 2017
-	[Advanced Graphics Tech: Moving to DirectX 12: Lessons Learned](https://www.gdcvault.com/play/1024656/Advanced-Graphics-Tech-Moving-to), Tiago Rodrigues, GDC 2017
-	[Render graphs and Vulkan — a deep dive](http://themaister.net/blog/2017/08/15/render-graphs-and-vulkan-a-deep-dive/), Hans-Kristian Arntzen

Different engines pick different parameters of the solution, for example Frostbite render graph is specified by the application using the final execution order (which the author of this article finds more predictable and preferable), whereas two other presentations linearize the graph based on certain heuristics to try to find a more optimal execution order. Regardless, the important part is that dependencies between passes must be declared ahead of time for the entire frame to make sure that barriers can be emitted appropriately. Importantly, the frame graph systems work well for transient resources that are limited in number and represent the bulk of required barriers; while it’s possible to specify barriers required for resource uploads and similar streaming work as part of the same system, this can make the graphs too complex and the processing time too large, so these are generally best handled outside of a frame graph system.

# Render passes

One concept that is relatively unique to Vulkan compared to both older APIs and new explicit APIs is render passes. Render passes allow an application to specify a large part of their render frame as a first-class object, splitting the workload into individual sub-passes and explicitly enumerating dependencies between sub-passes to allow the driver to schedule the work and place appropriate synchronization commands. In that sense, render passes are similar to render graphs described above and can be used to implement these with some limitations (for example, render passes currently can only express rasterization workloads which means that multiple render passes should be used if compute workloads are necessary to support). This section, however, will focus on simpler uses of render passes that are more practical to integrate into existing renderers, and still provide performance benefits.

## Load & store operations

One of the most important features of render passes is the ability to specify load and store operations. Using these, the application can choose whether the initial contents of each framebuffer attachments needs to be cleared, loaded from memory, or remain unspecified and unused by the application, and whether after the render pass is done the attachment needs to be stored to memory.

These operations are important to get right – on tiled architectures, using redundant load or store operations leads to wasted bandwidth which reduces performance and increases power consumption. On non-tiled architectures, driver can still use these to perform certain optimizations for subsequent rendering – for example, if the previous contents of an attachment is irrelevant but the attachment has associated compression metadata, driver may clear this metadata to make subsequent rendering more efficient.

To allow maximum freedom for the driver, it’s important to specify the weakest load/store operations necessary – for example, when rendering a full-screen quad to the attachment that writes all pixels, on tiled GPUs `VK_ATTACHMENT_LOAD_OP_CLEAR` is likely to be faster than `VK_ATTACHMENT_LOAD_OP_LOAD`, and on immediate mode GPUs LOAD is likely to be faster – specifying `VK_ATTACHMENT_LOAD_OP_DONT_CARE` is important so that the driver can perform an optimal choice. In some cases `VK_ATTACHMENT_LOAD_OP_DONT_CARE` can be better than either LOAD or CLEAR since it allows the driver to avoid an expensive clear operation for the image contents, but still clear image metadata to accelerate subsequent rendering.

Similarly, `VK_ATTACHMENT_STORE_OP_DONT_CARE` should be used in case the application is not expecting to read the data rendered to the attachment - this is commonly the case for depth buffers and MSAA targets.

## Fast MSAA resolve

After rendering data to an MSAA texture, it’s common to resolve it into a non-MSAA texture for further processing. If fixed-function resolve functionality is sufficient, there are two ways to implement this in Vulkan:

-	Using `VK_ATTACHMENT_STORE_OP_STORE` for the MSAA texture and `vkCmdResolveImage` after the render pass ends
-	Using `VK_ATTACHMENT_STORE_OP_DONT_CARE` for the MSAA texture and specifying the resolve target via `pResolveAttachments` member of `VkSubpassDescription`

In the latter case, the driver will perform the necessary work to resolve MSAA contents as part of work done when subpass/renderpass ends.

The second approach can be significantly more efficient. On tiled architectures, using the first approach requires storing the entire MSAA texture to main memory, followed by reading it from memory and resolving to the destination; the second approach can perform in-tile resolve in the most efficient manner. On immediate mode architectures, some implementation may not support reading compressed MSAA textures using the transfer stage – the API requires a transition into `VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL` layout before calling `vkCmdResolveImage`, which may lead to decompression of the MSAA texture, wasting bandwidth and performance. With `pResolveAttachments`, the driver can perform the resolve operation at maximum performance regardless of the architecture.

In some cases, fixed function MSAA resolve is insufficient. In this case, it’s necessary to transition the texture to `VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL` and do the resolve in a separate render pass. On tiled architectures, this has the same efficiency issues as `vkCmdResolveImage` fixed-function method; on immediate mode architectures the efficiency depends on GPU and driver. One possible alternative is to use an extra subpass that reads the MSAA texture via an input attachment.

For this to work, the first subpass that renders to MSAA texture has to specify the MSAA texture via `pColorAttachments`, with `VK_ATTACHMENT_STORE_OP_DONT_CARE` as the store op. The second subpass that performs the resolve needs to specify MSAA texture via pInputAttachments and the resolve target via pColorAttachments; the subpass then needs to render a full-screen quad or triangle with a shader that uses subpassInputMS resource to read MSAA data. Additionally, the application needs to specify a dependency between two subpasses that indicates the stage/access masks, similarly to pipeline barriers, and dependency flags `VK_DEPENDENCY_BY_REGION_BIT`. With this, the driver should have enough information to arrange the execution such that on tiled GPUs, the MSAA contents never leaves the tile memory and instead is resolved in-tile, with the resolve result being written to main memory[^7]. Note that whether this happens depends on the driver and is unlikely to result in significant savings on immediate mode GPUs.

# Pipeline objects

Older APIs typically used to split the GPU state into blocks based on functional units – for example, in Direct3D 11 the full state of GPUs modulo resource bindings can be described using the set of shader objects for various stages (VS, PS, GS, HS, DS) as well as a set of state objects (rasterizer, blend, depth stencil), input assembly configuration (input layout, primitive topology) and a few other implicit bits like output render target formats. The API user then could set individual bits of the state separately, without regards to the design or complexity of the underlying hardware.

Unfortunately, this model doesn’t match the model hardware typically uses, with several performance pitfalls that can occur:

-	While an individual state object is supposed to model parts of GPU state and could be directly transferred to commands that setup GPU state, on some GPUs the configuration of the GPU state required data from multiple different state blocks. Because of this, drivers typically must keep a shadow copy of all state and convert the state to the actual GPU commands at the time of Draw/DrawIndexed

-	With the rasterization pipeline getting more complex and gaining more programmable stages, some GPUs didn’t map them directly to hardware stages, which means that the shader microcode can depend on whether other shader stages are active and, in some cases, on the specific microcode for other stages; this meant that the driver might have to compile new shader microcode from state that can only be discovered at the time of Draw/DrawIndexed

-	Similarly, on some GPUs, fixed functional units from the API description were implemented as part of one of the shader stages – changing the vertex input format, blending setup, or render target format could affect the shader microcode. Since the state is only known at the time of Draw/DrawIndexed, this, again, is where the final microcode had to be compiled

While the first problem is more benign, the second and third problem can lead to significant stalls during rendering as, due to the complexity of modern shaders and shader compilation pipelines, shader compilation can take tens to hundreds of milliseconds depending on hardware. To solve this, Vulkan and other new APIs introduce the concept of pipeline object – it encapsulates most GPU state, including vertex input format, render target format, state for all stages and shader modules for all stages. The expectation is that on every supported GPU, this state is sufficient to build final shader microcode and GPU commands required to set the state up, so the driver never has to compile microcode at draw time and can optimize pipeline object setup to the extent possible.

This model, however, presents challenges when implementing renderers on top of Vulkan. There are multiple ways to solve this problem, with different tradeoffs wrt complexity, efficiency, and renderer design.

## Just-In-Time compilation

The most straightforward way to support Vulkan is to use just-in-time compilation for pipeline objects. In many engines due to the lack of first-class concepts that match Vulkan, the rendering backend must gather information about various parts of the pipeline state as a result of various state setup calls, similarly to what a Direct3D 11 driver might do. Then, just before the draw/dispatch where the full state is known, all individual bits of state would be grouped together and looked up in a hash table; if there’s already a pipeline state object in the cache, it can be used directly, otherwise a new object can be created.

This scheme works to get the application running but suffers from two performance pitfalls.

A minor concern is that the state that needs to be hashed together is potentially large; doing this for every draw call can be time consuming when the cache already contains all relevant objects. This can be mitigated by grouping state into objects and hashing pointers to these objects, and in general simplifying the state specification from the high-level API point of view.

A major concern, however, is that for any pipeline state object that must be created, the driver might need to compile multiple shaders to the final GPU microcode. This process is time consuming; additionally, it can not be optimally threaded with a just-in-time compilation model – if the application only uses one thread for command submission, this thread would typically also compile pipeline state objects; even with multiple threads, often multiple threads would request the same pipeline object, serializing compilation, or one thread would need several new pipeline objects, which increases the overall latency of submission since other threads would finish first and have no work to do.

For multi-threaded submission, accessing the cache can result in contention between cores even when the cache is full. Fortunately, this can be solved by a two-level cache scheme as follows:

The cache would have two parts, the immutable part that never changes during the frame, and the mutable part. To perform a pipeline cache lookup, we first check if the immutable cache has the object – this is done without any synchronization. In the event of the cache miss, we lock a critical section and check if the mutable cache has the object; if it doesn’t, we unlock the critical section, create the pipeline object, and then lock it again and insert the object into the cache, potentially displacing another object (additional or synchronization might be required if, when two threads request the same object, only one compilation request is issued to the driver). At the end of the frame, all objects from the mutable cache are added to the immutable cache and the mutable cache is cleared, so that on the next frame access to these objects can be free-threaded.

## Pipeline cache and cache pre-warming

While just-in-time compilation can work, it results in significant amount of stuttering during gameplay. Whenever an object with a new set of shaders/state enters the frame, we end up having to compile a pipeline object for it which could be slow. This is a similar problem to what Direct3D 11 titles would have, however in Direct3D 11 the drivers did a lot of work behind the scenes to try to hide the compilation latency, precompiling some shaders earlier and implementing custom schemes for patching bytecode on the fly that didn’t require a full recompilation. In Vulkan, the expectation is that the application handles pipeline object creation manually and intelligently, so a naive approach doesn’t work very well.

To make just-in-time compilation more practical, it’s important to use the Vulkan pipeline cache, serialize it between runs, and pre-warm the in-memory cache described in the previous section at application startup from multiple threads.

Vulkan provides a pipeline cache object, `VkPipelineCache`, that can store driver-specific bits of state and shader microcode to improve compilation time for pipeline objects. For example, if an application creates two pipeline objects with identical setup except for culling mode, the shader microcode would typically be the same. To make sure the driver only compiles the object once, the application should pass the same instance of `VkPipelineCache` to `vkCreateGraphicsPipelines` in both calls, in which case the first call would compile the shader microcode and the second call would be able to reuse it. If these calls happen concurrently in different threads the driver might still compile the shaders twice since the data would only be added to the cache when one of the calls finishes.

It’s vital to use the same `VkPipelineCache` object when creating all pipeline objects and serialize it to disk between runs using `vkGetPipelineCacheData` and `pInitialData` member of `VkPipelineCacheCreateInfo`. This makes sure that the compiled objects are reused between runs and minimizes the frame spikes during subsequent application runs.

Unfortunately, during the first play through the shader compilation spikes will still occur since the pipeline cache will not contain all used combinations. Additionally, even when the pipeline cache contains the necessary microcode, `vkCreateGraphicsPipelines` isn’t free and as such compilation of new pipeline objects can still increase the frame time variance. To solve that, it’s possible to pre-warm the in-memory cache (and/or `VkPipelineCache`) during load time.

One possible solution here is that at the end of the gameplay session, the renderer could save the in-memory pipeline cache data – which shaders were used with which state[^8] – to a database. Then, during QA playthroughs, this database could be populated with data from multiple playthroughs at different graphics settings etc. – effectively gathering the set of states that are likely to be used during the actual gameplay.

This database can then be shipped with the game; at game startup, the in-memory cache could be prepopulated with all states created using the data from that database (or, depending on the amount of pipeline states, this pre-warming phase could be limited to just the states for the current graphics settings). This should happen on multiple threads to reduce the load time impact; the first run would still have a longer load time (which can be further reduced with features like Steam pre-caching), but frame spikes due to just-in-time pipeline object creation can be mostly avoided.

If a particular set of state combinations wasn’t discovered during QA playthroughs, the system can still function correctly – at the expense of some amount of stuttering. The resulting scheme is more or less universal and practical – but requires a potentially large effort to play through enough levels with enough different graphics settings to capture most realistic workloads, making it somewhat hard to manage.

## Ahead of time compilation

The “perfect” solution – one that Vulkan was designed for – is to remove just-in-time compilation caches and pre-warming, and instead just have every single possible pipeline object available ahead of time.

This typically requires changing the renderer design and integrating the concept of the pipeline state into the material system, allowing a material to specify the state completely. There are different possible designs; this section will outline just one, but the important thing is the general principle.

An object is typically associated with the material that specifies the graphics state and resource bindings required to render the object. In this case, it’s important to separate resource bindings from the graphics state as the goal is to be able to enumerate all combinations of graphics state in advance. Let’s call the collection of the graphics state a “technique” (this terminology is intentionally similar to terminology from Direct3D Effect Framework, although there the state was stored in the pass). Techniques can then be grouped into effects, and a material would be referring to the effect, and to some sort of key to specify the technique from the effect.

The set of effects and set of techniques in an effect would be static; the set of effects would also be static. Effects are not as vital to being able to precompile pipeline objects as techniques but can serve as useful semantical grouping of techniques – for example, often material is assigned an effect at material creation time, but technique can vary based on where the object is rendered (e.g. shadow pass, gbuffer pass, reflection pass) or on the gameplay effects active (e.g. highlight).

Crucially, the technique must specify *all* state required to create a pipeline object, statically, ahead of time – typically as part of the definition in some text file, whether in a D3DFX-like DSL, or in a JSON/XML file. It must include all shaders, blend states, culling states, vertex format, render target formats, depth state. Here’s an example of how this might look:

```c
technique gbuffer
{
	vertex_shader gbuffer_vs
	fragment_shader gbuffer_fs

#ifdef DECAL
	depth_state less_equal false
	blend_state src_alpha one_minus_src_alpha
#else
	depth_state less_equal true
	blend_state disabled
#endif
	
	render_target 0 rgba16f
	render_target 1 rgba8_unorm
	render_target 2 rgba8_unorm

	vertex_layout gbuffer_vertex_struct
}
```

Assuming all draw calls, including ones used for post-effects etc, use the effect system to specify render state, and assuming the set of effects and techniques is static, it’s trivial to precreate all pipeline objects – each technique needs just one – at load time using multiple threads, and at runtime use very efficient code with no need for in-memory caches or possibility of frame spikes.

In practice, implementing this system in a modern renderer is an exercise in complexity management. It’s common to use complex shader or state permutations – for example, for two-sided rendering you typically need to change culling state and perhaps change the shaders to implement two-sided lighting. For skinned rendering, you need to change vertex format and add some code to the vertex shader to transform the attributes using skinned matrices. On some graphics settings, you might decide that the render target format needs to be floating-point R10G11B10 instead of RGBA16F, to conserve bandwidth. All these combinations multiply and require you to be able to represent them concisely and efficiently when specifying technique data (for example, by allowing #ifdef sections inside technique declarations as shown above), and – importantly – being aware of the steadily growing amount of combinations and refactoring/simplifying them as appropriate. Some effects are rare enough that they could be rendered in a separate pass without increasing the number of permutations. Some computations are simple enough that always running them in all shaders can be a better tradeoff than increasing the number of permutations. And some rendering techniques offer better decoupling and separation of concerns, which can also reduce the number of permutations.

Importantly though, adding state permutations to the mix makes the problem harder but doesn’t make it different – many renderers have to solve the problem of a large number of shader permutations anyway, and once you incorporate all render state into shader/technique specification and focus on reducing the number of technique permutations, the same complexity management solutions apply equally to both problems. The benefit of implementing a system like this is perfect knowledge of all required combinations (as opposed to having to rely on fragile permutation discovery systems), great performance with minimal frame-to-frame variance including the first load, and a forcing function to keep the complexity of rendering code at bay.

# Conclusion

Vulkan API shifts a large amount of responsibility from driver developers onto application developers. Navigating the landscape of various rendering features becomes more challenging when many implementation options are available; it’s challenging enough to write a correct Vulkan renderer, but performance and memory consumption is paramount. This article tried to discuss various important considerations when dealing with specific problems in Vulkan, present multiple implementation approaches that provide different tradeoffs between complexity, ease of use and performance, and span the range between porting existing renderers to redesigning renderers around Vulkan.

Ultimately, it’s hard to give a general advice that works across all vendors and is applicable to all renderers. For this reason, it’s vital to profile the resulting code on the target platform/vendor – for Vulkan, it’s important to monitor the performance across all vendors that the game is planning to ship on as the choices the application makes are even more important, and in some cases a specific feature, like fixed-function vertex buffer bindings, is the fast path on one vendor but a slow path on another.

Beyond using validation layers to ensure code correctness and vendor-specific profiling tools, such as AMD Radeon Graphics Profiler or NVidia Nsight Graphics, many open-source libraries that can help optimize your renderer for Vulkan are available:

- [VulkanMemoryAllocator](https://github.com/GPUOpen-LibrariesAndSDKs/VulkanMemoryAllocator) - provides convenient and performant memory allocators for Vulkan as well as other memory-related algorithms such as defragmentation.

- [volk](https://github.com/zeux/volk) - provides an easy way to use driver-provided Vulkan entrypoints from the driver directly which can reduce function call overhead

- [simple_vulkan_synchronization](https://github.com/Tobski/simple_vulkan_synchronization) - provides a way to specify Vulkan barriers using a simplified access type model, which helps balance correctness and performance

- [Fossilize](https://github.com/ValveSoftware/Fossilize) - provides serialization support for various Vulkan objects, most notably for pipeline state creation info which can be used to implement pre-warming for a pipeline cache.

- [perfdoc](https://github.com/ARM-software/perfdoc) - provides layers similar to validation layers, that analyze the stream of rendering command and identify potential performance problems on ARM GPUs

- [niagara](https://github.com/zeux/niagara) - provides an example bindless renderer that follows some of the advice from this article (but not all of it!)

- [Vulkan-Samples](https://github.com/khronosGroup/Vulkan-samples) - provides many samples that explore various tradeoffs in implementation of Vulkan rendering techniques along with details on the performance on mobile.

Finally, some vendors develop open-source Vulkan drivers for Linux; studying their sources can help gain more insight into performance of certain Vulkan constructs:

[GPUOpen-Drivers](https://github.com/GPUOpen-Drivers/) for AMD - contains xgl which has the Vulkan driver source, and PAL which is a library used by xgl; many Vulkan function calls end up going through both xgl and PAL

[mesa3d/radv](https://github.com/mesa3d/mesa/tree/master/src/amd/vulkan) for AMD - contains community-developed open-source radv driver

[mesa3d/anvil](https://github.com/mesa3d/mesa/tree/master/src/intel/vulkan) for Intel - contains Anvil driver

> Author wishes to thank Alex Smith (Feral Interactive), Daniel Rákos (AMD), Hans-Kristian Arntzen (ex. ARM), Matthäus Chajdas (AMD), Wessam Bahnassi (INFramez Technology Corp) and Wolfgang Engel (CONFETTI) for reviewing the drafts of this article and helping make it better.

---
[^1]: We only cover memory allocation types that are writable from host and readable or writable from GPU; for CPU readback of data that has been written by GPU,  memory with `VK_MEMORY_PROPERTY_HOST_CACHED_BIT` flag is more appropriate.
[^2]: Note that `VK_MEMORY_PROPERTY_HOST_COHERENT_BIT` generally implies that the memory will be write-combined; on some devices it’s possible to allocate non-coherent memory and flush it manually with `vkFlushMappedMemoryRanges`.
[^3]: Note that with the 4 descriptors per pipeline, this approach can’t handle full pipeline setup for VS, GS, FS, TCS and TES – which is only a problem if you use tessellation on drivers that only expose 4 descriptor sets.
[^4]: Depending on the GPU architecture it might also be beneficial to pass some of the indices, like material index or vertex data offset, via push constants to reduce the number of memory indirections in vertex/fragment shaders.
[^5]: Regrettably, Vulkan doesn’t provide a way for the driver to implement thread-safe command buffer recording so that one command pool can be reused between threads; in the scheme described, cross-thread synchronization is only required for switching pages which is relatively rare and can be lock-free for the most part.
[^6]: It’s crucial to note that a commonly held belief that individual draw calls execute in isolation without overlap with other work is wrong – GPUs commonly run subsequent draw calls in parallel across render state, shader and even render target switches.
[^7]: Of course, it’s not guaranteed that the driver will perform this optimization - it depends on the hardware architecture and driver implementation.
[^8]: This can use an application-specific format, or a library like [Fossilize](https://github.com/ValveSoftware/Fossilize)
