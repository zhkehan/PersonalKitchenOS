import { useState } from 'react';
import { interpret, loadAiSettings, type Interpretation } from '../ai/client';
import { makeCtx, newId } from '../data/db';
import { applyClarify, resolveProposal, type ClarifyOption, type Resolution } from '../domain/ai/resolve';
import type { CommandName } from '../domain/commands';
import { preview } from '../domain/engine';
import { DomainError } from '../domain/tx';
import type { AiActionProposal } from '../domain/types';
import type { Nav } from './App';
import { Sheet } from './components';
import { useKitchen } from './store';

type Quick = 'out' | 'snack' | 'fix' | null;

/** 一句话告诉厨房：解析 → 预览 → 用户确认。确认前不写任何事实数据。 */
export function Assistant({ nav, onQuick }: { nav: Nav; onQuick: (s: Quick) => void }) {
  const { state, db, now, run, showToast } = useKitchen();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<Interpretation | null>(null);
  const [said, setSaid] = useState('');
  const [proposalId, setProposalId] = useState('');
  const [number, setNumber] = useState('');

  const logProposal = async (i: Interpretation, source: string, id: string) => {
    const r = i.resolution;
    const row: AiActionProposal = {
      id, at: now().toISOString(), sourceText: source, provider: i.providerLabel, raw: i.raw,
      validation: r.type === 'rejected' ? 'rejected' : r.type === 'clarify' || r.type === 'ask_number' ? 'clarify' : r.type === 'preview' ? 'ok' : 'read_only',
      errors: r.type === 'rejected' ? r.errors : [], command: r.type === 'preview' ? r.command : null, input: r.type === 'preview' ? r.input : null,
      summary: r.type === 'preview' ? r.result.summary : '', status: 'draft', operationId: null, rev: 0,
    };
    await db.store('ai_action_proposals').put(row as never);
  };

  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    const id = newId('prop');
    const result = await interpret(state, makeCtx(now()), t, loadAiSettings());
    await logProposal(result, t, id);
    setBusy(false);
    setProposalId(id);
    setSaid(t);
    setNumber('');
    if (result.resolution.type === 'filter') {
      // 只是今天的筛选条件，不是事实：直接生效，低打扰。
      await run('setConstraint', result.resolution.input, { silent: true });
      const why = result.resolution.recommendation.excluded.slice(0, 2).map((e) => `${e.name}：${e.why}`);
      showToast({ text: result.resolution.note ?? '已按这个条件重新推荐', lines: why });
      setText('');
      return;
    }
    setView(result);
  };

  const close = () => { setView(null); };

  const confirm = async (command: CommandName, input: unknown) => {
    const result = await run(command, input, { key: `proposal:${proposalId}` });
    if (result) {
      const row = await db.store('ai_action_proposals').get(proposalId);
      if (row) await db.store('ai_action_proposals').put({ ...row, status: 'confirmed', operationId: result.operationId });
    }
    setText('');
    close();
  };

  const replace = (resolution: Resolution) => view && setView({ ...view, resolution });

  const choose = (r: Extract<Resolution, { type: 'clarify' }>, o: ClarifyOption) => {
    if (o.command) {
      try {
        replace({ type: 'preview', proposal: r.proposal, command: o.command, input: o.input, result: preview(state, makeCtx(now()), o.command, o.input) });
      } catch (e) {
        replace({ type: 'rejected', reason: e instanceof DomainError ? e.message : '无法完成', errors: [] });
      }
    } else {
      replace(applyClarify(state, makeCtx(now()), r.proposal, o, said));
    }
  };

  const fillNumber = (r: Extract<Resolution, { type: 'ask_number' }>) => {
    const proposal = { ...r.proposal, requested_change: { ...r.proposal.requested_change, quantity: Number(number), unit: r.unit, delta: null } };
    replace(resolveProposal(state, makeCtx(now()), proposal, said + number));
  };

  const r = view?.resolution;
  return (
    <>
      <form className="say" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <input aria-label="一句话告诉厨房" placeholder="一句话告诉厨房：今天中午在外面吃了…" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
        <button className="btn" disabled={busy || !text.trim()}>{busy ? '…' : '发送'}</button>
      </form>

      {view && r && (
        <Sheet title={r.type === 'preview' ? '这样调整？' : r.type === 'rejected' ? '没能处理' : '厨房助手'} onClose={close}>
          {view.degraded && <p className="unverified">{view.degraded}</p>}

          {r.type === 'preview' && (
            <>
              <p className="lead">{r.result.summary}</p>
              <ul className="plain">{r.result.details.map((d) => <li key={d}>{d}</li>)}</ul>
              {r.result.warnings.map((w) => <p key={w} className="unverified">{w}</p>)}
              <div className="row">
                <button className="btn btn-primary" onClick={() => confirm(r.command, r.input)}>确认调整</button>
                <button className="btn" onClick={close}>取消</button>
              </div>
            </>
          )}

          {r.type === 'clarify' && (
            <>
              <p className="lead">{r.question}</p>
              <div className="row">{r.options.map((o) => <button key={o.label} className="btn" onClick={() => choose(r, o)}>{o.label}</button>)}</div>
            </>
          )}

          {r.type === 'ask_number' && (
            <>
              <p className="lead">{r.question}</p>
              <div className="row">
                <input aria-label="数量" inputMode="decimal" value={number} onChange={(e) => setNumber(e.target.value)} />
                <span>{r.unit}</span>
                <button className="btn" disabled={number === ''} onClick={() => fillNumber(r)}>继续</button>
              </div>
            </>
          )}

          {r.type === 'answer' && (
            <>
              <p className="lead">{r.text}</p>
              {r.recommendation?.primary && (
                <ul className="plain">{[r.recommendation.primary, ...r.recommendation.alternates].map((p) => <li key={p.title}>{p.title}{p.reasons[0] ? `：${p.reasons[0]}` : ''}</li>)}</ul>
              )}
              {r.snacks && (
                <div className="stack">
                  {r.snacks.map((s) => <button key={s.title} className="btn btn-wide" onClick={() => { close(); onQuick('snack'); }}>{s.title}</button>)}
                </div>
              )}
              {r.shopping && (
                <ul className="plain">{r.shopping.map((i) => <li key={i.ingredientId}>{i.name}：{i.packLabel}</li>)}</ul>
              )}
              {r.openRecipeId && (
                <button className="btn btn-primary btn-wide" onClick={() => { const id = r.openRecipeId!; close(); nav.cook({ recipeId: id, servings: 2 }); }}>打开菜谱</button>
              )}
            </>
          )}

          {r.type === 'rejected' && (
            <>
              <p className="lead">{r.reason}</p>
              <div className="stack">
                <button className="btn btn-wide" onClick={() => { close(); onQuick('out'); }}>一顿外食 / 只做一顿</button>
                <button className="btn btn-wide" onClick={() => { close(); onQuick('snack'); }}>训练后加餐</button>
                <button className="btn btn-wide" onClick={() => { close(); onQuick('fix'); }}>吃掉剩菜 / 修正记录</button>
              </div>
            </>
          )}

          <p className="source">由{view.source === 'ai' ? ` AI（${view.providerLabel}）` : '本地规则（非 AI）'}理解 · 库存由程序计算</p>
        </Sheet>
      )}
    </>
  );
}
