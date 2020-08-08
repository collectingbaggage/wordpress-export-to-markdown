const chalk = require('chalk');
const fs = require('fs');
const luxon = require('luxon');
const xml2js = require('xml2js');

const shared = require('./shared');
const translator = require('./translator');

async function parseFilePromise(config) {
	console.log('\nParsing...');
	const content = await fs.promises.readFile(config.input, 'utf8');
	const data = await xml2js.parseStringPromise(content, {
		trim: true,
		tagNameProcessors: [xml2js.processors.stripPrefix]
	});

	const posts = collectPosts(data, config);

	const images = [];
	if (config.saveAttachedImages) {
		images.push(...collectAttachedImages(data));
	}
	if (config.saveScrapedImages) {
		images.push(...collectScrapedImages(data));
	}
  mergeImagesIntoPosts(images, posts);

  const galleries = [];
  galleries.push(...collectFooGalleries(data));
  // galleries.push(...collectGalleries(data));
  mergeGalleriesIntoPosts(galleries, images, posts);
	
	return posts;
}

function getItemsOfType(data, type) {
	return data.rss.channel[0].item.filter(item => item.post_type[0] === type);
}

function getMetaValue(post, key) {
  const postmeta = post.postmeta.find(postmeta => postmeta.meta_key[0] === key);
  return postmeta ? postmeta.meta_value[0] : undefined;
}

function collectPosts(data, config) {
	// this is passed into getPostContent() for the markdown conversion
	const turndownService = translator.initTurndownService();

	let posts = []
  getItemsOfType(data, 'post')
		.filter(post => post.status[0] !== 'trash' && post.status[0] !== 'draft')
		.forEach(post => {
      const postNL = {
  			// meta data isn't written to file, but is used to help with other things
  			meta: {
  				id: getPostId(post),
          exportPath: getPostSlug(post),
  				coverImageId: getPostCoverImageId(post),
  				imageUrls: [],
          language: 'nl'
  			},
  			frontmatter: {
  				title: getPostTitle(post),
          slug: getPostSlug(post),
  				date: getPostDate(post),
          author: getAuthor(post),
          tags: getTags(post),
          description: getExcerpt(post),
          language: 'nl'
  			},
  			content: translator.getPostContent(post, turndownService, config)
  		};

      const postDE = {
        // meta data isn't written to file, but is used to help with other things
        meta: {
          id: getPostId(post),
          exportPath: getPostSlug(post),
          coverImageId: getPostCoverImageId(post),
          imageUrls: [],
          language: 'de'
        },
        frontmatter: {
          title: getPostTitleDe(post),
          slug: getPostSlugDe(post),
          date: getPostDate(post),
          author: getAuthor(post),
          tags: getTags(post),
          description: getExcerptDe(post),
          language: 'de'
        },
        content: translator.getPostContentDe(post, turndownService, config)
      };

      postNL.frontmatter.translations = [{
        link: "/" + postDE.frontmatter.slug,
        hreflang: postDE.meta.language,
        language: "Deutsch"
      }];

      postDE.frontmatter.translations = [{
        link: "/" + postNL.frontmatter.slug,
        hreflang: postNL.meta.language,
        language: "Nederlands"
      }];

      posts.push(postNL);
      posts.push(postDE);
    });

	console.log(posts.length + ' posts found.');
	return posts;
}

function getPostId(post) {
	return post.post_id[0];
}

function getAuthor(post) {
  const author = post.creator[0];
  return author.charAt(0).toUpperCase() + author.slice(1);
}

function getPostSlug(post) {
	return post.post_name[0];
}

function getPostSlugDe(post) {
  return getMetaValue(post, '_de_post_name');
}

function getPostCoverImageId(post) {
	if (post.postmeta === undefined) {
		return undefined;
	}

	const postmeta = post.postmeta.find(postmeta => postmeta.meta_key[0] === '_thumbnail_id');
	const id = postmeta ? postmeta.meta_value[0] : undefined;
	return id;
}

function getPostTitle(post) {
	return post.title[0];
}

function getPostTitleDe(post) {
  return getMetaValue(post, '_de_post_title');
}

function getPostDate(post) {
	return luxon.DateTime.fromRFC2822(post.pubDate[0], { zone: 'utc' }).toISODate();
}

function getTags(post) {
  return post.category.map(tag => tag.$.nicename)
}

function getExcerpt(post) {
  if (post.encoded[1]) {
    return post.encoded[1];
  }
  const more = post.encoded[0].indexOf("<!--more-->");
  if (more !== -1) {
    return post.encoded[0].slice(0, more).trim();
  }
  return "";
}

function getExcerptDe(post) {
  const excerpt = getMetaValue(post, '_de_post_excerpt');
  if (excerpt) {
    return excerpt;
  }
  const contentDe = getMetaValue(post, '_de_post_content');
  const more = contentDe.indexOf("<!--more-->");
  if (more !== -1) {
    return contentDe.slice(0, more).trim();
  }
  return "";
}

function collectAttachedImages(data) {
	const images = getItemsOfType(data, 'attachment')
		// filter to certain image file types
		.filter(attachment => (/\.(gif|jpe?g|png)$/i).test(attachment.attachment_url[0]))
		.map(attachment => ({
			id: attachment.post_id[0],
			postId: attachment.post_parent[0],
			url: attachment.attachment_url[0]
		}));

	console.log(images.length + ' attached images found.');
	return images;
}

function parseFooGalleryAttachments(item) {
  // a:3:{i:0;s:3:"255";i:1;s:3:"254";i:2;s:3:"253";}
  const value = getMetaValue(item, 'foogallery_attachments');
  const matches = [...value.matchAll(/(?<=")(\d+)(?=")/g)];
  const ids = matches.map(match => match[0]);
  return ids;
}

function collectFooGalleries(data) {
  const images = getItemsOfType(data, 'foogallery')
    .map(gallery => ({
      id: gallery.post_id[0],
      title: gallery.title,
      attachmentIds: parseFooGalleryAttachments(gallery)
    }));

  console.log(images.length + ' FooGalleries found.');
  return images;
}

function collectScrapedImages(data) {
	const images = [];
	getItemsOfType(data, 'post').forEach(post => {
		const postId = post.post_id[0];
		const postContent = post.encoded[0];
		const postLink = post.link[0];

		const matches = [...postContent.matchAll(/<img[^>]*src="(.+?\.(?:gif|jpe?g|png))"[^>]*>/gi)];
		matches.forEach(match => {
			// base the matched image URL relative to the post URL
			const url = new URL(match[1], postLink).href;

			images.push({
				id: -1,
				postId: postId,
				url: url
			});
		});

    const galleryMatches = [...postContent.matchAll()];
	});

	console.log(images.length + ' images scraped from post body content.');
	return images;
}

function mergeImagesIntoPosts(images, posts) {
	// create lookup table for quicker traversal
	const postsLookup = posts.reduce((lookup, post) => {
		lookup[post.meta.id] = post;
		return lookup;
	}, {});

	images.forEach(image => {
		const post = postsLookup[image.postId];
		if (post) {
			if (image.id === post.meta.coverImageId) {
				// save cover image filename to frontmatter
				post.frontmatter.cover = './images/' + shared.getFilenameFromUrl(image.url);
			}
			
			// save (unique) full image URLs for downloading later
			if (!post.meta.imageUrls.includes(image.url)) {
				post.meta.imageUrls.push(image.url);
			}
		}
	});
}

function mergeGalleriesIntoPosts(galleries, images, posts) {
  // create lookup table for quicker traversal
  const galleryLookup = galleries.reduce((lookup, gallery) => {
    lookup[gallery.id] = gallery;
    return lookup;
  }, {});

  const imageLookup = images.reduce((lookup, image) => {
    lookup[image.id] = image;
    return lookup;
  }, {});

  posts.forEach(post => {
    // find all foogalleries in this post
    const fooMatches = [...post.content.matchAll(/(?<=\\\[foogallery id=")(\d+)(?="\\\])/gi)];
    const fooGalleryIds = fooMatches.map(match => match[0]);

    fooGalleryIds.forEach(galleryId => {
      const gallery = galleryLookup[galleryId];
      if (gallery) {
        let imgTags = [];
        gallery.attachmentIds.forEach(imageId => {
          const image = imageLookup[imageId];
          if (!image) {
            console.log(chalk.red('[FAILED]') + ' Could not find image with id: ' + imageId);
            return;
          }
          // save (unique) full image URLs for downloading later
          if (!post.meta.imageUrls.includes(image.url)) {
            post.meta.imageUrls.push(image.url);
          }

          // replace gallery by image tags
          //  gallery: [foogallery id="355"]
          //  tags: ![](images/filename.jpg)
          imgTags.push("![](images/" + shared.getFilenameFromUrl(image.url) + ")");
        });
        const searchString = "\\[foogallery id=\"" + galleryId + "\"\\]";
        post.content = post.content.replace(searchString, imgTags.join("\n"))
      }
    });

    const galleryMatches = [...post.content.matchAll(/\\\[gallery.+(?:ids=")((?:\d+,?)+)(?:")\\\]/gi)];
    galleryMatches.forEach(match => {
      const imageIds = match[1].split(",");
      let imgTags = [];
      imageIds.forEach(imageId => {
        const image = imageLookup[imageId];
          // save (unique) full image URLs for downloading later
          if (!post.meta.imageUrls.includes(image.url)) {
            post.meta.imageUrls.push(image.url);
          }

          // replace gallery by image tags
          //  gallery: [gallery columns="4" ids="301,302"]
          //  tags: ![](images/filename.jpg)
          imgTags.push("![](images/" + shared.getFilenameFromUrl(image.url) + ")");
      });
      post.content = post.content.replace(match[0], imgTags.join("\n"));
    });
  })
}

exports.parseFilePromise = parseFilePromise;
