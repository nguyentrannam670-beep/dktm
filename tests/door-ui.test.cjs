const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function dashboard() {
  let now = 1800000000000, timerId = 0;
  const timers = new Map();
  class Element {
    constructor() {
      this.children = []; this.textContent = ''; this.className = '';
      this.style = {}; this.attributes = {}; this.events = {}; this.disabled = false;
      this.classList = {toggle: (name, force) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        const add = force === undefined ? !names.has(name) : force;
        if (add) names.add(name); else names.delete(name);
        this.className = [...names].join(' '); return add;
      }, remove: name => { this.className = this.className.replace(name, '').trim(); }};
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(name, handler) { this.events[name] = handler; }
    click() { if (!this.disabled) return this.events.click?.({preventDefault() {}}); }
    append(...nodes) { nodes.forEach(node => { node.parent = this; this.children.push(node); }); }
    prepend(node) { node.parent = this; this.children.unshift(node); }
    replaceChildren() { this.children = []; }
    get lastElementChild() { return this.children.at(-1); }
    remove() { this.parent.children = this.parent.children.filter(node => node !== this); }
  }
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([,id]) => [id, new Element()]));
  const get = id => { assert.ok(elements.has(id), `Missing HTML element: ${id}`); return elements.get(id); };
  const context = vm.createContext({
    window: {}, console, Intl, Math, crypto: {randomUUID: () => 'test-request-id'},
    Date: class extends Date { constructor(...args) { if (args.length) super(...args); else super(now); } static now() { return now; } },
    document: {getElementById: get, createElement: () => new Element(), querySelectorAll: () => [], querySelector: () => new Element()},
    setInterval: () => ++timerId, clearInterval() {},
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, {callback, at: now + delay}); return id; },
    clearTimeout: id => timers.delete(id), listeners: {}, sent: []
  });
  const run = script => vm.runInContext(script, context);
  run(fs.readFileSync(path.join(root, 'public/app.js'), 'utf8'));
  return {get, run, context, advance(ms) {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    run('tickClock()');
  }, live() {
    run(`state.user = {uid:'admin'}; state.db = {};
      state.telemetry = {DIST:120, DOOR:0, DOOR_PRESENCE:0, DOOR_REASON:'idle', DOOR_MANUAL_READY:true, updatedAt:Date.now()};
      state.modules = {dbMod: {
        ref: (_, p) => p, onValue: (p, callback) => { listeners[p] = callback; return () => {}; },
        query: (p, ...constraints) => { globalThis.historyConstraints = constraints; return p; },
        orderByChild: key => ({orderByChild:key}), limitToLast: count => ({limitToLast:count}),
        update: async (p, value) => { sent.push({path:p, value}); }, serverTimestamp: () => ({'.sv':'timestamp'})
      }}; observeData(); renderTelemetry();`);
  }};
}

test('demo manual open closes after five seconds and never writes Firebase', async () => {
  const app = dashboard();
  assert.equal(app.get('door-open-btn').disabled, true);
  app.get('demo-btn').click();
  await app.get('door-open-btn').click();
  assert.equal(app.get('door-status').textContent, 'Cửa đang mở');
  app.advance(4999);
  assert.equal(app.run('state.telemetry.DOOR'), 1);
  app.advance(1);
  assert.equal(app.run('state.telemetry.DOOR'), 0);
  assert.equal(app.context.sent.length, 0);
});

test('outside presence holds the door open and cancels a pending close', () => {
  const app = dashboard(); app.get('demo-btn').click();
  app.get('door-demo-person').click(); app.advance(20000);
  assert.equal(app.run('state.telemetry.DOOR'), 1);
  app.get('door-demo-person').click(); app.advance(4000);
  app.get('door-demo-person').click(); app.advance(10000);
  assert.equal(app.run('state.telemetry.DOOR'), 1);
  app.get('door-demo-person').click(); app.advance(5000);
  assert.equal(app.run('state.telemetry.DOOR'), 0);
});

test('pressing open again restarts the demo hold', async () => {
  const app = dashboard(); app.get('demo-btn').click();
  await app.get('door-open-btn').click(); app.advance(4000);
  await app.get('door-open-btn').click(); app.advance(4000);
  assert.equal(app.run('state.telemetry.DOOR'), 1);
  app.advance(1000); assert.equal(app.run('state.telemetry.DOOR'), 0);
});

test('live button sends one request and waits for the matching ESP32 acknowledgement', async () => {
  const app = dashboard(); app.live();
  await app.get('door-open-btn').click();
  assert.equal(app.context.sent.length, 1);
  assert.equal(app.context.sent[0].path, 'smartHome/desired');
  assert.equal(app.context.sent[0].value.DOOR_OPEN_REQUEST, 'test-request-id');
  assert.equal(app.run('state.telemetry.DOOR'), 0);
  assert.equal(app.get('door-open-btn').disabled, true);
  app.context.listeners['smartHome/telemetry']({val: () => ({DOOR:1, DOOR_REQUEST_ID:'other', DOOR_MANUAL_READY:true, updatedAt:app.run('Date.now()')})});
  assert.equal(app.get('door-open-btn').disabled, true);
  app.context.listeners['smartHome/telemetry']({val: () => ({DOOR:1, DOOR_REQUEST_ID:'test-request-id', DOOR_MANUAL_READY:true, updatedAt:app.run('Date.now()')})});
  assert.equal(app.get('door-open-btn').disabled, false);
  assert.match(app.get('door-feedback').textContent, /ESP32 đã xác nhận/);
});

test('offline or older firmware cannot receive manual door commands', async () => {
  const app = dashboard(); app.live();
  app.run('delete state.telemetry.DOOR_MANUAL_READY; renderTelemetry()');
  assert.equal(app.get('door-open-btn').disabled, true);
  app.run('state.telemetry.DOOR_MANUAL_READY = true'); app.advance(16000);
  assert.equal(app.get('door-open-btn').disabled, true);
  await app.run('openDoor()');
  assert.equal(app.context.sent.length, 0);
});

test('Firebase failures and missing acknowledgements never report a successful opening', async () => {
  const app = dashboard(); app.live();
  app.run("state.modules.dbMod.update = async () => { throw {code:'permission-denied'}; }");
  await app.get('door-open-btn').click();
  assert.equal(app.run('state.telemetry.DOOR'), 0);
  assert.match(app.get('door-feedback').textContent, /Không gửi được/);
  app.run('state.modules.dbMod.update = async () => {}');
  await app.get('door-open-btn').click(); app.advance(12000);
  assert.match(app.get('door-feedback').textContent, /Chưa nhận xác nhận/);
  assert.equal(app.run('state.telemetry.DOOR'), 0);
});

test('live telemetry cannot overwrite simulated door data', () => {
  const app = dashboard(); app.live(); app.get('demo-btn').click();
  app.get('door-demo-person').click();
  app.context.listeners['smartHome/telemetry']({val: () => ({DOOR:0, updatedAt:app.run('Date.now()')})});
  assert.equal(app.run('state.telemetry.DOOR'), 1);
  assert.equal(app.run('state.demo'), true);
  app.get('demo-btn').click();
  assert.equal(app.get('door-demo-controls').hidden, true);
});

test('login screen gates the dashboard and sign-out clears private history', () => {
  const app = dashboard();
  assert.equal(app.get('auth-screen').hidden, false);
  assert.equal(app.get('app-shell').hidden, true);
  app.live();
  assert.equal(app.get('auth-screen').hidden, true);
  assert.equal(app.get('app-shell').hidden, false);
  app.run("state.history = [{type:'exit_requested', source:'web', createdAt:Date.now()}]; renderHistory()");
  assert.equal(app.get('door-history-body').children.length, 1);
  app.run('handleAuthState(null)');
  assert.equal(app.get('auth-screen').hidden, false);
  assert.equal(app.get('app-shell').hidden, true);
  assert.equal(app.get('door-history-body').children.length, 0);
});

test('login failures stay on the login screen with an inline error', async () => {
  const app = dashboard();
  app.run("state.auth={}; state.modules={authMod:{signInWithEmailAndPassword:async()=>{throw {code:'auth/invalid-credential'};}}}");
  app.get('email').value = 'admin@example.com'; app.get('password').value = 'wrong';
  await app.get('login-form').events.submit({preventDefault(){}});
  assert.equal(app.get('app-shell').hidden, true);
  assert.equal(app.get('login-error').hidden, false);
  assert.match(app.get('login-error').textContent, /không chính xác/);
});

test('a different Firebase user cannot enter the administrator dashboard', () => {
  const app = dashboard();
  app.run("window.SMART_HOME_ADMIN_UID='owner'; state.auth={}; state.modules={authMod:{signOut:async()=>{}}}; handleAuthState({uid:'other',email:'other@example.com'})");
  assert.equal(app.get('app-shell').hidden, true);
  assert.match(app.get('login-error').textContent, /chưa được cấp quyền/);
});

test('clock and history show the full date using UTC+7 across midnight', () => {
  const app = dashboard();
  const display = app.run('eventTime(Date.UTC(2026,10,3,17,30,45))');
  assert.match(display, /00:30:45/);
  assert.match(display, /04\/11\/2026/);
  assert.match(app.get('clock').textContent, /\d{2}:\d{2}:\d{2}/);
  assert.match(app.get('full-date').textContent, /năm \d{4}/);
});

test('saved events load in time order with type filters and precise timestamps', () => {
  const app = dashboard(); app.live();
  const snapshot = {older:{type:'outside_detected',source:'sensor_outside',createdAt:1793700000000}, newer:{type:'exit_requested',source:'web',occurredAt:1793700100000,createdAt:1793700200000}};
  app.context.listeners['smartHome/events']({val:()=>snapshot});
  assert.equal(app.get('door-history-body').children.length, 2);
  const first = app.get('door-history-body').children[0];
  assert.match(first.children[1].textContent, /Nhận lệnh mở/);
  assert.match(first.children[0].children[0].textContent, /2026/);
  app.get('history-filter').value = 'outside_detected';
  app.get('history-filter').events.change();
  assert.equal(app.get('door-history-body').children.length, 1);
  assert.match(app.get('door-history-body').children[0].children[1].textContent, /Phát hiện người\/vật/);
  assert.equal(app.context.sent.length, 0);
  assert.equal(app.context.historyConstraints[0].orderByChild, 'createdAt');
  assert.equal(app.context.historyConstraints[1].limitToLast, 100);
});

test('demo history records sensor arrival once, stays separate, and exits back to login', async () => {
  const app = dashboard(); app.get('demo-btn').click();
  app.get('door-demo-person').click(); app.advance(5000);
  assert.equal(app.run('state.demoHistory.length'), 1);
  await app.get('door-open-btn').click();
  assert.equal(app.run('state.demoHistory.length'), 2);
  assert.match(app.get('history-mode').textContent, /MÔ PHỎNG/);
  assert.equal(app.context.sent.length, 0);
  app.get('exit-demo-btn').click();
  assert.equal(app.get('auth-screen').hidden, false);
  assert.equal(app.run('state.demoHistory.length'), 0);
});
