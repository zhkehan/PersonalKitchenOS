import { useEffect, useState } from 'react';
import { consumePairingLink } from '../ai/client';
import { hasStockLink, readStockLink, stockLinkKey, type StockLink } from '../domain/stockLink';
import { ToastView } from './components';
import { Cook, type CookRequest } from './Cook';
import { Home } from './Home';
import { Inventory } from './Inventory';
import { Nutrition } from './Nutrition';
import { Plan } from './Plan';
import { Recipes } from './Recipes';
import { Settings } from './Settings';
import { Shopping } from './Shopping';
import { StockImport } from './StockImport';
import { useKitchen } from './store';

type Tab = 'today' | 'recipes' | 'inventory' | 'shopping';
const TABS: [Tab, string, string][] = [['today', '今天', '🍳'], ['recipes', '菜谱', '📖'], ['inventory', '库存', '🧺'], ['shopping', '采购', '🛒']];

export interface Nav {
  cook: (r: CookRequest) => void;
  plan: () => void;
  nutrition: () => void;
  settings: () => void;
  tab: (t: Tab) => void;
  calibrate: () => void;
}

export function App() {
  const { state, showToast, dismissToast } = useKitchen();
  const [tab, setTab] = useState<Tab>('today');
  const [cook, setCook] = useState<CookRequest | null>(null);
  const [overlay, setOverlay] = useState<'plan' | 'nutrition' | 'settings' | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [stockLink, setStockLink] = useState<StockLink | null>(null);

  useEffect(() => {
    if (consumePairingLink()) showToast({ text: 'AI 辅助服务配对成功' });
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, [showToast]);

  useEffect(() => {
    const check = () => {
      if (!hasStockLink(location.hash)) return;
      const link = readStockLink(location.hash);
      history.replaceState(null, '', location.pathname + location.search);
      if (!link) showToast({ text: '这个库存链接打不开', error: true });
      else if (state.audit_events.some((a) => a.idempotencyKey === stockLinkKey(link.id))) showToast({ text: '这份库存清单已经导入过了' });
      else setStockLink(link);
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, [state.audit_events, showToast]);

  // 上次没做完就退出了：继续那次做饭，而不是另起一次。
  const active = state.cook_sessions.find((s) => s.status === 'started');
  const resume = !cook && active ? active : null;

  const nav: Nav = {
    cook: (r) => { dismissToast(); setCook(r); },
    plan: () => setOverlay('plan'),
    nutrition: () => setOverlay('nutrition'),
    settings: () => setOverlay('settings'),
    tab: setTab,
    calibrate: () => { setCalibrating(true); setTab('inventory'); },
  };

  return (
    <div className="app">
      {!online && <div className="offline-bar">离线中：做饭、库存、采购都能照常用</div>}
      <main className="tab-body">
        {resume && (
          <button className="resume" onClick={() => nav.cook({ recipeId: resume.recipeId, variantId: resume.variantId, servings: resume.plannedServings, sessionId: resume.id })}>
            正在做「{state.recipes.find((r) => r.id === resume.recipeId)?.name}」，点这里继续
          </button>
        )}
        {tab === 'today' && <Home nav={nav} />}
        {tab === 'recipes' && <Recipes nav={nav} />}
        {tab === 'inventory' && <Inventory calibrating={calibrating} setCalibrating={setCalibrating} />}
        {tab === 'shopping' && <Shopping />}
      </main>
      <nav className="tabs" aria-label="主导航">
        {TABS.map(([id, label, icon]) => (
          <button key={id} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
            <span aria-hidden="true">{icon}</span>{label}
          </button>
        ))}
      </nav>
      {overlay === 'plan' && <Plan onClose={() => setOverlay(null)} nav={nav} />}
      {overlay === 'nutrition' && <Nutrition onClose={() => setOverlay(null)} />}
      {overlay === 'settings' && <Settings onClose={() => setOverlay(null)} />}
      {cook && <Cook request={cook} onClose={() => setCook(null)} />}
      {stockLink && <StockImport link={stockLink} onClose={() => setStockLink(null)} />}
      <ToastView />
    </div>
  );
}
