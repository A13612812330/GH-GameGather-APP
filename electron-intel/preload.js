'use strict';
/* 游戏情报客户端 · Electron preload
   ---------------------------------------------------------------------------
   只做一件事：把「主进程代取远端文本」暴露给页面，供 demo 的在线数据更新使用。

   为什么必须绕这一道：打包后页面走 `file://` 协议，其 Origin 是 `null`，
   直接 fetch 线上 data.js 会被 CORS 拦掉。主进程用的是 Node 的 https，
   没有同源策略，天然绕开。

   安全边界：**只暴露一个函数**，且主进程侧对 URL 做白名单校验（见 main.js）。
   不做任何 nodeIntegration，contextIsolation 保持开启。 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__SHELL_FETCH__', (url) =>
  ipcRenderer.invoke('shell:fetch', String(url))
);
