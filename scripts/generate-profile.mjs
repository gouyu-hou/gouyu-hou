#!/usr/bin/env node
// Renders the profile header card (hero + merged-PR stats + 30-day timeline) as one SVG,
// then refreshes the repository list (with real org avatars) inside README.md.
// Zero dependencies, needs Node 18+ (global fetch).
//
//   GITHUB_TOKEN=xxx node scripts/generate-profile.mjs
//   node scripts/generate-profile.mjs --data cache.json      # offline: reuse a saved payload

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const USER = process.env.PROFILE_USER || 'gouyu-hou';
const ROOT = process.cwd();
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

const CONFIG = {
  tagline: 'AGENT DEVELOPER · BACKEND / FULLSTACK',
  intro: '构建 Coding Agent，持续向 openclaw、deer-flow 等一线 AI 开源仓库贡献代码。',
  introSub: 'Agent 开发 · 后端/全栈 · 2027 届本科在读',
  maxRepoRows: 8,
  timelineDays: 30,
};

const args = process.argv.slice(2);
const dataArgIndex = args.indexOf('--data');
const DATA_FILE = dataArgIndex >= 0 ? args[dataArgIndex + 1] : null;

const W = 880;
const PAD = 36;
const FONT = "ui-sans-serif, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

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

// stars + owner avatar for each repository (avatar feeds the README table).
async function loadRepoMeta(fullNames) {
  const meta = new Map();
  for (const full of fullNames) {
    try {
      const repo = await api(`/repos/${full}`);
      const avatar = (repo.owner?.avatar_url || '').replace(/\?.*/, '?v=4&s=64');
      meta.set(full, { stars: repo.stargazers_count ?? 0, avatar });
    } catch {
      meta.set(full, { stars: 0, avatar: '' });
    }
  }
  return meta;
}

// Rough advance width: CJK/full-width glyphs ~0.92em, latin/digits ~0.55em (mono ~0.6em).
function textWidth(text, size, mono = false) {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    const wide = code >= 0x1100 && (code <= 0x115f || code === 0x2329 || code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6));
    w += wide ? size * 0.92 : size * (mono ? 0.6 : 0.55);
  }
  return w;
}

function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

function buildCard({ total, external, recent30, perDay, now }) {
  // ---- vertical rhythm: generous spacing between every block ----
  let y = 64;
  const tagY = y;            y += 44;   // tag pill -> name
  const nameY = y;           y += 38;   // name -> intro
  const introY = y;          y += 30;   // intro -> introSub
  const introSubY = y;       y += 52;   // introSub -> stats head
  const statsHeadY = y;      y += 24;   // stats head -> divider
  const statsDivY = y;       y += 78;   // divider -> big number
  const bigY = y;            y += 38;   // big number -> subline
  const subY = y;            y += 54;   // subline -> timeline dots
  const dotsY = y;           y += 24;   // dots -> day labels
  const dotsLabelY = y;      y += 34;   // labels -> footer
  const footerTop = y;
  const H = footerTop + 46;

  const tagSize = 11;
  const tagSpacing = 0.14 * tagSize;
  const tagTextW = textWidth(CONFIG.tagline, tagSize) + CONFIG.tagline.length * tagSpacing;
  const pillW = tagTextW + 30;

  const days = [...perDay.keys()];
  const first = days[0];
  const last = days[days.length - 1];
  const span = W - 2 * PAD - 40;
  const timeline = days.map((day, i) => {
    const x = PAD + 20 + (days.length > 1 ? (span * i) / (days.length - 1) : 0);
    const n = perDay.get(day);
    const r = n > 0 ? Math.min(2.5 + 2.4 * Math.sqrt(n), 8) : 2;
    const cls = n > 0 ? 'dot' : 'dotOff';
    return `<circle class="${cls}" cx="${x.toFixed(1)}" cy="${dotsY}" r="${r.toFixed(1)}"/>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${USER} 的个人主页：已合并 ${total} 个 PR`)}">
<title>${esc(USER)} · Agent 开发 · 已合并 PR 统计</title>
<desc>${esc(`已合并 ${total} 个 PR，其中 ${external} 个来自他人仓库，近 30 天新增 ${recent30} 个。`)}</desc>
<defs>
<clipPath id="cardclip"><rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="16"/></clipPath>
<linearGradient id="topgrad" x1="0" y1="0" x2="1" y2="0">
<stop offset="0" class="g1"/><stop offset="1" class="g2"/>
</linearGradient>
</defs>
<style>
  text { font-family: ${FONT}; }
  .tag { fill: var(--accent); font-size: ${tagSize}px; font-weight: 600; letter-spacing: 0.14em; }
  .name { fill: var(--fg); font-size: 36px; font-weight: 700; letter-spacing: -0.01em; }
  .intro { fill: var(--t2); font-size: 14.5px; }
  .sub { fill: var(--t3); font-size: 12.5px; }
  .statsHead { fill: var(--accent); font-size: 11px; font-weight: 600; letter-spacing: 0.18em; }
  .statsFrom { fill: var(--t3); font-size: 11px; }
  .big { fill: var(--accent); font-size: 56px; font-weight: 700; }
  .bigUnit { fill: var(--fg); font-size: 16px; font-weight: 500; }
  .subline { fill: var(--t2); font-size: 12.5px; }
  .dot { fill: var(--accent); }
  .dotOff { fill: var(--div); }
  .dayLabel { fill: var(--t3); font-size: 10px; }
  .div { stroke: var(--div); stroke-width: 1; }
  .foot { fill: var(--t3); font-size: 11px; }
  .pill { fill: var(--accent); fill-opacity: 0.12; }
  .g1 { stop-color: #0d9488; }
  .g2 { stop-color: #38bdf8; }
  svg { --bg: #ffffff; --fg: #111827; --t2: #4b5563; --t3: #9ca3af; --div: #e5e7eb; --accent: #0f766e; --footbg: #f8fafc; }
  @media (prefers-color-scheme: dark) {
    svg { --bg: #0d1117; --fg: #e6edf3; --t2: #b6bcc4; --t3: #7d8590; --div: #21262d; --accent: #2dd4bf; --footbg: #161b22; }
    .g1 { stop-color: #14b8a6; }
    .g2 { stop-color: #38bdf8; }
  }
</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="var(--bg)" stroke="var(--div)"/>
<g clip-path="url(#cardclip)">
<rect x="0" y="0" width="${W}" height="5" fill="url(#topgrad)"/>
</g>

<rect x="${PAD}" y="${tagY - 12}" width="${pillW.toFixed(0)}" height="24" rx="12" class="pill"/>
<text class="tag" x="${PAD + 15}" y="${tagY}" dominant-baseline="central">${esc(CONFIG.tagline)}</text>
<text class="name" x="${PAD}" y="${nameY}">${esc(USER)}</text>
<text class="intro" x="${PAD}" y="${introY}" dominant-baseline="central">${esc(CONFIG.intro)}</text>
<text class="sub" x="${PAD}" y="${introSubY}" dominant-baseline="central">${esc(CONFIG.introSub)}</text>

<text class="statsHead" x="${PAD}" y="${statsHeadY}" dominant-baseline="central">MERGED PULL REQUESTS</text>
<text class="statsFrom" x="${W - PAD}" y="${statsHeadY}" text-anchor="end" dominant-baseline="central">github.com/${esc(USER)}</text>
<line class="div" x1="${PAD}" y1="${statsDivY}" x2="${W - PAD}" y2="${statsDivY}"/>
<text class="big" x="${PAD}" y="${bigY}">${total}</text>
<text class="bigUnit" x="${PAD + textWidth(String(total), 56) + 14}" y="${bigY}">PR 已合并</text>
<text class="subline" x="${PAD}" y="${subY}" dominant-baseline="central">${external} 个来自他人仓库 · 近 30 天 +${recent30}</text>

${timeline.join('\n')}
<text class="dayLabel" x="${PAD}" y="${dotsLabelY}" dominant-baseline="central">${first}</text>
<text class="dayLabel" x="${W - PAD}" y="${dotsLabelY}" text-anchor="end" dominant-baseline="central">${last}</text>

<g clip-path="url(#cardclip)">
<rect x="0" y="${footerTop}" width="${W}" height="${H - footerTop}" fill="var(--footbg)"/>
<line class="div" x1="0" y1="${footerTop}" x2="${W}" y2="${footerTop}"/>
<text class="foot" x="${PAD}" y="${footerTop + 23}" dominant-baseline="central">数据来自 GitHub API · 每天中午 12 点（UTC+8）自动刷新</text>
<text class="foot" x="${W - PAD}" y="${footerTop + 23}" text-anchor="end" dominant-baseline="central">更新于 ${fmtStamp(now)}</text>
</g>
</svg>
`;
}

// GitHub-contribution-graph style heatmap of merged PRs over the last 52 weeks.
// Self-rendered and refreshed daily, so every newly merged PR lights up automatically.
function buildHeatmap({ items, now }) {
  const PAD = 36;
  const HW = W;
  const pitch = 15;
  const cell = 11.5;
  const gridX = PAD + 24;
  const titleY = 40;
  const gridTop = 68;
  const gridBottom = gridTop + 7 * pitch;
  const legendY = gridBottom + 32;
  const HH = legendY + 20;

  // merged counts per calendar day (Shanghai time)
  const counts = new Map();
  for (const it of items) {
    const m = it.pull_request?.merged_at;
    if (!m) continue;
    const d = new Date(Date.parse(m) + 8 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = (end.getUTCDay() + 6) % 7; // Monday = 0
  const lastMonday = new Date(end);
  lastMonday.setUTCDate(end.getUTCDate() - dow);
  const start = new Date(lastMonday);
  start.setUTCDate(lastMonday.getUTCDate() - 51 * 7);

  const level = (n) => (n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4);

  const squares = [];
  const monthMarks = [];
  let lastMonth = -1;
  let yearTotal = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += 24 * 60 * 60 * 1000) {
    const d = new Date(t);
    const key = d.toISOString().slice(0, 10);
    const n = counts.get(key) || 0;
    yearTotal += n;
    const week = Math.floor((t - start.getTime()) / (7 * 24 * 60 * 60 * 1000));
    const row = (d.getUTCDay() + 6) % 7;
    const x = gridX + week * pitch;
    const y = gridTop + row * pitch;
    squares.push(`<rect class="hl${level(n)}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cell}" height="${cell}" rx="2.5"/>`);
    const mon = d.getUTCMonth();
    if (row === 0 && mon !== lastMonth) {
      lastMonth = mon;
      monthMarks.push(`<text class="mon" x="${x.toFixed(1)}" y="${gridTop - 10}" dominant-baseline="central">${mon + 1}月</text>`);
    }
  }

  const dayLabels = [0, 2, 4].map((row) =>
    `<text class="day" x="${PAD}" y="${gridTop + row * pitch + cell / 2}" dominant-baseline="central">${['一', '三', '五'][row / 2]}</text>`).join('\n');

  const legendX0 = HW - PAD - 118;
  const legend = [0, 1, 2, 3, 4].map((l, i) =>
    `<rect class="hl${l}" x="${legendX0 + 12 + i * pitch}" y="${legendY - cell / 2}" width="${cell}" height="${cell}" rx="2.5"/>`).join('');
  const legendText = `<text class="day" x="${legendX0}" y="${legendY}" dominant-baseline="central">少</text>` +
    `<text class="day" x="${legendX0 + 12 + 5 * pitch + 4}" y="${legendY}" dominant-baseline="central">多</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${HW}" height="${HH}" viewBox="0 0 ${HW} ${HH}" role="img" aria-label="最近一年合并 PR 热力图">
<title>最近一年合并 PR 热力图</title>
<desc>${esc(`最近 52 周共合并 ${yearTotal} 个 PR。`)}</desc>
<defs>
<clipPath id="hclip"><rect x="1" y="1" width="${HW - 2}" height="${HH - 2}" rx="16"/></clipPath>
<linearGradient id="htopgrad" x1="0" y1="0" x2="1" y2="0">
<stop offset="0" class="g1"/><stop offset="1" class="g2"/>
</linearGradient>
</defs>
<style>
  text { font-family: ${FONT}; }
  .head { fill: var(--accent); font-size: 11px; font-weight: 600; letter-spacing: 0.18em; }
  .from { fill: var(--t3); font-size: 11px; }
  .mon { fill: var(--t3); font-size: 10px; }
  .day { fill: var(--t3); font-size: 10px; }
  .hl0 { fill: var(--zero); }
  .hl1 { fill: #99f6e4; }
  .hl2 { fill: #5eead4; }
  .hl3 { fill: #14b8a6; }
  .hl4 { fill: #0f766e; }
  .g1 { stop-color: #0d9488; }
  .g2 { stop-color: #38bdf8; }
  svg { --accent: #0f766e; --t3: #9ca3af; --zero: #eef0f3; }
  @media (prefers-color-scheme: dark) {
    svg { --accent: #2dd4bf; --t3: #7d8590; --zero: #161b22; }
    .hl1 { fill: #0d9488; }
    .hl2 { fill: #14b8a6; }
    .hl3 { fill: #2dd4bf; }
    .hl4 { fill: #99f6e4; }
    .g1 { stop-color: #14b8a6; }
  }
</style>
<rect x="0.5" y="0.5" width="${HW - 1}" height="${HH - 1}" rx="16" fill="var(--bg, #ffffff)" stroke="var(--edge, #e5e7eb)"/>
<style>
  svg { --bg: #ffffff; --edge: #e5e7eb; }
  @media (prefers-color-scheme: dark) { svg { --bg: #0d1117; --edge: #21262d; } }
</style>
<g clip-path="url(#hclip)">
<rect x="0" y="0" width="${HW}" height="5" fill="url(#htopgrad)"/>
</g>
<text class="head" x="${PAD}" y="${titleY}" dominant-baseline="central">MERGED PR ACTIVITY · 最近一年</text>
<text class="from" x="${HW - PAD}" y="${titleY}" text-anchor="end" dominant-baseline="central">近一年合并 ${yearTotal} 个</text>
${monthMarks.join('\n')}
${dayLabels}
${squares.join('')}
${legend}${legendText}
</svg>
`;
}

// Repository table for README.md — real owner avatars straight from
// avatars.githubusercontent.com (camo-proxied by GitHub), regenerated on every run,
// so newly merged repos show up automatically.
function renderRepoTable(repos) {
  if (!repos.length) return '<p align="center"><sub>还没有合并过 PR</sub></p>';
  const rows = repos.slice(0, CONFIG.maxRepoRows).map((r) => {
    const [owner] = r.full.split('/');
    const av = r.avatar
      ? `<img src="${esc(r.avatar)}" width="30" height="30" alt="${esc(owner)}"/>`
      : '';
    return `<tr>
<td width="46" valign="middle">${av}</td>
<td valign="middle"><a href="https://github.com/${esc(r.full)}"><b>${esc(r.full)}</b></a></td>
<td align="right" valign="middle" width="150"><b>${r.count}</b> 个已合并 PR</td>
<td align="right" valign="middle" width="96"><sub>★ ${fmtStars(r.stars)}</sub></td>
</tr>`;
  }).join('\n');
  const more = repos.length > CONFIG.maxRepoRows
    ? `\n<tr><td colspan="4" align="center"><sub>… 另有 ${repos.length - CONFIG.maxRepoRows} 个仓库也有已合并的 PR</sub></td></tr>`
    : '';
  return `<table>
<tr>
<td width="46"></td>
<td><sub><b>仓库</b></sub></td>
<td align="right" width="150"><sub><b>已合并 PR</b></sub></td>
<td align="right" width="96"><sub><b>星标</b></sub></td>
</tr>
${rows}${more}
</table>`;
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
    if (!byRepo.has(full)) byRepo.set(full, { full, count: 0, stars: 0, avatar: '' });
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
    rec.avatar = meta.get(rec.full)?.avatar ?? '';
  }
  const repos = [...byRepo.values()].sort((a, b) => b.count - a.count || b.stars - a.stars);

  const svg = buildCard({ total: items.length, external, recent30, perDay, now });
  await writeFile(path.join(ROOT, 'assets', 'profile.svg'), svg, 'utf8');
  console.log('profile-stats: 写出 assets/profile.svg');

  const heatmap = buildHeatmap({ items, now });
  await writeFile(path.join(ROOT, 'assets', 'activity.svg'), heatmap, 'utf8');
  console.log('profile-stats: 写出 assets/activity.svg');

  const readmePath = path.join(ROOT, 'README.md');
  const readme = await readFile(readmePath, 'utf8');
  const marker = /<!-- REPO-LIST:START -->[\s\S]*?<!-- REPO-LIST:END -->/;
  if (!marker.test(readme)) die('README.md 里缺少 <!-- REPO-LIST:START --> / <!-- REPO-LIST:END --> 标记');
  await writeFile(readmePath, readme.replace(marker, `<!-- REPO-LIST:START -->\n${renderRepoTable(repos)}\n<!-- REPO-LIST:END -->`), 'utf8');
  console.log('profile-stats: README.md 仓库表已更新');
}

await main();
