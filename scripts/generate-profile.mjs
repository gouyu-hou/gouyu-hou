#!/usr/bin/env node
// Renders the whole profile card (hero + merged-PR stats + repo list + footer) as one SVG,
// then refreshes the recent-PR list inside README.md.
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
  maxRepoRows: 6,
  timelineDays: 30,
};

const args = process.argv.slice(2);
const dataArgIndex = args.indexOf('--data');
const DATA_FILE = dataArgIndex >= 0 ? args[dataArgIndex + 1] : null;

const W = 880;
const PAD = 32;
const FONT = "ui-sans-serif, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";
const BADGE_COLORS = ['#7c3aed', '#0891b2', '#ea580c', '#16a34a', '#dc2626', '#4f46e5', '#0f766e', '#a16207'];

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

// stars + owner avatar for each repository. The avatar is downloaded and inlined as a
// base64 data URI so the SVG stays fully self-contained (SVG served as <img> cannot load
// external images). Newly merged repos therefore always render with their real logo.
async function loadRepoMeta(fullNames) {
  const meta = new Map();
  for (const full of fullNames) {
    try {
      const repo = await api(`/repos/${full}`);
      const stars = repo.stargazers_count ?? 0;
      const avatarUrl = (repo.owner?.avatar_url || '').replace(/\?.*/, '?v=4&s=64');
      let avatar = '';
      if (avatarUrl) {
        try {
          const res = await fetch(avatarUrl, { headers: { 'User-Agent': 'gouyu-hou-profile-stats' } });
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            const ct = res.headers.get('content-type') || 'image/png';
            avatar = `data:${ct};base64,${buf.toString('base64')}`;
          }
        } catch {
          avatar = '';
        }
      }
      meta.set(full, { stars, avatar });
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

function truncate(text, size, maxPx, mono = false) {
  if (textWidth(text, size, mono) <= maxPx) return text;
  let out = text;
  while (out.length > 1 && textWidth(`${out}...`, size, mono) > maxPx) out = out.slice(0, -1);
  return `${out}...`;
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

function hashColor(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return BADGE_COLORS[h % BADGE_COLORS.length];
}

// 5-point star, outer r 7, centered at origin.
const STAR_PATH = 'M0 -7 L1.76 -2.43 L6.66 -2.16 L2.85 0.93 L4.11 5.66 L0 3 L-4.11 5.66 L-2.85 0.93 L-6.66 -2.16 L-1.76 -2.43 Z';

function buildCard({ items, repos, external, recent30, perDay, now }) {
  const total = items.length;
  const rows = repos.slice(0, CONFIG.maxRepoRows);
  const hasMore = repos.length > rows.length;

  let y = 64;
  const heroTagY = y;
  y += 48;
  const nameY = y;
  y += 40;
  const introY = y;
  y += 32;
  const introSubY = y;
  y += 54;
  const statsHeadY = y;
  y += 26;
  const statsDivY = y;
  y += 80;
  const bigY = y;
  y += 40;
  const subY = y;
  y += 56;
  const dotsY = y;
  y += 26;
  const dotsLabelY = y;
  y += 38;
  const listTop = y;
  const rowH = 50;
  y = listTop + rows.length * rowH + (rows.length ? 0 : 28);
  if (hasMore) y += 26;
  const footerTop = y + 26;
  const H = footerTop + 44;

  const X_PR = W - PAD - 120;
  const X_STAR = W - PAD - 84;
  const X_STARS = W - PAD;
  const nameMax = X_PR - 24 - (PAD + 38);

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

  const avatarClips = rows
    .map((r, i) => `<clipPath id="avc${i}"><circle cx="${PAD + 13}" cy="${listTop + i * rowH + 22}" r="13"/></clipPath>`)
    .join('\n');

  const rowNodes = rows.length
    ? rows.map((r, i) => {
        const top = listTop + i * rowH;
        const cy = top + 22;
        const [owner] = r.full.split('/');
        const color = hashColor(owner);
        const name = esc(truncate(r.full, 14, nameMax, true));
        const divider = i < rows.length - 1
          ? `<line class="div" x1="${PAD}" y1="${top + rowH - 0.5}" x2="${W - PAD}" y2="${top + rowH - 0.5}"/>`
          : '';
        const icon = r.avatar
          ? `<image href="${esc(r.avatar)}" x="${PAD}" y="${cy - 13}" width="26" height="26" preserveAspectRatio="xMidYMid slice" clip-path="url(#avc${i})"/>`
          : `<rect x="${PAD}" y="${cy - 13}" width="26" height="26" rx="13" fill="${color}" fill-opacity="0.14"/><text x="${PAD + 13}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="13" font-weight="600" fill="${color}" font-family="${FONT}">${esc(owner.slice(0, 1).toUpperCase())}</text>`;
        return `<g>
${icon}
<text class="repo" x="${PAD + 38}" y="${cy}" dominant-baseline="central">${name}</text>
<text x="${X_PR}" y="${cy}" text-anchor="end" dominant-baseline="central"><tspan class="num">${r.count}</tspan><tspan class="unit2"> 个 PR</tspan></text>
<path class="star" d="${STAR_PATH}" transform="translate(${X_STAR} ${cy})"/>
<text class="stars" x="${X_STARS}" y="${cy}" text-anchor="end" dominant-baseline="central">${fmtStars(r.stars)}</text>
${divider}
</g>`;
      }).join('\n')
    : `<text class="t3" x="${PAD}" y="${listTop + 4}" dominant-baseline="central" font-size="13">还没有合并过 PR</text>`;

  const moreRow = hasMore
    ? `<text class="t3" x="${W / 2}" y="${listTop + rows.length * rowH + 22}" text-anchor="middle" dominant-baseline="central" font-size="12">… 另有 ${repos.length - rows.length} 个仓库已合并 PR</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`gouyu-hou 的个人主页：已合并 ${total} 个 PR`)}">
<title>gouyu-hou · Agent 开发 · 已合并 PR 统计</title>
<desc>${esc(`已合并 ${total} 个 PR，其中 ${external} 个来自他人仓库，近 30 天新增 ${recent30} 个。`)}</desc>
<defs>
<clipPath id="cardclip"><rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="14"/></clipPath>
${avatarClips}
</defs>
<style>
  text { font-family: ${FONT}; }
  .tag { fill: var(--purple); font-size: 11px; font-weight: 500; letter-spacing: 0.18em; }
  .name { fill: var(--fg); font-size: 34px; font-weight: 700; }
  .intro { fill: var(--t2); font-size: 14px; }
  .sub { fill: var(--t3); font-size: 12px; }
  .statsHead { fill: var(--purple); font-size: 11px; font-weight: 500; letter-spacing: 0.18em; }
  .statsFrom { fill: var(--t3); font-size: 11px; }
  .big { fill: var(--fg); font-size: 52px; font-weight: 700; }
  .bigUnit { fill: var(--fg); font-size: 16px; font-weight: 500; }
  .subline { fill: var(--t2); font-size: 12px; }
  .dot { fill: var(--purple); }
  .dotOff { fill: var(--div); }
  .dayLabel { fill: var(--t3); font-size: 10px; }
  .repo { fill: var(--fg); font-size: 14px; font-weight: 600; font-family: ${MONO}; }
  .num { fill: var(--fg); font-size: 14px; font-weight: 700; }
  .unit2 { fill: var(--t3); font-size: 12px; }
  .star { fill: none; stroke: var(--t3); stroke-width: 1.2; stroke-linejoin: round; }
  .stars { fill: var(--t2); font-size: 13px; font-weight: 600; }
  .t3 { fill: var(--t3); }
  .div { stroke: var(--div); stroke-width: 1; }
  .foot { fill: var(--t3); font-size: 11px; }
  svg { --bg: #ffffff; --fg: #111827; --t2: #4b5563; --t3: #9ca3af; --div: #e5e7eb; --purple: #7c3aed; --footbg: #f9fafb; }
  @media (prefers-color-scheme: dark) {
    svg { --bg: #0d1117; --fg: #e6edf3; --t2: #b6bcc4; --t3: #7d8590; --div: #21262d; --purple: #a78bfa; --footbg: #161b22; }
  }
</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="var(--bg)" stroke="var(--div)"/>

<rect x="${PAD}" y="${heroTagY - 5}" width="10" height="10" rx="2" fill="var(--purple)"/>
<text class="tag" x="${PAD + 18}" y="${heroTagY}" dominant-baseline="central">${esc(CONFIG.tagline)}</text>
<text class="name" x="${PAD}" y="${nameY}">${esc(USER)}</text>
<text class="intro" x="${PAD}" y="${introY}" dominant-baseline="central">${esc(CONFIG.intro)}</text>
<text class="sub" x="${PAD}" y="${introSubY}" dominant-baseline="central">${esc(CONFIG.introSub)}</text>

<rect x="${PAD}" y="${statsHeadY - 5}" width="10" height="10" rx="2" fill="var(--purple)"/>
<text class="statsHead" x="${PAD + 18}" y="${statsHeadY}" dominant-baseline="central">MERGED PULL REQUESTS</text>
<text class="statsFrom" x="${W - PAD}" y="${statsHeadY}" text-anchor="end" dominant-baseline="central">github.com/${esc(USER)}</text>
<line class="div" x1="${PAD}" y1="${statsDivY}" x2="${W - PAD}" y2="${statsDivY}"/>
<text class="big" x="${PAD}" y="${bigY}">${total}</text>
<text class="bigUnit" x="${PAD + textWidth(String(total), 52) + 12}" y="${bigY}">↑ PR 已合并</text>
<text class="subline" x="${PAD}" y="${subY}" dominant-baseline="central">${external} 个来自他人仓库 · 近 30 天 +${recent30}</text>

${timeline.join('\n')}
<text class="dayLabel" x="${PAD}" y="${dotsLabelY}" dominant-baseline="central">${first}</text>
<text class="dayLabel" x="${W - PAD}" y="${dotsLabelY}" text-anchor="end" dominant-baseline="central">${last}</text>

${rowNodes}
${moreRow}

<g clip-path="url(#cardclip)">
<rect x="0" y="${footerTop}" width="${W}" height="${H - footerTop}" fill="var(--footbg)"/>
<line class="div" x1="0" y1="${footerTop}" x2="${W}" y2="${footerTop}"/>
<text class="foot" x="${PAD}" y="${footerTop + 24}" dominant-baseline="central">数据来源 GitHub REST API · 每日自动刷新</text>
<text class="foot" x="${W - PAD}" y="${footerTop + 24}" text-anchor="end" dominant-baseline="central">更新于 ${fmtStamp(now)}（UTC+8）</text>
</g>
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

  const svg = buildCard({ items, repos, external, recent30, perDay, now });
  await writeFile(path.join(ROOT, 'assets', 'profile.svg'), svg, 'utf8');
  console.log(`profile-stats: 写出 assets/profile.svg（${repos.length} 个仓库）`);
}

await main();
