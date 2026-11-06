import { describe, expect, it } from 'vitest';
import { addDays, diffDays } from '../../src/domain/dates';
import { checkRecipe, recommendSnack, recommendToday, reminderFor } from '../../src/domain/recommend';
import { forecastShopping } from '../../src/domain/shopping';
import { rotationHint } from '../../src/domain/planner';
import { ROTATION_CYCLE } from '../../src/domain/seed';
import { EVENING, Kitchen, NOON, TODAY } from './helpers';

const TOMORROW = addDays(TODAY, 1);
const lunch = `${TODAY}:lunch`, dinner = `${TODAY}:dinner`;

function cooked() {
  const k = new Kitchen();
  k.buy({ chicken_breast: [2000, 'g', 'fridge'], mushroom: 227, yellow_onion: 400 });
  k.run('swapRecipe', { date: TODAY, recipeId: 'R01' });
  k.run('finishCook', { recipeId: 'R01', date: TODAY, slot: 'lunch', servings: 2, eatNow: 1 });
  return k;
}

describe('每周肉类次数提醒', () => {
  const day = (n: number) => addDays(TODAY, n);

  it('换菜造成一周两次牛肉时提醒，计划照改', () => {
    const k = new Kitchen();
    const r = k.run('swapRecipe', { date: day(3), recipeId: 'R04' });
    expect(r.warnings.join('')).toContain('牛肉碎在 11/5–11/7 有 2 天，超过每周 1 天');
    expect(k.slot(`${day(3)}:lunch`).recipeId).toBe('R04');
  });

  it('对调造成超额时也提醒', () => {
    const k = new Kitchen();
    const r = k.run('moveMeal', { fromDate: day(1), toDate: day(7) });
    expect(r.warnings.join('')).toContain('牛肉碎');
  });

  it('换同一种肉、不超次数时不提醒', () => {
    const k = new Kitchen();
    expect(k.run('swapRecipe', { date: day(1), recipeId: 'L31' }).warnings).toEqual([]);
    expect(k.run('moveMeal', { fromDate: day(3), toDate: day(4) }).warnings).toEqual([]);
  });

  it('已经吃过的一天也算进去', () => {
    const k = new Kitchen();
    k.run('swapRecipe', { date: day(1), recipeId: 'R02' });
    k.run('swapRecipe', { date: TODAY, recipeId: 'R04' });
    k.run('finishCook', { recipeId: 'R04', date: TODAY, slot: 'lunch', servings: 2, eatNow: 2 });
    expect(k.slot(`${TODAY}:lunch`).status).toBe('eaten');
    expect(k.run('swapRecipe', { date: day(2), recipeId: 'R04' }).warnings.join('')).toContain('牛肉碎');
  });

  it('外食的一天不算，原本就超的不重复提醒', () => {
    const k = new Kitchen();
    k.run('setDayAway', { date: day(1) });
    expect(k.run('swapRecipe', { date: TODAY, recipeId: 'R04' }).warnings).toEqual([]);
    k.run('swapRecipe', { date: day(3), recipeId: 'R04' });
    expect(k.last.warnings.join('')).toContain('有 2 天');
    expect(k.run('swapRecipe', { date: day(2), recipeId: 'L34' }).warnings.join('')).not.toContain('牛肉碎');
  });
});

describe('B. 动态日程', () => {
  it('11 外食前尚未做饭：午餐外食，晚餐单份约 227g，库存不变，采购更新', () => {
    const k = new Kitchen();
    k.run('swapRecipe', { date: TODAY, recipeId: 'R04' });
    k.buy({ yellow_onion: 500 });
    expect(k.slot(lunch).cookServings).toBe(2);
    const before = forecastShopping(k.state, k.now).items.find((i) => i.ingredientId === 'ground_beef')!;
    const lots = JSON.stringify(k.state.inventory_lots);

    k.run('setMealStatus', { date: TODAY, slot: 'lunch', status: 'eating_out' });

    expect(k.slot(lunch).status).toBe('eating_out');
    expect(k.slot(dinner).role).toBe('cook');
    expect(k.slot(dinner).cookServings).toBe(1);
    expect(k.last.details.join('；')).toContain('约227g');
    expect(k.last.details).toContain('库存不变');
    expect(JSON.stringify(k.state.inventory_lots)).toBe(lots);
    const after = forecastShopping(k.state, k.now).items.find((i) => i.ingredientId === 'ground_beef')!;
    expect(after.needed).toBe(before.needed - 227);
  });

  it('12 午餐吃 1 份、晚餐临时外食：熟菜还在，下一餐优先，不退回生肉', () => {
    const k = cooked();
    expect(k.slot(dinner).role).toBe('leftover');
    const chicken = k.qty('chicken_breast');
    k.run('setMealStatus', { date: TODAY, slot: 'dinner', status: 'eating_out' });
    expect(k.portions()).toBe(1);
    expect(k.qty('chicken_breast')).toBe(chicken);
    const next = k.slot(`${TOMORROW}:lunch`);
    expect(next.role).toBe('leftover');
    expect(k.slot(`${TOMORROW}:dinner`).cookServings).toBe(1);
    k.now = EVENING;
    expect(recommendToday(k.state, k.now).primary?.kind).toBe('leftover');
    k.assertLedger();
  });

  it('13 训练后加餐：说饿不扣；选熟菜吃完才扣，后续重排', () => {
    const k = cooked();
    const snapshot = JSON.stringify([k.state.inventory_lots, k.state.prepared_batches]);
    const options = recommendSnack(k.state, k.now);
    expect(options.length).toBeLessThanOrEqual(2);
    expect(options[0].kind).toBe('leftover');
    expect(JSON.stringify([k.state.inventory_lots, k.state.prepared_batches])).toBe(snapshot);

    k.run('consumePreparedPortion', { batchId: options[0].batchId, portions: 1, date: TODAY, slot: 'snack' });
    expect(k.portions()).toBe(0);
    expect(k.slot(dinner).batchId).toBeNull();
    expect(k.slot(dinner).role).toBe('cook');
    expect(k.slot(dinner).recipeId).toBeNull();
    k.assertLedger();
  });

  it('14 额外烹饪：只有做完才扣原料，不计入新的肉类日', () => {
    const k = new Kitchen();
    k.buy({ chicken_breast: [500, 'g', 'fridge'], rice: 500 });
    const options = recommendSnack(k.state, k.now);
    const fried = options.find((o) => o.recipeId === 'S01')!;
    expect(fried).toBeTruthy();
    expect(k.qty('chicken_breast')).toBe(500);
    k.run('finishCook', { recipeId: 'S01', date: TODAY, slot: 'snack', servings: 1, eatNow: 1 });
    expect(k.qty('chicken_breast')).toBe(350);
    const slot = k.state.meal_slots.find((s) => s.slot === 'snack')!;
    expect(slot.status).toBe('eaten');
    // 午晚餐计划没有被加餐占用
    expect(k.slot(lunch).status).toBe('planned');
    k.assertLedger();
  });

  it('15 两份一顿吃光：消费改为 2，熟菜归零，晚餐重新推荐，无负数', () => {
    const k = cooked();
    k.run('reconcileMealPortions', { date: TODAY, slot: 'lunch', totalEaten: 2 });
    expect(k.portions()).toBe(0);
    expect(k.slot(dinner).role).toBe('cook');
    expect(k.slot(dinner).recipeId).toBeNull();
    k.now = EVENING;
    const rec = recommendToday(k.state, k.now);
    expect(rec.meal.slot).toBe('dinner');
    expect(rec.primary?.kind).toBe('recipe');
    k.assertLedger();
  });

  it('15b 说吃了三份但只有两份：解释差异，给明确修正选项，不写入', () => {
    const k = cooked();
    const before = k.state;
    let err: { message: string; options?: unknown[] } | undefined;
    try { k.run('reconcileMealPortions', { date: TODAY, slot: 'lunch', totalEaten: 3 }); } catch (e) { err = e as never; }
    expect(err?.message).toContain('只剩 1 份');
    expect(err?.options).toHaveLength(1);
    expect(k.state).toBe(before);
  });

  it('16 只用空气炸锅且想吃辣：候选含孜然/韩式，咖喱和牛肉碎不入选并说明原因', () => {
    const k = new Kitchen();
    k.buy({ chicken_breast: [1000, 'g', 'fridge'], yellow_onion: 300 });
    k.run('swapRecipe', { date: TODAY, recipeId: 'R03' });
    k.run('setConstraint', { date: TODAY, airfryerOnly: true, spicy: true, excludeRecipeIds: ['R03'] });
    const rec = recommendToday(k.state, k.now);
    const titles = [rec.primary, ...rec.alternates].map((p) => p?.title);
    expect(titles.some((t) => t === '孜然洋葱鸡丁' || t === '韩式甜辣空气炸鸡')).toBe(true);
    expect(titles).not.toContain('咖喱鸡肉杂蔬');
    expect(titles).not.toContain('番茄牛肉碎意面');
    expect(rec.excluded.find((e) => e.name === '番茄牛肉碎意面')?.why).toContain('空气炸锅');
    expect(rec.primary?.kind === 'recipe' && rec.primary.variant.airfryerOnlyOk).toBe(true);
  });

  it('17 鱼还冻着且只有 15 分钟：不建议常温解冻，优先现成可行的', () => {
    const k = new Kitchen();
    k.buy({ frozen_fish: [500, 'g', 'freezer'], egg: [6, '颗'], rice: 500, chicken_breast: [500, 'g', 'freezer'] });
    k.run('swapRecipe', { date: TODAY, recipeId: 'R06' });
    k.run('setConstraint', { date: TODAY, minutes: 15 });
    const rec = recommendToday(k.state, k.now);
    const titles = [rec.primary, ...rec.alternates].map((p) => p?.title);
    expect(titles).not.toContain('番茄炖鱼片');
    expect(rec.note).toContain('解冻');
    expect(rec.note).toContain('不要长时间常温解冻');
    expect(JSON.stringify(rec)).not.toMatch(/室温解冻|常温放置/);
    expect(titles.join()).toContain('葱花鸡蛋炒饭');
  });

  it('17b 已有熟菜时 15 分钟优先吃熟菜', () => {
    const k = cooked();
    k.run('setConstraint', { date: TODAY, minutes: 15 });
    expect(recommendToday(k.state, k.now).primary?.kind).toBe('leftover');
  });

  it('18 下周三整天外食：只动那一天，锁定和历史不变', () => {
    const k = cooked();
    const wed = addDays(TODAY, 7);
    k.run('lockSlot', { date: wed, slot: 'dinner', locked: true });
    const others = k.state.meal_slots.filter((s) => s.date !== wed).map((s) => JSON.stringify(s)).sort();
    k.run('setDayAway', { date: wed });
    expect(k.slot(`${wed}:lunch`).status).toBe('eating_out');
    expect(k.slot(`${wed}:dinner`).status).toBe('planned');
    expect(k.last.details.join()).toContain('已锁定');
    expect(k.state.meal_slots.filter((s) => s.date !== wed).map((s) => JSON.stringify(s)).sort()).toEqual(others);
  });

  it('19 已吃过的餐不能静默改成外食；修正走显式命令', () => {
    const k = cooked();
    expect(() => k.run('setMealStatus', { date: TODAY, slot: 'lunch', status: 'eating_out' })).toThrowError(/已记录吃过/);
    const portions = k.portions();
    k.run('revertConsumption', { date: TODAY, slot: 'lunch' });
    expect(k.portions()).toBe(portions + 1);
    expect(k.state.consumption_events.some((c) => c.kind === 'reversal')).toBe(true);
    k.assertLedger();
  });

  it('20 同日多次重排：晚餐外食→撤销→只吃 1 份，计划版本和预测一致', () => {
    const k = cooked();
    const snapshot = JSON.stringify(k.state.meal_slots.map(({ rev: _r, ...s }) => s).sort((a, b) => a.id.localeCompare(b.id)));
    const fc = JSON.stringify(forecastShopping(k.state, k.now).items);
    const out = k.run('setMealStatus', { date: TODAY, slot: 'dinner', status: 'eating_out' });
    expect(JSON.stringify(forecastShopping(k.state, k.now).items)).not.toBe(fc);
    k.run('undoTransaction', { operationId: out.operationId });
    expect(JSON.stringify(k.state.meal_slots.map(({ rev: _r, ...s }) => s).sort((a, b) => a.id.localeCompare(b.id)))).toBe(snapshot);
    expect(JSON.stringify(forecastShopping(k.state, k.now).items)).toBe(fc);
    k.run('setPortionTarget', { date: TODAY, slot: 'dinner', portions: 1 });
    expect(k.portions()).toBe(1);
    expect(k.state.meal_plan_versions.length).toBeGreaterThan(2);
    k.assertLedger();
  });

  it('场景 G：没用蘑菇 / 多用了 100g 走修正', () => {
    const k = cooked();
    const m = k.qty('mushroom');
    k.run('reviseCookSession', { ingredientId: 'mushroom', qty: 0 });
    expect(k.qty('mushroom')).toBe(m + 120);
    const c = k.qty('chicken_breast');
    k.run('reviseCookSession', { ingredientId: 'chicken_breast', delta: 100 });
    expect(k.qty('chicken_breast')).toBe(c - 100);
    k.assertLedger();
  });

  it('场景 I：连续两天孜然鸡，明确命令压过多样性', () => {
    const k = new Kitchen();
    k.run('swapRecipe', { date: TODAY, recipeId: 'R02', days: 2 });
    expect(k.slot(`${TODAY}:lunch`).recipeId).toBe('R02');
    expect(k.slot(`${TOMORROW}:lunch`).recipeId).toBe('R02');
    expect(recommendToday(k.state, k.now).primary?.title).toBe('孜然洋葱鸡丁');
  });

  it('用户指定的餐次不被熟菜顶掉，也不被 reflow 改写', () => {
    const k = cooked();
    k.run('swapRecipe', { date: TOMORROW, slot: 'lunch', recipeId: 'R02' });
    expect(k.slot(`${TOMORROW}:lunch`).recipeId).toBe('R02');
    k.run('setMealStatus', { date: TODAY, slot: 'dinner', status: 'eating_out' });
    expect(k.slot(`${TOMORROW}:lunch`).role).toBe('cook');
    expect(k.slot(`${TOMORROW}:dinner`).role).toBe('leftover');
  });

  it('熟菜排不进安全窗口时提醒，而不是机械排到两周后', () => {
    const k = cooked();
    for (const d of [TODAY, addDays(TODAY, 1), addDays(TODAY, 2), addDays(TODAY, 3)]) {
      k.run('setDayAway', { date: d });
    }
    expect(k.last.warnings.join('')).toContain('建议吃掉或冷冻');
    const late = k.state.meal_slots.filter((s) => s.batchId && s.status === 'planned');
    expect(late).toHaveLength(0);
  });

  it('冷冻的熟菜不被自动排进餐次，解冻后才排', () => {
    const k = cooked();
    const b = k.state.prepared_batches[0];
    k.run('moveBatch', { batchId: b.id, to: 'freezer' });
    expect(k.slot(dinner).role).not.toBe('leftover');
    k.run('moveBatch', { batchId: b.id, to: 'fridge' });
    expect(k.slot(dinner).role).toBe('leftover');
  });

  it('有熟菜时备选不建议再做同一道', () => {
    const k = cooked();
    const rec = recommendToday(k.state, k.now);
    expect(rec.primary?.kind).toBe('leftover');
    expect(rec.alternates.map((a) => a.title)).not.toContain('黑椒蘑菇鸡丁');
  });

  it('从库存吃一份不会把外食的餐次改成吃过', () => {
    const k = cooked();
    k.run('setMealStatus', { date: TODAY, slot: 'dinner', status: 'eating_out' });
    k.run('consumePreparedPortion', { batchId: k.state.prepared_batches[0].id, portions: 1, date: TODAY, slot: 'dinner' });
    expect(k.slot(dinner).status).toBe('eating_out');
    expect(k.portions()).toBe(0);
  });

  it('没带 sessionId 完成时接上进行中的做饭，不留幽灵会话', () => {
    const k = new Kitchen();
    k.run('startCookSession', { recipeId: 'R02', date: TODAY, slot: 'lunch', servings: 2 });
    k.run('finishCook', { recipeId: 'R02', servings: 2, eatNow: 1 });
    expect(k.state.cook_sessions).toHaveLength(1);
    expect(k.state.cook_sessions[0].status).toBe('finished');
  });

  it('放弃清单后回到预测，库存不变', () => {
    const k = new Kitchen();
    k.run('createShoppingList', {});
    const { listId } = k.last.data as { listId: string };
    k.run('discardShoppingList', { listId });
    expect(k.state.shopping_lists).toHaveLength(0);
    expect(k.state.shopping_items).toHaveLength(0);
    expect(k.state.inventory_lots).toHaveLength(0);
  });

  it('忙碌的日子优先快手菜', () => {
    const k = new Kitchen();
    k.buy({ chicken_breast: [1000, 'g', 'fridge'], yellow_onion: 300, mushroom: 227 });
    const score = () => {
      const rec = recommendToday(k.state, k.now);
      return (([rec.primary, ...rec.alternates].find((p) => p?.title === '孜然洋葱鸡丁') as { score: number } | undefined)?.score) ?? 0;
    };
    const before = score();
    k.run('setConstraint', { date: TODAY, dayStatus: 'busy' });
    expect(score()).toBeGreaterThan(before);
  });

  it('可选配料放不到使用日时不买也不警告', () => {
    const k = new Kitchen();
    const items = forecastShopping(k.state, k.now).items;
    expect(items.find((i) => i.ingredientId === 'green_pepper')?.tag).not.toBe('short_life');
    expect(items.find((i) => i.ingredientId === 'mushroom')?.needed).toBe(240);
    expect(items.map((i) => i.reason).join('')).not.toContain('。；');
  });

  it('新食材只进目录，不产生库存；重名被拒绝', () => {
    const k = new Kitchen();
    k.run('addIngredient', { name: '火龙果', aliases: ['dragon fruit'], category: 'fresh', unit: 'count', countUnit: '个', defaultLocation: 'pantry' });
    expect(k.state.ingredients.find((i) => i.name === '火龙果')?.countUnit).toBe('个');
    expect(k.state.inventory_lots).toHaveLength(0);
    expect(() => k.run('addIngredient', { name: '火龙果', category: 'fresh', unit: 'g', defaultLocation: 'pantry' })).toThrow(/已经有/);
  });

  it('改下次采购日后，预测和计划范围跟着变', () => {
    const k = new Kitchen();
    k.run('setNextShopDate', { date: addDays(TODAY, 5) });
    k.run('syncPlan', {});
    expect(forecastShopping(k.state, k.now).shopDate).toBe(addDays(TODAY, 5));
    expect(k.state.meal_slots.some((s) => s.date === addDays(TODAY, 18))).toBe(true);
  });

  it('错过午餐后，晚上默认只做一份', () => {
    const k = new Kitchen();
    k.now = EVENING;
    expect(recommendToday(k.state, k.now).meal.servings).toBe(1);
  });
});

describe('C. 推荐与采购', () => {
  it('25 默认 7 天：鸡 3 天，牛猪鱼虾各 1 天，虾日带沙丁鱼', () => {
    const k = new Kitchen();
    const proteins = new Map<string, number>();
    for (let n = 0; n < 7; n++) {
      const r = k.state.recipes.find((x) => x.id === k.slot(`${addDays(TODAY, n)}:lunch`).recipeId)!;
      proteins.set(r.protein, (proteins.get(r.protein) ?? 0) + 1);
    }
    expect(Object.fromEntries(proteins)).toEqual({ chicken: 3, beef: 1, pork: 1, fish: 1, shrimp: 1 });
    expect(k.state.recipe_ingredients.some((ri) => ri.recipeId === 'R07' && ri.ingredientId === 'canned_sardine')).toBe(true);
    expect(ROTATION_CYCLE).toHaveLength(7);
  });

  it('25b 外食打乱轮换时不硬凑，只给可选提示', () => {
    const k = new Kitchen();
    const fishDay = k.state.meal_slots.find((s) => s.recipeId === 'R06')!.date;
    k.run('setDayAway', { date: fishDay });
    const hint = rotationHint(k.state, k.now);
    expect(hint?.text).toContain('冷冻鱼片');
    expect(k.state.meal_slots.filter((s) => s.date > TODAY && s.recipeId === 'R06' && s.status === 'planned' && diffDays(s.date, TODAY) < 7)).toHaveLength(0);
    k.run('swapRecipe', { date: hint!.date, recipeId: hint!.recipeId });
    expect(rotationHint(k.state, k.now)).toBeNull();
  });

  it('26 最多 1 主 2 备；无紧急事不提醒', () => {
    const k = new Kitchen();
    const rec = recommendToday(k.state, k.now);
    expect(rec.alternates.length).toBeLessThanOrEqual(2);
    expect(reminderFor(k.state, k.now)).toBeNull();
  });

  it('27 已有安全熟菜时优先，不重复开火', () => {
    const k = cooked();
    expect(recommendToday(k.state, k.now).primary?.kind).toBe('leftover');
    expect(k.slot(dinner).cookServings).toBe(0);
    const before = k.qty('chicken_breast');
    k.run('consumePreparedPortion', { batchId: k.state.prepared_batches[0].id, portions: 1, date: TODAY, slot: 'dinner' });
    expect(k.qty('chicken_breast')).toBe(before);
  });

  it('净需求 = 计划 − 到期前可用库存，覆盖熟菜的餐次不产生需求', () => {
    const k = new Kitchen();
    const fc = forecastShopping(k.state, k.now);
    const chicken = fc.items.find((i) => i.ingredientId === 'chicken_breast')!;
    // 14 天里 6 个鸡肉日，每天 454g
    expect(chicken.needed).toBe(2724);
    k.buy({ chicken_breast: [1000, 'g', 'freezer'] });
    const after = forecastShopping(k.state, k.now).items.find((i) => i.ingredientId === 'chicken_breast')!;
    expect(after.gap).toBe(1724);
    expect(after.tag).toBe('must');
    expect(after.reason).toContain('分袋冷冻');
    expect(after.packLabel).toContain('规格待核对');
  });

  it('到使用日已过建议日期的批次不算库存', () => {
    const k = new Kitchen();
    k.run('confirmPurchase', { lines: [{ ingredientId: 'mushroom', bought: true, qty: 227, location: 'fridge', packageUseBy: '2026-11-05' }] });
    const first = k.state.meal_slots.find((s) => s.recipeId === 'R01' && s.role === 'cook')!;
    expect(first.date).toBe(TODAY);
    const later = forecastShopping(k.state, k.now).items.find((i) => i.ingredientId === 'mushroom')!;
    expect(later.gap).toBeGreaterThan(0);
  });

  it('28 第 12 天才吃的蘑菇不安排当天买，并解释替代办法', () => {
    const k = new Kitchen();
    // 只保留 12 天后的一次蘑菇菜
    const target = addDays(TODAY, 12);
    for (const s of k.state.meal_slots.filter((x) => x.recipeId === 'R01')) {
      k.run('swapRecipe', { date: s.date, recipeId: 'B03' });
    }
    k.run('swapRecipe', { date: target, recipeId: 'R01' });
    const item = forecastShopping(k.state, k.now).items.find((i) => i.ingredientId === 'mushroom')!;
    expect(item.tag).toBe('short_life');
    expect(item.suggestedQty).toBe(0);
    expect(item.reason).toMatch(/提前|冷冻|白蘑菇|下次/);
  });

  it('蘑菇按 8oz 整盒、胡萝卜散装，不买 2lb 整袋', () => {
    const k = new Kitchen();
    const fc = forecastShopping(k.state, k.now);
    const m = fc.items.find((i) => i.ingredientId === 'mushroom')!;
    expect(m.packLabel).toContain('8oz');
    expect(m.suggestedQty).toBe(227); // 只买一盒，第 7 天的需求给替代办法，而不是多买一盒
    expect(m.tag).toBe('short_life');
    const c = fc.items.find((i) => i.ingredientId === 'carrot')!;
    expect(c.unit).toBe('根');
    expect(c.suggestedQty).toBeLessThanOrEqual(2);
    expect(c.packLabel).not.toContain('lb');
  });

  it('调料只提示等级，不做克数精算', () => {
    const k = new Kitchen();
    k.run('setSeasoningLevel', { ingredientId: 'cumin', level: 'low' });
    k.run('setSeasoningLevel', { ingredientId: 'black_pepper', level: 'out' });
    const fc = forecastShopping(k.state, k.now);
    expect(fc.items.find((i) => i.ingredientId === 'cumin')?.tag).toBe('optional');
    expect(fc.items.find((i) => i.ingredientId === 'black_pepper')?.tag).toBe('must');
    expect(fc.items.find((i) => i.ingredientId === 'cumin')?.suggestedQty).toBeNull();
    expect(fc.notes.join('')).toContain('还没确认');
  });

  it('采购后短保食材被提前排，下次采购日 +14', () => {
    const k = new Kitchen();
    k.now = new Date('2026-11-06T20:00:00Z');
    k.run('syncPlan', {});
    k.buy({ mushroom: 227 });
    const today = '2026-11-06';
    expect(k.state.preferences.find((p) => p.id === 'nextShopDate')?.value).toBe(addDays(today, 14));
    const uses = (id: string | null) => k.state.recipe_ingredients.some((r) => r.recipeId === id && r.ingredientId === 'mushroom' && r.role === 'required');
    const first = k.state.meal_slots.filter((s) => s.date >= today && s.status === 'planned' && uses(s.recipeId)).sort((a, b) => a.date.localeCompare(b.date))[0];
    expect(diffDays(first.date, today)).toBeLessThanOrEqual(3);
  });

  it('复制上次已购只进清单，不进库存', () => {
    const k = new Kitchen();
    k.buy({ egg: 12, chicken_breast: [1000, 'g'] });
    const eggs = k.qty('egg');
    k.run('createShoppingList', {});
    const { listId } = k.last.data as { listId: string };
    k.run('copyLastPurchase', { listId });
    expect(k.state.shopping_items.some((i) => i.ingredientId === 'egg')).toBe(true);
    expect(k.qty('egg')).toBe(eggs);
  });

  it('30 标记好吃提高权重，但不绕过安全约束', () => {
    const k = new Kitchen();
    k.buy({ chicken_breast: [1000, 'g', 'fridge'], yellow_onion: 300 });
    const base = recommendToday(k.state, k.now).primary;
    const r2Score = () => {
      const rec = recommendToday(k.state, k.now, { skip: base?.kind === 'recipe' ? [base.recipe.id] : [] });
      return [rec.primary, ...rec.alternates].find((p) => p?.title === '孜然洋葱鸡丁');
    };
    const before = (r2Score() as { score: number }).score;
    k.run('rateRecipe', { recipeId: 'R02', feedback: 'good' });
    expect((r2Score() as { score: number }).score).toBeGreaterThan(before);
    k.state.inventory_lots.filter((l) => l.ingredientId === 'chicken_breast').forEach((l) => k.run('discardLot', { lotId: l.id }));
    expect(recommendToday(k.state, k.now).excluded.some((e) => e.name === '孜然洋葱鸡丁')).toBe(true);
  });

  it('checkRecipe 区分未确认和确认不够', () => {
    const k = new Kitchen();
    expect(checkRecipe(k.state, 'R01', 2, TODAY).blocked).toBeNull();
    k.buy({ chicken_breast: [100, 'g', 'fridge'] });
    expect(checkRecipe(k.state, 'R01', 2, TODAY).blocked).toBe('鸡胸肉不够');
  });

  it('下午做的也能算到正确餐次', () => {
    const k = new Kitchen(NOON);
    k.buy({ chicken_breast: [1000, 'g', 'fridge'] });
    k.now = EVENING;
    k.run('finishCook', { recipeId: 'R02', servings: 1, eatNow: 1 });
    expect(k.slot(dinner).status).toBe('eaten');
  });
});
