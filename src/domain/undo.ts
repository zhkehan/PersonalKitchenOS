import type {
  AuditEvent, ConsumptionEvent, InventoryEvent, PreparedPortionEvent, Row, TableName,
} from './types';
import { DomainError, type Tx } from './tx';

/** 这些表的行被撤销时保留并标记状态，留下可追溯的历史。 */
const KEEP_AS_REVERTED: TableName[] = ['inventory_lots', 'prepared_batches', 'cook_sessions'];

/** 比内容而不是 rev：后续操作撤销后行内容回到本操作的结果，本操作仍可撤销。 */
function sameContent(a: Row | null, b: Row | null): boolean {
  const canon = (r: Row | null) => r && JSON.stringify(Object.entries(r).filter(([k]) => k !== 'rev').sort(([x], [y]) => x.localeCompare(y)));
  return canon(a) === canon(b);
}

/**
 * 补偿式撤销：流水表只追加反向记录；投影表恢复到操作前。
 * 如果之后另一个操作也改过同一行，直接恢复会丢掉那次改动，所以拒绝并说明。
 */
export function undoOperation(tx: Tx, operationId: string) {
  const op = tx.get<AuditEvent>('audit_events', operationId);
  if (!op) throw new DomainError('NO_OPERATION', '找不到这次操作');
  if (!op.undoable) throw new DomainError('NOT_UNDOABLE', '这次操作不能撤销');
  if (op.undoneBy) throw new DomainError('ALREADY_UNDONE', '这次操作已经撤销过了');

  for (const m of op.mutations) {
    if (m.table === 'audit_events') continue;
    const cur = tx.get<Row>(m.table, m.id) ?? null;
    if (!sameContent(cur, m.after)) {
      const later = tx.state.audit_events
        .filter((a) => a.at >= op.at && a.id !== op.id && !a.undoneBy && a.mutations.some((x) => x.table === m.table && x.id === m.id))
        .sort((a, b) => b.at.localeCompare(a.at))[0];
      throw new DomainError('UNDO_CONFLICT', later
        ? `不能撤销：之后的「${later.summary}」也改过这里，请先撤销它。`
        : '不能撤销：相关记录之后又被修改过。');
    }
  }

  for (const a of op.appended) {
    if (a.table === 'inventory_events') {
      const e = tx.get<InventoryEvent>(a.table, a.id)!;
      tx.append<InventoryEvent>('inventory_events', {
        ...e, id: tx.newId('ie'), txId: tx.txId, type: 'reversal', qtyDelta: e.qtyDelta === null ? null : -e.qtyDelta, at: tx.at,
        note: '撤销', reverses: e.id,
      });
    } else if (a.table === 'prepared_portion_events') {
      const e = tx.get<PreparedPortionEvent>(a.table, a.id)!;
      tx.append<PreparedPortionEvent>('prepared_portion_events', {
        ...e, id: tx.newId('ppe'), txId: tx.txId, type: 'reversal', portionsDelta: -e.portionsDelta, at: tx.at, reverses: e.id,
      });
    } else if (a.table === 'consumption_events') {
      const e = tx.get<ConsumptionEvent>(a.table, a.id)!;
      tx.append<ConsumptionEvent>('consumption_events', {
        ...e, id: tx.newId('ce'), txId: tx.txId, at: tx.at, kind: 'reversal', portions: -e.portions, reverses: e.id,
      });
    }
  }

  for (const m of op.mutations) {
    if (m.table === 'audit_events') continue;
    const cur = tx.get<Row>(m.table, m.id);
    if (m.before) {
      tx.put(m.table, { ...m.before, rev: cur?.rev ?? (m.before.rev as number) ?? 0 } as Row);
    } else if (cur) {
      if (KEEP_AS_REVERTED.includes(m.table)) {
        const patch: Row = { ...cur, status: 'reverted' };
        if (m.table === 'inventory_lots') patch.qty = 0;
        if (m.table === 'prepared_batches') patch.portionsRemaining = 0;
        tx.put(m.table, patch);
      } else {
        tx.remove(m.table, m.id);
      }
    }
  }

  tx.put<AuditEvent>('audit_events', { ...op, undoneBy: tx.txId });
  tx.summary = `已撤销：${op.summary}`;
  tx.undoable = false;
  tx.data = { undoOf: op.id };
}
