import { z } from 'zod';
import type { Id, KitchenState } from './types';
import { toCanonical } from './units';

/**
 * 库存链接：把一份清点结果放在网址的 # 后面，手机打开后确认一次就入库。
 * # 后面的内容不发给服务器，也不进仓库，所以真实库存仍然只在手机上。
 * 链接本身不写数据，只是打开确认页；写入走 importStock 命令，可以撤销。
 */
export interface StockLink {
  /** 这份清单的编号。同一编号只能导入一次，否则点旧链接会把吃掉的库存加回来。 */
  id: string;
  /** 设成这个总量：「我现在还有 X」。[食材, 数量, 单位]，不写单位时按规范单位。 */
  stock: [Id, number, string?][];
  /** 在现有数量上增减：「又买了 X」「用掉了 X」。负数是减少。 */
  add?: [Id, number, string?][];
  /** 确认有的调料。 */
  have: Id[];
}

const entry = z.union([z.tuple([z.string(), z.number().min(0)]), z.tuple([z.string(), z.number().min(0), z.string()])]);
const delta = z.union([z.tuple([z.string(), z.number()]), z.tuple([z.string(), z.number(), z.string()])]);
const schema = z.object({ id: z.string().min(1).max(40), stock: z.array(entry).max(200), add: z.array(delta).max(200).optional(), have: z.array(z.string()).max(200) }).strict();

export const stockLinkKey = (id: string) => `stockLink:${id}`;

export function encodeStockLink(link: StockLink): string {
  const bytes = new TextEncoder().encode(JSON.stringify(link));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const hasStockLink = (hash: string) => /stock=/.test(hash);

/** 解不开、结构不对都返回 null。 */
export function readStockLink(hash: string): StockLink | null {
  const raw = hash.match(/stock=([\w-]+)/)?.[1];
  if (!raw) return null;
  try {
    const binary = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    const text = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? (parsed.data as StockLink) : null;
  } catch {
    return null;
  }
}

export interface StockPreview {
  entries: { ingredientId: Id; qty: number; unit?: string; add?: true }[];
  have: Id[];
  lines: { name: string; label: string }[];
  haveNames: string[];
  /** 这台手机上对不上的项，跳过并列出来，不让一项拖垮整批。 */
  skipped: string[];
}

export function previewStockLink(state: KitchenState, link: StockLink): StockPreview {
  const out: StockPreview = { entries: [], have: [], lines: [], haveNames: [], skipped: [] };
  const rows = [...link.stock.map((e) => ({ e, add: false })), ...(link.add ?? []).map((e) => ({ e, add: true }))];
  for (const { e: [ingredientId, qty, unit], add } of rows) {
    const ing = state.ingredients.find((i) => i.id === ingredientId);
    if (!ing || ing.unit === 'level' || (unit && !toCanonical(Math.abs(qty), unit, ing))) {
      out.skipped.push(ing?.name ?? ingredientId);
      continue;
    }
    out.entries.push({ ingredientId, qty, ...(unit ? { unit } : {}), ...(add ? { add: true as const } : {}) });
    out.lines.push({ name: ing.name, label: `${add && qty > 0 ? '+' : ''}${qty}${unit ?? (ing.unit === 'count' ? ing.countUnit ?? '' : ing.unit)}` });
  }
  for (const id of link.have) {
    const ing = state.ingredients.find((i) => i.id === id);
    if (ing?.unit !== 'level') {
      out.skipped.push(ing?.name ?? id);
      continue;
    }
    out.have.push(id);
    out.haveNames.push(ing.name);
  }
  return out;
}
