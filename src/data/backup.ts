import { TABLES, type InventoryLot, type KitchenState, type Row, type TableName } from '../domain/types';
import { localDate } from '../domain/dates';
import { type KitchenDB, loadState, newId, SCHEMA_VERSION } from './db';

export const BACKUP_FORMAT = 'personal-kitchen-os-backup';

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  timezone: string;
  checksum: string;
  counts: Record<string, number>;
  tables: Record<string, Row[]>;
}

export type Migration = (b: BackupFile) => BackupFile;

/** 备份升级链：key 是源版本。当前只有 v1，以后改表结构时在这里加。 */
export const MIGRATIONS: Record<number, Migration> = {};

function fnv1a(text: string): string {
  // 两轮 FNV-1a。这只是防损坏和误改的校验，不是安全签名。
  let a = 0x811c9dc5, b = 0x1000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ (c + i), 0x01000193);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

const checksumOf = (tables: Record<string, Row[]>) => fnv1a(JSON.stringify(TABLES.map((t) => tables[t] ?? [])));

export function toBackup(state: KitchenState, now: Date): BackupFile {
  const tables = Object.fromEntries(TABLES.map((t) => [t, state[t] as unknown as Row[]]));
  return {
    format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString(), timezone: 'America/Los_Angeles',
    checksum: checksumOf(tables), counts: Object.fromEntries(TABLES.map((t) => [t, tables[t].length])), tables,
  };
}

/** 导出完整快照 + 流水。AI 密钥和配对口令存在 localStorage，不在数据库里，所以不会进入备份。 */
export async function exportBackup(db: KitchenDB, now: Date): Promise<BackupFile> {
  await db.store('backup_metadata').put({ id: newId('bk'), at: now.toISOString(), schemaVersion: SCHEMA_VERSION, kind: 'export' });
  return toBackup(await loadState(db), now);
}

export class BackupError extends Error {}

export function validateBackup(raw: unknown, migrations: Record<number, Migration> = MIGRATIONS, target = SCHEMA_VERSION): BackupFile {
  if (typeof raw !== 'object' || raw === null) throw new BackupError('不是备份文件');
  let b = raw as BackupFile;
  if (b.format !== BACKUP_FORMAT) throw new BackupError('不是 Personal Kitchen OS 的备份文件');
  if (typeof b.schemaVersion !== 'number') throw new BackupError('备份缺少版本号');
  if (b.schemaVersion > target) throw new BackupError(`备份来自更新的版本（v${b.schemaVersion}），请先更新 App`);
  if (checksumOf(b.tables ?? {}) !== b.checksum) throw new BackupError('校验失败：文件已损坏或被改动');

  while (b.schemaVersion < target) {
    const m = migrations[b.schemaVersion];
    if (!m) throw new BackupError(`缺少 v${b.schemaVersion} 的升级步骤`);
    const next = m(b);
    b = { ...next, schemaVersion: b.schemaVersion + 1 };
  }

  for (const t of TABLES) {
    const rows = b.tables?.[t];
    if (!Array.isArray(rows)) throw new BackupError(`备份缺少表 ${t}`);
    const seen = new Set<string>();
    for (const r of rows) {
      if (!r || typeof r.id !== 'string') throw new BackupError(`表 ${t} 有无效记录`);
      if (seen.has(r.id)) throw new BackupError(`表 ${t} 有重复记录 ${r.id}`);
      seen.add(r.id);
    }
  }
  const negative = (b.tables.inventory_lots as unknown as InventoryLot[]).find((l) => l.qty !== null && l.qty < 0);
  if (negative) throw new BackupError('备份里有负库存，已拒绝导入');
  return b;
}

/** 整库替换。先完成校验再动数据；写入在一个事务内，失败时原数据不变。 */
export async function restoreBackup(db: KitchenDB, raw: unknown, now: Date): Promise<void> {
  const b = validateBackup(raw);
  await db.transaction('rw', db.tables, async () => {
    for (const t of TABLES) {
      await db.store(t).clear();
      if (b.tables[t].length) await db.store(t).bulkPut(b.tables[t]);
    }
    await db.store('backup_metadata').put({ id: newId('bk'), at: now.toISOString(), schemaVersion: SCHEMA_VERSION, kind: 'restore' });
  });
}

const CSV_SAFE = /^[=+\-@\t\r]/;
function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  // 文本以公式字符开头时加前缀，防止表格软件把它当公式执行；数字不处理。
  if (typeof v === 'string' && CSV_SAFE.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(header: string[], rows: unknown[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

export function inventoryCsv(state: KitchenState): string {
  const name = (id: string) => state.ingredients.find((i) => i.id === id)?.name ?? id;
  return csv(['食材', '数量', '单位', '位置', '购入日', '建议使用日', '日期来源', '置信度', '状态'],
    state.inventory_lots.map((l) => [name(l.ingredientId), l.qty ?? l.rawLabel ?? '未知', l.unit, l.location, l.purchasedAt, l.useBy, l.useBySource, l.confidence, l.status]));
}

export function eventsCsv(state: KitchenState): string {
  const name = (id: string) => state.ingredients.find((i) => i.id === id)?.name ?? id;
  return csv(['时间', '食材', '类型', '变化量', '单位', '备注', '事务'],
    state.inventory_events.map((e) => [e.at, name(e.ingredientId), e.type, e.qtyDelta, e.unit, e.note, e.txId]));
}

export function consumptionCsv(state: KitchenState): string {
  return csv(['日期', '餐次', '类型', '内容', '份数', '时间'],
    state.consumption_events.map((c) => [c.date, c.slot, c.kind, c.label, c.portions, c.at]));
}

export const backupFilename = (now: Date) => `kitchen-backup-${localDate(now)}.json`;
export const tableNames: TableName[] = TABLES;
