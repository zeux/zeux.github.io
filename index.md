---
layout: default
title: Home
---

> My name is Arseny Kapoulkine and this is my blog where I write about computer graphics, optimization, programming languages and related topics.
> I'm the author of [pugixml](https://pugixml.org), [meshoptimizer](https://github.com/zeux/meshoptimizer) and [other projects](https://github.com/zeux/).

{% for post in site.posts limit:5 %}
### {{ post.date | date_to_long_string }} <a href="{{ post.url }}">{{ post.title }}</a>
{{ post.excerpt }}
{% endfor %}

### [More...](/archives/)
