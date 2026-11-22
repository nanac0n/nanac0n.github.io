import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const schema = z.object({
  title: z.string(),
  description: z.string(),
  pubDate: z.coerce.date(),
  updatedDate: z.coerce.date().optional(),
  tags: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
});

const posts = defineCollection({
  loader: glob({ base: './src/content/posts', pattern: '**/*.{md,mdx}' }),
  schema,
});

// Git-ignored folder. Its posts appear in `astro dev` only and are never built or pushed.
const privatePosts = defineCollection({
  loader: glob({ base: './src/content/private', pattern: '**/*.{md,mdx}' }),
  schema,
});

export const collections = { posts, private: privatePosts };
