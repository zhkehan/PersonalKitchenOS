import { describe, expect, it } from 'vitest';
import { findIngredient, findRecipe, ingredientInText, recipeInText } from '../../src/domain/match';
import { MARINADE_NOTE, DIPS, HOT_SAUCES, MARINADES, TEMPLATES } from '../../src/domain/references';
import { LIBRARY_DEFS, LIBRARY_INGREDIENTS } from '../../src/domain/library';
import { NUTRITION_FACTS } from '../../src/domain/nutrition';
import { checkRecipe, recommendToday } from '../../src/domain/recommend';
import { BAG_QTY_MIGRATION, ROTATION_CYCLE, seedState } from '../../src/domain/seed';
import type { KitchenState } from '../../src/domain/types';
import { Kitchen, NOON, TODAY } from './helpers';

const OLD_NOTE = '采购时可按一顿/一天分袋，冷冻前保持原味';

/** 上线第一版的目录：已经装在手机上的数据长这样。 */
function firstReleaseState(): KitchenState {
  const s = seedState();
  const library = new Set(s.recipes.filter((r) => r.tier === 'library').map((r) => r.id));
  return {
    ...s,
    ingredients: s.ingredients.filter((i) => !i.catalogOnly).map((i) => (i.id === 'chicken_breast' ? { ...i, note: OLD_NOTE } : i)),
    recipes: s.recipes.filter((r) => !library.has(r.id)),
    recipe_variants: s.recipe_variants.filter((v) => !library.has(v.recipeId)),
    recipe_ingredients: s.recipe_ingredients.filter((r) => !library.has(r.recipeId)).map((r) => (r.qty === 454 ? { ...r, qty: 500 } : r)),
    recipe_steps: s.recipe_steps.filter((x) => !library.has(x.variantId.split(':')[0])),
    preferences: s.preferences.filter((p) => p.id !== BAG_QTY_MIGRATION),
  };
}

function usedPhone(): Kitchen {
  const k = new Kitchen(NOON, firstReleaseState());
  k.buy({ chicken_breast: 1000, mushroom: 227, yellow_onion: 300 });
  k.run('setSeasoningLevel', { ingredientId: 'light_soy', level: 'have' });
  k.run('rateRecipe', { recipeId: 'R01', feedback: 'good' });
  k.run('updateRecipe', { recipeId: 'R01', notes: '多放蒜' });
  k.run('finishCook', { recipeId: 'R01', date: TODAY, slot: 'lunch', servings: 2, eatNow: 1 });
  return k;
}

describe('升级已有数据', () => {
  it('手机上的库存、计划、熟菜、菜谱改动一行不动，只增加新目录', () => {
    const k = usedPhone();
    const before = structuredClone(k.state);
    k.run('syncCatalog', {});
    for (const t of ['inventory_lots', 'inventory_events', 'meal_slots', 'prepared_batches', 'consumption_events', 'cook_sessions', 'protein_weekly_preferences'] as const) {
      expect(k.state[t]).toEqual(before[t]);
    }
    expect(k.state.preferences.filter((p) => p.id !== BAG_QTY_MIGRATION)).toEqual(before.preferences);
    expect(k.state.recipes.filter((r) => r.tier !== 'library')).toEqual(before.recipes);
    expect(k.state.recipes.find((r) => r.id === 'R01')).toMatchObject({ feedback: 'good', notes: '多放蒜' });
    expect(k.state.ingredients.find((i) => i.id === 'light_soy')?.level).toBe('have');
    expect(k.state.recipes.filter((r) => r.tier === 'library')).toHaveLength(LIBRARY_DEFS.length);
    expect(k.state.ingredients.filter((i) => i.catalogOnly)).toHaveLength(LIBRARY_INGREDIENTS.length);
  });

  it('重复运行不写任何东西；升级不能被撤销', () => {
    const k = usedPhone();
    const first = k.run('syncCatalog', {});
    expect(first.undoable).toBe(false);
    const audits = k.state.audit_events.length;
    k.run('syncCatalog', {});
    expect(k.state.audit_events).toHaveLength(audits);
  });

  describe('鸡胸肉和牛肉碎的默认用量改成 454g', () => {
    const qty = (k: Kitchen, recipeId: string, ingredientId: string) =>
      k.state.recipe_ingredients.find((r) => r.recipeId === recipeId && r.ingredientId === ingredientId)?.qty;

    it('已安装的手机：还是 500g 的行改过来，其他肉不动', () => {
      const k = new Kitchen(NOON, firstReleaseState());
      k.run('syncCatalog', {});
      expect(qty(k, 'R01', 'chicken_breast')).toBe(454);
      expect(qty(k, 'R04', 'ground_beef')).toBe(454);
      expect(qty(k, 'R05', 'pork_loin')).toBe(500);
      expect(qty(k, 'R06', 'frozen_fish')).toBe(500);
    });

    it('用户改过的用量不动', () => {
      const k = new Kitchen(NOON, firstReleaseState());
      const row = k.state.recipe_ingredients.find((r) => r.recipeId === 'R01' && r.ingredientId === 'chicken_breast')!;
      k.run('updateRecipe', { recipeId: 'R01', ingredientQty: [{ rowId: row.id, qty: 300 }] });
      k.run('syncCatalog', {});
      expect(qty(k, 'R01', 'chicken_breast')).toBe(300);
    });

    it('只迁移一次：之后用户改回 500g 不会再被盖掉', () => {
      const k = new Kitchen(NOON, firstReleaseState());
      k.run('syncCatalog', {});
      const row = k.state.recipe_ingredients.find((r) => r.recipeId === 'R01' && r.ingredientId === 'chicken_breast')!;
      k.run('updateRecipe', { recipeId: 'R01', ingredientQty: [{ rowId: row.id, qty: 500 }] });
      k.run('syncCatalog', {});
      expect(qty(k, 'R01', 'chicken_breast')).toBe(500);
    });
  });

  it('1 lb 记账是 453.6g，三袋鸡胸能做满三次，差额如实记录', () => {
    const k = new Kitchen();
    k.run('adjustInventory', { ingredientId: 'chicken_breast', qty: 3, unit: 'lb' });
    for (let n = 0; n < 3; n++) {
      const line = checkRecipe(k.state, 'R01', 2, TODAY).lines.find((l) => l.ingredientId === 'chicken_breast')!;
      expect(line.status).not.toBe('short');
      k.run('finishCook', { recipeId: 'R01', servings: 2, eatNow: 0, date: TODAY, slot: 'lunch' });
    }
    expect(k.qty('chicken_breast')).toBe(0);
    expect(k.last.warnings.some((w) => w.includes('差额 1.2g'))).toBe(true);
    k.assertLedger();
  });

  it('差得多时还是「不够」', () => {
    const k = new Kitchen();
    k.run('adjustInventory', { ingredientId: 'chicken_breast', qty: 400 });
    const line = checkRecipe(k.state, 'R01', 2, TODAY).lines.find((l) => l.ingredientId === 'chicken_breast')!;
    expect(line.status).toBe('short');
  });

  it('全新安装不需要升级', () => {
    const k = new Kitchen();
    const audits = k.state.audit_events.length;
    k.run('syncCatalog', {});
    expect(k.state.audit_events).toHaveLength(audits);
  });

  it('用户建过同名食材时沿用它，不出现两个土豆', () => {
    const k = new Kitchen(NOON, firstReleaseState());
    k.run('addIngredient', { name: '土豆', category: 'fresh', unit: 'g', defaultLocation: 'pantry' });
    const mine = k.state.ingredients.find((i) => i.name === '土豆')!;
    k.run('syncCatalog', {});
    expect(k.state.ingredients.filter((i) => i.name === '土豆')).toHaveLength(1);
    expect(k.state.ingredients.some((i) => i.id === 'potato')).toBe(false);
    const row = k.state.recipe_ingredients.find((r) => r.recipeId === 'L08' && r.qty === 600);
    expect(row?.ingredientId).toBe(mine.id);
    k.run('syncCatalog', {});
    expect(k.state.ingredients.filter((i) => i.name === '土豆')).toHaveLength(1);
  });

  it('过时的鸡胸提示被替换，其他内容不受影响', () => {
    const k = new Kitchen(NOON, firstReleaseState());
    k.run('syncCatalog', {});
    const note = k.state.ingredients.find((i) => i.id === 'chicken_breast')?.note ?? '';
    expect(note).toContain('一天一袋');
    expect(note).not.toContain('保持原味');
  });

  it('第一版目录的所有食材名在新目录里都不冲突', () => {
    const old = firstReleaseState();
    const k = new Kitchen(NOON, firstReleaseState());
    k.run('syncCatalog', {});
    expect(k.state.ingredients).toHaveLength(old.ingredients.length + LIBRARY_INGREDIENTS.length);
  });
});

describe('菜谱库不打扰日常', () => {
  const titles = (k: Kitchen) => {
    const r = recommendToday(k.state, k.now);
    return { primary: r.primary?.title, alternates: r.alternates.map((a) => a.title), excluded: r.excluded.map((e) => e.name) };
  };

  it('升级前后推荐完全一样，也不出现在排除理由里', () => {
    const a = usedPhone();
    const b = usedPhone();
    b.run('syncCatalog', {});
    expect(titles(b)).toEqual(titles(a));
  });

  it('即使家里只有菜谱库能用的肉、又想吃辣，也不会自动推荐', () => {
    const k = new Kitchen();
    const usual = ['chicken_breast', 'ground_beef', 'pork_loin', 'frozen_fish', 'frozen_shrimp', 'egg'];
    k.run('calibrateInventory', { entries: usual.map((ingredientId) => ({ ingredientId, present: false })) });
    k.buy({ beef_slices: [1000, 'g', 'fridge'] });
    k.run('setConstraint', { date: TODAY, spicy: true });
    const r = recommendToday(k.state, k.now);
    const shown = [r.primary, ...r.alternates].flatMap((p) => (p?.kind === 'recipe' ? [p.recipe.tier] : []));
    expect(shown).not.toContain('library');
    expect(r.excluded.map((e) => e.name)).not.toContain('葱爆牛肉');
    // 确认这个场景真的能测到过滤：同样的菜点名排进这一餐就能出现。
    k.run('swapRecipe', { date: TODAY, slot: 'lunch', recipeId: 'L13' });
    expect(recommendToday(k.state, k.now).primary?.title).toBe('韩式炒牛肉');
  });

  it('7 天轮换和新增计划都不含菜谱库', () => {
    expect(ROTATION_CYCLE.every((id) => id.startsWith('R'))).toBe(true);
    const k = new Kitchen();
    const library = new Set(k.state.recipes.filter((r) => r.tier === 'library').map((r) => r.id));
    expect(k.state.meal_slots.some((s) => s.recipeId && library.has(s.recipeId))).toBe(false);
  });

  it('点名后能排进这一餐，做完只扣一次，并算进这一餐的推荐', () => {
    const k = new Kitchen();
    expect(recipeInText(k.state, '今天中午想吃三杯鸡')?.id).toBe('L07');
    k.buy({ chicken_breast: 1000 });
    k.run('swapRecipe', { date: TODAY, slot: 'lunch', recipeId: 'L07' });
    expect(recommendToday(k.state, k.now).primary?.title).toBe('三杯鸡');
    k.run('finishCook', { recipeId: 'L07', date: TODAY, slot: 'lunch', servings: 2, eatNow: 1 });
    expect(k.state.inventory_lots.find((l) => l.ingredientId === 'chicken_breast')?.qty).toBe(546);
    expect(k.state.prepared_batches[0].portionsRemaining).toBe(1);
  });

  it('备用食材：采购时能直接找到，买了之后就是普通库存', () => {
    const k = new Kitchen();
    const r = k.run('addIngredient', { name: '香蕉', category: 'fresh', unit: 'count', countUnit: '根', defaultLocation: 'pantry' });
    expect((r.data as { ingredientId: string }).ingredientId).toBe('banana');
    expect(k.state.ingredients.filter((i) => i.name === '香蕉')).toHaveLength(1);
    k.buy({ banana: 3 });
    expect(k.state.inventory_lots.find((l) => l.ingredientId === 'banana')?.qty).toBe(3);
  });
});

describe('目录内容', () => {
  const s = seedState();

  it('种子不写库存，菜谱引用的食材都存在', () => {
    expect(s.inventory_lots).toHaveLength(0);
    const ids = new Set(s.ingredients.map((i) => i.id));
    expect(s.recipe_ingredients.filter((r) => !ids.has(r.ingredientId))).toEqual([]);
    expect(NUTRITION_FACTS.filter((n) => n.ingredientId && !ids.has(n.ingredientId))).toEqual([]);
  });

  it('每道菜谱库的菜都有做法、安全提示和默认设备', () => {
    for (const d of LIBRARY_DEFS) {
      expect(d.safety, d.name).toBeTruthy();
      expect(d.methods.length, d.name).toBeGreaterThan(0);
      expect(d.methods.every((m) => m.steps.length > 0 && m.equipment.length > 0), d.name).toBe(true);
    }
    expect(new Set(LIBRARY_DEFS.map((d) => d.id)).size).toBe(LIBRARY_DEFS.length);
    expect(new Set(s.recipes.map((r) => r.name)).size).toBe(s.recipes.length);
  });

  it('笔记里有独立做法的菜都保留；说「咖喱鸡」仍然找到固定菜', () => {
    expect(s.recipes.find((r) => r.id === 'L28')?.name).toBe('蜂蜜芥末煎鸡');
    expect(s.recipes.find((r) => r.id === 'L29')?.name).toBe('咖喱鸡（简版）');
    expect(findRecipe(s, '咖喱鸡')?.id).toBe('R03');
    expect(recipeInText(s, '今天吃咖喱鸡')?.id).toBe('R03');
  });

  it('有烤箱：BBQ 烤鸡胸和烤土豆默认用烤箱', () => {
    expect(s.recipe_variants.find((v) => v.recipeId === 'L27' && v.isDefault)?.equipment).toEqual(['oven']);
    expect(s.recipe_variants.find((v) => v.recipeId === 'L26' && v.isDefault)?.equipment).toEqual(['oven']);
  });

  it('安全规则高于旧笔记：肝必须全熟，牛肉以变色为准', () => {
    const liver = LIBRARY_DEFS.filter((d) => d.id === 'L24' || d.id === 'L25');
    for (const d of liver) {
      expect(d.safety).toMatch(/74°C|全熟/);
      expect(d.safety).toContain('一周最多一次');
      expect(d.methods.flatMap((m) => m.steps).join('')).not.toContain('微粉');
    }
    expect(LIBRARY_DEFS.find((d) => d.id === 'L12')?.methods.flatMap((m) => m.steps).join('')).toContain('完全变色');
  });

  it('旧饮食计划没有混进来', () => {
    const all = JSON.stringify([LIBRARY_DEFS, LIBRARY_INGREDIENTS, NUTRITION_FACTS, TEMPLATES, HOT_SAUCES, DIPS, MARINADES]);
    expect(all).not.toMatch(/减脂|增肌|力训|休息日|特例日|Phase|每日摄入|周结构|100g\/份/);
  });

  it('腌制默认一天一袋，腌法可换', () => {
    expect(MARINADE_NOTE).toContain('一天的量分袋');
    expect(MARINADE_NOTE).toContain('腌法可以换');
    expect(MARINADES.every((m) => m.steps.some((x) => x.includes('一天的量')))).toBe(true);
  });

  it('营养数字和宏量大致自洽，防止抄错（纤维按不供能算）', () => {
    for (const n of NUTRITION_FACTS) {
      if (n.carbs === null || n.protein === null || n.fat === null) continue;
      const net = Math.max(0, n.carbs - (n.fiber ?? 0));
      const est = n.protein * 4 + n.fat * 9;
      // 标签对纤维的算法不统一，算不算纤维的热量，有一种对得上就行。
      const gap = Math.min(Math.abs(est + net * 4 - n.kcal), Math.abs(est + n.carbs * 4 - n.kcal));
      // 蔬菜的能量系数和通用的 4-4-9 差得多，USDA 的行放宽一些。
      const limit = n.fdcId ? Math.max(0.35 * n.kcal, 10) : 0.2 * n.kcal;
      expect(gap, n.name).toBeLessThan(limit);
    }
  });

  it('新食材的名字不抢走已有的「玉米淀粉」「洋葱」「辣椒」', () => {
    const s = seedState();
    expect(ingredientInText(s, '买了玉米')?.id).toBe('frozen_corn');
    expect(ingredientInText(s, '用完了玉米淀粉')?.id).toBe('corn_starch');
    expect(ingredientInText(s, '还有半袋辣椒洋葱')?.id).toBe('frozen_pepper_onion');
    expect(findIngredient(s, '洋葱')?.id).toBe('yellow_onion');
    expect(findIngredient(s, '辣椒')?.id).toBe('thai_chili');
    expect(findIngredient(s, '毛豆')?.id).toBe('edamame');
    expect(ingredientInText(s, '吃了半罐牛肉罐头')?.id).toBe('canned_roast_beef');
    expect(findIngredient(s, '牛肉')?.id).toBe('ground_beef');
    expect(ingredientInText(s, '煮了糙米')?.id).toBe('brown_rice');
    expect(findIngredient(s, '米饭')?.id).toBe('rice');
    expect(ingredientInText(s, '还有 12 袋粉丝')?.id).toBe('glass_noodle');
    expect(ingredientInText(s, '吃了 8 个粉丝饺子')?.id).toBe('glass_noodle_dumpling');
    expect(ingredientInText(s, '吃了 13 个猪肉饺子')?.id).toBe('pork_dumpling');
    expect(ingredientInText(s, '煮了一包火鸡面')?.id).toBe('buldak_noodle');
    expect(findIngredient(s, '麻辣香锅炒料')?.id).toBe('mala_paste');
    expect(findIngredient(s, '芝麻')?.id).toBe('sesame_seed');
    expect(findIngredient(s, '芝麻酱')?.id).toBe('tahini');
    expect(findIngredient(s, '孜然')?.id).toBe('cumin');
    expect(findIngredient(s, '蒜')?.id).toBe('minced_garlic');
    expect(findIngredient(s, '蘑菇')?.id).toBe('mushroom');
    expect(ingredientInText(s, '孜然烧烤料用完了')?.id).toBe('bbq_rub_cumin');
    expect(ingredientInText(s, '蒜粉快没了')?.id).toBe('garlic_powder');
    expect(ingredientInText(s, '洋葱粉还有')?.id).toBe('onion_powder');
  });

  it('新调料只进目录，数量不编，状态等用户确认', () => {
    const s = seedState();
    for (const id of ['garlic_salt', 'garlic_powder', 'onion_powder', 'mushroom_seasoning', 'sesame_seed', 'fennel_seed', 'bbq_rub_spicy', 'bbq_rub_cumin']) {
      expect(s.ingredients.find((i) => i.id === id), id).toMatchObject({ unit: 'level', level: 'unconfirmed' });
    }
  });

  it('包装规格按用户实际买的算', () => {
    const k = new Kitchen();
    const pack = (id: string) => k.state.products.find((p) => p.ingredientId === id);
    expect(pack('ground_beef')).toMatchObject({ packQty: 1, packUnit: 'lb' });
    expect(pack('frozen_pepper_onion')).toMatchObject({ packQty: 20, packUnit: 'oz' });
  });

  it('牛肉碎用用户实际买的 93/7 产品标签', () => {
    const beef = NUTRITION_FACTS.find((n) => n.ingredientId === 'ground_beef');
    expect(beef).toMatchObject({ name: '牛肉碎（93/7，生重）', basis: 112, kcal: 170, carbs: 0, protein: 23, fat: 8 });
    expect(beef?.fdcId).toBeUndefined();
  });
});
