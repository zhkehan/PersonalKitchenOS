import { addDays, diffDays, friendlyDate, localDate, shortDate, type LocalDate } from './dates';
import { activeLots, fefoSort, stockOf } from './inventory';
import { currentMeal, recipeOf, slotId, slotSort, SLOT_LABEL } from './planner';
import type { Id, KitchenState, MealSlot, PreparedBatch, Protein, Recipe, RecipeVariant, ScheduleConstraint, SlotKind } from './types';
import { formatQty, roundQty } from './units';

export type LineStatus = 'ok' | 'unknown' | 'short' | 'missing' | 'frozen';

export interface IngredientLine {
  ingredientId: Id;
  name: string;
  need: number | null;
  unit: string;
  role: 'required' | 'optional';
  status: LineStatus;
  label: string;
  /** 用替代食材满足时的说明。 */
  substitute?: string;
  quickThawMinutes: number | null;
}

export interface RecipeCheck {
  lines: IngredientLine[];
  /** 硬约束不满足的原因（例如确认没有）。 */
  blocked: string | null;
  unverified: string[];
  frozen: IngredientLine[];
}

const unitOf = (i: { unit: string; countUnit?: string }) => (i.unit === 'count' ? i.countUnit ?? '' : i.unit === 'level' ? '' : i.unit);

/** 只把未过建议日期的批次算作可用量。过期批次不参与推荐，也不替用户判断能不能吃。 */
function usableQty(state: KitchenState, ingredientId: Id, today: LocalDate) {
  let ready = 0, frozen = 0, unknownReady = false, unknownFrozen = false;
  for (const l of activeLots(state, ingredientId)) {
    if (l.useBy && l.useBy < today) continue;
    if (l.qty === null) {
      if (l.location === 'freezer') unknownFrozen = true; else unknownReady = true;
    } else if (l.location === 'freezer') frozen += l.qty;
    else ready += l.qty;
  }
  return { ready, frozen, unknownReady, unknownFrozen };
}

/** 单种食材的状态。这是整个推荐的事实基础，全部来自真实批次。 */
const ENOUGH_TOLERANCE = 0.02;

function lineStatus(state: KitchenState, ingredientId: Id, need: number | null, today: LocalDate): LineStatus {
  const stock = stockOf(state, ingredientId);
  if (stock.ingredient.unit === 'level') {
    if (stock.ingredient.level === 'out') return 'missing';
    return stock.ingredient.level === 'unconfirmed' ? 'unknown' : 'ok';
  }
  if (stock.reality === 'mentioned') return 'unknown';
  const u = usableQty(state, ingredientId, today);
  if (stock.reality === 'out' && !u.unknownReady && !u.unknownFrozen) return 'missing';
  // 1 lb 记账是 453.6g，菜谱写 454g。取整和称重的小差额不该让最后一袋变成「不够」；差额做完仍会记录。
  const required = (need ?? 0) * (1 - ENOUGH_TOLERANCE);
  if (u.ready >= required && u.ready > 0) return 'ok';
  if (u.unknownReady) return 'unknown';
  if (stock.ingredient.needsThaw && u.ready + u.frozen >= required && u.frozen > 0) return 'frozen';
  if (u.unknownFrozen) return stock.ingredient.needsThaw ? 'frozen' : 'unknown';
  if (!stock.ingredient.needsThaw && u.ready + u.frozen >= required && u.frozen > 0) return 'ok';
  return u.ready + u.frozen > 0 ? 'short' : 'missing';
}

export function checkRecipe(state: KitchenState, recipeId: Id, servings: number, today: LocalDate): RecipeCheck {
  const recipe = recipeOf(state, recipeId);
  if (!recipe) return { lines: [], blocked: '没有这道菜', unverified: [], frozen: [] };
  const factor = servings / recipe.baseServings;
  const lines: IngredientLine[] = [];
  let blocked: string | null = null;
  for (const ri of state.recipe_ingredients.filter((x) => x.recipeId === recipeId)) {
    const ing = state.ingredients.find((i) => i.id === ri.ingredientId);
    if (!ing) continue;
    const need = ri.qty === null ? null : roundQty(ri.qty * factor);
    let status = lineStatus(state, ing.id, need, today);
    let substitute: string | undefined;
    if (status === 'missing' || status === 'short') {
      const sub = state.ingredient_substitutions.find((s) => s.ingredientId === ing.id && ['ok', 'unknown'].includes(lineStatus(state, s.substituteId, need, today)));
      if (sub) { substitute = sub.note; status = 'ok'; }
    }
    const unit = unitOf(ing);
    const label = need === null ? ri.label ?? '' : formatQty(need, unit);
    lines.push({ ingredientId: ing.id, name: ing.name, need, unit, role: ri.role, status, label, substitute, quickThawMinutes: ing.quickThawMinutes });
    if (ri.role === 'required' && !blocked) {
      if (status === 'missing') blocked = `没有${ing.name}`;
      else if (status === 'short') blocked = `${ing.name}不够`;
    }
  }
  const required = lines.filter((l) => l.role === 'required');
  return { lines, blocked, unverified: required.filter((l) => l.status === 'unknown').map((l) => l.name), frozen: required.filter((l) => l.status === 'frozen') };
}

export function constraintFor(state: KitchenState, date: LocalDate): ScheduleConstraint | undefined {
  return state.schedule_constraints.find((c) => c.id === date);
}

function pickVariant(state: KitchenState, recipeId: Id, airfryerOnly: boolean, preferred: Id | null): RecipeVariant | null {
  const vs = state.recipe_variants.filter((v) => v.recipeId === recipeId);
  if (airfryerOnly) return vs.find((v) => v.airfryerOnlyOk) ?? null;
  return vs.find((v) => v.id === preferred) ?? vs.find((v) => v.isDefault) ?? vs[0] ?? null;
}

export interface MealContext {
  date: LocalDate;
  slot: SlotKind;
  label: string;
  slotRow: MealSlot | null;
  /** 这餐开火时默认做几份。 */
  servings: number;
}

/** 找到下一顿真正需要吃的餐：跳过已吃、外食、不吃的餐次。 */
export function nextMeal(state: KitchenState, now: Date): MealContext {
  const today = localDate(now);
  const from = currentMeal(now);
  const slots = state.meal_slots
    .filter((s) => s.slot !== 'snack' && (s.date > from.date || (s.date === from.date && (from.slot === 'lunch' || s.slot === 'dinner'))))
    .sort(slotSort);
  const open = slots.find((s) => s.status === 'planned' || s.status === 'preparing');
  if (!open) {
    return { date: from.date, slot: from.slot, label: `${friendlyDate(from.date, today)}${SLOT_LABEL[from.slot]}`, slotRow: null, servings: 2 };
  }
  // 开火份数只算这一餐起还没被覆盖的餐次：错过午餐后不再默认做两份。
  const covered = slots.filter((s) => s.date === open.date && s.status === 'planned' && (s.role === 'cook' || s.role === 'reuse') && s.recipeId === open.recipeId);
  const servings = open.role === 'cook' || open.role === 'reuse'
    ? Math.max(1, covered.reduce((n, s) => n + s.portions, 0)) : open.portions;
  return { date: open.date, slot: open.slot, label: `${friendlyDate(open.date, today)}${SLOT_LABEL[open.slot]}`, slotRow: open, servings };
}

export interface LeftoverPick {
  kind: 'leftover';
  batch: PreparedBatch;
  title: string;
  reasons: string[];
}

export interface RecipePick {
  kind: 'recipe';
  recipe: Recipe;
  variant: RecipeVariant;
  servings: number;
  title: string;
  reasons: string[];
  minutes: number;
  /** ready = 所需主料都有确认数量。 */
  confidence: 'ready' | 'unverified';
  check: RecipeCheck;
  score: number;
}

export type Pick = LeftoverPick | RecipePick;

export interface RecommendOptions {
  /** 「换一道」时已看过的菜。 */
  skip?: Id[];
}

export interface Recommendation {
  meal: MealContext;
  primary: Pick | null;
  alternates: Pick[];
  excluded: { name: string; why: string }[];
  note: string | null;
}

const PROTEIN_LABEL: Partial<Record<Protein, string>> = { chicken: '鸡胸肉', beef: '牛肉碎', pork: '猪里脊', fish: '鱼片', shrimp: '虾' };

function eatenRecently(state: KitchenState, recipeId: Id, today: LocalDate, days: number): boolean {
  return state.consumption_events.some((c) => c.recipeId === recipeId && c.kind === 'prepared' && diffDays(today, c.date) >= 0 && diffDays(today, c.date) < days);
}

function proteinDaysLast7(state: KitchenState, today: LocalDate): Map<Protein, number> {
  const days = new Map<Protein, Set<LocalDate>>();
  for (const c of state.consumption_events) {
    if (c.kind !== 'prepared' || !c.recipeId) continue;
    const delta = diffDays(today, c.date);
    if (delta < 0 || delta >= 7) continue;
    const r = recipeOf(state, c.recipeId);
    if (!r || r.tier === 'snack') continue; // 加餐不算蛋白质日
    if (!days.has(r.protein)) days.set(r.protein, new Set());
    days.get(r.protein)!.add(c.date);
  }
  return new Map([...days].map(([p, s]) => [p, s.size]));
}

function scoreRecipe(state: KitchenState, recipe: Recipe, ctx: { today: LocalDate; meal: MealContext; c?: ScheduleConstraint; check: RecipeCheck; proteinDays: Map<Protein, number>; minutes: number }) {
  const { today, meal, c, check, proteinDays } = ctx;
  let score = 0;
  const reasons: string[] = [];
  const planned = meal.slotRow?.recipeId === recipe.id;
  const plannedProtein = meal.slotRow?.recipeId ? recipeOf(state, meal.slotRow.recipeId)?.protein : undefined;
  if (planned && meal.slotRow?.source === 'user') {
    score += 200;
    reasons.push('你刚才指定的');
  } else if (planned) {
    score += 30;
    const label = PROTEIN_LABEL[recipe.protein];
    reasons.push(label ? `今天轮到${label}` : '在计划里');
  } else if (plannedProtein && plannedProtein !== 'none' && recipe.protein === plannedProtein) {
    // 肉类按轮换，蔬菜和做法可以换：同一种肉的其他菜排在别的肉前面。
    score += 25;
    reasons.push('肉类不变，换个做法');
  }

  // 短保 / 已解冻 / 临期 —— 只依据真实批次上的日期。
  for (const line of check.lines) {
    const lots = fefoSort(activeLots(state, line.ingredientId)).filter((l) => l.location !== 'freezer' && (l.useBy === null || l.useBy >= today) && (l.qty === null || l.qty > 0));
    const lot = lots[0];
    if (!lot || line.need === null) continue;
    if (lot.thawedAt && lot.useBy) {
      score += 35;
      reasons.push(`${line.name}已解冻，${shortDate(lot.useBy)}前用`);
    } else if (lot.useBy && diffDays(lot.useBy, today) <= 3) {
      score += 30;
      reasons.push(`${line.name}建议 ${shortDate(lot.useBy)} 前用`);
    } else if (lot.useBy && line.role === 'required' && state.ingredients.find((i) => i.id === line.ingredientId)?.category === 'fresh') {
      score += 12;
      reasons.push(`有${line.name}可先用`);
    }
  }

  if (check.unverified.length === 0 && check.frozen.length === 0) score += 15;
  else score -= Math.min(15, check.unverified.length * 3);
  // 主料没核实数量时，排在确认能做的菜后面：「可能能做」不该压过「确定能做」。
  if (check.lines.some((l) => l.role === 'required' && l.status === 'unknown' &&
    state.ingredients.find((i) => i.id === l.ingredientId)?.category === 'protein')) score -= 15;

  const target = state.protein_weekly_preferences.find((p) => p.id === recipe.protein)?.daysPerWeek ?? 0;
  const done = proteinDays.get(recipe.protein) ?? 0;
  if (target > done) score += Math.min(10, (target - done) * 4);
  else if (target > 0) score -= 6;

  if (eatenRecently(state, recipe.id, today, 3) && !planned) score -= 15;

  if (c?.dayStatus === 'busy') score += ctx.minutes <= 20 ? 15 : -10;

  if (recipe.feedback === 'good') { score += 10; reasons.push('你标记过好吃'); }
  if (recipe.feedback === 'meh') score -= 6;
  if (recipe.feedback === 'avoid') score -= 40;

  score += recipe.tier === 'core' ? 10 : recipe.tier === 'variant' ? 0 : -5;
  if (c?.spicy) {
    if (recipe.spicy) { score += 25; reasons.push('符合想吃辣'); } else score -= 15;
  }
  return { score, reasons };
}

export function recommendToday(state: KitchenState, now: Date, opts: RecommendOptions = {}): Recommendation {
  const today = localDate(now);
  const meal = nextMeal(state, now);
  const c = constraintFor(state, meal.date) ?? (meal.date !== today ? constraintFor(state, today) : undefined);
  const skip = new Set(opts.skip ?? []);
  const excluded: { name: string; why: string }[] = [];
  const proteinDays = proteinDaysLast7(state, today);

  const leftovers: LeftoverPick[] = state.prepared_batches
    .filter((b) => b.status === 'active' && b.location === 'fridge' && b.portionsRemaining > 0 && b.useBy >= today && !skip.has(b.id))
    .sort((a, b) => a.useBy.localeCompare(b.useBy))
    .map((batch) => ({
      kind: 'leftover', batch, title: batch.name,
      reasons: [`已做好，还剩 ${batch.portionsRemaining} 份`, `建议 ${shortDate(batch.useBy)} 前吃完`],
    }));

  const picks: RecipePick[] = [];
  const preferredVariant = meal.slotRow?.variantId ?? null;
  for (const recipe of state.recipes) {
    if (!recipe.enabled || recipe.tier === 'snack' || skip.has(recipe.id)) continue;
    // 菜谱库只在用户点名、排进这一餐时出现，不当作推荐候选。
    if (recipe.tier === 'library' && meal.slotRow?.recipeId !== recipe.id) continue;
    if (c?.excludeRecipeIds.includes(recipe.id)) { excluded.push({ name: recipe.name, why: '你今天不想吃' }); continue; }
    const variant = pickVariant(state, recipe.id, !!c?.airfryerOnly, preferredVariant);
    if (!variant) { excluded.push({ name: recipe.name, why: '不适合只用空气炸锅' }); continue; }
    const check = checkRecipe(state, recipe.id, meal.servings, today);
    if (check.blocked) { excluded.push({ name: recipe.name, why: check.blocked }); continue; }
    const thawExtra = check.frozen.reduce((max, l) => Math.max(max, l.quickThawMinutes ?? 0), 0);
    const needsSlowThaw = check.frozen.some((l) => l.quickThawMinutes === null);
    const minutes = variant.minutes + thawExtra;
    if (needsSlowThaw && c?.minutes) { excluded.push({ name: recipe.name, why: `${check.frozen.map((f) => f.name).join('、')}还冻着，需提前冰箱解冻` }); continue; }
    if (c?.minutes && minutes > c.minutes) { excluded.push({ name: recipe.name, why: `要 ${minutes} 分钟，超过今天的时间` }); continue; }
    const { score, reasons } = scoreRecipe(state, recipe, { today, meal, c, check, proteinDays, minutes });
    const finalReasons = [...reasons];
    let finalScore = score;
    if (needsSlowThaw) { finalScore -= 35; finalReasons.push(`${check.frozen.map((f) => f.name).join('、')}要先安全解冻`); }
    picks.push({
      kind: 'recipe', recipe, variant, servings: meal.servings, title: recipe.name, reasons: finalReasons.slice(0, 2), minutes,
      confidence: check.unverified.length === 0 && check.frozen.length === 0 ? 'ready' : 'unverified', check, score: finalScore,
    });
  }
  picks.sort((a, b) => b.score - a.score || a.recipe.id.localeCompare(b.recipe.id));

  // 已有这道菜的熟菜时，备选里不再建议重新做一锅。
  const leftoverRecipes = new Set(leftovers.map((l) => l.batch.recipeId));
  const ordered: Pick[] = [...leftovers, ...picks.filter((p) => !leftoverRecipes.has(p.recipe.id))];
  const primary = ordered[0] ?? null;
  const alternates = ordered.slice(1, 3);
  let note: string | null = null;
  if (!primary) note = '当前条件下没有合适的菜。可以放宽时间或设备，或先看看采购。';
  if (c?.minutes && excluded.some((e) => e.why.includes('解冻'))) {
    const frozen = excluded.find((e) => e.why.includes('解冻'));
    note = `${frozen?.why.split('还冻着')[0]}还冻着，今天来不及：放冰箱解冻，改到后面的日子吃。不要长时间常温解冻。`;
  }
  return { meal, primary, alternates, excluded, note };
}

export interface SnackOption {
  kind: 'leftover' | 'recipe';
  title: string;
  batchId?: Id;
  recipeId?: Id;
  note: string;
}

/** 加餐：只给建议，最多两项。用户选定并确认吃完才记账。 */
export function recommendSnack(state: KitchenState, now: Date): SnackOption[] {
  const today = localDate(now);
  const out: SnackOption[] = [];
  for (const b of state.prepared_batches.filter((x) => x.status === 'active' && x.location === 'fridge' && x.portionsRemaining > 0 && x.useBy >= today).sort((a, b) => a.useBy.localeCompare(b.useBy))) {
    out.push({ kind: 'leftover', title: `吃一份「${b.name}」`, batchId: b.id, note: `还剩 ${b.portionsRemaining} 份，生料不变` });
  }
  for (const id of ['S01', 'S02']) {
    const r = recipeOf(state, id);
    if (!r || !r.enabled) continue;
    const check = checkRecipe(state, id, r.baseServings, today);
    if (check.blocked) continue;
    if (check.frozen.some((l) => l.quickThawMinutes === null)) continue;
    out.push({ kind: 'recipe', title: r.name, recipeId: r.id, note: check.unverified.length ? '数量待确认' : '做完确认后才扣原料' });
  }
  return out.slice(0, 2);
}

export interface Reminder {
  text: string;
  action?: { label: string; command: 'moveInventory' | 'moveBatch'; input: unknown };
}

/** 只有真的有事才提醒，最多一条；没有事就返回 null，首页隐藏这一行。 */
export function reminderFor(state: KitchenState, now: Date): Reminder | null {
  const today = localDate(now);
  const expiring = state.prepared_batches
    .filter((b) => b.status === 'active' && b.location === 'fridge' && b.portionsRemaining > 0 && b.useBy <= addDays(today, 1))
    .sort((a, b) => a.useBy.localeCompare(b.useBy))[0];
  if (expiring) {
    if (expiring.useBy < today) return { text: `「${expiring.name}」过了建议食用日期，别只靠闻味判断，拿不准就丢掉。` };
    return { text: `「${expiring.name}」建议${friendlyDate(expiring.useBy, today)}前吃完，吃不完就冷冻。`, action: { label: '现在冷冻', command: 'moveBatch', input: { batchId: expiring.id, to: 'freezer' } } };
  }
  const overdue = state.inventory_lots.find((l) => l.status === 'active' && l.useBy && l.useBy < today);
  if (overdue) {
    const name = state.ingredients.find((i) => i.id === overdue.ingredientId)?.name;
    return { text: `${name}过了建议日期（${overdue.useBySource === 'package' ? '包装标注' : '保守估计'}），不代表一定变质，请自己判断。` };
  }
  const tomorrow = addDays(today, 1);
  for (const s of state.meal_slots.filter((x) => (x.date === today || x.date === tomorrow) && x.role === 'cook' && x.status === 'planned' && x.recipeId).sort(slotSort)) {
    const check = checkRecipe(state, s.recipeId!, s.cookServings || 1, today);
    const slow = check.frozen.find((f) => f.quickThawMinutes === null);
    if (!slow) continue;
    const lot = fefoSort(activeLots(state, slow.ingredientId)).find((l) => l.location === 'freezer');
    return {
      text: `${friendlyDate(s.date, today)}的${slow.name}要提前放冰箱解冻。`,
      action: lot ? { label: '已放冰箱', command: 'moveInventory', input: { lotId: lot.id, to: 'fridge', ...(lot.qty !== null && slow.need !== null && slow.need < lot.qty ? { qty: slow.need } : {}) } } : undefined,
    };
  }
  const soon = state.inventory_lots
    .filter((l) => l.status === 'active' && l.useBy && l.useBy <= addDays(today, 2) && l.location !== 'freezer')
    .sort((a, b) => (a.useBy ?? '').localeCompare(b.useBy ?? ''))[0];
  if (soon) {
    const ing = state.ingredients.find((i) => i.id === soon.ingredientId);
    return {
      text: `${ing?.name}建议 ${shortDate(soon.useBy!)} 前用。`,
      action: ing?.freezable ? { label: '先冷冻', command: 'moveInventory', input: { lotId: soon.id, to: 'freezer' } } : undefined,
    };
  }
  const next = state.preferences.find((p) => p.id === 'nextShopDate')?.value as LocalDate | null | undefined;
  if (next && next <= tomorrow) return { text: `${friendlyDate(next, today)}该去采购了。` };
  return null;
}

export { slotId };
