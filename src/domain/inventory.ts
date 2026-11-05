import { addDays, diffDays, type LocalDate } from './dates';
import type { Ingredient, InventoryLot, KitchenState, Location, Reality } from './types';
import { DomainError, type Tx } from './tx';
import { roundQty } from './units';

export interface StockInfo {
  ingredient: Ingredient;
  lots: InventoryLot[];
  /** 已知数量合计（规范单位）。 */
  knownQty: number;
  /** 已知数量中非冷冻（可直接用）的部分。 */
  readyQty: number;
  frozenQty: number;
  hasUnknownLot: boolean;
  reality: Reality;
}

export const activeLots = (state: KitchenState, ingredientId: string) =>
  state.inventory_lots.filter((l) => l.ingredientId === ingredientId && l.status === 'active');

export function ingredientById(state: KitchenState, id: string): Ingredient {
  const ing = state.ingredients.find((i) => i.id === id);
  if (!ing) throw new DomainError('UNKNOWN_INGREDIENT', `目录里没有这种食材：${id}`);
  return ing;
}

export function stockOf(state: KitchenState, ingredientId: string): StockInfo {
  const ingredient = ingredientById(state, ingredientId);
  const lots = activeLots(state, ingredientId);
  let knownQty = 0, readyQty = 0, frozenQty = 0, hasUnknownLot = false;
  for (const l of lots) {
    if (l.qty === null) hasUnknownLot = true;
    else {
      knownQty += l.qty;
      if (l.location === 'freezer') frozenQty += l.qty;
      else readyQty += l.qty;
    }
  }
  return { ingredient, lots, knownQty, readyQty, frozenQty, hasUnknownLot, reality: realityOf(state, ingredient, lots, knownQty, hasUnknownLot) };
}

function realityOf(state: KitchenState, ing: Ingredient, lots: InventoryLot[], knownQty: number, hasUnknown: boolean): Reality {
  if (ing.unit === 'level') {
    if (ing.level === 'have' || ing.level === 'low') return 'confirmed_present_unknown_qty';
    return ing.level === 'out' ? 'out' : 'mentioned';
  }
  if (knownQty > 0) return 'confirmed_qty';
  if (hasUnknown) return 'confirmed_present_unknown_qty';
  if (ing.markedOut) return 'out';
  // 曾经有过批次、现在全部用完或报废 → 确认没有了；从未核对过 → 仍只是「提到过」。
  const everStocked = state.inventory_lots.some((l) => l.ingredientId === ing.id && l.status !== 'reverted');
  return everStocked || lots.length > 0 ? 'out' : 'mentioned';
}

export const REALITY_LABEL: Record<Reality, string> = {
  mentioned: '待核对',
  confirmed_present_unknown_qty: '有，数量未知',
  confirmed_qty: '已核实',
  out: '没有',
};

export const LOCATION_LABEL: Record<Location, string> = { fridge: '冷藏', freezer: '冷冻', pantry: '常温' };

/** 先到期先用：非冷冻优先，同类按建议日期升序，无日期排后。冷冻批次最后才动。 */
export function fefoSort(lots: InventoryLot[]): InventoryLot[] {
  const key = (l: InventoryLot) => l.useBy ?? '9999-12-31';
  return [...lots].sort((a, b) => {
    const fa = a.location === 'freezer' ? 1 : 0;
    const fb = b.location === 'freezer' ? 1 : 0;
    if (fa !== fb) return fa - fb;
    return key(a).localeCompare(key(b)) || a.id.localeCompare(b.id);
  });
}

export interface Allocation {
  allocations: { lotId: string; qty: number }[];
  usedUnknownLot: boolean;
  shortfall: number;
}

/** 按 FEFO 从真实批次扣减。库存不足时只扣到 0，差额如实返回，绝不产生负数。 */
export function deduct(tx: Tx, ingredientId: string, qty: number, note: string, type: 'consume_raw' | 'adjust' = 'consume_raw'): Allocation {
  const lots = fefoSort(activeLots(tx.state, ingredientId));
  const allocations: { lotId: string; qty: number }[] = [];
  let left = qty;
  for (const lot of lots) {
    if (left <= 0) break;
    if (lot.qty === null || lot.qty <= 0) continue;
    const take = roundQty(Math.min(lot.qty, left));
    applyDelta(tx, lot, -take, type, note);
    allocations.push({ lotId: lot.id, qty: take });
    left = roundQty(left - take);
  }
  let usedUnknownLot = false;
  if (left > 0) {
    const unknown = lots.find((l) => l.qty === null);
    if (unknown) {
      // 数量未知的批次：记录「用过」这个事实，但不虚构扣减数字。
      tx.append('inventory_events', {
        id: tx.newId('ie'), txId: tx.txId, lotId: unknown.id, ingredientId, type, qtyDelta: null, unit: unknown.unit, at: tx.at,
        note: `${note}（批次数量未知，未扣数）`,
      });
      usedUnknownLot = true;
      left = 0;
    }
  }
  return { allocations, usedUnknownLot, shortfall: roundQty(left) };
}

export function applyDelta(tx: Tx, lot: InventoryLot, delta: number, type: 'consume_raw' | 'adjust' | 'discard' | 'transfer', note: string): InventoryLot {
  if (lot.qty === null) throw new DomainError('UNKNOWN_QTY', '这批数量未知，不能做数量加减');
  const qty = roundQty(lot.qty + delta);
  if (qty < 0) throw new DomainError('NEGATIVE_STOCK', '库存不能变成负数');
  const updated = tx.put<InventoryLot>('inventory_lots', {
    ...lot, qty,
    status: qty === 0 ? (type === 'discard' ? 'discarded' : 'depleted') : 'active',
  });
  tx.append('inventory_events', {
    id: tx.newId('ie'), txId: tx.txId, lotId: lot.id, ingredientId: lot.ingredientId, type, qtyDelta: delta, unit: lot.unit, at: tx.at, note,
  });
  return updated;
}

/** 根据位置算保守建议日期。没有依据时返回 null，绝不编造。 */
export function ruleUseBy(ing: Ingredient, location: Location, today: LocalDate, thawed = false): { useBy: LocalDate | null; source: 'rule' | null } {
  if (location === 'freezer') return { useBy: null, source: null };
  const days = thawed ? ing.thawedDays : ing.shelfDays;
  return days === null ? { useBy: null, source: null } : { useBy: addDays(today, days), source: 'rule' };
}

export function daysLeft(useBy: LocalDate | null, today: LocalDate): number | null {
  return useBy === null ? null : diffDays(useBy, today);
}
