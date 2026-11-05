# Personal Kitchen OS

个人厨房系统。没有 App：在 Claude Code 里说话，比如「今天吃什么」「做了黑椒鸡丁，吃了一份」「买了 2 lb 牛肉」。Claude 负责听懂，程序负责库存、计划、采购和营养。

## 怎么用

在这个目录打开 Claude Code，直接说。在外面时用手机的 Remote Control 连到电脑，电脑要开着。

不用记任何命令，规则都在 [CLAUDE.md](CLAUDE.md)。想自己查也可以：

```bash
npm install                     # 第一次
npm run -s kitchen -- today     # 今天吃什么
npm run -s kitchen -- stock     # 库存
npm run -s kitchen -- help      # 全部动作
```

## 数据

全部真实数据在 `data/kitchen.json`，不进 git。Dropbox 同步它并保留版本历史，`data/backups/` 每天再留一份。

## 数字怎么算

- **营养**按做饭时记下的实际用量和吃掉的份数推算。烹调油默认每份 10g，可以改；调味料和腌料不算。
- **数据来源**优先用实际买的产品标签和用户的营养清单，没有的取自 USDA FoodData Central（SR Legacy）。
- **算不出来的不按 0 计入**：外食、没说数量的加餐会列在「没算进去」。
- 配饭这类可选食材要说了才算，不说的话碳水会少很多。
- 排骨和琵琶腿按带骨称重，会算高；五花肉没有扣除煸出的油。牛奶按全脂，牛肉片按 flank 牛排。

## 测试

```bash
npm run typecheck
npm test
```

## 历史

这里以前是手机 PWA。`3f5b191` 及之前的提交里有完整的网页、离线、模型接入和辅助服务。
