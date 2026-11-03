// ================== WEBSITE: ACCOUNTS, SAVE SLOTS, CLOUD SAVE ==================
let gameReady=false,loopStarted=false,iconsMade=false,me=null,slot=1,guest=false,cloudBusy=false,lastCloudOk=0,saveLabel='';
let gateView='login',slotData=null,slotDelArm=0,gateErr='',gateBusy=false;
const gateEl=$('gate'),gboxEl=$('gbox'),acctBtn=$('acctBtn');
const GUEST_KEY=s=>`foundryline_guest_slot_${s}`;
async function api(p,opt={}){
  const r=await fetch('/api'+p,{credentials:'same-origin',...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})}});
  let j={};try{j=await r.json()}catch(e){}
  if(!r.ok){const er=new Error(j.error||`Request failed (${r.status})`);er.status=r.status;throw er}
  return j;
}
function metaNow(){return{playTime:Math.floor(playTime),techs:techs.size,buildings:ents.length-1,won,day:Math.floor(playTime/DAY)+1}}
function ago(iso){if(!iso)return'';const s=Math.max(0,(Date.now()-new Date(iso).getTime())/1000);if(s<60)return'just now';if(s<3600)return Math.floor(s/60)+' min ago';if(s<86400)return Math.floor(s/3600)+' h ago';return Math.floor(s/86400)+' days ago'}
function setSaveLabel(t){saveLabel=t;renderAcctBtn()}
function renderAcctBtn(){acctBtn.innerHTML=`${esc(guest?'Guest':me?me.username:'Account')} <kbd>${esc(saveLabel||'menu')}</kbd>`}

// ---- local + cloud saving (replaces the single-player save) ----
save=function(){
  if(!gameReady)return;
  let data;try{data=serialize()}catch(e){return}
  if(guest){try{localStorage.setItem(GUEST_KEY(slot),JSON.stringify({data,meta:metaNow(),at:new Date().toISOString()}));setSaveLabel('saved')}catch(e){setSaveLabel('storage full')}}
  else if(me){try{localStorage.setItem(`foundryline_backup_${me.username}_${slot}`,data)}catch(e){}}
};
async function cloudSave(){
  if(!gameReady||guest||!me||cloudBusy)return true;
  cloudBusy=true;setSaveLabel('saving');
  try{await api('/saves/'+slot,{method:'PUT',body:JSON.stringify({data:serialize(),meta:metaNow()})});lastCloudOk=Date.now();setSaveLabel('saved');return true}
  catch(e){if(e.status===401){setSaveLabel('signed out');toast('You were signed out. Open the account menu to log in again.')}else setSaveLabel('not saved');return false}
  finally{cloudBusy=false}
}
setInterval(()=>{if(gameReady&&!guest)cloudSave()},45000);
setInterval(()=>{if(gameReady&&!guest&&lastCloudOk)setSaveLabel(Date.now()-lastCloudOk<90000?'saved':'saved '+ago(new Date(lastCloudOk).toISOString()))},30000);
addEventListener('visibilitychange',()=>{if(document.hidden&&gameReady&&!guest)cloudSave()});
addEventListener('pagehide',()=>{
  if(!gameReady||guest||!me)return;
  try{const body=JSON.stringify({data:serialize(),meta:metaNow()});if(body.length<60000)navigator.sendBeacon('/api/saves/'+slot,new Blob([body],{type:'application/json'}))}catch(e){}
});
addEventListener('beforeunload',ev=>{if(gameReady&&!guest&&me&&Date.now()-lastCloudOk>50000){cloudSave();ev.preventDefault();ev.returnValue=''}});

// ---- blueprint sync ----
let bpTimer=null;
saveBP=function(){
  try{localStorage.setItem(BP_KEY,JSON.stringify(blueprints))}catch(e){}
  if(me&&!guest){clearTimeout(bpTimer);bpTimer=setTimeout(()=>api('/blueprints',{method:'PUT',body:JSON.stringify({blueprints})}).catch(()=>{}),1500)}
};
async function syncBlueprints(){
  try{const r=await api('/blueprints');const list=(r.blueprints||[]).filter(validBP);
    if(list.length)blueprints=list;else if(blueprints.length)saveBP()}catch(e){}
}

// ---- gate screens ----
function showGate(view){gameReady=false;gateView=view;gateErr='';slotDelArm=0;closeAll();gateEl.hidden=false;renderGate();if(view==='slots')loadSlots()}
function renderGate(){
  if(gateView==='login'||gateView==='register'){
    const reg=gateView==='register';
    gboxEl.className='gbox panel';
    gboxEl.innerHTML=`<h1 class="glogo">Foundry<span>Line</span></h1>
      <p class="gsub">Build a factory, automate every step, and launch a rocket. Log in to keep your factories in the cloud and play from any computer.</p>
      <div class="gtabs"><button class="btn ${reg?'':'on'}" data-g="tab-login" type="button">Log in</button><button class="btn ${reg?'on':''}" data-g="tab-register" type="button">Create account</button></div>
      <form id="authForm" autocomplete="on" novalidate>
        <div class="field"><label for="gUser">Username</label><input id="gUser" name="username" autocomplete="username" maxlength="24" required>${reg?'<small>3–24 letters, numbers, dashes or underscores.</small>':''}</div>
        <div class="field"><label for="gPass">Password</label><input id="gPass" name="password" type="password" autocomplete="${reg?'new-password':'current-password'}" maxlength="200" required>${reg?'<small>At least 8 characters.</small>':''}</div>
        <div class="gerr" id="gErr" role="alert">${esc(gateErr)}</div>
        <button class="btn pri gbtn" type="submit" ${gateBusy?'disabled':''}>${gateBusy?'Please wait…':reg?'Create account':'Log in'}</button>
      </form>
      <div class="gor">or</div>
      <button class="btn gbtn" data-g="guest" type="button">Play as guest</button>
      <p class="gnote">Guest factories save only in this browser. You can create an account later.</p>`;
    const u=$('gUser');if(u)u.focus();
    $('authForm').addEventListener('submit',ev=>{ev.preventDefault();doAuth(reg)});
    return;
  }
  gboxEl.className='gbox panel wide';
  const who=guest?'Playing as guest · saves stay in this browser':`Signed in as ${esc(me.username)}`;
  let cards='';
  if(!slotData)cards='<p class="gsub">Loading your factories…</p>';
  else{
    cards='<div class="slots3">'+[1,2,3].map(s=>{const sv=slotData.find(x=>x.slot===s);
      if(!sv)return`<div class="scard empty"><div class="sn">Slot ${s}</div><div class="st2">Empty</div><div class="sm2">Start a fresh world with a new map.</div><div class="row"><button class="btn pri sm" data-g="new" data-s="${s}" type="button">Start new factory</button></div></div>`;
      const m=sv.meta||{};
      return`<div class="scard"><div class="sn">Slot ${s}${m.won?' · Launched':''}</div><div class="st2">Day ${m.day||1}</div>
        <div class="sm2">${m.techs||0} techs · ${m.buildings||0} buildings<br>Played ${fmtTime(m.playTime||0)}<br>Saved ${ago(sv.updated_at)}</div>
        <div class="row"><button class="btn pri sm" data-g="open" data-s="${s}" type="button">Continue</button>${slotDelArm===s?`<button class="btn sm danger" data-g="del2" data-s="${s}" type="button">Delete for good</button><button class="btn sm" data-g="del0" type="button">Keep</button>`:`<button class="btn sm" data-g="del" data-s="${s}" type="button">Delete</button>`}</div></div>`}).join('')+'</div>';
  }
  gboxEl.innerHTML=`<div class="ghead"><div><h1 class="glogo" style="font-size:38px">Foundry<span>Line</span></h1><p class="gwho">${who}</p></div>
    <div class="row" style="margin-top:0">${guest?'<button class="btn sm" data-g="toLogin" type="button">Log in or create account</button>':'<button class="btn sm" data-g="logout" type="button">Log out</button>'}</div></div>
    <p class="gsub">Pick a factory to continue, or start a new one. You have three save slots.</p>
    <div class="gerr" role="alert">${esc(gateErr)}</div>${cards}`;
}
async function doAuth(reg){
  const username=$('gUser').value.trim(),password=$('gPass').value;
  if(!username||!password){gateErr='Enter a username and password.';$('gErr').textContent=gateErr;return}
  gateBusy=true;gateErr='';renderGateKeep(username);
  try{const r=await api(reg?'/register':'/login',{method:'POST',body:JSON.stringify({username,password})});
    me={username:r.username};guest=false;gateBusy=false;await syncBlueprints();renderAcctBtn();showGate('slots')}
  catch(e){gateBusy=false;gateErr=e.message||'Could not reach the server.';renderGateKeep(username)}
}
function renderGateKeep(username){renderGate();const u=$('gUser');if(u)u.value=username;const p=$('gPass');if(p&&!gateBusy)p.focus()}
async function loadSlots(){
  slotData=null;renderGate();
  if(guest){
    slotData=[];for(let s=1;s<=3;s++){try{const v=localStorage.getItem(GUEST_KEY(s));if(v){const o=JSON.parse(v);slotData.push({slot:s,meta:o.meta,updated_at:o.at})}}catch(e){}}
    renderGate();return}
  try{const r=await api('/saves');slotData=r.saves||[]}
  catch(e){if(e.status===401){me=null;showGate('login');return}gateErr=e.message;slotData=[]}
  renderGate();
}
async function openSlot(s,isNew){
  slot=s;let data=null;
  if(!isNew){
    if(guest){try{data=JSON.parse(localStorage.getItem(GUEST_KEY(s))).data}catch(e){data=null}}
    else{try{data=(await api('/saves/'+s)).data}catch(e){gateErr=e.message;renderGate();return}}
  }
  beginGame(data);
}
function beginGame(str){
  if(!iconsMade){makeIcons();iconsMade=true}
  closeAll();
  let ok=false;if(str){try{ok=load(str)}catch(e){ok=false}}
  if(!ok)newGame();
  clearModes();
  simSpeed=1;setSpeed(1);
  buildHotbar();objDone=0;renderObjectives();updateUI();drawMini();updateModebar();
  gateEl.hidden=true;gameReady=true;lastCloudOk=ok?Date.now():0;
  setSaveLabel(guest?'browser save':'saved');
  if(!ok){openHelp();save();cloudSave()}
  if(!loopStarted){loopStarted=true;requestAnimationFrame(t=>{last=t;requestAnimationFrame(frame)})}
}
async function leaveGame(){
  if(gameReady){save();if(!guest&&!(await cloudSave())){toast('Could not save to the cloud. Try again in a moment.');return false}}
  gameReady=false;return true;
}
gateEl.addEventListener('click',async ev=>{
  const b=ev.target.closest('[data-g]');if(!b)return;const g=b.dataset.g,s=+b.dataset.s;
  if(g==='tab-login'){gateView='login';gateErr='';renderGate()}
  else if(g==='tab-register'){gateView='register';gateErr='';renderGate()}
  else if(g==='guest'){guest=true;me=null;loadBP();renderAcctBtn();showGate('slots')}
  else if(g==='toLogin'){guest=false;showGate('register')}
  else if(g==='logout'){try{await api('/logout',{method:'POST'})}catch(e){}me=null;loadBP();renderAcctBtn();showGate('login')}
  else if(g==='open')openSlot(s,false);
  else if(g==='new')openSlot(s,true);
  else if(g==='del'){slotDelArm=s;renderGate()}
  else if(g==='del0'){slotDelArm=0;renderGate()}
  else if(g==='del2'){slotDelArm=0;if(guest){try{localStorage.removeItem(GUEST_KEY(s))}catch(e){}}else{try{await api('/saves/'+s,{method:'DELETE'})}catch(e){gateErr=e.message}}loadSlots()}
});

// ---- in-game account menu ----
function acctHTML(){
  return`<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"><div><h2>${guest?'Guest':esc(me?me.username:'Account')}</h2>
    <p class="sub">Slot ${slot} · ${guest?'Saving in this browser only':lastCloudOk?'Last cloud save '+ago(new Date(lastCloudOk).toISOString()):'Not saved to the cloud yet'}</p></div><button class="btn" data-act="closem">Close <kbd>Esc</kbd></button></div>
    <div class="row">${guest?'':'<button class="btn pri" data-act="acctSave">Save now</button>'}<button class="btn" data-act="acctSwitch">Switch factory</button>${guest?'<button class="btn" data-act="acctLogin">Log in or create account</button>':'<button class="btn" data-act="acctLogout">Log out</button>'}</div>
    ${guest?'<p class="gnote">Guest saves live in this browser. To move this factory to an account, use Help → Export save, log in, start a new slot, then Help → Import save.</p>':'<p class="gnote">The game saves to the cloud every 45 seconds and when you switch tabs.</p>'}`;
}
document.addEventListener('click',async ev=>{
  const b=ev.target.closest('[data-act]');if(!b)return;const a=b.dataset.act;
  if(a==='acct'){openModal('acct',acctHTML())}
  else if(a==='acctSave'){const ok=await cloudSave();toast(ok?'Saved to the cloud':'Save failed. Check your connection.');if(!modalEl.hidden)sheetEl.innerHTML=acctHTML()}
  else if(a==='acctSwitch'){if(await leaveGame())showGate('slots')}
  else if(a==='acctLogout'){if(await leaveGame()){try{await api('/logout',{method:'POST'})}catch(e){}me=null;loadBP();renderAcctBtn();showGate('login')}}
  else if(a==='acctLogin'){if(await leaveGame()){guest=false;showGate('register')}}
});

// ---- start ----
(async function init(){
  loadBP();renderAcctBtn();
  try{const r=await api('/me');me={username:r.username};await syncBlueprints();renderAcctBtn();showGate('slots')}
  catch(e){showGate('login')}
})();
