/* _qa_manual.js —— 手工 QA 巡检（不是回归测试，回归请跑 _t_demo.js）
 *
 * 用途：人肉看一眼「各 Tab 到底渲染了几项、弹窗里各字段抓到了什么」。
 * 与 _t_demo.js 的分工：
 *   - _t_demo.js：190 条断言，**判定通过/失败**，CI 用；
 *   - _qa_manual.js：**只打印**，不做断言，排查"为什么这条字段是空的"时用。
 *
 * 跑法：
 *   NODE_PATH="C:/Users/komo/.workbuddy/binaries/node/workspace/node_modules" \
 *   "C:/Users/komo/.workbuddy/binaries/node/versions/22.22.2-6/node.exe" _qa_manual.js
 */
const fs=require('fs'),path=require('path'),{JSDOM}=require('jsdom');
const DIR=__dirname;
const html=fs.readFileSync(path.join(DIR,'index.html'),'utf-8')
  .replace(/<script src="data\.js"><\/script>/,'<script>'+fs.readFileSync(path.join(DIR,'data.js'),'utf-8').replace(/<\/script/gi,'<\\/script')+'</script>');
const errs=[];
const vc=new (require('jsdom').VirtualConsole||Object)();
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true});
const win=dom.window,doc=win.document;
win.addEventListener('error',e=>errs.push('window.error: '+e.message));
console.log('脚本错误:',errs.length?errs.join('\n'):'无');
const TABS=['pcNew','pcHot','pcRank','pcTrainer','pcMod','mNew','mEvent','mPlay','report'];
for(const k of TABS){
  try{
    win.eval(`resetState("${k}"); render();`);
    const n=doc.querySelectorAll('#main .card, #main .mcard, #main .ritem').length;
    console.log(`  ${k.padEnd(10)} 渲染 ${String(n).padStart(3)} 项`);
  }catch(e){ console.log(`  ${k} ✗ ${e.message}`); }
}
console.log('\n===== 弹窗检查（各 Tab 各取第一条）=====');
for(const k of TABS){
  if(k==='report') continue;
  try{
    win.eval(`resetState("${k}"); render();`);
    const c=doc.querySelector('#main .card[data-d], #main .mcard[data-d]');
    if(!c){ console.log(`  ${k} 无卡片`); continue; }
    c.dispatchEvent(new win.MouseEvent('click',{bubbles:true}));
    const dlg=doc.getElementById('dlg');
    const kv=dlg.querySelectorAll('.dkv .it').length;
    const blk=dlg.querySelectorAll('.dblock').length;
    const lnk=dlg.querySelectorAll('.dlinks a').length;
    console.log(`  ${k.padEnd(10)} 标题="${(dlg.querySelector('.dhtitle h2')||{}).textContent}" | 副标题="${(dlg.querySelector('.dhtitle .hen')||{}).textContent||'-'}" | 徽标="${(dlg.querySelector('.dsrc')||{}).textContent||'-'}" | 大数字="${(dlg.querySelector('.sbig')||{}).textContent||'-'}" | KV=${kv} 区块=${blk} 链接=${lnk}`);
    win.eval('closeDetail()');
  }catch(e){ console.log(`  ${k} ✗ ${e.message} @ ${String(e.stack).split('\n')[1]}`); }
}
console.log('\n===== 具体样例 =====');
win.eval('resetState("pcHot"); render();');
console.log('PC热游卡片:\n', doc.querySelector('#main .card').outerHTML.replace(/onload="[^"]*"/g,'').replace(/onerror="[^"]*"/g,'').replace(/\s+/g,' '));
win.eval('resetState("mNew"); render();');
console.log('\n手游新游卡片:\n', doc.querySelector('#main .mcard').outerHTML.replace(/onload="[^"]*"/g,'').replace(/onerror="[^"]*"/g,'').replace(/\s+/g,' '));
const none=[...doc.querySelectorAll('#main .mscore')].filter(e=>e.classList.contains('none'));
console.log('\n右侧占位「—」的卡片数:',none.length);
