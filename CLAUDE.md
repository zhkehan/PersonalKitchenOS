# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概况

个人厨房助手，本地优先的中文 PWA，部署在 <https://zhkehan.github.io/PersonalKitchenOS/>。用户在 Android 手机上日常使用，真实数据只在手机的 IndexedDB 里，这个仓库和电脑上都没有。

- 产品规格：`Dropbox\笔记\科研库\06-Life\Personal_Kitchen_OS_v3_AI动态规划_极简本地版_完整开发提示词.md`（在仓库外）。
- 已实现和未实现的功能：README 的「实现状态」。改动功能后同步更新。
- 测试结果和未验证事项：`TEST_REPORT.md`。
- 两条最高原则：极简交互优先；AI 只负责理解，确定性程序负责所有修改。

- 菜谱和厨房资料以本仓库为准：`src/domain/seed.ts`、`library.ts`、`references.ts`、`nutrition.ts`。`06-Life/Health` 里的笔记只是导入来源，不再和这里同步。
- 用户的厨具和备餐习惯：`docs/kitchen-profile.md`，与规格书冲突时以它为准。这类会变的内容写在那里或目录文件（`src/domain/seed.ts`、`src/domain/library.ts`），不要写进本文件。

## 常用命令

```powershell
npm run dev                  # Vite 开发服务器
npm run typecheck            # tsc --noEmit
npm test                     # 单元、集成、服务端测试（Vitest）
npx vitest run tests/domain/ai.test.ts   # 单个文件
npx vitest run -t "关键词"               # 按测试名过滤
npm run test:e2e             # Playwright，Pixel 7 模拟，先构建再跑
npx playwright test tests/e2e/app.spec.ts -g "关键词"   # 单个 E2E
npm run build                # 类型检查 + 生产构建
npm run serve                # 本地辅助服务：托管 dist 并转发模型请求（8787 端口）
npm run ai:check             # 用 .env 配置的真实模型跑 8 句话，消耗 8 次额度
npm run ai:check -- 今天外食  # 只测一句
npm run stock:link -- 清单.json  # 生成库存链接，手机打开确认一次就入库，格式见脚本开头
```

项目没有配置 lint，静态检查只有 `typecheck`。首次跑 E2E 前先运行 `npx playwright install chromium`。

E2E 配置了 `reuseExistingServer: true`：4173 端口上如果留着旧的 preview 服务，测的就是旧代码。改完代码后先确认这个端口没有旧进程。

## 架构

### 所有写操作走同一条路

```
UI 按钮 ─────────────────────┐
                             ├→ execute() → 命令 run(tx, input) → Tx 工作副本 → writes
AI 确认后的提案 ─────────────┘
```

- `src/domain/commands.ts`：全部命令。每个命令是 `{ schema, run(tx, input) }`，注册在文件末尾的 `COMMANDS` 里。schema 用 zod `.strict()`。
- `src/domain/tx.ts`：`Tx` 是一次命令的工作副本。命令只通过它读写，不碰数据库，所以是纯函数。
- `src/domain/engine.ts`：`execute()` 是唯一写入口，负责输入校验、幂等（查 `audit_events` 的 `idempotencyKey`）和审计。`preview()` 就是执行后丢弃结果，所以预览和提交不可能算出不同结果。
- `src/data/db.ts`：`commit()` 在一个 Dexie 读写事务里加载全部状态、执行命令、写回改动。
- `src/ui/store.tsx`：UI 的入口，1.5 秒内相同操作复用同一个幂等键，防连点。启动和回到前台时跑 `syncPlan`。

### 必须保持的领域规则

- **五种事实分开**：计划、准备中、已做好、已食用、已跳过。打开菜谱或取消不改库存，做完才扣原料，吃的时候只减熟菜。
- **事件表不可变，投影表可变**。修正走补偿流水，不改历史记录。
- **撤销**（`src/domain/undo.ts`）是补偿式的，用内容比较判断冲突，不比较行版本号。后面的操作改过同一条记录时，要先撤销后面那个。
- **`reflow()`**（`src/domain/planner.ts`）是唯一能重排计划的函数，只写最小差异，并记录计划版本和变更。
- **库存**（`src/domain/inventory.ts`）：先到期先用，不允许负库存，缺口要记录。数量未知是 `null`，不能当作无穷或 0。App 不编造数量，种子数据也不写库存批次。
- **日期**都是 `America/Los_Angeles` 的本地日历日（`src/domain/dates.ts`），不要用 UTC 截断。

### 目录和资料

- 菜谱分层：`core`、`variant`、`backup`、`snack` 在 `src/domain/seed.ts`；用户自己的菜谱库 `library` 在 `src/domain/library.ts`。`library` 不进自动推荐和 7 天轮换（规格：不要不断生成陌生新菜），只有用户点名或排进这一餐才出现，过滤写在 `recommendToday`。
- 带 `catalogOnly` 的备用食材没有库存记录时不进核对列表，收在库存页底部；买了之后就是普通库存。
- 酱汁、腌料、料理速查（`references.ts`）和营养（`nutrition.ts`）是静态只读数据，不写数据库。
- 营养摄入（`src/domain/intake.ts`）是纯推算，不存结果，也不要求额外录入：熟菜一份 = 这一锅的实际用料 ÷ 份数，乘吃掉的份数。食用记录按带符号份数加总，所以撤销不用单独处理。算不出来的列进 `uncounted`，不能按 0 计入。规格要求普通页面不放营养仪表盘，所以入口只在首页底部，不设目标和打卡。
- 库存链接（`src/domain/stockLink.ts`）：清点结果放在网址 `#` 后面，不进仓库，也不发给服务器。打开只是进确认页，写入走 `importStock`，同一份清单只能导入一次。清单文件不要放进仓库。
- 目录新增实物食材时，要在 `NUTRITION_FACTS` 加一行并填 `basis`（这一行相当于多少规范单位）。`tests/domain/intake.test.ts` 会检查有没有漏。

### AI 链路

```
用户原话 → 模型或 ruleParser → zod 校验 ActionProposal（19 种白名单意图）
       → resolveProposal → 预览 → 用户确认 → 命令（幂等键 proposal:${id}）
```

- `src/domain/ai/resolve.ts` 是核心。它用程序解析日期（`dateExpr.ts`），并把模型输出核对到用户原话。结果类型有 preview、clarify、ask_number、filter、answer、rejected。
- **真实模型会猜用户没说的东西**：自己选菜、猜午餐、把「今天外食」猜成一整天。这类防护要写在程序里，不能只靠改提示词。午晚和「整天」只认用户原话或用户在提问里的选择；`swap_recipe` 只接受用户点名的菜，否则走规则引擎。涉及库存事实时，食材和数量必须能在原话里找到。
- `src/domain/ai/ruleParser.ts` 是离线兜底，不是 AI。界面必须标注「本地规则（非 AI）」，AI 失败时要明确提示。
- 发给模型的上下文由 `buildAiContext`（`src/domain/ai/prompt.ts`）控制，不含库存数量、流水、价格。README 向用户承诺了这一点，改动时一并更新。

### 两种模型连接

手机上实际使用的是**直连模式**，Gemini Key 只存在手机浏览器的 localStorage（`kos.ai`），不进备份。这是用户接受的、对规格书「密钥走中转」的偏离，所以 App 不能加载任何第三方脚本。

| 模式 | 代码 | 要点 |
|---|---|---|
| 直连 Gemini | `src/ai/client.ts`、`src/ai/gemini.ts` | 不能发 `Api-Revision` 头，否则 CORS 预检返回 403（`omitRevisionHeader`） |
| 辅助服务 | `server/` | 有口令、限流、CORS 白名单，没有任何写数据的接口；非回环地址监听时必须设置至少 16 位口令 |

默认模型是 `gemini-3.5-flash-lite`（Interactions API）。Ollama 和 Anthropic 适配器在 `server/providers.ts`，只用假端点测过，没有跑过真实接口。

## 修改时要注意

- **改目录要想到已安装的手机。** `ensureSeeded` 只在空库时写入。已有数据靠 `syncCatalog` 拿到新内容：每次启动和恢复备份后运行，只按 id 补缺的行，所以**新增行会到手机，改已有行不会**。要改已有行，用 `OUTDATED_NOTES` 这样的精确匹配，并确认那个字段用户改不了；用户改得了的字段（比如菜谱用量）要像 `BAG_QTY_MIGRATION` 那样匹配旧值，并用一次性标记，否则用户之后的修改会被盖掉。新装的 `seedState` 要自带这个标记。用户自建了同名食材时会沿用用户那条。
- **改表结构**：`src/data/db.ts` 的 `SCHEMA_VERSION` 要加 1，并保留旧版本声明和 Dexie 升级逻辑，同时在 `src/data/backup.ts` 的 `MIGRATIONS` 里写备份升级。目前只有 v1，这条链路还没有真实迁移过，不能丢用户数据。
- **网址不能变。** 数据按来源隔离，改仓库名或换域名后，手机打开的是空库。
- **push 到 `main` 就是发布。** GitHub Actions 在 Linux 上跑 `vitest` 和 `build`，然后部署 Pages，PWA 自动更新。CI 不跑 E2E，push 前在本地跑。测试不能假设 Windows。
- **`.env` 含真实 Key，不读取、不打印。** 它靠 NTFS 的 `com.dropbox.ignored` 流避免同步到 Dropbox，整文件重写会冲掉这个标记。`server/config.ts` 的 `protectEnvFile` 在启动时会补上，但改完后要确认。`node_modules`、`dist` 等目录也带这个标记，设置方法见 README。
- **测试时钟固定。** `tests/domain/helpers.ts` 的 `Kitchen` 把时间固定在 2026-11-04 12:00 PST，并直接调用 `execute()`。新的领域测试用它。
- **覆盖范围**：真实模型发现的误判要在 `tests/domain/ai.test.ts` 里加回归测试。`TEST_REPORT.md` 里的通过数字要来自实际运行结果。
- **防护类测试要验证它真能失败。** 暂时删掉被保护的代码，确认测试会红。菜谱库「不进推荐」的第一版测试就是空的，因为低分菜本来就排不进前三。
- **食品安全高于旧笔记。** 导入配方时，温度和熟度按规格，不照抄笔记。
