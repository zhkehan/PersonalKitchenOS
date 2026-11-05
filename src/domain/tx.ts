import type { AuditEvent, Id, KitchenState, Mutation, Row, TableName } from './types';

export interface Ctx {
  now: Date;
  newId: (prefix: string) => string;
}

/** 规则拒绝操作。code 供 UI/AI 判断，message 是给用户看的中文。 */
export class DomainError extends Error {
  constructor(public code: string, message: string, public options?: { label: string; input: unknown }[]) {
    super(message);
    this.name = 'DomainError';
  }
}

export interface Impact {
  inventory: boolean;
  prepared: boolean;
  plan: boolean;
  shopping: boolean;
}

export interface CommandResult {
  operationId: Id;
  name: string;
  summary: string;
  details: string[];
  warnings: string[];
  undoable: boolean;
  impact: Impact;
  deduped?: boolean;
  data?: unknown;
}

/**
 * 一次命令的工作副本。命令只通过 Tx 读写，从不直接碰数据库：
 * 这样命令是纯函数，「预览」就是执行后丢弃结果，「提交」才把结果写进事务。
 */
export class Tx {
  private draft = new Map<TableName, Map<Id, Row>>();
  private cached: KitchenState | null = null;
  readonly mutations = new Map<string, Mutation>();
  readonly appended: { table: TableName; id: Id; row: Row }[] = [];
  readonly details: string[] = [];
  readonly warnings: string[] = [];
  /** 本次操作对餐次的改动，用于生成最小 diff 和 plan_changes。 */
  readonly planLog: { slotId: Id; phrase: string; before: Row; after: Row }[] = [];
  summary = '';
  undoable = true;
  data: unknown;

  constructor(private base: KitchenState, readonly ctx: Ctx, readonly txId: Id) {}

  private tableMap(name: TableName): Map<Id, Row> {
    let m = this.draft.get(name);
    if (!m) {
      m = new Map((this.base[name] as unknown as Row[]).map((r) => [r.id, r]));
      this.draft.set(name, m);
    }
    return m;
  }

  /** 当前（含本次未提交修改）的状态视图。 */
  get state(): KitchenState {
    if (!this.cached) {
      const next: Record<string, unknown> = { ...this.base };
      for (const [name, m] of this.draft) next[name] = [...m.values()];
      this.cached = next as unknown as KitchenState;
    }
    return this.cached;
  }

  get<T>(table: TableName, id: Id): T | undefined {
    return this.tableMap(table).get(id) as T | undefined;
  }

  /** 写入或更新投影表的一行（库存批次、餐次、熟菜批次等），自动维护 rev。 */
  put<T extends { id: Id; rev?: number }>(table: TableName, row: T): T {
    const m = this.tableMap(table);
    const prev = m.get(row.id) ?? null;
    const next = { ...row, rev: (prev?.rev ?? row.rev ?? 0) + (prev ? 1 : 0) } as unknown as Row;
    m.set(row.id, next);
    this.track(table, row.id, prev, next);
    return next as unknown as T;
  }

  remove(table: TableName, id: Id): void {
    const m = this.tableMap(table);
    const prev = m.get(id) ?? null;
    if (!prev) return;
    m.delete(id);
    this.track(table, id, prev, null);
  }

  /** 追加不可变流水。 */
  append<T extends { id: Id }>(table: TableName, row: T): T {
    const r = row as unknown as Row;
    this.tableMap(table).set(row.id, r);
    this.appended.push({ table, id: row.id, row: r });
    this.cached = null;
    return row;
  }

  private track(table: TableName, id: Id, prev: Row | null, next: Row | null) {
    const key = `${table}/${id}`;
    const existing = this.mutations.get(key);
    if (existing) existing.after = next;
    else this.mutations.set(key, { table, id, before: prev, after: next });
    this.cached = null;
  }

  newId(prefix: string) {
    return this.ctx.newId(prefix);
  }

  get at() {
    return this.ctx.now.toISOString();
  }

  impact(): Impact {
    const touched = new Set<TableName>([...this.mutations.values()].map((m) => m.table));
    this.appended.forEach((a) => touched.add(a.table));
    const inventory = touched.has('inventory_lots') || touched.has('inventory_events');
    const prepared = touched.has('prepared_batches');
    const plan = touched.has('meal_slots');
    return { inventory, prepared, plan, shopping: inventory || prepared || plan };
  }
}

export type CommandFn<I = unknown> = (tx: Tx, input: I) => void;

export interface RunOutcome {
  state: KitchenState;
  result: CommandResult;
  /** 需要写入数据库的改动。 */
  writes: { table: TableName; put: Row[]; del: Id[] }[];
}

export function collectWrites(tx: Tx, audit: AuditEvent | null): RunOutcome['writes'] {
  const byTable = new Map<TableName, { put: Row[]; del: Id[] }>();
  const entry = (t: TableName) => {
    let e = byTable.get(t);
    if (!e) byTable.set(t, (e = { put: [], del: [] }));
    return e;
  };
  for (const m of tx.mutations.values()) {
    if (m.after) entry(m.table).put.push(m.after);
    else entry(m.table).del.push(m.id);
  }
  for (const a of tx.appended) entry(a.table).put.push(a.row);
  if (audit) entry('audit_events').put.push(audit as unknown as Row);
  return [...byTable.entries()].map(([table, e]) => ({ table, ...e }));
}

export function nextStateFrom(base: KitchenState, writes: RunOutcome['writes']): KitchenState {
  const next: Record<string, unknown> = { ...base };
  for (const w of writes) {
    const m = new Map((next[w.table] as Row[]).map((r) => [r.id, r]));
    for (const id of w.del) m.delete(id);
    for (const r of w.put) m.set(r.id, r);
    next[w.table] = [...m.values()];
  }
  return next as unknown as KitchenState;
}

