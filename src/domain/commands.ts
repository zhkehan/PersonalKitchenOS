import { z } from 'zod';
import { addDays, friendlyDate, localDate, type LocalDate } from './dates';
import {
  activeLots, applyDelta, deduct, fefoSort, ingredientById, LOCATION_LABEL, ruleUseBy, stockOf,
} from './inventory';
import {
  changeSlot, commitPlanVersion, currentMeal, defaultVariantId, ensurePlan, planHorizonEnd, pref, pullForward, recipeOf,
  reflow, setPref, slotId, slotLabel, slotSort, swapDays, SLOT_LABEL,
} from './planner';
import { COOKING_OIL_PREF } from './intake';
import { BAG_QTY_MIGRATION, seedState } from './seed';
import { forecastShopping } from './shopping';
import { DomainError, Tx } from './tx';
import type {
  ConsumptionEvent, CookSession, CookSessionIngredient, Id, Ingredient, InventoryEvent, InventoryLot, KitchenState, Level,
  Location, MealSlot, Preference, PreparedBatch, PreparedPortionEvent, PurchaseConfirmation, Recipe, RecipeIngredient, ScheduleConstraint,
  ShoppingItem, ShoppingList, SlotKind,
} from './types';
import { formatQty, roundQty, toCanonical } from './units';
import { undoOperation } from './undo';

const COOKED_FRIDGE_DAYS = 3;
const COOKED_FREEZER_DAYS = 60;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const mealSlot = z.enum(['lunch', 'dinner']);
const anySlot = z.enum(['lunch', 'dinner', 'snack']);
const location = z.enum(['fridge', 'freezer', 'pantry']);
const portions = z.number().positive().max(20);

const today = (tx: Tx) => localDate(tx.ctx.now);

function getSlot(tx: Tx, date: LocalDate, slot: SlotKind): MealSlot {
  const s = tx.get<MealSlot>('meal_slots', slotId(date, slot));
  if (!s) throw new DomainError('NO_SLOT', `${friendlyDate(date, today(tx))}${SLOT_LABEL[slot]}不在当前计划内`);
  return s;
}

function getRecipe(tx: Tx, id: Id): Recipe {
  const r = recipeOf(tx.state, id);
  if (!r) throw new DomainError('UNKNOWN_RECIPE', '没有这道菜');
  return r;
}

function getBatch(tx: Tx, id: Id): PreparedBatch {
  const b = tx.get<PreparedBatch>('prepared_batches', id);
  if (!b) throw new DomainError('UNKNOWN_BATCH', '没有这份熟菜');
  return b;
}

function getLot(tx: Tx, id: Id): InventoryLot {
  const l = tx.get<InventoryLot>('inventory_lots', id);
  if (!l || l.status !== 'active') throw new DomainError('UNKNOWN_LOT', '这批库存已不存在');
  return l;
}

const lotLabel = (lot: InventoryLot) => (lot.qty === null ? lot.rawLabel ?? '数量未知' : formatQty(lot.qty, lot.unit));

/** 已确认事实不能被计划类操作覆盖。 */
function assertNotEaten(slot: MealSlot, tx: Tx) {
  if (slot.status === 'eaten') {
    throw new DomainError('ALREADY_EATEN', `${slotLabel(slot, today(tx))}已记录吃过，不能改成外食。如果记错了，可以先修正这条食用记录。`);
  }
}

function setStatus(tx: Tx, slot: MealSlot, status: 'eating_out' | 'skipped') {
  const word = status === 'eating_out' ? '改外食' : '不吃';
  changeSlot(tx, slot, { status, role: 'none', batchId: null, cookServings: 0 }, `${slotLabel(slot, today(tx))}${word}`);
}

function finishPlanSummary(tx: Tx, summary: string) {
  tx.summary = summary;
  const inv = tx.impact().inventory;
  if (!inv) tx.details.push('库存不变');
}

/* ───────────── 动态计划 ───────────── */

const setMealStatus = {
  schema: z.object({ date: dateStr, slot: mealSlot, status: z.enum(['eating_out', 'skipped']) }).strict(),
  run(tx: Tx, i: { date: string; slot: 'lunch' | 'dinner'; status: 'eating_out' | 'skipped' }) {
    const slot = getSlot(tx, i.date, i.slot);
    assertNotEaten(slot, tx);
    setStatus(tx, slot, i.status);
    reflow(tx, `${slotLabel(slot, today(tx))}${i.status === 'eating_out' ? '外食' : '不吃'}`);
    finishPlanSummary(tx, tx.details.slice(0, 3).join('；'));
  },
};

const setDayAway = {
  schema: z.object({ date: dateStr }).strict(),
  run(tx: Tx, i: { date: string }) {
    const slots = tx.state.meal_slots.filter((s) => s.date === i.date && s.slot !== 'snack');
    if (slots.length === 0) throw new DomainError('NO_SLOT', '这一天不在当前计划内');
    const kept: string[] = [];
    for (const s of slots) {
      if (s.status !== 'planned') continue;
      if (s.locked) { kept.push(slotLabel(s, today(tx))); continue; }
      setStatus(tx, s, 'eating_out');
    }
    reflow(tx, `${friendlyDate(i.date, today(tx))}不在家吃`);
    if (kept.length) tx.details.push(`${kept.join('、')}已锁定，保持不动`);
    finishPlanSummary(tx, `${friendlyDate(i.date, today(tx))}不在家吃`);
  },
};

const restoreMeal = {
  schema: z.object({ date: dateStr, slot: mealSlot }).strict(),
  run(tx: Tx, i: { date: string; slot: 'lunch' | 'dinner' }) {
    const slot = getSlot(tx, i.date, i.slot);
    if (slot.status === 'eaten' || slot.status === 'planned') return;
    const sibling = tx.state.meal_slots.find((s) => s.date === i.date && s.slot !== 'snack' && s.recipeId);
    changeSlot(tx, slot, { status: 'planned', recipeId: slot.recipeId ?? sibling?.recipeId ?? null, variantId: slot.variantId ?? sibling?.variantId ?? null }, `${slotLabel(slot, today(tx))}恢复在家吃`);
    reflow(tx, '恢复在家吃');
    finishPlanSummary(tx, tx.details[0] ?? '已恢复');
  },
};

const setPortionTarget = {
  schema: z.object({ date: dateStr, slot: mealSlot, portions }).strict(),
  run(tx: Tx, i: { date: string; slot: 'lunch' | 'dinner'; portions: number }) {
    const slot = getSlot(tx, i.date, i.slot);
    changeSlot(tx, slot, { portions: i.portions }, `${slotLabel(slot, today(tx))}吃 ${i.portions} 份`);
    reflow(tx, '调整份数');
    finishPlanSummary(tx, tx.details.slice(0, 2).join('；'));
  },
};

const changeMealCount = {
  schema: z.object({ date: dateStr, count: z.union([z.literal(0), z.literal(1), z.literal(2)]), keep: mealSlot.optional() }).strict(),
  run(tx: Tx, i: { date: string; count: 0 | 1 | 2; keep?: 'lunch' | 'dinner' }) {
    const label = friendlyDate(i.date, today(tx));
    const lunch = getSlot(tx, i.date, 'lunch');
    const dinner = getSlot(tx, i.date, 'dinner');
    if (i.count === 2) {
      for (const s of [lunch, dinner]) if (s.status === 'skipped' || s.status === 'eating_out') changeSlot(tx, s, { status: 'planned' }, `${slotLabel(s, today(tx))}恢复`);
    } else {
      const keep = i.count === 1 ? (i.keep ?? null) : null;
      if (i.count === 1 && !keep) throw new DomainError('NEED_SLOT', '留午餐还是晚餐？');
      for (const s of [lunch, dinner]) {
        if (s.slot === keep || s.status !== 'planned') continue;
        setStatus(tx, s, 'skipped');
      }
    }
    reflow(tx, `${label}在家吃 ${i.count} 顿`);
    finishPlanSummary(tx, `${label}在家吃 ${i.count} 顿`);
  },
};

const swapRecipe = {
  schema: z.object({ date: dateStr, slot: mealSlot.optional(), recipeId: z.string(), variantId: z.string().optional(), days: z.number().int().min(1).max(7).optional() }).strict(),
  run(tx: Tx, i: { date: string; slot?: 'lunch' | 'dinner'; recipeId: string; variantId?: string; days?: number }) {
    const recipe = getRecipe(tx, i.recipeId);
    const variantId = i.variantId ?? defaultVariantId(tx.state, recipe.id);
    const from = currentMeal(tx.ctx.now);
    const dates = Array.from({ length: i.days ?? 1 }, (_, n) => addDays(i.date, n));
    const changed: string[] = [];
    for (const date of dates) {
      const slots = tx.state.meal_slots.filter((s) => s.date === date && s.slot !== 'snack' && s.status === 'planned' && (!i.slot || s.slot === i.slot) &&
        (s.date > from.date || s.slot === from.slot || s.slot === 'dinner'));
      for (const s of slots) {
        if (s.locked) { tx.warnings.push(`${slotLabel(s, today(tx))}已锁定，未改动`); continue; }
        changeSlot(tx, s, { recipeId: recipe.id, variantId, source: 'user', role: 'cook' }, '');
        changed.push(slotLabel(s, today(tx)));
      }
    }
    if (changed.length === 0) throw new DomainError('NO_SLOT', '没有可以改的餐次');
    tx.planLog.push({ slotId: slotId(i.date, i.slot ?? 'lunch'), phrase: `${changed.join('、')}改成「${recipe.name}」`, before: {} as never, after: {} as never });
    reflow(tx, `换菜：${recipe.name}`);
    finishPlanSummary(tx, tx.details[0] ?? `改成「${recipe.name}」`);
  },
};

const moveMeal = {
  schema: z.object({ fromDate: dateStr, toDate: dateStr }).strict(),
  run(tx: Tx, i: { fromDate: string; toDate: string }) {
    if (i.fromDate === i.toDate) throw new DomainError('SAME_DAY', '两天是同一天');
    const locked = tx.state.meal_slots.some((s) => (s.date === i.fromDate || s.date === i.toDate) && s.locked);
    if (locked) throw new DomainError('LOCKED', '其中一天已锁定，先解锁再调整');
    swapDays(tx, i.fromDate, i.toDate, `${friendlyDate(i.fromDate, today(tx))}和${friendlyDate(i.toDate, today(tx))}的菜对调`);
    reflow(tx, '调整日期');
    finishPlanSummary(tx, tx.details[0] ?? '没有可调整的餐次');
  },
};

const lockSlot = {
  schema: z.object({ date: dateStr, slot: mealSlot, locked: z.boolean() }).strict(),
  run(tx: Tx, i: { date: string; slot: 'lunch' | 'dinner'; locked: boolean }) {
    const slot = getSlot(tx, i.date, i.slot);
    tx.put('meal_slots', { ...slot, locked: i.locked });
    tx.summary = `${slotLabel(slot, today(tx))}${i.locked ? '已锁定' : '已解锁'}`;
  },
};

const setConstraint = {
  schema: z.object({
    date: dateStr,
    minutes: z.number().int().positive().max(240).nullable().optional(),
    airfryerOnly: z.boolean().optional(),
    spicy: z.boolean().optional(),
    hunger: z.enum(['low', 'normal', 'high']).nullable().optional(),
    dayStatus: z.enum(['normal', 'busy', 'away']).nullable().optional(),
    excludeRecipeIds: z.array(z.string()).optional(),
  }).strict(),
  run(tx: Tx, i: Partial<ScheduleConstraint> & { date: string }) {
    const existing = tx.get<ScheduleConstraint>('schedule_constraints', i.date);
    const base: ScheduleConstraint = existing ?? { id: i.date, date: i.date, dayStatus: null, minutes: null, airfryerOnly: false, spicy: false, hunger: null, excludeRecipeIds: [], rev: 0 };
    tx.put('schedule_constraints', { ...base, ...i });
    tx.summary = '已更新今天的条件';
    tx.undoable = false;
  },
};

const syncPlan = {
  schema: z.object({}).strict(),
  run(tx: Tx) {
    const t = today(tx);
    ensurePlan(tx, t, planHorizonEnd(tx.state, t));
    tx.summary = '计划已更新';
    tx.undoable = false;
  },
};

/* ───────────── 做饭 ───────────── */

function resolveVariant(tx: Tx, recipeId: Id, variantId?: Id | null): Id {
  const id = variantId ?? defaultVariantId(tx.state, recipeId);
  if (!id || !tx.state.recipe_variants.some((v) => v.id === id && v.recipeId === recipeId)) {
    throw new DomainError('UNKNOWN_VARIANT', '这道菜没有这个做法');
  }
  return id;
}

const startCookSession = {
  schema: z.object({ recipeId: z.string(), variantId: z.string().optional(), date: dateStr.optional(), slot: mealSlot.optional(), servings: portions }).strict(),
  run(tx: Tx, i: { recipeId: string; variantId?: string; date?: string; slot?: 'lunch' | 'dinner'; servings: number }) {
    const recipe = getRecipe(tx, i.recipeId);
    const variantId = resolveVariant(tx, recipe.id, i.variantId);
    // 打开菜谱只是「准备中」：不碰任何库存。
    const slotRef = i.date && i.slot ? tx.get<MealSlot>('meal_slots', slotId(i.date, i.slot)) : undefined;
    const session = tx.put<CookSession>('cook_sessions', {
      id: tx.newId('cook'), recipeId: recipe.id, variantId, slotId: slotRef?.id ?? null, status: 'started',
      startedAt: tx.at, finishedAt: null, plannedServings: i.servings, actualServings: null, rev: 0,
    });
    if (slotRef && slotRef.status === 'planned') {
      tx.put<MealSlot>('meal_slots', { ...slotRef, status: 'preparing', recipeId: recipe.id, variantId });
    }
    tx.summary = `开始做「${recipe.name}」`;
    tx.undoable = false;
    tx.data = { sessionId: session.id };
  },
};

const cancelCookSession = {
  schema: z.object({ sessionId: z.string() }).strict(),
  run(tx: Tx, i: { sessionId: string }) {
    const s = tx.get<CookSession>('cook_sessions', i.sessionId);
    if (!s || s.status !== 'started') throw new DomainError('NOT_STARTED', '这次做饭已结束');
    tx.put('cook_sessions', { ...s, status: 'cancelled', finishedAt: tx.at });
    const slot = s.slotId ? tx.get<MealSlot>('meal_slots', s.slotId) : undefined;
    if (slot && slot.status === 'preparing') tx.put<MealSlot>('meal_slots', { ...slot, status: 'planned' });
    tx.summary = '已取消，库存没有变化';
    tx.undoable = false;
  },
};

interface ActualInput { ingredientId: string; qty: number; unit?: string }
const actualSchema = z.object({ ingredientId: z.string(), qty: z.number().min(0), unit: z.string().optional() }).strict();

/** 选实际要扣的食材：主料没有库存记录、替代品有时才换。 */
function pickIngredient(state: KitchenState, ingredientId: Id, need: number): { id: Id; note?: string } {
  const main = stockOf(state, ingredientId);
  if (main.knownQty > 0 || main.hasUnknownLot) return { id: ingredientId };
  for (const sub of state.ingredient_substitutions.filter((s) => s.ingredientId === ingredientId)) {
    const s = stockOf(state, sub.substituteId);
    if (s.ingredient.unit === main.ingredient.unit && s.knownQty >= need) return { id: sub.substituteId, note: sub.note };
  }
  return { id: ingredientId };
}

function deductForCook(tx: Tx, session: CookSession, recipe: Recipe, servings: number, actuals: ActualInput[]) {
  const state = tx.state;
  const factor = servings / recipe.baseServings;
  const byId = new Map(actuals.map((a) => [a.ingredientId, a]));
  const lines: string[] = [];
  const rows = state.recipe_ingredients.filter((ri) => ri.recipeId === recipe.id && ri.qty !== null);
  const planned = new Map<Id, number>();
  for (const ri of rows) {
    if (ri.role === 'optional' && !byId.has(ri.ingredientId)) continue;
    planned.set(ri.ingredientId, roundQty(ri.qty! * factor));
  }
  for (const a of actuals) if (!planned.has(a.ingredientId)) planned.set(a.ingredientId, 0);

  for (const [ingredientId, plannedQty] of planned) {
    const base = ingredientById(state, ingredientId);
    const a = byId.get(ingredientId);
    let actual = plannedQty;
    if (a) {
      const c = a.unit ? toCanonical(a.qty, a.unit, base) : { qty: a.qty, viaUserSpec: false };
      if (!c) throw new DomainError('NEEDS_SPEC', `还不知道 1${a.unit}${base.name} 有多重，请直接填克数。`);
      actual = c.qty;
    }
    if (actual === 0) continue;
    const picked = pickIngredient(tx.state, ingredientId, actual);
    const ing = ingredientById(state, picked.id);
    const alloc = deduct(tx, picked.id, actual, `做「${recipe.name}」`);
    const unit = ing.unit === 'count' ? ing.countUnit ?? '' : ing.unit;
    tx.put<CookSessionIngredient>('cook_session_ingredients', {
      id: tx.newId('csi'), sessionId: session.id, ingredientId: picked.id, plannedQty, actualQty: actual, unit,
      allocations: alloc.allocations, usedUnknownLot: alloc.usedUnknownLot, shortfall: alloc.shortfall, estimated: false, rev: 0,
    });
    const deducted = roundQty(actual - alloc.shortfall);
    if (alloc.allocations.length > 0) lines.push(`${ing.name}${formatQty(alloc.allocations.reduce((n, x) => n + x.qty, 0), unit)}`);
    if (alloc.usedUnknownLot) tx.warnings.push(`${ing.name}的批次数量未知，只记录用过，未扣数`);
    if (alloc.shortfall > 0) {
      tx.warnings.push(deducted > 0
        ? `${ing.name}库存记录只有 ${formatQty(deducted, unit)}，已扣到 0，差额 ${formatQty(alloc.shortfall, unit)} 待核对`
        : `${ing.name}没有库存记录，未扣减；本次用量已记下`);
    }
    if (picked.note) tx.details.push(picked.note);
  }
  return lines;
}

const finishCook = {
  schema: z.object({
    sessionId: z.string().optional(),
    recipeId: z.string().optional(),
    variantId: z.string().optional(),
    date: dateStr.optional(),
    slot: anySlot.optional(),
    servings: portions,
    eatNow: z.number().min(0).max(20),
    actuals: z.array(actualSchema).optional(),
    storeIn: z.enum(['fridge', 'freezer']).optional(),
  }).strict(),
  run(tx: Tx, i: { sessionId?: string; recipeId?: string; variantId?: string; date?: string; slot?: SlotKind; servings: number; eatNow: number; actuals?: ActualInput[]; storeIn?: 'fridge' | 'freezer' }) {
    if (i.eatNow > i.servings) throw new DomainError('EAT_GT_COOK', `做了 ${i.servings} 份，不能吃 ${i.eatNow} 份`);
    let session = i.sessionId ? tx.get<CookSession>('cook_sessions', i.sessionId) : undefined;
    if (i.sessionId && !session) throw new DomainError('NOT_STARTED', '找不到这次做饭');
    if (session && session.status !== 'started') throw new DomainError('ALREADY_FINISHED', '这次做饭已经确认过');
    const recipe = getRecipe(tx, session?.recipeId ?? i.recipeId ?? '');
    // 没带 sessionId 但这道菜有进行中的做饭：接上它，不留下幽灵会话。
    session ??= tx.state.cook_sessions.find((s) => s.status === 'started' && s.recipeId === recipe.id);
    const variantId = resolveVariant(tx, recipe.id, session?.variantId ?? i.variantId);
    const boundSlot = session?.slotId ? tx.get<MealSlot>('meal_slots', session.slotId) : undefined;
    const meal = i.date && i.slot ? { date: i.date, slot: i.slot }
      : boundSlot ? { date: boundSlot.date, slot: boundSlot.slot } : currentMeal(tx.ctx.now);
    const slotRef = session?.slotId ?? slotId(meal.date, meal.slot);

    if (!session) {
      session = tx.put<CookSession>('cook_sessions', {
        id: tx.newId('cook'), recipeId: recipe.id, variantId, slotId: tx.get('meal_slots', slotRef) ? slotRef : null, status: 'started',
        startedAt: tx.at, finishedAt: null, plannedServings: i.servings, actualServings: null, rev: 0,
      });
    }

    // 一个事务内：扣生料 + 建熟菜 + 记食用 + 改餐次。任何一步抛错都整体放弃。
    const lines = deductForCook(tx, session, recipe, i.servings, i.actuals ?? []);
    const t = today(tx);
    const storeIn = i.storeIn ?? 'fridge';
    const batch = tx.put<PreparedBatch>('prepared_batches', {
      id: tx.newId('batch'), recipeId: recipe.id, variantId, cookSessionId: session.id, name: recipe.name,
      portionsTotal: i.servings, portionsRemaining: i.servings, location: storeIn, cookedAt: t,
      useBy: addDays(t, storeIn === 'fridge' ? COOKED_FRIDGE_DAYS : COOKED_FREEZER_DAYS), status: 'active', rev: 0,
    });
    tx.append<PreparedPortionEvent>('prepared_portion_events', { id: tx.newId('ppe'), txId: tx.txId, batchId: batch.id, type: 'create', portionsDelta: i.servings, at: tx.at });
    tx.put<CookSession>('cook_sessions', { ...session, status: 'finished', finishedAt: tx.at, actualServings: i.servings });
    tx.put<Recipe>('recipes', { ...recipe, lastCookedAt: t });

    const slot = tx.get<MealSlot>('meal_slots', slotRef);
    if (i.eatNow > 0) {
      eatFromBatch(tx, batch.id, i.eatNow, meal.date, meal.slot);
    } else if (slot?.status === 'preparing') {
      tx.put<MealSlot>('meal_slots', { ...slot, status: 'planned' });
    }
    reflow(tx, `做了「${recipe.name}」`);

    const left = roundQty(i.servings - i.eatNow);
    const parts = [
      lines.length ? `原料扣减 ${lines.join('、')}` : '没有可扣减的库存记录',
      `新增 ${i.servings} 份熟菜`,
      i.eatNow > 0 ? `本餐吃 ${i.eatNow} 份，剩 ${left} 份` : `全部留存 ${left} 份`,
    ];
    tx.summary = parts.join('，');
    tx.data = { batchId: batch.id, sessionId: session.id };
  },
};

function eatFromBatch(tx: Tx, batchId: Id, n: number, date: LocalDate, slot: SlotKind) {
  const batch = getBatch(tx, batchId);
  if (batch.status !== 'active') throw new DomainError('BATCH_GONE', `「${batch.name}」已经没有了`);
  if (batch.location === 'freezer') throw new DomainError('FROZEN', `「${batch.name}」还在冷冻，先解冻`);
  if (n > batch.portionsRemaining) {
    throw new DomainError('NOT_ENOUGH_PORTIONS', `「${batch.name}」只剩 ${batch.portionsRemaining} 份，记录不了 ${n} 份。`);
  }
  const remaining = roundQty(batch.portionsRemaining - n);
  tx.put<PreparedBatch>('prepared_batches', { ...batch, portionsRemaining: remaining, status: remaining === 0 ? 'finished' : 'active' });
  tx.append<PreparedPortionEvent>('prepared_portion_events', { id: tx.newId('ppe'), txId: tx.txId, batchId, type: 'consume', portionsDelta: -n, at: tx.at });
  tx.append<ConsumptionEvent>('consumption_events', {
    id: tx.newId('ce'), txId: tx.txId, at: tx.at, date, slot, kind: 'prepared', batchId, ingredientId: null, recipeId: batch.recipeId, portions: n, label: batch.name,
  });
  if (slot === 'snack') {
    ensureSnackSlot(tx, date, batch.recipeId, batchId, n);
  } else {
    const s = tx.get<MealSlot>('meal_slots', slotId(date, slot));
    // 只有计划中/正在做的餐次变成「吃过」；已标记外食的餐次是另一个事实，不覆盖。
    if (s && (s.status === 'planned' || s.status === 'preparing')) tx.put<MealSlot>('meal_slots', { ...s, status: 'eaten', role: 'leftover', batchId, recipeId: s.recipeId ?? batch.recipeId, cookServings: 0 });
  }
}

function ensureSnackSlot(tx: Tx, date: LocalDate, recipeId: Id | null, batchId: Id | null, n: number) {
  const seq = tx.state.meal_slots.filter((s) => s.date === date && s.slot === 'snack').length;
  tx.put<MealSlot>('meal_slots', {
    id: `${date}:snack:${seq + 1}`, date, slot: 'snack', status: 'eaten', role: batchId ? 'leftover' : 'none', recipeId, variantId: null,
    cookServings: 0, portions: n, batchId, locked: false, source: 'user', rev: 0,
  });
}

/** 已存在熟菜的总份数和最先到期批次（可吃状态）。 */
export function edibleBatches(state: KitchenState): PreparedBatch[] {
  return state.prepared_batches.filter((b) => b.status === 'active' && b.location === 'fridge' && b.portionsRemaining > 0)
    .sort((a, b) => a.useBy.localeCompare(b.useBy));
}

const consumePreparedPortion = {
  schema: z.object({ batchId: z.string(), portions, date: dateStr.optional(), slot: anySlot.optional() }).strict(),
  run(tx: Tx, i: { batchId: string; portions: number; date?: string; slot?: SlotKind }) {
    const meal = i.date && i.slot ? { date: i.date, slot: i.slot } : currentMeal(tx.ctx.now);
    const batch = getBatch(tx, i.batchId);
    eatFromBatch(tx, i.batchId, i.portions, meal.date, meal.slot);
    reflow(tx, '吃掉熟菜');
    const left = tx.get<PreparedBatch>('prepared_batches', i.batchId)!.portionsRemaining;
    tx.summary = `吃掉 ${i.portions} 份「${batch.name}」，还剩 ${left} 份；生料不变`;
  },
};

const recordedEaten = (state: KitchenState, date: LocalDate, slot: SlotKind) => {
  const reversed = new Set(state.consumption_events.filter((c) => c.reverses).map((c) => c.reverses));
  return state.consumption_events.filter((c) => c.date === date && c.slot === slot && c.kind === 'prepared' && !reversed.has(c.id));
};

/** 「刚才把两份都吃了」：把这一餐的实际份数修正为总数，差多少补多少。 */
const reconcileMealPortions = {
  schema: z.object({ date: dateStr, slot: mealSlot, totalEaten: portions }).strict(),
  run(tx: Tx, i: { date: string; slot: 'lunch' | 'dinner'; totalEaten: number }) {
    const recorded = recordedEaten(tx.state, i.date, i.slot).reduce((n, c) => n + c.portions, 0);
    const extra = roundQty(i.totalEaten - recorded);
    if (extra <= 0) {
      throw new DomainError('NOTHING_TO_ADD', `这一餐已经记录了 ${recorded} 份，不需要再加。`);
    }
    const batches = edibleBatches(tx.state);
    const available = batches.reduce((n, b) => n + b.portionsRemaining, 0);
    if (extra > available) {
      throw new DomainError('NOT_ENOUGH_PORTIONS',
        available > 0
          ? `记录里这餐吃了 ${recorded} 份、熟菜只剩 ${available} 份，最多只能算 ${recorded + available} 份。`
          : `记录里这餐吃了 ${recorded} 份，已经没有剩余熟菜。多吃的部分没有库存可扣，不会记成负数。`,
        available > 0 ? [{ label: `按 ${recorded + available} 份记录`, input: { ...i, totalEaten: recorded + available } }] : undefined);
    }
    let left = extra;
    const slot = tx.get<MealSlot>('meal_slots', slotId(i.date, i.slot));
    for (const b of batches) {
      if (left <= 0) break;
      const take = Math.min(left, b.portionsRemaining);
      eatFromBatch(tx, b.id, take, i.date, i.slot);
      left = roundQty(left - take);
    }
    if (slot) reflow(tx, '修正食用份数');
    const remain = edibleBatches(tx.state).reduce((n, b) => n + b.portionsRemaining, 0);
    tx.summary = `这一餐记为 ${i.totalEaten} 份，补记 ${extra} 份；熟菜还剩 ${remain} 份`;
  },
};

/** 撤回一条记错的食用记录：份数回到熟菜，历史保留并追加补偿。 */
const revertConsumption = {
  schema: z.object({ date: dateStr, slot: mealSlot }).strict(),
  run(tx: Tx, i: { date: string; slot: 'lunch' | 'dinner' }) {
    const events = recordedEaten(tx.state, i.date, i.slot);
    if (events.length === 0) throw new DomainError('NOTHING_TO_REVERT', '这一餐没有食用记录');
    let total = 0;
    for (const c of events) {
      tx.append<ConsumptionEvent>('consumption_events', { ...c, id: tx.newId('ce'), txId: tx.txId, at: tx.at, kind: 'reversal', portions: -c.portions, reverses: c.id });
      total += c.portions;
      if (c.batchId) {
        const b = getBatch(tx, c.batchId);
        tx.put<PreparedBatch>('prepared_batches', { ...b, portionsRemaining: roundQty(b.portionsRemaining + c.portions), status: 'active' });
        tx.append<PreparedPortionEvent>('prepared_portion_events', { id: tx.newId('ppe'), txId: tx.txId, batchId: b.id, type: 'reversal', portionsDelta: c.portions, at: tx.at });
      }
    }
    const slot = tx.get<MealSlot>('meal_slots', slotId(i.date, i.slot));
    if (slot) tx.put<MealSlot>('meal_slots', { ...slot, status: 'skipped', role: 'none', batchId: null });
    reflow(tx, '修正：这餐没吃');
    tx.summary = `${friendlyDate(i.date, today(tx))}${SLOT_LABEL[i.slot]}改为没吃，${total} 份退回熟菜`;
  },
};

/** 修正已完成的做饭用量：追加补偿流水，不改写历史。 */
const reviseCookSession = {
  schema: z.object({ sessionId: z.string().optional(), ingredientId: z.string(), qty: z.number().min(0).optional(), delta: z.number().optional(), unit: z.string().optional() }).strict(),
  run(tx: Tx, i: { sessionId?: string; ingredientId: string; qty?: number; delta?: number; unit?: string }) {
    const sessions = tx.state.cook_sessions.filter((s) => s.status === 'finished').sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''));
    const session = i.sessionId ? sessions.find((s) => s.id === i.sessionId) : sessions[0];
    if (!session) throw new DomainError('NO_SESSION', '还没有已完成的做饭记录');
    const ing = ingredientById(tx.state, i.ingredientId);
    const row = tx.state.cook_session_ingredients.find((r) => r.sessionId === session.id && r.ingredientId === i.ingredientId);
    const convert = (q: number) => {
      if (!i.unit) return q;
      const c = toCanonical(q, i.unit, ing);
      if (!c) throw new DomainError('NEEDS_SPEC', `还不知道 1${i.unit}${ing.name} 有多重，请告诉我大约几克。`);
      return c.qty;
    };
    const prev = row?.actualQty ?? 0;
    const target = i.qty !== undefined ? convert(i.qty) : roundQty(prev + convert(i.delta ?? 0));
    if (target < 0) throw new DomainError('NEGATIVE', '用量不能是负数');
    const diff = roundQty(target - prev);
    if (diff === 0) throw new DomainError('NO_CHANGE', '用量没有变化');
    const unit = ing.unit === 'count' ? ing.countUnit ?? '' : ing.unit;
    const allocations = [...(row?.allocations ?? [])];
    let shortfall = row?.shortfall ?? 0;
    const note = `修正「${recipeOf(tx.state, session.recipeId)?.name}」用量`;

    if (diff > 0) {
      const alloc = deduct(tx, i.ingredientId, diff, note, 'adjust');
      allocations.push(...alloc.allocations);
      shortfall = roundQty(shortfall + alloc.shortfall);
      if (alloc.shortfall > 0) tx.warnings.push(`${ing.name}库存不足，差额 ${formatQty(alloc.shortfall, unit)} 待核对`);
    } else {
      // 退回时先冲掉差额记录，再按 LIFO 退回之前实际扣过的批次。
      let back = -diff;
      const clearShort = Math.min(shortfall, back);
      shortfall = roundQty(shortfall - clearShort);
      back = roundQty(back - clearShort);
      for (let n = allocations.length - 1; n >= 0 && back > 0; n--) {
        const a = allocations[n];
        const give = roundQty(Math.min(a.qty, back));
        const lot = tx.get<InventoryLot>('inventory_lots', a.lotId);
        if (!lot) continue;
        const reopened: InventoryLot = lot.status === 'depleted' ? { ...lot, status: 'active' } : lot;
        applyDelta(tx, reopened, give, 'adjust', note);
        allocations[n] = { ...a, qty: roundQty(a.qty - give) };
        back = roundQty(back - give);
      }
    }
    const nextRow: CookSessionIngredient = row
      ? { ...row, actualQty: target, allocations: allocations.filter((a) => a.qty > 0), shortfall }
      : { id: tx.newId('csi'), sessionId: session.id, ingredientId: i.ingredientId, plannedQty: 0, actualQty: target, unit, allocations, usedUnknownLot: false, shortfall, estimated: false, rev: 0 };
    tx.put('cook_session_ingredients', nextRow);
    tx.summary = `${ing.name}用量由 ${formatQty(prev, unit)} 改为 ${formatQty(target, unit)}，库存${diff > 0 ? '再扣' : '退回'} ${formatQty(Math.abs(diff), unit)}`;
  },
};

const discardBatch = {
  schema: z.object({ batchId: z.string(), portions: portions.optional() }).strict(),
  run(tx: Tx, i: { batchId: string; portions?: number }) {
    const b = getBatch(tx, i.batchId);
    const n = i.portions ?? b.portionsRemaining;
    if (n > b.portionsRemaining) throw new DomainError('NOT_ENOUGH_PORTIONS', `只剩 ${b.portionsRemaining} 份`);
    const remaining = roundQty(b.portionsRemaining - n);
    tx.put<PreparedBatch>('prepared_batches', { ...b, portionsRemaining: remaining, status: remaining === 0 ? 'discarded' : 'active' });
    tx.append<PreparedPortionEvent>('prepared_portion_events', { id: tx.newId('ppe'), txId: tx.txId, batchId: b.id, type: 'discard', portionsDelta: -n, at: tx.at });
    reflow(tx, '丢弃熟菜');
    tx.summary = `丢弃 ${n} 份「${b.name}」`;
  },
};

const moveBatch = {
  schema: z.object({ batchId: z.string(), to: z.enum(['fridge', 'freezer']) }).strict(),
  run(tx: Tx, i: { batchId: string; to: 'fridge' | 'freezer' }) {
    const b = getBatch(tx, i.batchId);
    if (b.status !== 'active') throw new DomainError('BATCH_GONE', '这份熟菜已经没有了');
    if (b.location === i.to) return;
    const t = today(tx);
    tx.put<PreparedBatch>('prepared_batches', { ...b, location: i.to, useBy: addDays(t, i.to === 'freezer' ? COOKED_FREEZER_DAYS : COOKED_FRIDGE_DAYS) });
    tx.append<PreparedPortionEvent>('prepared_portion_events', { id: tx.newId('ppe'), txId: tx.txId, batchId: b.id, type: i.to === 'freezer' ? 'freeze' : 'thaw', portionsDelta: 0, at: tx.at });
    reflow(tx, i.to === 'freezer' ? '熟菜冷冻' : '熟菜解冻');
    tx.summary = i.to === 'freezer' ? `「${b.name}」已冷冻` : `「${b.name}」已转冷藏解冻`;
  },
};

/* ───────────── 库存 ───────────── */

interface LotInit {
  ingredient: Ingredient;
  qty: number | null;
  rawLabel?: string | null;
  location: Location;
  productId?: Id | null;
  purchasedAt?: LocalDate | null;
  packageUseBy?: LocalDate | null;
  confidence: InventoryLot['confidence'];
  eventType: 'purchase' | 'adjust';
  note: string;
}

function createLot(tx: Tx, init: LotInit): InventoryLot {
  const ing = init.ingredient;
  const unit = ing.unit === 'count' ? ing.countUnit ?? '个' : ing.unit;
  const rule = ruleUseBy(ing, init.location, today(tx));
  const lot = tx.put<InventoryLot>('inventory_lots', {
    id: tx.newId('lot'), ingredientId: ing.id, productId: init.productId ?? null, qty: init.qty, unit, rawLabel: init.rawLabel ?? null,
    location: init.location, purchasedAt: init.purchasedAt ?? null, openedAt: null, frozenAt: init.location === 'freezer' ? today(tx) : null, thawedAt: null,
    useBy: init.packageUseBy ?? rule.useBy, useBySource: init.packageUseBy ? 'package' : rule.source,
    confidence: init.confidence, status: 'active', rev: 0,
  });
  tx.append<InventoryEvent>('inventory_events', {
    id: tx.newId('ie'), txId: tx.txId, lotId: lot.id, ingredientId: ing.id, type: init.eventType, qtyDelta: init.qty, unit, at: tx.at, note: init.note,
  });
  if (ing.markedOut) tx.put<Ingredient>('ingredients', { ...tx.get<Ingredient>('ingredients', ing.id)!, markedOut: false });
  return lot;
}

/** 校准到一个确认数量：批次多退少补，全部有流水。 */
const adjustInventory = {
  schema: z.object({ ingredientId: z.string(), qty: z.number().min(0), unit: z.string().optional(), location: location.optional() }).strict(),
  run(tx: Tx, i: { ingredientId: string; qty: number; unit?: string; location?: Location }) {
    const ing = ingredientById(tx.state, i.ingredientId);
    if (ing.unit === 'level') throw new DomainError('LEVEL_ONLY', `${ing.name}只记「有/快用完/没有」，不记克数`);
    const c = i.unit ? toCanonical(i.qty, i.unit, ing) : { qty: i.qty, unit: ing.unit === 'count' ? ing.countUnit ?? '个' : ing.unit, viaUserSpec: false };
    if (!c) throw new DomainError('NEEDS_SPEC', `还不知道 1${i.unit}${ing.name} 有多重，请用克数或先定义规格。`);
    const lots = activeLots(tx.state, ing.id).filter((l) => !i.location || l.location === i.location);
    const unknown = lots.filter((l) => l.qty === null);
    const known = lots.filter((l) => l.qty !== null).reduce((n, l) => n + l.qty!, 0);
    const unit = ing.unit === 'count' ? ing.countUnit ?? '个' : ing.unit;
    let remaining = c.qty;
    // 先把数量未知的批次「实数化」，这是核对最常见的情况。
    for (const lot of unknown) {
      const set = roundQty(Math.max(0, remaining - known));
      tx.put<InventoryLot>('inventory_lots', { ...lot, qty: set, rawLabel: null, confidence: c.viaUserSpec ? 'estimated' : 'confirmed', status: set > 0 ? 'active' : 'depleted' });
      tx.append<InventoryEvent>('inventory_events', { id: tx.newId('ie'), txId: tx.txId, lotId: lot.id, ingredientId: ing.id, type: 'adjust', qtyDelta: set, unit, at: tx.at, note: '核对数量' });
      remaining = roundQty(remaining - set);
    }
    const diff = roundQty(remaining - known);
    if (diff > 0) {
      const target = fefoSort(activeLots(tx.state, ing.id).filter((l) => l.qty !== null && (!i.location || l.location === i.location)))[0];
      if (target) applyDelta(tx, target, diff, 'adjust', '核对数量');
      else createLot(tx, { ingredient: ing, qty: diff, location: i.location ?? ing.defaultLocation, confidence: 'confirmed', eventType: 'adjust', note: '核对数量' });
    } else if (diff < 0) {
      let cut = -diff;
      for (const lot of fefoSort(activeLots(tx.state, ing.id).filter((l) => l.qty !== null && (!i.location || l.location === i.location)))) {
        if (cut <= 0) break;
        const take = roundQty(Math.min(lot.qty!, cut));
        applyDelta(tx, lot, -take, 'adjust', '核对数量');
        cut = roundQty(cut - take);
      }
    }
    if (ing.markedOut) tx.put<Ingredient>('ingredients', { ...tx.get<Ingredient>('ingredients', ing.id)!, markedOut: false });
    reflow(tx, '库存校准');
    tx.summary = `${ing.name}校准为 ${formatQty(c.qty, unit)}`;
  },
};

/** 首次核对：一次提交多项，每项只说有/没有，数量可选。 */
const calibrateInventory = {
  schema: z.object({
    entries: z.array(z.object({
      ingredientId: z.string(), present: z.boolean(), qty: z.number().min(0).optional(), unit: z.string().optional(),
      location: location.optional(), level: z.enum(['have', 'low', 'out', 'unconfirmed']).optional(),
    }).strict()).min(1),
  }).strict(),
  run(tx: Tx, i: { entries: { ingredientId: string; present: boolean; qty?: number; unit?: string; location?: Location; level?: Level }[] }) {
    let n = 0;
    for (const e of i.entries) {
      const ing = ingredientById(tx.state, e.ingredientId);
      n++;
      if (ing.unit === 'level') {
        tx.put<Ingredient>('ingredients', { ...ing, level: e.level ?? (e.present ? 'have' : 'out') });
        continue;
      }
      if (!e.present) {
        tx.put<Ingredient>('ingredients', { ...ing, markedOut: true });
        continue;
      }
      const c = e.qty !== undefined ? (e.unit ? toCanonical(e.qty, e.unit, ing) : { qty: e.qty }) : null;
      createLot(tx, {
        ingredient: ing, qty: c ? c.qty : null, rawLabel: e.qty !== undefined && !c ? `${e.qty}${e.unit ?? ''}` : null,
        location: e.location ?? ing.defaultLocation, confidence: c ? 'confirmed' : 'unknown', eventType: 'adjust', note: '首次核对',
      });
    }
    reflow(tx, '首次核对');
    tx.summary = `已核对 ${n} 项`;
  },
};

const setSeasoningLevel = {
  schema: z.object({ ingredientId: z.string(), level: z.enum(['have', 'low', 'out', 'unconfirmed']) }).strict(),
  run(tx: Tx, i: { ingredientId: string; level: Level }) {
    const ing = ingredientById(tx.state, i.ingredientId);
    if (ing.unit !== 'level') throw new DomainError('NOT_LEVEL', `${ing.name}按数量记账`);
    tx.put<Ingredient>('ingredients', { ...ing, level: i.level });
    tx.summary = `${ing.name}：${{ have: '有', low: '快用完', out: '没有', unconfirmed: '未确认' }[i.level]}`;
  },
};

/** 营养估算用的每份烹调油。只影响估算，不碰库存。 */
const setCookingOil = {
  schema: z.object({ grams: z.number().min(0).max(50) }).strict(),
  run(tx: Tx, i: { grams: number }) {
    setPref(tx, COOKING_OIL_PREF, i.grams);
    tx.summary = `每份默认用油改为 ${i.grams}g`;
    tx.undoable = false;
  },
};

/** 库存链接：一次设好多项总量。一个事务，撤销时整批退回。 */
const importStock = {
  schema: z.object({
    entries: z.array(z.object({ ingredientId: z.string(), qty: z.number(), unit: z.string().optional(), add: z.literal(true).optional() }).strict()).max(200),
    have: z.array(z.string()).max(200),
  }).strict(),
  run(tx: Tx, i: { entries: { ingredientId: string; qty: number; unit?: string; add?: true }[]; have: string[] }) {
    for (const e of i.entries) {
      if (e.add) changeStock(tx, e);
      else adjustInventory.run(tx, adjustInventory.schema.parse({ ingredientId: e.ingredientId, qty: e.qty, ...(e.unit ? { unit: e.unit } : {}) }));
    }
    for (const id of i.have) setSeasoningLevel.run(tx, { ingredientId: id, level: 'have' });
    reflow(tx, '导入库存');
    tx.summary = `已导入 ${i.entries.length} 项库存、${i.have.length} 种调料`;
  },
};

/** 增加是新批次，不碰数量未知的批次；减少走先到期先用，扣到 0 为止，差额提示核对。 */
function changeStock(tx: Tx, e: { ingredientId: string; qty: number; unit?: string }) {
  const ing = ingredientById(tx.state, e.ingredientId);
  const c = e.unit ? toCanonical(Math.abs(e.qty), e.unit, ing) : { qty: Math.abs(e.qty) };
  if (!c) throw new DomainError('NEEDS_SPEC', `还不知道 1${e.unit}${ing.name} 有多重`);
  if (e.qty < 0) {
    const alloc = deduct(tx, ing.id, c.qty, '库存链接', 'adjust');
    if (alloc.shortfall > 0) tx.warnings.push(`${ing.name}库存记录不足，差额待核对`);
    return;
  }
  createLot(tx, { ingredient: ing, qty: c.qty, location: ing.defaultLocation, confidence: 'confirmed', eventType: 'adjust', note: '库存链接' });
  if (ing.markedOut) tx.put<Ingredient>('ingredients', { ...tx.get<Ingredient>('ingredients', ing.id)!, markedOut: false });
}

const setUnitSpec = {
  schema: z.object({ ingredientId: z.string(), unit: z.string().min(1), qty: z.number().positive() }).strict(),
  run(tx: Tx, i: { ingredientId: string; unit: string; qty: number }) {
    const ing = ingredientById(tx.state, i.ingredientId);
    tx.put<Ingredient>('ingredients', { ...ing, unitSpecs: { ...ing.unitSpecs, [i.unit]: i.qty } });
    tx.summary = `记下了：1${i.unit}${ing.name} ≈ ${i.qty}${ing.unit}`;
  },
};

/** 冷藏 ⇄ 冷冻：是一次转移，总量守恒，不是复制。 */
const moveInventory = {
  schema: z.object({ lotId: z.string(), to: location, qty: z.number().positive().optional() }).strict(),
  run(tx: Tx, i: { lotId: string; to: Location; qty?: number }) {
    const lot = getLot(tx, i.lotId);
    if (lot.location === i.to) throw new DomainError('SAME_LOCATION', '已经在这个位置');
    const ing = ingredientById(tx.state, lot.ingredientId);
    const t = today(tx);
    const thawing = lot.location === 'freezer' && i.to !== 'freezer';
    const rule = ruleUseBy(ing, i.to, t, thawing);
    const dest = {
      location: i.to, frozenAt: i.to === 'freezer' ? t : lot.frozenAt, thawedAt: thawing ? t : lot.thawedAt,
      useBy: i.to === 'freezer' ? null : rule.useBy ?? lot.useBy, useBySource: i.to === 'freezer' ? null : (rule.source ?? lot.useBySource),
    };
    if (lot.qty === null) {
      tx.put<InventoryLot>('inventory_lots', { ...lot, ...dest });
      tx.append<InventoryEvent>('inventory_events', { id: tx.newId('ie'), txId: tx.txId, lotId: lot.id, ingredientId: lot.ingredientId, type: 'transfer', qtyDelta: null, unit: lot.unit, at: tx.at, note: `转到${LOCATION_LABEL[i.to]}` });
    } else {
      const qty = i.qty ?? lot.qty;
      if (qty > lot.qty) throw new DomainError('NOT_ENOUGH', `这批只有 ${formatQty(lot.qty, lot.unit)}`);
      applyDelta(tx, lot, -qty, 'transfer', `转到${LOCATION_LABEL[i.to]}`);
      const moved = tx.put<InventoryLot>('inventory_lots', { ...lot, ...dest, id: tx.newId('lot'), qty, status: 'active', rev: 0 });
      tx.append<InventoryEvent>('inventory_events', { id: tx.newId('ie'), txId: tx.txId, lotId: moved.id, ingredientId: lot.ingredientId, type: 'transfer', qtyDelta: qty, unit: lot.unit, at: tx.at, note: `来自${LOCATION_LABEL[lot.location]}` });
    }
    reflow(tx, '库存转移');
    tx.summary = `${ing.name} ${i.qty ? formatQty(i.qty, lot.unit) : lotLabel(lot)} 转到${LOCATION_LABEL[i.to]}`;
  },
};

const discardLot = {
  schema: z.object({ lotId: z.string(), qty: z.number().positive().optional(), reason: z.string().max(100).optional() }).strict(),
  run(tx: Tx, i: { lotId: string; qty?: number; reason?: string }) {
    const lot = getLot(tx, i.lotId);
    const ing = ingredientById(tx.state, lot.ingredientId);
    if (lot.qty === null) {
      tx.put<InventoryLot>('inventory_lots', { ...lot, status: 'discarded' });
      tx.append<InventoryEvent>('inventory_events', { id: tx.newId('ie'), txId: tx.txId, lotId: lot.id, ingredientId: lot.ingredientId, type: 'discard', qtyDelta: null, unit: lot.unit, at: tx.at, note: i.reason });
    } else {
      const qty = i.qty ?? lot.qty;
      if (qty > lot.qty) throw new DomainError('NOT_ENOUGH', `这批只有 ${formatQty(lot.qty, lot.unit)}`);
      applyDelta(tx, lot, -qty, 'discard', i.reason ?? '报废');
    }
    reflow(tx, '报废食材');
    tx.summary = `已报废 ${ing.name} ${i.qty ? formatQty(i.qty, lot.unit) : lotLabel(lot)}`;
  },
};

/** 把原包装即食食品记为加餐，只扣它自己。 */
const recordSnack = {
  schema: z.object({ ingredientId: z.string().optional(), qty: z.number().positive().optional(), unit: z.string().optional(), label: z.string().max(60).optional(), date: dateStr.optional() }).strict(),
  run(tx: Tx, i: { ingredientId?: string; qty?: number; unit?: string; label?: string; date?: string }) {
    const date = i.date ?? today(tx);
    let label = i.label ?? '加餐';
    let eatenQty: number | undefined;
    if (i.ingredientId) {
      const ing = ingredientById(tx.state, i.ingredientId);
      label = i.label ?? ing.name;
      if (i.qty !== undefined && ing.unit !== 'level') {
        const c = i.unit ? toCanonical(i.qty, i.unit, ing) : { qty: i.qty };
        if (!c) throw new DomainError('NEEDS_SPEC', `还不知道 1${i.unit}${ing.name} 有多重，请直接填克数。`);
        const alloc = deduct(tx, ing.id, c.qty, '加餐');
        if (alloc.shortfall > 0) tx.warnings.push(`${ing.name}库存记录不足，差额待核对`);
        eatenQty = c.qty;
      }
    }
    tx.append<ConsumptionEvent>('consumption_events', {
      id: tx.newId('ce'), txId: tx.txId, at: tx.at, date, slot: 'snack', kind: 'ready_to_eat', batchId: null, ingredientId: i.ingredientId ?? null, recipeId: null, portions: 1, label,
      ...(eatenQty !== undefined ? { qty: eatenQty } : {}),
    });
    ensureSnackSlot(tx, date, null, null, 1);
    tx.summary = `记下加餐：${label}`;
  },
};

/** 目录里没有的新食材。只进目录，不产生任何库存。 */
const addIngredient = {
  schema: z.object({
    name: z.string().trim().min(1).max(40),
    aliases: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
    category: z.enum(['protein', 'fresh', 'frozen_veg', 'pantry', 'staple']),
    unit: z.enum(['g', 'ml', 'count']),
    countUnit: z.string().max(4).optional(),
    defaultLocation: location,
  }).strict(),
  run(tx: Tx, i: { name: string; aliases?: string[]; category: Ingredient['category']; unit: 'g' | 'ml' | 'count'; countUnit?: string; defaultLocation: Location }) {
    const dup = tx.state.ingredients.find((x) => x.name === i.name);
    // 备用食材在库存页是收起的，用户看不到它，所以直接沿用而不是报重名。
    if (dup?.catalogOnly) { tx.summary = `目录里已经有 ${dup.name}`; tx.data = { ingredientId: dup.id }; return; }
    if (dup) throw new DomainError('DUPLICATE', `目录里已经有${i.name}`);
    const ing = tx.put<Ingredient>('ingredients', {
      id: tx.newId('ing'), name: i.name, aliases: i.aliases ?? [], category: i.category, unit: i.unit,
      ...(i.unit === 'count' ? { countUnit: i.countUnit ?? '个' } : {}),
      unitSpecs: {}, highRisk: false, defaultLocation: i.defaultLocation, shelfDays: null, thawedDays: null,
      freezable: false, needsThaw: false, quickThawMinutes: null, level: null, markedOut: false, rev: 0,
    });
    tx.summary = `目录新增 ${i.name}`;
    tx.data = { ingredientId: ing.id };
  },
};

const setNextShopDate = {
  schema: z.object({ date: dateStr, intervalDays: z.number().int().min(1).max(60).optional() }).strict(),
  run(tx: Tx, i: { date: string; intervalDays?: number }) {
    setPref(tx, 'nextShopDate', i.date);
    if (i.intervalDays) setPref(tx, 'shopIntervalDays', i.intervalDays);
    tx.summary = `下次采购改到 ${friendlyDate(i.date, today(tx))}`;
    tx.undoable = false;
  },
};

/* ───────────── 采购 ───────────── */

const purchaseLine = z.object({
  ingredientId: z.string(),
  bought: z.boolean(),
  qty: z.number().positive().optional(),
  unit: z.string().optional(),
  /** 例如洋葱按颗买时，用户当场填的「每颗约多少克」。 */
  perUnitQty: z.number().positive().optional(),
  location: location.optional(),
  packageUseBy: dateStr.optional(),
  productId: z.string().optional(),
}).strict();
type PurchaseLine = z.infer<typeof purchaseLine>;

const confirmPurchase = {
  schema: z.object({ listId: z.string().optional(), lines: z.array(purchaseLine).min(1) }).strict(),
  run(tx: Tx, i: { listId?: string; lines: PurchaseLine[] }) {
    if (i.listId) {
      const list = tx.get<ShoppingList>('shopping_lists', i.listId);
      if (list?.status === 'confirmed') throw new DomainError('ALREADY_CONFIRMED', '这份清单已经入库过了');
    }
    const t = today(tx);
    const lotIds: Id[] = [];
    const notBought: { ingredientId: Id; name: string }[] = [];
    const bought: string[] = [];
    for (const line of i.lines) {
      const ing = ingredientById(tx.state, line.ingredientId);
      if (!line.bought) { notBought.push({ ingredientId: ing.id, name: ing.name }); continue; }
      if (ing.unit === 'level') {
        tx.put<Ingredient>('ingredients', { ...ing, level: 'have' });
        bought.push(ing.name);
        continue;
      }
      let target = ing;
      if (line.perUnitQty && line.unit) {
        target = tx.put<Ingredient>('ingredients', { ...ing, unitSpecs: { ...ing.unitSpecs, [line.unit]: line.perUnitQty } });
      }
      const c = line.qty !== undefined ? (line.unit ? toCanonical(line.qty, line.unit, target) : { qty: line.qty, viaUserSpec: false }) : null;
      const raw = line.qty !== undefined ? `${line.qty}${line.unit ?? ''}` : null;
      const lot = createLot(tx, {
        ingredient: target, qty: c ? c.qty : null, rawLabel: c ? null : raw, location: line.location ?? ing.defaultLocation,
        productId: line.productId ?? null, purchasedAt: t, packageUseBy: line.packageUseBy ?? null,
        confidence: !c ? 'unknown' : c.viaUserSpec ? 'estimated' : 'confirmed', eventType: 'purchase', note: '采购入库',
      });
      lotIds.push(lot.id);
      bought.push(`${ing.name}${c ? formatQty(c.qty, lot.unit) : raw ? `${raw}（克数待核对）` : '（数量未知）'}`);
    }
    tx.append<PurchaseConfirmation>('purchase_confirmations', { id: tx.newId('pc'), listId: i.listId ?? null, txId: tx.txId, at: tx.at, lotIds, notBought });
    if (i.listId) {
      const list = tx.get<ShoppingList>('shopping_lists', i.listId);
      if (list) tx.put<ShoppingList>('shopping_lists', { ...list, status: 'confirmed', confirmedAt: tx.at });
    }
    setPref(tx, 'nextShopDate', addDays(t, pref<number>(tx.state, 'shopIntervalDays', 14)));
    for (const line of i.lines) {
      const ing = ingredientById(tx.state, line.ingredientId);
      if (line.bought && ing.category === 'fresh' && ing.shelfDays !== null && ing.shelfDays <= 7) pullForward(tx, ing.id, 3);
    }
    reflow(tx, '采购入库');
    tx.summary = `已入库 ${bought.length} 项${notBought.length ? `，其余 ${notBought.length} 项这次没买` : ''}`;
    tx.details.unshift(...bought.slice(0, 8));
  },
};

const createShoppingList = {
  schema: z.object({}).strict(),
  run(tx: Tx) {
    const forecast = forecastShopping(tx.state, tx.ctx.now);
    const existing = tx.state.shopping_lists.find((l) => l.status === 'draft');
    const list = existing ?? tx.put<ShoppingList>('shopping_lists', { id: tx.newId('list'), status: 'draft', createdAt: tx.at, confirmedAt: null, shopDate: forecast.shopDate, rev: 0 });
    const keep = new Set(tx.state.shopping_items.filter((x) => x.listId === list.id).map((x) => x.ingredientId));
    let added = 0;
    for (const f of forecast.items) {
      if (f.tag === 'enough' || keep.has(f.ingredientId)) continue;
      tx.put<ShoppingItem>('shopping_items', {
        id: tx.newId('si'), listId: list.id, ingredientId: f.ingredientId, productId: f.productId, name: f.name, tag: f.tag,
        suggestedQty: f.suggestedQty, unit: f.unit, packLabel: f.packLabel, reason: f.reason, rev: 0,
      });
      added++;
    }
    tx.summary = `清单新增 ${added} 项（只是计划，不影响库存）`;
    tx.data = { listId: list.id };
  },
};

const addShoppingItem = {
  schema: z.object({ listId: z.string(), ingredientId: z.string(), qty: z.number().positive().optional() }).strict(),
  run(tx: Tx, i: { listId: string; ingredientId: string; qty?: number }) {
    const ing = ingredientById(tx.state, i.ingredientId);
    if (tx.state.shopping_items.some((x) => x.listId === i.listId && x.ingredientId === ing.id)) return;
    const product = tx.state.products.find((p) => p.ingredientId === ing.id);
    tx.put<ShoppingItem>('shopping_items', {
      id: tx.newId('si'), listId: i.listId, ingredientId: ing.id, productId: product?.id ?? null, name: ing.name, tag: 'optional',
      suggestedQty: i.qty ?? null, unit: ing.unit === 'count' ? ing.countUnit ?? '' : ing.unit === 'level' ? '' : ing.unit, packLabel: product?.name ?? '手动添加', reason: '手动添加', rev: 0,
    });
    tx.summary = `清单加入 ${ing.name}`;
  },
};

/** 放弃还没入库的清单，回到最新的采购预测。 */
const discardShoppingList = {
  schema: z.object({ listId: z.string() }).strict(),
  run(tx: Tx, i: { listId: string }) {
    const list = tx.get<ShoppingList>('shopping_lists', i.listId);
    if (!list || list.status !== 'draft') throw new DomainError('NOT_DRAFT', '这份清单已经入库');
    for (const item of tx.state.shopping_items.filter((x) => x.listId === i.listId)) tx.remove('shopping_items', item.id);
    tx.remove('shopping_lists', i.listId);
    tx.summary = '已放弃这份清单';
  },
};

const removeShoppingItem = {
  schema: z.object({ itemId: z.string() }).strict(),
  run(tx: Tx, i: { itemId: string }) {
    tx.remove('shopping_items', i.itemId);
    tx.summary = '已从清单移除';
  },
};

const copyLastPurchase = {
  schema: z.object({ listId: z.string() }).strict(),
  run(tx: Tx, i: { listId: string }) {
    const last = [...tx.state.purchase_confirmations].sort((a, b) => b.at.localeCompare(a.at))[0];
    if (!last) throw new DomainError('NO_HISTORY', '还没有上次的采购记录');
    const have = new Set(tx.state.shopping_items.filter((x) => x.listId === i.listId).map((x) => x.ingredientId));
    let added = 0;
    for (const lotId of last.lotIds) {
      const lot = tx.get<InventoryLot>('inventory_lots', lotId);
      if (!lot || have.has(lot.ingredientId)) continue;
      const ing = ingredientById(tx.state, lot.ingredientId);
      const purchased = tx.state.inventory_events.find((e) => e.lotId === lotId && e.type === 'purchase');
      have.add(ing.id);
      tx.put<ShoppingItem>('shopping_items', {
        id: tx.newId('si'), listId: i.listId, ingredientId: ing.id, productId: lot.productId, name: ing.name, tag: 'optional',
        suggestedQty: purchased?.qtyDelta ?? null, unit: lot.unit, packLabel: '上次买过', reason: '复制上次已购', rev: 0,
      });
      added++;
    }
    tx.summary = `复制了上次的 ${added} 项`;
  },
};

/* ───────────── 反馈 ───────────── */

const rateRecipe = {
  schema: z.object({ recipeId: z.string(), feedback: z.enum(['good', 'meh', 'avoid']).nullable(), note: z.string().max(300).optional() }).strict(),
  run(tx: Tx, i: { recipeId: string; feedback: Recipe['feedback']; note?: string }) {
    const r = getRecipe(tx, i.recipeId);
    tx.put<Recipe>('recipes', { ...r, feedback: i.feedback, notes: i.note ?? r.notes });
    tx.summary = `记下了：${r.name}`;
  },
};

const updateRecipe = {
  schema: z.object({ recipeId: z.string(), enabled: z.boolean().optional(), notes: z.string().max(1000).optional(), ingredientQty: z.array(z.object({ rowId: z.string(), qty: z.number().min(0) }).strict()).optional() }).strict(),
  run(tx: Tx, i: { recipeId: string; enabled?: boolean; notes?: string; ingredientQty?: { rowId: string; qty: number }[] }) {
    const r = getRecipe(tx, i.recipeId);
    tx.put<Recipe>('recipes', { ...r, enabled: i.enabled ?? r.enabled, notes: i.notes ?? r.notes });
    for (const e of i.ingredientQty ?? []) {
      const row = tx.state.recipe_ingredients.find((x) => x.id === e.rowId);
      if (row && row.recipeId === r.id) tx.put('recipe_ingredients', { ...row, qty: e.qty } as never);
    }
    tx.summary = `已保存「${r.name}」`;
  },
};

const OUTDATED_NOTES: [Id, string][] = [['chicken_breast', '采购时可按一顿/一天分袋，冷冻前保持原味']];
/** 鸡胸肉和牛肉碎一袋 1 lb，菜谱默认用量从 500g 改成 454g。 */
const OLD_BAG_QTY = 500;
const BAG_QTY = 454;

/**
 * 把新版本目录并进已有数据：只加缺的行，不改用户已有的行。
 * ensureSeeded 只在空库时写入，已经在用的手机靠这条命令拿到新菜谱。
 */
const syncCatalog = {
  schema: z.object({}).strict(),
  run(tx: Tx) {
    const seed = seedState();
    const existing = tx.state.ingredients;
    const ids = new Set(existing.map((x) => x.id));
    // 用户自己建过同名食材时沿用那一条，否则库存里会出现两个「土豆」。
    const renamed = new Map<Id, Id>();
    const missing: Ingredient[] = [];
    for (const ing of seed.ingredients) {
      if (ids.has(ing.id)) continue;
      const names = new Set([ing.name, ...ing.aliases]);
      const same = existing.find((x) => names.has(x.name) || x.aliases.includes(ing.name));
      if (same) renamed.set(ing.id, same.id);
      else missing.push(ing);
    }
    missing.forEach((ing) => tx.put('ingredients', ing));
    // 过时的目录提示只在原文没变时替换。这个字段用户改不了，不会盖掉用户内容。
    for (const [id, outdated] of OUTDATED_NOTES) {
      const row = tx.get<Ingredient>('ingredients', id);
      const note = seed.ingredients.find((x) => x.id === id)?.note;
      if (row?.note === outdated && note) tx.put('ingredients', { ...row, note });
    }
    const addMissing = <T extends { id: Id }>(table: 'products' | 'ingredient_substitutions' | 'recipes' | 'recipe_variants' | 'recipe_ingredients' | 'recipe_steps', rows: T[]) => {
      const have = new Set((tx.state[table] as { id: Id }[]).map((r) => r.id));
      let added = 0;
      for (const r of rows) if (!have.has(r.id)) { tx.put(table, r); added++; }
      return added;
    };
    addMissing('products', seed.products);
    addMissing('ingredient_substitutions', seed.ingredient_substitutions);
    const recipes = addMissing('recipes', seed.recipes);
    addMissing('recipe_variants', seed.recipe_variants);
    addMissing('recipe_ingredients', seed.recipe_ingredients.map((r) => ({ ...r, ingredientId: renamed.get(r.ingredientId) ?? r.ingredientId })));
    addMissing('recipe_steps', seed.recipe_steps);
    // 用量用户改得了，所以只迁移一次：之后用户自己改回 500g 也不会被盖掉。
    if (!tx.get<Preference>('preferences', BAG_QTY_MIGRATION)) {
      for (const row of seed.recipe_ingredients) {
        const cur = tx.get<RecipeIngredient>('recipe_ingredients', row.id);
        if (row.qty === BAG_QTY && cur?.qty === OLD_BAG_QTY) tx.put<RecipeIngredient>('recipe_ingredients', { ...cur, qty: BAG_QTY });
      }
      tx.put<Preference>('preferences', { id: BAG_QTY_MIGRATION, value: true, rev: 0 });
    }
    tx.summary = `目录新增 ${recipes} 道菜、${missing.length} 种食材`;
    tx.undoable = false;
  },
};

const clearAiHistory = {
  schema: z.object({}).strict(),
  run(tx: Tx) {
    for (const p of tx.state.ai_action_proposals) {
      tx.put('ai_action_proposals', { ...p, sourceText: null, raw: null });
    }
    tx.summary = '已清除 AI 原话和草稿';
    tx.undoable = false;
  },
};

const undoTransaction = {
  schema: z.object({ operationId: z.string() }).strict(),
  run(tx: Tx, i: { operationId: string }) {
    undoOperation(tx, i.operationId);
    commitPlanVersion(tx, '撤销');
  },
};

export const COMMANDS = {
  setMealStatus, setDayAway, restoreMeal, setPortionTarget, changeMealCount, swapRecipe, moveMeal, lockSlot, setConstraint, syncPlan,
  startCookSession, cancelCookSession, finishCook, consumePreparedPortion, reconcileMealPortions, revertConsumption, reviseCookSession,
  discardBatch, moveBatch, adjustInventory, importStock, setCookingOil, calibrateInventory, addIngredient, setNextShopDate, setSeasoningLevel, setUnitSpec, moveInventory, discardLot, recordSnack,
  confirmPurchase, createShoppingList, discardShoppingList, addShoppingItem, removeShoppingItem, copyLastPurchase, rateRecipe, updateRecipe, syncCatalog, clearAiHistory, undoTransaction,
} as const;

export type CommandName = keyof typeof COMMANDS;
export { slotSort };
