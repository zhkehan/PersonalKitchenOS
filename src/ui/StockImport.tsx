import { previewStockLink, stockLinkKey, type StockLink } from '../domain/stockLink';
import { Screen } from './components';
import { useKitchen } from './store';

/** 打开库存链接后的确认页。不确认就什么都不写。 */
export function StockImport({ link, onClose }: { link: StockLink; onClose: () => void }) {
  const { state, run } = useKitchen();
  const p = previewStockLink(state, link);
  const count = p.entries.length + p.have.length;

  const confirm = async () => {
    onClose();
    await run('importStock', { entries: p.entries, have: p.have }, { key: stockLinkKey(link.id) });
  };

  return (
    <Screen title="导入库存" onBack={onClose} footer={
      <button className="btn btn-primary btn-wide" disabled={count === 0} onClick={confirm}>确认导入 {count} 项</button>
    }>
      <p className="hint">下面这些食材的库存会设成这个数量，原来记的数量会被替换；调料标记为「有」。确认后可以撤销。</p>
      {p.lines.length > 0 && (
        <section>
          <h3>食材 {p.lines.length} 项</h3>
          <ul className="ing-list">{p.lines.map((l) => <li key={l.name}><span>{l.name}</span><span>{l.label}</span></li>)}</ul>
        </section>
      )}
      {p.haveNames.length > 0 && (
        <section>
          <h3>调料 {p.haveNames.length} 种</h3>
          <p className="meta">{p.haveNames.join('、')}</p>
        </section>
      )}
      {p.skipped.length > 0 && <p className="unverified">这台手机上对不上，会跳过：{p.skipped.join('、')}</p>}
    </Screen>
  );
}
