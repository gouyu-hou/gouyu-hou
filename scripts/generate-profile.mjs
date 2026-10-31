#!/usr/bin/env node
// Hybrid profile: a compact stats card (merged-PR total + 30-day dots) as SVG for the
// visual focal point, plus a clickable repo table injected into README.md. Zero deps, Node 18+.
//
//   GITHUB_TOKEN=xxx node scripts/generate-profile.mjs
//   node scripts/generate-profile.mjs --data cache.json      # offline: reuse a saved payload

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const USER = process.env.PROFILE_USER || 'gouyu-hou';
const ROOT = process.cwd();
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

const CONFIG = { timelineDays: 30 };

const args = process.argv.slice(2);
const dataArgIndex = args.indexOf('--data');
const DATA_FILE = dataArgIndex >= 0 ? args[dataArgIndex + 1] : null;

const W = 880;
const PAD = 32;
const FONT = "ui-sans-serif, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif";

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

function fmtMD(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function textWidth(text, size) {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    const wide = code >= 0x2e80 && code <= 0xa4cf;
    w += wide ? size * 0.92 : size * 0.55;
  }
  return w;
}

function repoListUrl(full) {
  return `https://github.com/${full}/pulls?q=${encodeURIComponent(`is:pr author:${USER} is:merged`)}`;
}

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

function renderStats({ repos, now }) {
  const table = renderRepoTable(repos);
  const foot = `<sub>数据来源 GitHub REST API · 每天北京时间 12:00 自动刷新 · 更新于 ${fmtStamp(now)}（UTC+8）</sub>`;
  return `${table}\n\n${foot}`;
}

// Compact stats card: big merged-PR total + 30-day dot timeline. No hero, no repo list —
// those live in README.md as native HTML. Purple, dark/light adaptive.
function buildStatsCard({ total, external, recent30, perDay }) {
  const headY = 40;
  const divY = 58;
  const bigY = 100;
  const subY = 130;
  const dotsY = 166;
  const dotsLabelY = 192;
  const H = 214;

  const days = [...perDay.keys()];
  const first = days[0];
  const last = days[days.length - 1];
  const span = W - 2 * PAD - 36;
  const timeline = days.map((day, i) => {
    const x = PAD + 18 + (days.length > 1 ? (span * i) / (days.length - 1) : 0);
    const n = perDay.get(day);
    const r = n > 0 ? Math.min(2 + 2.2 * Math.sqrt(n), 7) : 1.5;
    const cls = n > 0 ? 'dot' : 'dotOff';
    return `<circle class="${cls}" cx="${x.toFixed(1)}" cy="${dotsY}" r="${r.toFixed(1)}"/>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`已合并 ${total} 个 PR`)}">
<title>gouyu-hou · 已合并 PR 统计</title>
<desc>${esc(`已合并 ${total} 个 PR，其中 ${external} 个来自他人仓库，近 30 天新增 ${recent30} 个。`)}</desc>
<style>
  text { font-family: ${FONT}; }
  .head { fill: var(--purple); font-size: 12px; font-weight: 600; letter-spacing: 0.18em; }
  .from { fill: var(--t3); font-size: 12px; font-weight: 500; }
  .big { fill: var(--fg); font-size: 56px; font-weight: 700; }
  .bigUnit { fill: var(--fg); font-size: 18px; font-weight: 600; }
  .subline { fill: var(--t2); font-size: 13px; font-weight: 500; }
  .dot { fill: var(--purple); }
  .dotOff { fill: var(--div); }
  .dayLabel { fill: var(--t3); font-size: 11px; font-weight: 500; }
  .div { stroke: var(--div); stroke-width: 1; }
  svg { --bg: #ffffff; --fg: #111827; --t2: #4b5563; --t3: #9ca3af; --div: #e5e7eb; --purple: #7c3aed; }
  @media (prefers-color-scheme: dark) {
    svg { --bg: #0d1117; --fg: #e6edf3; --t2: #b6bcc4; --t3: #7d8590; --div: #21262d; --purple: #a78bfa; }
  }
</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="var(--bg)" stroke="var(--div)"/>
<rect x="${PAD}" y="${headY - 5}" width="10" height="10" rx="2" fill="var(--purple)"/>
<text class="head" x="${PAD + 18}" y="${headY}" dominant-baseline="central">MERGED PULL REQUESTS</text>
<text class="from" x="${W - PAD}" y="${headY}" text-anchor="end" dominant-baseline="central">github.com/${esc(USER)}</text>
<line class="div" x1="${PAD}" y1="${divY}" x2="${W - PAD}" y2="${divY}"/>
<text class="big" x="${PAD}" y="${bigY}" dominant-baseline="central">${total}</text>
<text class="bigUnit" x="${PAD + textWidth(String(total), 56) + 14}" y="${bigY}" dominant-baseline="central">↑ PR 已合并</text>
<text class="subline" x="${PAD}" y="${subY}" dominant-baseline="central">${external} 个来自他人仓库 · 近 30 天 +${recent30}</text>
${timeline.join('\n')}
<text class="dayLabel" x="${PAD}" y="${dotsLabelY}" dominant-baseline="central">${first}</text>
<text class="dayLabel" x="${W - PAD}" y="${dotsLabelY}" text-anchor="end" dominant-baseline="central">${last}</text>
</svg>
`;
}

async function main() {
  const items = await loadItems();
  console.log(`profile-stats: 拉取到 ${items.length} 个已合并 PR`);

  const now = nowShanghai();
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const byRepo = new Map();
  const perDay = new Map();
  for (let i = CONFIG.timelineDays - 1; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    perDay.set(fmtMD(d), 0);
  }

  let external = 0;
  let recent30 = 0;
  for (const it of items) {
    const full = it.repository_url.split('/repos/')[1];
    if (!byRepo.has(full)) byRepo.set(full, { full, count: 0, stars: 0, avatarUrl: '' });
    byRepo.get(full).count += 1;
    if (full.split('/')[0] !== USER) external += 1;
    const mergedAt = it.pull_request?.merged_at;
    if (mergedAt) {
      const t = Date.parse(mergedAt);
      if (t >= cutoff) recent30 += 1;
      const day = fmtMD(new Date(t + 8 * 60 * 60 * 1000));
      if (perDay.has(day)) perDay.set(day, perDay.get(day) + 1);
    }
  }

  const meta = await loadRepoMeta([...byRepo.keys()]);
  for (const rec of byRepo.values()) {
    rec.stars = meta.get(rec.full)?.stars ?? 0;
    rec.avatarUrl = meta.get(rec.full)?.avatarUrl ?? '';
  }
  const repos = [...byRepo.values()].sort((a, b) => b.count - a.count || b.stars - a.stars);

  await mkdir(path.join(ROOT, 'assets'), { recursive: true });
  await writeFile(
    path.join(ROOT, 'assets', 'stats-card.svg'),
    buildStatsCard({ total: items.length, external, recent30, perDay }),
    'utf8',
  );
  console.log('profile-stats: 写出 assets/stats-card.svg');

  const readmePath = path.join(ROOT, 'README.md');
  const readme = await readFile(readmePath, 'utf8');
  const marker = /<!-- PROFILE-STATS:START -->[\s\S]*?<!-- PROFILE-STATS:END -->/;
  if (!marker.test(readme)) die('README.md 里缺少 <!-- PROFILE-STATS:START --> / <!-- PROFILE-STATS:END --> 标记');
  const stats = renderStats({ repos, now });
  await writeFile(readmePath, readme.replace(marker, `<!-- PROFILE-STATS:START -->\n${stats}\n<!-- PROFILE-STATS:END -->`), 'utf8');
  console.log('profile-stats: README.md 统计区已更新');
}

await main();
