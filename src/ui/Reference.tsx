import { useState } from 'react';
import { NUTRITION_FACTS, nutritionLine } from '../domain/nutrition';
import { DIPS, HOT_SAUCES, MARINADE_NOTE, MARINADES, TEMPLATES } from '../domain/references';
import { Screen } from './components';

type Tab = 'quick' | 'sauce' | 'marinade' | 'nutrition';
const TABS: [Tab, string][] = [['quick', '速查'], ['sauce', '酱汁'], ['marinade', '腌料'], ['nutrition', '营养']];

/** 只读资料页。吃了多少在「营养记录」里看。 */
export function Reference({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('quick');
  const proteins = [...new Set(TEMPLATES.map((t) => t.protein))];
  return (
    <Screen title="厨房资料" onBack={onClose}>
      <div className="chips" role="group" aria-label="资料分类">
        {TABS.map(([id, label]) => <button key={id} className={`chip${tab === id ? ' chip-on' : ''}`} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}
      </div>

      {tab === 'quick' && proteins.map((p) => (
        <section key={p}>
          <h3>{p}</h3>
          <ul className="ref-list">{TEMPLATES.filter((t) => t.protein === p).map((t) => <li key={t.name}><strong>{t.name}</strong><span className="meta">{t.formula}</span></li>)}</ul>
        </section>
      ))}

      {tab === 'sauce' && (
        <>
          <section>
            <h3>热菜酱汁</h3>
            <p className="hint">份量按勺计，可按食材量同比例放大。</p>
            <ul className="ref-list">
              {HOT_SAUCES.map((s) => (
                <li key={s.name}>
                  <strong>{s.name}</strong>
                  <span className="meta">适合 {s.fit}</span>
                  <span>{s.formula}</span>
                  <span className="meta">{s.method}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3>万能蘸汁</h3>
            <ul className="ref-list">{DIPS.map((d) => <li key={d.name}><strong>{d.name}</strong><span>{d.formula}</span><span className="meta">{d.use}</span></li>)}</ul>
          </section>
        </>
      )}

      {tab === 'marinade' && (
        <>
          <p className="hint">{MARINADE_NOTE}</p>
          {MARINADES.map((m) => (
            <section key={m.name}>
              <h3>{m.name}</h3>
              <p className="meta">{m.trait}</p>
              <p>{m.prep}</p>
              <table className="ref-table">
                <thead><tr><th>材料</th><th>{m.bases[0]}</th><th>{m.bases[1]}</th></tr></thead>
                <tbody>{m.rows.map((r) => <tr key={r.item}><td>{r.item}<span className="ref-role">{r.role}</span></td><td>{r.amounts[0]}</td><td>{r.amounts[1]}</td></tr>)}</tbody>
              </table>
              <ol className="ref-steps">{m.steps.map((s) => <li key={s}>{s}</li>)}</ol>
            </section>
          ))}
        </>
      )}

      {tab === 'nutrition' && (
        <section>
          <p className="hint">优先用你实际买的产品标签和饮食营养清单，没有的取自 USDA。营养估算用的就是这份数字，今天吃了多少在今天页底部的「营养记录」里看。</p>
          <ul className="ref-list">
            {NUTRITION_FACTS.map((n) => (
              <li key={`${n.name}${n.serving}`}>
                <strong>{n.name}</strong>
                <span className="meta">{n.serving}{n.fdcId ? ' · USDA' : ''}</span>
                <span>{nutritionLine(n)}</span>
                {n.note && <span className="hint">{n.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Screen>
  );
}
