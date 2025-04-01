document.addEventListener("DOMContentLoaded", function () {
	const tooltip = document.querySelector(".footnote-tooltip");

	document.body.addEventListener("mouseover", function (e) {
		// Check if the hovered element is a footnote link
		if (e.target.matches("a.footnote") || e.target.closest("a.footnote")) {
			const ref = e.target.matches("a.footnote")
				? e.target
				: e.target.closest("a.footnote");
			const footnoteId = ref.getAttribute("href");

			// Find the target footnote content
			const footnote = document.getElementById(footnoteId.substring(1));

			if (footnote) {
				// Get the footnote content (without the back link)
				const content = footnote.querySelector("p").cloneNode(true);

				// Remove the back link from the cloned content
				const backLink = content.querySelector(".reversefootnote");
				if (backLink) {
					backLink.remove();
				}

				// Position and show the tooltip
				tooltip.innerHTML = content.innerHTML;
				tooltip.style.display = "block";

				// Position the tooltip near the footnote reference
				const refRect = ref.getBoundingClientRect();
				tooltip.style.left = `${refRect.left}px`;
				tooltip.style.top = `${refRect.bottom + window.scrollY + 5}px`;
			}
		}
	});

	document.body.addEventListener("mouseout", function (e) {
		// Check if we're leaving a footnote link
		if (e.target.matches("a.footnote") || e.target.closest("a.footnote")) {
			// Only hide if we're not entering the tooltip itself
			const relatedTarget = e.relatedTarget;
			if (!relatedTarget || !tooltip.contains(relatedTarget)) {
				tooltip.style.display = "none";
			}
		}
	});
});
