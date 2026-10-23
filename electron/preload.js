'use strict';
/* GameIntel 壳 · Electron preload（v18）
   ---------------------------------------------------------------------------
   ★v18 新增（工作台 = App 的管理页）：
     · `__SHELL_ADMIN__(act)` —— 开/关独立管理窗（只认动作名，**不接 URL / 路径**）；
     · `__SHELL__.adminPage(act)` / `focusApp()` / `openDlRoot()` —— 管理页动作条用；
       `openDlRoot` **无入参**（目录由主进程算），页面上拿不到「打开任意路径」的能力。

   ★v15 新增 `__SHELL__` 桥 —— 「exe 里能干、网页里干不了」的四件事：

     诉求原话                                              对应桥方法
     ────────────────────────────────────────────────────  ────────────────────────
     「最好是增加一个我的游戏，可以进行扫盘获取到游戏         scanGames()
       的启动器，并对应进行匹配」
     「我需要的是全都能够通过 exe 进行直链下载」              startDownload() / cancelDownload()
     「最好增加一个功能，下载管理进行统一管理」               onDownload()（进度回推）
     「如果能够获取到对应的游戏，则提供下载弹窗」             openPath() / revealPath()
     （网盘链接：复制 + 唤起本机客户端）                      copyText() / openNetdisk()

   安全边界：主进程侧对每个入参都做校验（见 main.js）。
     · scanGames / openDlRoot 无入参，只读本机文件、不外发；
     · startDownload 只接受 http(s)，且落盘目录由主进程决定（页面指定不了路径）；
     · copyText/openPath/revealPath 只作用于主进程自己写出来的文件（见 main.js 的 dlRoots 白名单）；
     · openNetdisk 只做 shell.openExternal，且限 http(s) + 常见网盘域名。
   contextIsolation 保持开启，nodeIntegration 关闭。 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__SHELL_FETCH__', (url) =>
  ipcRenderer.invoke('shell:fetch', String(url))
);
contextBridge.exposeInMainWorld('__SHELL_OPEN__', (p) =>
  ipcRenderer.invoke('shell:open', String(p))
);
/* ★v18：独立「管理页」窗口开关（工作台 = App 的管理页）。
   只暴露动作名，**不接受 URL / 路径** —— 起始页由主进程决定（`/index.html`）。 */
contextBridge.exposeInMainWorld('__SHELL_ADMIN__', (act) =>
  ipcRenderer.invoke('shell:admin', String(act || 'open'))
);

/* ---- ★v15 进度回推：主进程 → 页面 ----
   为什么用「preload 里注册一次 + 分发到回调数组」而不是直接把 ipcRenderer 交给页面：
     页面拿不到 ipcRenderer（contextIsolation），只能用 exposed 的方法。
   ⚠️ contextBridge 会**代理函数参数**（官方支持），所以页面把回调传进来是可行的；
      但页面卸载后旧回调会失效 —— 页面里只注册一次、终身有效（见 index.html 的 SHELL.onDownload 段）。 */
const dlListeners = [];
ipcRenderer.on('shell:dl-progress', (_e, msg) => {
  for (const fn of dlListeners) {
    try { fn(msg); } catch (e) { /* 单个回调出错不影响其它 */ }
  }
});

contextBridge.exposeInMainWorld('__SHELL__', {
  version: 'v24',

  /* 扫盘：Steam 库（libraryfolders.vdf）+ 桌面/开始菜单快捷方式 + 常见游戏目录。
     **只读**，不修改任何文件；结果只在内存里返回给页面。 */
  scanGames: () => ipcRenderer.invoke('shell:scanGames'),

  /* 下载：真直链交给壳内置下载器；网盘链接不在这里走（页面登记为 manual） */
  startDownload: (o) => ipcRenderer.invoke('shell:dl-start', {
    id: String((o && o.id) || ''),
    url: String((o && o.url) || ''),
    name: String((o && o.name) || ''),
  }),
  cancelDownload: (id) => ipcRenderer.invoke('shell:dl-cancel', String(id)),
  onDownload: (cb) => { if (typeof cb === 'function') dlListeners.push(cb); },

  /* 其它本机动作 */
  copyText: (t) => ipcRenderer.invoke('shell:copy', String(t)),
  openNetdisk: (u) => ipcRenderer.invoke('shell:netdisk', String(u)),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', String(p)),
  revealPath: (p) => ipcRenderer.invoke('shell:revealPath', String(p)),

  /* ★v18 管理页（独立窗口）开关 + 管理页动作条要用的两个无参动作 */
  adminPage: (act) => ipcRenderer.invoke('shell:admin', String(act || 'open')),
  focusApp: () => ipcRenderer.invoke('shell:focusApp'),
  openDlRoot: () => ipcRenderer.invoke('shell:openDlRoot'),

  /* ---- ★v19 下载引擎（aria2）—— 已接入，契约不变 ----
       dlEngine(force?)         → { ok, engine:{available,running,version,dir,reason} }
       dlMagnetPreview(magnet)  → { ok, code?, error?, files:[{idx,path,length,selected}], totalBytes }
       dlPause(id) / dlResume(id)→ { ok, code?, error?, id }
     ★ 磁力只传字符串、**不传落盘目录** —— 目录由主进程算（`dlDir()`），
       页面拿不到「让它往任意路径写」的能力。port / RPC secret **永不出主进程**。 */
  dlEngine: (force) => ipcRenderer.invoke('shell:dl-engine', !!force),
  dlMagnetPreview: (magnet) => ipcRenderer.invoke('shell:dl-magnet-preview', String(magnet || '')),
  dlPause: (id) => ipcRenderer.invoke('shell:dl-pause', String(id || '')),
  dlResume: (id) => ipcRenderer.invoke('shell:dl-resume', String(id || '')),

  /* ---- ★v19 管理接口（预留面：给「下载后台」与将来的自动化用）----
     dlList()        → 引擎真值清单（重开 App 后靠它把任务捞回来）
     dlRemove(id)    → 删单个任务（**不删已落盘的文件**）
     dlClear()       → 清空「已结束」记录
     dlStats()       → 全局速度 / 活动数 / 特性 / 运行时长
     dlOptions(o?)   → 不给参数=读；给参数=写（`dir` 会被主进程明确拒绝） */
  dlList: () => ipcRenderer.invoke('shell:dl-list'),
  dlRemove: (id) => ipcRenderer.invoke('shell:dl-remove', String(id || '')),
  dlClear: () => ipcRenderer.invoke('shell:dl-clear'),
  dlStats: () => ipcRenderer.invoke('shell:dl-stats'),
  dlOptions: (o) => ipcRenderer.invoke('shell:dl-options', o === undefined ? null : o),

  /* ★v15 桌面形态：窗口按钮由系统绘制（titleBarOverlay），颜色不跟 CSS 变量走 ⇒ 切主题时同步 */
  setTitlebar: (dark) => ipcRenderer.invoke('shell:titlebar', !!dark),

  /* 只读的「本壳自述」，供页面调试面板显示（不含任何敏感路径） */
  describe: () => ipcRenderer.invoke('shell:describe'),
});
