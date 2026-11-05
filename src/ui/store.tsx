import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { commit, ensureSeeded, KitchenDB, loadState, newId } from '../data/db';
import type { CommandName } from '../domain/commands';
import type { CommandResult } from '../domain/tx';
import { DomainError } from '../domain/tx';
import type { KitchenState } from '../domain/types';

export interface Toast {
  id: number;
  text: string;
  lines: string[];
  warnings: string[];
  undoId: string | null;
  error: boolean;
}

export interface RunOptions {
  key?: string;
  /** 不弹提示（筛选条件这类轻操作）。 */
  silent?: boolean;
}

interface KitchenApi {
  db: KitchenDB;
  state: KitchenState;
  now: () => Date;
  run: (name: CommandName, input: unknown, opts?: RunOptions) => Promise<CommandResult | null>;
  refresh: () => Promise<void>;
  toast: Toast | null;
  showToast: (t: Partial<Toast> & { text: string }) => void;
  dismissToast: () => void;
  undo: (operationId: string) => Promise<void>;
}

const Ctx = createContext<KitchenApi | null>(null);
export const useKitchen = () => {
  const api = useContext(Ctx);
  if (!api) throw new Error('KitchenProvider missing');
  return api;
};

export function KitchenProvider({ children }: { children: ReactNode }) {
  const dbRef = useRef<KitchenDB | null>(null);
  dbRef.current ??= new KitchenDB();
  const db = dbRef.current;
  const [state, setState] = useState<KitchenState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastSeq = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  /** 同一按钮 1.5 秒内的重复触发共用幂等键，由领域层去重。 */
  const recent = useRef(new Map<string, { key: string; at: number }>());

  const now = useCallback(() => new Date(), []);

  const refresh = useCallback(async () => {
    setState(await loadState(db));
  }, [db]);

  const showToast = useCallback((t: Partial<Toast> & { text: string }) => {
    const id = ++toastSeq.current;
    setToast({ lines: [], warnings: [], undoId: null, error: false, ...t, id });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast((c) => (c?.id === id ? null : c)), t.undoId || t.warnings?.length ? 9000 : 5000);
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  const run = useCallback(async (name: CommandName, input: unknown, opts: RunOptions = {}) => {
    const signature = `${name}:${JSON.stringify(input)}`;
    const t = Date.now();
    const seen = recent.current.get(signature);
    const key = opts.key ?? (seen && t - seen.at < 1500 ? seen.key : newId('key'));
    recent.current.set(signature, { key, at: t });
    try {
      const result = await commit(db, new Date(), name, input, key);
      await refresh();
      if (!opts.silent && !result.deduped) {
        showToast({ text: result.summary, lines: result.details.slice(0, 3), warnings: result.warnings, undoId: result.undoable ? result.operationId : null });
      }
      return result;
    } catch (e) {
      const message = e instanceof DomainError ? e.message : `操作没有完成，数据没有变化。${e instanceof Error ? e.message : ''}`;
      showToast({ text: message, error: true });
      return null;
    }
  }, [db, refresh, showToast]);

  const undo = useCallback(async (operationId: string) => {
    await run('undoTransaction', { operationId });
  }, [run]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await ensureSeeded(db);
        await commit(db, new Date(), 'syncCatalog', {});
        await commit(db, new Date(), 'syncPlan', {});
        if (alive) await refresh();
      } catch (e) {
        if (alive) setFailure(e instanceof Error ? e.message : '数据库打开失败');
      }
    })();
    // 回到前台时跨日、其他标签页的改动都重新读取；计划也顺延。
    const onVisible = () => {
      if (document.visibilityState === 'visible') commit(db, new Date(), 'syncPlan', {}).then(refresh).catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; document.removeEventListener('visibilitychange', onVisible); };
  }, [db, refresh]);

  const api = useMemo(() => (state ? { db, state, now, run, refresh, toast, showToast, dismissToast, undo } : null), [db, state, now, run, refresh, toast, showToast, dismissToast, undo]);

  if (failure) return <div className="boot">打不开本地数据库：{failure}<br />这个浏览器可能禁用了 IndexedDB（例如私密窗口）。</div>;
  if (!api) return <div className="boot">正在打开厨房…</div>;
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
