import Dexie, { type Table } from 'dexie';
import type { CommandName } from '../domain/commands';
import { execute } from '../domain/engine';
import { seedState } from '../domain/seed';
import type { Ctx, CommandResult } from '../domain/tx';
import { TABLES, type KitchenState, type Row, type TableName } from '../domain/types';

/** IndexedDB schema 版本。改表结构时增加版本并在 migrations 里写升级。 */
export const SCHEMA_VERSION = 1;

const INDEXES: Partial<Record<TableName, string>> = {
  ingredients: 'id,category',
  products: 'id,ingredientId',
  inventory_lots: 'id,ingredientId,status',
  inventory_events: 'id,txId,lotId,at',
  recipes: 'id,tier',
  recipe_variants: 'id,recipeId',
  recipe_ingredients: 'id,recipeId',
  recipe_steps: 'id,variantId',
  meal_slots: 'id,date',
  meal_plan_versions: 'id,txId',
  plan_changes: 'id,versionId',
  cook_sessions: 'id,status',
  cook_session_ingredients: 'id,sessionId',
  prepared_batches: 'id,status',
  prepared_portion_events: 'id,batchId,txId',
  consumption_events: 'id,date,txId',
  shopping_lists: 'id,status',
  shopping_items: 'id,listId',
  purchase_confirmations: 'id,listId',
  schedule_constraints: 'id,date',
  audit_events: 'id,idempotencyKey,at',
};

export class KitchenDB extends Dexie {
  constructor(name = 'personal-kitchen-os') {
    super(name);
    this.version(SCHEMA_VERSION).stores(Object.fromEntries(TABLES.map((t) => [t, INDEXES[t] ?? 'id'])));
  }

  store(name: TableName): Table<Row, string> {
    return this.table(name);
  }
}

export async function loadState(db: KitchenDB): Promise<KitchenState> {
  const entries = await Promise.all(TABLES.map(async (t) => [t, await db.store(t).toArray()] as const));
  return Object.fromEntries(entries) as unknown as KitchenState;
}

/** 首次打开写入目录和菜谱。绝不写入任何库存批次。 */
export async function ensureSeeded(db: KitchenDB): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    if ((await db.store('ingredients').count()) > 0) return;
    const seed = seedState();
    for (const t of TABLES) {
      const rows = seed[t] as unknown as Row[];
      if (rows.length) await db.store(t).bulkPut(rows);
    }
  });
}

/** crypto.randomUUID 只在安全上下文可用；局域网 HTTP 下退回 getRandomValues。 */
export function newId(prefix: string): string {
  const c = globalThis.crypto;
  const body = typeof c?.randomUUID === 'function'
    ? c.randomUUID()
    : Array.from(c.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${body}`;
}

export const makeCtx = (now: Date): Ctx => ({ now, newId });

/**
 * 在一个 IndexedDB 读写事务里：读当前状态 → 执行纯命令 → 写回全部改动。
 * 命令抛错或写入失败时整个事务回滚，不会出现「肉扣了但熟菜没增加」。
 * 幂等键检查也在事务内，所以两次连点串行执行，第二次直接返回第一次的结果。
 */
export async function commit(db: KitchenDB, now: Date, name: CommandName, input: unknown, idempotencyKey?: string): Promise<CommandResult> {
  return db.transaction('rw', db.tables, async () => {
    const state = await loadState(db);
    const out = execute(state, makeCtx(now), name, input, idempotencyKey);
    for (const w of out.writes) {
      if (w.del.length) await db.store(w.table).bulkDelete(w.del);
      if (w.put.length) await db.store(w.table).bulkPut(w.put);
    }
    return out.result;
  });
}
