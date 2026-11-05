/**
 * 手机上切走再回来只是恢复页面，不算启动，Service Worker 不会自己查更新，
 * 新版本就算装好了，旧页面也不会换。这里在回到前台时查更新，新版本接管后刷新。
 * 数据都在 IndexedDB 里，刷新不丢数据；只有做饭中填到一半的内容会丢，所以等做完再刷新。
 */
export function watchAppUpdate(canReload: () => boolean): () => void {
  const sw = navigator.serviceWorker;
  if (!sw) return () => undefined;
  // 第一次安装时 Service Worker 也会接管页面，那不是更新，不用刷新。
  const hadController = !!sw.controller;
  let ready = false;
  const reloadIfReady = () => { if (ready && canReload()) location.reload(); };
  const onControllerChange = () => {
    if (!hadController) return;
    ready = true;
    reloadIfReady();
  };
  const onVisibility = () => {
    reloadIfReady();
    if (document.visibilityState === 'visible') sw.getRegistration().then((r) => r?.update()).catch(() => undefined);
  };
  sw.addEventListener('controllerchange', onControllerChange);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    sw.removeEventListener('controllerchange', onControllerChange);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
