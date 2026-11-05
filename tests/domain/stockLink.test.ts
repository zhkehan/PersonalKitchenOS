import { describe, expect, it } from 'vitest';
import { encodeStockLink, previewStockLink, readStockLink, stockLinkKey, type StockLink } from '../../src/domain/stockLink';
import { Kitchen } from './helpers';

const LINK: StockLink = {
  id: 'test-1',
  stock: [['ground_beef', 7, 'lb'], ['egg', 4], ['canned_sardine', 22], ['frozen_pepper_onion', 10, 'oz']],
  have: ['cumin', 'garlic_powder'],
};

const hash = (link: StockLink) => `#stock=${encodeStockLink(link)}`;

function apply(k: Kitchen, link: StockLink) {
  const p = previewStockLink(k.state, link);
  return k.run('importStock', { entries: p.entries, have: p.have }, stockLinkKey(link.id));
}

describe('解析链接', () => {
  it('编码后能原样读回来，带中文单位也行', () => {
    const link: StockLink = { ...LINK, stock: [...LINK.stock, ['canned_tomato', 2, '罐']] };
    expect(readStockLink(hash(link))).toEqual(link);
  });

  it('只用网址安全字符', () => {
    expect(encodeStockLink(LINK)).toMatch(/^[\w-]+$/);
  });

  it('坏链接返回 null，不抛错', () => {
    expect(readStockLink('')).toBeNull();
    expect(readStockLink('#stock=')).toBeNull();
    expect(readStockLink('#stock=abc')).toBeNull();
    expect(readStockLink(`#stock=${btoa('{"id":"x"}')}`)).toBeNull();
    expect(readStockLink(`#stock=${btoa(JSON.stringify({ id: 'x', stock: [['egg', -1]], have: [] }))}`)).toBeNull();
    expect(readStockLink(`#stock=${btoa(JSON.stringify({ id: 'x', stock: [], have: [], command: 'discard' }))}`)).toBeNull();
  });
});

describe('确认前的预览', () => {
  it('列出食材和调料，写的是用户看得懂的单位', () => {
    const p = previewStockLink(new Kitchen().state, LINK);
    expect(p.lines).toContainEqual({ name: '牛肉碎', label: '7lb' });
    expect(p.lines).toContainEqual({ name: '鸡蛋', label: '4颗' });
    expect(p.haveNames).toEqual(['孜然粉', '蒜粉']);
    expect(p.skipped).toEqual([]);
  });

  it('对不上的项跳过并列出来，其余照常', () => {
    const k = new Kitchen();
    const link: StockLink = {
      id: 'x',
      stock: [['不存在', 1], ['ground_beef', 1, 'lb'], ['cumin', 1], ['egg', 2, '斤']],
      have: ['ground_beef', '也不存在', 'cumin'],
    };
    const p = previewStockLink(k.state, link);
    expect(p.skipped).toEqual(['不存在', '孜然粉', '鸡蛋', '牛肉碎', '也不存在']);
    expect(p.entries).toEqual([{ ingredientId: 'ground_beef', qty: 1, unit: 'lb' }]);
    expect(p.have).toEqual(['cumin']);
    apply(k, link);
    expect(k.qty('ground_beef')).toBe(453.6);
  });
});

describe('导入', () => {
  it('一次写好库存和调料，账目对得上', () => {
    const k = new Kitchen();
    const r = apply(k, LINK);
    expect(r.summary).toBe('已导入 4 项库存、2 种调料');
    expect(k.qty('ground_beef')).toBe(3175.1);
    expect(k.qty('egg')).toBe(4);
    expect(k.qty('canned_sardine')).toBe(22);
    expect(k.qty('frozen_pepper_onion')).toBe(283.5);
    expect(k.state.ingredients.find((i) => i.id === 'cumin')?.level).toBe('have');
    expect(k.state.inventory_lots.find((l) => l.ingredientId === 'ground_beef')?.location).toBe('freezer');
    k.assertLedger();
  });

  it('是设成这个总量，不是再加一遍', () => {
    const k = new Kitchen();
    k.buy({ ground_beef: 1000 });
    apply(k, LINK);
    expect(k.qty('ground_beef')).toBe(3175.1);
    k.assertLedger();
  });

  it('旧链接再点一次不会把吃掉的库存加回来', () => {
    const k = new Kitchen();
    apply(k, LINK);
    k.run('adjustInventory', { ingredientId: 'egg', qty: 1 });
    const again = apply(k, LINK);
    expect(again.deduped).toBe(true);
    expect(k.qty('egg')).toBe(1);
  });

  it('整批可以撤销', () => {
    const k = new Kitchen();
    k.buy({ ground_beef: 1000 });
    const r = apply(k, LINK);
    k.run('undoTransaction', { operationId: r.operationId });
    expect(k.qty('ground_beef')).toBe(1000);
    expect(k.qty('egg')).toBe(0);
    expect(k.state.ingredients.find((i) => i.id === 'cumin')?.level).toBe('unconfirmed');
    k.assertLedger();
  });

  it('增减：在现有数量上加减，不覆盖', () => {
    const k = new Kitchen();
    k.buy({ ground_beef: 1000, egg: 6 });
    const link: StockLink = { id: 'd1', stock: [], add: [['ground_beef', 2, 'lb'], ['egg', -2], ['frozen_corn', 12, 'oz']], have: [] };
    const p = previewStockLink(k.state, link);
    expect(p.lines).toContainEqual({ name: '牛肉碎', label: '+2lb' });
    expect(p.lines).toContainEqual({ name: '鸡蛋', label: '-2颗' });
    const r = apply(k, link);
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
    apply(k, { id: 'd2', stock: [], add: [['egg', -3]], have: [] });
    expect(k.qty('egg')).toBe(0);
    expect(k.last.warnings.join('')).toContain('差额');
    k.assertLedger();
  });

  it('增加不把数量未知的批次当 0', () => {
    const k = new Kitchen();
    k.run('calibrateInventory', { entries: [{ ingredientId: 'rice', present: true }] });
    apply(k, { id: 'd3', stock: [], add: [['rice', 500]], have: [] });
    const lots = k.state.inventory_lots.filter((l) => l.ingredientId === 'rice' && l.status === 'active');
    expect(lots.map((l) => l.qty).sort()).toEqual([500, null].sort());
  });

  it('一项写不进去时整批不写', () => {
    const k = new Kitchen();
    const before = k.qty('egg');
    expect(() => k.run('importStock', { entries: [{ ingredientId: 'egg', qty: 4 }, { ingredientId: '不存在', qty: 1 }], have: [] })).toThrow();
    expect(k.qty('egg')).toBe(before);
  });
});
