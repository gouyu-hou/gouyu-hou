#!/usr/bin/env node
// Profile README generator — native markdown / HTML (shi-felix style), no SVG cards.
//   - The hero (name · tagline · intro) lives directly in README.md as markdown.
//   - The stats section is a bold summary line ("**N** 个 PR 已被合并，分布在 **M** 个
//     上游仓库") plus a markdown table (avatar · repo · merged-PR count · stars), each
//     repo name linking to that repo's merged-PR list.
//   - Runs every day at 12:00 Beijing time via GitHub Actions; repos are sorted by
//     merged-PR count descending (tie-break by stars).
// Zero dependencies, Node 18+.
//
//   GITHUB_TOKEN=xxx node scripts/generate-profile.mjs
//   node scripts/generate-profile.mjs --data cache.json      # offline: reuse a saved payload

import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const USER = process.env.PROFILE_USER || 'gouyu-hou';
const ROOT = process.cwd();
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

const args = process.argv.slice(2);
const dataArgIndex = args.indexOf('--data');
const DATA_FILE = dataArgIndex >= 0 ? args[dataArgIndex + 1] : null;

function die(msg) {
  console.error(`profile-stats: ${msg}`);
  process.exit(1);
}

async function api(target) {
  const res = await fetch(`https://api.github.com${target}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      'User-Agent': 'gouyu-hou-profile-stats',
    },
  });
  if (!res.ok) die(`${target} -> HTTP ${res.status} ${await res.text().catch(() => '')}`);
  return res.json();
}

async function loadItems() {
  if (DATA_FILE) {
    const raw = await readFile(path.resolve(ROOT, DATA_FILE), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : parsed.items ?? [];
  }
  const q = encodeURIComponent(`type:pr author:${USER} is:merged`);
  const items = [];
  for (let page = 1; page <= 10; page += 1) {
    const data = await api(`/search/issues?q=${q}&sort=updated&order=desc&per_page=100&page=${page}`);
    items.push(...data.items);
    if (data.items.length < 100) break;
  }
  return items;
}

// stars + owner avatar URL per repository. The avatar is referenced directly
// (avatars.githubusercontent.com is on GitHub's README allowlist), so no base64
// inlining is needed now that the rows are plain HTML rather than self-contained SVG.
async function loadRepoMeta(fullNames) {
  const meta = new Map();
  for (const full of fullNames) {
    try {
      const repo = await api(`/repos/${full}`);
      const stars = repo.stargazers_count ?? 0;
      const avatarUrl = (repo.owner?.avatar_url || '').replace(/\?.*/, '?v=4&s=40');
      meta.set(full, { stars, avatarUrl });
    } catch {
      meta.set(full, { stars: 0, avatarUrl: '' });
    }
  }
  return meta;
}

function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtStars(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function nowShanghai() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}

function fmtStamp(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function repoListUrl(full) {
  return `https://github.com/${full}/pulls?q=${encodeURIComponent(`is:pr author:${USER} is:merged`)}`;
}

// Native markdown stats section: bold summary + a table of repositories.
function renderStats({ total, repos, now }) {
  if (!repos.length) {
    return `<p>还没有合并过 PR。</p>\n\n<sub>数据来源 GitHub REST API · 每天北京时间 12:00 自动刷新 · 更新于 ${fmtStamp(now)}（UTC+8）</sub>`;
  }
  const head = `**${total}** 个 PR 已被合并，分布在 **${repos.length}** 个上游仓库`;
  const thead = `| 仓库 | 已合并 PR | Stars |\n| :--- | :---: | :---: |`;
  const rows = repos.map((r) => {
    const avatar = r.avatarUrl ? `<img src="${esc(r.avatarUrl)}" width="20" height="20" /> ` : '';
    return `| ${avatar}[${esc(r.full)}](${esc(repoListUrl(r.full))}) | ${r.count} | ⭐ ${fmtStars(r.stars)} |`;
  });
  const foot = `<sub>数据来源 GitHub REST API · 每天北京时间 12:00 自动刷新 · 更新于 ${fmtStamp(now)}（UTC+8）</sub>`;
  return `${head}\n\n${thead}\n${rows.join('\n')}\n\n${foot}`;
}

async function main() {
  const items = await loadItems();
  console.log(`profile-stats: 拉取到 ${items.length} 个已合并 PR`);

  const now = nowShanghai();

  const byRepo = new Map();
  for (const it of items) {
    const full = it.repository_url.split('/repos/')[1];
    if (!byRepo.has(full)) byRepo.set(full, { full, count: 0, stars: 0, avatarUrl: '' });
    byRepo.get(full).count += 1;
  }

  const meta = await loadRepoMeta([...byRepo.keys()]);
  for (const rec of byRepo.values()) {
    rec.stars = meta.get(rec.full)?.stars ?? 0;
    rec.avatarUrl = meta.get(rec.full)?.avatarUrl ?? '';
  }
  // 按已合并 PR 个数降序排列；个数相同时按 star 数降序，保证顺序稳定。
  const repos = [...byRepo.values()].sort((a, b) => b.count - a.count || b.stars - a.stars);

  // 清理旧版 SVG 卡片（stats-card.svg / repo-*.svg），已改为 README 原生 markdown 表格。
  const assetsDir = path.join(ROOT, 'assets');
  await mkdir(assetsDir, { recursive: true });
  for (const f of await readdir(assetsDir).catch(() => [])) {
    if (/^(stats-card|repo-\d+)\.svg$/.test(f)) await unlink(path.join(assetsDir, f)).catch(() => {});
  }

  const readmePath = path.join(ROOT, 'README.md');
  const readme = await readFile(readmePath, 'utf8');
  const marker = /<!-- PROFILE-STATS:START -->[\s\S]*?<!-- PROFILE-STATS:END -->/;
  if (!marker.test(readme)) die('README.md 里缺少 <!-- PROFILE-STATS:START --> / <!-- PROFILE-STATS:END --> 标记');
  const stats = renderStats({ total: items.length, repos, now });
  await writeFile(readmePath, readme.replace(marker, `<!-- PROFILE-STATS:START -->\n${stats}\n<!-- PROFILE-STATS:END -->`), 'utf8');
  console.log('profile-stats: README.md 统计区已更新');
}

await main();
