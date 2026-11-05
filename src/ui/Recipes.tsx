import { useMemo, useState } from 'react';
import { localDate } from '../domain/dates';
import { checkRecipe } from '../domain/recommend';
import type { Protein, Recipe } from '../domain/types';
import type { Nav } from './App';
import { Screen } from './components';
import { useKitchen } from './store';

const PROTEINS: [Protein | 'all', string][] = [['all', '全部'], ['chicken', '鸡'], ['beef', '牛'], ['pork', '猪'], ['fish', '鱼'], ['shrimp', '虾']];

export function Recipes({ nav }: { nav: Nav }) {
  const { state, now } = useKitchen();
  const [protein, setProtein] = useState<Protein | 'all'>('all');
  const [airfryer, setAirfryer] = useState(false);
  const [canMake, setCanMake] = useState(false);
  const [flavor, setFlavor] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [detail, setDetail] = useState<Recipe | null>(null);
  const today = localDate(now());

  const list = useMemo(() => state.recipes.filter((r) => {
    if (r.tier === 'snack') return false;
    if (protein !== 'all' && r.protein !== protein) return false;
    if (airfryer && !state.recipe_variants.some((v) => v.recipeId === r.id && v.airfryerOnlyOk)) return false;
    if (canMake && checkRecipe(state, r.id, r.baseServings, today).blocked) return false;
    if (flavor && !r.flavors.includes(flavor)) return false;
    return true;
  }), [state, protein, airfryer, canMake, flavor, today]);
  const flavors = useMemo(() => [...new Set(state.recipes.filter((r) => r.tier !== 'snack').flatMap((r) => r.flavors))], [state.recipes]);

  const core = list.filter((r) => r.tier === 'core');
  const more = list.filter((r) => r.tier !== 'core');
  const live = detail ? state.recipes.find((r) => r.id === detail.id) ?? null : null;

  return (
    <div className="page">
      <header className="page-head"><h1>菜谱</h1></header>
      <div className="chips" role="group" aria-label="按蛋白筛选">
        {PROTEINS.map(([id, label]) => (
          <button key={id} className={`chip${protein === id ? ' chip-on' : ''}`} aria-pressed={protein === id} onClick={() => setProtein(id)}>{label}</button>
        ))}
      </div>
      <div className="chips" role="group" aria-label="其他筛选">
        <button className={`chip${airfryer ? ' chip-on' : ''}`} aria-pressed={airfryer} onClick={() => setAirfryer(!airfryer)}>空气炸锅</button>
        <button className={`chip${canMake ? ' chip-on' : ''}`} aria-pressed={canMake} onClick={() => setCanMake(!canMake)}>现在能做</button>
        <select className="chip-select" aria-label="按风味筛选" value={flavor} onChange={(e) => setFlavor(e.target.value)}>
          <option value="">全部风味</option>
          {flavors.map((f) => <option key={f}>{f}</option>)}
        </select>
      </div>
      <ul className="recipe-list">{core.map((r) => <RecipeRow key={r.id} r={r} onOpen={() => setDetail(r)} />)}</ul>
      {more.length > 0 && (showAll
        ? <ul className="recipe-list">{more.map((r) => <RecipeRow key={r.id} r={r} onOpen={() => setDetail(r)} />)}</ul>
        : <button className="link" onClick={() => setShowAll(true)}>再看 {more.length} 道变体和备选</button>)}
      {list.length === 0 && <p className="hint">没有符合条件的菜。</p>}
      {live && <RecipeDetail recipe={live} nav={nav} onClose={() => setDetail(null)} />}
    </div>
  );
}

function RecipeRow({ r, onOpen }: { r: Recipe; onOpen: () => void }) {
  const fb = { good: '好吃', meh: '一般', avoid: '别推荐' }[r.feedback ?? 'good'];
  return (
    <li>
      <button className="recipe-row" onClick={onOpen}>
        <span className="recipe-name">{r.name}</span>
        <span className="recipe-sub">{r.flavors.join(' · ')}{r.lastCookedAt ? ` · 上次 ${r.lastCookedAt.slice(5)}` : ''}{r.feedback ? ` · ${fb}` : ''}{r.enabled ? '' : ' · 已停用'}</span>
      </button>
    </li>
  );
}

function RecipeDetail({ recipe, nav, onClose }: { recipe: Recipe; nav: Nav; onClose: () => void }) {
  const { state, run, now } = useKitchen();
  const [notes, setNotes] = useState(recipe.notes);
  const today = localDate(now());
  const check = checkRecipe(state, recipe.id, recipe.baseServings, today);
  const variants = state.recipe_variants.filter((v) => v.recipeId === recipe.id);
  const rows = state.recipe_ingredients.filter((r) => r.recipeId === recipe.id && r.qty !== null);
  const [qty, setQty] = useState<Record<string, string>>({});

  const save = () => run('updateRecipe', {
    recipeId: recipe.id, notes,
    ingredientQty: Object.entries(qty).filter(([, v]) => v !== '').map(([rowId, v]) => ({ rowId, qty: Number(v) })),
  });

  return (
    <Screen title={recipe.name} onBack={onClose} footer={
      <button className="btn btn-primary btn-wide" onClick={() => { onClose(); nav.cook({ recipeId: recipe.id, servings: recipe.baseServings }); }}>开始做</button>
    }>
      <p className="meta">{recipe.seasoningTemplate}</p>
      <ul className="plain">{variants.map((v) => <li key={v.id}>{v.name}：约 {v.minutes} 分钟，{v.fit}</li>)}</ul>
      <section>
        <h3>食材（{recipe.baseServings} 份）</h3>
        <ul className="ing-list">{check.lines.map((l) => <li key={l.ingredientId}><span>{l.name}{l.role === 'optional' ? '（可选）' : ''}</span><span>{l.label}</span></li>)}</ul>
      </section>
      <section>
        <h3>轻反馈</h3>
        <div className="row">
          {(['good', 'meh', 'avoid'] as const).map((f) => (
            <button key={f} className={`chip${recipe.feedback === f ? ' chip-on' : ''}`} aria-pressed={recipe.feedback === f} onClick={() => run('rateRecipe', { recipeId: recipe.id, feedback: recipe.feedback === f ? null : f }, { silent: true })}>
              {{ good: '好吃', meh: '一般', avoid: '下次别推荐' }[f]}
            </button>
          ))}
        </div>
      </section>
      <details>
        <summary>微调用量和备注</summary>
        {rows.map((r) => {
          const ing = state.ingredients.find((i) => i.id === r.ingredientId)!;
          return (
            <label key={r.id} className="qty-row">
              <span>{ing.name}</span>
              <input inputMode="decimal" aria-label={`${ing.name}默认用量`} placeholder={String(r.qty)} value={qty[r.id] ?? ''} onChange={(e) => setQty({ ...qty, [r.id]: e.target.value })} />
              <span>{ing.unit === 'count' ? ing.countUnit : ing.unit}</span>
            </label>
          );
        })}
        <label className="field">备注<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <div className="row">
          <button className="btn" onClick={save}>保存</button>
          <button className="btn" onClick={() => run('updateRecipe', { recipeId: recipe.id, enabled: !recipe.enabled })}>{recipe.enabled ? '停用这道菜' : '启用这道菜'}</button>
        </div>
      </details>
    </Screen>
  );
}
