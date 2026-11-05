import { COMMANDS, type CommandName } from './commands';
import type { AuditEvent, KitchenState } from './types';
import { collectWrites, DomainError, nextStateFrom, Tx, type CommandResult, type Ctx, type RunOutcome } from './tx';

function resultFromAudit(a: AuditEvent): CommandResult {
  return {
    operationId: a.id, name: a.name, summary: a.summary, details: a.details, warnings: [], undoable: a.undoable && !a.undoneBy,
    impact: { inventory: false, prepared: false, plan: false, shopping: false }, deduped: true,
  };
}

/**
 * 所有写操作的唯一入口：校验输入 → 在工作副本上执行命令 → 产出待写入的改动。
 * UI 与 AI 都只能走这里。同一 idempotencyKey 第二次进来直接返回第一次的结果。
 */
export function execute(state: KitchenState, ctx: Ctx, name: CommandName, input: unknown, idempotencyKey?: string): RunOutcome {
  const key = idempotencyKey ?? ctx.newId('key');
  const prior = state.audit_events.find((a) => a.idempotencyKey === key);
  if (prior) return { state, result: resultFromAudit(prior), writes: [] };

  const def = COMMANDS[name] as unknown as { schema: { safeParse(v: unknown): { success: boolean; data?: unknown; error?: { message: string } } }; run(tx: Tx, input: unknown): void };
  if (!def) throw new DomainError('UNKNOWN_COMMAND', `未知命令：${String(name)}`);
  const parsed = def.schema.safeParse(input);
  if (!parsed.success) throw new DomainError('INVALID_INPUT', `输入不合法：${parsed.error?.message ?? ''}`);

  const opId = ctx.newId('op');
  const tx = new Tx(state, ctx, opId);
  def.run(tx, parsed.data);

  const changed = tx.mutations.size > 0 || tx.appended.length > 0;
  const audit: AuditEvent | null = changed ? {
    id: opId, name, at: tx.at, idempotencyKey: key, summary: tx.summary, details: [...tx.details],
    mutations: [...tx.mutations.values()], appended: tx.appended.map((a) => ({ table: a.table, id: a.id })),
    undoable: tx.undoable, undoneBy: null, undoOf: null, rev: 0,
  } : null;
  const writes = collectWrites(tx, audit);
  const result: CommandResult = {
    operationId: opId, name, summary: tx.summary, details: tx.details, warnings: tx.warnings,
    undoable: changed && tx.undoable, impact: tx.impact(), data: tx.data,
  };
  return { state: nextStateFrom(state, writes), result, writes };
}

/** 预览 = 真实执行但丢弃结果。因此预览和提交不可能算出不同的东西。 */
export function preview(state: KitchenState, ctx: Ctx, name: CommandName, input: unknown): CommandResult {
  return execute(state, ctx, name, input).result;
}
