import { addDays, friendlyDate, localDate, localHour, shortDate, type LocalDate } from './dates';
import { ROTATION_CYCLE } from './seed';
import type { Id, KitchenState, MealPlanVersion, MealSlot, PlanChange, PreparedBatch, Protein, Recipe, Row, SlotKind } from './types';
import type { Tx } from './tx';
import { formatQty } from './units';

const ORDER: Record<SlotKind, number> = { lunch: 0, dinner: 1, snack: 2 };
export const SLOT_LABEL: Record<SlotKind, string> = { lunch: '午餐', dinner: '晚餐', snack: '加餐' };

export const slotId = (date: LocalDate, slot: SlotKind) => `${date}:${slot}`;
export const slotSort = (a: Pick<MealSlot, 'date' | 'slot'>, b: Pick<MealSlot, 'date' | 'slot'>) =>
  a.date.localeCompare(b.date) || ORDER[a.slot] - ORDER[b.slot];

/** 现在该考虑哪一顿。15 点前算午餐，21:30 前算晚餐，再晚算明天午餐。 */
export function currentMeal(now: Date): { date: LocalDate; slot: SlotKind } {
  const date = localDate(now);
  const h = localHour(now);
  if (h < 15) return { date, slot: 'lunch' };
  if (h < 21.5) return { date, slot: 'dinner' };
  return { date: addDays(date, 1), slot: 'lunch' };
}

export function pref<T>(state: KitchenState, id: string, fallback: T): T {
  const p = state.preferences.find((x) => x.id === id);
  return p === undefined || p.value === undefined ? fallback : (p.value as T);
}

export function setPref(tx: Tx, id: string, value: unknown) {
  const existing = tx.get<{ id: string; value: unknown; rev: number }>('preferences', id);
  tx.put('preferences', { id, value, rev: existing?.rev ?? 0 });
}

export function recipeOf(state: KitchenState, id: Id | null): Recipe | undefined {
  return id ? state.recipes.find((r) => r.id === id) : undefined;
}

export function defaultVariantId(state: KitchenState, recipeId: Id): Id | null {
  const vs = state.recipe_variants.filter((v) => v.recipeId === recipeId);
  return (vs.find((v) => v.isDefault) ?? vs[0])?.id ?? null;
}

export function planHorizonEnd(state: KitchenState, today: LocalDate): LocalDate {
  const next = pref<LocalDate | null>(state, 'nextShopDate', null);
  const base = addDays(today, 13);
  if (!next) return base;
  const fromShop = addDays(next, 13);
  return fromShop > base ? fromShop : base;
}

/** 只给还没有计划的日子补上默认轮换，绝不改动已有的日子。 */
export function ensurePlan(tx: Tx, today: LocalDate, through: LocalDate) {
  let cursor = pref<number>(tx.state, 'rotationCursor', 0);
  const start = cursor;
  for (let d = today; d <= through; d = addDays(d, 1)) {
    if (tx.get<MealSlot>('meal_slots', slotId(d, 'lunch')) || tx.get<MealSlot>('meal_slots', slotId(d, 'dinner'))) continue;
    const recipeId = ROTATION_CYCLE[cursor % ROTATION_CYCLE.length];
    cursor += 1;
    const base = { date: d, status: 'planned' as const, recipeId, variantId: defaultVariantId(tx.state, recipeId), portions: 1, batchId: null, locked: false, source: 'auto' as const, rev: 0 };
    tx.put<MealSlot>('meal_slots', { ...base, id: slotId(d, 'lunch'), slot: 'lunch', role: 'cook', cookServings: 2 });
    tx.put<MealSlot>('meal_slots', { ...base, id: slotId(d, 'dinner'), slot: 'dinner', role: 'reuse', cookServings: 0 });
  }
  if (cursor !== start) setPref(tx, 'rotationCursor', cursor);
}

export const slotLabel = (s: Pick<MealSlot, 'date' | 'slot'>, today: LocalDate) => `${friendlyDate(s.date, today)}${SLOT_LABEL[s.slot]}`;

export function mainQtyText(state: KitchenState, recipeId: Id, servings: number): string {
  const recipe = recipeOf(state, recipeId);
  if (!recipe) return '';
  const main = state.recipe_ingredients.find((ri) => ri.recipeId === recipeId && ri.role === 'required' && ri.qty !== null &&
    state.ingredients.find((i) => i.id === ri.ingredientId)?.category === 'protein');
  if (!main || main.qty === null) return '';
  const ing = state.ingredients.find((i) => i.id === main.ingredientId)!;
  return `约${formatQty(Math.round(main.qty * servings / recipe.baseServings), ing.unit === 'count' ? ing.countUnit ?? '' : ing.unit)}`;
}

/** 修改一条餐次并记入本次 diff。 */
export function changeSlot(tx: Tx, slot: MealSlot, patch: Partial<MealSlot>, phrase: string): MealSlot {
  const after = tx.put<MealSlot>('meal_slots', { ...slot, ...patch });
  if (phrase) tx.planLog.push({ slotId: slot.id, phrase, before: slot as unknown as Row, after: after as unknown as Row });
  return after;
}

const isOpen = (s: MealSlot, from: { date: LocalDate; slot: SlotKind }) =>
  s.status === 'planned' && !s.locked && s.slot !== 'snack' &&
  (s.date > from.date || (s.date === from.date && ORDER[s.slot] >= ORDER[from.slot]));

interface Desired { role: MealSlot['role']; recipeId: Id | null; variantId: Id | null; cookServings: number; batchId: Id | null }

/**
 * 局部重排：根据当前事实重新算「未来、未锁定、未执行」餐次的角色。
 * 这是唯一修改计划安排的地方，所有事实变动之后都走这里，所以结果与操作顺序无关。
 *
 * - 已存在的熟菜先按到期顺序分配到安全窗口内的餐次；
 * - 被熟菜覆盖的餐次保留原计划的菜，熟菜没了就恢复；
 * - 没被覆盖的餐次里，同一道菜的第一餐开火，份数等于未覆盖餐次的份数和；
 * - 只写入确实发生变化的行，保证 diff 最小。
 */
export function reflow(tx: Tx, reason: string) {
  const state = tx.state;
  const today = localDate(tx.ctx.now);
  const from = currentMeal(tx.ctx.now);
  const open = state.meal_slots.filter((s) => isOpen(s, from)).sort(slotSort);

  const reserved = new Map<Id, number>();
  for (const s of state.meal_slots) {
    if (s.batchId && (s.locked || s.status === 'preparing') && s.status !== 'eaten') {
      reserved.set(s.batchId, (reserved.get(s.batchId) ?? 0) + s.portions);
    }
  }

  const assign = new Map<Id, Id>();
  const batches = state.prepared_batches
    .filter((b) => b.status === 'active' && b.location === 'fridge' && b.portionsRemaining > 0)
    .sort((a, b) => a.useBy.localeCompare(b.useBy) || a.id.localeCompare(b.id));
  for (const b of batches) {
    let left = b.portionsRemaining - (reserved.get(b.id) ?? 0);
    for (const s of open) {
      if (left <= 0) break;
      if (s.date > b.useBy) break;
      // 用户刚指定了别的菜时不被熟菜顶掉；指定的就是这道菜时，熟菜正好满足需求。
      if (assign.has(s.id) || (s.source === 'user' && s.recipeId && s.recipeId !== b.recipeId)) continue;
      if (left < s.portions) continue;
      assign.set(s.id, b.id);
      left -= s.portions;
    }
    if (left > 0) {
      tx.warnings.push(`「${b.name}」还有 ${left} 份在 ${friendlyDate(b.useBy, today)} 前排不进餐次，建议吃掉或冷冻。`);
    }
  }

  const cookedOn = new Map<LocalDate, Set<Id>>();
  for (const c of state.cook_sessions) {
    if (c.status !== 'finished' || !c.finishedAt) continue;
    const d = localDate(new Date(c.finishedAt));
    if (!cookedOn.has(d)) cookedOn.set(d, new Set());
    cookedOn.get(d)!.add(c.recipeId);
  }

  const dates = [...new Set(open.map((s) => s.date))];
  const desired = new Map<Id, Desired>();
  for (const date of dates) {
    const day = open.filter((s) => s.date === date);
    const cooked = cookedOn.get(date) ?? new Set<Id>();
    const cookers = new Map<Id, MealSlot>();
    // 正在做的一锅已经覆盖同一道菜的其余餐次。
    for (const p of state.meal_slots) {
      if (p.date === date && p.status === 'preparing' && p.recipeId) cookers.set(p.recipeId, p);
    }
    const servings = new Map<Id, number>();
    for (const s of day) {
      const batchId = assign.get(s.id);
      if (batchId) {
        desired.set(s.id, { role: 'leftover', recipeId: s.recipeId, variantId: s.variantId, cookServings: 0, batchId });
        continue;
      }
      // 这一餐原本靠已做好的一锅，现在吃完了：需要重新安排，不能假装还有。
      // role=cook 的不算：那是用户明确要再做一次。
      if (s.role !== 'cook' && s.recipeId && cooked.has(s.recipeId)) {
        desired.set(s.id, { role: 'cook', recipeId: null, variantId: null, cookServings: s.portions, batchId: null });
        continue;
      }
      if (!s.recipeId) {
        desired.set(s.id, { role: 'cook', recipeId: null, variantId: null, cookServings: s.portions, batchId: null });
        continue;
      }
      const cooker = cookers.get(s.recipeId);
      if (!cooker) {
        cookers.set(s.recipeId, s);
        servings.set(s.id, s.portions);
        desired.set(s.id, { role: 'cook', recipeId: s.recipeId, variantId: s.variantId, cookServings: s.portions, batchId: null });
      } else {
        if (desired.has(cooker.id)) {
          servings.set(cooker.id, (servings.get(cooker.id) ?? 0) + s.portions);
          desired.get(cooker.id)!.cookServings = servings.get(cooker.id)!;
        }
        desired.set(s.id, { role: 'reuse', recipeId: s.recipeId, variantId: s.variantId, cookServings: 0, batchId: null });
      }
    }
  }

  for (const s of open) {
    const d = desired.get(s.id);
    if (!d) continue;
    const same = s.role === d.role && s.recipeId === d.recipeId && s.variantId === d.variantId && s.cookServings === d.cookServings && s.batchId === d.batchId;
    if (same) continue;
    changeSlot(tx, s, d, phraseFor(tx.state, s, d, today));
  }
  commitPlanVersion(tx, reason);
}

function phraseFor(state: KitchenState, before: MealSlot, d: Desired, today: LocalDate): string {
  const label = slotLabel(before, today);
  if (d.role === 'leftover') {
    const b = state.prepared_batches.find((x) => x.id === d.batchId);
    return `${label}改吃剩菜「${b?.name ?? ''}」`;
  }
  if (d.role === 'cook' && !d.recipeId) return `${label}需要重新安排`;
  if (d.role === 'cook' && d.recipeId) {
    const r = recipeOf(state, d.recipeId);
    return `${label}做 ${d.cookServings} 份「${r?.name ?? ''}」${mainQtyText(state, d.recipeId, d.cookServings)}`;
  }
  return '';
}

/** 把本次累计的餐次改动写成一个计划版本。 */
export function commitPlanVersion(tx: Tx, reason: string) {
  if (tx.planLog.length === 0) return;
  const version = tx.append<MealPlanVersion>('meal_plan_versions', { id: tx.newId('pv'), txId: tx.txId, at: tx.at, reason });
  for (const c of tx.planLog) {
    tx.append<PlanChange>('plan_changes', {
      id: tx.newId('pc'), versionId: version.id, slotId: c.slotId, summary: c.phrase,
      before: c.before as unknown as Partial<MealSlot>, after: c.after as unknown as Partial<MealSlot>,
    });
    if (c.phrase) tx.details.push(c.phrase);
  }
  tx.planLog.length = 0;
}

/** 让新买的短保食材尽早用上：把用它的菜和最近同蛋白的日子互换，不碰锁定和用户指定的餐次。 */
export function pullForward(tx: Tx, ingredientId: Id, withinDays: number) {
  const state = tx.state;
  const today = localDate(tx.ctx.now);
  const limit = addDays(today, withinDays);
  const uses = (recipeId: Id | null) => !!recipeId && state.recipe_ingredients.some((ri) => ri.recipeId === recipeId && ri.ingredientId === ingredientId && ri.role === 'required');
  const movable = (s: MealSlot) => s.status === 'planned' && !s.locked && s.source === 'auto' && s.slot !== 'snack' && s.date >= today;
  const future = state.meal_slots.filter(movable).sort(slotSort);
  if (future.some((s) => s.date <= limit && s.role !== 'leftover' && uses(s.recipeId))) return;
  const target = future.find((s) => s.date > limit && uses(s.recipeId));
  if (!target) return;
  const protein = recipeOf(state, target.recipeId)?.protein;
  const donor = future.find((s) => s.date <= limit && s.date >= today && s.role !== 'leftover' && !!s.recipeId && recipeOf(state, s.recipeId)?.protein === protein);
  if (!donor) return;
  swapDays(tx, donor.date, target.date, `先用新鲜食材：把「${recipeOf(state, target.recipeId)?.name}」提前到${friendlyDate(donor.date, today)}`);
}

export function swapDays(tx: Tx, a: LocalDate, b: LocalDate, phrase: string) {
  const dayA = tx.state.meal_slots.filter((s) => s.date === a && s.slot !== 'snack' && s.status === 'planned');
  const dayB = tx.state.meal_slots.filter((s) => s.date === b && s.slot !== 'snack' && s.status === 'planned');
  const ra = dayA.find((s) => s.recipeId);
  const rb = dayB.find((s) => s.recipeId);
  if (!ra || !rb) return;
  let first = true;
  for (const s of dayA) {
    changeSlot(tx, s, { recipeId: rb.recipeId, variantId: rb.variantId }, first ? phrase : '');
    first = false;
  }
  for (const s of dayB) changeSlot(tx, s, { recipeId: ra.recipeId, variantId: ra.variantId }, '');
}

export interface RotationHint {
  text: string;
  date: LocalDate;
  recipeId: Id;
}

/** 轮换只是软目标：缺了某种蛋白时给一句提示和一个可选改法，绝不自动改。 */
export function rotationHint(state: KitchenState, now: Date): RotationHint | null {
  const today = localDate(now);
  const end = addDays(today, 6);
  const days = new Map<LocalDate, Protein>();
  for (const s of state.meal_slots) {
    if (s.date < today || s.date > end || s.slot === 'snack' || s.status !== 'planned' || !s.recipeId) continue;
    const p = recipeOf(state, s.recipeId)?.protein;
    if (p && !days.has(s.date)) days.set(s.date, p);
  }
  const count = (p: Protein) => [...days.values()].filter((x) => x === p).length;
  for (const pref of state.protein_weekly_preferences) {
    if (pref.id === 'chicken' || pref.daysPerWeek === 0 || count(pref.id) > 0) continue;
    const swapDate = [...days.entries()].filter(([, p]) => p === 'chicken').map(([d]) => d).sort().at(-1);
    if (!swapDate || count('chicken') < 2) continue;
    const core = state.recipes.find((r) => r.tier === 'core' && r.protein === pref.id);
    if (!core) continue;
    return { text: `这 7 天没有排到${pref.label}，要改到${friendlyDate(swapDate, today)}吗？`, date: swapDate, recipeId: core.id };
  }
  return null;
}

export interface ProteinPeak {
  days: number;
  start: LocalDate;
  end: LocalDate;
}

/** 隔 6 天就算下一周。按整 7 天数的话，相邻两天对调会和下一轮的同一种肉撞上，天天误报。 */
const WEEK_SPAN_DAYS = 6;

/** 每种肉在一周的跨度内最多有几天。吃过的和计划里的一起算，外食和不吃的不算。 */
export function proteinPeaks(state: KitchenState, today: LocalDate): Map<Protein, ProteinPeak> {
  const days = new Map<Protein, Set<LocalDate>>();
  for (const s of state.meal_slots) {
    if (s.date < addDays(today, -6) || s.slot === 'snack' || !s.recipeId || s.status === 'skipped' || s.status === 'eating_out') continue;
    const p = recipeOf(state, s.recipeId)?.protein;
    if (!p) continue;
    if (!days.has(p)) days.set(p, new Set());
    days.get(p)!.add(s.date);
  }
  const peaks = new Map<Protein, ProteinPeak>();
  for (const [protein, dates] of days) {
    for (const start of dates) {
      const inWeek = [...dates].filter((d) => d >= start && d < addDays(start, WEEK_SPAN_DAYS)).sort();
      const best = peaks.get(protein);
      if (!best || inWeek.length > best.days || (inWeek.length === best.days && start < best.start)) peaks.set(protein, { days: inWeek.length, start, end: inWeek.at(-1)! });
    }
  }
  return peaks;
}

/** 只提醒这次操作新造成的超额，原本就超的不重复说。只提醒，不拦也不改计划。 */
export function warnProteinPeaks(tx: Tx, before: Map<Protein, ProteinPeak>, today: LocalDate) {
  const after = proteinPeaks(tx.state, today);
  for (const pref of tx.state.protein_weekly_preferences) {
    const peak = after.get(pref.id);
    if (!peak || pref.daysPerWeek === 0 || peak.days <= pref.daysPerWeek || peak.days <= (before.get(pref.id)?.days ?? 0)) continue;
    tx.warnings.push(`${pref.label}在 ${shortDate(peak.start)}–${shortDate(peak.end)} 有 ${peak.days} 天，超过每周 ${pref.daysPerWeek} 天`);
  }
}

export function batchesForSlot(state: KitchenState, slot: MealSlot): PreparedBatch | undefined {
  return slot.batchId ? state.prepared_batches.find((b) => b.id === slot.batchId) : undefined;
}
