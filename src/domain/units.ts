import type { Ingredient } from './types';

const MASS: Record<string, number> = {
  g: 1, 克: 1, kg: 1000, 千克: 1000, 公斤: 1000, oz: 28.3495, 盎司: 28.3495, lb: 453.592, lbs: 453.592, 磅: 453.592, 斤: 500,
};
const VOLUME: Record<string, number> = { ml: 1, 毫升: 1, l: 1000, 升: 1000 };
export const COUNT_UNITS = ['颗', '个', '根', '把', '袋', '罐', '盒', '瓶', '包', '片', '块', '头', '只'];

const norm = (u: string) => u.trim().toLowerCase();

export type UnitTarget = Pick<Ingredient, 'unit' | 'countUnit' | 'unitSpecs'>;

export interface Converted {
  qty: number;
  unit: string;
  /** 换算用到了用户自定义的「一颗≈多少克」，而不是物理单位。 */
  viaUserSpec: boolean;
}

/**
 * 把任意输入单位换成食材的规范单位。无法换算时返回 null：
 * 例如洋葱按克记账、用户说「2颗」，又没有定义过一颗多重，这时绝不猜重量。
 */
export function toCanonical(qty: number, unit: string, ing: UnitTarget): Converted | null {
  const u = norm(unit);
  if (ing.unit === 'g' || ing.unit === 'ml') {
    const table = ing.unit === 'g' ? MASS : VOLUME;
    if (u in table) return { qty: roundQty(qty * table[u]), unit: ing.unit, viaUserSpec: false };
    const spec = ing.unitSpecs?.[unit];
    return spec ? { qty: roundQty(qty * spec), unit: ing.unit, viaUserSpec: true } : null;
  }
  if (ing.unit === 'count') {
    const own = ing.countUnit ?? '个';
    if (unit === own || unit === '个') return { qty, unit: own, viaUserSpec: false };
    return null;
  }
  return null;
}

/** 克重取整到 0.1，避免 226.796 这种假精确；计数保留原值。 */
export function roundQty(q: number): number {
  return Math.round(q * 10) / 10;
}

export function formatQty(q: number, unit: string): string {
  if (unit === 'g' && q >= 1000) return `${Math.round(q) / 1000}kg`; // 不四舍五入：1050g 不能显示成 1.1kg
  return `${Number.isInteger(q) ? q : roundQty(q)}${unit}`;
}

/** 一包规格换算为规范单位（例如 8oz → 227g）。 */
export function packCanonical(packQty: number, packUnit: string, ing: UnitTarget): number | null {
  const c = toCanonical(packQty, packUnit, ing);
  return c ? Math.round(c.qty) : null;
}
