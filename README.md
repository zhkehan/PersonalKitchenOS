# Personal Kitchen OS v3.0

手机优先的个人厨房助手：本地优先 PWA。打开 10 秒内知道今天吃什么；生活变了说一句或点一下，计划小范围重排；库存和采购由确定性程序计算。

- **数据只在你的设备上**（浏览器 IndexedDB）。没有账号、没有云端数据库、不会自动同步。
- **AI 只负责理解你的话**，不能写库存。所有修改都走同一套经过校验的命令，确认后才生效。
- **没有 AI 也完整可用**。电脑关机时手机照常做饭、记账、采购。

测试结果和未验证事项见 [TEST_REPORT.md](TEST_REPORT.md)。

---

## 在电脑上启动（Windows）

需要 Node.js 22（本机已验证 v22.17）。

```powershell
cd C:\Users\user\Dropbox\Project\PersonalKitchenOS
npm install
npm run build
npm run serve
```

浏览器打开 <http://127.0.0.1:8787>。开发时用 `npm run dev`。

> 这个目录在 Dropbox 里，`node_modules`、`dist` 等已标记为不同步。换电脑后这些目录是空的，先运行 `npm install`，再运行下面的命令重新标记（在项目目录的 PowerShell 里）：
> ```powershell
> foreach ($d in 'node_modules','dist','test-results','playwright-report') { Set-Content -LiteralPath $d -Stream com.dropbox.ignored -Value 1 }
> ```

---

## 装到 Android 手机

PWA 的离线和安装功能要求 **HTTPS**（或手机自己的 localhost）。直接用 `http://192.168.x.x:8787` 打开只能当普通网页用：不能离线，不能安装。所以三选一：

| 方案 | 适合 | 需要 | 电脑关机后 | 手机上的真实 AI |
|---|---|---|---|---|
| **A. GitHub Pages（推荐）** | 大多数情况 | GitHub 账号，公开仓库 | 正常用 | **有**：手机直连 Gemini |
| **B. Tailscale** | 不想把 Key 放手机，或用 Ollama | 手机和电脑都装 Tailscale | 正常用，只是 AI 不可用 | 有（电脑开机时） |
| **C. USB 线 + adb** | 不想注册任何账号 | Android SDK platform-tools，手机开 USB 调试 | 正常用 | 没有 |

> **最重要的一点：数据跟着「网址」走。** 换一个网址打开，就是一个全新的空库。换方案前，先在旧地址 `⋯ → 导出完整备份`，再到新地址恢复。

### 方案 A：GitHub Pages

发布的只有页面和菜谱目录，你的库存不会上传（它们在手机里）。但仓库是公开的，食材目录和菜谱都看得见。

```powershell
cd C:\Users\user\Dropbox\Project\PersonalKitchenOS
git init
git add .
git commit -m "Personal Kitchen OS v3"
git branch -M main
git remote add origin https://github.com/<你的用户名>/PersonalKitchenOS.git
git push -u origin main
```

1. 先在 GitHub 新建空仓库 `PersonalKitchenOS`，再运行上面的 push。
2. 仓库 Settings → Pages → Source 选 **GitHub Actions**。之后每次 push 自动发布（`.github/workflows/pages.yml`）。
3. 手机 Chrome 打开 `https://<你的用户名>.github.io/PersonalKitchenOS/`，等页面加载完。
4. Chrome 右上角 `⋮` → **安装应用** 或 **添加到主屏幕**。
5. 打开一次后开飞行模式确认能用。
6. 想用 AI：`⋯ → AI 助手`，打开开关，连接方式选「手机直连 Gemini」，粘贴 API Key。建议给手机单独建一个 Key，手机丢了只删这一个。

Key 不在仓库和网站代码里，只存在这台手机的浏览器中。它能被手机上的这个网站读取，所以 App 不加载任何第三方脚本。规格书原本要求密钥走中转；这里按你的选择放在自己手机上，换来的是不用电脑、不用 VPN。

### 方案 B：Tailscale（手机也能用 AI）

Tailscale 给电脑一个固定的 HTTPS 地址，只有你自己的设备能访问，不暴露到公网。

1. 电脑和手机都装 Tailscale，登录同一账号。
2. 在 Tailscale 后台的 DNS 页（console.tailscale.com/admin/dns）开启 MagicDNS 和 HTTPS。电脑名会写进公开的证书日志，名字里别带敏感信息。
3. 配好下面的「接入 AI」，并在 `.env` 里写：
   ```ini
   KITCHEN_HELPER_TOKEN=一串至少16位的随机字符
   KITCHEN_PUBLIC_URL=https://你的电脑名.你的tailnet.ts.net
   ```
4. 启动：
   ```powershell
   npm run build
   npm run serve
   tailscale serve --bg --https=443 localhost:8787
   ```
5. 手机扫终端里的二维码，会打开 App 并自动配对。然后按上面的方式安装。

`.env` 里固定口令后，重启服务不用重新配对。

如果 App 装在方案 A 的地址，但想用这里的 AI：在 `.env` 加 `KITCHEN_ALLOWED_ORIGINS=https://<你的用户名>.github.io`，然后在 App 的 `⋯ → AI 助手` 填辅助服务地址和口令。

### 方案 C：USB + adb

```powershell
npm run build
npm run serve
adb reverse tcp:8787 tcp:8787
```

手机 Chrome 打开 `http://localhost:8787`，安装。之后拔线也能用。更新 App 时才需要重新连线。

---

## 接入 AI（可选）

```powershell
copy .env.example .env
```

**Gemini 免费额度（当前配置）**：

1. 到 <https://aistudio.google.com/apikey> 创建 API Key，不用绑信用卡。
2. 打开项目里的 `.env`，填上 `GEMINI_API_KEY=你的密钥`。
3. 运行 `npm run ai:check`，用 8 句话测试模型和校验链（约 2 分钟，消耗 8 次免费额度）。只想测一句：`npm run ai:check -- 今天外食`。
4. 运行 `npm run serve`，打开它打印的配对链接。

默认模型 `gemini-3.5-flash-lite`，可用 `GEMINI_MODEL` 更换。免费额度以 [AI Studio 限额页](https://aistudio.google.com/rate-limit) 为准，每日额度在太平洋时间午夜重置。用完时 App 自动改用本地规则，并提示 AI 暂不可用。**免费版的内容可能被 Google 用于改进产品**，不想这样就绑定付费或改用 Ollama。

> `.env` 已标记为不让 Dropbox 同步。这个标记可能被整文件重写的编辑器冲掉，所以 `npm run serve` 和 `npm run ai:check` 每次启动都会检查并补上；补过时终端会提示。为了稳妥，建议用 VS Code 编辑，存好 Key 后立刻运行 `npm run ai:check`。

**本地模型（数据不出电脑）**：安装 [Ollama](https://ollama.com)，然后

```powershell
ollama pull qwen2.5:7b
```

```ini
KITCHEN_AI_PROVIDER=ollama
OLLAMA_MODEL=qwen2.5:7b
```

任何支持 JSON Schema `format` 的 Ollama 模型都可以，模型名是示例。

**云端模型（你主动启用才会用）**：

```ini
KITCHEN_AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=你的密钥
ANTHROPIC_MODEL=claude-opus-5-5
```

默认模型是 Opus 5.5。这个任务只是解析一句话，想省钱可以改成 `claude-haiku-5-5`。已开启 `fallbacks: "default"`，被安全分类器拒绝时由服务端换模型重试。

改完 `.env` 后重启 `npm run serve`。打开它打印的配对链接，或在 `⋯ → AI 助手` 里开启，看到「AI 可用」就是连上了。

**会发送什么**：你这句话、今天和明天的餐次安排、熟菜名称、菜谱名称、当前日期。**不发送**库存数量、流水、价格、备份。选 Ollama 时这些不离开电脑，选云端时会发给云服务商。

**没有 AI 时**：一句话输入改用本地规则识别，界面明确标注「本地规则（非 AI）」。它只认常见说法，认不出时给快捷按钮。

### AI 的边界

```
你的一句话 → 模型或规则 → JSON 草稿 → 白名单校验 → 程序算日期、核对证据
         → 预览（真实执行但丢弃结果）→ 你确认 → 事务写入 + 审计
```

- 模型只能输出 19 种白名单动作，多一个字段都会被拒绝。
- 日期由程序解析，模型算错了以你的原话为准。
- 涉及库存事实的动作，食材和数量必须能在你的原话里找到，否则拒绝。
- 辅助服务没有任何写数据的接口，也不保存你的数据。

---

## 数据和密钥放在哪

| 内容 | 位置 | 进备份吗 |
|---|---|---|
| 库存、计划、熟菜、流水、菜谱改动 | 手机浏览器 IndexedDB | 进 |
| AI 原话和草稿 | 同上，可在设置里清除 | 进 |
| 手机直连时的 Gemini Key、辅助服务地址和配对口令 | 手机浏览器 localStorage | 不进 |
| 辅助服务用的模型 API Key | 电脑的 `.env`（不进 git，已标记不同步到 Dropbox） | 不进 |

---

## 备份和恢复

`⋯ → 导出完整备份（JSON）`：完整快照加全部流水，带版本号和校验。**建议每两周导出一次，存到手机以外的地方。**

`⋯ → 从备份恢复`：先校验（损坏、版本过新、有负库存都会拒绝），确认后整库替换，一个事务内完成。**恢复不能撤销，会覆盖当前数据。**

IndexedDB 不是永久安全的备份：清除 Chrome 的网站数据、卸载 PWA、系统清理存储都可能删掉它。`⋯` 里可以申请持久存储，能降低风险，但不能替代备份。

同一页还能导出 CSV：库存批次、库存流水、食用记录。

---

## 日常用法

| 想做的事 | 操作 |
|---|---|
| 正常做饭 | 打开 → **开始做** → **做完并开吃** |
| 吃剩菜 | 打开 → **吃掉这份**（只减熟菜） |
| 午餐外食 | **今天外食 / 只吃一顿** → 午餐外食，或说一句话 |
| 训练后加餐 | **加餐** → 选一项 |
| 买菜 | 采购 → 生成清单 → 勾选实际买到的 → 确认入库 |
| 记错了 | 操作后的提示点 **撤销**，或首页 **记错了？** |
| 看两周安排 | 首页 **14 天计划** |
| 做菜谱库里的菜 | 菜谱 → **我的菜谱库**，或说「今天中午吃三杯鸡」 |
| 批量更新库存 | 打开库存链接，确认一次（链接用 `npm run stock:link` 生成） |
| 看吃了多少碳水、蛋白质、脂肪 | 首页底部 **营养记录**；一道菜的一份在菜谱详情里看 |
| 查酱汁、腌料、食材营养 | 菜谱页底部 **酱汁、腌料和营养资料** |

**第一次用**：首页点「家里的食材还没核对」，把确定的项点「有 / 没有」，数量可以不填。没核对的食材会一直显示「数量待核对」，App 不会编造数量。

---

## 实现状态

### P0 可用版：已完成

本地 PWA 与离线；7 道固定菜、10 个风味变体、5 道备选、2 个加餐；用户自己的菜谱库 29 道（不进自动推荐）；真实库存批次与不可变流水（FEFO、冷藏/冷冻分批、不允许负库存、数量未知不算无穷）；计划/准备/做完/食用/跳过分离；熟菜批次；14 天计划和局部重排；外食、只吃一顿、加餐、多吃一份、换菜；一键合并「做完并开吃」；用量修正（补偿流水）；幂等键防重复；补偿式撤销和冲突检查；14 天净采购（包装、保质窗口、替代建议）；核对后一次入库、复制上次、新建商品；JSON 备份恢复和 CSV；首次核对；中英文别名和单位换算；食品安全窗口和提醒。

### P1 AI 增强版：已用真实 Gemini 验证

已实现并用 `gemini-3.5-flash-lite` 真实跑通：`AIProvider`、本地中转服务（口令、限流、CORS 白名单）、白名单 schema、证据校验、预览确认、降级。

真实验证只有 8 句典型的话，不代表所有说法都能理解准确；所有改动确认前都会预览。Ollama 和 Anthropic 适配器只用假端点测过。详见测试报告。

### P2：未实现

语音输入、购物车截图/收据识别、ICS 或日历同步、推送通知、菜谱批量导入、多设备同步。界面上没有这些功能的按钮。

### P2：营养估算，已实现

不用额外录入：按做饭时记下的实际用量和吃掉的份数推算碳水、蛋白质、脂肪和热量，修正用量和撤销会自动反映。没有目标、打卡和图表，入口在首页底部的 **营养记录**。

数字是偏保守的大概值：

- 烹调油按每份 10g 估算，在营养记录页底部可改，加餐类的菜不算油。调味料和腌料没算。
- 配饭这类可选食材要在做饭页点一下才算；不点，碳水会少一大截。
- 不在菜谱里的食物（饺子、火鸡面、牛肉罐头、毛豆等）在首页说一句「吃了 8 个粉丝饺子」就能记进来，都记在加餐下面。
- 外食、没说数量的加餐、用户自建的食材算不出来，页面上会列出「没算进去」，不按 0 计入。
- 数字按生重。排骨和琵琶腿是带骨称重，会算高；五花肉没有扣除煸出的油。牛奶按全脂，牛肉片按 flank 牛排。
- 数据优先用实际买的产品标签和用户的营养清单，没有的取自 USDA FoodData Central（SR Legacy）。

### P0/P1 中做得比较轻或没做的

- **饥饿程度**只影响首页一句提示，不改变份数。**忙碌**只提高快手菜排序。
- **提醒只在 App 内显示**，不做系统推送。
- **菜谱**界面可改用量、备注、启用状态；步骤不能在界面里改。
- **菜谱库**来自用户的配方笔记。笔记没写的主料用量用每顿约 250g 的初始值，耗时是估算，都可以在菜谱里改。固定 7 道菜的步骤还是按当天切配写的，没有改成「腌好的肉」。
- **厨具**：代码只收录菜谱实际用到的类型，完整情况见 [docs/kitchen-profile.md](docs/kitchen-profile.md)。
- **商品规格、替代关系、价格**有数据表，界面没有编辑入口；蘑菇、胡萝卜、小葱之外的包装规格显示「规格待核对」。
- `nutrition_preferences` 表没有建（规格标注为非强制）。
- **备份升级链**目前只有 v1，升级机制用模拟步骤测过，还没有真实迁移。
- **撤销是严格模式**：后面的操作改过同一条记录时，要先撤销后面那个。
- **多标签页**不实时同步，回到前台时刷新；写入都在事务里，不会损坏数据。
- 推荐权重、保存天数（熟菜冷藏 3 天、解冻生肉 2–3 天）都是保守的初始值，不是食品安全保证。拿不准就丢掉。

---

## 项目结构

```
src/domain/     纯 TypeScript 业务规则（命令、库存、排餐、推荐、采购、撤销），不依赖 React 和数据库
src/domain/ai/  草稿 schema、日期解析、规则解析、证据校验
src/domain/library.ts     用户的菜谱库和备用食材
src/domain/references.ts  只读资料：酱汁、腌料、料理速查
src/domain/nutrition.ts   静态资料：食材营养，也是估算的数据来源
src/domain/intake.ts      从做饭和食用记录推算营养，不存结果
src/data/       IndexedDB 事务、备份、CSV
src/ai/         前端 AI 客户端
src/ui/         React 界面
server/         本地辅助服务（托管 PWA、转发模型请求）
tests/          domain、data、server 测试，以及 e2e 浏览器测试
```

```powershell
npm run typecheck   # 类型检查
npm test            # 单元和集成测试
npm run test:e2e    # 浏览器端到端（首次运行先 npx playwright install chromium）
```
