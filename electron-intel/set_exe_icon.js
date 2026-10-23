'use strict';
/* 把 .ico 打进 exe 的 PE 资源段（★v13）
   ---------------------------------------------------------------------------
   为什么必须有这一步：
     `BrowserWindow.icon` 管的是**窗口/任务栏**的图标；
     而资源管理器里看到的 exe 文件图标、以及任务栏「已固定」时的图标，
     都来自 **exe 自身 PE 资源段里的 RT_GROUP_ICON**。
     后者改不了「只是换个文件名」是治不好的 —— electron.exe 原样拷过来，
     它的资源段里还是 Electron 那个原子图标。

   工具选型：用 npm 的 `resedit`（**纯 JS** 读写 PE 资源）。
     为什么不用 electron-builder 自带的 rcedit.exe：
       · rcedit 是外部二进制，要额外下载 + 过杀软；resedit 是纯 JS，装完即用；
       · 本项目**刻意不引入 electron-builder**（它会把打包链拉长一大截，
         而我们只需要「拷贝 electron 发行版 + 换图标」两件事）。
     为什么不用 ResourceHacker：GUI 工具，没法进自动化脚本。

   用法：node set_exe_icon.js <exe 路径> <ico 路径>
   依赖：resedit（装在 E:/_iconwork/node_modules，通过 NODE_PATH 传进来）
   --------------------------------------------------------------------------- */
const fs = require('fs');
const ResEdit = require('resedit');

const exePath = process.argv[2];
const icoPath = process.argv[3];
if (!exePath || !icoPath) {
  console.error('用法: node set_exe_icon.js <exe> <ico>');
  process.exit(2);
}

const buf = fs.readFileSync(exePath);
const icoBuf = fs.readFileSync(icoPath);

const exe = ResEdit.NtExecutable.from(buf, { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exe);

/* 先看这份 exe 里都有哪些图标组 —— 不写死 ID，避免换 Electron 版本后打空 */
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
if (!groups.length) {
  console.error('!! 这个 exe 里没有 RT_GROUP_ICON，无法替换');
  process.exit(3);
}
console.log('现有图标组: ' + groups.map((g) => `id=${g.id} lang=${g.lang}`).join(', '));

const iconFile = ResEdit.Data.IconFile.from(icoBuf);
console.log(`源 .ico 帧数: ${iconFile.icons.length}`);

let n = 0;
for (const g of groups) {
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    g.id,
    g.lang,
    iconFile.icons.map((i) => i.data)
  );
  n++;
}
res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log(`OK 已替换 ${n} 个图标组 → ${exePath}`);
