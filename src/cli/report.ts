import { addDays, friendlyDate, localDate, shortDate, weekdayName, type LocalDate } from '../domain/dates';
import { dayIntake, recipeServing, recentIntake } from '../domain/intake';
import { activeLots, LOCATION_LABEL, stockOf } from '../domain/inventory';
import { findRecipe } from '../domain/match';
import { macroLine, NUTRITION_FACTS, nutritionLine } from '../domain/nutrition';
import { SLOT_LABEL } from '../domain/planner';
import { checkRecipe, recommendToday, reminderFor, type Pick } from '../domain/recommend';
import { forecastShopping } from '../domain/shopping';
import type { AuditEvent, Ingredient, KitchenState, Recipe } from '../domain/types';
import { formatQty } from '../domain/units';

/** 查询都是只读的，输出给 Claude 读，也方便用户直接看。 */

const unitOf = (i: Ingredient) => (i.unit === 'count' ? i.countUnit ?? '' : i.unit);
const STATUS: Record<string, string> = { unknown: '待核对', short: '不够', missing: '没有', frozen: '还冻着' };

export interface Readiness {
  recipe: Recipe;
  /** 实物主料没有确认够用。 */
  missing: string[];
  frozen: string[];
  /** 调料没有确认过，不挡做菜，但要说明。 */
  seasonings: string[];
}

/** 这道菜的实物食材是否都确认够用。「待核对」不算有。 */
export function readiness(state: KitchenState, recipe: Recipe, today: LocalDate): Readiness {
  const out: Readiness = { recipe, missing: [], frozen: [], seasonings: [] };
  for (const l of checkRecipe(state, recipe.id, recipe.baseServings, today).lines) {
    if (l.role !== 'required') continue;
    const level = state.ingredients.find((i) => i.id === l.ingredientId)?.unit === 'level';
    if (l.status === 'frozen') out.frozen.push(l.name);
    else if (l.status === 'ok') continue;
    else if (level) out.seasonings.push(l.name);
    else out.missing.push(`${l.name}（${STATUS[l.status]}）`);
  }
  return out;
}

const cookable = (state: KitchenState) => state.recipes.filter((r) => r.enabled && r.tier !== 'snack');

export function confirmedRecipes(state: KitchenState, today: LocalDate): Readiness[] {
  return cookable(state).map((r) => readiness(state, r, today)).filter((r) => r.missing.length === 0);
}

function pickLines(state: KitchenState, p: Pick, today: LocalDate): string[] {
  if (p.kind === 'leftover') return [`${p.title}（熟菜，${p.reasons.join('，')}）`];
  const r = readiness(state, p.recipe, today);
  const lines = [`${p.title}（约 ${p.minutes} 分钟，做 ${p.servings} 份，${p.variant.name}）${p.reasons.length ? `：${p.reasons.join('，')}` : ''}`];
  if (r.missing.length) lines.push(`  主料未确认：${r.missing.join('、')}`);
  if (r.frozen.length) lines.push(`  还冻着：${r.frozen.join('、')}`);
  if (r.seasonings.length) lines.push(`  调料待核对：${r.seasonings.join('、')}`);
  return lines;
}

function intakeLines(state: KitchenState, date: LocalDate): string[] {
  const d = dayIntake(state, date);
  const lines = d.entries.length ? [`合计 ${macroLine(d.macros)}`] : ['没有吃过的记录'];
  for (const e of d.entries) lines.push(`  ${SLOT_LABEL[e.slot]}：${e.label}${e.portions !== 1 ? ` × ${e.portions}` : ''}  ${e.macros ? macroLine(e.macros) : '算不出来'}`);
  if (d.uncounted.length) lines.push(`  没算进去：${d.uncounted.join('、')}`);
  return lines;
}

export function reportToday(state: KitchenState, now: Date): string {
  const today = localDate(now);
  const rec = recommendToday(state, now);
  const lines = [`今天是 ${today} ${weekdayName(today)}，下一顿：${rec.meal.label}`, ''];
  if (rec.primary) {
    lines.push('程序首选：', ...pickLines(state, rec.primary, today));
    if (rec.alternates.length) lines.push('备选：', ...rec.alternates.flatMap((a) => pickLines(state, a, today)));
  }
  if (rec.note) lines.push(rec.note);
  const ready = confirmedRecipes(state, today).filter((r) => r.recipe.tier !== 'library');
  lines.push('', `主料都确认有的菜（${ready.length} 道）：${ready.map((r) => r.recipe.name).join('、') || '没有'}`);
  const reminder = reminderFor(state, now);
  if (reminder) lines.push('', `提醒：${reminder.text}`);
  lines.push('', '今天吃的：', ...intakeLines(state, today));
  return lines.join('\n');
}

export function reportStock(state: KitchenState, query: string | undefined, now: Date): string {
  const today = localDate(now);
  const match = (i: Ingredient) => !query || [i.id, i.name, ...i.aliases].some((n) => n.toLowerCase().includes(query.toLowerCase()));
  const lines: string[] = [];
  for (const ing of state.ingredients.filter((i) => i.unit !== 'level' && match(i))) {
    const lots = activeLots(state, ing.id);
    if (lots.length === 0) continue;
    const detail = lots.map((l) => `${l.qty === null ? l.rawLabel ?? '数量未知' : formatQty(l.qty, l.unit)} ${LOCATION_LABEL[l.location]}${l.useBy ? ` ${shortDate(l.useBy)}前` : ''}`);
    lines.push(`${ing.name}（${ing.id}）：${formatQty(stockOf(state, ing.id).knownQty, unitOf(ing))}  ${detail.join('；')}`);
  }
  const batches = state.prepared_batches.filter((b) => b.status === 'active');
  if (batches.length) lines.push('熟菜：', ...batches.map((b) => `  ${b.name}（${b.id}）${b.portionsRemaining} 份 ${LOCATION_LABEL[b.location]} ${shortDate(b.useBy)}前`));
  const have = state.ingredients.filter((i) => i.unit === 'level' && match(i) && (i.level === 'have' || i.level === 'low'));
  if (have.length) lines.push(`调料有：${have.map((i) => `${i.name}${i.level === 'low' ? '（快用完）' : ''}`).join('、')}`);
  const out = state.ingredients.filter((i) => match(i) && (i.markedOut || i.level === 'out'));
  if (out.length) lines.push(`确认没有：${out.map((i) => i.name).join('、')}`);
  if (lines.length === 0) lines.push(query ? `没有「${query}」的库存记录` : '还没有库存记录');
  if (!query) lines.push('', `没出现在这里的食材都是没记录，不代表没有。今天 ${today}。`);
  return lines.join('\n');
}

export function reportRecipe(state: KitchenState, name: string, now: Date): string {
  const recipe = findRecipe(state, name);
  if (!recipe) throw new Error(`没找到菜：${name}`);
  const today = localDate(now);
  const check = checkRecipe(state, recipe.id, recipe.baseServings, today);
  const lines = [`${recipe.name}（${recipe.id}，${recipe.baseServings} 份）`, `调味：${recipe.seasoningTemplate}`, `切法：${recipe.cutSize}`, '', '食材：'];
  for (const l of check.lines) lines.push(`  ${l.name}${l.role === 'optional' ? '（可选）' : ''} ${l.label}${l.role === 'required' && l.status !== 'ok' ? ` [${STATUS[l.status]}]` : ''}`);
  const s = recipeServing(state, recipe.id);
  lines.push('', `一份约 ${macroLine(s.macros)}（${s.oilGrams > 0 ? `含 ${s.oilGrams}g 烹调油，` : ''}不含调味料）`);
  for (const e of s.extras) lines.push(`  加${e.name}：再加 ${macroLine(e.macros)}`);
  for (const v of state.recipe_variants.filter((x) => x.recipeId === recipe.id)) {
    lines.push('', `${v.name}（${v.id}，约 ${v.minutes} 分钟，${v.fit}）：`);
    state.recipe_steps.filter((x) => x.variantId === v.id).sort((a, b) => a.order - b.order).forEach((x, i) => lines.push(`  ${i + 1}. ${x.text}`));
  }
  lines.push('', `安全：${recipe.safetyTip}`);
  if (recipe.leftoverTip) lines.push(`剩菜：${recipe.leftoverTip}`);
  if (recipe.notes) lines.push(`备注：${recipe.notes}`);
  return lines.join('\n');
}

export function reportRecipes(state: KitchenState, query: string | undefined, now: Date): string {
  const today = localDate(now);
  const list = cookable(state).filter((r) => !query || r.name.includes(query) || r.flavors.some((f) => f.includes(query)));
  return list.map((r) => {
    const x = readiness(state, r, today);
    return `${r.id} ${r.name}${r.tier === 'library' ? '（菜谱库）' : ''}：${x.missing.length ? `缺 ${x.missing.join('、')}` : '主料都有'}`;
  }).join('\n') || '没有符合的菜';
}

export function reportPlan(state: KitchenState, days: number, now: Date): string {
  const today = localDate(now);
  const lines: string[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    for (const s of state.meal_slots.filter((x) => x.date === date && x.slot !== 'snack').sort((a, b) => a.slot.localeCompare(b.slot) * -1)) {
      const name = state.recipes.find((r) => r.id === s.recipeId)?.name ?? '待定';
      const what = s.status === 'planned' ? (s.role === 'leftover' ? `吃熟菜 ${name}` : s.role === 'cook' ? `${name} 做 ${s.cookServings} 份` : `${name} 吃同一锅`) : ({ eaten: '吃过了', eating_out: '外食', skipped: '不吃', preparing: '正在做' }[s.status] ?? s.status);
      lines.push(`${friendlyDate(date, today)}${SLOT_LABEL[s.slot]}：${what}${s.locked ? '（锁定）' : ''}`);
    }
  }
  return lines.join('\n') || '计划是空的';
}

export function reportShopping(state: KitchenState, now: Date): string {
  const f = forecastShopping(state, now);
  const group = (tag: string, title: string) => {
    const items = f.items.filter((i) => i.tag === tag);
    return items.length ? [`${title}：`, ...items.map((i) => `  ${i.name}：${i.packLabel}（${i.reason}）`)] : [];
  };
  return [...group('must', '必买'), ...group('short_life', '短保'), ...group('optional', '可选'), ...f.notes].join('\n') || '接下来不需要采购';
}

export function reportIntake(state: KitchenState, days: number, now: Date): string {
  const today = localDate(now);
  return recentIntake(state, today, days).flatMap((d) => [friendlyDate(d.date, today), ...intakeLines(state, d.date).map((l) => `  ${l}`)]).join('\n');
}

export function reportFacts(query: string | undefined): string {
  return NUTRITION_FACTS.filter((n) => !query || n.name.includes(query) || n.ingredientId?.includes(query))
    .map((n) => `${n.name}（${n.ingredientId ?? '无'}）${n.serving}：${nutritionLine(n)}${n.note ? `  ${n.note}` : ''}`).join('\n') || '没有这个食材的营养资料';
}

export function reportLog(state: KitchenState, n: number): string {
  const ops = [...state.audit_events].filter((a: AuditEvent) => !['syncPlan', 'syncCatalog'].includes(a.name)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, n);
  return ops.map((o) => `${o.at.slice(0, 16)} ${o.id} ${o.name}${o.undoneBy ? '（已撤销）' : ''}：${o.summary}`).join('\n') || '还没有操作记录';
}
