import type { CommandName } from '../../src/domain/commands';
import { execute } from '../../src/domain/engine';
import { seedState } from '../../src/domain/seed';
import type { KitchenState } from '../../src/domain/types';
import type { CommandResult, Ctx } from '../../src/domain/tx';

/** 2026-11-04 周三 12:00 PST。 */
export const NOON = new Date('2026-11-04T20:00:00Z');
export const EVENING = new Date('2026-11-05T02:00:00Z'); // 11-04 18:00 PST
export const TODAY = '2026-11-04';

export class Kitchen {
  state: KitchenState;
  last!: CommandResult;
  private seq = 0;
  now: Date;

  constructor(now: Date = NOON, state?: KitchenState) {
    this.now = now;
    this.state = state ?? seedState();
    this.run('syncPlan', {});
  }

  ctx(): Ctx {
    return { now: this.now, newId: (p) => `${p}_${++this.seq}` };
  }

  run(name: CommandName, input: unknown, key?: string): CommandResult {
    const out = execute(this.state, this.ctx(), name, input, key);
    this.state = out.state;
    this.last = out.result;
    return out.result;
  }

  buy(lines: Record<string, number | [number, string, string?]>) {
    return this.run('confirmPurchase', {
      lines: Object.entries(lines).map(([ingredientId, v]) => {
        const [qty, unit, location] = Array.isArray(v) ? v : [v, undefined, undefined];
        return { ingredientId, bought: true, qty, ...(unit ? { unit } : {}), ...(location ? { location } : {}) };
      }),
    });
  }

  slot(id: string) {
    return this.state.meal_slots.find((s) => s.id === id)!;
  }

  qty(ingredientId: string) {
    return this.state.inventory_lots
      .filter((l) => l.ingredientId === ingredientId && l.status === 'active')
      .reduce((n, l) => n + (l.qty ?? 0), 0);
  }

  portions() {
    return this.state.prepared_batches.filter((b) => b.status === 'active').reduce((n, b) => n + b.portionsRemaining, 0);
  }

  /** 把今天指定一餐的计划菜设成某道菜（模拟固定场景）。 */
  planToday(recipeId: string) {
    this.run('swapRecipe', { date: TODAY, recipeId });
  }

  /** 每个活跃批次的数量必须等于它全部流水之和。 */
  assertLedger() {
    for (const lot of this.state.inventory_lots) {
      if (lot.qty === null) continue;
      const events = this.state.inventory_events.filter((e) => e.lotId === lot.id && e.qtyDelta !== null);
      const sum = Math.round(events.reduce((n, e) => n + e.qtyDelta!, 0) * 10) / 10;
      if (sum !== lot.qty) throw new Error(`批次 ${lot.id} 数量 ${lot.qty} ≠ 流水和 ${sum}`);
      if (lot.qty < 0) throw new Error(`批次 ${lot.id} 为负`);
    }
    for (const b of this.state.prepared_batches) {
      const sum = this.state.prepared_portion_events.filter((e) => e.batchId === b.id).reduce((n, e) => n + e.portionsDelta, 0);
      if (sum !== b.portionsRemaining) throw new Error(`熟菜 ${b.id} 份数 ${b.portionsRemaining} ≠ 流水和 ${sum}`);
    }
  }
}
