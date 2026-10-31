<img src="assets/profile.svg" alt="gouyu-hou · Agent 开发 · 已合并 PR 统计" width="880" />

这张卡片由 [`scripts/generate-profile.mjs`](scripts/generate-profile.mjs) 每天中午 12 点（UTC+8）自动生成并提交，整张图是一个自包含的 SVG：头部的介绍文案、已合并 PR 的总数和近 30 天分布点阵、每个仓库的合并数和星标数，全部来自 GitHub API 的实时查询，不经过任何第三方渲染服务。

<details>
<summary>最近合并的 PR</summary>

<!-- MERGED-PRS:START -->
- [#7736 fix(console): tolerate malformed usage counters and pricing](https://github.com/bytedance/deer-flow/pull/7736) · bytedance/deer-flow · 2026-10-31

<!-- MERGED-PRS:END -->

</details>

<details>
<summary>这个数字是怎么算的</summary>

统计口径是 **Pull Request 被合并的数量**，不是 commit 数，也不是 Contributions 热力图：

- 数据来自 `GET /search/issues?q=type:pr author:<user> is:merged`，等价于浏览器里搜 `author:gouyu-hou type:pr is:merged`；
- 命令行同样可以随时复核：`gh api "search/issues?q=type:pr+author:gouyu-hou+is:merged" --jq '{total: .total_count}'`；
- 「近 30 天」按 PR 的 `merged_at` 计算，和 PR 什么时候开无关；点阵图上每个点代表一天，点越大那天合并的越多；
- 仓库星标数来自 `GET /repos/{owner}/{repo}`，卡片上只展示 PR 数最多的前 6 个仓库；
- 头部介绍文案在 `scripts/generate-profile.mjs` 顶部的 `CONFIG` 里改，改完手动跑一次脚本再提交即可。

为什么不直接用 GitHub 自带的图：官方的 Contributions 热力图只按时间分布展示 commit，Insights 里的 Contributors 榜单是仓库视角而且有索引延迟，两者都不提供「这个人合并了多少 PR」这一维。

</details>

<details>
<summary>本地怎么跑</summary>

```bash
export GITHUB_TOKEN="$(gh auth token)"
node scripts/generate-profile.mjs

# 或者：网络受限时先用 gh 抓数据，再离线渲染
gh api "search/issues?q=type:pr+author:gouyu-hou+is:merged&per_page=100" > assets/raw.json
node scripts/generate-profile.mjs --data assets/raw.json
```

</details>
