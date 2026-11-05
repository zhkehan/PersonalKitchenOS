import { addDays, type LocalDate } from './dates';
import { addMacros, macrosOf, NO_MACROS, oilMacros, scaleMacros, type Macros } from './nutrition';
import { pref, SLOT_LABEL } from './planner';
import type { ConsumptionEvent, Id, Ingredient, KitchenState, PreparedBatch, SlotKind } from './types';
import { roundQty } from './units';

/**
 * 营养估算全部从已有记录推算，不存结果，也不要求额外录入：
 * 熟菜一份 = 这一锅实际用料 ÷ 这一锅份数。修正用量、撤销都会自动反映。
 * 算不出来的东西列进 uncounted，绝不按 0 悄悄计入。
 * 调味品（unit = level）没有克数，统一不算，界面上写明。
 * 烹调油按用户设的「每份用油」估算，默认值来自用户笔记的每天约 20g、一天两顿。
 * 加餐类的菜不加油。这个数字改了，已有记录的估算也跟着变。
 */
export const DEFAULT_COOKING_OIL = 10;
export const COOKING_OIL_PREF = 'cookingOilGrams';
export const cookingOil = (state: KitchenState) => pref<number>(state, COOKING_OIL_PREF, DEFAULT_COOKING_OIL);

/** 这道菜一份算多少克油。 */
function oilGramsFor(state: KitchenState, recipeId: Id): number {
  return state.recipes.find((r) => r.id === recipeId)?.tier === 'snack' ? 0 : cookingOil(state);
}

export interface Estimate {
  macros: Macros;
  /** 算进去的食材数。0 表示 macros 没有意义。 */
  counted: number;
  uncounted: string[];
}

export interface RecipeServing extends Estimate {
  /** 可选食材，选了才算。每份的量。 */
  extras: { name: string; macros: Macros }[];
  /** 一份里算进去的烹调油。 */
  oilGrams: number;
}

export interface IntakeEntry {
  slot: SlotKind;
  label: string;
  portions: number;
  /** null = 这条记录算不出来。 */
  macros: Macros | null;
}

export interface DayIntake {
  date: LocalDate;
  macros: Macros;
  entries: IntakeEntry[];
  uncounted: string[];
}

const ingredientOf = (state: KitchenState, id: Id): Ingredient | undefined => state.ingredients.find((i) => i.id === id);
const nameOf = (state: KitchenState, id: Id) => ingredientOf(state, id)?.name ?? '未知食材';

/** 菜谱默认用量下的一份。 */
export function recipeServing(state: KitchenState, recipeId: Id): RecipeServing {
  const servings = state.recipes.find((r) => r.id === recipeId)?.baseServings ?? 1;
  let macros = NO_MACROS;
  let counted = 0;
  const uncounted: string[] = [];
  const extras: RecipeServing['extras'] = [];
  for (const ri of state.recipe_ingredients.filter((r) => r.recipeId === recipeId)) {
    if (ingredientOf(state, ri.ingredientId)?.unit === 'level') continue;
    const m = ri.qty === null ? null : macrosOf(ri.ingredientId, ri.qty);
    if (ri.role === 'optional') {
      if (m) extras.push({ name: nameOf(state, ri.ingredientId), macros: scaleMacros(m, 1 / servings) });
    } else if (m) {
      macros = addMacros(macros, m);
      counted += 1;
    } else {
      uncounted.push(nameOf(state, ri.ingredientId));
    }
  }
  const oilGrams = oilGramsFor(state, recipeId);
  return { macros: addMacros(scaleMacros(macros, 1 / servings), oilMacros(oilGrams)), counted, uncounted, extras, oilGrams };
}

/** 这一锅实际做出来的一份。 */
export function batchServing(state: KitchenState, batch: PreparedBatch): Estimate {
  let macros = NO_MACROS;
  let counted = 0;
  const uncounted: string[] = [];
  for (const r of state.cook_session_ingredients.filter((x) => x.sessionId === batch.cookSessionId)) {
    const m = macrosOf(r.ingredientId, r.actualQty);
    if (m) {
      macros = addMacros(macros, m);
      counted += 1;
    } else {
      uncounted.push(nameOf(state, r.ingredientId));
    }
  }
  return { macros: addMacros(scaleMacros(macros, 1 / batch.portionsTotal), oilMacros(batch.oilGrams ?? oilGramsFor(state, batch.recipeId))), counted, uncounted };
}

/**
 * 反向记录带负份数，同一条记录的份数加总就是净值，
 * 所以「其实没吃」、撤销、撤销之后再撤销都不需要分别处理。
 */
function netEvents(state: KitchenState, date: LocalDate): { event: ConsumptionEvent; portions: number }[] {
  const groups = new Map<string, { event: ConsumptionEvent; portions: number }>();
  for (const c of state.consumption_events) {
    if (c.date !== date) continue;
    const key = [c.slot, c.batchId, c.ingredientId, c.label, c.qty].join('|');
    const g = groups.get(key);
    if (g) g.portions += c.portions;
    else groups.set(key, { event: c, portions: c.portions });
  }
  return [...groups.values()].filter((g) => g.portions > 0);
}

const SLOT_ORDER: SlotKind[] = ['lunch', 'dinner', 'snack'];

export function dayIntake(state: KitchenState, date: LocalDate): DayIntake {
  let macros = NO_MACROS;
  const entries: IntakeEntry[] = [];
  const uncounted: string[] = [];

  for (const { event: c, portions } of netEvents(state, date)) {
    const batch = c.batchId ? state.prepared_batches.find((b) => b.id === c.batchId) : undefined;
    let m: Macros | null = null;
    if (batch) {
      const one = batchServing(state, batch);
      uncounted.push(...one.uncounted);
      if (one.counted > 0) m = scaleMacros(one.macros, portions);
    } else if (c.ingredientId && c.qty !== undefined) {
      m = macrosOf(c.ingredientId, c.qty * portions);
    }
    if (m) macros = addMacros(macros, m);
    else uncounted.push(c.label);
    entries.push({ slot: c.slot, label: c.label, portions: roundQty(portions), macros: m });
  }

  for (const s of state.meal_slots) {
    if (s.date === date && s.status === 'eating_out') uncounted.push(`${SLOT_LABEL[s.slot]}外食`);
  }

  entries.sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  return { date, macros, entries, uncounted: [...new Set(uncounted)] };
}

/** 从今天往前数 days 天，今天在最前。 */
export function recentIntake(state: KitchenState, today: LocalDate, days: number): DayIntake[] {
  return Array.from({ length: days }, (_, i) => dayIntake(state, addDays(today, -i)));
}
