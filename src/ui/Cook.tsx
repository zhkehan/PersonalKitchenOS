import { useEffect, useMemo, useRef, useState } from 'react';
import { localDate } from '../domain/dates';
import { checkRecipe } from '../domain/recommend';
import type { SlotKind } from '../domain/types';
import { Screen, Stepper } from './components';
import { useKitchen } from './store';

export interface CookRequest {
  recipeId: string;
  variantId?: string;
  servings: number;
  date?: string;
  slot?: 'lunch' | 'dinner';
  snack?: boolean;
  sessionId?: string;
}

const STATUS: Record<string, string> = { ok: '有', unknown: '待核对', short: '不够', missing: '没有', frozen: '还冻着' };

export function Cook({ request, onClose }: { request: CookRequest; onClose: () => void }) {
  const { state, run, now, showToast } = useKitchen();
  const today = localDate(now());
  const recipe = state.recipes.find((r) => r.id === request.recipeId)!;
  const variants = state.recipe_variants.filter((v) => v.recipeId === recipe.id);
  const [variantId, setVariantId] = useState(request.variantId ?? (variants.find((v) => v.isDefault) ?? variants[0]).id);
  const [servings, setServings] = useState(request.servings);
  const [eatNow, setEatNow] = useState(request.snack ? request.servings : 1);
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const sessionRef = useRef<string | null>(request.sessionId ?? null);
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);

  // 进入做饭页只记录「准备中」，不扣任何库存。
  useEffect(() => {
    if (sessionRef.current || request.snack) return;
    sessionRef.current = 'pending';
    void run('startCookSession', {
      recipeId: recipe.id, variantId, servings: request.servings,
      ...(request.date && request.slot ? { date: request.date, slot: request.slot } : {}),
    }, { silent: true }).then((r) => { sessionRef.current = (r?.data as { sessionId?: string } | undefined)?.sessionId ?? null; });
    // 只在进入时开始一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const variant = variants.find((v) => v.id === variantId)!;
  const steps = state.recipe_steps.filter((s) => s.variantId === variantId).sort((a, b) => a.order - b.order);
  const check = useMemo(() => checkRecipe(state, recipe.id, servings, today), [state, recipe.id, servings, today]);
  const quantified = check.lines.filter((l) => l.need !== null && l.role === 'required');

  const leave = async () => {
    const id = sessionRef.current;
    if (id && id !== 'pending') await run('cancelCookSession', { sessionId: id }, { silent: true });
    onClose();
  };

  const finish = async (eat: number) => {
    const list = Object.entries(actuals).filter(([, v]) => v !== '').map(([ingredientId, v]) => ({ ingredientId, qty: Number(v) }));
    const id = sessionRef.current;
    const result = await run('finishCook', {
      ...(id && id !== 'pending' ? { sessionId: id } : { recipeId: recipe.id, variantId }),
      servings, eatNow: eat,
      ...(request.snack ? { date: request.date ?? today, slot: 'snack' as SlotKind } : {}),
      ...(list.length ? { actuals: list } : {}),
    });
    if (result) setFeedbackFor(recipe.id);
  };

  const rate = async (feedback: 'good' | 'meh' | 'avoid' | null) => {
    if (feedback) await run('rateRecipe', { recipeId: recipe.id, feedback }, { silent: true });
    if (feedback) showToast({ text: '记下了' });
    onClose();
  };

  if (feedbackFor) {
    return (
      <Screen title={recipe.name} onBack={onClose}>
        <div className="feedback">
          <h2>味道怎么样？</h2>
          <div className="stack">
            <button className="btn btn-wide" onClick={() => rate('good')}>好吃</button>
            <button className="btn btn-wide" onClick={() => rate('meh')}>一般</button>
            <button className="btn btn-wide" onClick={() => rate('avoid')}>下次别推荐</button>
            <button className="link" onClick={() => rate(null)}>跳过</button>
          </div>
        </div>
      </Screen>
    );
  }

  return (
    <Screen title={recipe.name} onBack={leave} footer={
      <div className="cook-foot">
        {!request.snack && (
          <div className="steppers">
            <Stepper label="做了几份" value={servings} min={1} max={6} onChange={(v) => { setServings(v); setEatNow((e) => Math.min(e, v)); }} />
            <Stepper label="现在吃几份" value={eatNow} min={0} max={servings} onChange={setEatNow} />
          </div>
        )}
        <div className="row">
          <button className="btn btn-primary" disabled={eatNow === 0} onClick={() => finish(eatNow)}>做完并开吃</button>
          {!request.snack && <button className="btn" onClick={() => finish(0)}>只做完不吃</button>}
        </div>
      </div>
    }>
      {variants.length > 1 && (
        <div className="seg" role="tablist" aria-label="做法">
          {variants.map((v) => (
            <button key={v.id} role="tab" aria-selected={v.id === variantId} className={v.id === variantId ? 'on' : ''} onClick={() => setVariantId(v.id)}>
              {v.name}
            </button>
          ))}
        </div>
      )}
      <p className="meta">约 {variant.minutes} 分钟 · {variant.fit}</p>

      <section>
        <h3>食材（{servings} 份）</h3>
        <ul className="ing-list">
          {check.lines.map((l) => (
            <li key={l.ingredientId}>
              <span>{l.name}{l.role === 'optional' ? '（可选）' : ''}</span>
              <span className="ing-right">
                <span>{l.label}</span>
                {l.role === 'required' && l.status !== 'ok' && <span className={`tag ${l.status === 'unknown' ? 'tag-warn' : 'tag-bad'}`}>{STATUS[l.status]}</span>}
              </span>
            </li>
          ))}
        </ul>
        {check.blocked && <p className="unverified">{check.blocked}，记录上不够，但你实际有的话仍可以做，做完会提示核对。</p>}
        <p className="hint">调味：{recipe.seasoningTemplate}。高盐高油的先少放。</p>
      </section>

      <section>
        <h3>步骤</h3>
        <ol className="steps">{steps.map((s) => <li key={s.id}>{s.text}</li>)}</ol>
      </section>

      <details>
        <summary>切法、去腥和安全提示</summary>
        <p>切法：{recipe.cutSize}</p>
        {recipe.odorTip && <p>去腥：{recipe.odorTip}</p>}
        <p>安全：{recipe.safetyTip}</p>
        <p>剩菜：{recipe.leftoverTip}</p>
      </details>

      <details>
        <summary>实际用量和计划不一样？</summary>
        <p className="hint">不填就按菜谱份量记。填 0 表示没用。</p>
        {quantified.map((l) => (
          <label key={l.ingredientId} className="qty-row">
            <span>{l.name}</span>
            <input inputMode="decimal" placeholder={`${l.need}`} aria-label={`${l.name}实际用量`} value={actuals[l.ingredientId] ?? ''} onChange={(e) => setActuals({ ...actuals, [l.ingredientId]: e.target.value })} />
            <span>{l.unit}</span>
          </label>
        ))}
      </details>
    </Screen>
  );
}
