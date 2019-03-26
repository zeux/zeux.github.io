---
layout: post
title: 'Source code: Implementing Direct3D for fun and profit'
---

Almost a year and a half ago I blogged [about several useful things that you can do with custom IDirect3DDevice9 implementations](/2009/06/08/implementing-direct3d-for-fun-and-profit/). I don't know why I did not post the code back then, but anyway - here it is:

[dummydevice.h](https://gist.github.com/zeux/66e62f12fa4616711088#file-dummydevice-h) - this is just an example of a dummy device implementation; it implements all device methods with stubs that can't be called without a debugging break. This is useful for other partial implementations.

[deferreddevice.h](https://gist.github.com/zeux/66e62f12fa4616711088#file-deferreddevice-h) - this is the implementation of the device that buffers various rendering calls and then allows to execute them on some other device. Note that it lives in a fixed size memory buffer, which can be easily changed, and that it implements only a subset of rendering-related functions (i.e. no FFP).

[texturedevice.h](https://gist.github.com/zeux/66e62f12fa4616711088#file-texturedevice-h) - this is the implementation of the device that works with D3DXCreateTextureFromFile for 2D textures and cubemaps (3D texture support is missing but can be added in the same way).

DL_BREAK is the replacement for __debugbreak, DL_ASSERT is a custom assertion macro (with neat (void)sizeof(!(expr)) trick that I hope everybody knows about by now), everything else should be obvious.
