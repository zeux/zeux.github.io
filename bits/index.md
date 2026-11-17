---
layout: default
title: Bits
---

> Bits are short notes that can't or don't need to be full posts. Follow them [via RSS](/bits/feed/).

{% assign notes = site.bits | reverse %}
{% for note in notes limit:10 %}
### {{ note.date | date_to_long_string }} <a href="{{ note.url }}">{{ note.title }}</a>
{% assign body = note.content | split: '<div class="footnotes"' %}
{% capture href %}href="{{ note.url }}#fn:{% endcapture %}
{{ body[0] | replace: 'href="#fn:', href }}
{% endfor %}

{% if notes.size > 10 %}
### Older

<ul>
{% for note in notes offset:10 %}
  <li>{{ note.date | date:"%b %d, %Y" }} <a href="{{ note.url }}">{{ note.title }}</a></li>
{% endfor %}
</ul>
{% endif %}
