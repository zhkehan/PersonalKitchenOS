import type { Id } from './types';

/**
 * 食材营养数据，也是营养估算的唯一来源。
 * 优先用用户实际买的产品标签，其次是用户的饮食营养清单；都没有的项取自 USDA，带 fdcId。
 * null 表示没有数据，不是 0。这里是静态资料，不写数据库。
 */
export interface NutritionFact {
  name: string;
  /** 对应库存目录的食材；没有对应项时为 null。 */
  ingredientId: Id | null;
  serving: string;
  /** 这一行相当于多少规范单位（g、ml 或计数）。null 表示这一行不参与计算。 */
  basis: number | null;
  kcal: number;
  carbs: number | null;
  protein: number | null;
  fat: number | null;
  fiber: number | null;
  /** USDA FoodData Central（SR Legacy）编号。 */
  fdcId?: number;
  note?: string;
}

export interface Macros {
  kcal: number;
  carbs: number;
  protein: number;
  fat: number;
}

const row = (name: string, ingredientId: Id | null, serving: string, basis: number | null, kcal: number, carbs: number | null, protein: number | null, fat: number | null, fiber: number | null, note?: string): NutritionFact =>
  ({ name, ingredientId, serving, basis, kcal, carbs, protein, fat, fiber, ...(note ? { note } : {}) });

const usda = (fdcId: number, name: string, ingredientId: Id, serving: string, basis: number, kcal: number, carbs: number, protein: number, fat: number, opts: { fiber?: number; note?: string } = {}): NutritionFact =>
  ({ name, ingredientId, serving, basis, kcal, carbs, protein, fat, fiber: opts.fiber ?? null, fdcId, ...(opts.note ? { note: opts.note } : {}) });

export const NUTRITION_FACTS: NutritionFact[] = [
  row('燕麦（干）', 'oats', '40g', 40, 152, 26, 5.6, 2.9, 4),
  row('脱脂马苏里拉', 'mozzarella', '28g', 28, 45, 1, 10, 0, 0),
  row('全脂牛奶（3.25%）', 'milk', '260g（约 252ml）', 252, 159, 12.4, 8.2, 8.5, 0, '牛奶按全脂计算'),
  row('1% 低脂牛奶', 'milk', '260g', null, 109, 12.7, 8.8, 2.6, null),
  row('鸡蛋', 'egg', '2 个（约 110g）', 2, 148, 0.8, 12.6, 10.4, 0),
  row('白米（生重）', 'rice', '120g', 120, 438, 96, 8.4, 0.9, 1.5),
  row('Russet 土豆（带皮，生重）', 'potato', '380g（1 个大号）', 380, 330, 76.4, 8.7, 0.4, 11),
  row('意面（干重）', 'pasta', '80g', 80, 286, 57, 10.4, 1.6, 2.8),
  row('牛肉碎（93/7，生重）', 'ground_beef', '112g（4 oz）', 112, 170, 0, 23, 8, 0, '产品标签；饱和脂肪 3.5g，反式脂肪 0.5g，胆固醇 70mg，钠 75mg。'),
  row('鸡胸肉（生重）', 'chicken_breast', '150g', 150, 165, 0, 34.5, 1.8, 0),
  row('乳清蛋白粉', 'protein_powder', '30g', 30, 120, 2, 25, 1, 0),
  row("全谷物面包（Dave's Killer 21 全谷物）", 'whole_grain_bread', '1 片（45g）', 1, 110, 22, 6, 1.5, 4, '产品标签；添加糖 4g，钠 170mg'),
  row('白吐司', 'white_toast', '1 片', 1, 95, 19, 3, 1, 0.8),
  row('香蕉（中等）', 'banana', '1 根（约 118g）', 1, 105, 27, 1.3, 0.4, 3.1),
  row('芝士片', 'cheese_slice', '1 片', 1, 73, 0.7, 5, 6, 0),
  row('沙丁鱼罐头（水浸）', 'canned_sardine', '1 罐（124g）', 1, 155, 0, 22, 7, 0),
  row('罗非鱼（生重）', 'frozen_fish', '112g（4 oz，约 1 片）', 112, 90, 0, 20, 2, 0, '产品标签；维生素 D 3.5mcg，钾 340mg，胆固醇 40mg。脂肪低，但不含 omega-3 和钙，不能代替沙丁鱼。'),
  row('鹰嘴豆（干豆自煮，熟重）', 'chickpea', '约 375g（干豆约 150g）', 375, 514, 94, 30, 9, 17, '产品标签换算：35g 干豆 120 kcal'),
  row('番茄罐头（切块）', 'canned_tomato', '1 罐（411g）', 1, 82, 18, 4, 0.5, 4),
  row('食用油', null, '10g', null, 89, 0, 0, 10, 0),
  row('脱脂酸奶（无添加）', 'yogurt', '170g', 170, 100, 7, 17, 0, 0),
  row('芝麻酱（Tahini）', 'tahini', '2.5g', null, 15, 0.5, 0.4, 1.3, 0.2),
  row('可可粉', 'cocoa_powder', '5g（1 tbsp）', null, 10, 3, null, 0.5, 2, "蛋白质不足 1g。Hershey's Special Dark"),
  row('鸡肝（生重）', 'chicken_liver', '112g（4 oz）', 112, 120, 1, 19, 3.5, 0, '维生素 A 470%，铁 50%，维 C 40%，胆固醇 385mg。一周最多一次，孕期慎食。'),
  row('牛肝 / 小牛肝（生重）', 'beef_liver', '112g', 112, 150, 4, 23, 4, 0, '维生素 A 380%，铁 30%，维 C 2%，钾 351mg，胆固醇 310mg。一周最多一次，孕期慎食。'),
  // 热量和纤维来自笔记，碳水、蛋白质、脂肪按同样重量取自 USDA。
  usda(170393, '胡萝卜', 'carrot', '1 根（约 61g）', 1, 25, 5.8, 0.6, 0.1, { fiber: 1.7 }),
  usda(169968, '西兰花', 'frozen_broccoli', '49g', 49, 17, 2.3, 1.4, 0.1, { fiber: 1.3 }),
  usda(169239, '羽衣甘蓝', 'frozen_kale', '40g', 40, 21, 2, 1.1, 0.2, { fiber: 0.7 }),
  usda(168448, '南瓜', 'frozen_pumpkin', '40g', 40, 13, 2.6, 0.4, 0, { fiber: 0.6 }),
  // 用户实际买的产品标签。
  row('甜豌豆（Great Value 冷冻）', 'frozen_sweet_peas', '1/2 杯（85g）', 85, 70, 12, 4, 0, 5, '产品标签；钠 60mg，铁 1mg，钾 94mg'),
  row('冷冻玉米（Great Value）', 'frozen_corn', '2/3 杯（86g）', 86, 80, 18, 3, 0.5, 2, '产品标签；总糖 2g，钠 0mg，钾 183mg'),
  row('毛豆仁（Seapoint Farms 冷冻）', 'edamame', '1/2 杯（75g）', 75, 110, 8, 10, 3, 5, '产品标签；钠 10mg，钙 60mg，铁 1.9mg，钾 320mg'),
  row('冷冻辣椒洋葱（Great Value）', 'frozen_pepper_onion', '1 杯（84g）', 84, 25, 5, 1, 0, 1, '产品标签；总糖 3g，钠 10mg，钾 110mg'),
  row('冷冻虾（16–20 只/磅）', 'frozen_shrimp', '4 oz（113g，约 4 只）', 113, 80, 1, 15, 1, 0, '产品标签；加了水、盐和三聚磷酸钠保水，蛋白质比纯虾低。钠 520mg，胆固醇 140mg。'),
  row('牛肉罐头（Great Value，已熟）', 'canned_roast_beef', '1 罐（12 oz，约 3.5 份）', 1, 385, 0, 70, 8.8, 0, '产品标签：3 oz（84g）一份 110 kcal、脂肪 2.5g、蛋白质 20g，这里按 3.5 份折算成一罐。钠 440mg/份，胆固醇 55mg/份。'),
  row('粉丝', 'glass_noodle', '1 小袋（38g，干重）', 1, 140, 34, 0, 0, 1, '产品标签；钠 0mg'),
  row('火鸡面（三养奶油款）', 'buldak_noodle', '1 包（130g）', 1, 550, 84, 8, 20, 3, '产品标签；饱和脂肪 10g，钠约 1330mg（58% DV）'),
  row('猪肉饺子（bibigo）', 'pork_dumpling', '13 个（140g）', 13, 250, 31, 10, 9, 2, '产品标签；饱和脂肪 3g，钠 640mg'),
  row('粉丝饺子（bibigo）', 'glass_noodle_dumpling', '8 个（86g）', 8, 120, 19, 7, 1.5, 1, '产品标签；钠 370mg'),
  row('奇亚籽（Great Value 有机）', 'chia_seed', '2 汤匙（24g）', 24, 130, 9, 4, 8, 8, '产品标签；钙 150mg，铁 2.2mg。照片里蛋白质被折痕挡住，按 USDA 估算；碳水按 3% DV 判读为 9g。'),
  row('火锅底料（海底捞）', 'hotpot_base', '1 块（90g，约 3 份）', 1, 510, 21, 6, 48, 3, '产品标签：1/3 块（30g）170 kcal、脂肪 16g、钠 1510mg，这里折算成一块。汤底通常不会喝完，按全吃算会偏高。'),
  // 笔记里没有的食材。都是生重。
  usda(169703, '糙米（生重）', 'brown_rice', '100g', 100, 367, 76.3, 7.5, 3.2),
  usda(168230, '猪里脊（瘦，生重）', 'pork_loin', '100g', 100, 143, 0, 21.4, 5.7),
  usda(169563, '牛肉片（按 flank 牛排，生重）', 'beef_slices', '100g', 100, 155, 0, 21.2, 7.2, { note: '按瘦牛排估算，换了部位时脂肪差别较大。' }),
  usda(172373, '琵琶腿（带皮，生重）', 'chicken_drumstick', '100g', 100, 161, 0.1, 18.1, 9.2, { note: '数字按可食部分，带骨称重时会算高。' }),
  usda(167853, '排骨（生重）', 'pork_ribs', '100g', 100, 277, 0, 15.5, 23.4, { note: '数字按可食部分，带骨称重时会算高。' }),
  usda(167812, '五花肉（生重）', 'pork_belly', '100g', 100, 518, 0, 9.3, 53),
  usda(168936, '面粉', 'flour', '100g', 100, 364, 76.3, 10.3, 1),
  usda(168893, '全麦面粉', 'wholewheat_flour', '100g', 100, 340, 72, 13.2, 2.5),
  usda(170000, '黄洋葱', 'yellow_onion', '100g', 100, 40, 9.3, 1.1, 0.1),
  usda(170005, '小葱', 'scallion', '1 把（约 40g）', 1, 13, 2.9, 0.7, 0.1, { note: '一把的重量按菜谱里的「0.25 把约 10g」估算。' }),
  usda(168434, '褐蘑菇', 'mushroom', '100g', 100, 22, 4.3, 2.5, 0.1),
  usda(169251, '白蘑菇', 'white_mushroom', '100g', 100, 22, 3.3, 3.1, 0.3),
  usda(170427, '青椒', 'green_pepper', '1 个（约 119g）', 1, 24, 5.5, 1, 0.2),
  usda(170108, '彩椒', 'bell_pepper', '1 个（约 119g）', 1, 31, 7.2, 1.2, 0.4),
  usda(170457, '番茄', 'tomato', '1 个（约 123g）', 1, 22, 4.8, 1.1, 0.2),
  usda(169961, '四季豆', 'green_bean', '100g', 100, 31, 7, 1.8, 0.2),
  usda(170471, '冷冻混合蔬菜', 'frozen_mixed_veg', '100g', 100, 72, 13.5, 3.3, 0.5),
  usda(169287, '冷冻菠菜', 'frozen_spinach', '100g', 100, 29, 4.2, 3.6, 0.6),
  usda(169988, '芹菜', 'celery', '100g', 100, 14, 3, 0.7, 0.2),
  usda(169246, '大葱', 'leek', '100g', 100, 61, 14.2, 1.5, 0.3),
];

export const nutritionFor = (ingredientId: Id): NutritionFact[] => NUTRITION_FACTS.filter((n) => n.ingredientId === ingredientId);

/** 一行文字。缺失的项不显示，不当作 0。 */
export function nutritionLine(n: NutritionFact): string {
  const parts: string[] = [`${n.kcal} kcal`];
  if (n.carbs !== null) parts.push(`碳水 ${n.carbs}g`);
  if (n.protein !== null) parts.push(`蛋白质 ${n.protein}g`);
  if (n.fat !== null) parts.push(`脂肪 ${n.fat}g`);
  if (n.fiber !== null) parts.push(`纤维 ${n.fiber}g`);
  return parts.join(' · ');
}

export const NO_MACROS: Macros = { kcal: 0, carbs: 0, protein: 0, fat: 0 };

export const addMacros = (a: Macros, b: Macros): Macros =>
  ({ kcal: a.kcal + b.kcal, carbs: a.carbs + b.carbs, protein: a.protein + b.protein, fat: a.fat + b.fat });

export const scaleMacros = (m: Macros, k: number): Macros =>
  ({ kcal: m.kcal * k, carbs: m.carbs * k, protein: m.protein * k, fat: m.fat * k });

/** 用量按规范单位（g、ml 或计数）。没有完整数据时返回 null，调用方不能当作 0。 */
export function macrosOf(ingredientId: Id, qty: number): Macros | null {
  const f = NUTRITION_FACTS.find((n) => n.ingredientId === ingredientId && n.basis !== null && n.carbs !== null && n.protein !== null && n.fat !== null);
  if (!f) return null;
  return scaleMacros({ kcal: f.kcal, carbs: f.carbs!, protein: f.protein!, fat: f.fat! }, qty / f.basis!);
}

/** 烹调油没有称重记录，只能按克数估算。 */
export function oilMacros(grams: number): Macros {
  const oil = NUTRITION_FACTS.find((n) => n.name === '食用油')!;
  return scaleMacros({ kcal: oil.kcal, carbs: 0, protein: 0, fat: oil.fat! }, grams / 10);
}

/** 估算值，取整后显示，不给假精度。 */
export function macroLine(m: Macros): string {
  return `${Math.round(m.kcal)} kcal · 碳水 ${Math.round(m.carbs)}g · 蛋白质 ${Math.round(m.protein)}g · 脂肪 ${Math.round(m.fat)}g`;
}
