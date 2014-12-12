---
layout: default
title: News
---

## Archive

<hr />
{% for post in site.posts %}
<p>
  <h3>{{ post.date | date_to_long_string }} <a href="{{ post.url }}">{{ post.title }}</a></h3>
  {{ post.excerpt }}
</p>
<hr />
{% endfor %}
