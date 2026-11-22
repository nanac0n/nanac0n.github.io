#!/usr/bin/env node
/**
 * Obsidian -> blog sync.
 *
 *   node scripts/obsidian-sync.mjs            convert every note in the vault's Blog folder
 *   node scripts/obsidian-sync.mjs new "제목"  create a new draft note in the vault
 *
 * Notes with `publish: true` go to src/content/posts (committed, deployed).
 * Every other note goes to src/content/private (git-ignored, local preview only).
 * The vault stays the source of truth: generated folders carry a marker file and
 * are rewritten on every run, and removed when their note disappears. Posts
 * written by hand (no marker) are never touched.
 *
 * Set BLOG_VAULT_DIR to use a folder other than ~/darak/nanac0n/Blog.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VAULT_BLOG = process.env.BLOG_VAULT_DIR ?? path.join(os.homedir(), 'darak', 'nanac0n', 'Blog');
const VAULT_ROOT = path.resolve(VAULT_BLOG, '..', '..');
const OUT = { posts: path.join(REPO, 'src/content/posts'), private: path.join(REPO, 'src/content/private') };
const MARKER = '.from-obsidian';
const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;

// ---------- front matter ----------

function splitFrontMatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { data: {}, body: text };
  return { data: parseYaml(match[1]), body: text.slice(match[0].length) };
}

/** The small YAML subset Obsidian properties use: scalars, inline lists, dash lists. */
function parseYaml(source) {
  const data = {};
  let listKey = null;
  for (const line of source.split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      data[listKey].push(scalar(item[1]));
      continue;
    }
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!pair) continue;
    const [, key, raw] = pair;
    listKey = null;
    if (raw === '') {
      data[key] = [];
      listKey = key;
    } else if (raw.startsWith('[') && raw.endsWith(']')) {
      data[key] = raw.slice(1, -1).split(',').map((part) => scalar(part.trim())).filter((part) => part !== '');
    } else {
      data[key] = scalar(raw);
    }
  }
  for (const [key, value] of Object.entries(data)) if (Array.isArray(value) && value.length === 0 && key !== 'tags') data[key] = '';
  return data;
}

function scalar(raw) {
  const value = raw.trim();
  if (/^(['"]).*\1$/.test(value)) return value.slice(1, -1);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

const yamlString = (value) => JSON.stringify(String(value));

// ---------- helpers ----------

function slugify(name) {
  return name
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9가-힣-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function today() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
}

let attachmentIndex;
/** Find an embedded file the way Obsidian does: next to the note, then anywhere in the vault. */
function findAttachment(name, noteDir) {
  const direct = [path.resolve(noteDir, name), path.join(VAULT_ROOT, name), path.join(VAULT_ROOT, '_attachments', name)];
  for (const candidate of direct) if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  if (!attachmentIndex) {
    attachmentIndex = new Map();
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (IMAGE.test(entry.name) && !attachmentIndex.has(entry.name)) attachmentIndex.set(entry.name, full);
      }
    };
    walk(VAULT_ROOT);
  }
  return attachmentIndex.get(path.basename(name)) ?? null;
}

// ---------- body conversion ----------

function convertBody(body, note, notesByName, warnings) {
  const assets = new Map(); // source path -> file name in the post folder
  const addAsset = (target) => {
    const source = findAttachment(decodeURIComponent(target), note.dir);
    if (!source) {
      warnings.push(`${note.file}: 이미지 파일을 찾지 못했습니다: ${target}`);
      return null;
    }
    if (!assets.has(source)) {
      const ext = path.extname(source).toLowerCase();
      const base = slugify(path.basename(source, path.extname(source))) || 'image';
      let name = `${base}${ext}`;
      for (let n = 2; [...assets.values()].includes(name); n++) name = `${base}-${n}${ext}`;
      assets.set(source, name);
    }
    return assets.get(source);
  };

  let text = body.replace(/%%[\s\S]*?%%/g, ''); // Obsidian comments
  // the vault wants a "Related" section at the end of every note; the blog does not
  text = text.replace(/\n##\s*(Related|관련)\b[\s\S]*$/, '\n');
  // a leading H1 repeats the title the blog already prints
  text = text.replace(/^\s*#\s+.*\r?\n/, '');

  let inFence = false;
  const lines = text.split(/\r?\n/).map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;

    // callouts: "> [!note] Title" becomes a quote whose first paragraph is the bold title
    line = line.replace(/^(\s*>\s*)\[!(\w+)\][+-]?\s*(.*)$/, (_, quote, kind, title) => `${quote}**${title || kind[0].toUpperCase() + kind.slice(1)}**\n${quote.trimEnd()}`);

    // ![alt](local/path.png)
    line = line.replace(/!\[([^\]]*)\]\((?!https?:|data:|\/)([^)\s]+)\)/g, (whole, alt, target) => {
      if (!IMAGE.test(target)) return whole;
      const name = addAsset(target);
      return name ? `![${alt}](./${name})` : whole;
    });

    // ![[image.png]], ![[image.png|300]], ![[image.png|alt text]]
    line = line.replace(/!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (whole, target, label) => {
      if (!IMAGE.test(target)) {
        warnings.push(`${note.file}: 이미지가 아닌 임베드는 옮기지 않았습니다: ${whole}`);
        return '';
      }
      const name = addAsset(target.trim());
      const alt = label && !/^\d+(x\d+)?$/.test(label.trim()) ? label.trim() : '';
      return name ? `![${alt}](./${name})` : '';
    });

    // [[Note]] and [[Note|label]]: a link when the target is a published blog note, plain text otherwise
    line = line.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, target, label) => {
      const other = notesByName.get(target.trim());
      const shown = (label ?? target).trim();
      return other?.published ? `[${shown}](/posts/${other.slug}/)` : shown;
    });

    return line.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
  });

  return { markdown: lines.join('\n').trim() + '\n', assets };
}

// ---------- commands ----------

function readNotes() {
  if (!fs.existsSync(VAULT_BLOG)) throw new Error(`볼트의 블로그 폴더가 없습니다: ${VAULT_BLOG}`);
  const notes = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue; // _project.md and friends
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) {
        const { data, body } = splitFrontMatter(fs.readFileSync(full, 'utf8'));
        if (!('publish' in data)) continue; // only notes that opt in are blog posts
        const name = path.basename(entry.name, '.md');
        notes.push({ file: path.relative(VAULT_BLOG, full), dir, name, data, body, slug: String(data.slug || '') || slugify(name), published: data.publish === true });
      }
    }
  };
  walk(VAULT_BLOG);
  return notes;
}

function sync() {
  const notes = readNotes();
  const warnings = [];
  const errors = [];
  const notesByName = new Map(notes.map((note) => [note.name, note]));
  const seen = new Map();
  const written = { posts: new Set(), private: new Set() };

  for (const note of notes) {
    const where = note.published ? 'posts' : 'private';
    if (!note.slug) {
      errors.push(`${note.file}: 주소(slug)를 만들 수 없습니다. 머리말에 slug를 적어 주세요.`);
      continue;
    }
    if (seen.has(note.slug)) {
      errors.push(`${note.file}: slug "${note.slug}"가 ${seen.get(note.slug)}와 겹칩니다.`);
      continue;
    }
    seen.set(note.slug, note.file);
    const title = note.data.title || note.name;
    const description = note.data.description;
    const pubDate = note.data.pubDate || note.data.created;
    if (!description || !pubDate) {
      errors.push(`${note.file}: 머리말에 ${!description ? 'description' : 'created 또는 pubDate'}가 필요합니다.`);
      continue;
    }

    const dir = path.join(OUT[where], note.slug);
    if (fs.existsSync(dir) && !fs.existsSync(path.join(dir, MARKER))) {
      errors.push(`${note.file}: ${path.relative(REPO, dir)} 폴더가 이미 있고 직접 쓴 글입니다. slug를 바꿔 주세요.`);
      continue;
    }
    for (const other of Object.values(OUT)) removeGenerated(path.join(other, note.slug)); // also clears a moved draft

    const { markdown, assets } = convertBody(note.body, note, notesByName, warnings);
    const tags = (Array.isArray(note.data.tags) ? note.data.tags : []).filter((tag) => tag && tag !== 'blog');
    const front = ['---', `title: ${yamlString(title)}`, `description: ${yamlString(description)}`, `pubDate: ${pubDate}`];
    if (note.data.modified && String(note.data.modified) > String(pubDate).slice(0, 10)) front.push(`updatedDate: ${note.data.modified}`);
    front.push(`tags: [${tags.map(yamlString).join(', ')}]`, '---', '');

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, MARKER), `${note.file}\n`);
    fs.writeFileSync(path.join(dir, 'index.md'), front.join('\n') + '\n' + markdown);
    for (const [source, name] of assets) fs.copyFileSync(source, path.join(dir, name));
    written[where].add(note.slug);
  }

  // remove generated folders whose note is gone or changed slug
  for (const [where, root] of Object.entries(OUT)) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && !written[where].has(entry.name) && !errors.length) removeGenerated(path.join(root, entry.name));
    }
  }

  console.log(`공개 글 ${written.posts.size}편: ${[...written.posts].join(', ') || '없음'}`);
  console.log(`초안(로컬 미리보기 전용) ${written.private.size}편: ${[...written.private].join(', ') || '없음'}`);
  for (const warning of warnings) console.log(`주의: ${warning}`);
  for (const error of errors) console.error(`오류: ${error}`);
  if (errors.length) process.exitCode = 1;
}

/** Delete a folder only if this script created it. */
function removeGenerated(dir) {
  const inside = Object.values(OUT).some((root) => path.dirname(dir) === root);
  if (inside && fs.existsSync(path.join(dir, MARKER))) fs.rmSync(dir, { recursive: true });
}

function create(title) {
  if (!title) throw new Error('제목을 적어 주세요. 예: npm run new -- "글 제목"');
  fs.mkdirSync(VAULT_BLOG, { recursive: true });
  const file = path.join(VAULT_BLOG, `${title.replace(/[\\/:*?"<>|_]/g, ' ').replace(/\s+/g, ' ').trim()}.md`);
  if (fs.existsSync(file)) throw new Error(`같은 이름의 노트가 이미 있습니다: ${file}`);
  const date = today();
  fs.writeFileSync(
    file,
    `---
type: doc
project: Blog
title: ${yamlString(title)}
description:
status: draft
created: ${date}
modified: ${date}
tags: []
slug:
publish: false
---

## Related

- [[_project|Blog]]
`,
  );
  console.log(`새 노트를 만들었습니다: ${file}`);
}

try {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'new') create(rest.join(' ').trim());
  else sync();
} catch (error) {
  console.error(`오류: ${error.message}`);
  process.exitCode = 1;
}
