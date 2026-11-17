---
title: All my editors are Vim, and yet none are
---

I get occasional questions about my development workflow - do I edit code in an IDE or do I use a simpler text editor, and if so, which one?

The answer to this question has been almost the same since 2009: I edit code in Vim. And yet for 3 years or so now the only command that starts Vim on my computers is `git commit`.

Let me explain. I've tried Vim in 2008 and quickly fell in love with the editor. I've used Far Manager (it's a programmer-born-in-USSR thing, don't ask) for a long time before that, so I was used to the workflow where the editor and the IDE were separate, but Vim was more powerful and efficient than editors I've used before. I quickly got into the Vim text navigation commands and macros, and they quickly became muscle memory - it's now physically difficult for me to edit code without Vim-style motions.

It's hard to do Vim's motion commands justice in a short post, but for example in code like this:

```
		T& item = table[bucket];
```

... to change `bucket` to something else, I type `f[lce`[^1]. This doesn't require using the mouse, moving the cursor one position at a time with the arrow keys, or thinking - this is all completely automatic by now.

It's also hard to know if this matters at all. Since I've used Vim editing for more than a decade, I can't edit anything complicated without Vim, so in a sense I can't reasonably compare my own typing efficiency with or without Vim.

That said, an area where Vim has consistently let me down is code navigation and project integration. I've tried a handful of projects that address this problem, and even wrote my own [Vim plugin in Vimscript](https://github.com/zeux/qgrep/tree/master/vim) which I've happily used daily for quite some time.

Unfortunately, in unfamiliar or large codebases I found that none of the solutions could beat the quality of navigation that IDEs like Visual Studio give you; in small codebases I was missing the ease of switching between projects - all plugins I've tried or made for this required custom and slightly cumbersome setup that was fine for something you work on daily, but took too much time when you just wanted to make a quick fix in a random GitHub project.

Over the years, I've alternated between actual Vim and Vi emulation plugins. In fact, after learning Vim in 2008, I switched to Visual Studio with ViEmu plugin that did a reasonable job of emulating Vim key bindings and editing modes. Since then I've switched to VsVim for more modern versions of Visual Studio; when I've used Xcode I used XVim[^2]; and when using Sublime Text, I've used Vintageous and then switched to NeoVintageous. Sometimes I would spend a year or two mostly using real Vim and then switch to an IDE for a couple years.

For the last few years, I've used Sublime Text as my primary editor where I spend 90% of the time writing code in, with occasional uses of Visual Studio (mostly when I'm in a tight edit-debug cycle which happens rarely these days, or when I'm in a very unfamiliar and complex codebase where builtin code navigation that Sublime Text provides is insufficient). Per above, in all the editors I use I have a Vim plugin installed.

The quality of Vim emulation, unfortunately, varies pretty significantly - Visual Studio's VsVim is most excellent and covers my expectations from a Vim mode pretty much perfectly, whereas Sublime's NeoVintageous still has significant gaps, mostly around macro usage, which gets in the way sometimes.

Curiously, I mostly use builtin code navigation in Sublime Text which is fairly rudimentary - instead of relying on something like `clangd` for precise queries, it uses an index built by building data for syntax highlighting using TextMate-style grammar, and allows to navigate using that index. This is somewhere between a full language-specific index built on top of AST with semantical analysis, that clang-based LSPs provide, and a full-text search like grep/qgrep.

This is reasonably close to `ctags` that Vim supports and so seems like something that Vim should be able to do with a plugin, and yet the fact that in Sublime this is available out of the box and works fairly well without me having to manage `ctags` files or find a `ctags` plugin makes it so that I didn't feel the need to explore alternatives.

In fact, perhaps more important than the editor power for me is having the editor work out of the box these days. I change systems a decent amount and work on a lot of different projects at the same time, so doing substantial amount of setup per project or per system is not something I'd want to start doing even if it improves my workflow - unless the improvement is quite dramatic, which, between Sublime Text and occasional Visual Studio use, I didn't feel the need for.

One popular editor that is very obviously absent from the list above is Visual Studio Code. It is being very actively developed to this day, has lots of easily available extensions (with the quality of extension ecosystem generally being substantially better compared to Vim or Sublime), so why not?

Every time I've tried VS Code in the past, the editor felt obviously sluggish to me - compared to the responsiveness around basic typing and more complex actions that I've come to expect after using Sublime Text and Vim a lot, typing in VS Code just always felt uncomfortable. This is something that I reevaluate every few years, and it's something that slowly gets better with hardware and software improvements - I remember VS Code being completely unusable for me on a battery-powered Surface Pro 7, which is about the last time I've seriously tried it, so I'll probably try it again!

One thing is for certain though: you can pry my Vim keybindings out of my cold dead hands.

[^1]: There's some other ways to do this that may be more efficient; also, I actually use arrows instead of `hjkl` to this day because I find them more universal, and that way I am at least barely functional in non-Vim editors.
[^2]: Xcode's extensibility story was so bad that every Xcode upgrade would break XVim, but it was still worth it for the time I've used macOS. It looks like things got a little better with XVim2 but it still doesn't appear to work with Xcode 14 - fortunately, I don't use Xcode anymore!
