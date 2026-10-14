const { PAD_COUNT, SMPTE } = Sequencer;
const DOUBLE_TAP_MS = 350;
const LOCK_STORAGE_KEY = "oz9-lock";

const consoleView = document.getElementById("console");
const statusLine = document.getElementById("status");
const paletteView = document.getElementById("palette");
const monitor = document.getElementById("monitor");
const padsView = document.getElementById("pads");
const runButton = document.getElementById("run-button");
const switchButton = document.getElementById("switch-button");
const lockInput = document.getElementById("lock");
const qrLink = document.getElementById("qr-link");
const picker = document.getElementById("picker");
const menu = document.getElementById("menu");
const toastView = document.getElementById("toast");

let schedule = null;
let selected = new Set();

// ---------- 画面の部品を作る ----------

const swatches = Array.from({ length: PAD_COUNT }, (_, i) => {
  const swatch = document.createElement("div");
  swatch.className = "swatch";
  swatch.draggable = true;
  swatch.dataset.index = i;
  paletteView.append(swatch);
  return swatch;
});

const pads = Array.from({ length: PAD_COUNT }, (_, i) => {
  const pad = document.createElement("div");
  pad.className = "pad";
  pad.dataset.index = i;
  const main = document.createElement("div");
  main.className = "pad-layer pad-main";
  const temp = document.createElement("div");
  temp.className = "pad-layer pad-temp";
  const label = document.createElement("span");
  label.className = "pad-label";
  label.textContent = Sequencer.padLabel(i);
  pad.append(main, temp, label);
  padsView.append(pad);
  return { pad, main, temp };
});

// ---------- schedule を画面に反映する ----------

function renderSchedule() {
  if (!schedule) return;
  schedule.palette.forEach((value, i) => Sequencer.paint(swatches[i], value));
  pads.forEach(({ main, temp }, i) => {
    Sequencer.paint(main, schedule.colors[i]);
    const tempValue = schedule.temp_colors[i];
    temp.hidden = tempValue === null;
    if (tempValue !== null) Sequencer.paint(temp, tempValue);
  });
  renderSelection();
}

function renderSelection() {
  pads.forEach(({ pad }, i) => pad.classList.toggle("selected", selected.has(i)));
}

function setSelection(indices) {
  selected = new Set(indices);
  renderSelection();
}

const poller = Sequencer.startPolling(
  "/api/console/version",
  "/api/console/schedule",
  (received) => {
    schedule = received;
    renderSchedule();
  },
);
Sequencer.startClockSync();

async function send(url, body) {
  try {
    schedule = await Sequencer.postJSON(url, body);
    poller.setVersion(schedule.version);
    renderSchedule();
  } catch (error) {
    showToast(error.message);
  }
}

// ---------- 小さな道具 ----------

let toastTimer = null;
function showToast(message) {
  toastView.textContent = message;
  toastView.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastView.classList.remove("show"), 2500);
}

function isLocked() {
  return lockInput.checked;
}

function isRunning() {
  return schedule?.state === "run";
}

// 同じ要素を短い間隔で2回押したら true（ダブルクリック・ダブルタップ共通）
function makeDoubleTapDetector() {
  let last = { index: -1, time: 0 };
  return (index) => {
    const time = performance.now();
    const isDouble = last.index === index && time - last.time < DOUBLE_TAP_MS;
    last = isDouble ? { index: -1, time: 0 } : { index, time };
    return isDouble;
  };
}

// 右クリックしたパッドが選択中なら選択中のパッド全部、そうでなければそのパッドだけ
function targetPads(index) {
  return selected.has(index) ? [...selected] : [index];
}

// ---------- アサイン ----------

// RUN中は仮アサイン、停止中は本アサインとして保存する
function assign(indices, value) {
  if (!schedule || indices.length === 0) return;
  if (isLocked()) {
    showToast("LOCK中はアサインできません");
    return;
  }
  const colors = [...schedule.colors];
  const tempColors = [...schedule.temp_colors];
  for (const i of indices) {
    if (isRunning()) tempColors[i] = value;
    else colors[i] = value;
  }
  send("/api/console/pads", { colors, temp_colors: tempColors });
}

function cancelTemp(indices) {
  if (isLocked()) {
    showToast("LOCK中はアサインできません");
    return;
  }
  const tempColors = [...schedule.temp_colors];
  for (const i of indices) tempColors[i] = null;
  send("/api/console/pads", { temp_colors: tempColors });
}

// ---------- カラーピッカー ----------

let onPick = null;

function openPicker(initialValue, x, y, callback) {
  onPick = callback;
  picker.value = initialValue && initialValue !== SMPTE ? initialValue.toLowerCase() : "#ffffff";
  picker.style.left = `${x}px`;
  picker.style.top = `${y}px`;
  try {
    picker.showPicker();
  } catch {
    picker.click();
  }
}

picker.addEventListener("change", () => {
  onPick?.(picker.value.toUpperCase());
  onPick = null;
});

// ---------- パレット ----------

const isPaletteDoubleTap = makeDoubleTapDetector();

swatches.forEach((swatch, i) => {
  swatch.addEventListener("click", (event) => {
    if (!schedule) return;
    if (isPaletteDoubleTap(i)) {
      if (schedule.palette[i] === SMPTE) {
        showToast("SMPTEカラーバーは編集できません");
        return;
      }
      openPicker(schedule.palette[i], event.clientX, event.clientY, (value) => {
        const palette = [...schedule.palette];
        palette[i] = value;
        send("/api/console/palette", { palette });
      });
      return;
    }
    // パッドを選んでからパレットを押すとアサイン（スマートフォン向けの操作）
    if (selected.size > 0) {
      assign([...selected], schedule.palette[i]);
      setSelection([]);
    }
  });

  swatch.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("text/plain", String(i));
    event.dataTransfer.effectAllowed = "copy";
  });
});

// ---------- パッド ----------

const isPadDoubleTap = makeDoubleTapDetector();
let selectionBeforeTap = new Set();

pads.forEach(({ pad }, i) => {
  pad.addEventListener("click", (event) => {
    if (event.shiftKey) {
      const next = new Set(selected);
      next.has(i) ? next.delete(i) : next.add(i);
      setSelection(next);
      return;
    }
    // ダブルタップ（ダブルクリック）は Shift と同じく複数選択に追加する
    if (isPadDoubleTap(i)) {
      setSelection([...selectionBeforeTap, i]);
      return;
    }
    selectionBeforeTap = new Set(selected);
    setSelection([i]);
  });

  pad.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    pad.classList.add("drop-target");
  });

  pad.addEventListener("dragleave", () => pad.classList.remove("drop-target"));

  pad.addEventListener("drop", (event) => {
    event.preventDefault();
    pad.classList.remove("drop-target");
    const paletteIndex = Number(event.dataTransfer.getData("text/plain"));
    if (!schedule || Number.isNaN(paletteIndex)) return;
    assign(targetPads(i), schedule.palette[paletteIndex]);
    setSelection([]);
  });

  pad.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (!schedule) return;
    if (isLocked()) {
      showToast("LOCK中はアサインできません");
      return;
    }
    openMenu(i, event.clientX, event.clientY);
  });
});

// ---------- 右クリックメニュー ----------

let menuPad = null;
let menuPosition = { x: 0, y: 0 };

function openMenu(index, x, y) {
  menuPad = index;
  menuPosition = { x, y };
  menu.querySelector('[data-action="delete"]').hidden =
    isRunning() || schedule.colors[index] === null;
  menu.querySelector('[data-action="cancel-temp"]').hidden = schedule.temp_colors[index] === null;
  menu.hidden = false;
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - height - 8)}px`;
}

function closeMenu() {
  menu.hidden = true;
  menuPad = null;
}

menu.addEventListener("click", (event) => {
  const action = event.target.dataset.action;
  if (!action || menuPad === null) return;
  const index = menuPad;
  const targets = targetPads(index);
  closeMenu();

  if (action === "edit") {
    const current = isRunning()
      ? (schedule.temp_colors[index] ?? schedule.colors[index])
      : schedule.colors[index];
    openPicker(current, menuPosition.x, menuPosition.y, (value) => assign(targets, value));
  } else if (action === "delete") {
    assign(targets, null);
  } else if (action === "cancel-temp") {
    cancelTemp(targets);
  }
  setSelection([]);
});

// パッド・パレット・メニュー以外を押したら選択とメニューを解除する
document.addEventListener("click", (event) => {
  if (!event.target.closest(".menu")) closeMenu();
  if (!event.target.closest(".pad, .swatch, .menu")) setSelection([]);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMenu();
    setSelection([]);
  }
});

// ---------- RUN / SWITCH / LOCK ----------

function switchBlockReason(t) {
  if (isLocked()) return "LOCK中はSWITCHできません";
  if (!isRunning()) return "SWITCHはRUN中だけ使えます";
  if (t < schedule.t0) return "切り替え待ちです";
  if (schedule.temp_colors.every((v) => v === null)) return "仮アサインがありません";
  return null;
}

runButton.addEventListener("click", () => {
  if (!schedule) return;
  if (isLocked()) {
    showToast("LOCK中はRUNを操作できません");
    return;
  }
  if (isRunning()) {
    send("/api/console/stop");
  } else {
    send("/api/console/run", { t0: Sequencer.runStartTime(Sequencer.now()) });
  }
});

switchButton.addEventListener("click", () => {
  if (!schedule) return;
  const t = Sequencer.now();
  const reason = switchBlockReason(t);
  if (reason) {
    showToast(reason);
    return;
  }
  send("/api/console/switch", { t0: Sequencer.switchStartTime(schedule.t0, t) });
});

lockInput.checked = localStorage.getItem(LOCK_STORAGE_KEY) === "1";
lockInput.addEventListener("change", () => {
  localStorage.setItem(LOCK_STORAGE_KEY, lockInput.checked ? "1" : "0");
});

// ---------- QRコード ----------

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // HTTPS でない場合は clipboard API が使えないので、昔ながらの方法でコピーする
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

// クリックでURLをコピー。スマートフォンの長押しはブラウザ標準のメニュー（画像の保存・リンクのコピー）
qrLink.addEventListener("click", async (event) => {
  event.preventDefault();
  await copyText(AUDIENCE_URL);
  showToast("audienceのURLをコピーしました");
});

// ---------- 毎フレームの描画 ----------

let lastCurrentPad = -1;
let lastStatus = "";
let lastMonitorValue;

function render() {
  const t = Sequencer.now();
  const frame = Sequencer.frameAt(schedule, t);
  const value = frame.kind === "standby" ? SMPTE : frame.value;

  if (value !== lastMonitorValue) {
    Sequencer.paint(monitor, value);
    lastMonitorValue = value;
  }

  const text = Sequencer.statusText(frame, t);
  if (text !== lastStatus) {
    statusLine.textContent = text;
    lastStatus = text;
  }

  const currentPad = frame.kind === "pad" ? frame.pad : -1;
  if (currentPad !== lastCurrentPad) {
    pads.forEach(({ pad }, i) => pad.classList.toggle("current", i === currentPad));
    lastCurrentPad = currentPad;
  }

  // RUNボタンはパッドの動きに合わせて点滅する
  const running = isRunning();
  runButton.classList.toggle("running", running);
  runButton.classList.toggle("blink", running && frame.kind === "pad" && frame.step % 2 === 0);
  runButton.classList.toggle("disabled", isLocked());

  const pending = running && schedule.prev_colors !== null && t < schedule.t0;
  switchButton.classList.toggle("pending", pending);
  switchButton.classList.toggle("disabled", !pending && schedule !== null && switchBlockReason(t) !== null);

  consoleView.classList.toggle("locked", isLocked());

  requestAnimationFrame(render);
}
requestAnimationFrame(render);
