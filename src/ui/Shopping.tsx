import { useMemo, useState } from 'react';
import { findIngredient } from '../domain/ai/match';
import { friendlyDate, localDate } from '../domain/dates';
import { LOCATION_LABEL } from '../domain/inventory';
import { forecastShopping, type ForecastItem } from '../domain/shopping';
import type { Ingredient, Location, ShoppingItem, ShoppingTag } from '../domain/types';
import { useKitchen } from './store';

const TAGS: [ShoppingTag, string][] = [['must', '必买'], ['short_life', '短保质期注意'], ['optional', '可选'], ['enough', '库存充足']];

export function Shopping() {
  const { state, now, run } = useKitchen();
  const today = localDate(now());
  const forecast = useMemo(() => forecastShopping(state, now()), [state, now]);
  const draft = state.shopping_lists.find((l) => l.status === 'draft');
  const items = draft ? state.shopping_items.filter((i) => i.listId === draft.id) : [];
  const [showEnough, setShowEnough] = useState(false);

  if (draft) return <Checklist listId={draft.id} items={items} />;

  return (
    <div className="page">
      <header className="page-head">
        <h1>采购</h1>
      </header>
      <p className="meta">{friendlyDate(forecast.shopDate, today)}采购，覆盖到 {friendlyDate(forecast.endDate, today)}。预测不占用库存。</p>
      <label className="qty-row shop-date"><span>下次采购日</span><input type="date" aria-label="下次采购日" min={today} value={forecast.shopDate} onChange={(e) => e.target.value && run('setNextShopDate', { date: e.target.value }, { silent: true })} /></label>
      {TAGS.map(([tag, label]) => {
        const list = forecast.items.filter((i) => i.tag === tag);
        if (list.length === 0) return null;
        if (tag === 'enough' && !showEnough) return <button key={tag} className="link" onClick={() => setShowEnough(true)}>库存充足 {list.length} 项</button>;
        return (
          <section key={tag}>
            <h3>{label}</h3>
            <ul className="buy">{list.map((i) => <BuyRow key={i.ingredientId} item={i} />)}</ul>
          </section>
        );
      })}
      {forecast.items.length === 0 && <p className="hint">接下来的计划不需要采购。</p>}
      {forecast.notes.map((n) => <p key={n} className="hint">{n}</p>)}
      <button className="btn btn-primary btn-wide" onClick={() => run('createShoppingList', {})}>生成购物清单</button>
    </div>
  );
}

function BuyRow({ item }: { item: ForecastItem }) {
  return (
    <li>
      <div className="buy-top"><strong>{item.name}</strong><span>{item.packLabel}</span></div>
      <div className="meta">{item.reason}</div>
    </li>
  );
}

interface Line {
  bought: boolean;
  qty: string;
  unit: string;
  location: Location;
  perUnit: string;
  useBy: string;
}

function Checklist({ listId, items }: { listId: string; items: ShoppingItem[] }) {
  const { state, run } = useKitchen();
  const [lines, setLines] = useState<Record<string, Partial<Line>>>({});
  const [search, setSearch] = useState('');
  const [fresh, setFresh] = useState<{ aliases: string; category: Ingredient['category']; unit: string; location: Location } | null>(null);

  const ingOf = (i: ShoppingItem) => state.ingredients.find((x) => x.id === i.ingredientId)!;
  const line = (i: ShoppingItem): Line => {
    const ing = ingOf(i);
    return {
      bought: false, qty: i.suggestedQty ? String(i.suggestedQty) : '', unit: i.unit || (ing.unit === 'count' ? ing.countUnit ?? '' : ing.unit === 'level' ? '' : ing.unit),
      location: ing.defaultLocation, perUnit: '', useBy: '', ...lines[i.id],
    };
  };
  const patch = (id: string, p: Partial<Line>) => setLines({ ...lines, [id]: { ...lines[id], ...p } });
  const boughtCount = items.filter((i) => line(i).bought).length;

  const confirm = async () => {
    // 没勾选的就是没买到：不入库。勾选本身也不入库，只有这里确认才算。
    const payload = items.map((i) => {
      const l = line(i);
      const ing = ingOf(i);
      if (!l.bought) return { ingredientId: i.ingredientId, bought: false };
      return {
        ingredientId: i.ingredientId, bought: true,
        ...(ing.unit !== 'level' && l.qty !== '' ? { qty: Number(l.qty) } : {}),
        ...(l.unit ? { unit: l.unit } : {}),
        ...(ing.unit !== 'level' ? { location: l.location } : {}),
        ...(l.perUnit ? { perUnitQty: Number(l.perUnit) } : {}),
        ...(l.useBy ? { packageUseBy: l.useBy } : {}),
        ...(i.productId ? { productId: i.productId } : {}),
      };
    });
    await run('confirmPurchase', { listId, lines: payload });
  };

  const add = () => {
    const ing = findIngredient(state, search.trim());
    if (ing) { void run('addShoppingItem', { listId, ingredientId: ing.id }, { silent: true }); setSearch(''); setFresh(null); return; }
    // 目录里没有：当场建一个，不让按钮没反应。
    setFresh({ aliases: '', category: 'fresh', unit: 'g', location: 'fridge' });
  };

  const create = async () => {
    if (!fresh) return;
    const mass = fresh.unit === 'g' || fresh.unit === 'ml';
    const result = await run('addIngredient', {
      name: search.trim(), category: fresh.category, unit: mass ? fresh.unit : 'count', ...(mass ? {} : { countUnit: fresh.unit }), defaultLocation: fresh.location,
      aliases: fresh.aliases.split(/[,，、\s]+/).filter(Boolean),
    }, { silent: true });
    const id = (result?.data as { ingredientId?: string } | undefined)?.ingredientId;
    if (id) { await run('addShoppingItem', { listId, ingredientId: id }); setSearch(''); setFresh(null); }
  };

  return (
    <div className="page">
      <header className="page-head"><h1>购物清单</h1></header>
      <p className="hint">买到的打勾，数量不同就改。勾选只是记号，点最下面的确认才入库。</p>
      <ul className="check">
        {items.map((i) => {
          const l = line(i);
          const ing = ingOf(i);
          const countInMass = ing.unit === 'g' && !['g', 'oz', 'lb', 'kg'].includes(l.unit);
          return (
            <li key={i.id}>
              <label className="check-top">
                <input type="checkbox" checked={l.bought} onChange={(e) => patch(i.id, { bought: e.target.checked })} />
                <span><strong>{i.name}</strong><small>{i.packLabel}</small></span>
              </label>
              {l.bought && ing.unit !== 'level' && (
                <>
                  <div className="row">
                    <input aria-label={`${i.name}实际数量`} inputMode="decimal" placeholder="数量（可空）" value={l.qty} onChange={(e) => patch(i.id, { qty: e.target.value })} />
                    <select aria-label={`${i.name}单位`} value={l.unit} onChange={(e) => patch(i.id, { unit: e.target.value })}>
                      {(ing.unit === 'g' ? ['g', 'oz', 'lb', 'kg', '颗', '盒', '袋'] : ing.unit === 'ml' ? ['ml', 'l'] : [l.unit]).map((u) => <option key={u}>{u}</option>)}
                    </select>
                    <select aria-label={`${i.name}存放`} value={l.location} onChange={(e) => patch(i.id, { location: e.target.value as Location })}>
                      {(['fridge', 'freezer', 'pantry'] as const).map((loc) => <option key={loc} value={loc}>{LOCATION_LABEL[loc]}</option>)}
                    </select>
                  </div>
                  {countInMass && !ing.unitSpecs[l.unit] && (
                    <div className="row">
                      <input aria-label={`每${l.unit}约多少克`} inputMode="decimal" placeholder={`每${l.unit}约多少克（可空）`} value={l.perUnit} onChange={(e) => patch(i.id, { perUnit: e.target.value })} />
                      <span className="meta">不填就记为数量未知</span>
                    </div>
                  )}
                  <label className="qty-row"><span>包装日期（可空）</span><input type="date" aria-label={`${i.name}包装日期`} value={l.useBy} onChange={(e) => patch(i.id, { useBy: e.target.value })} /></label>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <div className="row">
        <input aria-label="添加商品" placeholder="加一项：蘑菇 / onion…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn" disabled={!search.trim()} onClick={add}>添加</button>
      </div>
      {fresh && (
        <div className="new-item">
          <p className="meta">目录里没有「{search}」，新建一个：</p>
          <input aria-label="英文或别名" placeholder="英文或别名（可空）" value={fresh.aliases} onChange={(e) => setFresh({ ...fresh, aliases: e.target.value })} />
          <div className="row">
            <select aria-label="分类" value={fresh.category} onChange={(e) => setFresh({ ...fresh, category: e.target.value as Ingredient['category'] })}>
              <option value="fresh">新鲜</option><option value="protein">蛋白质</option><option value="frozen_veg">冷冻蔬菜</option><option value="staple">主食</option><option value="pantry">常温</option>
            </select>
            <select aria-label="包装单位" value={fresh.unit} onChange={(e) => setFresh({ ...fresh, unit: e.target.value })}>
              {['g', 'ml', '个', '袋', '盒', '瓶', '罐', '把', '根'].map((u) => <option key={u}>{u}</option>)}
            </select>
            <select aria-label="默认存放" value={fresh.location} onChange={(e) => setFresh({ ...fresh, location: e.target.value as Location })}>
              {(['fridge', 'freezer', 'pantry'] as const).map((loc) => <option key={loc} value={loc}>{LOCATION_LABEL[loc]}</option>)}
            </select>
          </div>
          <div className="row"><button className="btn" onClick={create}>加入目录和清单</button></div>
        </div>
      )}
      {state.purchase_confirmations.length > 0 && <button className="link" onClick={() => run('copyLastPurchase', { listId })}>复制上次已购</button>}
      <button className="btn btn-primary btn-wide" disabled={boughtCount === 0} onClick={confirm}>确认入库（买到 {boughtCount} 项）</button>
      <button className="link" onClick={() => run('discardShoppingList', { listId })}>放弃这份清单</button>
    </div>
  );
}
