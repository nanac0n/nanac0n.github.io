import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'> | CollectionEntry<'private'>;

/**
 * Posts, newest first. A production build contains published posts only;
 * drafts and everything in src/content/private show up in `astro dev` alone.
 */
export async function getPosts(): Promise<Post[]> {
  const published = await getCollection('posts', ({ data }) => import.meta.env.DEV || !data.draft);
  const local = import.meta.env.DEV ? await getCollection('private') : [];
  return [...published, ...local].sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
  );
}

export function isPrivate(post: Post) {
  return post.collection === 'private';
}

// Dates are always shown in Korea time so local previews and CI builds agree.
const dateFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' });

/** `2026-11-22` */
export function isoDate(date: Date) {
  return dateFormatter.format(date);
}

/** Tags with post counts, most used first. Tags sharing a slug (AWS, aws) are merged. */
export function countTags(posts: Post[]) {
  const tags = new Map<string, { label: string; count: number }>();
  for (const post of posts) {
    for (const slug of new Set(post.data.tags.map(tagSlug).filter(Boolean))) {
      const label = post.data.tags.find((tag) => tagSlug(tag) === slug)!;
      const entry = tags.get(slug) ?? { label, count: 0 };
      entry.count += 1;
      tags.set(slug, entry);
    }
  }
  return [...tags]
    .map(([slug, entry]) => ({ slug, ...entry }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ko'));
}

/** URL-safe tag key: `CI/CD` -> `ci-cd`, `C#` -> `c-sharp`. */
export function tagSlug(tag: string) {
  return tag
    .trim()
    .toLowerCase()
    .replaceAll('#', '-sharp')
    .replaceAll('+', '-plus')
    .replace(/[\s/\\?%&.:]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
