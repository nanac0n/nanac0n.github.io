# nanac0n.github.io

Personal blog built with Astro.

## Writing

1. Add a markdown file under `src/content/posts/`. The file name becomes the URL.
2. Set `title`, `description` and `pubDate` in the front matter. `tags` and `draft` are optional.
3. Posts with `draft: true` show up in the local preview only.
4. Files under `src/content/private/` are git-ignored. They show up in the local preview only and are never pushed. Move a file to `posts/` to publish it.

## Workflow

1. Run `npm run dev` and check the result at `localhost:4321`.
2. When it looks right, commit and push to `main`. GitHub Actions builds and deploys the site.
