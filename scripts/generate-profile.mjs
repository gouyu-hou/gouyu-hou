#!/usr/bin/env node
// Native-markdown profile: injects merged-PR stats + a clickable repo table into README.md,
// and renders a small shields-style "merged PRs" badge as SVG. Zero dependencies, Node 18+.
//
//   GITHUB_TOKEN=xxx node scripts/generate-profile.mjs
//   node scripts/generate-profile.mjs --data cache.json      # offline: reuse a saved payload

import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

// stars + owner avatar URL per repository. The avatar URL feeds the clickable repo list
// in README.md (GitHub proxies avatars.githubusercontent.com for us).
async function loadRepoMeta(fullNames) {
  const meta = new Map();
  for (const full of fullNames) {
    try {
      const repo = await api(`/repos/${full}`);
      const stars = repo.stargazers_count ?? 0;
      const avatarUrl = (repo.owner?.avatar_url || '').replace(/\?.*/, '?v=4&s=64');
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

// Clickable repository list for README.md. Each row is a single <a> wrapping the whole
// line so clicking anywhere opens that repo's merged-PR list, with the real owner avatar.
function renderRepoTable(repos) {
  if (!repos.length) return '<p>还没有合并过 PR。</p>';
  const rows = repos.map((r) => {
    const av = r.avatarUrl
      ? `<img src="${esc(r.avatarUrl)}" width="20" height="20" align="absmiddle" alt=""/> `
      : '';
    return `<tr><td><a href="${esc(repoListUrl(r.full))}">${av}<b>${esc(r.full)}</b> &nbsp;·&nbsp; <b>${r.count} 个已合并 PR</b> &nbsp;·&nbsp; <b>★ ${fmtStars(r.stars)}</b></a></td></tr>`;
  }).join('\n');
  return `<table>\n${rows}\n</table>`;
}

function renderStats({ total, external, recent30, repos, now }) {
  const line = `共合并 **${total}** 个 PR · 来自他人仓库 **${external}** 个 · 近 30 天 **+${recent30}**`;
  const table = renderRepoTable(repos);
  const foot = `<sub>数据来源 GitHub REST API · 每天北京时间 12:00 自动刷新 · 更新于 ${fmtStamp(now)}（UTC+8）</sub>`;
  return `${line}\n\n${table}\n\n${foot}`;
}

// shields-style dynamic badge. Purple label on the left, the live count on the right.
function buildBadge(total) {
  const text = 'merged PRs';
  const value = String(total);
  const est = (s) => Math.ceil([...s].reduce((w, c) => w + (c === ' ' ? 4 : 6.4), 0));
  const labelW = est(text) + 20;
  const valueW = est(value) + 20;
  const W = labelW + valueW;
  const H = 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="merged PRs: ${value}">
<title>merged PRs: ${value}</title>
<style>
  text { font-family: Verdana, Geneva, sans-serif; font-size: 11px; font-weight: 700; }
  .lbl { fill: #ffffff; }
  .val { fill: #4c1d95; }
  .valbg { fill: #f5f3ff; }
  @media (prefers-color-scheme: dark) { .val { fill: #ddd6fe; } .valbg { fill: #1e1b4b; } }
</style>
<rect x="0" y="0" width="${W}" height="${H}" rx="4" class="valbg"/>
<path d="M0 4a4 4 0 0 1 4-4h${labelW}v${H}H4a4 4 0 0 1-4-4z" fill="#7c3aed"/>
<text class="lbl" x="${labelW / 2}" y="14" text-anchor="middle">${esc(text)}</text>
<text class="val" x="${labelW + valueW / 2}" y="14" text-anchor="middle">${value}</text>
</svg>
`;
}

async function main() {
  const items = await loadItems();
  console.log(`profile-stats: 拉取到 ${items.length} 个已合并 PR`);

  const now = nowShanghai();
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const byRepo = new Map();
  let external = 0;
  let recent30 = 0;
  for (const it of items) {
    const full = it.repository_url.split('/repos/')[1];
    if (!byRepo.has(full)) byRepo.set(full, { full, count: 0, stars: 0, avatarUrl: '' });
    byRepo.get(full).count += 1;
    if (full.split('/')[0] !== USER) external += 1;
    const mergedAt = it.pull_request?.merged_at;
    if (mergedAt && Date.parse(mergedAt) >= cutoff) recent30 += 1;
  }

  const meta = await loadRepoMeta([...byRepo.keys()]);
  for (const rec of byRepo.values()) {
    rec.stars = meta.get(rec.full)?.stars ?? 0;
    rec.avatarUrl = meta.get(rec.full)?.avatarUrl ?? '';
  }
  const repos = [...byRepo.values()].sort((a, b) => b.count - a.count || b.stars - a.stars);

  const readmePath = path.join(ROOT, 'README.md');
  const readme = await readFile(readmePath, 'utf8');
  const marker = /<!-- PROFILE-STATS:START -->[\s\S]*?<!-- PROFILE-STATS:END -->/;
  if (!marker.test(readme)) die('README.md 里缺少 <!-- PROFILE-STATS:START --> / <!-- PROFILE-STATS:END --> 标记');
  const stats = renderStats({ total: items.length, external, recent30, repos, now });
  await writeFile(readmePath, readme.replace(marker, `<!-- PROFILE-STATS:START -->\n${stats}\n<!-- PROFILE-STATS:END -->`), 'utf8');
  console.log('profile-stats: README.md 统计区已更新');

  await mkdir(path.join(ROOT, 'assets'), { recursive: true });
  await writeFile(path.join(ROOT, 'assets', 'merged-badge.svg'), buildBadge(items.length), 'utf8');
  console.log('profile-stats: 写出 assets/merged-badge.svg');
}

await main();
