import { addDays, diffDays, localDate, shortDate, type LocalDate } from './dates';
import { activeLots, fefoSort, stockOf } from './inventory';
import { currentMeal, pref, recipeOf, slotSort } from './planner';
import type { Id, Ingredient, KitchenState, ShoppingTag } from './types';
import { formatQty, packCanonical, roundQty } from './units';

export interface ForecastItem {
  ingredientId: Id;
  productId: Id | null;
  name: string;
  tag: ShoppingTag;
  /** 建议买多少（规范单位）。0 = 现在不建议买。 */
  suggestedQty: number | null;
  unit: string;
  packLabel: string;
  reason: string;
  /** 这个窗口内的计划总需要。 */
  needed: number;
  /** 净缺口。 */
  gap: number;
}

export interface Forecast {
  shopDate: LocalDate;
  endDate: LocalDate;
  items: ForecastItem[];
  notes: string[];
}

interface Demand { date: LocalDate; qty: number; optional: boolean }

const unitOf = (i: Ingredient) => (i.unit === 'count' ? i.countUnit ?? '' : i.unit === 'level' ? '' : i.unit);

/**
 * 净采购需求 = max(0, 未来计划需要 − 到使用日当天仍可用的库存)。
 * 只读模拟：不占用、不修改真实库存。熟菜覆盖已经体现在计划里
 * （被熟菜覆盖的餐次 role=leftover，不产生原料需求）。
 */
export function forecastShopping(state: KitchenState, now: Date): Forecast {
  const today = localDate(now);
  const nextShop = pref<LocalDate | null>(state, 'nextShopDate', null);
  const shopDate = !nextShop || nextShop < today ? today : nextShop;
  const endDate = addDays(shopDate, 13);
  const from = currentMeal(now);

  const demands = new Map<Id, Demand[]>();
  const seasoningUse = new Set<Id>();
  const slots = state.meal_slots
    .filter((s) => s.status === 'planned' && s.role === 'cook' && s.recipeId && s.date <= endDate &&
      (s.date > from.date || (s.date === from.date && (from.slot === 'lunch' || s.slot === 'dinner'))))
    .sort(slotSort);

  for (const s of slots) {
    const recipe = recipeOf(state, s.recipeId)!;
    const factor = s.cookServings / recipe.baseServings;
    for (const ri of state.recipe_ingredients.filter((x) => x.recipeId === recipe.id)) {
      const ing = state.ingredients.find((i) => i.id === ri.ingredientId);
      if (!ing) continue;
      if (ing.unit === 'level') { if (ri.role === 'required') seasoningUse.add(ing.id); continue; }
      if (ri.qty === null) continue;
      if (!demands.has(ing.id)) demands.set(ing.id, []);
      demands.get(ing.id)!.push({ date: s.date, qty: ri.qty * factor, optional: ri.role === 'optional' });
    }
  }

  const items: ForecastItem[] = [];
  const notes: string[] = [];

  for (const [ingredientId, list] of demands) {
    const ing = state.ingredients.find((i) => i.id === ingredientId)!;
    const stock = stockOf(state, ingredientId);
    const unit = unitOf(ing);
    const lots = fefoSort(activeLots(state, ingredientId)).filter((l) => l.qty !== null).map((l) => ({ left: l.qty!, useBy: l.useBy }));

    // 按使用日期逐笔模拟：到那天已过建议日期的批次不能算库存。
    const shortfalls: Demand[] = [];
    for (const d of [...list].sort((a, b) => a.date.localeCompare(b.date))) {
      let need = d.qty;
      for (const lot of lots) {
        if (need <= 0) break;
        if (lot.left <= 0 || (lot.useBy && lot.useBy < d.date)) continue;
        const take = Math.min(lot.left, need);
        lot.left -= take;
        need -= take;
      }
      if (need > 0.001) shortfalls.push({ ...d, qty: need });
    }

    const requiredGap = shortfalls.filter((d) => !d.optional);
    const optionalOnly = requiredGap.length === 0;
    const considered = optionalOnly ? shortfalls : requiredGap;
    // 有必需用量时，「计划需要」只说必需的部分，不把可选配料算进去。
    const hasRequired = list.some((d) => !d.optional);
    const needed = roundQty(list.filter((d) => !hasRequired || !d.optional).reduce((n, d) => n + d.qty, 0));
    const gap = roundQty(considered.reduce((n, d) => n + d.qty, 0));
    const product = state.products.find((p) => p.ingredientId === ingredientId) ?? null;

    if (gap === 0) {
      items.push({ ingredientId, productId: product?.id ?? null, name: ing.name, tag: 'enough', suggestedQty: 0, unit, packLabel: '', reason: `库存够用（计划需要 ${formatQty(needed, unit)}）`, needed, gap: 0 });
      continue;
    }

    // 短保食材：放不到使用日的需求不进入本次购买量，并说明怎么处理。
    // 7 天以内保鲜的只为前 5 天的计划买：第 7 天才吃的蘑菇不值得多买一盒。
    const limit = ing.category === 'fresh' && ing.shelfDays !== null && !ing.freezable ? (ing.shelfDays <= 7 ? Math.min(ing.shelfDays, 5) : ing.shelfDays) : null;
    const late = limit === null ? [] : considered.filter((d) => diffDays(d.date, shopDate) > limit);
    const early = limit === null ? considered : considered.filter((d) => diffDays(d.date, shopDate) <= limit);
    // 可选配料放不到使用日就不买，也不值得警告。
    if (optionalOnly && early.length === 0) continue;
    const buyQty = roundQty(early.reduce((n, d) => n + d.qty, 0));
    const lateQty = roundQty(late.reduce((n, d) => n + d.qty, 0));

    const sub = state.ingredient_substitutions.find((s) => s.ingredientId === ingredientId);
    const subName = sub ? state.ingredients.find((i) => i.id === sub.substituteId)?.name : null;
    const lateAdvice = late.length === 0 || optionalOnly ? '' :
      `${shortDate(late[0].date)} 起要用的 ${formatQty(lateQty, unit)} 放不到那天：可以把这道菜提前、买回后先炒熟冷冻${subName ? `、改用${subName}` : ''}，或下次再买`;

    const pack = packInfo(state, ing, buyQty);
    const unverified = stock.reality === 'mentioned' || (stock.hasUnknownLot && stock.knownQty === 0);

    let tag: ShoppingTag;
    if (lateAdvice) tag = 'short_life';
    else if (optionalOnly) tag = 'optional';
    else if (unverified) tag = 'optional';
    else tag = 'must';

    const reasonParts: string[] = [];
    if (unverified) reasonParts.push(stock.hasUnknownLot ? `家里有但数量未知，计划需要 ${formatQty(needed, unit)}，先核对` : `家里可能有（待核对），计划需要 ${formatQty(needed, unit)}`);
    else reasonParts.push(optionalOnly ? `可选配料，缺 ${formatQty(gap, unit)}` : `计划需要 ${formatQty(needed, unit)}，缺 ${formatQty(gap, unit)}`);
    if (lateAdvice) reasonParts.push(lateAdvice);
    if (buyQty > 0 && pack.surplus > 0 && ing.category === 'fresh') {
      reasonParts.push(`一包多出 ${formatQty(pack.surplus, unit)}，前几天用完${ing.shelfDays !== null && ing.shelfDays <= 7 ? '或炒熟冷冻' : ''}`);
    }
    if (ing.freezable && ing.highRisk && buyQty > 0) reasonParts.push('回家按一顿/一天分袋冷冻');

    items.push({
      ingredientId, productId: product?.id ?? null, name: ing.name, tag,
      suggestedQty: buyQty === 0 ? 0 : pack.qty, unit, packLabel: buyQty === 0 ? '暂不买' : pack.label,
      reason: reasonParts.join('；'), needed, gap,
    });
  }

  const unconfirmed: string[] = [];
  for (const id of seasoningUse) {
    const ing = state.ingredients.find((i) => i.id === id)!;
    if (ing.level === 'low' || ing.level === 'out') {
      items.push({
        ingredientId: id, productId: null, name: ing.name, tag: ing.level === 'out' ? 'must' : 'optional', suggestedQty: null, unit: '', packLabel: '一瓶/一包',
        reason: ing.level === 'out' ? '计划要用，已经没有了' : '计划要用，快用完了，顺手补一个？', needed: 0, gap: 0,
      });
    } else if (ing.level === 'unconfirmed') {
      unconfirmed.push(ing.name);
    }
  }
  if (unconfirmed.length) notes.push(`这些调料还没确认：${unconfirmed.slice(0, 8).join('、')}${unconfirmed.length > 8 ? ' 等' : ''}。出门前看一眼是否快用完。`);

  const order: Record<ShoppingTag, number> = { must: 0, short_life: 1, optional: 2, enough: 3 };
  items.sort((a, b) => order[a.tag] - order[b.tag] || a.name.localeCompare(b.name, 'zh'));
  return { shopDate, endDate, items, notes };
}

function packInfo(state: KitchenState, ing: Ingredient, qty: number): { qty: number; label: string; surplus: number } {
  const unit = unitOf(ing);
  const product = state.products.find((p) => p.ingredientId === ing.id);
  if (product?.packQty && product.packUnit) {
    const size = packCanonical(product.packQty, product.packUnit, ing);
    if (size) {
      const packs = Math.ceil(qty / size);
      const total = packs * size;
      return { qty: total, label: `${packs} × ${product.name}（约${formatQty(total, unit)}）`, surplus: roundQty(total - qty) };
    }
  }
  if (ing.unit === 'count') {
    const n = Math.ceil(qty);
    return { qty: n, label: `${n}${unit}`, surplus: roundQty(n - qty) };
  }
  if (product) return { qty, label: `约${formatQty(qty, unit)}，规格待核对`, surplus: 0 };
  return { qty, label: `约${formatQty(qty, unit)}，按实际包装买，规格待核对`, surplus: 0 };
}
