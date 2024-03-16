---
layout: post
title: LLM inference speed of light
excerpt_separator: <!--more-->
---

In the process of working on [calm](https://github.com/zeux/calm), a minimal from-scratch fast CUDA implementation of transformer-based language model inference, a critical consideration was establishing the speed of light for the inference process, and measuring the progress relative to that speed of light.

<!--more-->

# Inference mechanics

When a language model[^1] is generating [tokens](https://tiktokenizer.vercel.app/), it does so one token at a time; language models (specifically, decoder-only text transformer models, but the rest of the post will just describe them as LLMs) can be understood as a function that takes a token as input and produces an array of probabilities for all tokens from the vocabulary (which typically has 50-250K tokens, and each token is a few letters). Then, the program samples from the set of all tokens using the probabilities to guide the sampling, produces the next token, and the process repeats. This means that there is no possibility of parallelism when generating one sequence of text - the generation process can be modeled one token at a time[^2].

Broadly, the language model does two types of operations when processing a token: a matrix-vector multiplication, where a large matrix (e.g. 8192x8192) is multiplied by a vector to produce another vector and attention computation. During generation, the model can see not just the state of the current token, but also internal states from all previous tokens in the sequence - both the ones the user has written in the prompt and the ones the model itself has generated. These are stored in a structure called "KV-cache" (key-value cache), which is essentially a set of key and value vectors for each previous position in the text. Attention takes a query vector generated for the current token, computes a dot product between it and all key vectors for all previous positions, then normalizes the resulting set of scalars and computes a value vector by computing a weighted sum of all value vectors for all previous positions, using the dot product as the score.[^3]

Now, both matrix-vector multiplication and attention computation have one important characteristic in common: for each element read from the matrix or KV-cache, we need to do a very small number of floating-point operations. Matrix-vector multiplication does one multiply-add (2 FLOPs) per matrix element; attention computation does one multiply-add per key element for dot product, and one multiply-add per value element for computing a weighted sum.

Modern CPUs and GPUs have a much higher rate of ALU operations (multiplies, adds) compared to the rate at which they can read inputs from memory. For example:

- AMD Ryzen 7950X has 67 GB/s memory bandwidth and 2735 GFLOPs, for a 40:1 FLOP:byte ratio[^4]
- NVidia GeForce 4090 has 1008 GB/s memory bandwidth and 83 TFLOPs, for a 82:1 FLOP:byte ratio[^5]
- NVidia H100 SXM (which is a data-center card) has 3350 GB/s memory bandwidth and 67 TFLOPs, for a seemingly more modest 20:1 FLOP:byte; however, for problems that look like a matrix multiplication, tensor cores provide ~494 TFLOPs without sparsity for a 147:1 FLOP:byte ratio.

The numbers get even worse for smaller floating point numbers like FP16 or FP8: H100 tensor cores have a theoretical throughput of 1979 TFLOPs for dense FP8 matrices, which brings the FLOP:byte ratio to 590:1. Needless to say, in any of these configurations and regardless of whether tensor cores are used or what the floating-point format is, ALU is in abundance.

Thus, any problem that only needs to do two operations per element must be bandwidth-limited, and we should be able to estimate the minimum amount of time it can take to run the inference process from the model configuration, the size of the KV-cache, and the available bandwidth.

# Mistral speed-of-light

Without going too much into the exact formulas and matrices used, let's look at a model like [Mistral 7B](https://mistral.ai/news/announcing-mistral-7b/), which has 7.2 billion parameters (so the total number of all matrix elements is 7.2B).

The composition of the parameters is as follows:

- 4096 \* 32000 = 131M parameters for embedding matrix; this matrix isn't used in a matrix-vector multiply, as just a single row of the matrix is read per token, so we will not include this in the bandwidth calculations
- 32 \* (4096 \* (128 \* 32 + 128 \* 8 \* 2) + 4096 \* 128 \* 32) = 1342M parameters for computing attention-related vectors
- 32 \* (4096 \* 14336 \* 3) = 5637M parameters for transforming hidden state via a feed-forward network
- 4096 \* 32000 = 131M parameters for converting the hidden state into token probabilities; this is used in a matrix multiply unlike the embedding matrix

This adds up to ~7111M "active" parameters that are used in matrix multiplications. If the model is using FP16 for the matrix elements, we end up having to read ~14.2 GB of data for each token.[^6] Additionally, while each matrix is going to be used again when running inference for the next token, caches are measured in tens of megabytes, and as such we can assume this process can not run faster than memory bandwidth.

This covers matrix math; attention computation needs to read the KV-cache up until the current token, so the amount of data read depends on how many tokens the model sees when generating the new one - that includes the system prompt (usually hidden from the user), user prompt, previous model output, and can include multiple user prompts for a longer chat session.

For Mistral, KV-cache stores 8 128-element vectors for each key for each layer and 8 128-element vectors for each value for each layer, which adds up to 32 \* 128 \* 8 \* 2 = 65K elements per token; if the KV-cache is using FP16 for individual elements, then for token number P we will need to read P \* 130 KB of memory - for example, token number 1000 will need to read 130 MB of data from KV-cache.

From these numbers, it's now easy to compute the minimal amount of time required for inference. For example, on NVidia RTX 4090 (1008 GB/s), 14.2 GB take ~14.1 ms to read, so we can expect ~14.1 ms per token for tokens with low position numbers (KV-cache impact is negligibly small). If we use 8-bit weights, we need to read 7.1 GB and that takes ~7.0 ms. These are *lower bounds* - they represent the minimum theoretically possible time per token.

# Are theoretical bounds useful?

We've done a bunch of math and arrived at a few numbers that tell us we can't run inference faster than a given threshold - is this useful? Let's look at a few reasons why it could be.

To actually reach that time, you need a high-quality software implementation, and hardware that can reach the theoretical peak bandwidth. This means that if a given implementation is far from the optimal number, it's a cause for investigation: efficiency might be left on the table, either on the software or on the hardware side. For example, on RTX 4090 `calm` achieves ~15.4 ms/tok for Mistral 7B when using 16-bit weights and ~7.8 ms/tok for 8-bit weights - this is around 90% of the theoretically possible performance.[^7] On Apple M2 Air when using CPU inference, both `calm` and `llama.cpp` only reach ~65% of the theoretical 100 GB/s bandwidth, suggesting that the quoted peak bandwidth can only be fully utilized with the help of iGPU.

Bandwidth scales linearly with the number of bytes used per element; this means that we can both estimate theoretical wins from smaller weight formats (quantization) and validate the quality of implementations by comparing the actual performance with the theoretical limit. For example, on RTX 4090 [llama.cpp](https://github.com/ggerganov/llama.cpp) achieves ~17.1 ms/tok for Mistral 7B when using 16-bit weights (82% of peak), ~10.3ms/tok for 8.5-bit weights (71% of peak) and ~6.7ms/tok for 4.5-bit weights (58% of peak), suggesting significant optimization opportunities for smaller formats.

In addition to providing a lower bound on decoding time, the modeling above suggests that the inference process is significantly under-utilizing the ALU units. To fix this, the FLOP:byte balance needs to shift; techniques like [speculative decoding](https://medium.com/@TitanML/in-the-fast-lane-speculative-decoding-10x-larger-model-no-extra-cost-f33ea39d065a) attempt to help with this, but for a multi-user example we can note that when multiple user requests are being processed, we can perform multiple matrix-vector multiplications with the same matrix at the same time (otherwise known as a matrix-matrix multiplication!) -- an optimal implementation of matrix-matrix multiplication becomes ALU-bound for sufficiently large matrices. This is why this ALU:byte imbalance is not a critical issue for production inference systems - when you ask ChatGPT to help with a task, your request is evaluated concurrently with many other requests on the same GPU, and the bandwidth is utilized more efficiently. Crucially, request batching typically does not help with KV-cache bandwidth (unless the requests share a very large prefix) -- see the appendix!

> Mixture of Experts models like Mixtral have slightly different scaling characteristics: batching initially only increases the bandwidth required, but once the expert utilization becomes significant the inference becomes increasingly ALU bound.

Finally, if batching is not applicable, bandwidth serves as a critical estimator, constant across model variations/device type or architecture, for the expected inference performance, and you can use it to decide on the hardware you need to use. For example, NVidia RTX 4080 has 716 GB/s bandwidth, so you would expect it to run LLM inference at ~0.7x the speed of RTX 4090 - this can be different from the relative performance in other workloads such as gaming, ray tracing or inference of other types of neural networks!

# Conclusion

For problems like this where the amount of computation and memory access is known apriori, using theoretical speed of light modeling as grounding is really important, as it helps validate the quality of implementations and predict the impact of architectural changes.

Ideally, your inference implementation should carefully calculate the achieved effective bandwidth, and you should use it during profiling as the main source of guidance - as this is the value that you know the limit for! Do make sure to calculate it carefully though - `calm` had several cases where an architectural quirk made the computed bandwidth slightly incorrect :)

# Appendix: Group query attention

Mistral-7B is a very well-balanced model; in all calculations above it would almost seem as if the KV-cache is not an essential part of the cost structure. One of the reasons behind this is the comparatively short context (Mistral-7B is using windowed attention which limits the bandwidth consumed to a window of 4096 tokens), but the other, perhaps more important reason, is the use of group-query attention.

In group-query attention (with a 4x ratio), to produce 4 dot-products for the attention, instead of using 4 query vectors and computing a dot product with 4 corresponding key vectors, we take *one* key vector but 4 query vectors and perform 4 dot products. This allows us to reduce the size and the required bandwidth for the KV-cache - instead of reading each element from the KV-cache and only doing one multiply-add operation on it, we're now doing 4, which rebalanced ALU:bandwidth ratio somewhat in our favor.

This is also critical for KV-cache memory size, but that may not be apparent for such short contexts: 4096-token context takes 0.5 GiB with Mistral, but a comparable model without GQA (like Llama 7B) would "only" need 2 GiB. Let's look at a recent model that does *not* use GQA, Cohere's [Command-R](https://txt.cohere.com/command-r/).

The model itself has ~35B parameters, so at 16 bits/weight, we would need to read 70 GB of weights for each token during inference[^8]. For each token it needs to store 40 \* 128 \* 64 \* 2 = 655K elements in the KV-cache, which at 16 bits/element is 1.3 MB per token.

Thus a 4096-token context would take ~5.3 GB; that's already somewhat significant compared to ~70 GB weights. However, things get scarier if you consider that Cohere's model is advertised to have 200K token context window -- to compute the last token of the 200K context window, you would need to read 260 GB! (let's ignore the fact that you would also need 260 GB of VRAM to store it)

In a typical "production" (still single-user) setting, things shift even more. Weights would often use 4-bit quantization (~4.5 bits/weight as is often implemented), and KV-cache might use 8-bit (FP8) values. If we "conservatively" assume 100K context (half of the advertised maximum), this would get us to ~19.7 GB for model weights and ~65 GB for KV-cache, and to compute the last token we need to read all of that from memory. Suddenly attention computation is going from being insignificantly small to taking ~75% of the time, assuming both run at peak bandwidth!

While 100K context may seem a little extreme, in a multi-user context this is also a fair representation of the expected workload. Batching allows us to make matrix multiplication ALU-bound and read the model weights once per batch of values (= per 64+ user requests), but every user request would typically have its own KV-cache, so attention stays bandwidth bound - and requires a lot of memory to fit all users' requests on a single node!

If these models used 4x GQA, the size and required bandwidth for KV-cache would have been 4x smaller; while still significant for tens of thousands of tokens of context, it would have been more manageable. There might be a quality degradation associated with GQA for Cohere's intended use cases - it would be interesting to see the technical report as it may contain relevant ablation studies, but purely from the cost/performance point of view, GQA needs to be evaluated for every transformer-based LLM as the benefits are too significant to ignore.

[^1]: This post is going to omit a lot of details and not attempt to fully explain the mechanics of transformer modeling; I'm not the best person to do so and detailed articles have been written by other people.
[^2]: This is different in a prefill phase, where the model is given existing text and is asked to convert it to the internal representation, where the tradeoffs are different. Also, notably techniques like speculative execution attempt to provide some degree of parallelism by trying to use a less accurate predictor serially and then validating the guesses in parallel. Neither technique will be discussed here.
[^3]: This description omits multi-head attention and the details of "normalization" (softmax), but neither are critical for understanding the inference performance speed of light.
[^4]: These numbers are from AIDA64 table here: https://lanoc.org/review/cpus/8673-amd-ryzen-9-7950x3d; my 7950X uses slower memory so it can only sustain ~50 GB/s bandwidth.
[^5]: These numbers are taken from NVidia spec sheets; as such they represent the theoretical limits.
[^6]: Here and elsewhere GB is a decimal unit, equal to 1000^3, not GiB. All bandwidth measurements reported by manufacturers are powers of 10 even though the RAM sizes are powers of 2.
[^7]: Close, but not quite there - 100% bandwidth utilization is unfortunately very hard to get close to on NVidia GPUs for this workload. Larger GPUs like H100 are even more difficult to fully saturate; on Mixtral - this is a different architecture but it obeys the same tradeoffs for single sequence generation if you only count active parameters - calm achieves ~75% of theoretically possible performance, although large denser models like Llama 70B can get closer to the peak.
[^8]: Command-R has a large vocab (256K) and large hidden state (8192) so it spends a whopping 2B parameters on embeddings, but it reuses the same matrix for embedding and classification so we don't need to exclude this from the inference bandwidth calculation.
