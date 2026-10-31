#!/usr/bin/env node
// Generates assets/merged-prs.svg and refreshes the recent-PR list inside README.md.
// Zero dependencies. Needs Node 18+ (uses global fetch).
//
//   GITHUB_TOKEN=xxx node scripts/generate-profile.mjs
//   node scripts/generate-profile.mjs --data cache.json      # offline: reuse a saved payload
//
// Any argument starting with --data skips the network entirely, which is handy when a
// sandbox or corporate proxy blocks api.github.com but `gh` still works:
//   gh api "search/issues?q=type:pr+author:gouyu-hou+is:merged&per_page=100" > assets/raw.json
//   node scripts/generate-profile.mjs --data assets/raw.json

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const USER = process.env.PROFILE_USER || process.env.USERNAME || 'gouyu-hou';
const ROOT = process.cwd();
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const MAX_ROWS = 6;
const MAX_RECENT = 5;

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

async function loadStars(fullNames) {
  const stars = new Map();
  for (const full of fullNames) {
    try {
      const repo = await api(`/repos/${full}`);
      stars.set(full, repo.stargazers_count ?? 0);
    } catch {
      stars.set(full, 0);
    }
  }
  return stars;
}

// Rough advance width for 13px text: CJK/full-width glyphs are about 12px, latin digits ~7px.
function textWidth(text, size) {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    const wide = code >= 0x1100 && (code <= 0x115f || code === 0x2329 || code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6));
    w += wide ? size * 0.92 : size * 0.55;
  }
  return w;
}

function truncate(text, size, maxPx) {
  if (textWidth(text, size) <= maxPx) return text;
  let out = text;
  while (out.length > 1 && textWidth(`${out}...`, size) > maxPx) out = out.slice(0, -1);
  return `${out}...`;
}

function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtStars(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// Always render the stamp in UTC+8 regardless of where the runner sits (Actions runners are UTC).
function nowShanghai() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}

function fmtDate(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

const W = 620;
const PAD = 24;
const ROW_H = 30;
const FONT = 'ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif';

function buildSvg(rows, total, external, recent30, totalRepos, now) {
  const headBottom = 104;
  const listTop = headBottom + 22;
  const hasMore = totalRepos > rows.length;
  const listBottom = listTop + rows.length * ROW_H + (rows.length ? 6 : 26) + (hasMore ? 24 : 0);
  const H = listBottom + 34;

  const rowY = (i) => listTop + 14 + i * ROW_H;
  const nameMax = W - PAD * 2 - 190;
  const colCount = W - PAD - 110;
  const colStars = W - PAD;

  const rowNodes = rows.length
    ? rows
        .map((r, i) => {
          const y = rowY(i);
          const name = esc(truncate(r.full, 13, nameMax));
          const prs = `${r.count}`;
          const stars = fmtStars(r.stars);
          const starText = stars === '0' ? '-' : stars;
          return [
            `<g class="row">`,
            `<rect class="rowbg" x="${PAD - 8}" y="${y - 15}" width="${W - (PAD - 8) * 2}" height="${ROW_H - 4}" rx="6"/>`,
            `<text class="name" x="${PAD}" y="${y}" dominant-baseline="central">${name}</text>`,
            `<text class="count" x="${colCount}" y="${y}" text-anchor="end" dominant-baseline="central">${prs}</text>`,
            `<text class="count" x="${colStars}" y="${y}" text-anchor="end" dominant-baseline="central">${starText}</text>`,
            `</g>`,
          ].join('');
        })
        .join('')
    : `<text class="muted" x="${PAD}" y="${listTop + 8}" dominant-baseline="central">还没有合并过 PR</text>`;

  const moreRow = hasMore
      ? `<text class="muted" x="${PAD}" y="${rowY(rows.length)}" dominant-baseline="central">...还有 ${totalRepos - rows.length} 个仓库有合并 PR</text>`
      : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`已合并 ${total} 个 PR，分布在 ${totalRepos} 个仓库`)}">
<title>已合并的 Pull Requests</title>
<desc>${esc(`总共 ${total} 个已合并 PR，其中 ${external} 个提给他人仓库，近 30 天新增 ${recent30} 个。`)}</desc>
<style>
  text { font-family: ${FONT}; }
  .card { fill: var(--bgc, #ffffff); stroke: var(--bc, #d0d7de); stroke-width: 1; }
  .title { fill: var(--tc, #59636e); font-size: 11px; font-weight: 500; letter-spacing: 0.12em; }
  .big { fill: var(--accent, #0969da); font-size: 26px; font-weight: 500; }
  .unit { fill: var(--fc, #1f2328); font-size: 15px; font-weight: 500; }
  .sub { fill: var(--tc, #59636e); font-size: 12px; }
  .name { fill: var(--fc, #1f2328); font-size: 13px; }
  .count { fill: var(--fc, #1f2328); font-size: 13px; font-weight: 500; }
  .muted { fill: var(--tc, #59636e); font-size: 12px; }
  .foot { fill: var(--tc, #59636e); font-size: 10px; }
  .rowbg { fill: var(--rowbg, transparent); }
  .ico { fill: var(--tc, #59636e); }
  @media (prefers-color-scheme: dark) {
    svg { --bgc: #0d1117; --bc: #30363d; --fc: #e6edf3; --tc: #9198a1; --accent: #58a6ff; --rowbg: rgba(255,255,255,0.04); }
  }
</style>
<rect class="card" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12"/>
<text class="title" x="${PAD}" y="30" dominant-baseline="central">MERGED PULL REQUESTS</text>
<text class="big" x="${PAD}" y="60" dominant-baseline="central">${total}</text>
<text class="unit" x="${PAD + textWidth(String(total), 26) + 8}" y="60" dominant-baseline="central">个 PR 已合并</text>
<text class="sub" x="${PAD}" y="82" dominant-baseline="central">${external} 个提给他人仓库 · 近 30 天 +${recent30}</text>
<line x1="${PAD}" y1="${headBottom}" x2="${W - PAD}" y2="${headBottom}" stroke="#d0d7de" stroke-opacity="0.5" stroke-width="1"/>
<text class="title" x="${PAD}" y="${headBottom + 12}" dominant-baseline="central">仓库</text>
<text class="title" x="${colCount}" y="${headBottom + 12}" text-anchor="end" dominant-baseline="central">已合并</text>
<text class="title" x="${colStars}" y="${headBottom + 12}" text-anchor="end" dominant-baseline="central">星标</text>
${rowNodes}
${moreRow}
<text class="foot" x="${PAD}" y="${H - 14}" dominant-baseline="central">更新于 ${fmtDate(now)} (UTC+8) · 数据由本仓库 GitHub Actions 每日从 GitHub API 刷新</text>
</svg>
`;
}

function renderRecent(items) {
  if (!items.length) return '';
  const lines = items.map((it) => {
    const full = it.repository_url.split('/repos/')[1];
    const date = (it.pull_request?.merged_at || it.created_at || '').slice(0, 10);
    return `- [#${it.number} ${esc(truncate(it.title, 13, 460))}](${it.html_url}) · ${full} · ${date}`;
  });
  return `${lines.join('\n')}\n`;
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
    if (!byRepo.has(full)) byRepo.set(full, { full, count: 0, stars: 0, latest: 0 });
    const rec = byRepo.get(full);
    rec.count += 1;
    if (full.split('/')[0] !== USER) external += 1;
    const mergedAt = it.pull_request?.merged_at;
    if (mergedAt) {
      const t = Date.parse(mergedAt);
      rec.latest = Math.max(rec.latest, t);
      if (t >= cutoff) recent30 += 1;
    }
  }

  const stars = await loadStars([...byRepo.keys()]);
  for (const rec of byRepo.values()) rec.stars = stars.get(rec.full) ?? 0;

  const all = [...byRepo.values()].sort((a, b) => b.count - a.count || b.stars - a.stars);
  const rows = all.slice(0, MAX_ROWS);

  const svg = buildSvg(rows, items.length, external, recent30, all.length, now);
  await writeFile(path.join(ROOT, 'assets', 'merged-prs.svg'), svg, 'utf8');
  console.log(`profile-stats: 写出 assets/merged-prs.svg（${all.length} 个仓库）`);

  const readmePath = path.join(ROOT, 'README.md');
  const readme = await readFile(readmePath, 'utf8');
  const marker = /<!-- MERGED-PRS:START -->[\s\S]*?<!-- MERGED-PRS:END -->/;
  if (!marker.test(readme)) die('README.md 里缺少 <!-- MERGED-PRS:START --> / <!-- MERGED-PRS:END --> 标记');
  const recent = [...items].sort((a, b) =>
    Date.parse(b.pull_request?.merged_at || b.created_at) - Date.parse(a.pull_request?.merged_at || a.created_at),
  ).slice(0, MAX_RECENT);
  const body = renderRecent(recent) || '暂无。\n';
  await writeFile(readmePath, readme.replace(marker, `<!-- MERGED-PRS:START -->\n${body}\n<!-- MERGED-PRS:END -->`), 'utf8');
  console.log('profile-stats: README.md 已更新');
}

await main();
