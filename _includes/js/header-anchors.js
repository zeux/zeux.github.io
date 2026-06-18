// Add a clickable paragraph-mark link next to every header that has an id
// (kramdown auto-generates the ids), so headers can be linked/copied easily.
document.querySelectorAll('.post h1[id], .post h2[id], .post h3[id]').forEach(function (h) {
  var a = document.createElement('a');
  a.className = 'header-anchor';
  a.href = '#' + h.id;
  a.textContent = '§';
  h.appendChild(a);
});
