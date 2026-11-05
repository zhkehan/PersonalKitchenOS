import { useState } from 'react';
import { addDays, friendlyDate, localDate } from '../domain/dates';
import { rotationHint, slotLabel, SLOT_LABEL } from '../domain/planner';
import type { MealSlot } from '../domain/types';
import type { Nav } from './App';
import { Screen, Sheet } from './components';
import { useKitchen } from './store';

const STATUS_TEXT: Record<string, string> = { eaten: '吃过了', eating_out: '外食', skipped: '不吃', preparing: '正在做' };

export function Plan({ onClose, nav }: { onClose: () => void; nav: Nav }) {
  const { state, now, run } = useKitchen();
  const [editing, setEditing] = useState<MealSlot | null>(null);
  const [picking, setPicking] = useState(false);
  const today = localDate(now());
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const hint = rotationHint(state, now());

  const describe = (s: MealSlot) => {
    const name = state.recipes.find((r) => r.id === s.recipeId)?.name;
    if (s.status !== 'planned') return STATUS_TEXT[s.status] ?? '';
    if (s.role === 'leftover') return `吃剩菜：${state.prepared_batches.find((b) => b.id === s.batchId)?.name ?? name}`;
    if (!name) return '待定，看推荐';
    if (s.role === 'cook') return `${name} · 做 ${s.cookServings} 份`;
    return `${name} · 吃同一锅`;
  };

  const close = () => { setEditing(null); setPicking(false); };
  const act = async (name: Parameters<typeof run>[0], input: unknown) => { close(); await run(name, input); };

  return (
    <Screen title="14 天计划" onBack={onClose}>
      {hint && (
        <div className="reminder">
          <span>{hint.text}</span>
          <button onClick={() => run('swapRecipe', { date: hint.date, recipeId: hint.recipeId })}>改过去</button>
        </div>
      )}
      <ul className="plan">
        {days.map((d) => (
          <li key={d}>
            <div className="plan-date">{friendlyDate(d, today)}</div>
            {(['lunch', 'dinner'] as const).map((k) => {
              const s = state.meal_slots.find((x) => x.id === `${d}:${k}`);
              if (!s) return null;
              return (
                <button key={k} className={`plan-slot status-${s.status}`} onClick={() => setEditing(s)}>
                  <span className="plan-kind">{SLOT_LABEL[k]}{s.locked ? ' 🔒' : ''}</span>
                  <span>{describe(s)}</span>
                </button>
              );
            })}
          </li>
        ))}
      </ul>

      {editing && !picking && (
        <Sheet title={slotLabel(editing, today)} onClose={close}>
          <p className="meta">{describe(editing)}</p>
          <div className="stack">
            {editing.status === 'planned' && (
              <>
                <button className="btn btn-wide" onClick={() => act('setMealStatus', { date: editing.date, slot: editing.slot, status: 'eating_out' })}>这顿外食</button>
                <button className="btn btn-wide" onClick={() => act('setMealStatus', { date: editing.date, slot: editing.slot, status: 'skipped' })}>这顿不吃</button>
                <button className="btn btn-wide" onClick={() => setPicking(true)}>换一道菜</button>
                <button className="btn btn-wide" onClick={() => act('lockSlot', { date: editing.date, slot: editing.slot, locked: !editing.locked })}>{editing.locked ? '解除锁定' : '锁定（重排时不动）'}</button>
              </>
            )}
            {(editing.status === 'eating_out' || editing.status === 'skipped') && (
              <button className="btn btn-wide" onClick={() => act('restoreMeal', { date: editing.date, slot: editing.slot })}>恢复在家吃</button>
            )}
            {editing.status === 'eaten' && <p className="hint">已经吃过的记录不能在这里改。到首页「记错了？」修正。</p>}
          </div>
        </Sheet>
      )}

      {editing && picking && (
        <Sheet title="换成哪道？" onClose={close}>
          <div className="stack">
            {state.recipes.filter((r) => r.enabled && r.tier !== 'snack').sort((a, b) => a.id.localeCompare(b.id)).map((r) => (
              <button key={r.id} className="btn btn-wide" onClick={() => act('swapRecipe', { date: editing.date, slot: editing.slot, recipeId: r.id })}>{r.name}</button>
            ))}
          </div>
        </Sheet>
      )}
      <button className="link" onClick={() => { onClose(); nav.tab('shopping'); }}>看采购清单</button>
    </Screen>
  );
}
