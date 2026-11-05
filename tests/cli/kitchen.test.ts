import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../../src/cli/kitchen';
import { confirmedRecipes, readiness } from '../../src/cli/report';
import { dataFile, loadState, openState, saveState } from '../../src/cli/store';

const NOON = new Date('2026-11-04T20:00:00Z');
const NEXT_DAY = new Date('2026-11-05T20:00:00Z');
const TODAY = '2026-11-04';
let dir: string;

const sh = (...args: string[]) => main(args, NOON);
const opId = (out: string) => /操作 id：(\S+)/.exec(out)![1];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kitchen-'));
  process.env.KITCHEN_DATA = join(dir, 'kitchen.json');
});

afterEach(() => {
  delete process.env.KITCHEN_DATA;
  rmSync(dir, { recursive: true, force: true });
});

describe('数据文件', () => {
  it('没有文件时提示先 init，不偷偷新建', () => {
    expect(() => sh('today')).toThrow('init');
    expect(existsSync(dataFile())).toBe(false);
  });

  it('init 绝不覆盖已有数据', () => {
    sh('init');
    sh('run', 'adjustInventory', '{"ingredientId":"egg","qty":4}');
    expect(() => sh('init')).toThrow('不会覆盖');
    expect(sh('stock', '鸡蛋')).toContain('4颗');
  });

  it('init 可以带清单，单位和调料都写好', () => {
    const list = join(dir, 'list.json');
    writeFileSync(list, JSON.stringify({ stock: [['ground_beef', 7, 'lb'], ['egg', 4]], have: ['cumin'] }));
    expect(sh('init', list)).toContain('已导入 2 项库存、1 种调料');
    expect(sh('stock')).toContain('3.175kg');
    expect(sh('stock')).toContain('孜然粉');
  });

  it('坏文件和负库存直接报错，不当成空数据', () => {
    sh('init');
    writeFileSync(dataFile(), '{"version":1,"state":{}}');
    expect(() => loadState()).toThrow('缺少表');
    expect(() => sh('run', 'adjustInventory', '{"ingredientId":"egg","qty":4}')).toThrow();
    expect(readFileSync(dataFile(), 'utf8')).toBe('{"version":1,"state":{}}');
  });

  it('负库存的文件拒绝读取', () => {
    sh('init');
    sh('run', 'adjustInventory', '{"ingredientId":"egg","qty":4}');
    const f = JSON.parse(readFileSync(dataFile(), 'utf8'));
    f.state.inventory_lots[0].qty = -1;
    writeFileSync(dataFile(), JSON.stringify(f));
    expect(() => loadState()).toThrow('负库存');
  });

  it('版本不对时拒绝读取', () => {
    sh('init');
    const f = JSON.parse(readFileSync(dataFile(), 'utf8'));
    writeFileSync(dataFile(), JSON.stringify({ ...f, version: 2 }));
    expect(() => loadState()).toThrow('版本');
  });

  it('写入不留临时文件；每天第一次写入前留备份，同一天不重复', () => {
    sh('init');
    const before = readFileSync(dataFile(), 'utf8');
    sh('run', 'adjustInventory', '{"ingredientId":"egg","qty":4}');
    sh('run', 'adjustInventory', '{"ingredientId":"egg","qty":3}');
    expect(readdirSync(dir).sort()).toEqual(['backups', 'kitchen.json']);
    expect(readdirSync(join(dir, 'backups'))).toEqual([`kitchen-${TODAY}.json`]);
    expect(readFileSync(join(dir, 'backups', `kitchen-${TODAY}.json`), 'utf8')).toBe(before);
    saveState(loadState(), NEXT_DAY);
    expect(readdirSync(join(dir, 'backups'))).toHaveLength(2);
  });

  it('只查询不写文件', () => {
    sh('init');
    const before = readFileSync(dataFile(), 'utf8');
    // 时间往后走一点：如果偷偷写了文件，savedAt 会变。
    const later = new Date(NOON.getTime() + 60_000);
    for (const q of ['today', 'stock', 'recipes', 'plan', 'shop', 'intake', 'log']) main([q], later);
    main(['recipe', '黑椒蘑菇鸡丁'], later);
    expect(readFileSync(dataFile(), 'utf8')).toBe(before);
  });

  it('隔天打开时计划顺延并保存', () => {
    sh('init');
    const last = () => loadState().meal_slots.map((s) => s.date).sort().at(-1)!;
    const before = last();
    openState(NEXT_DAY);
    expect(last() > before).toBe(true);
  });
});

describe('修改', () => {
  beforeEach(() => { sh('init'); });

  it('预览不写入，算出的结果和真的执行一样', () => {
    const input = '{"ingredientId":"egg","qty":4}';
    const before = readFileSync(dataFile(), 'utf8');
    expect(sh('preview', 'adjustInventory', input)).toContain('鸡蛋校准为 4颗');
    expect(readFileSync(dataFile(), 'utf8')).toBe(before);
    expect(sh('run', 'adjustInventory', input)).toContain('鸡蛋校准为 4颗');
  });

  it('规则拒绝时报中文原因，数据不变', () => {
    const before = readFileSync(dataFile(), 'utf8');
    expect(() => sh('run', 'consumePreparedPortion', '{"batchId":"没有","portions":1}')).toThrow();
    expect(() => sh('run', '不存在的命令', '{}')).toThrow('未知命令');
    expect(() => sh('run', 'adjustInventory', '{"qty":1}')).toThrow('输入不合法');
    expect(readFileSync(dataFile(), 'utf8')).toBe(before);
  });

  it('同一个键只执行一次', () => {
    sh('run', 'importStock', '{"entries":[{"ingredientId":"egg","qty":2,"add":true}],"have":[]}', '--key', 'k1');
    expect(sh('run', 'importStock', '{"entries":[{"ingredientId":"egg","qty":2,"add":true}],"have":[]}', '--key', 'k1')).toContain('已经执行过');
    expect(sh('stock', '鸡蛋')).toContain('2颗');
  });

  it('撤销', () => {
    const op = opId(sh('run', 'adjustInventory', '{"ingredientId":"egg","qty":4}'));
    sh('undo', op);
    expect(sh('stock', '鸡蛋')).not.toContain('4颗');
    expect(sh('log')).toContain('已撤销');
  });

  it('做饭、吃掉、营养一条路走通', () => {
    sh('run', 'adjustInventory', '{"ingredientId":"chicken_breast","qty":3,"unit":"lb"}');
    sh('run', 'finishCook', JSON.stringify({ recipeId: 'R01', servings: 2, eatNow: 1, date: TODAY, slot: 'lunch' }));
    expect(sh('intake', '1')).toContain('黑椒蘑菇鸡丁');
    expect(sh('stock')).toContain('熟菜');
    expect(sh('today')).toContain('今天吃的');
  });
});

describe('推荐不能把没确认的东西说成有', () => {
  beforeEach(() => { sh('init'); });

  it('没录过的主料算未确认：只有牛肉碎时番茄意面不算能做', () => {
    sh('run', 'adjustInventory', '{"ingredientId":"ground_beef","qty":3,"unit":"lb"}');
    const state = loadState();
    const pasta = state.recipes.find((r) => r.id === 'R04')!;
    expect(readiness(state, pasta, TODAY).missing).toEqual(expect.arrayContaining(['番茄罐头（待核对）', '意面（待核对）']));
    expect(confirmedRecipes(state, TODAY).map((r) => r.recipe.id)).not.toContain('R04');
  });

  it('主料都有才算能做，调料待核对单独列出，不挡菜', () => {
    sh('run', 'adjustInventory', '{"ingredientId":"frozen_fish","qty":2,"unit":"lb"}');
    const state = loadState();
    const fish = confirmedRecipes(state, TODAY).find((r) => r.recipe.id === 'V09');
    expect(fish?.seasonings).toContain('黑胡椒');
    expect(fish?.frozen).toContain('冷冻鱼片');
  });

  it('today 的首选带未确认标记', () => {
    expect(sh('today')).toContain('主料未确认');
    expect(sh('today')).toContain('主料都确认有的菜（0 道）');
  });
});
