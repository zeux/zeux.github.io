---
layout: post
title: Lua callstack with C++ debugger
---

Lua is a very popular scripting language in game development industry. Many games use Lua for various scripting needs (data representation, UI scripting, AI scripting), and some go as far as write the majority of the game in Lua. At CREAT, we used Lua for all of UI scripting, and for AI and other game logic on some projects. And, well, there were times when the game crashed - and the callstack consisted mainly of Lua functions.

While there are probably very few bugs in Lua library code, and the language is safe so you can't get buffer overruns or other madness only via script code, script code itself is useless, because it can't do any interaction with the outside world - user, world state, scoreboard servers, etc. So naturally there is a Lua binding for some C/C++ functions, so that scripts can call them. Now, if one of these functions crashes - for example, because they got invalid input data - how do we trace the problem back to the script code?

Assuming we don't want to modify C++/Lua code in any way, nor do we want to restart the game with tracing hook enabled - the easily reproducible bugs are often a luxury - we're left with the following methods:

1. If the external Lua debugger was attached, it's likely that we'll be able to get the callstack and the related information from it.

2. We can trick the game into calling a call stack dumping function (using lua_getstack and lua_getinfo).

3. We can get the call stack manually, by inspection of Lua data structures.

It is possible that you don't have a working Lua debugger, do not have it attached or that it does not work at the moment (oh, and the deadline was yesterday). I'm going to describe the last two approaches here.

### Use a stack dumping function

This approach is superior to the third one because you can have arbitrarily complex logic in the stack dumping function - i.e. you can print local variables along with the call stack - and it's less tedious. Just make sure your stack dumping function does not crash :) However, unless you have good debugger support for this, calling the function so that the program can work after the point can be problematic.

Anyway, at first you'll need the function itself. The trivial implementation looks like this:

```cpp
void lua_stacktrace(lua_State* L)
{
    lua_Debug entry;
    int depth = 0; 

    while (lua_getstack(L, depth, &entry))
    {
        int status = lua_getinfo(L, "Sln", &entry);
        assert(status);

        dprintf("%s(%d): %s\n", entry.short_src, entry.currentline, entry.name ? entry.name : "?");
        depth++;
    }
}
```

In order to get local variable information, you'll have to use lua_getlocal and ordinary functions for getting values from Lua stack; this is left as an exercise to the reader.

Now we have the function; you'll have to make sure that the function is linked in your executable; just reference it from some other function like this:

```cpp
volatile bool x = false;
if (x) lua_stacktrace(NULL);
```

Now you have to call the function. If you're lucky to have a debugger that can do this - for example, Microsoft Visual Studio can often do this from the Watch or Immediate windows - then just add the expression `lua_stacktrace(L)`, where `L` is the pointer to the Lua state (games often have a single Lua state, in which case I recommend you to save it to the global variable to make debugging easier).

Otherwise, you'll have to save all registers and other relevant CPU state, setup the registers/stack so that you can call the function, set the instruction pointer to the first instruction of the function, add a breakpoint to the returning instruction of the function and hit F5. The function code will execute and stop on the breakpoint; here you have to restore all registers and CPU state, restore the instruction pointer and hit F5 again.

You don't want to do that.

Seriously, it's way too complex and chances are, you'll screw something up so that the game will crash anyway. So I recommend to pick a thread you don't care about anymore, setup the necessary stuff to call the function and call it - the thread will not work anymore, but you'll have your callstack. I often used the approach to for post-mortem crash debugging, so the program is dead anyway.

Depending on the platform ABI, the relevant setup is different; for example:

* On x86, the argument is read from stack, using the esp register (esp + 4 should contain the pointer); for MSVC, add a watch `*(void**)(esp + 4)`, change the value to the lua_State pointer, get the address of the target function by adding a watch `lua_stacktrace`, go to the function in disassembly window, use "Set Next Statement" command on the first instruction, hit F5.

* On PowerPC, the argument is read from register r3; add a watch `r3`, change the value to the lua_State pointer, go to the function in the disassembly window, use "Set Next Statement" or the equivalent command of the debugger on the first instruction, hit F5.

You'll see the call stack and the game will crash, but now you have additional context for the problem and can debug the crash further. If you're using this method a lot, I suggest making a less trivial function, which is able to dump locals. Just in case, `dprintf` in the code above dumps the string to debug window (using `OutputDebugStringA`); use whatever debugging output available on your platform.

### Inspect Lua data structures

The approach with calling the function is dangerous, since it can stop or corrupt the execution flow; also it requires code execution, which may be unavailable - for example, you can't use it if you're debugging via crash dumps on some platforms. Therefore it's useful to know how Lua represents the call stack, so that you're able to get the call stack information using the safe debugger features, i.e. object state inspection.

As before, I'll assume you know the lua_State pointer; it'll be referred to as `L`.

First, we'll need to get low-level call stack information. It's stored in an array of CallInfo structures, and `L` has three pointers to it: `base_ci`, `ci`, `end_ci`. Get the stack frame count with `L->ci - L->base_ci + 1` (let's assume it's 6), then display all of them with `L->base_ci,6` (this is a special watch expression, it's supported by Microsoft debugger and PS3 debugger - debuggers for other platforms might have an equivalent feature).

Each callstack entry has two important fields: `func`, which points to a function object representing the call frame (we'll get the function and source file from it), and `savedpc`, which points to a saved program counter (we'll get the line from it).

Function object is a Lua object, which can represent either a Lua function or a C function. We can verify that the interesting entry is a function by checking that `L->base_ci[5].func->tt` equals 6 (LUA_TFUNCTION); after that we'll check the type of function with `L->base_ci[5].func->value.gc->cl.c.isC`.

If it's 1, then it is a C function; we can get the function pointer with `L->base_ci[5].func->value.gc->cl.c.f`, and that's it. This function will be in the ordinary call stack of the relevant thread; also, the top stack entry should be the C function, unless you're inspecting the state while Lua code is running inside the VM.

The previous frame in our case contains a Lua function (`L->base_ci[4].func->value.gc->cl.c.isC` is 0), so we'll get the additional information for it. The Lua function contains a pointer to the prototype, which is stored in `L->base_ci[4].func->value.gc->cl.l.p` (it contains a pointer to the `Proto` object, which is `0x00330d80` in my case - I'll use this pointer to reduce the watch expression complexity).

Now, we're close. The prototype contains the source file path, you can get it with `(char*)(&((Proto*)0x00330d80)->source->tsv + 1)`. It's a string, and in Lua string data is situated right after the string header (you can also skip the char* cast and use the `,s` watch modifier). Now all we need is line information.

Remember `savedpc` from earlier? This is a pointer which points to some instruction in `((Proto*)0x00330d80)->code` array - you can get the instruction index like this: `L->base_ci[4].savedpc - ((Proto*)0x00330d80)->code`, which is 5 in our case (if you're doing address arithmetics by hand, don't forget to divide by 4 - this is the instruction size, thankfully all instructions in Lua are 4 bytes in size). However, this is the instruction that follows the call; we actually need the previous instruction to get the point of call, so the instruction index is 4.

Now all we have to do is to get the line number from `lineinfo` array: `((Proto*)0x00330d80)->lineinfo[4]` (which is 41 in our case).

That's all - we know the source file, we know the source line - now we can repeat the process above for each call stack entry.

Some final remarks:

* Since Lua implements tail call optimization, the callstack will sometimes be unexpected - some entries will be skipped. You can check if that's the case by looking at `tailcalls` field inside CallInfo: `L->base_ci[2].tailcalls`.

* The first call stack entry (with the index 0) contains nil value; just ignore it.

* In complex cases you'll have several Lua states (multithreading, coroutines) - the process of stack unwinding is the same.

* You can get local variable values too by using CallInfo `top` field and looking at function debug metadata; this is more complicated but doable.

* If you're writing an embeddable language, please make sure that in your product, getting a call stack is at least as easy.
