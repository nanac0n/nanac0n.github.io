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

## Writing in Obsidian

Posts can be written in an Obsidian vault and converted into this repo.

1. `npm run new -- "Title"` creates a draft note in the vault's Blog folder.
2. `npm run sync` converts every note there: `publish: true` notes go to `src/content/posts`, the rest to the git-ignored `src/content/private`.
3. Obsidian embeds, wikilinks, callouts and highlights are rewritten to plain markdown, and embedded images are copied next to the post.
4. Folders the script generates carry a `.from-obsidian` marker. They are rewritten on every sync and removed when the note is gone. Posts without the marker are never touched.

The vault folder defaults to `~/darak/nanac0n/Blog`; set `BLOG_VAULT_DIR` to change it.
