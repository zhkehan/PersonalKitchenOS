import { useMemo, useState } from 'react';
import { friendlyDate, localDate } from '../domain/dates';
import { recommendSnack, recommendToday, reminderFor, constraintFor, type Pick, type RecipePick } from '../domain/recommend';
import type { Nav } from './App';
import { Assistant } from './Assistant';
import { Sheet } from './components';
import { useKitchen } from './store';

const EQUIP: Record<string, string> = { pan: '炒锅', airfryer: '空气炸锅', pot: '小锅', steamer: '蒸锅', oven: '烤箱' };

export function Home({ nav }: { nav: Nav }) {
  const { state, now, run } = useKitchen();
  const [skip, setSkip] = useState<string[]>([]);
  const [sheet, setSheet] = useState<'out' | 'snack' | 'fix' | 'more' | null>(null);
  const today = localDate(now());
  const rec = useMemo(() => recommendToday(state, now(), { skip }), [state, now, skip]);
  const reminder = useMemo(() => reminderFor(state, now()), [state, now]);
  const c = constraintFor(state, today);
  const { meal, primary, alternates } = rec;
  const noStock = state.inventory_lots.length === 0;

  const swap = () => {
    if (!primary) return;
    const id = primary.kind === 'recipe' ? primary.recipe.id : primary.batch.id;
    setSkip((s) => (alternates.length === 0 ? [] : [...s, id]));
  };

  const start = (p: RecipePick) => nav.cook({
    recipeId: p.recipe.id, variantId: p.variant.id, servings: p.servings,
    ...(meal.slot !== 'snack' ? { date: meal.date, slot: meal.slot } : {}),
  });

  const eatLeftover = (batchId: string) => run('consumePreparedPortion', { batchId, portions: 1, date: meal.date, slot: meal.slot });
  const setFilter = (patch: Record<string, unknown>) => { setSkip([]); void run('setConstraint', { date: today, ...patch }, { silent: true }); };

  return (
    <div className="page home">
      <header className="home-head">
        <h1>今天吃什么？</h1>
        <button className="icon-btn" aria-label="更多设置" onClick={nav.settings}>⋯</button>
      </header>

      {primary ? <PrimaryCard pick={primary} mealLabel={meal.label} onStart={start} onEat={eatLeftover} onSwap={swap} canSwap={alternates.length > 0} />
        : <div className="card"><p>{rec.note}</p></div>}
      {rec.note && primary && <p className="note">{rec.note}</p>}

      <button className="btn btn-ghost btn-wide" onClick={() => setSheet('out')}>今天外食 / 只吃一顿</button>

      {alternates.length > 0 && (
        <section aria-label="备选">
          <div className="alts">
            {alternates.map((a) => (
              <button key={a.kind === 'recipe' ? a.recipe.id : a.batch.id} className="alt" onClick={() => (a.kind === 'recipe' ? start(a) : eatLeftover(a.batch.id))}>
                <span className="alt-title">{a.title}</span>
                <span className="alt-meta">{a.kind === 'recipe' ? `${a.minutes} 分钟` : '吃剩菜'}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="chips" role="group" aria-label="今天的条件">
        <Chip on={!!c?.airfryerOnly} label="只用空气炸锅" onClick={() => setFilter({ airfryerOnly: !c?.airfryerOnly })} />
        <Chip on={!!c?.minutes} label={c?.minutes ? `只有${c.minutes}分钟` : '只有15分钟'} onClick={() => setFilter({ minutes: c?.minutes ? null : 15 })} />
        <Chip on={!!c?.spicy} label="想吃辣" onClick={() => setFilter({ spicy: !c?.spicy })} />
        <button className="chip" onClick={() => setSheet('snack')}>加餐</button>
        <button className="chip" aria-label="更多条件" onClick={() => setSheet('more')}>更多</button>
      </div>
      {c?.hunger === 'high' && primary && <p className="note">今天比较饿：可以多配一份主食，或加一份已有的熟菜。</p>}
      {c?.hunger === 'low' && primary && <p className="note">今天吃得少：可以把这顿减到一份，在「做了几份」里改。</p>}

      <Assistant nav={nav} onQuick={setSheet} />

      {reminder ? (
        <div className="reminder" role="note">
          <span>{reminder.text}</span>
          {reminder.action && <button onClick={() => run(reminder.action!.command, reminder.action!.input)}>{reminder.action.label}</button>}
        </div>
      ) : noStock ? (
        <button className="reminder reminder-btn" onClick={nav.calibrate}>家里的食材还没核对，推荐里的数量都是待确认。点这里核对。</button>
      ) : null}

      <div className="home-links">
        <button className="link" onClick={nav.plan}>14 天计划</button>
        <button className="link" onClick={nav.nutrition}>营养记录</button>
        <button className="link" onClick={() => setSheet('fix')}>记错了？</button>
      </div>

      {sheet === 'out' && <OutSheet date={today} onClose={() => setSheet(null)} />}
      {sheet === 'snack' && <SnackSheet nav={nav} date={today} onClose={() => setSheet(null)} />}
      {sheet === 'fix' && <FixSheet onClose={() => setSheet(null)} />}
      {sheet === 'more' && <MoreSheet minutes={c?.minutes ?? null} hunger={c?.hunger ?? null} busy={c?.dayStatus === 'busy'} onSet={setFilter} onClose={() => setSheet(null)} />}
    </div>
  );
}

function Chip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return <button className={`chip${on ? ' chip-on' : ''}`} aria-pressed={on} onClick={onClick}>{on ? '✓ ' : ''}{label}</button>;
}

function PrimaryCard({ pick, mealLabel, onStart, onEat, onSwap, canSwap }: { pick: Pick; mealLabel: string; onStart: (p: RecipePick) => void; onEat: (batchId: string) => void; onSwap: () => void; canSwap: boolean }) {
  if (pick.kind === 'leftover') {
    return (
      <section className="card primary" aria-label="优先推荐">
        <div className="eyebrow">{mealLabel} · 优先吃熟菜</div>
        <h2>{pick.title}</h2>
        <p className="why">{pick.reasons.join(' · ')}</p>
        <div className="row">
          <button className="btn btn-primary" onClick={() => onEat(pick.batch.id)}>吃掉这份</button>
          <button className="btn" disabled={!canSwap} onClick={onSwap}>换一道</button>
        </div>
      </section>
    );
  }
  const main = pick.check.lines.filter((l) => l.role === 'required').slice(0, 5).map((l) => l.name);
  const unverified = pick.check.unverified.length > 0;
  return (
    <section className="card primary" aria-label="优先推荐">
      <div className="eyebrow">{mealLabel}</div>
      <h2>{pick.title}</h2>
      <p className="meta">约 {pick.minutes} 分钟 · {pick.servings} 顿 · {pick.variant.equipment.map((e) => EQUIP[e]).join('/')}</p>
      {pick.reasons.length > 0 && <p className="why">为什么：{pick.reasons.join(' / ')}</p>}
      <p className="meta">食材：{main.join('、')}</p>
      {unverified && <p className="unverified">有此食材，数量待核对：{pick.check.unverified.slice(0, 4).join('、')}</p>}
      {pick.check.frozen.length > 0 && <p className="unverified">还冻着：{pick.check.frozen.map((f) => f.name).join('、')}</p>}
      <div className="row">
        <button className="btn btn-primary" onClick={() => onStart(pick)}>开始做</button>
        <button className="btn" disabled={!canSwap} onClick={onSwap}>换一道</button>
      </div>
    </section>
  );
}

function OutSheet({ date, onClose }: { date: string; onClose: () => void }) {
  const { run, state } = useKitchen();
  const slot = (s: 'lunch' | 'dinner') => state.meal_slots.find((x) => x.id === `${date}:${s}`);
  const act = async (name: Parameters<typeof run>[0], input: unknown) => { onClose(); await run(name, input); };
  const eaten = (s: 'lunch' | 'dinner') => slot(s)?.status === 'eaten';
  return (
    <Sheet title="今天的安排" onClose={onClose}>
      <div className="stack">
        <button className="btn btn-wide" disabled={eaten('lunch')} onClick={() => act('setMealStatus', { date, slot: 'lunch', status: 'eating_out' })}>午餐外食</button>
        <button className="btn btn-wide" disabled={eaten('dinner')} onClick={() => act('setMealStatus', { date, slot: 'dinner', status: 'eating_out' })}>晚餐外食</button>
        <button className="btn btn-wide" onClick={() => act('setDayAway', { date })}>一整天都不在家吃</button>
        <button className="btn btn-wide" disabled={eaten('dinner')} onClick={() => act('changeMealCount', { date, count: 1, keep: 'lunch' })}>只吃午餐一顿</button>
        <button className="btn btn-wide" disabled={eaten('lunch')} onClick={() => act('changeMealCount', { date, count: 1, keep: 'dinner' })}>只吃晚餐一顿</button>
      </div>
      <p className="hint">只改计划，库存不变。已做好的熟菜还在。</p>
    </Sheet>
  );
}

function SnackSheet({ nav, date, onClose }: { nav: Nav; date: string; onClose: () => void }) {
  const { state, now, run } = useKitchen();
  const options = recommendSnack(state, now());
  return (
    <Sheet title="加餐" onClose={onClose}>
      {options.length === 0 && <p>现在没有确认可吃的选项。可以先在库存页核对。</p>}
      <div className="stack">
        {options.map((o) => (
          <button key={o.title} className="btn btn-wide btn-col" onClick={() => {
            onClose();
            if (o.batchId) void run('consumePreparedPortion', { batchId: o.batchId, portions: 1, date, slot: 'snack' });
            else nav.cook({ recipeId: o.recipeId!, servings: 1, snack: true, date });
          }}>
            <span>{o.title}</span><small>{o.note}</small>
          </button>
        ))}
      </div>
      <p className="hint">选熟菜就是已吃掉；选要做的，做完确认才扣原料。加餐不算新的肉类日。</p>
    </Sheet>
  );
}

/** 全部可选，不要求每天填写。 */
function MoreSheet({ minutes, hunger, busy, onSet, onClose }: { minutes: number | null; hunger: string | null; busy: boolean; onSet: (p: Record<string, unknown>) => void; onClose: () => void }) {
  return (
    <Sheet title="今天的条件（都是可选的）" onClose={onClose}>
      <h3>可做饭时间</h3>
      <div className="chips">
        {[15, 30, 45].map((m) => <Chip key={m} on={minutes === m} label={`${m} 分钟`} onClick={() => onSet({ minutes: minutes === m ? null : m })} />)}
      </div>
      <h3>今天的状态</h3>
      <div className="chips">
        <Chip on={busy} label="比较忙" onClick={() => onSet({ dayStatus: busy ? null : 'busy' })} />
      </div>
      <h3>饿不饿</h3>
      <div className="chips">
        {([['high', '比较饿'], ['normal', '正常'], ['low', '少吃']] as const).map(([v, l]) => <Chip key={v} on={hunger === v} label={l} onClick={() => onSet({ hunger: hunger === v ? null : v })} />)}
      </div>
      <p className="hint">只影响今天的推荐，不改库存。外出请用「今天外食」。</p>
    </Sheet>
  );
}

function FixSheet({ onClose }: { onClose: () => void }) {
  const { state, run, now, undo } = useKitchen();
  const [qty, setQty] = useState('');
  const today = localDate(now());
  const ops = [...state.audit_events].filter((a) => a.undoable && !a.undoneBy).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
  const last = [...state.cook_sessions].filter((s) => s.status === 'finished').sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))[0];
  const rows = last ? state.cook_session_ingredients.filter((r) => r.sessionId === last.id) : [];
  const [ingredientId, setIngredientId] = useState('');
  const eaten = state.meal_slots.filter((s) => s.date === today && s.status === 'eaten' && s.slot !== 'snack');
  const batch = state.prepared_batches.find((b) => b.status === 'active' && b.location === 'fridge' && b.portionsRemaining > 0);

  return (
    <Sheet title="记错了？" onClose={onClose}>
      <div className="stack">
        {eaten.map((s) => (
          <button key={s.id} className="btn btn-wide" onClick={() => { onClose(); void run('revertConsumption', { date: s.date, slot: s.slot }); }}>
            {friendlyDate(s.date, today)}{s.slot === 'lunch' ? '午餐' : '晚餐'}其实没吃
          </button>
        ))}
        {batch && <button className="btn btn-wide" onClick={() => { onClose(); void run('consumePreparedPortion', { batchId: batch.id, portions: 1 }); }}>多吃了一份「{batch.name}」</button>}
      </div>
      {rows.length > 0 && (
        <section>
          <h3>修正上次用量</h3>
          <div className="row">
            <select aria-label="食材" value={ingredientId} onChange={(e) => setIngredientId(e.target.value)}>
              <option value="">选食材</option>
              {rows.map((r) => <option key={r.id} value={r.ingredientId}>{state.ingredients.find((i) => i.id === r.ingredientId)?.name}（记了 {r.actualQty}{r.unit}）</option>)}
            </select>
            <input aria-label="实际用量" inputMode="decimal" placeholder="实际用量" value={qty} onChange={(e) => setQty(e.target.value)} />
            <button className="btn" disabled={!ingredientId || qty === ''} onClick={() => { onClose(); void run('reviseCookSession', { sessionId: last.id, ingredientId, qty: Number(qty) }); }}>修正</button>
          </div>
        </section>
      )}
      <section>
        <h3>最近的操作</h3>
        {ops.length === 0 && <p className="hint">还没有可撤销的操作。</p>}
        <ul className="ops">
          {ops.map((o) => (
            <li key={o.id}><span>{o.summary}</span><button className="link" onClick={() => { onClose(); void undo(o.id); }}>撤销</button></li>
          ))}
        </ul>
      </section>
    </Sheet>
  );
}
