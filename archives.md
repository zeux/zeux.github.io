---
layout: default
title: Archives
---

## Archives

<ul>
  {% for post in site.posts %}

    {% unless post.next %}
      <h3>{{ post.date | date: '%Y' }}</h3>
    {% else %}
      {% capture year %}{{ post.date | date: '%Y' }}{% endcapture %}
      {% capture nyear %}{{ post.next.date | date: '%Y' }}{% endcapture %}
      {% if year != nyear %}
        <br><h3>{{ post.date | date: '%Y' }}</h3>
      {% endif %}
    {% endunless %}

    <li>{{ post.date | date:"%b %d" }} <a href="{{ post.url }}">{{ post.title }}</a></li>
  {% endfor %}
</ul>
which was shamelessly ripped off from http://blog.tracefunc.com/2009/12/04/jekyll-custom-liquid-tags/