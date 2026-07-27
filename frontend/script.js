/**
 * Mrs. D – AI Educational Counselor | Frontend Script
 * Voice-first with barge-in/interrupt, text chat, memory panel, modals
 * Backend: http://localhost:8000 | Frontend: http://localhost:5175
 */
const C = {
  API:'/api', SILENCE:1200, VAD_WARMUP:300, MAX_REC:30000, HEALTH:10000,
  MIN_AUDIO:500, VAD_TH:10, VAD_BARGE:12, RECONNECT:1000,
};
const State={IDLE:'idle',LISTENING:'listening',THINKING:'thinking',SPEAKING:'speaking'};
let state=State.IDLE, voiceOn=false, online=false, sid=_sid();
let reqCnt=0, curReq=0, abortCtrl=null;
let pStream=null, pCtx=null, pAna=null, pVad=false, pRaf=null;
let rec=null, chunks=[], recTimer=null, silTimer=null, spoke=false, vadReady=false, isRec=false;
let curAudio=null;

// DOM refs
const $=(id)=>document.getElementById(id);
const micBtn=$('micBtn'), sendBtn=$('sendBtn'), ti=$('textInput'), msgs=$('chatMessages');
const clearBtn=$('clearBtn'), resetBtn=$('resetBtn');
const cDot=$('connDot'), cTxt=$('connText'), bDot=$('badgeDot'), bTxt=$('badgeText'), mLbl=$('micLabel');
const vBtn=$('voiceToggleBtn'), vLbl=$('voiceBtnLabel');
const mOverlay=$('modalOverlay'), mLis=$('modalListening'), mThk=$('modalThinking'), mSpk=$('modalSpeaking');
const hAvatar=$('heroAvatar'), charC=$('charCount'), mp=$('memoryPanel');

document.addEventListener('DOMContentLoaded',()=>{
  _welcome(); _health(); setInterval(_health,C.HEALTH); _events(); _setState(State.IDLE);
  console.log('Mrs. D – Voice AI Counselor ready');
});

function _events(){
  micBtn.onclick=(e)=>_micToggle();
  vBtn.onclick=_micToggle;
  sendBtn.onclick=_sendText;
  ti.onkeydown=(e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();_sendText()}};
  ti.oninput=()=>{ti.style.height='auto';ti.style.height=Math.min(ti.scrollHeight,72)+'px';charC.textContent=`${ti.value.length}/2000`};
  clearBtn.onclick=()=>{msgs.innerHTML='';_welcome();_toast('Cleared','i')};
  resetBtn.onclick=async()=>{if(voiceOn)_stopVoice();await _reset()};
}

function _micToggle(){
  if(!online){_toast('Backend offline','e');return}
  if(state===State.SPEAKING){_bargeIn();return}
  voiceOn?_stopVoice():_startVoice();
}

// ── PERSISTENT MIC ──
async function _acqMic(){
  if(pStream)return true;
  try{
    pStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    pCtx=new(window.AudioContext||window.webkitAudioContext)();
    pAna=pCtx.createAnalyser();pAna.fftSize=512;pAna.smoothingTimeConstant=0.7;
    pCtx.createMediaStreamSource(pStream).connect(pAna);
    pVad=true;_vadLoop();
    return true;
  }catch(e){
    console.error('Mic error:',e);
    if(e.name.includes('NotAllowed')||e.name.includes('Permission'))_toast('Microphone access denied. Please allow in browser settings.','e');
    else if(e.name==='NotFoundError')_toast('No microphone found.','e');
    else _toast(`Mic error: ${e.message}`,'e');
    return false;
  }
}
function _relMic(){
  pVad=false;if(pRaf){cancelAnimationFrame(pRaf);pRaf=null}
  pStream?.getTracks().forEach(t=>t.stop());pStream=null;
  pCtx?.close().catch(()=>{});pCtx=null;pAna=null;
}
function _vadLoop(){
  if(!pVad||!pAna)return;
  const d=new Uint8Array(pAna.frequencyBinCount);
  pAna.getByteFrequencyData(d);
  const rms=Math.sqrt(d.reduce((s,v)=>s+v*v,0)/d.length);
  if(state===State.SPEAKING&&rms>C.VAD_BARGE){_bargeIn();}
  else if(state===State.LISTENING&&isRec){
    if(rms>C.VAD_TH){spoke=true;clearTimeout(silTimer);silTimer=null;}
    else if(vadReady&&spoke&&!silTimer){silTimer=setTimeout(()=>{if(isRec&&state===State.LISTENING)_stopRec()},C.SILENCE);}
  }
  if(pVad)pRaf=requestAnimationFrame(_vadLoop);
}

// ── VOICE MODE ──
async function _startVoice(){
  if(voiceOn)return;
  voiceOn=true;_vUI(true);
  const ok=await _acqMic();
  if(!ok){_stopVoice();return}
  _toast('Voice mode ON – speak naturally!','i');
  await _listen();
}
function _stopVoice(){
  voiceOn=false;_vUI(false);
  _stopRecCleanup();_stopAudio();_cancelReq();_relMic();
  _setState(State.IDLE);_toast('Voice mode OFF','i');
}
function _vUI(a){
  if(!vBtn)return;
  vLbl.textContent=a?'⏹ Stop':'🎤 Start Voice';
  vBtn.classList.toggle('active',a);
}

// ── LISTENING ──
async function _listen(){
  if(!voiceOn||state!==State.IDLE)return;
  if(!pStream){const ok=await _acqMic();if(!ok)return}
  chunks=[];spoke=false;vadReady=false;isRec=false;
  const mt=_mime();
  try{rec=new MediaRecorder(pStream,{mimeType:mt})}catch(e){rec=new MediaRecorder(pStream)}
  const amt=rec.mimeType||mt;
  rec.ondataavailable=(e)=>{if(e.data.size>0)chunks.push(e.data)};
  rec.onstop=async()=>{
    const c=chunks.slice();chunks=[];
    if(!voiceOn)return;
    if(spoke&&c.length>0)await _process(c,amt);
    else{_setState(State.IDLE);if(voiceOn)setTimeout(()=>{if(voiceOn&&state===State.IDLE)_listen()},200)}
  };
  rec.onerror=()=>{_toast('Recording error','e');if(voiceOn){_setState(State.IDLE);setTimeout(()=>{if(voiceOn)_listen()},C.RECONNECT)}};
  rec.start(100);isRec=true;_setState(State.LISTENING);
  setTimeout(()=>{vadReady=true},C.VAD_WARMUP);
  recTimer=setTimeout(()=>{if(isRec&&state===State.LISTENING)_stopRec()},C.MAX_REC);
}
function _stopRec(discard){clearTimeout(recTimer);clearTimeout(silTimer);silTimer=null;if(discard)spoke=false;if(rec&&rec.state!=='inactive'){const r=rec;rec=null;try{r.stop()}catch(e){}}isRec=false}
function _stopRecCleanup(){clearTimeout(recTimer);clearTimeout(silTimer);silTimer=null;if(rec&&rec.state!=='inactive'){const r=rec;rec=null;try{r.stop()}catch(e){}}isRec=false}

// ── BARGE-IN ──
function _bargeIn(){
  _stopAudio();_cancelReq();
  _setState(State.IDLE);
  if(voiceOn)setTimeout(()=>{if(voiceOn&&state===State.IDLE)_listen()},150);
}

// ── REQUEST CANCEL ──
function _cancelReq(){reqCnt++;if(abortCtrl){try{abortCtrl.abort()}catch(e){}abortCtrl=null}}

// ── PROCESS VOICE ──
async function _process(ch,mime){
  reqCnt++;const id=reqCnt;curReq=id;_cancelReq();curReq=id;
  _setState(State.THINKING);
  const ext=mime.includes('ogg')?'ogg':mime.includes('mp4')?'m4a':'webm';
  const blob=new Blob(ch,{type:mime});
  if(blob.size<C.MIN_AUDIO){_setState(State.IDLE);if(voiceOn)setTimeout(()=>{if(voiceOn&&state===State.IDLE)_listen()},200);return}
  const fd=new FormData();fd.append('audio',blob,`rec.${ext}`);fd.append('session_id',sid);
  const tid=_addThink();abortCtrl=new AbortController();const sig=abortCtrl.signal;
  try{
    const r=await fetch(`${C.API}/chat`,{method:'POST',body:fd,signal:sig});
    if(id!==curReq||!voiceOn){_rmThink(tid);return}
    if(!r.ok){let m=`HTTP ${r.status}`;try{const e=await r.json();m=e.detail||m}catch(ex){}throw Error(m)}
    if(id!==curReq||!voiceOn){_rmThink(tid);return}
    const t=_sdh(r.headers.get('X-Transcript')),a=_sdh(r.headers.get('X-Answer')),l=r.headers.get('X-Language')||'en';
    _rmThink(tid);
    if(id===curReq&&voiceOn){if(t)_addMsg('u',t,'voice',l);if(a)_addMsg('d',a,'voice',l)}
    const ab=await r.blob();
    if(id!==curReq||!voiceOn)return;
    await _playAudio(ab,id);
  }catch(e){
    _rmThink(tid);
    if(e.name==='AbortError')return;
    let msg='Something went wrong.';
    if(e.message.includes('Failed to fetch'))msg='Cannot connect to backend.';
    else if(e.message)msg=e.message;
    _toast(msg,'e');_setState(State.IDLE);
    if(voiceOn)setTimeout(()=>{if(voiceOn&&state===State.IDLE)_listen()},C.RECONNECT);
  }finally{if(abortCtrl&&id===curReq)abortCtrl=null}
}

// ── TEXT CHAT ──
async function _sendText(){
  const m=ti.value.trim();if(!m||state===State.THINKING)return;
  if(!online){_toast('Backend offline.','e');return}
  if(voiceOn)_stopVoice();
  ti.value='';ti.style.height='auto';charC.textContent='0/2000';
  _addMsg('u',m,'text');_setState(State.THINKING);const tid=_addThink();
  try{
    const r=await fetch(`${C.API}/text-chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:sid,message:m,return_audio:true})});
    if(!r.ok){let e=`HTTP ${r.status}`;try{const d=await r.json();e=d.detail||e}catch(ex){}throw Error(e)}
    const d=await r.json();_rmThink(tid);
    _addMsg('d',d.response,'text',d.language||'en');
    if(d.audio_url)await _playUrl(`${C.API}${d.audio_url}`,false,0);
    else _setState(State.IDLE);
  }catch(e){_rmThink(tid);_toast(e.message||'Error','e');_setState(State.IDLE)}
}

// ── AUDIO PLAYBACK ──
async function _playAudio(blob,rid){const u=URL.createObjectURL(blob);await _playUrl(u,true,rid)}
async function _playUrl(url,isObj,rid){
  if(rid>0&&rid!==curReq){if(isObj)URL.revokeObjectURL(url);return}
  _setState(State.SPEAKING);curAudio=new Audio(url);curAudio.preload='auto';
  curAudio.onended=()=>{if(isObj)URL.revokeObjectURL(url);curAudio=null;_setState(State.IDLE);if(voiceOn)setTimeout(()=>{if(voiceOn&&state===State.IDLE)_listen()},400)};
  curAudio.onerror=()=>{if(isObj)URL.revokeObjectURL(url);curAudio=null;_setState(State.IDLE);if(voiceOn)setTimeout(()=>{if(voiceOn&&state===State.IDLE)_listen()},400)};
  try{await curAudio.play()}catch(e){_toast('Tap to enable audio','i');_setState(State.IDLE);if(isObj)URL.revokeObjectURL(url);curAudio=null}
}
function _stopAudio(){if(curAudio){const a=curAudio;curAudio=null;a.pause();a.src=''}}

// ── STATE MANAGEMENT ──
function _setState(s){
  state=s;
  micBtn.classList.remove('rec','thk','spk');
  mLbl.classList.remove('ls','th','sp','in');
  bDot.classList.remove('on','of','ls','th','sp');
  mOverlay.classList.remove('active');
  mLis.classList.remove('active');mThk.classList.remove('active');mSpk.classList.remove('active');
  hAvatar.classList.remove('listening','thinking','speaking');
  sendBtn.disabled=false;

  switch(s){
    case State.IDLE:
      bTxt.textContent=voiceOn?'Standing by':'Ready';
      bDot.classList.add(online?'on':'of');
      mLbl.textContent=voiceOn?'Waiting...':'Tap to start speaking';
      micBtn.title=voiceOn?'Voice ON – speak!':'Start voice';
      micBtn.disabled=false;sendBtn.disabled=false;
      break;
    case State.LISTENING:
      micBtn.classList.add('rec');mLbl.classList.add('ls');bDot.classList.add('ls');
      bTxt.textContent='LISTENING';mLbl.textContent='Listening... speak now';
      micBtn.title='Listening...';micBtn.disabled=false;sendBtn.disabled=true;
      mOverlay.classList.add('active');mLis.classList.add('active');
      hAvatar.classList.add('listening');
      break;
    case State.THINKING:
      micBtn.classList.add('thk');mLbl.classList.add('th');bDot.classList.add('th');
      bTxt.textContent='THINKING';mLbl.textContent='Thinking...';
      micBtn.title='Thinking...';micBtn.disabled=true;sendBtn.disabled=true;
      mOverlay.classList.add('active');mThk.classList.add('active');
      hAvatar.classList.add('thinking');
      break;
    case State.SPEAKING:
      micBtn.classList.add('spk');mLbl.classList.add('in');bDot.classList.add('sp');
      bTxt.textContent='SPEAKING';mLbl.textContent='🔴 Tap or speak to interrupt';
      micBtn.title='Interrupt';micBtn.disabled=false;sendBtn.disabled=true;
      mOverlay.classList.add('active');mSpk.classList.add('active');
      hAvatar.classList.add('speaking');
      break;
  }
}

// ── CHAT UI ──
const LF={en:'🇬🇧',te:'🇮🇳 తె',hi:'🇮🇳 हि',ta:'🇮🇳 த'};

function _addMsg(role,content,type='text',lang='en'){
  const el=document.createElement('div');el.className=`msg ${role}`;
  const av=document.createElement('div');av.className='msg-a';av.textContent=role==='u'?'You':'D';
  const mc=document.createElement('div');mc.className='msg-c';
  const b=document.createElement('div');b.className='msg-b';b.textContent=content;
  const m=document.createElement('div');m.className='msg-m';
  const n=new Date();const lb=lang!=='en'?` · ${LF[lang]||lang}`:'';const mb=type==='voice'?' · 🎤':'';
  m.textContent=`${n.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}${mb}${lb}`;
  mc.appendChild(b);mc.appendChild(m);el.appendChild(av);el.appendChild(mc);
  msgs.appendChild(el);_scroll();
  return el;
}
function _addThink(){
  const id='t-'+Date.now();const el=document.createElement('div');el.className='msg d typing';el.id=id;
  const av=document.createElement('div');av.className='msg-a';av.textContent='D';
  const mc=document.createElement('div');mc.className='msg-c';
  const b=document.createElement('div');b.className='msg-b';
  b.innerHTML='<div class="td"><span></span><span></span><span></span></div>';
  mc.appendChild(b);el.appendChild(av);el.appendChild(mc);msgs.appendChild(el);_scroll();return id;
}
function _rmThink(id){document.getElementById(id)?.remove()}
function _welcome(){
  const w=document.createElement('div');w.className='welcome-msg';
  w.innerHTML='<div class="wi">🎓</div><h3>Hello! I\'m Mrs. D</h3><p>Your AI Educational Counselor — available in English, తెలుగు, हिंदी & தமிழ்.</p><p style="margin-top:4px">Click the mic or type below to start.</p>';
  msgs.appendChild(w);
}
function _scroll(){msgs.scrollTop=msgs.scrollHeight}

// ── SESSION ──
async function _reset(){
  _cancelReq();
  try{await fetch(`${C.API}/reset-session/${sid}`,{method:'POST'})}catch(e){}
  msgs.innerHTML='';sid=_sid();_welcome();_toast('Session reset','s');
}

// ── HEALTH ──
async function _health(){
  try{
    const r=await fetch(`${C.API}/health`,{signal:AbortSignal.timeout(5000)});
    if(r.ok){const d=await r.json();online=true;_setConn(true,d.groq_configured?'Online':'No API Key');document.getElementById('offlineBanner')?.remove()}
    else _offline();
  }catch(e){_offline()}
}
function _offline(){online=false;_setConn(false,'Offline');if(!document.getElementById('offlineBanner')){const b=document.createElement('div');b.id='offlineBanner';b.className='offline-banner';b.innerHTML='<span>⚠️ Backend offline. Start: <code>cd backend &amp;&amp; python -m uvicorn app:app --reload --port 8000</code></span>';msgs.prepend(b)}}
function _setConn(ok,label){cDot.className='c-dot '+(ok?'online':'offline');cTxt.textContent=label}

// ── UTILITIES ──
function _sid(){return'sess_'+Math.random().toString(36).slice(2,11)+'_'+Date.now()}
function _mime(){return['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t))||'audio/webm'}
function _sdh(v){if(!v)return'';try{return decodeURIComponent(v)}catch{return v}}

function _toast(msg,type='i'){
  const c=$('toastContainer');if(!c)return;
  const t=document.createElement('div');t.className=`toast ${type}`;t.textContent=msg;c.appendChild(t);
  setTimeout(()=>{t.style.animation='to 0.3s ease forwards';setTimeout(()=>t.remove(),300)},3000);
}
