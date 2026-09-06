# Rift Companion · LOL 国服桌面助手

Windows 桌面应用，提供英雄推荐、OP.GG 分路榜单与 counter 参考，以及本机客户端可见队友的近期状态分析。

## 直接运行

打开 `release/win-unpacked/Rift Companion.exe`，或使用 `release` 下的便携版 exe。解压版须保留整个文件夹。无需安装 Node.js，不需要 Riot API Key。

1. 打开国服 LOL 并登录。
2. 打开助手，在「连接设置」查看连接状态。自动发现失败时选择 LOL 安装目录的 `lockfile`（客户端运行时存在）。
3. 「英雄推荐」选择自己的分路；可自动同步可见阵容，或手动输入敌方英雄。点击某个敌方位置的「设为对位」细化 counter 推荐。
4. 「英雄榜单」查看当前分路层级、胜率和登场率，可点击「寻找 counter」。
5. 「队友状态」在客户端提供可见身份与战绩时显示近五场、胜率与状态评级。匿名玩家不会尝试还原身份。

## 数据说明

- OP.GG 使用公开网页，统计地区 Global、段位 Emerald+，属于**非国服统计参考**。版本、来源与获取时间在界面显示；网页结构变化或网络限制可能导致不可用。
- 对位胜率是**候选英雄对阵敌方目标**的整局胜率，不是单杀率。推荐分另含分路强度和少量阵容规则，不是预测获胜概率。
- LCU 为本机客户端接口，Riot 不承诺第三方可用性。国服没有 Riot 公开 API 路由。本项目未在登录中的国服客户端验证，不能保证当前版本或所有大区能查询队友战绩。
- 战绩只匹配目标玩家身份。取客户端返回的最近 20 场中同模式、非重开且字段完整的最近 5 场；不足时展示实际数量。少于 3 场不评级。
- 状态分 = 近五场胜率（0–1）× 70 + min(KDA / 5, 1) × 30。KDA = 总击杀助攻 / max(1, 总死亡)。≥70 上等马、<40 下等马，其余中等马。只表示近期状态。
- 不包含演示战绩或虚构统计回退。缓存过期或部分数据缺失会明确提示。英雄中文基础资料使用 Riot Data Dragon。

## 本地开发

要求 Node.js 22.12+（推荐 Node.js 24 LTS）与 npm。系统 Node.js 14 无法构建该项目。

```powershell
npm install
npm test
npm run build
npm start
```

`npm run dev` 仅预览界面；LCU 和 OP.GG 适配运行在 Electron 主进程，需要 build/start 才可查询。

```powershell
npm run pack       # Windows 解压版
npm run portable   # 单文件便携版
node scripts/smoke.mjs  # 实际启动 Electron，检查四页导航
```

## 目录

- `src/App.tsx` / `src/style.css`：中文桌面界面。
- `src/core/analysis.ts`：可解释评分与推荐。
- `electron/lcu.ts`：本机客户端发现、只读接口、战绩解析。
- `electron/stats.ts`：OP.GG / Data Dragon 数据与缓存。
- `electron/main.ts` / `preload.ts`：限定 IPC 桥接。
- `tests`：明确标记的测试 fixture，与生产数据隔离。

LCU 凭据仅在主进程内存中使用，不发送给外部网站。HTTPS 证书例外仅限本机 LCU 请求，外部网站正常验证证书。手动 lockfile 路径仅用于本次运行。公共统计缓存位于系统应用数据目录中的 `stats-cache`。

## 已知限制

敌方分路并不总是可知，需手动指定主要对位。只按对位胜率不能保证对线优势。阵容规则基于英雄职业标签，尚不分析熟练度、具体技能连招或出装。不支持读取匿名玩家身份、自动选人或自动发送评级。

## 来源

- https://op.gg/lol/champions
- https://support-developer.riotgames.com/hc/en-us/articles/22698698001939-League-of-Legends
- https://ddragon.leagueoflegends.com/api/versions.json
