---
layout: post
title: Unlearning metrics and algorithms
excerpt_separator: <!--more-->
---

The first somewhat social platform that I've used was LiveJournal; I used it around 2004-2010. Back then, we had posts and comments, but one of the notable features of the platform was the uni-directional friend relationships. The number of people who befriended you was somewhat of a status symbol, with a special term "тысячник" (a person with 1000+ reverse friend connections) used to denote Popular People.

That said, my recollection is that people mostly wrote what was fun or interesting for them to write about. Your friend feed contained a chronological display of whatever your friends posted - no ads, no algorithms.

<!--more-->

> This post is different than usual, and it was originally written in late 2022 and published on Cohost. Back then, I was excited about Cohost's future and planned to use it as a micro-blogging platform, reserving this blog for long, very technical and carefully written posts.
>
> In the middle of 2023, following a [Financial Update](https://cohost.org/staff/post/1690393-h1-2023-financial-up) post, I realized Cohost will not survive much longer, and had to change the plans. As a result, most of the prior Cohost content has already been reposted on this blog; one more small technical post will be posted in the coming weeks. I wanted to repost this here, today, even if it doesn't follow the typical theme of this blog - because, today Cohost team [announced it will shut down imminently](https://cohost.org/staff/post/7611443-cohost-to-shut-down). This post seemed relevant, and it's the only remaining non-technical post that I'd like to keep for posterity.
>
> As noted before, I will try to write more short posts on this blog in the future, although they will likely be technical in nature.

At some point LiveJournal faded into irrelevance and Twitter was the hot new thing. Twitter started as a similarly simple platform - you had follow counts, and replies to tweets, but additional measures quickly entered the picture - these days, your tweet can be replied to, but the "engagement" indicators include retweets and likes. I've been meaning to write about this for a couple weeks now, and since then Twitter started also showing tweet view counts - yet another number that's right in your face next to every tweet.

Once every tweet carries a set of visible engagement metrics next to it, it's natural to start thinking about them. Am I reaching my audience? Was this a good tweet? How do I make my messaging more interesting?

Of course what also starts happening is that these - and other - engagement signals are used by the platform to form the content that people see. Long gone are the days of chronological timelines - Twitter still supports a linear view, but very aggressively selects an algorithmic timeline which is a setting that is stored per device/session. The algorithm takes visible cues, such as retweet/like numbers and progression, as well as less visible or documented cues - for example Twitter reportedly artificially reduces the reach of tweets that contain links, which makes it more difficult to share external content on Twitter.

This is a vicious cycle. Global factors like follow count are now not very meaningful - my account has 12K followers on Twitter (some of them bots), and yet some of my tweets get closer to 2K impressions[^1]. By itself it shouldn't matter as much but when it results in lower tweet signals, you start to wonder - am I doing something wrong? Should I not post this tweet because people aren't going to engage with it? Should I post controversial or outrageous takes because that's what generates buzz?

There's really no rational reason for having these metrics drive the content, lacking an actual numeric (monetary) incentive - it shouldn't make a difference whether 10 or 1000 people liked my tweet, and yet the number is right there, prominent, tantalizing, and the satisfaction of using the platform seems way too closely related to how high the numbers go.

What's worse, for me at least this shifted the thinking about conversation. If my reply gets 100x less visibility than a tweet, should I even bother replying? Replies have smaller numbers so they're less satisfactory and thus less valuable, or so the twisted thinking goes. Replying to Important People is numerically much more engaging than holding a profoundly interesting conversation - not a good outcome!

It's because of all of this that I'm happy to see smaller, simpler, newer platforms.

Cohost doesn't show you a single number as far as I can tell. I don't even know how many people follow me, and while I could probably find out if I tried hard enough - it doesn't matter. What matters is the quality of the content I write, and the quality of the conversations in the comments.

Mastodon does show you a bunch of numbers, but the feed is chronological... and in fact, both the web client on [mastodon.gamedev.place](https://mastodon.gamedev.place/) and Ivory, the iOS client I use, by default hide the boost and favorite numbers - which is a setting I'm happy to keep in its default, sane, position! As such the focus seems to be much more so on a discussion - and indeed, while it seems like the size of the user base is drastically smaller than Twitter's, and my follower count is 10x smaller than it used to be, it feels like there's a similar amount of interesting conversations that I actually want to read or engage in, at least in my field.

It's still hard to not think about numbers that represent reach - in other networks like GitHub I still use the number of forks and stars to judge how popular a given repository is[^2]. I still look at view counts on my YouTube videos to try to figure out what content I should publish and whether the whole video thing is worthwhile to begin with. That said, I'm trying to break away from caring about metrics and focus on content and discussion quality - numbers be damned.

[^1]: By itself this could just be a difference between total Twitter accounts and monthly active Twitter accounts, as opposed to an algorithmic bias - something that's difficult to estimate.
[^2]: And this is probably not terribly healthy either; fork count in particular is now a measure of nothing useful as a lot of people seem to have a habit of forking a repository without an intend to change the fork in any way.
