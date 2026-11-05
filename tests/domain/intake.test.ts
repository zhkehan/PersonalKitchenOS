import { describe, expect, it } from 'vitest';
import { resolveProposal } from '../../src/domain/ai/resolve';
import { ruleParse } from '../../src/domain/ai/ruleParser';
import { addDays } from '../../src/domain/dates';
import { dayIntake, recentIntake, recipeServing } from '../../src/domain/intake';
import { macroLine, macrosOf, NUTRITION_FACTS } from '../../src/domain/nutrition';
import { seedState } from '../../src/domain/seed';
import { Kitchen, TODAY } from './helpers';

const TOMORROW = addDays(TODAY, 1);

/** 鸡胸 454g + 蘑菇 120g + 洋葱 80g，不含配饭。 */
const R01_TOTAL = { kcal: 557.8, carbs: 12.6, protein: 108.3, fat: 5.648 };

function cookR01(k: Kitchen, input: Record<string, unknown> = {}) {
  return k.run('finishCook', { recipeId: 'R01', servings: 2, eatNow: 1, date: TODAY, slot: 'lunch', ...input });
}

describe('食材换算', () => {
  it('目录里所有实物食材都有数据，调味品除外', () => {
    const missing = seedState().ingredients.filter((i) => i.unit !== 'level' && macrosOf(i.id, 1) === null).map((i) => i.name);
    expect(missing).toEqual([]);
  });

  it('每种食材只有一行参与计算，基准都是正数', () => {
    for (const n of NUTRITION_FACTS) if (n.basis !== null) expect(n.basis, n.name).toBeGreaterThan(0);
    const ids = NUTRITION_FACTS.filter((n) => n.basis !== null && n.ingredientId).map((n) => n.ingredientId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('按规范单位换算：克和计数', () => {
    expect(macrosOf('rice', 60)?.carbs).toBeCloseTo(48);
    expect(macrosOf('egg', 1)?.kcal).toBeCloseTo(74);
    expect(macrosOf('canned_tomato', 0.5)?.kcal).toBeCloseTo(41);
  });

  it('牛奶按全脂算；没有数据时返回 null，不是 0', () => {
    expect(macrosOf('milk', 252)?.fat).toBeCloseTo(8.5);
    expect(macrosOf('olive_oil', 10)).toBeNull();
    expect(macrosOf('不存在', 10)).toBeNull();
  });

  it('牛肉碎按 93/7 标签换算：500g 一锅', () => {
    const m = macrosOf('ground_beef', 500)!;
    expect(m.kcal).toBeCloseTo(758.9, 1);
    expect(m.protein).toBeCloseTo(102.7, 1);
    expect(m.fat).toBeCloseTo(35.7, 1);
  });

  it('虾用实际标签，加水的虾蛋白质比 USDA 纯虾低', () => {
    expect(macrosOf('frozen_shrimp', 113)).toEqual({ kcal: 80, carbs: 1, protein: 15, fat: 1 });
  });

  it('其他实际买的标签', () => {
    expect(macrosOf('frozen_sweet_peas', 85)).toEqual({ kcal: 70, carbs: 12, protein: 4, fat: 0 });
    expect(macrosOf('frozen_corn', 86)).toEqual({ kcal: 80, carbs: 18, protein: 3, fat: 0.5 });
    expect(macrosOf('edamame', 75)).toEqual({ kcal: 110, carbs: 8, protein: 10, fat: 3 });
    expect(macrosOf('frozen_pepper_onion', 84)).toEqual({ kcal: 25, carbs: 5, protein: 1, fat: 0 });
    expect(macrosOf('frozen_fish', 112)).toEqual({ kcal: 90, carbs: 0, protein: 20, fat: 2 });
    expect(macrosOf('glass_noodle', 1)).toEqual({ kcal: 140, carbs: 34, protein: 0, fat: 0 });
  });

  it('包装食品按包、按个、按块算', () => {
    expect(macrosOf('buldak_noodle', 1)).toEqual({ kcal: 550, carbs: 84, protein: 8, fat: 20 });
    expect(macrosOf('pork_dumpling', 13)).toEqual({ kcal: 250, carbs: 31, protein: 10, fat: 9 });
    expect(macrosOf('glass_noodle_dumpling', 8)).toEqual({ kcal: 120, carbs: 19, protein: 7, fat: 1.5 });
    expect(macrosOf('hotpot_base', 1 / 3)?.kcal).toBeCloseTo(170);
    expect(macrosOf('chia_seed', 24)?.fat).toBe(8);
  });

  it('牛肉罐头按标签的 3.5 份算一罐', () => {
    expect(macrosOf('canned_roast_beef', 1)).toEqual({ kcal: 385, carbs: 0, protein: 70, fat: 8.8 });
    expect(macrosOf('canned_roast_beef', 0.5)?.protein).toBeCloseTo(35);
  });

  it('显示取整，不给假精度', () => {
    expect(macroLine({ kcal: 304.2, carbs: 6.3, protein: 59.44, fat: 3.1 })).toBe('304 kcal · 碳水 6g · 蛋白质 59g · 脂肪 3g');
  });
});

describe('一道菜的一份', () => {
  it('按份数平摊必选食材，调味品不计也不算缺失', () => {
    const s = recipeServing(seedState(), 'R01');
    expect(s.macros.kcal).toBeCloseTo(R01_TOTAL.kcal / 2 + 89);
    expect(s.macros.protein).toBeCloseTo(R01_TOTAL.protein / 2);
    expect(s.macros.carbs).toBeCloseTo(R01_TOTAL.carbs / 2);
    expect(s.macros.fat).toBeCloseTo(R01_TOTAL.fat / 2 + 10);
    expect(s.counted).toBe(3);
    expect(s.uncounted).toEqual([]);
  });

  it('可选的配饭单独列出，不混进基础数字', () => {
    const rice = recipeServing(seedState(), 'R01').extras.find((e) => e.name === '大米');
    expect(rice?.macros.carbs).toBeCloseTo(60);
  });

  it('实物食材缺数量时要说出来，不能按 0 算', () => {
    const state = seedState();
    state.recipe_ingredients = state.recipe_ingredients.map((r) => (r.recipeId === 'R01' && r.ingredientId === 'mushroom' ? { ...r, qty: null } : r));
    const s = recipeServing(state, 'R01');
    expect(s.uncounted).toEqual(['褐蘑菇']);
    expect(s.counted).toBe(2);
  });

  it('跟随用户微调过的默认用量', () => {
    const k = new Kitchen();
    const row = k.state.recipe_ingredients.find((r) => r.recipeId === 'R01' && r.ingredientId === 'chicken_breast')!;
    k.run('updateRecipe', { recipeId: 'R01', ingredientQty: [{ rowId: row.id, qty: 250 }] });
    expect(recipeServing(k.state, 'R01').macros.protein).toBeCloseTo((57.5 + 3 + 0.88) / 2);
  });

  it('所有菜谱都算得出来，一份的热量在合理范围', () => {
    const state = seedState();
    for (const r of state.recipes) {
      const s = recipeServing(state, r.id);
      expect(s.counted, r.name).toBeGreaterThan(0);
      expect(s.uncounted, r.name).toEqual([]);
      expect(s.macros.kcal, r.name).toBeGreaterThan(40);
      expect(s.macros.kcal, r.name).toBeLessThan(2500);
    }
  });
});

describe('烹调油', () => {
  it('默认每份 10g，吃几份算几份', () => {
    const k = new Kitchen();
    cookR01(k, { eatNow: 2 });
    expect(dayIntake(k.state, TODAY).macros.fat).toBeCloseTo(R01_TOTAL.fat + 20);
  });

  it('不按锅平摊：做 4 份吃 1 份还是 10g', () => {
    const k = new Kitchen();
    cookR01(k, { servings: 4, eatNow: 1 });
    expect(dayIntake(k.state, TODAY).macros.fat).toBeCloseTo(R01_TOTAL.fat / 2 + 10);
  });

  it('可以改，菜谱和已吃的记录都跟着变；设成 0 就不算', () => {
    const k = new Kitchen();
    cookR01(k);
    k.run('setCookingOil', { grams: 5 });
    expect(recipeServing(k.state, 'R01').macros.fat).toBeCloseTo(R01_TOTAL.fat / 2 + 5);
    expect(dayIntake(k.state, TODAY).macros.fat).toBeCloseTo(R01_TOTAL.fat / 2 + 5);
    k.run('setCookingOil', { grams: 0 });
    expect(recipeServing(k.state, 'R01').oilGrams).toBe(0);
    expect(dayIntake(k.state, TODAY).macros.fat).toBeCloseTo(R01_TOTAL.fat / 2);
  });

  it('加餐类的菜不算油', () => {
    const state = seedState();
    expect(recipeServing(state, 'S02').oilGrams).toBe(0);
    const k = new Kitchen();
    k.run('finishCook', { recipeId: 'S02', servings: 1, eatNow: 1, date: TODAY, slot: 'snack' });
    expect(dayIntake(k.state, TODAY).macros.fat).toBeCloseTo(recipeServing(k.state, 'S02').macros.fat);
  });

  it('直接吃的加餐不算油', () => {
    const k = new Kitchen();
    k.run('recordSnack', { ingredientId: 'banana', qty: 1 });
    expect(dayIntake(k.state, TODAY).macros.kcal).toBeCloseTo(105);
  });

  it('油量超范围被拒绝', () => {
    expect(() => new Kitchen().run('setCookingOil', { grams: -1 })).toThrow();
  });

  it('改用油不产生库存变化，也没有可撤销的操作', () => {
    const k = new Kitchen();
    const lots = JSON.stringify(k.state.inventory_lots);
    const r = k.run('setCookingOil', { grams: 5 });
    expect(JSON.stringify(k.state.inventory_lots)).toBe(lots);
    expect(r.undoable).toBe(false);
  });
});

describe('一天吃了多少', () => {
  it('没有记录时什么都没有', () => {
    const d = dayIntake(new Kitchen().state, TODAY);
    expect(d.entries).toEqual([]);
    expect(d.uncounted).toEqual([]);
  });

  it('只算吃掉的份数，剩菜算在吃它的那天', () => {
    const k = new Kitchen();
    cookR01(k);
    const today = dayIntake(k.state, TODAY);
    expect(today.macros.protein).toBeCloseTo(R01_TOTAL.protein / 2);
    expect(today.entries).toMatchObject([{ slot: 'lunch', label: '黑椒蘑菇鸡丁', portions: 1 }]);

    k.run('consumePreparedPortion', { batchId: k.state.prepared_batches[0].id, portions: 1, date: TOMORROW, slot: 'lunch' });
    expect(dayIntake(k.state, TODAY).macros.protein).toBeCloseTo(R01_TOTAL.protein / 2);
    expect(dayIntake(k.state, TOMORROW).macros.protein).toBeCloseTo(R01_TOTAL.protein / 2);
  });

  it('一次吃 2 份算 2 份', () => {
    const k = new Kitchen();
    cookR01(k, { eatNow: 2 });
    expect(dayIntake(k.state, TODAY).macros.protein).toBeCloseTo(R01_TOTAL.protein);
    expect(dayIntake(k.state, TODAY).entries).toMatchObject([{ portions: 2 }]);
  });

  it('同一餐补记的份数合在一起', () => {
    const k = new Kitchen();
    cookR01(k);
    k.run('reconcileMealPortions', { date: TODAY, slot: 'lunch', totalEaten: 2 });
    expect(dayIntake(k.state, TODAY).macros.protein).toBeCloseTo(R01_TOTAL.protein);
    expect(dayIntake(k.state, TODAY).entries).toMatchObject([{ portions: 2 }]);
  });

  it('做 4 份用了 2 倍原料，一份的量不变', () => {
    const k = new Kitchen();
    cookR01(k, { servings: 4, eatNow: 1 });
    expect(dayIntake(k.state, TODAY).macros.protein).toBeCloseTo(R01_TOTAL.protein / 2);
  });

  it('同样的料分成 3 份，一份就少', () => {
    const k = new Kitchen();
    cookR01(k, {
      servings: 3,
      actuals: [{ ingredientId: 'chicken_breast', qty: 454 }, { ingredientId: 'mushroom', qty: 120 }, { ingredientId: 'yellow_onion', qty: 80 }],
    });
    expect(dayIntake(k.state, TODAY).macros.protein).toBeCloseTo(R01_TOTAL.protein / 3);
  });

  it('用实际用量，不用菜谱默认量', () => {
    const k = new Kitchen();
    cookR01(k, { actuals: [{ ingredientId: 'chicken_breast', qty: 300 }] });
    expect(dayIntake(k.state, TODAY).macros.protein).toBeCloseTo((69 + 3 + 0.88) / 2);
  });

  it('修正用量后数字跟着变', () => {
    const k = new Kitchen();
    cookR01(k);
    k.run('reviseCookSession', { ingredientId: 'chicken_breast', qty: 300 });
    expect(dayIntake(k.state, TODAY).macros.protein).toBeCloseTo((69 + 3 + 0.88) / 2);
  });

  it('选了配饭才算碳水', () => {
    const k = new Kitchen();
    cookR01(k, { actuals: [{ ingredientId: 'rice', qty: 150 }] });
    expect(dayIntake(k.state, TODAY).macros.carbs).toBeCloseTo((R01_TOTAL.carbs + 120) / 2);
  });

  it('用户自己加的食材没有数据：列出来，其余照算', () => {
    const k = new Kitchen();
    k.run('addIngredient', { name: '豆腐干', category: 'protein', unit: 'g', defaultLocation: 'fridge' });
    const id = k.state.ingredients.find((i) => i.name === '豆腐干')!.id;
    cookR01(k, { actuals: [{ ingredientId: id, qty: 100 }] });
    const d = dayIntake(k.state, TODAY);
    expect(d.uncounted).toEqual(['豆腐干']);
    expect(d.macros.protein).toBeCloseTo(R01_TOTAL.protein / 2);
  });

  it('报废的熟菜不算吃了', () => {
    const k = new Kitchen();
    cookR01(k);
    k.run('discardBatch', { batchId: k.state.prepared_batches[0].id });
    expect(dayIntake(k.state, TODAY).macros.protein).toBeCloseTo(R01_TOTAL.protein / 2);
  });

  it('外食算不出来，要说明而不是当没吃', () => {
    const k = new Kitchen();
    k.run('setMealStatus', { date: TODAY, slot: 'dinner', status: 'eating_out' });
    const d = dayIntake(k.state, TODAY);
    expect(d.uncounted).toEqual(['晚餐外食']);
    expect(d.macros.kcal).toBe(0);
  });

  it('「其实没吃」扣回，撤销这次修正又算回来', () => {
    const k = new Kitchen();
    cookR01(k);
    k.run('revertConsumption', { date: TODAY, slot: 'lunch' });
    const revert = k.last.operationId;
    expect(dayIntake(k.state, TODAY).entries).toEqual([]);
    expect(dayIntake(k.state, TODAY).macros.kcal).toBe(0);

    k.run('undoTransaction', { operationId: revert });
    expect(dayIntake(k.state, TODAY).macros.protein).toBeCloseTo(R01_TOTAL.protein / 2);
    expect(dayIntake(k.state, TODAY).entries).toHaveLength(1);
  });

  it('撤销整次做饭后什么都不留', () => {
    const k = new Kitchen();
    cookR01(k);
    k.run('undoTransaction', { operationId: k.last.operationId });
    expect(dayIntake(k.state, TODAY).entries).toEqual([]);
    expect(dayIntake(k.state, TODAY).macros.kcal).toBe(0);
  });

  it('加餐记了数量就能算，撤销后消失', () => {
    const k = new Kitchen();
    k.run('recordSnack', { ingredientId: 'banana', qty: 2 });
    const op = k.last.operationId;
    expect(dayIntake(k.state, TODAY).macros.kcal).toBeCloseTo(210);
    k.run('undoTransaction', { operationId: op });
    expect(dayIntake(k.state, TODAY).entries).toEqual([]);
  });

  it('加餐的单位换算成规范单位', () => {
    const k = new Kitchen();
    k.run('recordSnack', { ingredientId: 'yogurt', qty: 0.17, unit: 'kg' });
    expect(dayIntake(k.state, TODAY).macros.protein).toBeCloseTo(17);
  });

  it('加餐没说数量：记下来，但不编数字', () => {
    const k = new Kitchen();
    k.run('recordSnack', { ingredientId: 'banana' });
    const d = dayIntake(k.state, TODAY);
    expect(d.macros.kcal).toBe(0);
    expect(d.uncounted).toEqual(['香蕉']);
    expect(d.entries[0].macros).toBeNull();
  });

  it('不在菜谱里的食物，说一句就能记进来', () => {
    const k = new Kitchen();
    const text = '吃了半罐牛肉罐头';
    const r = resolveProposal(k.state, k.ctx(), ruleParse(text, k.state, k.now), text);
    if (r.type !== 'preview') throw new Error(`没有得到预览：${r.type}`);
    k.run(r.command, r.input);
    expect(dayIntake(k.state, TODAY).macros.protein).toBeCloseTo(35);
    expect(dayIntake(k.state, TODAY).uncounted).toEqual([]);
  });

  it('按午餐、晚餐、加餐排序', () => {
    const k = new Kitchen();
    k.run('recordSnack', { ingredientId: 'banana', qty: 1 });
    cookR01(k);
    expect(dayIntake(k.state, TODAY).entries.map((e) => e.slot)).toEqual(['lunch', 'snack']);
  });

  it('最近几天从今天往回排', () => {
    const days = recentIntake(new Kitchen().state, TODAY, 7);
    expect(days.map((d) => d.date)).toEqual(Array.from({ length: 7 }, (_, i) => addDays(TODAY, -i)));
  });
});
