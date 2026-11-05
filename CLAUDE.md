# CLAUDE.md

个人厨房系统。没有 App 和网页：用户在 Claude Code 里说话（手机端通过 Remote Control 连到这台电脑），你负责听懂，`npm run -s kitchen` 负责读写数据和计算。

两条最高原则：极简交互优先；AI 只负责理解，确定性程序负责所有修改。

## 回答用户时

- **先查再说。** 库存、能做什么、吃了多少都用命令查，不凭记忆，也不凭对话里之前说过的数字。曾经没查就推荐了番茄意面，家里根本没记录番茄罐头和意面。
- **推荐吃什么先跑 `today`。** 程序首选可能带「主料未确认」，那表示家里没记录，不等于有。优先从「主料都确认有的菜」里挑，要推别的就说清楚缺什么。
- **直接替用户做，不让用户手动录。** 听懂了就执行，改完用一句话说明结果。
- **说不清的才问。** 比如「吃了一些」没有份数。不要猜数量，数量未知就是未知，不能当 0。
- **批量或拿不准的改动先 `preview`。** `run` 的结果里有「注意」要转告用户。
- **改错了用 `undo`。** 需要操作 id 时查 `log`。

## 命令

```bash
npm run -s kitchen -- today              # 今天吃什么、能做的菜、提醒、今天吃的
npm run -s kitchen -- stock [词]         # 库存
npm run -s kitchen -- recipes [词]       # 菜谱，主料齐不齐
npm run -s kitchen -- recipe 黑椒蘑菇鸡丁  # 用量、步骤、一份的营养
npm run -s kitchen -- plan [天数]        # 计划
npm run -s kitchen -- shop               # 该买什么
npm run -s kitchen -- intake [天数]      # 吃了什么、营养
npm run -s kitchen -- facts [词]         # 食材营养资料
npm run -s kitchen -- log [条数]         # 最近的操作和 id
npm run -s kitchen -- commands           # 所有写命令
npm run -s kitchen -- preview 命令 'JSON'
npm run -s kitchen -- run 命令 'JSON' [--key 键]
npm run -s kitchen -- undo 操作id
```

用 Bash 工具运行，JSON 用单引号。写命令的输入格式在 `src/domain/commands.ts`，schema 都是 strict。

| 用户说 | 命令 |
|---|---|
| 现在还有 X（设总量） | `importStock` `{"entries":[{"ingredientId":"egg","qty":4}],"have":[]}` |
| 买了 X、用掉 X（增减） | `importStock`，条目加 `"add":true`，减少用负数，可带 `"unit":"lb"` |
| 调料有了 | `importStock` 的 `have`；快用完或没了用 `setSeasoningLevel` |
| 家里有目录没有的东西 | 先 `addIngredient` `{"name":"鱼露","category":"seasoning","unit":"level","defaultLocation":"pantry"}`（食物用 `"g"` 等数量单位），再记库存；没有菜谱也记 |
| 做完一道菜 | `finishCook` `{"recipeId":"R01","servings":2,"eatNow":1,"date":"…","slot":"lunch"}`，配饭放进 `actuals` |
| 这一锅没放油、用油不同 | `finishCook` 加 `"oilGrams":0`，是每份的克数，只影响这一锅；要改默认才用 `setCookingOil` |
| 实际用量不同 | `finishCook` 的 `actuals`；做完才发现用 `reviseCookSession` |
| 吃了熟菜 | `consumePreparedPortion` `{"batchId":"…","portions":1}`，批次 id 在 `stock` 里 |
| 其实没吃 | `revertConsumption` |
| 吃了不在菜谱里的东西 | `recordSnack` `{"ingredientId":"pork_dumpling","qty":13}`，没数量时不写 qty |
| 外食、不吃 | `setMealStatus`；一整天 `setDayAway`；恢复 `restoreMeal` |
| 换菜 | `swapRecipe` |
| 报废 | `discardLot`、`discardBatch` |
| 每份用油 | `setCookingOil` `{"grams":10}` |

重复执行有风险时给 `--key`，同一个键只执行一次。

## 文件

- `data/kitchen.json`：全部真实数据，**只通过命令改，不要手动编辑**。`data/` 不进 git，靠 Dropbox 同步和版本历史，`data/backups/` 每天留一份。
- `src/domain/`：业务规则，纯函数。
- `src/cli/`：命令行。`store.ts` 读写文件，`report.ts` 是只读报告，`kitchen.ts` 分发命令。
- `docs/kitchen-profile.md`：用户的厨具和习惯，推荐和改菜谱时要看。这类会变的内容写在那里，不写进本文件。
- 产品规格在仓库外：`Dropbox\笔记\科研库\06-Life\Personal_Kitchen_OS_v3_AI动态规划_极简本地版_完整开发提示词.md`。App 相关的部分已经作废。
- 菜谱和厨房资料以本仓库为准：`src/domain/seed.ts`、`library.ts`、`references.ts`、`nutrition.ts`。`06-Life/Health` 里的笔记只是导入来源。

```bash
npm run typecheck
npm test
npx vitest run tests/domain/intake.test.ts
```

没有 lint。git 历史的 `3f5b191` 及之前有完整的 PWA，要找回时从那里看。

## 架构

所有写操作走同一条路：`applyCommand()` → `execute()` → 命令 `run(tx, input)` → `Tx` 工作副本 → 写回文件。

- `src/domain/commands.ts`：全部命令，每个是 `{ schema, run(tx, input) }`，注册在文件末尾的 `COMMANDS`。
- `src/domain/tx.ts`：`Tx` 是一次命令的工作副本，命令只通过它读写。
- `src/domain/engine.ts`：`execute()` 负责输入校验、幂等和审计。`preview()` 就是执行后丢弃结果，所以预览和提交不可能算出不同结果。
- 每次打开数据都跑 `syncCatalog` 和 `syncPlan`：补上目录新增的行，把计划顺延到今天。

### 必须保持的领域规则

- **五种事实分开**：计划、准备中、已做好、已食用、已跳过。做完才扣原料，吃的时候只减熟菜。
- **事件表不可变，投影表可变**。修正走补偿流水，不改历史记录。
- **撤销**（`src/domain/undo.ts`）是补偿式的，后面的操作改过同一条记录时，要先撤销后面那个。
- **`reflow()`**（`src/domain/planner.ts`）是唯一能重排计划的函数，只写最小差异。
- **库存**（`src/domain/inventory.ts`）：先到期先用，不允许负库存，缺口要记录。数量未知是 `null`，不能当作无穷或 0。不编造数量，种子数据也不写库存批次。
- **够不够**（`lineStatus`）：差 2% 以内算够，因为 1 lb 记账是 453.6g、菜谱写 454g。差额做完仍会记录。
- **日期**都是 `America/Los_Angeles` 的本地日历日（`src/domain/dates.ts`），不要用 UTC 截断。
- **营养**（`src/domain/intake.ts`）是纯推算，不存结果：熟菜一份 = 这一锅的实际用料 ÷ 份数，再乘吃掉的份数，另加每份烹调油（加餐类的菜不加）。食用记录按带符号份数加总，所以撤销不用单独处理。算不出来的列进 `uncounted`，不能按 0 计入。不设目标和打卡。

### 目录

- 菜谱分层：`core`、`variant`、`backup`、`snack` 在 `src/domain/seed.ts`；用户的菜谱库 `library` 在 `src/domain/library.ts`。`library` 不进自动推荐和 7 天轮换（不要不断生成陌生新菜），用户点名才用。常备菜 `PANTRY_DEFS` 也在 `library.ts`，属于 `backup`：进自动推荐，不进 7 天轮换。
- 带 `catalogOnly` 的备用食材平时不算待核对。
- 酱汁、腌料、料理速查（`references.ts`）和营养（`nutrition.ts`）是静态数据。

## 修改时要注意

- **新食材**：加到 `seed.ts` 或 `library.ts`，同时在 `NUTRITION_FACTS` 加一行并填 `basis`（这一行相当于多少规范单位）。`tests/domain/intake.test.ts` 会检查有没有漏。优先用用户发来的产品标签。
- **改已有目录行**：`syncCatalog` 只按 id 补缺的行，所以**新增行会进数据文件，改已有行不会**。用户改不了的字段用 `OUTDATED_NOTES` 这样的精确匹配；用户改得了的字段（比如菜谱用量）要像 `BAG_QTY_MIGRATION` 那样匹配旧值，并用一次性标记，否则用户之后的修改会被盖掉。`seedState` 要自带这个标记。
- **改数据结构**：`src/cli/store.ts` 的 `FILE_VERSION` 要加 1，并写升级逻辑，不能丢用户数据。
- **`.env` 不读取、不打印。** 它是旧辅助服务留下的，现在没有代码使用。
- **测试时钟固定。** `tests/domain/helpers.ts` 的 `Kitchen` 把时间固定在 2026-11-04 12:00 PST，并直接调用 `execute()`。
- **防护类测试要验证它真能失败。** 暂时删掉被保护的代码，确认测试会红。
- **食品安全高于旧笔记。** 导入配方时，温度和熟度按规格，不照抄笔记。
- **commit 和 push 要用户同意。** `main` 不再触发部署。
