import type { CommandName } from '../commands';
import { edibleBatches } from '../commands';
import { addDays, friendlyDate, isValidDate, localDate, type LocalDate } from '../dates';
import { execute, preview } from '../engine';
import { activeLots, fefoSort } from '../inventory';
import { currentMeal, slotId, SLOT_LABEL } from '../planner';
import { recommendSnack, recommendToday, type Recommendation, type SnackOption } from '../recommend';
import { forecastShopping, type ForecastItem } from '../shopping';
import { DomainError, type CommandResult, type Ctx } from '../tx';
import type { KitchenState } from '../types';
import { resolveDatePhrase } from './dateExpr';
import { findIngredient, findRecipe, ingredientMentioned, quoteInText, recipeInText } from './match';
import { ruleParse } from './ruleParser';
import { parseProposal, type ActionProposal, type RequestedChange } from './schema';

export interface ClarifyOption {
  label: string;
  /** 补充到草稿上重新解析。 */
  patch?: { meal_slot?: 'lunch' | 'dinner'; requested_change?: RequestedChange };
  /** 或者直接成为一个可确认的修正。 */
  command?: CommandName;
  input?: unknown;
}

export type Resolution =
  | { type: 'preview'; proposal: ActionProposal; command: CommandName; input: unknown; result: CommandResult }
  | { type: 'clarify'; proposal: ActionProposal; question: string; options: ClarifyOption[] }
  | { type: 'ask_number'; proposal: ActionProposal; question: string; field: 'quantity'; unit: string }
  | { type: 'filter'; proposal: ActionProposal; input: unknown; note: string | null; recommendation: Recommendation }
  | { type: 'answer'; proposal: ActionProposal; text: string; recommendation?: Recommendation; snacks?: SnackOption[]; shopping?: ForecastItem[]; openRecipeId?: string }
  | { type: 'rejected'; reason: string; errors: string[] };

const reject = (reason: string, errors: string[] = []): Resolution => ({ type: 'rejected', reason, errors });

const MEAL_OPTIONS: ClarifyOption[] = [
  { label: '午餐', patch: { meal_slot: 'lunch' } },
  { label: '晚餐', patch: { meal_slot: 'dinner' } },
];

interface Ctx2 { state: KitchenState; ctx: Ctx; p: ActionProposal; text: string; today: LocalDate; date: LocalDate; slot: 'lunch' | 'dinner' | null; c: RequestedChange; slotConfirmed: boolean }

const SLOT_WORDS = /中午|午饭|午餐|晚上|晚饭|晚餐|今晚|明晚|昨晚|lunch|dinner/i;
const ALL_DAY_WORDS = /整天|一整天|全天|一天都|两顿都|都不在家/;

/** 程序自己算日期：用户原话优先，模型算的日期只在原话没有日期时才用，并限制合理范围。 */
function resolveDate(p: ActionProposal, text: string, now: Date): LocalDate | { error: string } {
  const today = localDate(now);
  // 挪动类的话里有两个日期：起点取草稿里单独标出的那个。
  const moved = p.intent === 'move_meal' && p.date_phrase ? resolveDatePhrase(p.date_phrase, now) : null;
  const fromText = moved ?? resolveDatePhrase(text, now) ?? (p.date_phrase ? resolveDatePhrase(p.date_phrase, now) : null);
  if (fromText) return fromText.date;
  if (p.date) {
    if (!isValidDate(p.date) || p.date < addDays(today, -7) || p.date > addDays(today, 60)) return { error: `日期 ${p.date} 不合理` };
    return p.date;
  }
  return today;
}

function previewCommand(x: Ctx2, command: CommandName, input: unknown): Resolution {
  try {
    return { type: 'preview', proposal: x.p, command, input, result: preview(x.state, x.ctx, command, input) };
  } catch (e) {
    if (e instanceof DomainError) {
      if (e.options?.length) {
        return { type: 'clarify', proposal: x.p, question: e.message, options: e.options.map((o) => ({ label: o.label, command, input: o.input })) };
      }
      if (e.code === 'NEEDS_SPEC') {
        const ing = findIngredient(x.state, x.c.ingredient);
        return { type: 'ask_number', proposal: x.p, question: `${e.message} ${ing?.name ?? ''}这次用了多少克？`, field: 'quantity', unit: 'g' };
      }
      return reject(e.message);
    }
    throw e;
  }
}

/** 涉及库存事实的动作必须有证据：食材要真的出现在用户原话里，摘抄要能在原话里找到。 */
function requireEvidence(x: Ctx2, ingredientId: string): Resolution | null {
  if (!ingredientMentioned(x.state, ingredientId, x.text)) {
    return reject('模型提到的食材不在你说的话里，已忽略，库存没有变化。', ['evidence: ingredient not in user text']);
  }
  if (!quoteInText(x.c.evidence_quote, x.text)) {
    return reject('这条库存变动找不到你原话的依据，已忽略，库存没有变化。', ['evidence: quote not in user text']);
  }
  if (x.c.quantity !== null && x.c.quantity !== undefined && x.c.quantity > 0) {
    const cn = '半一两二三四五六七八九十';
    if (!x.text.includes(String(x.c.quantity)) && ![...cn].some((c) => x.text.includes(c))) {
      return reject('这个数量在你的话里找不到，已忽略，库存没有变化。', ['evidence: quantity not in user text']);
    }
  }
  return null;
}

function lastEatenSlot(x: Ctx2): { date: LocalDate; slot: 'lunch' | 'dinner' } {
  if (x.slot) return { date: x.date, slot: x.slot };
  const recent = x.state.consumption_events
    .filter((c) => c.date === x.date && c.kind === 'prepared' && c.slot !== 'snack')
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  if (recent && recent.slot !== 'snack') return { date: recent.date, slot: recent.slot };
  const meal = currentMeal(x.ctx.now);
  return { date: x.date, slot: meal.slot === 'snack' ? 'dinner' : meal.slot };
}

function handleMealOff(x: Ctx2, status: 'eating_out' | 'skipped'): Resolution {
  // 「整天」只认用户原话或用户在提问里的选择：模型漏了不多问，模型多猜了也不算数。
  if (ALL_DAY_WORDS.test(x.text) || (x.slotConfirmed && x.c.scope === 'all_day')) return previewCommand(x, 'setDayAway', { date: x.date });
  // 用户没提午晚时，不采信模型猜的餐次：改的是计划或事实，要问清楚。
  const chosen = x.slotConfirmed || SLOT_WORDS.test(x.text) ? x.slot : null;
  if (!chosen) {
    return {
      type: 'clarify', proposal: x.p, question: x.p.ambiguities[0] ?? '是午餐还是晚餐？',
      options: status === 'eating_out'
        ? [...MEAL_OPTIONS, { label: '一整天', patch: { requested_change: { ...x.c, scope: 'all_day' } } }]
        : MEAL_OPTIONS,
    };
  }
  const slot = x.state.meal_slots.find((s) => s.id === slotId(x.date, chosen));
  if (status === 'skipped' && slot?.status === 'eaten') {
    // 不擅自删除已记录的食用：给出明确修正，由用户确认。
    return previewCommand(x, 'revertConsumption', { date: x.date, slot: chosen });
  }
  return previewCommand(x, 'setMealStatus', { date: x.date, slot: chosen, status });
}

function constraintFilter(x: Ctx2, patch: Record<string, unknown>, note: string | null): Resolution {
  const input = { date: x.date, ...patch };
  const dry = execute(x.state, x.ctx, 'setConstraint', input);
  return { type: 'filter', proposal: x.p, input, note, recommendation: recommendToday(dry.state, x.ctx.now) };
}

function excludeIds(x: Ctx2, name: string | null | undefined): string[] {
  if (!name) return [];
  const direct = findRecipe(x.state, name);
  const similar = x.state.recipes.filter((r) => r.name.includes(name) || r.flavors.some((f) => f.includes(name)));
  return [...new Set([...(direct ? [direct.id] : []), ...similar.map((r) => r.id)])];
}

/** 把通过校验的草稿变成确定性的预览、澄清或只读回答。这里不写任何数据。 */
export function resolveProposal(state: KitchenState, ctx: Ctx, raw: unknown, text: string, opts: { slotConfirmed?: boolean } = {}): Resolution {
  const parsed = parseProposal(raw);
  if (!parsed.ok) return reject('没能理解这句话，可以用下面的快捷按钮。', parsed.errors);
  const p = parsed.proposal;
  if (p.confidence < 0.5) return reject('不太确定你的意思，可以用下面的快捷按钮。', [`confidence ${p.confidence}`]);

  const today = localDate(ctx.now);
  const date = resolveDate(p, text, ctx.now);
  if (typeof date !== 'string') return reject(date.error);
  const slot = p.meal_slot === 'snack' ? null : p.meal_slot ?? null;
  const c = p.requested_change;
  const x: Ctx2 = { state, ctx, p, text, today, date, slot, c, slotConfirmed: opts.slotConfirmed ?? false };

  switch (p.intent) {
    case 'eat_out': return handleMealOff(x, 'eating_out');
    case 'skip_meal': return handleMealOff(x, c.status === 'eating_out' ? 'eating_out' : 'skipped');

    case 'change_meal_count': {
      const count = c.meal_count;
      if (count === null || count === undefined) return reject('没听清要吃几顿。');
      let keep = c.keep_slot ?? slot ?? undefined;
      if (count === 1 && !keep && date === today && currentMeal(ctx.now).slot === 'dinner') keep = 'dinner';
      if (count === 1 && !keep) {
        return { type: 'clarify', proposal: p, question: '留午餐还是晚餐？', options: [
          { label: '午餐', patch: { requested_change: { ...c, keep_slot: 'lunch' } } },
          { label: '晚餐', patch: { requested_change: { ...c, keep_slot: 'dinner' } } },
        ] };
      }
      return previewCommand(x, 'changeMealCount', { date, count, ...(keep ? { keep } : {}) });
    }

    case 'move_meal': {
      const to = c.to_date_phrase ? resolveDatePhrase(c.to_date_phrase, ctx.now) : null;
      if (!to) return { type: 'rejected', reason: '要挪到哪一天？可以在 14 天计划里直接改。', errors: [] };
      return previewCommand(x, 'moveMeal', { fromDate: date, toDate: to.date });
    }

    case 'swap_recipe': {
      const recipe = findRecipe(state, c.recipe_name);
      const named = !!recipe && (text.includes(c.recipe_name ?? '\u0000') || recipeInText(state, text)?.id === recipe.id);
      if (!named) {
        // 用户没点名时，模型不能替用户选菜：按用户说的条件交给规则引擎推荐。
        const rule = ruleParse(text, state, ctx.now) as { intent?: string } | null;
        if (rule && rule.intent !== 'swap_recipe') return resolveProposal(state, ctx, rule, text, opts);
        if (c.spicy || c.equipment || c.exclude_recipe) {
          const ids = excludeIds(x, c.exclude_recipe);
          return constraintFilter(x, { ...(c.equipment === 'airfryer' ? { airfryerOnly: true } : {}), ...(c.spicy ? { spicy: true } : {}), ...(ids.length ? { excludeRecipeIds: ids } : {}) }, null);
        }
      }
      if (!recipe) return reject(`菜谱里没有「${c.recipe_name ?? ''}」，不会新造菜。可以在菜谱页选一道。`);
      return previewCommand(x, 'swapRecipe', { date, recipeId: recipe.id, ...(slot ? { slot } : {}), ...(c.days ? { days: c.days } : {}) });
    }

    case 'set_available_minutes': {
      const ids: string[] = [];
      let note: string | null = null;
      if (c.frozen_ingredient) {
        const ing = findIngredient(state, c.frozen_ingredient);
        if (ing) {
          ids.push(...state.recipe_ingredients.filter((r) => r.ingredientId === ing.id && r.role === 'required').map((r) => r.recipeId));
          note = `${ing.name}放冰箱解冻，改到后面的日子吃。不要长时间常温解冻。`;
        }
      }
      return constraintFilter(x, { ...(c.minutes ? { minutes: c.minutes } : {}), ...(ids.length ? { excludeRecipeIds: [...new Set(ids)] } : {}) }, note);
    }

    case 'set_equipment': {
      const ids = excludeIds(x, c.exclude_recipe);
      return constraintFilter(x, {
        ...(c.equipment === 'airfryer' ? { airfryerOnly: true } : {}),
        ...(c.spicy ? { spicy: true } : {}),
        ...(ids.length ? { excludeRecipeIds: ids } : {}),
      }, null);
    }

    case 'change_hunger_level':
      return constraintFilter(x, { hunger: c.hunger ?? 'normal' }, null);

    case 'request_extra_meal': {
      // 饿 ≠ 吃了：这里只给选项，绝不记账。
      const snacks = recommendSnack(state, ctx.now);
      return { type: 'answer', proposal: p, text: snacks.length ? '可以吃这些，吃完点确认才记账：' : '现在没有可确认的加餐选项，先看看库存？', snacks };
    }

    case 'consume_prepared_portions': {
      if (c.total_portions) {
        const meal = lastEatenSlot(x);
        return previewCommand(x, 'reconcileMealPortions', { date: meal.date, slot: meal.slot, totalEaten: c.total_portions });
      }
      const batch = edibleBatches(state)[0];
      if (!batch) return reject('没有可吃的熟菜记录。');
      const meal = currentMeal(ctx.now);
      return previewCommand(x, 'consumePreparedPortion', { batchId: batch.id, portions: c.portions ?? 1, date: meal.date, slot: meal.slot });
    }

    case 'record_snack': {
      const ing = findIngredient(state, c.ingredient);
      if (ing) {
        const bad = requireEvidence(x, ing.id);
        if (bad) return bad;
      }
      return previewCommand(x, 'recordSnack', {
        ...(ing ? { ingredientId: ing.id } : { label: (c.ingredient ?? text).slice(0, 60) }),
        ...(c.quantity ? { qty: c.quantity } : {}), ...(c.unit ? { unit: c.unit } : {}), date,
      });
    }

    case 'start_cooking': {
      const recipe = findRecipe(state, c.recipe_name);
      if (!recipe) return { type: 'answer', proposal: p, text: '想做哪道？这里是现在的推荐：', recommendation: recommendToday(state, ctx.now) };
      return { type: 'answer', proposal: p, text: `打开「${recipe.name}」。打开菜谱不扣库存，做完确认才记账。`, openRecipeId: recipe.id };
    }

    case 'finish_cooking_proposal': {
      const active = state.cook_sessions.find((s) => s.status === 'started');
      const recipe = active ? state.recipes.find((r) => r.id === active.recipeId) ?? null : findRecipe(state, c.recipe_name);
      if (!recipe) return reject('没找到正在做的菜。');
      const servings = c.servings ?? active?.plannedServings ?? 2;
      return previewCommand(x, 'finishCook', {
        ...(active ? { sessionId: active.id } : { recipeId: recipe.id }), servings, eatNow: Math.min(c.portions ?? 1, servings),
      });
    }

    case 'correct_cook_quantities': {
      const ing = findIngredient(state, c.ingredient);
      if (!ing) return reject('没听清是哪种食材。');
      const bad = requireEvidence(x, ing.id);
      if (bad) return bad;
      if (ing.unit === 'level') return reject(`${ing.name}不记克数，不需要修正。`);
      if (c.quantity === null && c.delta === null || (c.quantity === undefined && c.delta === undefined)) {
        return { type: 'ask_number', proposal: p, question: `${ing.name}这次用了多少？`, field: 'quantity', unit: ing.unit === 'count' ? ing.countUnit ?? '' : ing.unit };
      }
      return previewCommand(x, 'reviseCookSession', {
        ingredientId: ing.id, ...(c.quantity !== null && c.quantity !== undefined ? { qty: c.quantity } : { delta: c.delta! }), ...(c.unit ? { unit: c.unit } : {}),
      });
    }

    case 'discard_food_proposal': {
      const recipe = c.recipe_name ? findRecipe(state, c.recipe_name) : null;
      const batch = recipe ? edibleBatches(state).find((b) => b.recipeId === recipe.id) : undefined;
      if (batch) return previewCommand(x, 'discardBatch', { batchId: batch.id });
      const ing = findIngredient(state, c.ingredient);
      if (!ing) return reject('没听清是哪种食材。');
      const bad = requireEvidence(x, ing.id);
      if (bad) return bad;
      const lot = fefoSort(activeLots(state, ing.id))[0];
      if (!lot) return reject(`库存里没有${ing.name}的记录，不需要报废。`);
      return previewCommand(x, 'discardLot', { lotId: lot.id, reason: text.slice(0, 100) });
    }

    case 'add_purchase_proposal': {
      const ing = findIngredient(state, c.ingredient);
      if (!ing) return reject('没听清买了什么。可以在采购页确认入库。');
      const bad = requireEvidence(x, ing.id);
      if (bad) return bad;
      return previewCommand(x, 'confirmPurchase', { lines: [{
        ingredientId: ing.id, bought: true, ...(c.quantity ? { qty: c.quantity } : {}), ...(c.unit ? { unit: c.unit } : {}), ...(c.location ? { location: c.location } : {}),
      }] });
    }

    case 'correct_inventory_proposal': {
      const ing = findIngredient(state, c.ingredient);
      if (!ing) return reject('没听清是哪种食材。');
      const bad = requireEvidence(x, ing.id);
      if (bad) return bad;
      if (ing.unit === 'level') return previewCommand(x, 'setSeasoningLevel', { ingredientId: ing.id, level: c.level ?? 'have' });
      if (c.quantity === null || c.quantity === undefined) return reject('没听清数量。');
      return previewCommand(x, 'adjustInventory', { ingredientId: ing.id, qty: c.quantity, ...(c.unit ? { unit: c.unit } : {}), ...(c.location ? { location: c.location } : {}) });
    }

    case 'ask_what_to_cook': {
      const recommendation = recommendToday(state, ctx.now);
      return { type: 'answer', proposal: p, text: recommendation.primary ? `${recommendation.meal.label}可以做：` : recommendation.note ?? '当前没有合适的菜。', recommendation };
    }

    case 'ask_what_to_buy': {
      const fc = forecastShopping(state, ctx.now);
      const list = fc.items.filter((i) => i.tag !== 'enough').slice(0, 6);
      return { type: 'answer', proposal: p, text: `${friendlyDate(fc.shopDate, today)}采购建议：`, shopping: list };
    }
  }
}

/** 把用户对澄清的回答合并回草稿后重新解析。 */
export function applyClarify(state: KitchenState, ctx: Ctx, proposal: ActionProposal, option: ClarifyOption, text: string): Resolution {
  const merged: ActionProposal = {
    ...proposal,
    meal_slot: option.patch?.meal_slot ?? proposal.meal_slot,
    requested_change: { ...proposal.requested_change, ...option.patch?.requested_change },
    ambiguities: [],
  };
  return resolveProposal(state, ctx, merged, text, { slotConfirmed: true });
}

export const slotLabelOf = (s: 'lunch' | 'dinner') => SLOT_LABEL[s];
