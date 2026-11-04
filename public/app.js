/* SMART HOME ESP32 / Firebase Realtime Database
   Demo mode requires no Firebase account. Real mode uses Email/Password Auth. */
const el = (id) => document.getElementById(id);
const state = {
  demo: false, demoInterval: null, user: null, modules: null, auth: null, db: null,
  telemetry: null, desired: null, unsubscribers: [], busy: {LIGHT: false, FAN: false, DOOR: false},
  demoPresence: false, demoDoorClearAt: null, pendingDoorRequest: null, doorRequestTimer: null,
  history: [], demoHistory: [], historyError: false, authReady: false
};
const config = window.SMART_HOME_FIREBASE_CONFIG || {};
const configured = Boolean(config.apiKey && config.appId && config.projectId && config.databaseURL &&
  !/^(THAY_|TEN_)/.test(config.apiKey) && !/^(THAY_|TEN_)/.test(config.appId) &&
  !/TEN_/.test(config.projectId) && !/TEN_/.test(config.databaseURL));
const timeZone = 'Asia/Ho_Chi_Minh';

function renderAccess() {
  const visible = Boolean(state.user) || state.demo;
  el('auth-screen').hidden = visible;
  el('app-shell').hidden = !visible;
  el('logged-in').hidden = !state.user;
  el('exit-demo-btn').hidden = !state.demo;
  el('login-form').hidden = Boolean(state.user);
  el('home-status').textContent = state.demo ? 'Đang xem dữ liệu mẫu' : liveDevice() ? 'ESP32 đang trực tuyến' : 'Đang chờ ESP32';
  el('home-status-detail').textContent = state.demo ? 'Các thao tác hiện chỉ chạy mô phỏng trong trình duyệt.' : liveDevice() ? 'Cảm biến và điều khiển đã kết nối với thiết bị.' : 'Bạn đã đăng nhập. Dữ liệu sẽ xuất hiện khi ESP32 kết nối.';
}
function showLoginError(message = '') {
  el('login-error').textContent = message;
  el('login-error').hidden = !message;
}
function eventTime(timestamp) {
  return new Date(timestamp).toLocaleString('vi-VN', {timeZone, day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false});
}
function renderHistory() {
  const events = state.demo ? state.demoHistory : state.history;
  const filter = el('history-filter').value || 'all';
  const filtered = events.filter(event => filter === 'all' || event.type === filter);
  const body = el('door-history-body'); body.replaceChildren();
  for (const event of filtered) {
    const row = document.createElement('tr');
    const when = document.createElement('td'), time = document.createElement('time');
    const timestamp = num(event.occurredAt) || num(event.createdAt);
    time.textContent = timestamp ? eventTime(timestamp) : 'Chưa có thời gian';
    if (timestamp) time.dateTime = new Date(timestamp).toISOString();
    when.append(time);
    if (event.timeSource === 'server_received') {
      const note = document.createElement('small'); note.textContent = 'Thời điểm máy chủ nhận (thiết bị chưa đồng bộ giờ)';
      when.append(note);
    }
    const what = document.createElement('td');
    what.textContent = event.type === 'outside_detected' ? 'Phát hiện người/vật phía ngoài' : event.type === 'exit_requested' ? 'Nhận lệnh mở cửa để ra ngoài' : 'Sự kiện cửa';
    const source = document.createElement('td');
    source.textContent = event.source === 'sensor_outside' ? 'HC-SR04 phía ngoài' : event.source === 'web' ? 'Nút mở trên web' : 'ESP32';
    row.append(when, what, source); body.append(row);
  }
  el('history-empty').hidden = filtered.length > 0;
  el('history-empty').textContent = state.historyError && !state.demo ? 'Không tải được nhật ký. Kiểm tra kết nối và quyền truy cập.' : 'Chưa có sự kiện phù hợp được ghi nhận.';
  el('history-mode').textContent = state.demo ? 'MÔ PHỎNG · KHÔNG LƯU FIREBASE' : state.user ? 'NHẬT KÝ FIREBASE' : 'Chưa kết nối';
  el('history-mode').className = 'tag ' + (state.demo ? '' : state.user ? 'info' : '');
  el('history-summary').textContent = state.demo ? `${state.demoHistory.length} sự kiện mẫu trong phiên này.` : state.user ? `${events.length} sự kiện gần nhất · Lưu trên Firebase · Múi giờ Việt Nam (UTC+7).` : 'Đăng nhập để xem lịch sử đã lưu trên Firebase.';
}
function addDemoEvent(type, source) {
  state.demoHistory.unshift({type, source, occurredAt:Date.now(), createdAt:Date.now(), timeSource:'demo'});
  state.demoHistory = state.demoHistory.slice(0,100);
  renderHistory();
}
function handleAuthState(user) {
  if (user && window.SMART_HOME_ADMIN_UID && user.uid !== window.SMART_HOME_ADMIN_UID) {
    state.user = null; removeListeners(); clearDoorRequest(); state.history = [];
    state.telemetry = null; state.desired = null;
    showLoginError('Tài khoản này chưa được cấp quyền quản trị ngôi nhà.');
    state.modules.authMod.signOut(state.auth).catch(() => {});
    renderTelemetry(); renderHistory(); return;
  }
  state.authReady = true;
  state.user = user;
  el('login-btn').disabled = false; el('login-btn').textContent = 'ĐĂNG NHẬP';
  if (user) {
    el('user-email').textContent = user.email || user.uid;
    showLoginError(); log('Đăng nhập thành công với tài khoản ' + (user.email || user.uid));
    if (state.demo) exitDemo(); else observeData();
  } else {
    removeListeners(); clearDoorRequest(); state.history = []; state.historyError = false;
    if (!state.demo) {state.telemetry = null; state.desired = null;}
  }
  renderTelemetry(); renderHistory();
}

function log(message, severity = 'info') {
  const list = el('log-list');
  if (list.children.length === 1 && list.textContent.includes('Đang khởi tạo giao diện')) list.replaceChildren();
  const item = document.createElement('div'); item.className = `log-item ${severity}`;
  const marker = document.createElement('span'); marker.className = 'log-marker';
  const msg = document.createElement('span'); msg.textContent = message;
  const time = document.createElement('time');
  time.textContent = new Intl.DateTimeFormat('vi-VN', {hour:'2-digit', minute:'2-digit', second:'2-digit'}).format(new Date());
  item.append(marker, msg, time); list.prepend(item);
  while (list.children.length > 8) list.lastElementChild.remove();
}
let toastTimer = null;
function toast(message, severity = '') {
  const target = el('toast'); target.textContent = message;
  target.className = `toast ${severity}`; target.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { target.hidden = true; }, 4400);
}
function setTag(id, label, kind = '') { const target=el(id);target.textContent=label;target.className=`tag ${kind}`; }
function flag(id, label, kind = '') {const target=el(id);target.textContent=label;target.className=`state-flag ${kind}`;}
function setBar(id, value, max) {const ratio = Number.isFinite(value) ? Math.max(0,Math.min(100,100*value/max)) : 0;el(id).style.width=ratio+'%';}
function num(raw) { if (raw === null || raw === undefined || raw === '' || raw === '--') return null; const n=Number(raw);return Number.isFinite(n)?n:null; }
function displayNum(n, decimals = 1) {return n===null?'--':n.toLocaleString('vi-VN',{maximumFractionDigits:decimals});}
function isOn(raw) {return raw===1 || raw==='1' || raw===true;}
function isOff(raw) {return raw===0 || raw==='0' || raw===false;}
function validState(raw) { return isOn(raw) || isOff(raw); }
function liveDevice() {
  if (state.demo) return true;
  const timestamp = num(state.telemetry?.updatedAt);
  return Boolean(state.user && timestamp && Date.now() - timestamp >= -10000 && Date.now()-timestamp < 15000);
}
function timeAgo(timestamp) {
  if (!timestamp) return 'Chưa có dữ liệu';
  const secs=Math.max(0,Math.floor((Date.now()-timestamp)/1000));
  if (secs<5) return 'Vừa cập nhật';
  if (secs<60) return `${secs} giây trước`;
  if (secs<3600) return `${Math.floor(secs/60)} phút trước`;
  return new Date(timestamp).toLocaleString('vi-VN');
}
function renderDoor() {
  const t = state.telemetry || {}, fresh = state.demo || liveDevice();
  const known = fresh && validState(t.DOOR), opened = known && isOn(t.DOOR);
  const distance = num(t.DIST), detected = t.DOOR_PRESENCE;
  el('door-visual').classList.toggle('is-open', opened);
  el('door-status').textContent = !known ? 'Chờ kết nối cửa' : opened ? 'Cửa đang mở' : 'Cửa đang đóng';
  el('door-distance').textContent = fresh && distance !== null && distance >= 2 && distance <= 400 ? displayNum(distance) : '--';
  el('door-limit').textContent = `${num(t.DOOR_LIMIT_CM) ?? 5} cm`;
  el('door-hold').textContent = `${(num(t.DOOR_HOLD_MS) ?? 5000) / 1000} giây`;
  const presence = el('door-presence');
  presence.textContent = !fresh ? 'CHỜ DỮ LIỆU' : isOn(detected) ? 'CÓ VẬT GẦN CỬA' : isOff(detected) ? 'VÙNG PHÁT HIỆN TRỐNG' : 'CHƯA XÁC ĐỊNH';
  presence.className = 'tag ' + (!fresh ? '' : isOn(detected) ? 'info' : isOff(detected) ? 'good' : 'bad');
  const reasons = {
    presence: 'Đang giữ mở vì cảm biến phía ngoài phát hiện người/vật gần cửa.',
    manual: 'Đã nhận yêu cầu mở cửa trên web; đang giữ cửa mở để đi ra.',
    waiting: 'Vùng cảm biến đang trống. Cửa sẽ tự đóng sau thời gian chờ.',
    sensor_fault: opened ? 'Không đọc được cảm biến. Giữ nguyên lệnh mở, tạm dừng tự đóng.' : 'Không đọc được cảm biến. Kiểm tra HC-SR04 trước khi sử dụng.',
    fire: 'Đang giữ cửa mở theo cảnh báo khẩn cấp từ ESP32.',
    idle: 'Đang chờ người phía ngoài hoặc yêu cầu mở cửa từ web.'
  };
  el('door-action').textContent = !known ? 'Chưa có dữ liệu cửa mới từ ESP32.' : reasons[t.DOOR_REASON] || 'Trạng thái cửa theo dữ liệu ESP32.';
  el('door-demo-controls').hidden = !state.demo;
  el('door-demo-person').setAttribute('aria-pressed', String(state.demoPresence));
  el('door-demo-person').textContent = state.demoPresence ? 'Cho người rời vùng cảm biến' : 'Mô phỏng có người phía ngoài';
  const canOpen = state.demo || (fresh && state.user && t.DOOR_MANUAL_READY === true);
  el('door-open-btn').disabled = !canOpen || state.busy.DOOR;
  el('door-open-btn').textContent = state.busy.DOOR ? 'ĐANG CHỜ ESP32 XÁC NHẬN...' : '🚪 MỞ CỬA ĐỂ RA NGOÀI';
  if (!canOpen && !state.busy.DOOR) {
    el('door-feedback').textContent = fresh && state.user ? 'Cần firmware cửa mới và đồng bộ lệnh thành công trên ESP32.' : 'Cần đăng nhập và kết nối ESP32 để mở cửa.';
  }
}
function clearDoorRequest() {
  if (state.doorRequestTimer) clearTimeout(state.doorRequestTimer);
  state.doorRequestTimer = null;
  state.pendingDoorRequest = null;
  state.busy.DOOR = false;
}
function updateDemoDoor(now = Date.now()) {
  if (!state.demo) return;
  const t = state.telemetry;
  t.DOOR_PRESENCE = state.demoPresence ? 1 : 0;
  if (isOn(t.FIRE) || state.demoPresence) {
    t.DOOR = 1;
    t.DOOR_REASON = isOn(t.FIRE) ? 'fire' : 'presence';
    state.demoDoorClearAt = null;
  } else if (isOn(t.DOOR)) {
    if (state.demoDoorClearAt === null) state.demoDoorClearAt = now;
    const remaining = Math.max(0, t.DOOR_HOLD_MS - (now - state.demoDoorClearAt));
    t.DOOR_WAIT_MS = remaining;
    t.DOOR_REASON = remaining ? 'waiting' : 'idle';
    if (!remaining) { t.DOOR = 0; state.demoDoorClearAt = null; log('Mô phỏng: cửa tự đóng sau 5 giây vùng cảm biến trống.'); }
  } else { t.DOOR_REASON = 'idle'; t.DOOR_WAIT_MS = null; }
  t.updatedAt = now;
}
async function openDoor() {
  if (state.demo) {
    state.telemetry.DOOR = 1;
    state.telemetry.DOOR_REASON = 'manual';
    state.demoDoorClearAt = Date.now();
    updateDemoDoor(); renderTelemetry();
    addDemoEvent('exit_requested', 'web');
    el('door-feedback').textContent = 'Mô phỏng: đã mở cửa để ra ngoài; cửa sẽ tự đóng khi hết thời gian chờ.';
    log('Mô phỏng: mở cửa từ nút trên web.');
    return;
  }
  if (state.busy.DOOR || !state.user || !liveDevice() || !state.modules || state.telemetry?.DOOR_MANUAL_READY !== true) {
    toast('ESP32 chưa sẵn sàng nhận lệnh mở cửa.', 'error'); return;
  }
  const requestId = crypto.randomUUID();
  state.pendingDoorRequest = requestId; state.busy.DOOR = true;
  el('door-feedback').textContent = 'Đang gửi yêu cầu mở cửa...'; renderConnection();
  try {
    const {ref, update, serverTimestamp} = state.modules.dbMod;
    await update(ref(state.db, 'smartHome/desired'), {DOOR_OPEN_REQUEST: requestId, updatedAt: serverTimestamp()});
    if (state.pendingDoorRequest !== requestId) return;
    el('door-feedback').textContent = 'Đã gửi yêu cầu; đang chờ ESP32 xác nhận cửa mở.';
    log('Đã gửi yêu cầu mở cửa từ web.');
    state.doorRequestTimer = setTimeout(() => {
      if (state.pendingDoorRequest !== requestId) return;
      clearDoorRequest(); renderConnection();
      el('door-feedback').textContent = 'Chưa nhận xác nhận mở cửa. Kiểm tra kết nối và trạng thái cửa trước khi gửi lại.';
    }, 12000);
  } catch (error) {
    if (state.pendingDoorRequest !== requestId) return;
    clearDoorRequest(); renderConnection();
    const message = 'Không gửi được lệnh mở cửa: ' + authError(error);
    el('door-feedback').textContent = message; toast(message, 'error'); log(message, 'error');
  }
}
function renderTelemetry() {
  const t=state.telemetry || {}, hasData=Boolean(state.telemetry);
  const temperature=num(t.TEMP), humidity=num(t.HUM), mq=num(t.MQ), distance=num(t.DIST);
  el('temp-value').textContent=displayNum(temperature);
  el('hum-value').textContent=displayNum(humidity);
  el('gas-value').textContent=displayNum(mq,0);
  if (temperature===null) {setTag('temp-tag','CHỜ DỮ LIỆU');el('temp-desc').textContent='Đang chờ dữ liệu...';}
  else {setTag('temp-tag','ĐANG ĐO','info');el('temp-desc').textContent='Nhiệt độ môi trường hiện tại';}
  if (humidity===null) {setTag('hum-tag','CHỜ DỮ LIỆU');el('hum-desc').textContent='Đang chờ dữ liệu...';}
  else {setTag('hum-tag','ĐANG ĐO','info');el('hum-desc').textContent='Độ ẩm tương đối môi trường';}
  if (mq===null) {setTag('gas-tag','CHỜ DỮ LIỆU');el('gas-desc').textContent='Đang chờ dữ liệu...';}
  else if(isOn(t.FIRE)) {setTag('gas-tag','CẢNH BÁO','bad');el('gas-desc').textContent='⚠ Mức khí vượt ngưỡng cài đặt';}
  else {setTag('gas-tag','BÌNH THƯỜNG','good');el('gas-desc').textContent='Chưa có cảnh báo từ ESP32';}
  if (distance===null) {el('dist-value').textContent='--';el('dist-unit').textContent='cm';setTag('dist-tag','CHỜ DỮ LIỆU');el('dist-desc').textContent='Đang chờ dữ liệu...';}
  else if(distance<0) {el('dist-value').textContent='Trống';el('dist-unit').textContent='';setTag('dist-tag','KHÔNG CÓ VẬT','');el('dist-desc').textContent='Không nhận được tín hiệu phản hồi';}
  else {el('dist-value').textContent=displayNum(distance);el('dist-unit').textContent='cm';setTag('dist-tag','ĐÃ ĐO','info');el('dist-desc').textContent='Khoảng cách tới vật thể';}
  setBar('temp-bar',temperature,50);setBar('hum-bar',humidity,100);setBar('gas-bar',mq,4095);setBar('dist-bar',distance,100);
  if (!hasData || !validState(t.DOOR)) {el('door-value').textContent='Chưa xác định';el('door-desc').textContent='Chưa nhận dữ liệu từ cảm biến';flag('door-flag','—');}
  else if (isOn(t.DOOR)) {el('door-value').textContent='ĐANG MỞ';el('door-desc').textContent='Cửa tự động đang mở';flag('door-flag','ĐANG MỞ','safe');}
  else {el('door-value').textContent='ĐANG ĐÓNG';el('door-desc').textContent='Cửa đang ở trạng thái đóng';flag('door-flag','ĐÃ ĐÓNG');}
  if (!hasData || !validState(t.FIRE)) {el('fire-value').textContent='Chưa xác định';el('fire-desc').textContent='Chưa nhận dữ liệu từ cảm biến';flag('fire-flag','—');}
  else if(isOn(t.FIRE)) {el('fire-value').textContent='CẢNH BÁO CHÁY!';el('fire-desc').textContent='Kiểm tra thiết bị và khu vực ngay';flag('fire-flag','NGUY HIỂM','alert');}
  else {el('fire-value').textContent='AN TOÀN';el('fire-desc').textContent='ESP32 chưa phát cảnh báo';flag('fire-flag','AN TOÀN','safe');}
  for(const [key, id] of [['LIGHT','light-state'],['FAN','fan-state']]) {
    const target=el(id);
    if(!hasData || !validState(t[key])) {target.textContent='Chưa kết nối';target.className='device-state';}
    else if(isOn(t[key])) {target.textContent=key==='LIGHT'?'Đang sáng':'Đang quay';target.className='device-state on';}
    else {target.textContent='Đã tắt';target.className='device-state off';}
  }
  renderConnection();
}
function renderConnection() {
  const online=liveDevice(), demo=state.demo, authed=Boolean(state.user);
  const dot=el('side-dot'),indicator=el('cloud-indicator'),mode=el('mode-pill');
  dot.className='status-dot '+(demo?'demo':online?'connected':'offline');
  indicator.className='indicator '+(demo?'demo':authed?'connected':'offline');
  el('side-connection').textContent=demo?'Đang chạy dữ liệu mẫu':online?'ESP32 đang trực tuyến':authed?'ESP32 ngoại tuyến':'Chưa kết nối thiết bị';
  mode.innerHTML = '<span class="status-dot '+(demo?'demo':online?'connected':'offline')+'"></span>'+(demo?'CHẾ ĐỘ MÔ PHỎNG':online?'ESP32 TRỰC TUYẾN':authed?'ESP32 NGOẠI TUYẾN':'CHỜ KẾT NỐI');
  el('cloud-message').textContent=demo?'Đang xem dữ liệu giả lập':authed?'Đã đăng nhập Firebase':'Chưa đăng nhập Firebase';
  const stamp=num(state.telemetry?.updatedAt);
  el('last-sync').textContent=demo?'Dữ liệu mẫu':timeAgo(stamp);
  el('config-hint').textContent=demo?'Dữ liệu đang hiển thị là giả lập, không phải từ ESP32.':authed?'Đã xác thực tài khoản. Đang chờ kết nối thiết bị.':configured?'Dùng tài khoản quản trị được cấp để vào ngôi nhà của bạn.':'Dịch vụ đăng nhập chưa sẵn sàng.';
  el('demo-btn').textContent=demo?'✕ Thoát chế độ mô phỏng':'◉ Xem giao diện mẫu (dữ liệu giả lập)';
  el('command-hint').textContent=demo?'Lệnh mô phỏng, không điều khiển thiết bị':online?'Lệnh gửi qua Firebase':'Chỉ hoạt động khi ESP32 trực tuyến';
  for(const device of ['LIGHT','FAN']) {
    const allow=demo||(online&&authed);
    el(device==='LIGHT'?'light-on':'fan-on').disabled=!allow||state.busy[device];
    el(device==='LIGHT'?'light-off':'fan-off').disabled=!allow||state.busy[device];
  }
  renderDoor();
  renderAccess();
}
function tickClock() {
  const date=new Date();
  el('clock').textContent=date.toLocaleTimeString('vi-VN',{hour12:false, timeZone});
  el('date').textContent=date.toLocaleDateString('vi-VN',{timeZone});
  const parts = Object.fromEntries(new Intl.DateTimeFormat('vi-VN',{timeZone,weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'}).formatToParts(date).map(part=>[part.type,part.value]));
  el('full-date').textContent=`${parts.weekday}, ngày ${parts.day} tháng ${parts.month} năm ${parts.year} · Giờ Việt Nam (UTC+7)`;
  if (state.demo) { updateDemoDoor(); renderTelemetry(); }
  renderConnection();
}
function authError(error) {
  const code=error?.code||'';
  if(code.includes('invalid-credential')||code.includes('wrong-password')||code.includes('user-not-found')) return 'Email hoặc mật khẩu không chính xác.';
  if(code.includes('network-request-failed')) return 'Không kết nối được mạng, hãy kiểm tra Internet.';
  if(code.includes('operation-not-allowed')) return 'Hãy bật Email/Password trong Firebase Authentication.';
  if(code.includes('permission-denied')) return 'Tài khoản không có quyền theo Database Rules; hãy kiểm tra UID.';
  return (error?.message||'Lỗi không xác định').slice(0,200);
}
function removeListeners() {for(const unsub of state.unsubscribers){try{unsub();}catch{}}state.unsubscribers=[];}
function observeData() {
  removeListeners();
  if(!state.user||!state.modules) return;
  const {ref,onValue}=state.modules.dbMod;
  state.unsubscribers.push(onValue(ref(state.db,'smartHome/telemetry'), snap=>{
    if (state.demo) return;
    const before=state.telemetry;state.telemetry=snap.val();
    if (state.pendingDoorRequest && state.telemetry?.DOOR_REQUEST_ID === state.pendingDoorRequest && isOn(state.telemetry.DOOR)) {
      clearDoorRequest();
      el('door-feedback').textContent = 'ESP32 đã xác nhận lệnh mở cửa. Cửa sẽ tự đóng sau thời gian chờ khi vùng cảm biến trống.';
      log('ESP32 đã xác nhận mở cửa từ web.');
    }
    if(!state.demo) renderTelemetry();
    if(state.telemetry && (!before||before.updatedAt!==state.telemetry.updatedAt)) {
      if(!state.demo) log('Đã nhận thông số cảm biến từ ESP32.');
      if(before && !state.demo && !isOn(before.FIRE) && isOn(state.telemetry.FIRE)) {
        log('CẢNH BÁO: ESP32 phát hiện nguy cơ cháy/khí gas.','error');toast('CẢNH BÁO KHÍ GAS / CHÁY!','error');
      }
    }
  }, error=>{log('Không đọc được dữ liệu: '+authError(error),'error');toast('Không được phép đọc Firebase. Kiểm tra Database Rules.','error');}));
  state.unsubscribers.push(onValue(ref(state.db,'smartHome/desired'), snap=>{state.desired=snap.val();},error=>{
    log('Không đọc được lệnh thiết bị: '+authError(error),'error');
  }));
  const {query, orderByChild, limitToLast} = state.modules.dbMod;
  const historyQuery = query(ref(state.db,'smartHome/events'), orderByChild('createdAt'), limitToLast(100));
  state.unsubscribers.push(onValue(historyQuery, snap => {
    if (state.demo) return;
    state.history = Object.values(snap.val() || {}).filter(event => event && typeof event === 'object');
    state.history.sort((a,b) => (num(b.occurredAt) || num(b.createdAt) || 0) - (num(a.occurredAt) || num(a.createdAt) || 0));
    state.historyError = false; renderHistory();
  }, error => {state.historyError = true; renderHistory(); log('Không đọc được lịch sử cửa: ' + authError(error), 'error');}));
}
function enterDemo() {
  clearDoorRequest();
  state.demo=true;
  state.demoHistory=[]; renderHistory();
  state.demoPresence=false; state.demoDoorClearAt=null;
  if(state.demoInterval) clearInterval(state.demoInterval);
  state.telemetry={TEMP:28.1,HUM:66.2,MQ:2715,DIST:120,DOOR:0,DOOR_PRESENCE:0,DOOR_REASON:'idle',DOOR_LIMIT_CM:5,DOOR_HOLD_MS:5000,FIRE:0,LIGHT:0,FAN:0,updatedAt:Date.now()};
  el('door-feedback').textContent='Thử nút mở cửa để ra ngoài hoặc mô phỏng người đến từ phía ngoài.';
  state.demoInterval=setInterval(()=>{
    if(!state.demo)return;
    state.telemetry.TEMP=(27.4+Math.random()*2).toFixed(1);
    state.telemetry.HUM=(62+Math.random()*9).toFixed(1);
    state.telemetry.MQ=Math.floor(2410+Math.random()*400);
    state.telemetry.DIST=(state.demoPresence?3+Math.random():115+Math.random()*10).toFixed(1);
    state.telemetry.updatedAt=Date.now();renderTelemetry();
  },2600);
  renderTelemetry();log('Đã bật chế độ mô phỏng; không kết nối ESP32.','warn');toast('Đang xem giao diện mẫu – dữ liệu giả lập.');
}
function exitDemo() {
  state.demo=false;clearInterval(state.demoInterval);state.demoInterval=null;
  state.telemetry=null;state.desired=null;renderTelemetry();
  state.demoPresence=false; state.demoDoorClearAt=null;
  renderDoor();
  state.demoHistory=[]; renderHistory();
  if(state.user)observeData();
  log('Đã thoát chế độ mô phỏng.');
}
async function control(device,desiredValue) {
  if (state.demo) {
    state.telemetry[device]=desiredValue;
    state.telemetry.updatedAt=Date.now();renderTelemetry();
    const name=device==='LIGHT'?'đèn':'quạt';
    el(device==='LIGHT'?'light-feedback':'fan-feedback').textContent=`Mô phỏng: ${desiredValue?'bật':'tắt'} ${name}.`;
    log(`Mô phỏng ${desiredValue?'bật':'tắt'} ${name}.`);return;
  }
  if(!state.user||!liveDevice()||!state.modules) {toast('ESP32 chưa trực tuyến hoặc bạn chưa đăng nhập.','error');return;}
  const name=device==='LIGHT'?'đèn phòng':'quạt gió';
  state.busy[device]=true;renderConnection();
  try {
    const {ref,update,serverTimestamp}=state.modules.dbMod;
    await update(ref(state.db,'smartHome/desired'),{[device]:desiredValue,updatedAt:serverTimestamp()});
    el(device==='LIGHT'?'light-feedback':'fan-feedback').textContent=`Đã gửi yêu cầu ${desiredValue?'bật':'tắt'} ${name}; chờ ESP32 phản hồi.`;
    log(`Đã gửi lệnh ${desiredValue?'BẬT':'TẮT'} ${name} qua Firebase.`);
    toast('Đã gửi lệnh. Trạng thái thực tế hiển thị trên thẻ thiết bị.');
  } catch (error) {
    const message='Lỗi gửi lệnh: '+authError(error);
    log(message,'error');toast(message,'error');
  } finally {state.busy[device]=false;renderConnection();}
}
async function initializeFirebase() {
  if (!configured) {
    el('login-btn').disabled=true;
    el('login-btn').textContent='CHƯA SẴN SÀNG';
    showLoginError('Dịch vụ đăng nhập chưa được thiết lập.');
    log('Chưa thiết lập firebase-config.js: hiện có thể xem giao diện mẫu.','warn');return;
  }
  try {
    // Browser ESM trực tiếp từ Google, không cần npm/build tool.
    const [appMod,authMod,dbMod]=await Promise.all([
      import('https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js')
    ]);
    state.modules={appMod,authMod,dbMod};
    const app=appMod.initializeApp(config);
    state.auth=authMod.getAuth(app);
    state.db=dbMod.getDatabase(app);
    authMod.onAuthStateChanged(state.auth,handleAuthState,error=>{showLoginError('Không kiểm tra được phiên đăng nhập. Hãy tải lại trang.');log('Lỗi xác thực: '+authError(error),'error');});
    log('Đã khởi tạo ứng dụng Firebase.');
  }catch(error){showLoginError('Không kết nối được dịch vụ đăng nhập. Kiểm tra mạng rồi tải lại trang.');el('login-btn').textContent='CHƯA KẾT NỐI';log('Không tải được Firebase SDK: '+authError(error),'error');}
}
el('login-form').addEventListener('submit',async (event)=>{
  event.preventDefault();
  if(!state.auth||!state.modules){toast('Chưa khởi tạo Firebase. Kiểm tra file cấu hình.','error');return;}
  const email=el('email').value.trim(),password=el('password').value;
  if(!email||!password)return;
  el('login-btn').disabled=true;el('login-btn').textContent='ĐANG ĐĂNG NHẬP...';
  showLoginError();
  try{await state.modules.authMod.signInWithEmailAndPassword(state.auth,email,password);el('password').value='';}
  catch(error){const msg=authError(error);showLoginError(msg);log('Đăng nhập thất bại: '+msg,'error');}
  finally{el('login-btn').disabled=false;el('login-btn').textContent='ĐĂNG NHẬP';}
});
el('logout-btn').addEventListener('click',async()=>{if(state.auth){await state.modules.authMod.signOut(state.auth);log('Đã đăng xuất Firebase.');}});
el('demo-btn').addEventListener('click',()=>state.demo?exitDemo():enterDemo());
el('exit-demo-btn').addEventListener('click',exitDemo);
el('history-filter').addEventListener('change',renderHistory);
el('door-open-btn').addEventListener('click', openDoor);
el('door-demo-person').addEventListener('click', () => {
  if (!state.demo) return;
  state.demoPresence = !state.demoPresence;
  state.telemetry.DIST = state.demoPresence ? 3 : 120;
  if (state.demoPresence) addDemoEvent('outside_detected', 'sensor_outside');
  updateDemoDoor(); renderTelemetry();
  log(state.demoPresence ? 'Mô phỏng: có người/vật phía ngoài, cửa giữ mở.' : 'Mô phỏng: vùng cảm biến trống, bắt đầu chờ đóng cửa.');
});
el('light-on').addEventListener('click',()=>control('LIGHT',1));
el('light-off').addEventListener('click',()=>control('LIGHT',0));
el('fan-on').addEventListener('click',()=>control('FAN',1));
el('fan-off').addEventListener('click',()=>control('FAN',0));
el('clear-log').addEventListener('click',()=>{el('log-list').replaceChildren();log('Nhật ký giao diện đã được xóa.');});
el('menu-toggle').addEventListener('click',()=>{const sidebar=document.querySelector('.sidebar');sidebar.classList.toggle('open');el('menu-toggle').setAttribute('aria-expanded',sidebar.classList.contains('open')?'true':'false');});
document.querySelectorAll('.side-nav a').forEach(a=>a.addEventListener('click',()=>document.querySelector('.sidebar').classList.remove('open')));
el('login-form').hidden=false;
renderTelemetry();renderHistory();tickClock();setInterval(tickClock,1000);initializeFirebase();
