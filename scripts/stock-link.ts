/**
 * 生成库存链接。清单放在仓库外面，只有链接里有真实数量。
 *
 *   npm run stock:link -- 清单.json
 *
 * 清单格式：
 *   {
 *     "stock": [["ground_beef", 7, "lb"], ["egg", 4]],   设成这个总量
 *     "add":   [["frozen_corn", 12, "oz"], ["egg", -2]], 在现有数量上增减
 *     "have":  ["cumin"]                                 调料标记为「有」
 *   }
 *
 * 食材 id 在 src/domain/seed.ts 和 library.ts。对不上目录时报错退出，不生成链接。
 */
import { readFileSync } from 'node:fs';
import { seedState } from '../src/domain/seed';
import { encodeStockLink, previewStockLink, readStockLink, type StockLink } from '../src/domain/stockLink';

const APP_URL = 'https://zhkehan.github.io/PersonalKitchenOS/';

const file = process.argv[2];
if (!file) {
  console.error('用法：npm run stock:link -- 清单.json');
  process.exit(1);
}

const input = JSON.parse(readFileSync(file, 'utf8')) as Partial<StockLink>;
const id = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const encoded = encodeStockLink({ id, stock: input.stock ?? [], ...(input.add ? { add: input.add } : {}), have: input.have ?? [] });

const link = readStockLink(`#stock=${encoded}`);
if (!link) {
  console.error('清单格式不对');
  process.exit(1);
}
const preview = previewStockLink(seedState(), link);
if (preview.skipped.length > 0) {
  console.error(`对不上目录：${preview.skipped.join('、')}`);
  process.exit(1);
}

for (const l of preview.lines) console.log(`${l.name}  ${l.label}`);
if (preview.haveNames.length > 0) console.log(`调料有：${preview.haveNames.join('、')}`);
console.log(`\n${APP_URL}#stock=${encoded}`);
