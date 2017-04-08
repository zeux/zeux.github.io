site:
	bundle exec jekyll serve

images:
	ls images/*.png | xargs -n 1 pngcrush -ow -s
	jpegoptim -m90 -T1 --all-progressive images/*.jpg
	
.PHONY: site images
