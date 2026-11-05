import { useMemo, useState } from 'react';
import { friendlyDate, localDate, shortDate } from '../domain/dates';
import { LOCATION_LABEL, stockOf } from '../domain/inventory';
import { nutritionFor, nutritionLine } from '../domain/nutrition';
import type { Ingredient, IngredientCategory, InventoryLot, Level, PreparedBatch } from '../domain/types';
import { formatQty } from '../domain/units';
import { RealityTag, Screen, Sheet } from './components';
import { useKitchen } from './store';

const GROUPS: [IngredientCategory[], string][] = [
  [['protein'], '蛋白质'], [['fresh'], '新鲜'], [['frozen_veg'], '冷冻蔬菜'], [['staple', 'pantry'], '常温与主食'],
];
const LEVELS: [Level, string][] = [['have', '有'], ['low', '快用完'], ['out', '没有'], ['unconfirmed', '未确认']];
const unitOf = (i: Ingredient) => (i.unit === 'count' ? i.countUnit ?? '' : i.unit);
const SOURCE: Record<string, string> = { package: '包装标注', rule: '保守建议', user: '你填的' };

export function Inventory({ calibrating, setCalibrating }: { calibrating: boolean; setCalibrating: (v: boolean) => void }) {
  const { state, run, now } = useKitchen();
  const [open, setOpen] = useState<Ingredient | null>(null);
  const [batch, setBatch] = useState<PreparedBatch | null>(null);
  const [showUnknown, setShowUnknown] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const today = localDate(now());
  const batches = state.prepared_batches.filter((b) => b.status === 'active');
  // 备用食材没有真实记录时不占首屏，也不算待核对。
  const spare = (i: Ingredient) => !!i.catalogOnly && stockOf(state, i.id).reality === 'mentioned';
  const seasonings = state.ingredients.filter((i) => i.unit === 'level' && !spare(i));
  const spareItems = state.ingredients.filter(spare);

  const groups = useMemo(() => GROUPS.map(([cats, label]) => ({
    label,
    items: state.ingredients.filter((i) => cats.includes(i.category) && i.unit !== 'level' && !spare(i)).map((ing) => ({ ing, stock: stockOf(state, ing.id) })),
  })), [state]);
  const known = (r: string) => r !== 'mentioned';

  const liveIng = open ? state.ingredients.find((i) => i.id === open.id) ?? null : null;
  const liveBatch = batch ? state.prepared_batches.find((b) => b.id === batch.id && b.status === 'active') ?? null : null;

  return (
    <div className="page">
      <header className="page-head">
        <h1>库存</h1>
        <button className="btn btn-small" onClick={() => setCalibrating(true)}>一次核对</button>
      </header>

      <section>
        <h3>熟菜</h3>
        {batches.length === 0 && <p className="hint">现在没有熟菜。</p>}
        <ul className="stock">
          {batches.map((b) => (
            <li key={b.id}>
              <button onClick={() => setBatch(b)}>
                <span>{b.name}</span>
                <span className="stock-right">{b.portionsRemaining} 份 · {LOCATION_LABEL[b.location]} · {shortDate(b.useBy)} 前</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {groups.map((g) => {
        const shown = g.items.filter((x) => known(x.stock.reality));
        return shown.length > 0 && (
          <section key={g.label}>
            <h3>{g.label}</h3>
            <ul className="stock">
              {shown.map(({ ing, stock }) => (
                <li key={ing.id}>
                  <button onClick={() => setOpen(ing)}>
                    <span>{ing.name}</span>
                    <span className="stock-right">
                      {stock.knownQty > 0 && formatQty(stock.knownQty, unitOf(ing))}
                      {stock.frozenQty > 0 && stock.readyQty > 0 && `（冷冻 ${formatQty(stock.frozenQty, unitOf(ing))}）`}
                      {stock.frozenQty > 0 && stock.readyQty === 0 && '（冷冻）'}
                      <RealityTag reality={stock.reality} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section>
        <h3>调料</h3>
        <ul className="stock">
          {seasonings.map((i) => (
            <li key={i.id} className="level-row">
              <span>{i.name}{i.maybe ? '（可能有）' : ''}</span>
              <select aria-label={`${i.name}状态`} value={i.level ?? 'unconfirmed'} onChange={(e) => run('setSeasoningLevel', { ingredientId: i.id, level: e.target.value }, { silent: true })}>
                {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </li>
          ))}
        </ul>
      </section>

      <button className="link" onClick={() => setShowUnknown(!showUnknown)}>
        {showUnknown ? '收起' : `还有 ${groups.flatMap((g) => g.items).filter((x) => !known(x.stock.reality)).length} 项待核对`}
      </button>
      {showUnknown && (
        <ul className="stock">
          {groups.flatMap((g) => g.items).filter((x) => !known(x.stock.reality)).map(({ ing, stock }) => (
            <li key={ing.id}><button onClick={() => setOpen(ing)}><span>{ing.name}</span><RealityTag reality={stock.reality} /></button></li>
          ))}
        </ul>
      )}

      {spareItems.length > 0 && (
        <button className="link" onClick={() => setShowCatalog(!showCatalog)}>{showCatalog ? '收起备用食材' : `备用食材 ${spareItems.length} 种`}</button>
      )}
      {showCatalog && (
        <ul className="stock">
          {spareItems.map((i) => (i.unit === 'level' ? (
            <li key={i.id} className="level-row">
              <span>{i.name}</span>
              <select aria-label={`${i.name}状态`} value={i.level ?? 'unconfirmed'} onChange={(e) => run('setSeasoningLevel', { ingredientId: i.id, level: e.target.value }, { silent: true })}>
                {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </li>
          ) : (
            <li key={i.id}><button onClick={() => setOpen(i)}><span>{i.name}</span></button></li>
          )))}
        </ul>
      )}

      {liveIng && <IngredientSheet ing={liveIng} today={today} onClose={() => setOpen(null)} />}
      {liveBatch && (
        <Sheet title={liveBatch.name} onClose={() => setBatch(null)}>
          <p className="meta">{liveBatch.portionsRemaining} 份 · {LOCATION_LABEL[liveBatch.location]} · 建议 {friendlyDate(liveBatch.useBy, today)} 前吃完（保守建议，不代表变质判断）</p>
          <div className="stack">
            {liveBatch.location === 'fridge' && <button className="btn btn-wide" onClick={() => { setBatch(null); void run('consumePreparedPortion', { batchId: liveBatch.id, portions: 1 }); }}>吃一份</button>}
            <button className="btn btn-wide" onClick={() => { setBatch(null); void run('moveBatch', { batchId: liveBatch.id, to: liveBatch.location === 'fridge' ? 'freezer' : 'fridge' }); }}>{liveBatch.location === 'fridge' ? '冷冻' : '转冷藏解冻'}</button>
            <button className="btn btn-wide btn-danger" onClick={() => { setBatch(null); void run('discardBatch', { batchId: liveBatch.id }); }}>丢弃</button>
          </div>
        </Sheet>
      )}
      {calibrating && <Calibrate onClose={() => setCalibrating(false)} />}
    </div>
  );
}

function IngredientSheet({ ing, today, onClose }: { ing: Ingredient; today: string; onClose: () => void }) {
  const { state, run } = useKitchen();
  const stock = stockOf(state, ing.id);
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState(unitOf(ing));
  const act = async (name: Parameters<typeof run>[0], input: unknown) => { await run(name, input); };
  const unitOptions = ing.unit === 'g' ? ['g', 'oz', 'lb', 'kg'] : ing.unit === 'ml' ? ['ml', 'l'] : [unitOf(ing)];

  return (
    <Sheet title={ing.name} onClose={onClose}>
      {ing.note && <p className="hint">{ing.note}</p>}
      {nutritionFor(ing.id).map((n) => <p key={n.name} className="meta">{n.name} {n.serving}：{nutritionLine(n)}</p>)}
      {stock.lots.length === 0 && <p className="meta">{stock.reality === 'out' ? '确认没有了。' : '还没有批次记录。'}</p>}
      <ul className="lots">
        {stock.lots.map((l) => <LotRow key={l.id} lot={l} ing={ing} today={today} onAct={act} />)}
      </ul>
      {stock.knownQty > 0 && (
        <section>
          <h3>快速增减</h3>
          <div className="row">
            {[-1, 1].map((sign) => {
              const step = ing.unit === 'count' ? 1 : 50;
              const next = Math.max(0, stock.knownQty + sign * step);
              return <button key={sign} className="btn" onClick={() => run('adjustInventory', { ingredientId: ing.id, qty: next })}>{sign > 0 ? '+' : '−'}{step}{unitOf(ing)}</button>;
            })}
          </div>
        </section>
      )}
      <section>
        <h3>校准总量</h3>
        <div className="row">
          <input aria-label="实际数量" inputMode="decimal" placeholder="实际有多少" value={qty} onChange={(e) => setQty(e.target.value)} />
          <select aria-label="单位" value={unit} onChange={(e) => setUnit(e.target.value)}>{unitOptions.map((u) => <option key={u}>{u}</option>)}</select>
          <button className="btn" disabled={qty === ''} onClick={() => { setQty(''); void run('adjustInventory', { ingredientId: ing.id, qty: Number(qty), unit }); }}>保存</button>
        </div>
      </section>
      {stock.lots.length === 0 && stock.reality !== 'out' && (
        <button className="btn btn-wide" onClick={() => { onClose(); void run('calibrateInventory', { entries: [{ ingredientId: ing.id, present: false }] }); }}>家里没有</button>
      )}
    </Sheet>
  );
}

function LotRow({ lot, ing, today, onAct }: { lot: InventoryLot; ing: Ingredient; today: string; onAct: (name: 'moveInventory' | 'discardLot', input: unknown) => Promise<void> }) {
  const to = lot.location === 'freezer' ? 'fridge' : 'freezer';
  const [part, setPart] = useState('');
  const partQty = lot.qty !== null && part !== '' ? { qty: Number(part) } : {};
  return (
    <li>
      <div>
        <strong>{lot.qty === null ? lot.rawLabel ?? '数量未知' : formatQty(lot.qty, lot.unit)}</strong>
        <span className="meta"> · {LOCATION_LABEL[lot.location]}{lot.confidence === 'estimated' ? ' · 估算' : ''}</span>
        {lot.useBy
          ? <div className="meta">建议 {friendlyDate(lot.useBy, today)} 前用（{SOURCE[lot.useBySource ?? ''] ?? ''}）</div>
          : <div className="meta">没有日期信息</div>}
      </div>
      <div className="row">
        {lot.qty !== null && <input aria-label={`操作数量${lot.unit}`} inputMode="decimal" placeholder="全部" value={part} onChange={(e) => setPart(e.target.value)} />}
        <button className="btn btn-small" onClick={() => onAct('moveInventory', { lotId: lot.id, to, ...partQty })}>{to === 'fridge' ? (ing.needsThaw ? '放冰箱解冻' : '转冷藏') : '冷冻'}</button>
        <button className="btn btn-small btn-danger" onClick={() => onAct('discardLot', { lotId: lot.id, reason: '报废', ...partQty })}>报废</button>
      </div>
    </li>
  );
}

/** 首次核对：每项只点「有 / 没有」，数量可不填。一次提交，一个事务。 */
function Calibrate({ onClose }: { onClose: () => void }) {
  const { state, run } = useKitchen();
  const [answers, setAnswers] = useState<Record<string, { present: boolean; qty: string }>>({});
  const pending = state.ingredients.filter((i) => !i.catalogOnly && stockOf(state, i.id).reality === 'mentioned');
  const set = (id: string, present: boolean) => setAnswers({ ...answers, [id]: { present, qty: answers[id]?.qty ?? '' } });
  const count = Object.keys(answers).length;

  const submit = async () => {
    const entries = Object.entries(answers).map(([ingredientId, a]) => ({
      ingredientId, present: a.present, ...(a.present && a.qty !== '' ? { qty: Number(a.qty) } : {}),
    }));
    const ok = await run('calibrateInventory', { entries });
    if (ok) onClose();
  };

  return (
    <Screen title="一次核对" onBack={onClose} footer={
      <button className="btn btn-primary btn-wide" disabled={count === 0} onClick={submit}>确认 {count} 项</button>
    }>
      <p className="hint">只点你确定的。「有」但不知道多少也可以，数量留空。没点的继续保持待核对。</p>
      <ul className="calib">
        {pending.map((i) => (
          <li key={i.id}>
            <span>{i.name}{i.maybe ? '（可能有）' : ''}</span>
            <div className="row">
              {answers[i.id]?.present && i.unit !== 'level' && (
                <input aria-label={`${i.name}数量`} inputMode="decimal" placeholder={unitOf(i)} value={answers[i.id].qty} onChange={(e) => setAnswers({ ...answers, [i.id]: { present: true, qty: e.target.value } })} />
              )}
              <button className={`chip${answers[i.id]?.present === true ? ' chip-on' : ''}`} aria-pressed={answers[i.id]?.present === true} aria-label={`${i.name}有`} onClick={() => set(i.id, true)}>有</button>
              <button className={`chip${answers[i.id]?.present === false ? ' chip-on' : ''}`} aria-pressed={answers[i.id]?.present === false} aria-label={`${i.name}没有`} onClick={() => set(i.id, false)}>没有</button>
            </div>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
