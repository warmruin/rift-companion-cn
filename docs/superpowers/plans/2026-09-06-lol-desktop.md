# LOL 国服桌面助手 Implementation Plan

> Execute with subagent-driven-development, isolated file ownership and integrated review.

**Goal:** Windows 桌面程序提供 OP.GG 英雄推荐和本机可见队友近五场分析。
**Architecture:** Electron 主进程封装只读 LCU / OP.GG；React 渲染器通过限定 IPC 请求；纯函数负责评分。
**Tech Stack:** TypeScript, Electron, React, Vite, Vitest.

## Global Constraints
只支持 Windows；无假战绩；不还原匿名身份；非国服统计明确标记；凭据仅留主进程；接口失败可见。

## Tasks
- [x] 1. 数据适配：electron/lcu.ts、electron/stats.ts、tests/adapters.test.ts。共享结构见 src/shared/types.ts。先用真实形状 fixture 测试战绩身份匹配、重开排除、counter 胜率方向和空数据，再实现。LCU 本机 HTTPS、超时与凭据隔离，OP.GG 公开页面解析与本地缓存。运行 npm test。
- [x] 2. 核心：src/core/analysis.ts、tests/analysis.test.ts。rateMatches(matches) 输出 Rating；recommend(role, enemies, opponentId, banned, stats, champions) 输出 Recommendation[]。测试低样本不评级、零死亡 KDA、顺序与禁选过滤；再实现可解释评分。
- [x] 3. 界面与主进程：src/App.tsx、src/style.css、electron/main.ts、electron/preload.ts。英雄推荐/榜单/队友/设置四页，完整加载与错误状态，自动同步可见阵容、允许手动覆盖；禁用 nodeIntegration，启用 contextIsolation 与 sandbox。构建 npm run build。
- [x] 4. 验收：npm test、npm run build、Electron Playwright smoke test，真实 OP.GG 请求解析检查，Windows 打包与启动检查；写 README，披露没有国服实机验证。

## Test contract examples
```ts
expect(rateMatches([]).score).toBeNull();
expect(rateMatches(fiveWins).winRate).toBe(100);
expect(recommend('top', [266], 266, [24], stats, champions).some(x=>x.championId===24)).toBe(false);
```
所有自动测试使用明确标记的 fixture；生产没有 demo 数据回退。无法连接的客户端视为正常可用性状态。
