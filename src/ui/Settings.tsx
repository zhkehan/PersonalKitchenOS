import { useEffect, useRef, useState } from 'react';
import { helperStatus, loadAiSettings, saveAiSettings, type AiSettings, type HelperStatus } from '../ai/client';
import { backupFilename, BackupError, consumptionCsv, eventsCsv, exportBackup, inventoryCsv, restoreBackup } from '../data/backup';
import { Screen } from './components';
import { useKitchen } from './store';

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const STATUS: Record<HelperStatus['state'], string> = {
  off: 'AI 已关闭。基础功能不受影响，一句话输入用本地规则识别（不是 AI）。',
  no_key: '还没填 Gemini API Key。没填时用本地规则识别（不是 AI）。',
  unreachable: 'AI 暂不可用：连不上辅助服务（电脑可能关机）。基础功能不受影响。',
  unauthorized: '配对口令不对。',
  no_provider: '辅助服务在线，但没有配置模型。',
  ready: 'AI 可用',
};

export function Settings({ onClose }: { onClose: () => void }) {
  const { db, state, now, refresh, showToast, run } = useKitchen();
  const [ai, setAi] = useState<AiSettings>(loadAiSettings);
  const [status, setStatus] = useState<HelperStatus | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [pendingFile, setPendingFile] = useState<{ raw: unknown; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastExport = [...state.backup_metadata].filter((b) => b.kind === 'export').sort((a, b) => b.at.localeCompare(a.at))[0];
  const secure = window.isSecureContext;

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);

  useEffect(() => {
    let live = true;
    helperStatus(ai).then((s) => { if (live) setStatus(s); });
    return () => { live = false; };
  }, [ai]);

  const update = (p: Partial<AiSettings>) => {
    const next = { ...ai, ...p };
    setAi(next);
    saveAiSettings(next);
  };

  const exportJson = async () => {
    const backup = await exportBackup(db, now());
    download(backupFilename(now()), JSON.stringify(backup), 'application/json');
    await refresh();
    showToast({ text: '备份已导出。把文件存到手机以外的地方更安全。' });
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      setPendingFile({ raw: JSON.parse(await file.text()), name: file.name });
    } catch {
      showToast({ text: '这不是合法的备份文件', error: true });
    }
  };

  const restore = async () => {
    if (!pendingFile) return;
    try {
      await restoreBackup(db, pendingFile.raw, now());
      setPendingFile(null);
      await refresh();
      showToast({ text: '已恢复。当前数据已被备份内容替换。' });
    } catch (e) {
      setPendingFile(null);
      showToast({ text: e instanceof BackupError ? e.message : '恢复失败，原数据没有变化', error: true });
    }
  };

  return (
    <Screen title="设置" onBack={onClose}>
      <section>
        <h3>备份（数据只在这台设备上）</h3>
        <p className="hint">{lastExport ? `上次备份：${lastExport.at.slice(0, 10)}` : '还没有备份过。'} 浏览器存储可能被清理，也不会自动同步到别的设备，建议每两周导出一次。</p>
        <div className="stack">
          <button className="btn btn-wide" onClick={exportJson}>导出完整备份（JSON）</button>
          <button className="btn btn-wide" onClick={() => fileRef.current?.click()}>从备份恢复</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-label="选择备份文件" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        {pendingFile && (
          <div className="confirm-box" role="alert">
            <p>用「{pendingFile.name}」替换当前全部数据？这一步不能撤销。</p>
            <div className="row">
              <button className="btn btn-danger" onClick={restore}>确认替换</button>
              <button className="btn" onClick={() => setPendingFile(null)}>取消</button>
            </div>
          </div>
        )}
        <details>
          <summary>导出 CSV</summary>
          <div className="stack">
            <button className="btn btn-wide" onClick={() => download('inventory.csv', inventoryCsv(state), 'text/csv')}>库存批次</button>
            <button className="btn btn-wide" onClick={() => download('inventory-events.csv', eventsCsv(state), 'text/csv')}>库存流水</button>
            <button className="btn btn-wide" onClick={() => download('consumption.csv', consumptionCsv(state), 'text/csv')}>食用记录</button>
          </div>
        </details>
        {navigator.storage?.persist && (
          persisted
            ? <p className="hint">已申请持久存储：浏览器不会主动清理，但这仍不等于备份。</p>
            : <button className="link" onClick={async () => setPersisted(await navigator.storage.persist())}>申请持久存储，降低被浏览器清理的风险</button>
        )}
      </section>

      <section>
        <h3>AI 助手</h3>
        <p className="status-line">{status ? (status.state === 'ready' ? `AI 可用：${status.provider} / ${status.model}` : STATUS[status.state]) : '检查中…'}</p>
        <label className="toggle"><input type="checkbox" checked={ai.enabled} onChange={(e) => update({ enabled: e.target.checked })} /> 使用 AI 理解一句话</label>
        {ai.enabled && (
          <>
            <label className="field">连接方式
              <select value={ai.mode} onChange={(e) => update({ mode: e.target.value as AiSettings['mode'] })}>
                <option value="direct">手机直连 Gemini（电脑关机也能用）</option>
                <option value="helper">电脑辅助服务</option>
              </select>
            </label>
            {ai.mode === 'direct' ? (
              <>
                <label className="field">Gemini API Key<input type="password" autoComplete="off" spellCheck={false} value={ai.geminiKey} onChange={(e) => update({ geminiKey: e.target.value.trim() })} /></label>
                <p className="hint">在 aistudio.google.com/apikey 创建。Key 只存在这台设备的浏览器里，不进备份。手机丢了就到 Google 后台删掉这个 Key。</p>
                {ai.geminiKey && <button className="link" onClick={() => update({ geminiKey: '' })}>删除这台设备上的 Key</button>}
              </>
            ) : (
              <>
                <label className="field">辅助服务地址<input value={ai.url} placeholder="留空表示当前网址" onChange={(e) => update({ url: e.target.value.trim() })} /></label>
                <label className="field">配对口令<input type="password" autoComplete="off" value={ai.token} onChange={(e) => update({ token: e.target.value.trim() })} /></label>
              </>
            )}
          </>
        )}
        <details>
          <summary>会发送什么？</summary>
          <p className="hint">开启后，发给模型（手机直连或经电脑辅助服务）的只有：你这句话、今天和明天的餐次安排、熟菜名称、菜谱名称、当前日期。不发送库存数量、流水、价格、备份。选本地 Ollama 时数据不出电脑；选云端时这些内容会发给云服务商。Gemini 免费版的内容可能被 Google 用于改进产品。</p>
          <p className="hint">Key、地址和口令只存在这台设备的浏览器里，不进备份，也不在网站代码里。</p>
        </details>
        <button className="link" onClick={() => run('clearAiHistory', {}, {})}>清除 AI 原话和草稿</button>
      </section>

      <section>
        <h3>这台设备</h3>
        <ul className="plain">
          <li>安全上下文：{secure ? '是（可离线、可安装）' : '否（普通 http，无法离线和安装）'}</li>
          <li>同步：没有。数据只在这个浏览器里，换设备用备份文件搬家。</li>
          <li>计划版本 {state.meal_plan_versions.length} · 库存流水 {state.inventory_events.length} 条</li>
        </ul>
      </section>
    </Screen>
  );
}
