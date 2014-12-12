---
layout: post
title: Render state rant
---

While designing D3D10, a number of decisions were made to improve runtime efficiency (to reduce batch cost, basically). It’s no secret that D3D9 runtime is not exactly lean & mean – there is a lot of magic going on behind the scenes, a lot of validation, caching, patching…

For example, D3D9 has the ability to set any render or sampler state at any time. However, hardware does not really work that way. The states are separated into groups, and you can only set the whole group at a time (of course, the exact structure of groups is hardware dependent). What this means for runtime/driver is that SetRenderState/SetSamplerState often do not actually set anything. Instead, they modify a so called shadow state – they update the changed states in a local shadow copy, and mark the respective groups as dirty. Then, when you call DrawIndexedPrimitive, the changed state groups are being set, and the dirty flags – cleared.

Also there could be some cross-state checking going on, I don’t know for sure.

So, D3D10 designers decided to replace hundreds of states by 4 simple state objects. Behold, ID3D10BlendState, ID3D10DepthStencilState, ID3D10RasterizerState and ID3D10SamplerState. These are immutable driver state objects – you create them once, you can’t modify them, and driver knows about them, which means it can do smart things (for example, store a chunk of push buffer that sets the respective state inside each state object) and thus optimize state setting. Also all possible validation is made at creation time only.

Sounds cool, right? Yeah, it did first time I’ve read about state objects. Except…

Problem #1. State objects are relatively expensive to construct. Which means 10-100 thousand CPU cycles on my Core 2 Duo. You know, given that we have a user mode driver, given that the smartest thing I can think of here is to 1. hash the state to check if the same state has already been created (it is actually done, you can check it by creating the same state object several times), 2. If the hash lookup failed, validate the state (perform some sanity checks), 3. construct a chunk with push buffer commands, 4. store it in allocated memory. And that should be performed by user mode code. Something is horribly wrong here, I swear.

Note, that even creating the already existing state object (hash state, hash lookup, compare actual state values, remember?) takes 10 thousand cycles. The caching should be performed in D3D10 runtime (the pointer returned is exactly the same - i.e. for input layouts, the caching is performed by the driver, as the pointer to the InputLayout is different, but the underlying driver object is the same; for state objects, pointers to runtime objects are equal), so this means that computing a hash of a 40-byte description object, doing a table lookup, and then comparing two 40-byte objects to test for equality in case of hash collision takes 10 thousand cycles.

Problem #2. You can’t create more than 4096 state objects. Which means that you can’t just forget about it and create a state for each object, even for static ones. Well, you can try, but one day it’ll fail.

Problem #3. The separation of states into groups is outrageous. I did not tell one small thing – not all states are actually immutable. There are two things you can change without constructing a new state object (they act as parameters for state object setting functions). Those are… stencil reference value and blend factor. Everything else is immutable, for example, depth bias and slope scaled depth bias.

How many of you have used blend factor with pixel shader (let’s say ps.2.0)-capable hardware?

How many of you have used a constantly changing stencil reference value?

I’d like to do things like progressively loading textures. What do I mean? Let’s load our texture from smaller mip levels to larger ones. Let’s interpolate MinLOD parameter from N to N-1 once N-1-th mip level is completely loaded – let’s do it over some fixed time. This way there will be no mip level popping, but instead we’ll see gradually improving quality as new levels are loaded – trilinear filtering will do proper interpolation for us. That’s easy, right? No. Not in D3D10.

Yes, I know I could cache render states inside objects, and perform some lifetime management (LRU?..). Though this won’t help in case of constantly changing parameters.

Yes, I know I could separate render states into groups how I like it best, have a 4096-entry hash table, and do lookups in it. And this is actually what I am doing now.

But it does not make me happy.
