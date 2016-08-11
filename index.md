---
layout: default
title: Home
---

> My name is Arseny Kapoulkine and this is my blog where I write about computer graphics, optimization, programming languages and related topics.
> I'm the author of <a href="http://pugixml.org">pugixml</a> and <a href="https://github.com/zeux/">other projects</a>.

{% for post in site.posts limit:5 %}
### {{ post.date | date_to_long_string }} <a href="{{ post.url }}">{{ post.title }}</a>
{{ post.excerpt }}
{% endfor %}

### [More...](/archives/)
