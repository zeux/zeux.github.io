---
layout: default
title: Home
---

{% for post in site.posts limit:3 %}
### {{ post.date | date_to_long_string }} <a href="{{ post.url }}">{{ post.title }}</a>
{{ post.excerpt }}
{% endfor %}