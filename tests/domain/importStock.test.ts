import { describe, expect, it } from 'vitest';
import { Kitchen } from './helpers';

const set = (ingredientId: string, qty: number, unit?: string) => ({ ingredientId, qty, ...(unit ? { unit } : {}) });
const add = (ingredientId: string, qty: number, unit?: string) => ({ ...set(ingredientId, qty, unit), add: true as const });

describe('批量更新库存', () => {
  it('设总量，调料标记为有，账目对得上', () => {
    const k = new Kitchen();
    const r = k.run('importStock', { entries: [set('ground_beef', 7, 'lb'), set('egg', 4)], have: ['cumin'] });
    expect(r.summary).toBe('已导入 2 项库存、1 种调料');
    expect(k.qty('ground_beef')).toBe(3175.1);
    expect(k.qty('egg')).toBe(4);
    expect(k.state.ingredients.find((i) => i.id === 'cumin')?.level).toBe('have');
    expect(k.state.inventory_lots.find((l) => l.ingredientId === 'ground_beef')?.location).toBe('freezer');
    k.assertLedger();
  });

  it('是设成这个总量，不是再加一遍', () => {
    const k = new Kitchen();
    k.buy({ ground_beef: 1000 });
    k.run('importStock', { entries: [set('ground_beef', 7, 'lb')], have: [] });
    expect(k.qty('ground_beef')).toBe(3175.1);
    k.assertLedger();
  });

  it('增减：在现有数量上加减，不覆盖，可以整批撤销', () => {
    const k = new Kitchen();
    k.buy({ ground_beef: 1000, egg: 6 });
    const r = k.run('importStock', { entries: [add('ground_beef', 2, 'lb'), add('egg', -2), add('frozen_corn', 12, 'oz')], have: [] });
    expect(k.qty('ground_beef')).toBe(1907.2);
    expect(k.qty('egg')).toBe(4);
    expect(k.qty('frozen_corn')).toBe(340.2);
    k.assertLedger();
    k.run('undoTransaction', { operationId: r.operationId });
    expect(k.qty('ground_beef')).toBe(1000);
    expect(k.qty('egg')).toBe(6);
    expect(k.qty('frozen_corn')).toBe(0);
    k.assertLedger();
  });

  it('减过头时扣到 0，不出现负库存，并提示核对', () => {
    const k = new Kitchen();
    k.buy({ egg: 1 });
    k.run('importStock', { entries: [add('egg', -3)], have: [] });
    expect(k.qty('egg')).toBe(0);
    expect(k.last.warnings.join('')).toContain('差额');
    k.assertLedger();
  });

  it('增加不把数量未知的批次当 0', () => {
    const k = new Kitchen();
    k.run('calibrateInventory', { entries: [{ ingredientId: 'rice', present: true }] });
    k.run('importStock', { entries: [add('rice', 500)], have: [] });
    const lots = k.state.inventory_lots.filter((l) => l.ingredientId === 'rice' && l.status === 'active');
    expect(lots.map((l) => l.qty).sort()).toEqual([500, null].sort());
  });

  it('一项写不进去时整批不写', () => {
    const k = new Kitchen();
    expect(() => k.run('importStock', { entries: [set('egg', 4), set('不存在', 1)], have: [] })).toThrow();
    expect(k.qty('egg')).toBe(0);
  });
});
