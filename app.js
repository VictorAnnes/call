'use strict';
const $ = id => document.getElementById(id);
const PREFIX = 'nossacall-';           // evita colisão de IDs no servidor PeerJS público
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

const S = { peer: null, call: null, conn: null, room: '', name: '', isHost: false,
  micStream: null, screenStream: null, muted: false, deafened: false,
  actx: null, peerGain: null, screenGain: null, lastBytes: 0, lastT: 0 };

function toast(msg, ms = 4000) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.add('hidden'), ms); }
const cfg = () => ({ res: +$('resSel').value, fps: +$('fpsSel').value, codec: $('codecSel').value, br: +$('brRange').value * 1000 });

// ---------- Lobby ----------
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) $('roomInput').value = urlRoom;
$('nameInput').value = localStorage.getItem('callName') || '';
$('joinBtn').onclick = () => { ctx().resume(); join(); };

async function join() {
  S.room = $('roomInput').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  S.name = $('nameInput').value.trim() || 'Eu';
  if (!S.room) return $('lobbyErr').textContent = 'Digite um código de sala.';
  localStorage.setItem('callName', S.name);
  try { await getMic(); } catch (e) { return $('lobbyErr').textContent = 'Microfone bloqueado ou indisponível: ' + e.message; }
  $('lobby').classList.add('hidden'); $('room').classList.remove('hidden');
  $('meName').textContent = S.name; $('meAvatar').textContent = S.name[0].toUpperCase();
  history.replaceState(null, '', '?room=' + S.room);
  connect();
}

// ---------- Microfone ----------
async function getMic() {
  const studio = $('studio').checked;
  const c = { audio: { deviceId: $('micSel').value ? { exact: $('micSel').value } : undefined,
    noiseSuppression: !studio && $('ns').checked, echoCancellation: !studio && $('ec').checked,
    autoGainControl: !studio && $('agc').checked, channelCount: 2, sampleRate: 48000 } };
  const old = S.micStream;
  S.micStream = await navigator.mediaDevices.getUserMedia(c);
  S.micStream.getAudioTracks().forEach(t => t.enabled = !S.muted);
  if (old) old.getTracks().forEach(t => t.stop());
  watchSpeaking(S.micStream, $('meAvatar'));
  if (S.call) { const snd = S.call.peerConnection.getSenders().find(s => s.track && s.track.kind === 'audio' && s.track.label === old?.getAudioTracks()[0]?.label) || S.call.peerConnection.getSenders().find(s => s.track?.kind === 'audio');
    snd?.replaceTrack(S.micStream.getAudioTracks()[0]); }
  await listDevices();
}
async function listDevices() {
  const d = await navigator.mediaDevices.enumerateDevices();
  const fill = (sel, kind) => { const cur = sel.value; sel.innerHTML = d.filter(x => x.kind === kind).map(x => `<option value="${x.deviceId}">${x.label || kind}</option>`).join(''); if (cur) sel.value = cur; };
  fill($('micSel'), 'audioinput'); fill($('outSel'), 'audiooutput');
}

// ---------- Indicador de fala ----------
function ctx() { return S.actx ||= new AudioContext(); }
function watchSpeaking(stream, el) {
  if (el._raf) cancelAnimationFrame(el._raf);
  const an = ctx().createAnalyser(); an.fftSize = 512;
  ctx().createMediaStreamSource(stream).connect(an);
  const buf = new Uint8Array(an.frequencyBinCount);
  (function loop() { an.getByteFrequencyData(buf); const v = buf.reduce((a, b) => a + b, 0) / buf.length;
    el.classList.toggle('speaking', v > 12 && !(el.id === 'meAvatar' && S.muted)); el._raf = requestAnimationFrame(loop); })();
}

// ---------- Conexão (PeerJS) ----------
function connect() {
  $('reconBtn').classList.add('hidden'); setStatus('Conectando…');
  S.peer?.destroy();
  const hostId = PREFIX + S.room;
  const opts = { config: ICE };
  S.isHost = true; S.peer = new Peer(hostId, opts);       // tenta ser o anfitrião
  S.peer.on('open', () => setStatus('Sala criada. Aguardando a outra pessoa…'));
  S.peer.on('error', e => {
    if (e.type === 'unavailable-id' && S.isHost) {        // sala já existe → entra como convidado
      S.isHost = false; S.peer.destroy(); S.peer = new Peer(opts);
      S.peer.on('open', () => { setStatus('Ligando…'); startCall(S.peer.call(hostId, S.micStream, { metadata: { name: S.name } })); wire(); });
      S.peer.on('error', fail); return;
    }
    fail(e);
  });
  wire();
}
function wire() {
  S.peer.on('call', c => { c.answer(S.micStream); startCall(c); });
  S.peer.on('disconnected', () => { setStatus('Desconectado do sinalizador (a call segue ativa)'); });
}
function fail(e) {
  const m = { 'peer-unavailable': 'A outra pessoa ainda não entrou na sala.', 'network': 'Sem acesso ao servidor de sinalização.', 'browser-incompatible': 'Navegador incompatível.' }[e.type] || e.message;
  setStatus('Erro: ' + m); toast('Erro: ' + m); $('reconBtn').classList.remove('hidden');
}
function startCall(call) {
  S.call = call;
  call.on('stream', s => {
    const hasVideo = s.getVideoTracks().length > 0, audios = s.getAudioTracks();
    if (hasVideo) showScreen(s); else attachVoice(s);
  });
  // PeerJS entrega um stream por MediaStream; voz e tela vão em streams separados via addTrack abaixo
  call.peerConnection.ontrack = ev => { const s = ev.streams[0]; if (!s) return;
    if (ev.track.kind === 'video') showScreen(s);
    else if (ev.track.kind === 'audio') { if (!S.voiceId) { S.voiceId = s.id; attachVoice(s); } else if (s.id !== S.voiceId) attachScreenAudio(s); } };
  call.on('close', () => { setStatus('Chamada encerrada'); $('peerName').textContent = 'Desconectado'; hideScreen(); $('reconBtn').classList.remove('hidden'); });
  call.on('error', fail);
  call.peerConnection.onconnectionstatechange = () => {
    const st = call.peerConnection.connectionState;
    if (st === 'connected') { setStatus('Conectado'); statsLoop(); setTimeout(() => S.screenStream && applyBitrate(), 500); }
    if (st === 'failed' || st === 'disconnected') { setStatus('Conexão caiu'); toast('Conexão caiu. Clique em Reconectar.'); $('reconBtn').classList.remove('hidden'); }
  };
  const nm = call.metadata?.name; $('peerName').textContent = nm || 'Parceiro(a)'; $('peerAvatar').textContent = (nm || '?')[0].toUpperCase();
}
function setStatus(t) { $('status').textContent = t; }

// ---------- Áudio recebido ----------
function attachVoice(stream) {
  const a = $('peerAudio'); a.srcObject = stream; a.muted = true; // reproduz via WebAudio p/ ganho até 200%
  const src = ctx().createMediaStreamSource(stream);
  S.peerGain = ctx().createGain(); S.peerGain.gain.value = $('peerVol').value / 100;
  src.connect(S.peerGain).connect(ctx().destination);
  watchSpeaking(stream, $('peerAvatar')); applyDeafen();
  if (ctx().state === 'suspended') ctx().resume();
}
$('peerVol').oninput = e => { $('peerVolLbl').textContent = e.target.value + '%'; if (S.peerGain) S.peerGain.gain.value = e.target.value / 100; };
function attachScreenAudio(stream) {
  const src = ctx().createMediaStreamSource(stream);
  S.screenGain = ctx().createGain(); S.screenGain.gain.value = $('screenVolRange').value / 100;
  src.connect(S.screenGain).connect(ctx().destination); $('screenVol').classList.remove('hidden'); $('screenVol').classList.add('flex');
}
$('screenVolRange').oninput = e => { if (S.screenGain) S.screenGain.gain.value = e.target.value / 100; };

// ---------- Tela recebida ----------
function showScreen(s) {
  const v = $('screenVideo'); v.srcObject = new MediaStream(s.getVideoTracks()); v.classList.remove('hidden');
  $('stageHint').classList.add('hidden'); $('stageBtns').classList.remove('hidden'); $('stageBtns').classList.add('flex');
  v.muted = true; v.play().catch(() => { $('stageHint').textContent = 'Toque aqui para assistir'; $('stageHint').classList.remove('hidden'); $('stage').onclick = () => { v.play(); $('stageHint').classList.add('hidden'); $('stage').onclick = null; }; });
}
function hideScreen() { $('screenVideo').classList.add('hidden'); $('stageHint').classList.remove('hidden'); $('stageBtns').classList.add('hidden'); }
$('fsBtn').onclick = () => { const st = $('stage'), v = $('screenVideo');
  if (st.requestFullscreen) st.requestFullscreen(); else if (st.webkitRequestFullscreen) st.webkitRequestFullscreen(); else v.webkitEnterFullscreen?.();
  screen.orientation?.lock?.('landscape').catch(() => {}); };
$('pipBtn').onclick = () => document.pictureInPictureElement ? document.exitPictureInPicture() : $('screenVideo').requestPictureInPicture?.().catch(e => toast('PiP indisponível: ' + e.message));

// ---------- Compartilhar tela ----------
$('shareBtn').onclick = () => S.screenStream ? stopShare() : startShare();
async function startShare() {
  if (!S.call) return toast('Espere a outra pessoa entrar.');
  const { res, fps } = cfg(); const h = res, w = Math.round(h * 16 / 9);
  try {
    S.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: fps, max: fps } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (e) { return toast(e.name === 'NotAllowedError' ? 'Compartilhamento cancelado.' : 'Erro: ' + e.message); }
  const [vt] = S.screenStream.getVideoTracks(); vt.contentHint = 'motion';
  vt.onended = stopShare;
  if (!S.screenStream.getAudioTracks().length) toast('Sem áudio do sistema. No Chrome, marque "Compartilhar áudio da guia/sistema".', 7000);
  const pc = S.call.peerConnection;
  S.shareSenders = S.screenStream.getTracks().map(t => pc.addTrack(t, S.screenStream));
  setCodec(pc); await renegotiate(); await applyBitrate();
  $('shareBtn').textContent = 'Parar compartilhamento'; $('shareBtn').classList.add('off');
}
function setCodec(pc) {       // preferência de codec no transceiver de vídeo
  const mime = { VP9: 'video/VP9', H264: 'video/H264', VP8: 'video/VP8' }[cfg().codec];
  const caps = RTCRtpSender.getCapabilities('video').codecs;
  const pref = [...caps.filter(c => c.mimeType === mime), ...caps.filter(c => c.mimeType !== mime)];
  pc.getTransceivers().forEach(t => { if (t.sender.track === S.screenStream.getVideoTracks()[0]) t.setCodecPreferences?.(pref); });
}
async function applyBitrate() {   // <<< AJUSTE O BITRATE AQUI (ou no slider em Config) >>>
  const snd = S.shareSenders?.find(s => s.track?.kind === 'video'); if (!snd) return;
  const p = snd.getParameters(); if (!p.encodings?.length) p.encodings = [{}];
  p.encodings[0].maxBitrate = cfg().br;           // bps. 8000 kbps = 8_000_000
  p.encodings[0].maxFramerate = cfg().fps;
  p.degradationPreference = 'maintain-framerate';
  try { await snd.setParameters(p); } catch (e) { console.warn(e); }
}
async function renegotiate() {  // PeerJS não renegocia sozinho: usa o próprio RTCPeerConnection + canal de dados
  if (!S.conn || !S.conn.open) await openData();
  const pc = S.call.peerConnection, offer = await pc.createOffer(); await pc.setLocalDescription(offer);
  S.conn.send({ type: 'offer', sdp: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription });
}
function openData() { return new Promise(res => { if (S.conn?.open) return res();
  S.conn = S.peer.connect(S.call.peer, { reliable: true }); bindConn(S.conn); S.conn.on('open', res); }); }
function bindConn(c) {
  S.conn = c;
  c.on('data', async m => {
    const pc = S.call?.peerConnection; if (!pc) return;
    if (m.type === 'offer') { await pc.setRemoteDescription(m.sdp); const a = await pc.createAnswer(); await pc.setLocalDescription(a); c.send({ type: 'answer', sdp: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription }); }
    else if (m.type === 'answer') await pc.setRemoteDescription(m.sdp);
    else if (m.type === 'stopshare') { hideScreen(); $('screenVol').classList.add('hidden'); S.voiceId && (S.screenGain = null); }
    else if (m.type === 'mic') $('peerInfo').textContent = m.muted ? 'Mic mutado' : 'Mic ligado';
  });
}
// o peer que recebe a conexão de dados também precisa registrá-la
function hookIncomingData() { S.peer.on('connection', c => bindConn(c)); }
const _wire = wire; wire = function () { _wire(); hookIncomingData(); };

function stopShare() {
  S.shareSenders?.forEach(s => { try { S.call.peerConnection.removeTrack(s); } catch {} });
  S.screenStream?.getTracks().forEach(t => t.stop()); S.screenStream = null; S.shareSenders = null;
  S.conn?.open && S.conn.send({ type: 'stopshare' });
  renegotiate().catch(() => {});
  $('shareBtn').textContent = 'Compartilhar tela'; $('shareBtn').classList.remove('off');
}

// ---------- Mute / Deafen ----------
$('muteBtn').onclick = () => { S.muted = !S.muted; S.micStream.getAudioTracks().forEach(t => t.enabled = !S.muted);
  $('muteBtn').classList.toggle('off', S.muted); $('muteBtn').textContent = S.muted ? 'Desmutar' : 'Mutar'; $('meMic').textContent = S.muted ? 'Mic mutado' : 'Mic ligado';
  S.conn?.open && S.conn.send({ type: 'mic', muted: S.muted }); };
$('deafBtn').onclick = () => { S.deafened = !S.deafened; applyDeafen();
  $('deafBtn').classList.toggle('off', S.deafened); $('deafBtn').textContent = S.deafened ? 'Reativar áudio' : 'Ensurdecer'; };
function applyDeafen() { if (S.peerGain) S.peerGain.gain.value = S.deafened ? 0 : $('peerVol').value / 100; if (S.screenGain) S.screenGain.gain.value = S.deafened ? 0 : $('screenVolRange').value / 100; }

// ---------- Estatísticas ----------
function statsLoop() {
  clearInterval(S.st);
  S.st = setInterval(async () => {
    const pc = S.call?.peerConnection; if (!pc) return;
    const rep = await pc.getStats(); let rtt = 0, inBytes = 0, outBytes = 0, now = performance.now();
    rep.forEach(r => { if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated) rtt = (r.currentRoundTripTime || 0) * 1000;
      if (r.type === 'inbound-rtp' && r.kind === 'video') inBytes += r.bytesReceived;
      if (r.type === 'outbound-rtp' && r.kind === 'video') outBytes += r.bytesSent; });
    const bytes = inBytes + outBytes;
    if (S.lastT) { const kbps = ((bytes - S.lastBytes) * 8) / (now - S.lastT); $('stats').textContent = `${Math.round(rtt)} ms · ${Math.round(kbps)} kbps`; $('peerInfo').textContent = `${Math.round(rtt)} ms`; }
    S.lastBytes = bytes; S.lastT = now;
  }, 1000);
}

// ---------- Config / Sala ----------
$('setBtn').onclick = async () => { await listDevices(); $('settings').classList.remove('hidden'); };
$('brRange').oninput = e => $('brLbl').textContent = e.target.value;
$('studio').onchange = e => { ['ns', 'ec', 'agc'].forEach(i => { $(i).disabled = e.target.checked; }); };
$('closeSet').onclick = async () => { $('settings').classList.add('hidden');
  try { await getMic(); } catch (e) { toast('Erro no microfone: ' + e.message); }
  const o = $('outSel').value; if (o && $('peerAudio').setSinkId) { try { await $('peerAudio').setSinkId(o); await ctx().setSinkId?.(o); } catch {} }
  applyBitrate(); };
$('copyBtn').onclick = () => navigator.clipboard.writeText(`${location.origin}${location.pathname}?room=${S.room}`).then(() => toast('Link copiado!'));
$('reconBtn').onclick = () => { S.voiceId = null; connect(); };
$('leaveBtn').onclick = () => { S.peer?.destroy(); S.micStream?.getTracks().forEach(t => t.stop()); S.screenStream?.getTracks().forEach(t => t.stop()); location.href = location.pathname; };

// ---------- Modo app (PWA) ----------
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
let deferredInstall;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; $('installBtn').classList.remove('hidden'); });
$('installBtn').onclick = async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $('installBtn').classList.add('hidden'); };
window.addEventListener('appinstalled', () => toast('App instalado!'));

// Mantém a tela acordada durante a call
let wake; async function keepAwake() { try { wake = await navigator.wakeLock?.request('screen'); } catch {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.call) keepAwake(); });
$('joinBtn').addEventListener('click', keepAwake);

// Celular não tem getDisplayMedia: esconde o botão em vez de dar erro
if (!navigator.mediaDevices?.getDisplayMedia) $('shareBtn').classList.add('hidden');

// Atalhos de teclado (ignorados ao digitar)
document.addEventListener('keydown', e => {
  if (!S.call || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.ctrlKey || e.metaKey) return;
  const k = e.key.toLowerCase(); if (k === 'm') $('muteBtn').click(); else if (k === 'd') $('deafBtn').click(); else if (k === 's') $('shareBtn').click();
});

// Aviso se abrir fora de HTTPS (getUserMedia exige)
if (!window.isSecureContext) toast('Abra por HTTPS (GitHub Pages) para usar microfone e tela.', 8000);

document.addEventListener('click', () => { if (S.actx?.state === 'suspended') S.actx.resume(); $('peerAudio').play?.().catch(() => {}); });
