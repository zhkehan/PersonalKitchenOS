import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommandName } from '../domain/commands';
import { localDate } from '../domain/dates';
import { execute } from '../domain/engine';
import { seedState } from '../domain/seed';
import type { CommandResult, Ctx } from '../domain/tx';
import { TABLES, type KitchenState } from '../domain/types';

/**
 * 全部真实数据都在 data/kitchen.json 一个文件里。data/ 不进 git。
 * 每次写入先写临时文件再改名，中途失败不会留下半个文件。
 * 每天第一次写入前留一份旧文件到 data/backups/。
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FILE_VERSION = 2;
/** 1 → 2：熟菜批次多了可选的 oilGrams，没有就按默认用油算，旧文件不用改内容。 */
const READABLE_VERSIONS = [1, FILE_VERSION];

export const dataFile = () => process.env.KITCHEN_DATA ?? join(ROOT, 'data', 'kitchen.json');
const newId = (prefix: string) => `${prefix}_${randomUUID()}`;
export const makeCtx = (now: Date): Ctx => ({ now, newId });

interface KitchenFile {
  version: number;
  savedAt: string;
  state: KitchenState;
}

export function loadState(): KitchenState {
  const path = dataFile();
  if (!existsSync(path)) throw new Error(`没有数据文件：${path}。第一次用先运行 init。`);
  const file = JSON.parse(readFileSync(path, 'utf8')) as KitchenFile;
  if (!READABLE_VERSIONS.includes(file.version)) throw new Error(`数据文件版本是 ${file.version}，程序只认 ${FILE_VERSION}`);
  for (const t of TABLES) {
    if (!Array.isArray(file.state?.[t])) throw new Error(`数据文件缺少表 ${t}`);
  }
  if (file.state.inventory_lots.some((l) => l.qty !== null && l.qty < 0)) throw new Error('数据文件里有负库存');
  return file.state;
}

export function saveState(state: KitchenState, now: Date) {
  const path = dataFile();
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    const dir = join(dirname(path), 'backups');
    mkdirSync(dir, { recursive: true });
    const backup = join(dir, `kitchen-${localDate(now)}.json`);
    if (!existsSync(backup)) copyFileSync(path, backup);
  }
  const file: KitchenFile = { version: FILE_VERSION, savedAt: now.toISOString(), state };
  const temp = `${path}.tmp`;
  writeFileSync(temp, JSON.stringify(file, null, 1));
  renameSync(temp, path);
}

/** 已有数据时拒绝，绝不用空数据覆盖。 */
export function initState(now: Date): KitchenState {
  if (existsSync(dataFile())) throw new Error(`数据文件已存在，不会覆盖：${dataFile()}`);
  const { state } = execute(seedState(), makeCtx(now), 'syncPlan', {});
  saveState(state, now);
  return state;
}

export interface Applied {
  state: KitchenState;
  result: CommandResult;
}

/** 走领域层的唯一写入口。没有改动时不写文件。 */
export function applyCommand(state: KitchenState, now: Date, name: CommandName, input: unknown, key?: string): Applied {
  const out = execute(state, makeCtx(now), name, input, key);
  if (out.writes.length > 0) saveState(out.state, now);
  return { state: out.state, result: out.result };
}

/** 打开时补上新目录、把计划顺延到今天。 */
export function openState(now: Date): KitchenState {
  const loaded = loadState();
  const synced = applyCommand(loaded, now, 'syncCatalog', {}).state;
  return applyCommand(synced, now, 'syncPlan', {}).state;
}
