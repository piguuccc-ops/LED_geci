// Fénycsík – fő alkalmazás
import { h, icon, toast, sheet, promptText, confirmBox, menu, longPress } from './ui.js';
import { BleLink } from './ble.js';
import { DemoLink } from './virtual.js';
import { kv, library, newId } from './store.js';
import { Engine } from './engine.js';
import { EFFECTS, effectLabel, compileMode, normalizeMode, deviceJson, sameMode, errorText, templateFor, toHex, parseHex } from './modes.js';
import { fastColor, fastBri, fastPower, fastSpeed, fastIntensity, fastPaletteColor } from './protocol.js';
import { HeroStrip, setHeroRenderer, addPreview, prunePreviews } from './strip.js';
import { ColorPicker, presetSwatches, swatch } from './picker.js';
import { uiAccent, textOn, css } from './color.js';
import * as io from './importer.js';
import { openEditor, paramEditor, toggleRow } from './editor.js';

const $ = (s) => document.querySelector(s);
const now = () => Math.floor(performance.now());

// ------------------------------------------------------------------ állapot

const S = {
  link: null,
  conn: 'idle',
  info: null,
  on: true,
  bri: 150,
  timer: 0,
  timerAt: 0,
  mA: 0,
  cur: null,
  devModes: [],
  lib: [],
  favorites: [],
  segment: 'hsv',
  autoUpload: true,
  fxParams: {},
  selFx: 'rainbow',
  tab: 'color',
  lastDevice: '',
  briTouched: 0,
  onTouched: 0,
  curTouched: 0,
  pickerTouched: 0,
  silentSaves: new Set(),
  installPrompt: null,
  previewNoted: false,
};

const connected = () => S.conn === 'connected' && S.link;
const withW = () => S.info?.cfg?.type === 'rgbw' || (S.info?.cfg?.type === 'analog' && S.info?.cfg?.apins?.[3] >= 0);

// Fényerő: a csúszka 0–100 % érzékelt fényerő, az eszköz 0–255 lineáris értéket kap
const pctToBri = (p) => (p <= 0 ? 0 : Math.max(1, Math.round(255 * Math.pow(p / 100, 1.8))));
const briToPct = (b) => (b <= 0 ? 0 : Math.max(1, Math.round(100 * Math.pow(b / 255, 1 / 1.8))));

// ------------------------------------------------------------------ élő szalag

const heroEng = new Engine(60, now());
let hero = null;
let heroLevel = 0;
let lastHeroT = now();
let accentAt = 0;
let lastAccent = '';

function heroFrame(t) {
  const target = S.on ? S.bri / 255 : 0;
  const k = Math.min(1, (t - lastHeroT) / 120);
  lastHeroT = t;
  heroLevel += (target - heroLevel) * k;
  const buf = heroEng.render(t);
  hero.draw(buf, heroEng.n, heroLevel);
  if (t - accentAt > 350) { accentAt = t; updateAccent(buf, heroEng.n); }
}

// A felület kiemelő színe a szalag fényéből jön
function updateAccent(buf, n) {
  let best = null, bestV = 40;
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const i = Math.min(n - 1, Math.floor(f * (n - 1)));
    const v = Math.max(buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2]);
    if (v > bestV) { bestV = v; best = [buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2]]; }
  }
  if (!best && buf[3]) best = [255, 236, 210];
  if (!best) return;
  const a = uiAccent(best);
  const key = a.join();
  if (key === lastAccent) return;
  lastAccent = key;
  const root = document.documentElement.style;
  root.setProperty('--live-ui', css(a));
  root.setProperty('--on-live-ui', textOn(a));
  root.setProperty('--live-glow', css(a, 0.35));
}

function setCur(mode, fade = 400) {
  S.cur = mode;
  try { heroEng.play(compileMode(mode), now(), fade); } catch { /* hibás mód: marad a régi */ }
  kv.set('lastCur', mode);
  renderNow();
  syncPickerFromCur();
  markActiveFx();
  renderLibActive();
}

function applyDeviceSize() {
  const cfg = S.info?.cfg;
  if (!cfg) return;
  const n = cfg.type === 'analog' ? 1 : cfg.count;
  hero.single = cfg.type === 'analog';
  if (heroEng.n !== n) {
    heroEng.setLength(n);
    if (S.cur) try { heroEng.play(compileMode(S.cur), now(), 0); } catch { /* */ }
  }
}

// ------------------------------------------------------------------ kapcsolat

function setLink(l) {
  if (S.link && S.link !== l) S.link.disconnect();
  S.link = l;
  l.addEventListener('state', (e) => {
    if (S.link !== l) return;
    S.conn = e.detail;
    if (e.detail === 'connected' && l.kind === 'ble') { S.lastDevice = l.name; kv.set('lastDevice', l.name); }
    if (e.detail === 'idle') { S.info = null; S.devModes = []; renderSettings(); renderDevModes(); renderLib(); }
    renderConn();
  });
  l.addEventListener('message', (e) => { if (S.link === l) onMessage(e.detail); });
  l.addEventListener('lost', () => toast('Elveszett a kapcsolat az eszközzel.', { action: 'Újracsatlakozás', onAction: connect }));
}

function bleError(e) {
  const m = String(e?.message || e);
  if (e?.name === 'SecurityError') return 'A Bluetooth csak HTTPS-en vagy telepített appként működik.';
  if (/Bluetooth adapter not available|adapter/i.test(m)) return 'Nincs Bluetooth ezen a gépen, vagy ki van kapcsolva.';
  if (/globally disabled|not available/i.test(m)) return 'A böngészőben ki van kapcsolva a Bluetooth.';
  return 'Nem sikerült csatlakozni. Kapcsold be az ESP32-t, és próbáld újra közelebbről.';
}

async function connect() {
  if (!BleLink.supported()) { offerDemo(); return; }
  try {
    if (navigator.bluetooth.getAvailability && !(await navigator.bluetooth.getAvailability())) {
      toast('Kapcsold be a Bluetooth-t ezen az eszközön.');
      return;
    }
  } catch { /* nem minden böngésző tudja */ }
  const l = new BleLink();
  setLink(l);
  try {
    await l.request();
  } catch (e) {
    if (e?.name === 'NotFoundError' || /cancel/i.test(e?.message || '')) return;  // a felhasználó bezárta a választót
    toast(bleError(e), { kind: 'err' });
  }
}

async function connectDemo() {
  const l = new DemoLink();
  setLink(l);
  await l.request();
  toast('Bemutató eszköz: minden működik, csak nincs valódi szalag.');
}

function offerDemo() {
  sheet({
    title: 'Itt nincs Bluetooth',
    cls: 'small',
    body: h('div', { class: 'stack' },
      h('p', null, 'Ez a böngésző nem tud Bluetooth-on csatlakozni. Telefonon Chrome-ban, laptopon Chrome-ban vagy Edge-ben nyisd meg az appot.'),
      h('p', { class: 'muted' }, 'Addig kipróbálhatod a bemutató eszközzel.')),
    actions: [
      { label: 'Bezárás', kind: 'ghost', value: null },
      { label: 'Bemutató indítása', kind: 'primary', onClick: () => { connectDemo(); } },
    ],
  });
}

function deviceSheet() {
  const i = S.info;
  const rows = i ? [
    ['Név', i.cfg?.name],
    ['Lapka', i.chip + (i.model && i.model !== i.chip ? ` (${i.model})` : '')],
    ['Firmware', i.fw],
    ['LED-ek', i.cfg?.type === 'analog' ? 'sima RGB szalag' : `${i.cfg?.count} db, ${i.cfg?.order}, ${i.cfg?.pin}. láb`],
    ['Becsült áram', `${S.mA} mA`],
  ] : [];
  sheet({
    title: S.link?.kind === 'demo' ? 'Bemutató eszköz' : (S.link?.name || 'Eszköz'),
    cls: 'small',
    body: h('dl', { class: 'facts' }, rows.map(([k, v]) => [h('dt', null, k), h('dd', null, v ?? '–')])),
    actions: [
      { label: 'Leválasztás', kind: 'ghost', onClick: () => { S.link?.disconnect(); } },
      { label: 'Kész', kind: 'primary', value: null },
    ],
  });
}

function onMessage(m) {
  switch (m.t) {
    case 'info':
      S.info = m;
      applyDeviceSize();
      renderSettings();
      renderConn();
      picker?.setWithW(withW());
      break;
    case 'state':
      // a készülék késleltetett visszajelzése ne írja felül az épp most helyben állított értéket
      if (Date.now() - S.onTouched > 900) S.on = !!m.on;
      if (Date.now() - S.briTouched > 900) S.bri = m.bri;
      S.timer = m.timer || 0;
      S.timerAt = Date.now();
      S.mA = m.mA || 0;
      renderMaster();
      renderTimer();
      break;
    case 'cur':
      if (Date.now() - S.curTouched < 450) break;
      if (!S.cur || !sameMode(S.cur, m.mode)) setCur(m.mode);
      break;
    case 'list':
      S.devModes = m.modes || [];
      renderDevModes();
      renderLib();
      break;
    case 'mode':
      pendingGet?.(m.mode);
      break;
    case 'ok':
      if (m.op === 'save') {
        if (S.silentSaves.has(m.name)) S.silentSaves.delete(m.name);
        else toast(`Feltöltve az eszközre: ${m.name}`);
      }
      if (m.op === 'del') toast(`Törölve az eszközről: ${m.name}`);
      break;
    case 'err':
      if (m.op === 'save' && S.silentSaves.size) S.silentSaves.clear();
      toast(errorText(m.msg), { kind: 'err' });
      break;
    case 'reboot':
      toast('Az eszköz újraindul, utána magától visszacsatlakozom.');
      break;
  }
}

let pendingGet = null;
function getDeviceMode(name) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pendingGet = null; reject(new Error('timeout')); }, 8000);
    pendingGet = (mode) => { clearTimeout(t); pendingGet = null; resolve(mode); };
    S.link.sendJson({ t: 'get', name }).catch(reject);
  });
}

// ------------------------------------------------------------------ műveletek

function notePreview() {
  if (S.previewNoted || connected()) return;
  S.previewNoted = true;
  toast('Ez most csak előnézet. Csatlakozz, és a szalagon is így fog világítani.', { action: 'Csatlakozás', onAction: connect });
}

function playMode(json, { fade = 400 } = {}) {
  let mode;
  try { mode = normalizeMode(json); } catch (e) { toast(errorText(e.code), { kind: 'err' }); return; }
  setCur(mode, fade);
  S.curTouched = Date.now();
  if (!S.on) { S.on = true; S.onTouched = Date.now(); renderMaster(); }
  if (connected()) S.link.sendJson({ t: 'play', mode: deviceJson(mode), fade }).catch(() => {});
  else notePreview();
}

function sendColor(c) {
  const t = now();
  heroEng.setSolid(c, t);
  const hex = toHex(c);
  if (S.cur?.effect === 'solid') {
    const colors = [...(S.cur.colors || [])];
    colors[0] = hex;
    S.cur = { ...S.cur, colors };
  } else {
    S.cur = { ledmode: 1, name: '', effect: 'solid', colors: [hex] };
  }
  S.curTouched = Date.now();
  if (!S.on) { S.on = true; S.onTouched = Date.now(); renderMaster(); }
  if (connected()) S.link.sendFast('color', fastColor(c));
  else notePreview();
  renderNow();
  markActiveFx();
  renderLibActive();
  saveCurSoon();
}

let curSaveTimer = null;
function saveCurSoon() { clearTimeout(curSaveTimer); curSaveTimer = setTimeout(() => kv.set('lastCur', S.cur), 1500); }

function patchCur(fn) {
  if (!S.cur) return;
  const next = structuredClone(S.cur);
  fn(next);
  S.cur = next;
  S.curTouched = Date.now();
  saveCurSoon();
}

function setBrightness(b) {
  S.bri = b;
  S.briTouched = Date.now();
  const turnOn = !S.on && b > 0;
  if (turnOn) { S.on = true; S.onTouched = Date.now(); }
  if (connected()) {
    S.link.sendFast('bri', fastBri(b));
    if (turnOn) S.link.sendFast('power', fastPower(true));
  }
  renderMaster();
}

function togglePower() {
  S.on = !S.on;
  S.onTouched = Date.now();
  if (connected()) S.link.sendFast('power', fastPower(S.on));
  renderMaster();
}

async function uploadMode(mode, { silent = false } = {}) {
  if (!connected()) { toast('Előbb csatlakozz az eszközhöz.'); return; }
  if (silent) S.silentSaves.add(mode.name);
  try { await S.link.sendJson({ t: 'save', mode: deviceJson(mode) }); } catch { toast('A feltöltés nem sikerült.', { kind: 'err' }); }
}

// ------------------------------------------------------------------ könyvtár

const libSort = () => S.lib.sort((a, b) => a.mode.name.localeCompare(b.mode.name, 'hu'));

async function addToLibrary(modes, meta = {}) {
  const res = { added: 0, updated: 0, same: 0, names: [] };
  const toUpload = [];
  for (const mode of modes) {
    if (S.lib.some((it) => sameMode(it.mode, mode))) { res.same++; continue; }
    const ex = S.lib.find((it) => it.mode.name === mode.name);
    if (ex) {
      ex.mode = mode;
      ex.updatedAt = Date.now();
      await library.put(ex);
      res.updated++;
      res.names.push(mode.name);
    } else {
      const it = { id: newId(), mode, source: meta.source || 'app', fileName: meta.fileName || '', addedAt: Date.now() };
      S.lib.push(it);
      await library.put(it);
      res.added++;
      res.names.push(mode.name);
    }
    toUpload.push(mode);
  }
  libSort();
  renderLib();
  if (S.autoUpload && connected()) for (const m of toUpload) await uploadMode(m, { silent: true });
  return res;
}

const SOURCE_LABEL = { folder: 'Figyelt mappa', share: 'Megosztás', clipboard: 'Vágólap', open: 'Megnyitott fájl' };

function reportImport(r) {
  if (!r) return;
  const news = r.added + r.updated;
  let msg;
  if (news === 1) msg = `${r.added ? 'Új mód' : 'Frissítve'}: ${r.names[0]}.`;
  else if (news > 1) msg = [r.added ? `${r.added} új mód` : '', r.updated ? `${r.updated} frissített mód` : ''].filter(Boolean).join(', ') + '.';
  else if (r.same) msg = r.same === 1 ? 'Ez a mód már megvan a könyvtárban.' : 'Ezek a módok már megvannak a könyvtárban.';
  else msg = r.errors.length ? '' : 'Nem találtam benne módot.';
  if (r.errors.length) {
    const e = r.errors[0];
    if (news || r.same) msg += r.errors.length === 1 ? ` Egy hibás tétel kimaradt: ${errorText(e.code)}` : ` ${r.errors.length} hibás tétel kimaradt.`;
    else msg += r.errors.length === 1 ? `${e.file ? `${e.file}: ` : ''}${errorText(e.code)}` : `${r.errors.length} hibás tétel, egy mód sem került be.`;
  }
  if (news && S.autoUpload && connected()) msg += ' Az eszközre is felkerült.';
  const label = SOURCE_LABEL[r.source];
  toast((label ? `${label}: ` : '') + msg.trim(), { kind: !news && r.errors.length ? 'err' : '' });
}

async function deleteFromLibrary(it) {
  S.lib = S.lib.filter((x) => x.id !== it.id);
  await library.del(it.id);
  renderLib();
  toast(`Törölve: ${it.mode.name}`, {
    action: 'Visszavonás',
    onAction: async () => { S.lib.push(it); libSort(); await library.put(it); renderLib(); },
  });
}

function exportModes(modes, name) {
  const file = io.modeFile(modes, name);
  io.downloadFile(file);
  toast(`Letöltve: ${file.name}`);
}

async function shareModes(modes) {
  const file = io.modeFile(modes);
  try { await io.shareFile(file, modes[0].name); } catch (e) { if (e?.name !== 'AbortError') exportModes(modes); }
}

function editMode(it) {
  openEditor(it ? it.mode : templateFor('keyframes'), {
    title: it ? 'Mód szerkesztése' : 'Új mód',
    withW: withW(),
    favorites: S.favorites,
    onTry: (mode) => playMode(mode),
    onSave: async (mode) => {
      if (it) {
        if (it.mode.name !== mode.name && S.lib.some((x) => x !== it && x.mode.name === mode.name)) {
          toast('Már van ilyen nevű mód a könyvtárban.', { kind: 'err' });
          return;
        }
        it.mode = mode;
        it.updatedAt = Date.now();
        await library.put(it);
        libSort();
        renderLib();
        if (S.autoUpload && connected()) await uploadMode(mode, { silent: true });
        toast(`Mentve: ${mode.name}`);
      } else {
        await addToLibrary([mode]);
        toast(`Mentve a könyvtárba: ${mode.name}`);
      }
    },
  });
}

function newModeFrom(effect) {
  openEditor(templateFor(effect), {
    title: 'Új mód', withW: withW(), favorites: S.favorites,
    onTry: (mode) => playMode(mode),
    onSave: async (mode) => {
      if (S.lib.some((x) => x.mode.name === mode.name)) { toast('Már van ilyen nevű mód; adj neki másik nevet.', { kind: 'err' }); return; }
      await addToLibrary([mode]);
      toast(`Mentve a könyvtárba: ${mode.name}`);
    },
  });
}

// ------------------------------------------------------------------ fejléc, mester sor

function renderConn() {
  const b = $('#connBtn');
  const label = b.querySelector('.conn-label');
  b.dataset.state = S.conn;
  const name = S.link?.kind === 'demo' ? 'Bemutató szalag' : (S.info?.cfg?.name || S.link?.name || '');
  $('#devName').textContent = S.conn === 'connected' ? name : 'Fénycsík';
  label.textContent = {
    idle: 'Csatlakozás', connecting: 'Kapcsolódás…', reconnecting: 'Újracsatlakozás…', connected: 'Csatlakozva',
  }[S.conn] || 'Csatlakozás';
  b.setAttribute('aria-label', S.conn === 'connected' ? `Csatlakozva: ${name}. Részletek` : label.textContent);
  document.body.dataset.conn = S.conn;
  $('#hint')?.toggleAttribute('hidden', S.conn === 'connected');
}

function renderNow() {
  const m = S.cur;
  const nameEl = $('#nowName'), fxEl = $('#nowFx');
  if (!m) { nameEl.textContent = 'Nincs mód'; fxEl.textContent = ''; return; }
  if (m.effect === 'solid') {
    nameEl.textContent = m.name || 'Egyszínű';
    fxEl.textContent = m.colors?.[0] || '';
  } else {
    nameEl.textContent = m.name || effectLabel(m.effect);
    fxEl.textContent = m.name && m.name !== effectLabel(m.effect) ? effectLabel(m.effect) : '';
  }
}

function renderMaster() {
  const pb = $('#powerBtn');
  pb.setAttribute('aria-pressed', String(S.on));
  pb.setAttribute('aria-label', S.on ? 'Kikapcsolás' : 'Bekapcsolás');
  const r = $('#bri');
  if (document.activeElement !== r || Date.now() - S.briTouched > 900) r.value = briToPct(S.bri);
  $('#briOut').textContent = `${briToPct(S.bri)}%`;
  document.body.classList.toggle('off', !S.on);
}

// ------------------------------------------------------------------ Szín fül

let picker = null;
function buildColorPane() {
  const pane = $('#pane-color');
  const init = S.cur?.effect === 'solid' && S.cur.colors?.[0] ? parseHex(S.cur.colors[0]) : [255, 120, 40, 0];
  picker = new ColorPicker({
    value: init,
    withW: withW(),
    segment: S.segment,
    onInput: (c) => { S.pickerTouched = Date.now(); sendColor(c); },
    onChange: () => { S.pickerTouched = Date.now(); },
    onSegment: (k) => { S.segment = k; kv.set('segment', k); },
  });
  const apply = (c) => { picker.value = c; sendColor(c); };
  const favRow = h('div', { class: 'swatches', id: 'favRow' });
  const swatchHost = h('div', { id: 'presetHost' });
  pane.replaceChildren(
    h('div', { class: 'color-layout' },
      h('div', { class: 'col-picker' }, picker.root),
      h('div', { class: 'col-swatches' },
        swatchHost,
        h('div', { class: 'group' },
          h('div', { class: 'group-head' }, h('h3', null, 'Kedvencek'),
            h('button', { class: 'btn ghost sm', onclick: addFavorite }, icon('plus'), 'Mostani szín')),
          favRow,
          h('p', { class: 'hint', id: 'favHint' }, 'Hosszan nyomva törölheted.')))));
  const renderPresets = () => {
    const { whites, colors } = presetSwatches(apply, { withW: withW() });
    swatchHost.replaceChildren(
      h('div', { class: 'group' }, h('h3', null, 'Fehérek'), h('div', { class: 'swatches' }, whites)),
      h('div', { class: 'group' }, h('h3', null, 'Színek'), h('div', { class: 'swatches' }, colors)));
  };
  renderPresets();
  picker.renderPresets = renderPresets;
  const origSet = picker.setWithW.bind(picker);
  picker.setWithW = (on) => { origSet(on); renderPresets(); };
  renderFavorites();
}

function renderFavorites() {
  const row = $('#favRow');
  if (!row) return;
  const apply = (c) => { picker.value = c; sendColor(c); };
  row.replaceChildren(...S.favorites.map((hex) => swatch(parseHex(hex), hex, apply, {
    onLong: () => {
      const i = S.favorites.indexOf(hex);
      S.favorites.splice(i, 1);
      kv.set('favorites', S.favorites);
      renderFavorites();
      toast(`Kedvenc törölve: ${hex}`, { action: 'Visszavonás', onAction: () => { S.favorites.splice(i, 0, hex); kv.set('favorites', S.favorites); renderFavorites(); } });
    },
  })));
  if (!S.favorites.length) row.append(h('p', { class: 'hint' }, 'Még nincs kedvenc színed.'));
  $('#favHint')?.toggleAttribute('hidden', !S.favorites.length);
}

function addFavorite() {
  const hex = toHex(picker.value);
  if (S.favorites.includes(hex)) { toast('Ez a szín már a kedvencek között van.'); return; }
  S.favorites.unshift(hex);
  S.favorites = S.favorites.slice(0, 24);
  kv.set('favorites', S.favorites);
  renderFavorites();
}

function syncPickerFromCur() {
  if (!picker || S.cur?.effect !== 'solid' || !S.cur.colors?.[0]) return;
  if (Date.now() - S.pickerTouched < 1200) return;
  const c = parseHex(S.cur.colors[0]);
  if (c && toHex(picker.value) !== toHex(c)) picker.value = c;
}

// ------------------------------------------------------------------ Effektek fül

const FX_TILES = ['rainbow', 'colorloop', 'breathe', 'gradient', 'chase', 'comet', 'scanner', 'twinkle', 'fire', 'wave', 'strobe', 'solid', 'keyframes', 'playlist'];
const tilePreviews = {};

function fxParams(fx) {
  if (!S.fxParams[fx]) {
    const t = templateFor(fx);
    S.fxParams[fx] = { effect: fx, speed: t.speed, intensity: t.intensity, reverse: false, colors: t.colors ? [...t.colors] : [] };
  }
  return S.fxParams[fx];
}

const fxModeJson = (fx) => {
  const p = fxParams(fx);
  const o = { ledmode: 1, name: effectLabel(fx), effect: fx, speed: p.speed, intensity: p.intensity, reverse: !!p.reverse };
  if (p.colors?.length) o.colors = p.colors;
  return o;
};

const isFxActive = (fx) => S.cur?.effect === fx && S.cur?.name === effectLabel(fx);

let fxSaveTimer = null;
const saveFxParams = () => { clearTimeout(fxSaveTimer); fxSaveTimer = setTimeout(() => kv.set('fxParams', S.fxParams), 800); };

function buildFxPane() {
  const pane = $('#pane-fx');
  const grid = h('div', { class: 'fx-grid', role: 'list' });
  for (const fx of FX_TILES) {
    const cv = h('canvas', { class: 'mini' });
    const special = fx === 'keyframes' || fx === 'playlist';
    const tile = h('button', {
      type: 'button', class: 'fx-tile', role: 'listitem', 'data-fx': fx,
      onclick: () => {
        if (special) { newModeFrom(fx); return; }
        S.selFx = fx;
        kv.set('selFx', fx);
        playMode(fxModeJson(fx));
        renderFxParams();
      },
    }, cv, h('span', { class: 'fx-name' }, effectLabel(fx)), special ? h('span', { class: 'fx-sub' }, 'Új saját mód') : null);
    grid.append(tile);
    let mode;
    try { mode = compileMode(special ? templateFor(fx) : fxModeJson(fx)); } catch { mode = null; }
    tilePreviews[fx] = addPreview(cv, mode, 18);
  }
  pane.replaceChildren(grid, h('div', { id: 'fxParams', class: 'fx-params' }));
  renderFxParams();
  markActiveFx();
}

function renderFxParams() {
  const host = $('#fxParams');
  if (!host) return;
  const fx = S.selFx;
  const p = fxParams(fx);
  const refreshTile = () => { try { tilePreviews[fx]?.play(compileMode(fxModeJson(fx))); } catch { /* */ } };
  const ed = paramEditor(p, {
    withW: withW(),
    favorites: S.favorites,
    onChange: (kind, extra = {}) => {
      saveFxParams();
      if (!isFxActive(fx) || kind === 'reverse' || kind === 'colors') {
        playMode(fxModeJson(fx), { fade: kind === 'reverse' ? 0 : 300 });
        refreshTile();
        return;
      }
      if (kind === 'speed') {
        heroEng.setSpeed(p.speed);
        patchCur((m) => { m.speed = p.speed; });
        if (connected()) S.link.sendFast('speed', fastSpeed(p.speed));
      } else if (kind === 'intensity') {
        heroEng.setIntensity(p.intensity);
        patchCur((m) => { m.intensity = p.intensity; });
        if (connected()) S.link.sendFast('intens', fastIntensity(p.intensity));
      } else if (kind === 'color') {
        heroEng.setColor(extra.idx, extra.c);
        patchCur((m) => { m.colors = m.colors || []; m.colors[extra.idx] = toHex(extra.c); });
        if (connected()) S.link.sendFast('pc' + extra.idx, fastPaletteColor(extra.idx, extra.c));
      }
      if (!extra.live) refreshTile();
    },
  });
  host.replaceChildren(
    h('div', { class: 'fx-head' },
      h('div', null, h('h2', null, effectLabel(fx)), h('p', { class: 'muted fx-desc' }, EFFECTS[fx]?.desc || '')),
      h('button', { class: 'btn', onclick: () => saveFxAsMode(fx) }, icon('file'), 'Mentés módként')),
    ed);
}

async function saveFxAsMode(fx) {
  const name = await promptText({ title: 'Mentés módként', label: 'A mód neve', value: effectLabel(fx) });
  if (!name) return;
  const json = { ...fxModeJson(fx), name };
  let mode;
  try { mode = normalizeMode(json); } catch (e) { toast(errorText(e.code)); return; }
  if (S.lib.some((x) => x.mode.name === mode.name && !sameMode(x.mode, mode))) {
    const ok = await confirmBox({ title: 'Felülírod?', text: `Már van „${mode.name}” nevű mód. Lecseréled erre?`, ok: 'Felülírás' });
    if (!ok) return;
  }
  const r = await addToLibrary([mode]);
  toast(r.same ? 'Ez a mód már megvan a könyvtárban.' : `Mentve a könyvtárba: ${mode.name}`);
}

function markActiveFx() {
  document.querySelectorAll('.fx-tile').forEach((t) => {
    t.classList.toggle('playing', isFxActive(t.dataset.fx));
    t.classList.toggle('selected', t.dataset.fx === S.selFx);
    t.setAttribute('aria-current', isFxActive(t.dataset.fx) ? 'true' : 'false');
  });
}

// ------------------------------------------------------------------ Módok fül

let libPreviews = [];
function buildModesPane() {
  const pane = $('#pane-modes');
  const newBtn = h('button', { class: 'btn primary' }, icon('plus'), 'Új mód');
  newBtn.addEventListener('click', () => menu(newBtn, [
    { label: 'Színsor (saját színek egymás után)', icon: 'color', onClick: () => newModeFrom('keyframes') },
    { label: 'Lejátszási lista (effektek egymás után)', icon: 'effects', onClick: () => newModeFrom('playlist') },
    { label: 'Egy effektből', icon: 'modes', onClick: () => newModeFrom('rainbow') },
  ]));
  const impBtn = h('button', { class: 'btn' }, icon('download'), 'Importálás');
  impBtn.addEventListener('click', () => menu(impBtn, [
    { label: 'Fájlból (.ledmode)', icon: 'file', onClick: async () => { const files = await io.pickFiles(); if (files.length) reportImport(await io.importFiles(files)); } },
    navigator.clipboard?.readText ? { label: 'Vágólapról', icon: 'copy', onClick: () => io.importClipboard(reportImport).catch(() => toast('A vágólap nem olvasható.')) } : null,
  ]));
  const expBtn = h('button', { class: 'btn ghost', onclick: () => { if (!S.lib.length) { toast('A könyvtár üres.'); return; } exportModes(S.lib.map((x) => x.mode), 'fenycsik-modok.ledmode'); } }, icon('upload'), 'Összes exportálása');

  pane.replaceChildren(
    h('div', { class: 'toolbar' }, newBtn, impBtn, expBtn),
    h('div', { id: 'folderCard', class: 'folder-card' }),
    h('div', { class: 'group' }, h('div', { class: 'group-head' }, h('h3', null, 'Könyvtár'), h('span', { id: 'libCount', class: 'muted' })), h('ul', { id: 'libList', class: 'mode-list' })),
    h('div', { class: 'group', id: 'devGroup' }, h('div', { class: 'group-head' }, h('h3', null, 'Az eszközön'), h('span', { id: 'devCount', class: 'muted' })), h('ul', { id: 'devList', class: 'mode-list' })),
    h('div', { class: 'group' }, h('div', { class: 'group-head' }, h('h3', null, 'Példák')), h('ul', { id: 'exList', class: 'mode-list' })));
  renderLib();
  renderDevModes();
  renderFolder(io.folderState());
  loadExamples();
}

function onDevice(name) { return S.devModes.some((d) => d.name === name); }

function modeRow(mode, { onPlay, onMenu, sub, badges = [], id } = {}) {
  const cv = h('canvas', { class: 'mini' });
  let compiled = null;
  try { compiled = compileMode(mode); } catch { /* */ }
  libPreviews.push(addPreview(cv, compiled, 24));
  const more = h('button', { class: 'icon-btn ghost', 'aria-label': `${mode.name}: további műveletek` }, icon('more'));
  more.addEventListener('click', () => onMenu(more));
  return h('li', { class: 'mode-row', 'data-id': id || '', 'data-name': mode.name },
    h('button', { class: 'mode-main', onclick: onPlay, 'aria-label': `${mode.name} lejátszása` },
      cv,
      h('span', { class: 'mode-meta' },
        h('span', { class: 'mode-name' }, mode.name),
        h('span', { class: 'mode-sub' }, sub || effectLabel(mode.effect), ...badges.map((b) => h('span', { class: 'badge' }, b))))),
    h('button', { class: 'icon-btn play', onclick: onPlay, 'aria-label': `${mode.name} lejátszása`, tabindex: '-1' }, icon('play')),
    more);
}

function renderLib() {
  const list = $('#libList');
  if (!list) return;
  libPreviews.forEach((p) => p.remove());
  libPreviews = [];
  $('#libCount').textContent = S.lib.length ? `${S.lib.length} mód` : '';
  if (!S.lib.length) {
    list.replaceChildren(h('li', { class: 'empty' },
      h('p', null, 'Még nincs saját módod.'),
      h('p', { class: 'muted' }, 'Készíts egyet az Új mód gombbal, mentsd el egy effekt beállításait, vagy tölts le egy .ledmode fájlt a figyelt mappába.')));
  } else {
    list.replaceChildren(...S.lib.map((it) => modeRow(it.mode, {
      id: it.id,
      badges: connected() && onDevice(it.mode.name) ? ['eszközön'] : [],
      onPlay: () => playMode(it.mode),
      onMenu: (btn) => menu(btn, [
        { label: 'Szerkesztés', icon: 'edit', onClick: () => editMode(it) },
        connected() ? { label: 'Feltöltés az eszközre', icon: 'upload', onClick: () => uploadMode(it.mode) } : null,
        { label: 'Letöltés fájlként', icon: 'download', onClick: () => exportModes([it.mode]) },
        io.canShareFiles(io.modeFile([it.mode])) ? { label: 'Megosztás…', icon: 'share', onClick: () => shareModes([it.mode]) } : null,
        { label: 'Másolat készítése', icon: 'copy', onClick: () => duplicate(it) },
        { label: 'Törlés a könyvtárból', icon: 'trash', danger: true, onClick: () => deleteFromLibrary(it) },
      ]),
    })));
  }
  renderLibActive();
  prunePreviews();
}

function renderLibActive() {
  document.querySelectorAll('.mode-row').forEach((r) => {
    const playing = S.cur && r.dataset.name === S.cur.name && S.cur.name !== '';
    r.classList.toggle('playing', !!playing);
  });
}

async function duplicate(it) {
  let name = `${it.mode.name} (másolat)`;
  let k = 2;
  while (S.lib.some((x) => x.mode.name === name)) name = `${it.mode.name} (${k++})`;
  const copy = normalizeMode({ ...it.mode, name });
  S.lib.push({ id: newId(), mode: copy, source: 'app', addedAt: Date.now() });
  libSort();
  await library.put(S.lib.find((x) => x.mode === copy));
  renderLib();
}

let devPreviews = [];
function renderDevModes() {
  const g = $('#devGroup');
  if (!g) return;
  g.hidden = !connected();
  devPreviews.forEach((p) => p.remove());
  devPreviews = [];
  const list = $('#devList');
  $('#devCount').textContent = connected() ? `${S.devModes.length} / ${S.info?.limits?.modes ?? 60}` : '';
  if (!connected()) { list.replaceChildren(); return; }
  if (!S.devModes.length) {
    list.replaceChildren(h('li', { class: 'empty' }, h('p', { class: 'muted' }, 'Az eszközön nincs mentett mód. A könyvtárból a ⋯ menüvel tölthetsz fel.')));
    return;
  }
  list.replaceChildren(...S.devModes.map((d) => {
    const li = h('li', { class: 'mode-row compact', 'data-name': d.name },
      h('button', {
        class: 'mode-main', 'aria-label': `${d.name} lejátszása az eszközről`,
        onclick: () => { S.link.sendJson({ t: 'play', name: d.name }).catch(() => {}); },
      }, h('span', { class: 'chip-ic' }, icon('chip')),
      h('span', { class: 'mode-meta' }, h('span', { class: 'mode-name' }, d.name), h('span', { class: 'mode-sub' }, effectLabel(d.effect)))),
      h('button', {
        class: 'icon-btn play', tabindex: '-1', 'aria-label': `${d.name} lejátszása`,
        onclick: () => { S.link.sendJson({ t: 'play', name: d.name }).catch(() => {}); },
      }, icon('play')));
    const more = h('button', { class: 'icon-btn ghost', 'aria-label': `${d.name}: további műveletek` }, icon('more'));
    more.addEventListener('click', () => menu(more, [
      {
        label: 'Átvétel a könyvtárba', icon: 'download',
        onClick: async () => {
          try {
            const m = await getDeviceMode(d.name);
            const r = await addToLibrary([normalizeMode(m)]);
            toast(r.same ? 'Ez a mód már megvan a könyvtárban.' : `Átvéve: ${d.name}`);
          } catch { toast('Nem sikerült lekérni a módot.', { kind: 'err' }); }
        },
      },
      {
        label: 'Törlés az eszközről', icon: 'trash', danger: true,
        onClick: async () => {
          const ok = await confirmBox({ title: 'Törlés az eszközről', text: `Biztosan törlöd a(z) „${d.name}” módot az ESP32-ről? A könyvtáradban megmarad.`, ok: 'Törlés', danger: true });
          if (ok) S.link.sendJson({ t: 'del', name: d.name }).catch(() => {});
        },
      },
    ]));
    li.append(more);
    return li;
  }));
}

let examples = [];
async function loadExamples() {
  const list = $('#exList');
  try {
    const res = await fetch('modes/index.json', { cache: 'no-cache' });
    examples = await res.json();
  } catch { examples = []; }
  if (!examples.length) { list.replaceChildren(h('li', { class: 'empty' }, h('p', { class: 'muted' }, 'A példák offline nem érhetők el.'))); return; }
  const items = [];
  for (const ex of examples) {
    let mode;
    try { mode = normalizeMode(await (await fetch('modes/' + ex.file)).json()); } catch { continue; }
    const row = modeRow(mode, {
      sub: ex.desc || effectLabel(mode.effect),
      onPlay: () => playMode(mode),
      onMenu: (btn) => menu(btn, [
        { label: 'Hozzáadás a könyvtárhoz', icon: 'plus', onClick: async () => { const r = await addToLibrary([mode], { source: 'example' }); toast(r.same ? 'Már megvan a könyvtárban.' : `Hozzáadva: ${mode.name}`); } },
        { label: 'Letöltés fájlként', icon: 'download', onClick: () => exportModes([mode]) },
      ]),
    });
    items.push(row);
  }
  list.replaceChildren(...items);
}

function renderFolder(st, scan) {
  const card = $('#folderCard');
  if (scan && (scan.added || scan.updated || scan.errors?.length)) reportImport(scan);
  if (!card) return;
  const isAndroid = /Android/i.test(navigator.userAgent);
  const time = st.lastScan ? new Date(st.lastScan).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  let body;
  switch (st.state) {
    case 'unsupported':
      body = [h('p', null, 'Ez a böngésző nem tud mappát figyelni.'),
        h('p', { class: 'muted' }, isAndroid
          ? 'A letöltött .ledmode fájlt a Fájlok appban a Megosztás → Fénycsík paranccsal adhatod hozzá, vagy az Importálás gombbal.'
          : 'A .ledmode fájlokat az Importálás gombbal vagy ide húzva adhatod hozzá.')];
      break;
    case 'none':
      body = [h('p', null, 'Válassz egy mappát, és az oda kerülő .ledmode fájlokat az app magától beolvassa.'),
        h('p', { class: 'muted' }, isAndroid
          ? 'Androidon a Letöltések mappa gyökerét a rendszer nem engedi kiválasztani; válassz benne egy almappát, például Download/Fénycsík.'
          : 'Windowson érdemes a Letöltések mappát választani: amit letöltesz, az rögtön megjelenik itt.'),
        h('button', { class: 'btn primary', onclick: () => io.chooseFolder().catch((e) => { if (e?.name !== 'AbortError') toast('A mappa nem választható ki.'); }) }, icon('folder'), 'Mappa kiválasztása')];
      break;
    case 'permission':
      body = [h('p', null, `A(z) „${st.name}” mappa figyeléséhez újra engedélyt kell adnod.`),
        h('button', { class: 'btn primary', onclick: () => io.regrantFolder().catch(() => {}) }, icon('folder'), 'Engedélyezés'),
        h('button', { class: 'btn ghost', onclick: () => io.stopFolder() }, 'Másik mappa')];
      break;
    case 'missing':
      body = [h('p', null, `A(z) „${st.name}” mappa már nem található.`),
        h('button', { class: 'btn primary', onclick: () => io.chooseFolder().catch(() => {}) }, icon('folder'), 'Új mappa kiválasztása')];
      break;
    case 'active':
      body = [h('p', null, h('span', { class: 'led-dot', 'aria-hidden': 'true' }), `Figyelt mappa: ${st.name}`),
        h('p', { class: 'muted' }, time ? `Utoljára átnézve ${time}. Az új .ledmode fájlok néhány másodpercen belül bekerülnek.` : 'Átnézés…'),
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost sm', onclick: () => io.scanFolder() }, 'Átnézés most'),
          h('button', { class: 'btn ghost sm', onclick: () => io.chooseFolder().catch(() => {}) }, 'Csere'),
          h('button', { class: 'btn ghost sm', onclick: () => io.stopFolder() }, 'Leállítás'))];
      break;
    default: body = [];
  }
  card.dataset.state = st.state;
  card.replaceChildren(h('div', { class: 'folder-ic' }, icon('folder')), h('div', { class: 'folder-body' }, body));
}

// ------------------------------------------------------------------ Beállítások fül

const ORDERS_RGB = ['GRB', 'RGB', 'BRG', 'RBG', 'GBR', 'BGR'];
const ORDERS_RGBW = ['GRBW', 'RGBW', 'WRGB', 'WGRB', 'BRGW', 'RBGW'];
const LIMITS_MA = [0, 500, 900, 1500, 2000, 3000, 4000, 6000, 8000, 10000];

let fieldId = 0;
function field(label, control, hint) {
  // Csak egyetlen beviteli mezőt csomagolunk <label>-be: gombcsoportnál a label az első gombot "kattintaná"
  const single = control.matches?.('input, select, textarea');
  if (single && !control.id) control.id = `set-${++fieldId}`;
  const text = h(single ? 'label' : 'span', { class: 'set-label', for: single ? control.id : null },
    h('span', null, label), hint ? h('small', { class: 'muted' }, hint) : null);
  return h('div', { class: 'set-row' }, text, control);
}

function select(options, value, fmt = (v) => v) {
  return h('select', { class: 'field' }, options.map((o) => h('option', { value: String(o), selected: String(o) === String(value) }, fmt(o))));
}

function renderSettings() {
  const pane = $('#pane-settings');
  if (!pane) return;
  const parts = [];
  const cfg = S.info?.cfg;

  // Szalag
  if (connected() && cfg) {
    const f = structuredClone(cfg);
    const pins = S.info.pins || [];
    const typeSeg = h('div', { class: 'seg wide', role: 'group', 'aria-label': 'Szalag típusa' });
    const orderHost = h('div');
    const pinHost = h('div');
    const countIn = h('input', { class: 'field', type: 'number', min: '1', max: String(f.type === 'rgbw' ? 750 : 1000), value: String(f.count), inputmode: 'numeric' });
    countIn.addEventListener('change', () => { f.count = Math.max(1, Math.min(+countIn.max, Math.round(+countIn.value || 1))); countIn.value = f.count; });
    const nameIn = h('input', { class: 'field', type: 'text', value: f.name, maxlength: '24', autocomplete: 'off', spellcheck: 'false' });
    nameIn.addEventListener('input', () => { f.name = nameIn.value; });
    const limitSel = select(LIMITS_MA, LIMITS_MA.includes(f.maxmA) ? f.maxmA : 1500, (v) => (v ? `${v} mA` : 'Nincs korlát'));
    limitSel.addEventListener('change', () => { f.maxmA = +limitSel.value; });

    const renderTypeParts = () => {
      typeSeg.replaceChildren(...[['rgb', 'Címezhető RGB'], ['rgbw', 'Címezhető RGBW'], ['analog', 'Sima RGB (12 V)']].map(([k, l]) => h('button', {
        type: 'button', 'aria-pressed': String(f.type === k),
        onclick: () => {
          f.type = k;
          if (k === 'rgbw' && f.order.length !== 4) f.order = 'GRBW';
          if (k === 'rgb' && f.order.length !== 3) f.order = 'GRB';
          countIn.max = k === 'rgbw' ? 750 : 1000;
          renderTypeParts();
        },
      }, l)));
      if (f.type === 'analog') {
        orderHost.replaceChildren();
        const ap = f.apins;
        const pinSel = (k, label, allowNone) => {
          const s = select(allowNone ? [-1, ...pins] : pins, ap[k], (v) => (v < 0 ? 'nincs' : `GPIO ${v}`));
          s.addEventListener('change', () => { ap[k] = +s.value; });
          return field(label, s);
        };
        pinHost.replaceChildren(pinSel(0, 'Piros csatorna'), pinSel(1, 'Zöld csatorna'), pinSel(2, 'Kék csatorna'), pinSel(3, 'Fehér csatorna', true));
      } else {
        const orders = f.type === 'rgbw' ? ORDERS_RGBW : ORDERS_RGB;
        const os = select(orders, f.order);
        os.addEventListener('change', () => { f.order = os.value; });
        orderHost.replaceChildren(field('Színsorrend', os, 'Ha piros helyett zöldet látsz, itt állítsd át.'));
        const ps = select(pins, f.pin, (v) => `GPIO ${v}`);
        ps.addEventListener('change', () => { f.pin = +ps.value; });
        pinHost.replaceChildren(field('Adatláb', ps), field('LED-ek száma', countIn));
      }
    };
    renderTypeParts();

    const saveBtn = h('button', {
      class: 'btn primary',
      onclick: async () => {
        const diff = {};
        for (const k of ['type', 'order', 'count', 'pin', 'maxmA', 'gamma', 'autoWhite', 'name']) if (JSON.stringify(f[k]) !== JSON.stringify(cfg[k])) diff[k] = f[k];
        if (JSON.stringify(f.apins) !== JSON.stringify(cfg.apins)) diff.apins = f.apins;
        if (!Object.keys(diff).length) { toast('Nincs változás.'); return; }
        if (diff.name !== undefined && !diff.name.trim()) { toast(errorText('bad_name')); return; }
        try { await S.link.sendJson({ t: 'cfg', cfg: diff }); toast('Beállítások elküldve.'); } catch { toast('Nem sikerült elküldeni.', { kind: 'err' }); }
      },
    }, 'Mentés az eszközre');

    const typeRow = field('Típus', typeSeg);
    typeRow.classList.add('block');
    parts.push(h('section', { class: 'group' },
      h('h2', null, 'Szalag'),
      typeRow,
      orderHost, pinHost,
      field('Áramkorlát', limitSel, 'Kíméli a tápot: USB-ről legfeljebb 500–900 mA.'),
      toggleRow('Gamma korrekció', f.gamma, (v) => { f.gamma = v; }, 'A szalag színei így hasonlítanak a képernyőn látottakra.'),
      f.type !== 'rgb' ? toggleRow('Fehér a fehér LED-del', f.autoWhite, (v) => { f.autoWhite = v; }, 'RGBW szalagnál a színek fehér részét a W LED adja.') : null,
      field('Eszköz neve', nameIn, 'Így látszik a Bluetooth listában.'),
      h('div', { class: 'row end' }, h('p', { class: 'hint grow' }, 'A típus, a lábak, a színsorrend és a név mentése után az ESP32 újraindul.'), saveBtn)));

    // Időzítő
    parts.push(h('section', { class: 'group' },
      h('h2', null, 'Elalvás időzítő'),
      h('div', { class: 'chips-row' }, [[0, 'Ki'], [15, '15 perc'], [30, '30 perc'], [60, '1 óra'], [120, '2 óra'], [240, '4 óra']].map(([min, l]) => h('button', {
        type: 'button', class: 'chip-btn', 'data-min': String(min),
        onclick: () => S.link.sendJson({ t: 'timer', min }).then(() => toast(min ? `${l} múlva kikapcsol.` : 'Időzítő kikapcsolva.')).catch(() => {}),
      }, l))),
      h('p', { id: 'timerText', class: 'muted' })));
  } else {
    parts.push(h('section', { class: 'group' },
      h('h2', null, 'Szalag'),
      h('p', { class: 'muted' }, 'A szalag típusát, a LED-ek számát és a lábakat csatlakozás után itt tudod beállítani.'),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: connect }, icon('bt'), 'Csatlakozás'))));
  }

  // App
  parts.push(h('section', { class: 'group' },
    h('h2', null, 'Mód fájlok'),
    toggleRow('Új módok feltöltése az eszközre', S.autoUpload, (v) => { S.autoUpload = v; kv.set('autoUpload', v); }, 'Az importált vagy mentett módok rögtön az ESP32-re is felkerülnek, így app nélkül, a BOOT gombbal is elérhetők.'),
    h('p', { class: 'muted' }, 'A figyelt mappát a Módok fülön állíthatod be.')));

  const install = S.installPrompt ? h('button', {
    class: 'btn', onclick: async () => { S.installPrompt.prompt(); await S.installPrompt.userChoice; S.installPrompt = null; renderSettings(); },
  }, icon('download'), 'Telepítés alkalmazásként') : null;

  parts.push(h('section', { class: 'group' },
    h('h2', null, 'Eszköz és firmware'),
    connected() && S.info ? h('dl', { class: 'facts' },
      h('dt', null, 'Firmware'), h('dd', null, S.info.fw),
      h('dt', null, 'Lapka'), h('dd', null, S.info.chip),
      h('dt', null, 'Szabad memória'), h('dd', null, `${Math.round(S.info.heap / 1024)} kB`),
      h('dt', null, 'Tárhely'), h('dd', null, `${Math.round(S.info.fsUsed / 1024)} / ${Math.round(S.info.fsTotal / 1024)} kB, ${S.info.saved} mód`)) : null,
    h('div', { class: 'row' },
      h('a', { class: 'btn', href: 'flash.html' }, icon('chip'), 'Firmware feltöltése'),
      connected() ? h('button', { class: 'btn ghost', onclick: async () => { if (await confirmBox({ title: 'Újraindítás', text: 'Újraindítod az ESP32-t? Pár másodperc múlva visszacsatlakozom.', ok: 'Újraindítás' })) S.link.sendJson({ t: 'reboot' }).catch(() => {}); } }, 'Újraindítás') : null,
      !connected() || S.link?.kind !== 'demo' ? h('button', { class: 'btn ghost', onclick: connectDemo }, 'Bemutató eszköz') : null,
      install)));

  pane.replaceChildren(...parts.filter(Boolean));
  renderTimer();
}

function renderTimer() {
  const el = $('#timerText');
  if (!el) return;
  const left = S.timer ? Math.max(0, S.timer - Math.round((Date.now() - S.timerAt) / 1000)) : 0;
  el.textContent = left ? `Kikapcsol ${left >= 3600 ? `${Math.floor(left / 3600)} óra ${Math.round((left % 3600) / 60)} perc` : `${Math.max(1, Math.round(left / 60))} perc`} múlva.` : 'Nincs beállítva.';
}
setInterval(renderTimer, 30000);

// ------------------------------------------------------------------ fülek

const TABS = [['color', 'Szín', 'color'], ['fx', 'Effektek', 'effects'], ['modes', 'Módok', 'modes'], ['settings', 'Beállítás', 'settings']];

function showTab(tab) {
  S.tab = tab;
  kv.set('tab', tab);
  for (const [k] of TABS) {
    $(`#pane-${k}`).hidden = k !== tab;
    const b = $(`#tab-${k}`);
    b.setAttribute('aria-selected', String(k === tab));
    b.tabIndex = k === tab ? 0 : -1;
  }
  if (tab === 'settings') renderSettings();
  window.scrollTo({ top: 0 });
}

function buildShell() {
  const nav = $('#tabs');
  nav.replaceChildren(...TABS.map(([k, label, ic]) => h('button', {
    id: `tab-${k}`, role: 'tab', 'aria-controls': `pane-${k}`, class: 'tab', onclick: () => showTab(k),
  }, h('span', { class: 'tab-led', 'aria-hidden': 'true' }), icon(ic), h('span', null, label))));
  nav.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const i = TABS.findIndex(([k]) => k === S.tab);
    const d = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
    const next = TABS[(i + d + TABS.length) % TABS.length][0];
    showTab(next);
    $(`#tab-${next}`).focus();
    e.preventDefault();
  });
  $('#connBtn').addEventListener('click', () => {
    if (S.conn === 'connected') deviceSheet();
    else if (S.conn === 'idle') connect();
    else S.link?.disconnect();
  });
  $('#powerBtn').addEventListener('click', togglePower);
  $('#bri').addEventListener('input', (e) => setBrightness(pctToBri(+e.target.value)));
  $('#hintConnect')?.addEventListener('click', connect);
  $('#hintDemo')?.addEventListener('click', connectDemo);
}

// ------------------------------------------------------------------ indulás

async function boot() {
  hero = new HeroStrip($('#hero'));
  buildShell();
  const headEl = $('.head');
  new ResizeObserver(() => document.documentElement.style.setProperty('--head-h', headEl.offsetHeight + 'px')).observe(headEl);

  S.favorites = await kv.get('favorites', []);
  S.segment = await kv.get('segment', 'hsv');
  S.autoUpload = await kv.get('autoUpload', true);
  S.fxParams = await kv.get('fxParams', {});
  S.selFx = await kv.get('selFx', 'rainbow');
  S.lastDevice = await kv.get('lastDevice', '');
  S.lib = await library.all();
  libSort();
  const last = await kv.get('lastCur', null);

  buildColorPane();
  buildFxPane();
  buildModesPane();
  renderSettings();
  setCur(last || templateFor('rainbow'), 0);
  renderConn();
  renderMaster();
  showTab(await kv.get('tab', 'color'));
  setHeroRenderer(heroFrame);

  if (!BleLink.supported()) document.body.classList.add('no-ble');

  io.onImport(addToLibrary);
  io.onFolderStatus(renderFolder);
  io.folderInit();
  io.initLaunchQueue(reportImport);
  io.readShareInbox(reportImport);
  io.initDragDrop(document.body, reportImport);

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installPrompt = e; renderSettings(); });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Korábban párosított eszköz: csendes visszacsatlakozás, ha a böngésző engedi
  if (BleLink.supported() && S.lastDevice) {
    const l = new BleLink();
    setLink(l);
    l.tryKnown(S.lastDevice).catch(() => {});
  }
}

window.fenycsik = { S, playMode, connectDemo, heroEng };
boot();
