---
layout: post
title: "Small, fast, web"
excerpt_separator: <!--more-->
---

When implementing vertex/index decoders in [meshoptimizer](https://github.com/zeux/meshoptimizer), the main focus was on lean implementation and decompression performance.

<a href="https://zeux.io/nyra/"><img align="left" src="/images/fastweb.jpg" style="padding-right: 20px;" /></a>

When your streaming source is capable of delivering hundreds of megabytes per second, as is the case with SSD drives, and you want to accelerate loading by compressing the data further, you need to be decompressing at multiple hundreds of megabytes per second, ideally a gigabyte, to make sure a small number of CPU cores can keep up with IO. Keeping implementation lean meant it was easy to understand and optimize. To supplant the inevitable loss of compression ratio, the codecs were designed in such a way that their output can be compressed further using lossless general purpose compressors such as [lz4](https://github.com/lz4/lz4) or [zstd](https://github.com/facebook/zstd), thus offering an easy tradeoff between compression ratio and performance.

This set of implementation decisions unexpectedly resulted in algorithms that are a pretty good fit for delivering web content. The performance penalty often induced by running code in the browser is offset by the incredibly high baseline performance, and most web content has "free" gzip compression efficiently applied during the download process. This article will describe the evolution of `decoder.js`, a WebAssembly port of geometry decoders from meshoptimizer.

<!--more-->

## Baseline

To get the decoders working, two functions needed to be exposed to JavaScript[^1]:

```c++
int meshopt_decodeVertexBuffer(void* destination, size_t vertex_count, size_t vertex_size, const unsigned char* buffer, size_t buffer_size);
int meshopt_decodeIndexBuffer(void* destination, size_t index_count, size_t index_size, const unsigned char* buffer, size_t buffer_size);
```

To simplify the port, the assumption is that the data can be encoded offline using C++ or [Rust](https://crates.io/crates/meshopt) versions of the library, and only decoders are necessary at runtime[^2]. JavaScript code would download the encoded data - possibly using `fetch()` which would be capable of using `gzip` decompression built into the browser - pass them to the decode functions, and then upload the resulting vertex/index buffers to WebGL directly or using the 3D framework of choice.

The functions are self-contained, perform no memory allocations and don't use the standard library short of basic functions like `memset`/`memcpy`. This meant that the requirements on the cross-compilation toolchain should be minimal. The obvious choice - and probably the only practical option at the moment? - is [Emscripten](https://emscripten.org/).

After installing it using fantastic [emsdk](https://github.com/emscripten-core/emsdk) distribution, and experimenting with a few different options, I was able to get the code to compile:

```c++
emcc src/vertexcodec.cpp src/indexcodec.cpp -Os -DNDEBUG -s EXPORTED_FUNCTIONS='["_meshopt_decodeVertexBuffer", "_meshopt_decodeIndexBuffer"]' -o decoder.js
```

This resulted in two files, `decoder.js` (14801 bytes, 4606 bytes after gzip) and `decoder.wasm` (3843 bytes, 1680 bytes after gzip). The bulk of the code was thus the JavaScript runtime, the WebAssembly file that contained the actual source was relatively small.

However, to invoke these functions, the caller would have to provide the buffers to the WebAssembly compiled functions from the JavaScript side.

## Allocating memory from JavaScript

Before I started the port I was hoping that due to how simple the function interface is, I would be able to directly pass two ArrayBuffer objects - one for input and one for output - to the function and have it work directly with the data. Unfortunately, this isn't really possible today - WebAssembly specification only allows for one Memory object to be used. Because of this, the JavaScript wrapper code would need to allocate two buffers on heap, copy data into one buffer, perform the decompression and then copy data into the target buffer allocated by the caller:

```js
Module.decodeVertexBuffer = function (target, vertexCount, vertexSize, source) {
    var tp = Module._malloc(vertexCount * vertexSize);
    var sp = Module._malloc(source.length);

    Module.HEAPU8.set(source, sp);

    var res = Module._meshopt_decodeVertexBuffer(tp, vertexCount, vertexSize, sp,
        source.length);

    target.set(Module.HEAPU8.subarray(tp, tp + vertexCount * vertexSize), 0);

    Module._free(sp);
    Module._free(tp);

    if (res != 0) {
        throw new Error("Malformed vertex buffer data");
    }
}
```

This requires a `malloc`/`free` implementation to be provided by the runtime; since we can not know, ahead of time, how large the heap might become, we need to compile our code with support for memory growth:

```
emcc src/vertexcodec.cpp src/indexcodec.cpp -Os -DNDEBUG -s EXPORTED_FUNCTIONS='["_meshopt_decodeVertexBuffer", "_meshopt_decodeIndexBuffer", "_malloc", "_free"]' -s ALLOW_MEMORY_GROWTH=1 --post-js decoder-post.js -o decoder.js
```

This results in larger `decoder.js` (17980 bytes, 5427 bytes after gzip) and substantially larger `decoder.wasm` (12432 bytes, 5047 bytes after gzip). Fortunately, Emscripten provides a custom malloc implementation, emmalloc, that isn't as fast as the default implementation, but is substantially leaner - we don't really care about performance since we only allocate two buffers, and switching to emmalloc reduces `decoder.wasm` to 5993 bytes, 2577 bytes after gzip - we've lost ~1 KB after gzip which is reasonable.

## Reducing distribution size further

We're now down to two files that add up to 8004 bytes after gzip, which is pretty good - unfortunately, to start requesting the WebAssembly module, we need to fully parse and execute `decoder.js`, which increases our latency by the time it takes to do one extra HTTP request. To mitigate this cost, Emscripten supports an option to embed the binary files into the JavaScript file using a Base64 string (`-s SINGLE_FILE=1`). Using that costs us the inclusion of Base64 decoder and inflating the size of the WebAssembly file, but for small libraries it's worthwhile.

Applying this option means that we just have a single file `decoder.js` with a size of 28006 bytes, 9918 bytes after gzip. The size penalty is probably not dissimilar to the size of HTTP header...

Fortunately, we have one more easy switch left that we haven't enabled yet - Emscripten docs recommend to use Google Closure compiler, using `--closure 1` switch. This compiler is written in Java (so using it requires installing Java SDK...) and processes JS code to perform dead code elimination and minification of identifiers including object keys. To make sure the code keeps working I had to enable `MODULARIZE=1` mode and change dotted access like `Module._free` to array access `Module["_free"]` so that Closure compiler doesn't minify `_free` which has to match the name of WebAssembly export.

```
emcc src/vertexcodec.cpp src/indexcodec.cpp -Os -DNDEBUG -s EXPORTED_FUNCTIONS='["_meshopt_decodeVertexBuffer", "_meshopt_decodeIndexBuffer", "_malloc", "_free"]' -s ALLOW_MEMORY_GROWTH=1 -s MALLOC=emmalloc -s MODULARIZE=1 -s EXPORT_NAME=MeshoptDecoder --closure 1 --post-js decoder-post.js -o decoder.js
```

Closure compiler doesn't change the size of WebAssembly code or the overhead of Base64 encoding, but it does reduce the JavaScript runtime quite a bit; with this, `decoder.js` settled at 20023 bytes, 8469 bytes after gzip.

## Optimizing for performance

Now it's time to look at performance. WebAssembly tries to reach near native speeds, however based on the past experience with sandboxed systems like this I expected some amount of overhead. Looking at decoding performance on `nyra.obj` (28K triangles, 18K vertices), the web version was indeed substantially slower. However, C++ version uses SSSE3 or NEON when available; measuring with SIMD disabled paints a slightly less gloomy picture[^3]:

|             | vertex decode | index decode
|-------------|---------------|-------------
| C++, SSSE3  | 0.10 msec | 0.10 msec
| C++, scalar | 0.30 msec | 0.10 msec
| emcc -Os (Chrome) | 0.55 msec | 0.47 msec

Not quite sure how to profile the code, short of trying to use internal Chrome options to inspect the assembly and guess where the overhead is coming from, I decided to make sure that `-Os` was indeed justified. While in theory optimizing for size may compromise performance, in practice for native compilation `-Os` often generates code that is close to optimal so I wasn't expecting miracles. I was pleasantly surprised.

|          | vertex decode | index decode | decoder.js size |
|----------|---------------|--------------|-----------------|
| emcc -Os | 0.55 msec | 0.47 msec | 18211 bytes, 7845 bytes after gzip |
| emcc -O2 | 0.49 msec | 0.27 msec | 21209 bytes, 8902 bytes after gzip |
| emcc -O3 | 0.48 msec | 0.27 msec | 19387 bytes, 8193 bytes after gzip |

While `-O2` noticeably increases the binary size, `-O3` results in a somewhat more modest increase and in a substantial performance boost, making index decoder substantially faster in particular. The performance delta with native code is still, unfortunately, very large. In case of JavaScript, the timings do include the extra cost of copying the data, however that's not where the bulk of the cost lies - the copies are almost free compared to the time it takes to run the actual code.

## Stack > heap

Now that performance looks slightly better, it's time to take another look at code size. While it's pretty reasonable as it stands, it's still a handful of JS code to download, and a large part of this code - ~1 KB post gzip - is code we didn't write that implements malloc/free. In many ways, Emscripten is very much like embedded software - linear memory model, NULL pointer is a valid pointer, strict code size constraints, etc. - and like in many embedded systems, heap is implemented using `sbrk`.

In Emscripten, the linear memory space consists of the stack, that has a fixed size, and a heap that follows after the stack. `sbrk` allows you to manipulate the pointer to the end of heap space; advancing sbrk past the end of the heap triggers heap resize, which leads to Emscripten reallocating the backing Memory object for WebAssembly. Since we only need to allocate two buffers and they have the same lifetime, our memory management resembles stack more than heap and thus `sbrk` is really easy to integrate:

```js
Module['decodeVertexBuffer'] = function (target, vertexCount, vertexSize, source) {
    var tp = Module["_sbrk"](vertexCount * vertexSize);
    var sp = Module["_sbrk"](source.length);

    Module["HEAPU8"].set(source, sp);

    var res = Module["_meshopt_decodeVertexBuffer"](tp, vertexCount, vertexSize, sp,
        source.length);

    target.set(Module["HEAPU8"].subarray(tp, tp + vertexCount * vertexSize), 0);

    Module["_sbrk"](tp - Module["_sbrk"](0));

    if (res != 0) {
        throw new Error("Malformed vertex buffer data");
    }
}
```

Note that you can use `sbrk(0)` to get the pointer to the top of the heap space without moving it. There are some alignment considerations that we're ignoring here since there are certain guarantees about `vertexSize` that make them irrelevant.

As a result, we no longer pay the cost of including `emmalloc`, and the result shows: decoder.js now takes 16654 bytes, 7004 bytes after gzip - we saved more than 1K by removing malloc! This is probably not an interesting consideration for larger programs, but for a library as small as this it's worthwhile.

## Minimal runtime

It's pretty obvious at this point that the bulk of our size is in the JavaScript runtime - even after Closure optimizations, there's still a lot of work that it needs to do. After seeing [the tweet by Andre Weissflog](https://twitter.com/FlohOfWoe/status/1096856311910809600) about new Emscripten feature, `MINIMAL_RUNTIME`, I was curious and decided to try it out. It requires an Emscripten version built from latest source, and lives at the bleeding edge - the [first change for it](https://github.com/emscripten-core/emscripten/pull/7923) was merged just about a month ago. It doesn't support two features I need, `SINGLE_FILE` and `ALLOW_MEMORY_GROWTH`, but I was able to hack single file support in and build a working prototype without memory growth support; the resulting file, after going through Emscripten JS optimizer (no Closure support just yet), decoder.js shrunk from 16654 bytes to 9306 bytes. Memory growth would mean a slight size increase but the result would probably be around 9500 bytes before gzip - very sizeable savings.

This is where I thought this would end - I'd wait for minimal runtime to become more mature, perhaps contribute `SINGLE_FILE` support that wasn't otherwise planned, and eventually get the size increase I wanted. However, the more I thought about this, the more I wanted to try to just do this myself. After all, how much code do you *really* need to run the decoders?

I started by taking Emscripten, asking it to generate just the .wasm file:
```
emcc src/vertexcodec.cpp src/indexcodec.cpp -O3 -DNDEBUG -s EXPORTED_FUNCTIONS='["_meshopt_decodeVertexBuffer", "_meshopt_decodeIndexBuffer"]' -s ALLOW_MEMORY_GROWTH=1 -s TOTAL_STACK=32768 -s TOTAL_MEMORY=65536 -o decoder.wasm
```

And then copying the code from [Mozilla developer site](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WebAssembly/instantiate) for `WebAssembly.instantiate` and gradually filling the missing pieces. Instead of compiling `sbrk` into the WebAssembly binary - which resulted in extra symbols such as `DYNAMICTOP_PTR` that I would have to export and maintain - a simple JS implementation of `sbrk` was written. To download the file, the Base64 blob is passed to `fetch()` function as a data URI - this method probably doesn't work in all environments, but it does seem to work in all browsers, it's small in terms of code size and is reasonably fast, since the browser does all the heavy-lifting. This resulted in a very short and, even if I say so myself, beautiful implementation:

```
var wasm = "BASE64DATA";
var memory = new WebAssembly.Memory({
    initial: 1
});
var heap = new Uint8Array(memory.buffer);
var brk = 32768; // stack top

var sbrk = function(size) {
    var old = brk;
    brk += size;
    if (brk > heap.length) {
        memory.grow(Math.ceil((brk - heap.length) / 65536));
        heap = new Uint8Array(memory.buffer);
    }
    return old;
};

var imports = {
    env: {
        memory: memory,
        _emscripten_memcpy_big: function(d, s, n) {
            heap.set(heap.subarray(s, s + n), d);
        },
    }
};

var instance = {};
var promise =
    fetch('data:application/octet-stream;base64,' + wasm)
    .then(response => response.arrayBuffer())
    .then(bytes => WebAssembly.instantiate(bytes, imports))
    .then(result => instance = result.instance);
```

With this, and the wrapper functions that looked more or less the same as the original Emscripten version, the new "runtime" was complete. The only extra symbol other than the heap that WebAssembly version needs is the `memcpy` version for large blocks. Since WebAssembly - unfortunately! - doesn't come with an instruction to efficiently copy a memory block, Emscripten implements `memcpy` using a hand-coded loop that falls back to JS function for really large blocks.

To build the full library, instead of producing a new `.js` file from a source by embedding Base64 encoded version into that, I opted for removing the dependencies on JS minifiers and the like, and patching in the binary using `sed`[^4]:

```
sed -i "s#\(var wasm = \)\".*\";#\\1\"$$(cat decoder.wasm | base64 -w 0)\";#" decoder.js
```

The resulting `decoder.js` file with embedded Base64 blob is the smallest yet by far, taking 8346 bytes, 3676 bytes after gzip, at about 1K smaller (pre-gzip) than Emscripten minimal runtime. It only does one job, but it seems to do it pretty well. Note that this doesn't include any minification - the code is so small that a minifier isn't as critical, and it's refreshing to be able to edit or debug the original source directly.

## Future work

While the results are pretty good overall, and the [optimized decoders](https://github.com/zeux/meshoptimizer/blob/master/js/decoder.js) will ship as part of the next meshoptimizer release, there's always room for further improvement.

Performance of the WebAssembly version is still substantially lower than that of the native version. This is partly due to lack of SIMD - the SIMD proposal for WebAssembly, especially with the hopefully imminent addition of [dynamic shuffles](https://github.com/WebAssembly/simd/issues/68), should hopefully address that - but index codec doesn't use SIMD. There's clearly a lot of room for improvement here; probably mostly on the toolchain side but there may be some modifications to the C++ code that would make it faster as well. One big issue is the lack of easy access to native code - I'd love to start from the generated x64 assembly and then figure out why it's inefficient and where in the stack the inefficiency occurs.

In terms of code size, while it's looking really good right now at just under 4K after gzip, the eventual introduction of SIMD version would at least double the WebAssembly portion (to maintain support for browsers without WebAssembly SIMD), if not more. After the optimizations the breakdown of code size before gzip in the final version is as follows:

- JS runtime: 1966 bytes
- wasm meshopt_decodeVertexBuffer: 1772 bytes (~2363 bytes after Base64)
- wasm meshopt_decodeIndexBuffer: 2398 bytes (~3197 bytes after Base64)
- wasm memcpy: 454 bytes (~605 bytes after Base64)

It's likely possible to recode `memcpy` to fit the workflow better and/or rely on the eventual builtin; JS runtime could be minified, running it through UglifyJS produces 1059 byte file which is ~900 bytes smaller, and it's possible that instead of using Base64 to encode the file, a better option is to either use a larger but more compressible encoding, or to put the data into a separate file and use some kind of prefetch declaration in the source HTML file to fetch `.js` and `.wasm` files in parallel.

---
[^1]: This is probably a good time to mention that while I have extensive experience with native code, my exposure to JavaScript or WebAssembly has been non-existent before this work. I'm likely doing many things wrong, and comments with suggestions for improvements are appreciated!
[^2]: A more or less complete example of performing all the necessary transformations can be found [in tools/meshencoder.cpp](https://github.com/zeux/meshoptimizer/blob/master/tools/meshencoder.cpp).
[^3]: All timings are taken on i7-8700K; C++ version is compiled using `gcc -O3`, WebAssembly version is running in latest stable Chrome and the measurements are taken after 10 runs of the function to exclude JIT/warmup.
[^4]: While modifying the build source directly may seem bad, this makes editing workflow much easier when WebAssembly portion doesn't need to be rebuilt - you just edit the file!