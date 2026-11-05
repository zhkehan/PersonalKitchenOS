import { useEffect, type ReactNode } from 'react';
import type { Reality } from '../domain/types';
import { useKitchen } from './store';

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="关闭" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Screen({ title, onBack, children, footer }: { title: string; onBack: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="screen" role="dialog" aria-label={title}>
      <header className="screen-head">
        <button className="icon-btn" aria-label="返回" onClick={onBack}>‹</button>
        <h1>{title}</h1>
      </header>
      <div className="screen-body">{children}</div>
      {footer && <div className="screen-foot">{footer}</div>}
    </div>
  );
}

export function Stepper({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <div className="stepper">
      <span>{label}</span>
      <div className="stepper-ctl">
        <button aria-label={`减少${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}>−</button>
        <output aria-label={label}>{value}</output>
        <button aria-label={`增加${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}>+</button>
      </div>
    </div>
  );
}

export function RealityTag({ reality }: { reality: Reality }) {
  const map: Record<Reality, [string, string]> = {
    mentioned: ['待核对', 'tag-warn'],
    confirmed_present_unknown_qty: ['数量未知', 'tag-warn'],
    confirmed_qty: ['已核实', 'tag-ok'],
    out: ['没有', 'tag-bad'],
  };
  const [text, cls] = map[reality];
  return <span className={`tag ${cls}`}>{text}</span>;
}

export function ToastView() {
  const { toast, dismissToast, undo } = useKitchen();
  if (!toast) return null;
  return (
    <div className={`toast${toast.error ? ' toast-error' : ''}`} role="status">
      <div className="toast-body">
        <strong>{toast.text}</strong>
        {toast.lines.map((l) => <div key={l}>{l}</div>)}
        {toast.warnings.map((w) => <div key={w} className="toast-warn">注意：{w}</div>)}
      </div>
      <div className="toast-actions">
        {toast.undoId && <button onClick={() => { const id = toast.undoId!; dismissToast(); void undo(id); }}>撤销</button>}
        <button aria-label="关闭提示" onClick={dismissToast}>✕</button>
      </div>
    </div>
  );
}
