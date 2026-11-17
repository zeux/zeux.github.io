---
title: Twitter financials are confusing
---

So the Twitter drama is ongoing and the fate of the platform is uncertain. I should say I generally like Twitter - or rather the community that has formed there - and I'm personally not looking forward to the migration and fragmentation of that community. Yes, I realize the irony of writing this on cohost.org but hey long messages > 280c messages.

One issue that is pretty important to the future of Twitter as a platform is financials. The company reported a loss of 270M in Q2 2022 - I definitely don't understand the business enough to be certain about it, as in the last year and a half I learned that understanding financial statements is HARD. All of the below is likely to be completely wrong so don't take it too seriously.

I remember looking at the data at the time of $20 => $8 Twitter Blue announcement, and comparing it with revenue numbers from Q2: $1076M ad revenue and $100M subscription revenue. Twitter Blue is $5 right now, so if you exclude Apple/Google share (which seems difficult to estimate from the earnings), $20 would have meant +$300M subscription revenue, putting the company in the green even before layoffs, right?

Well, Twitter doesn't actually publish the subscriber counts in their earnings... but this data <https://twitter.com/nickstatt/status/1589802376164040704> is interesting (this comes from insider reports and while in general that type of information is not trustworthy, that's literally the only data point I could find, and insider reports to Casey Newton about Twitter have generally been true I think?).

According to the above, Twitter Blue actually only has 100K subscribers, which seems believable as Twitter Blue is a terrible value proposition right now (I'm not sure *what* the people who pay $5/mo are even paying for atm). And that reducing ads for these users by half costs $6/mo for each user, implying that the users of Twitter Blue bring Twitter ~12$/mo in terms of ad revenue.

I'm not sure if these numbers truly add up - if every Twitter user was worth $12/mo on ad revenue basis, then Twitter would have 9B ad revenue/quarter based on 250M mDAU, not 1B - but maybe Twitter Blue users are particularly engaged, which seems plausible even though we can verify none of this.

However, taking these at face value, this means that Twitter Blue quarterly revenue is just $1.5M right now (again, ignoring Apple/Google fees)[^1]. This doesn't square with the $100M/quarter in subscription revenue... but wait, the earnings report tells us, "This revenue line includes subscription revenue from the Twitter Developer Platform, Twitter Blue, and other subscription-related offerings".

This must mean that the bulk of that revenue is actually large companies paying Twitter money for access to Twitter APIs. Twitter doesn't disclose enterprise API fees, and their premium API access tier is $2500/month = $7500/quarter, so they'd need 10K developers to subscribe to get to that, which seems unlikely. That said, if enterprise fees are 10x the cost... at the very least this would mean that the "if you don't pay for Twitter Blue you're the product" is a fake narrative - you're the product either way.

If 100K subscribers is right, then assuming the number of subscribers keeps growing, there's probably some equilibrium point in terms of subscription revenue supplanting ad revenue. Which is to say, on average every Twitter user brings the company $1.4/month (based on ad revenue / mDAU), but in reality there's still some sort of curve of time spent on the platform even among folks who use it daily. Financially it doesn't make sense to get infrequent users to Blue with no ads, per report above, but if you actually grow the number of Blue converters to more meaningful numbers you can start to gradually offset the ad dependency.

As a Twitter user, I have to use alternative Twitter clients on mobile because Twitter's ads (for me) are simultaneously insanely frequent (an ad tweet every 5 tweets including threaded replies is... bad) and poor quality. I would maybe pay $8 for Blue if it removed ads completely, but it's not clear that the platform-wide conversion rate would support fully removing ads for Blue users, as that would require many more Blue subscribers to cross the ad revenue threshold. Maybe that's the point of half-ads-frequency, as once positive movement in this direction is seen, lifting all ads can become more viable economically.

Overall I don't really understand if Twitter has a plan from the user economics perspective. Being beholden to ads is pretty terrible for the state of the platform and for the users, but getting to a viable subscription plan could take a long time - the checkmark by itself feels pointless in the grand scheme of things.

[^1]: A recent data point that appeared after this post was written is <https://twitter.com/GergelyOrosz/status/1598377909944782850> which claims 400K subscribers - it's hard to know if this is related to attempted Verified launch or if the initial 100K number was way off. Still, 400K at $5/month is just $6M quarterly revenue.
