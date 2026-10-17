const { SMPTE, FADE_NONE, FADE_OUT, FADE_IN } = Sequencer;
const DOUBLE_TAP_MS = 350;
const LOCK_STORAGE_KEY = "oz9-lock";

const consoleView = document.getElementById("console");
const statusLine = document.getElementById("status");
const paletteView = document.getElementById("palette");
const monitorsView = document.getElementById("monitors");
const pagePadsView = document.getElementById("page-pads");
const runButton = document.getElementById("run-button");
const switchButton = document.getElementById("switch-button");
const lockInput = document.getElementById("lock");
const menu = document.getElementById("menu");
const toastView = document.getElementById("toast");
const colorPanel = document.getElementById("color-panel");
const colorPreview = document.getElementById("color-preview");
const colorHex = document.getElementById("color-hex");
const sliderH = document.getElementById("slider-h");
const sliderS = document.getElementById("slider-s");
const sliderL = document.getElementById("slider-l");
const valH = document.getElementById("val-h");
const valS = document.getElementById("val-s");
const valL = document.getElementById("val-l");

let schedule = null;
// 選択は { page, pad } のキー "p-i"
let selected = new Set();
let onColorConfirm = null;
let menuTarget = null;
let menuPosition = { x: 0, y: 0 };

function selKey(page, pad) {
  return `${page}-${pad}`;
}

function parseKey(key) {
  const [page, pad] = key.split("-").map(Number);
  return { page, pad };
}

// ---------- 画面の部品を作る ----------

const swatches = Array.from({ length: PAD_COUNT }, (_, i) => {
  const swatch = document.createElement("div");
  swatch.className = "swatch";
  swatch.draggable = true;
  swatch.dataset.index = i;
  paletteView.append(swatch);
  return swatch;
});

const monitors = Array.from({ length: PAGE_COUNT }, (_, page) => {
  const monitor = document.createElement("div");
  monitor.className = "monitor smpte";
  monitor.title = `PAGE.${String(page + 1).padStart(2, "0")}`;
  const code = document.createElement("span");
  code.className = "monitor-code";
  code.textContent = "SMPTE";
  monitor.append(code);
  monitorsView.append(monitor);
  return { monitor, code };
});

const pagePads = Array.from({ length: PAGE_COUNT }, (_, page) => {
  const row = document.createElement("div");
  row.className = "page-row";
  const lock = document.createElement("label");
  lock.className = "lock sw-lock";
  lock.innerHTML =
    `<span>sw Lock</span>` +
    `<input type="checkbox" class="sw-lock-input" data-page="${page}" />` +
    `<span class="lock-switch"></span>` +
    `<span class="page-row-label">P${String(page + 1).padStart(2, "0")}</span>`;
  const padsGrid = document.createElement("div");
  padsGrid.className = "pads";
  const pads = Array.from({ length: PAD_COUNT }, (_, i) => {
    const pad = document.createElement("div");
    pad.className = "pad";
    pad.dataset.page = page;
    pad.dataset.index = i;
    const main = document.createElement("div");
    main.className = "pad-main";
    const temp = document.createElement("div");
    temp.className = "pad-temp";
    const padLabel = document.createElement("span");
    padLabel.className = "pad-label";
    padLabel.textContent = Sequencer.padLabel(i);
    pad.append(main, temp, padLabel);
    padsGrid.append(pad);
    return { pad, main, temp };
  });
  row.append(lock, padsGrid);
  pagePadsView.append(row);
  return pads;
});

const swLockInputs = [...document.querySelectorAll(".sw-lock-input")];
const qrLinks = [...document.querySelectorAll("a.qr")];

function pageAt(page) {
  return schedule?.pages?.[page];
}

function pageScheduleView(page) {
  const p = pageAt(page);
  if (!schedule || !p) return null;
  return {
    state: schedule.state,
    t0: schedule.t0,
    colors: p.colors,
    prev_colors: p.prev_colors,
    fades: p.fades,
    prev_fades: p.prev_fades,
  };
}

// ---------- schedule を画面に反映する ----------

function renderSchedule() {
  if (!schedule?.pages) return;
  schedule.palette.forEach((value, i) => Sequencer.paint(swatches[i], value));
  pagePads.forEach((pads, page) => {
    const p = pageAt(page);
    pads.forEach(({ pad, main, temp }, i) => {
      Sequencer.paint(main, p.colors[i]);
      const tempValue = p.temp_colors[i];
      temp.hidden = tempValue === null;
      if (tempValue !== null) Sequencer.paint(temp, tempValue);
      pad.classList.toggle("fade-in", p.fades[i] === FADE_IN);
      pad.classList.toggle("fade-out", p.fades[i] === FADE_OUT);
    });
    swLockInputs[page].checked = !!p.switch_lock;
  });
  renderSelection();
}

function renderSelection() {
  pagePads.forEach((pads, page) => {
    pads.forEach(({ pad }, i) => {
      pad.classList.toggle("selected", selected.has(selKey(page, i)));
    });
  });
}

function setSelection(keys) {
  selected = new Set(keys);
  renderSelection();
}

const poller = Sequencer.startPolling(
  "/api/console/version",
  "/api/console/schedule",
  (received) => {
    schedule = received;
    renderSchedule();
  }
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

function makeDoubleTapDetector() {
  let last = { key: "", time: 0 };
  return (key) => {
    const time = performance.now();
    const isDouble = last.key === key && time - last.time < DOUBLE_TAP_MS;
    last = isDouble ? { key: "", time: 0 } : { key, time };
    return isDouble;
  };
}

function targetPadsOnPage(page, padIndex) {
  const onPage = [...selected]
    .map(parseKey)
    .filter((t) => t.page === page)
    .map((t) => t.pad);
  if (onPage.includes(padIndex) && onPage.length > 0) return onPage;
  return [padIndex];
}

function canFadeColor(value) {
  return typeof value === "string" && value !== SMPTE;
}

// ---------- アサイン ----------

function assign(page, indices, value) {
  if (!schedule || indices.length === 0) return;
  if (isLocked()) {
    showToast("LOCK中はアサインできません");
    return;
  }
  const p = pageAt(page);
  const colors = [...p.colors];
  const tempColors = [...p.temp_colors];
  const fades = [...p.fades];
  for (const i of indices) {
    if (isRunning()) tempColors[i] = value;
    else {
      colors[i] = value;
      if (!canFadeColor(value)) fades[i] = FADE_NONE;
    }
  }
  send("/api/console/pads", {
    page,
    colors,
    temp_colors: tempColors,
    fades,
  });
}

function cancelTemp(page, indices) {
  if (isLocked()) {
    showToast("LOCK中はアサインできません");
    return;
  }
  const tempColors = [...pageAt(page).temp_colors];
  for (const i of indices) tempColors[i] = null;
  send("/api/console/pads", { page, temp_colors: tempColors });
}

function setFades(page, indices, mode) {
  if (!schedule || indices.length === 0) return;
  if (isLocked()) {
    showToast("LOCK中はアサインできません");
    return;
  }
  const p = pageAt(page);
  const fades = [...p.fades];
  let changed = false;
  for (const i of indices) {
    if (!canFadeColor(p.colors[i])) continue;
    fades[i] = fades[i] === mode ? FADE_NONE : mode;
    changed = true;
  }
  if (!changed) {
    showToast("カラーコードのパッドだけフェードできます");
    return;
  }
  send("/api/console/pads", { page, fades });
}

// ---------- HSLスライダー ----------

function currentHexFromSliders() {
  return Sequencer.hslToHex(
    Number(sliderH.value) / 360,
    Number(sliderS.value) / 100,
    Number(sliderL.value) / 100
  );
}

function updateColorPanelPreview() {
  const hex = currentHexFromSliders();
  colorPreview.style.backgroundColor = hex;
  colorHex.textContent = hex;
  valH.textContent = sliderH.value;
  valS.textContent = sliderS.value;
  valL.textContent = sliderL.value;
}

function openColorPanel(initialValue, x, y, callback) {
  const hex =
    initialValue && initialValue !== SMPTE
      ? initialValue.toUpperCase()
      : "#FFFFFF";
  const { h, s, l } = Sequencer.hexToHsl(hex);
  sliderH.value = Math.round(h * 360);
  sliderS.value = Math.round(s * 100);
  sliderL.value = Math.round(l * 100);
  onColorConfirm = callback;
  updateColorPanelPreview();
  colorPanel.hidden = false;
  const { width, height } = colorPanel.getBoundingClientRect();
  colorPanel.style.left = `${Math.min(x, window.innerWidth - width - 8)}px`;
  colorPanel.style.top = `${Math.min(y, window.innerHeight - height - 8)}px`;
}

function closeColorPanel() {
  colorPanel.hidden = true;
  onColorConfirm = null;
}

[sliderH, sliderS, sliderL].forEach((el) => {
  el.addEventListener("input", updateColorPanelPreview);
});

colorPanel.addEventListener("click", (event) => {
  const action = event.target.dataset.action;
  if (action === "cancel") {
    closeColorPanel();
  } else if (action === "ok") {
    const hex = currentHexFromSliders();
    const callback = onColorConfirm;
    closeColorPanel();
    callback?.(hex);
  }
});

// ---------- パレット ----------

const isPaletteDoubleTap = makeDoubleTapDetector();

swatches.forEach((swatch, i) => {
  swatch.addEventListener("click", (event) => {
    if (!schedule) return;
    if (isPaletteDoubleTap(`pal-${i}`)) {
      if (schedule.palette[i] === SMPTE) {
        showToast("SMPTEカラーバーは編集できません");
        return;
      }
      openColorPanel(
        schedule.palette[i],
        event.clientX,
        event.clientY,
        (value) => {
          const palette = [...schedule.palette];
          palette[i] = value;
          send("/api/console/palette", { palette });
        }
      );
      return;
    }
    if (selected.size > 0) {
      // 選択は同一ページ内のみまとめてアサイン
      const items = [...selected].map(parseKey);
      const page = items[0].page;
      if (items.every((t) => t.page === page)) {
        assign(
          page,
          items.map((t) => t.pad),
          schedule.palette[i]
        );
      } else {
        showToast("複数ページにまたがる選択にはまとめてアサインできません");
      }
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

pagePads.forEach((pads, page) => {
  pads.forEach(({ pad }, i) => {
    pad.addEventListener("click", (event) => {
      const key = selKey(page, i);
      if (event.shiftKey) {
        const next = new Set(selected);
        next.has(key) ? next.delete(key) : next.add(key);
        setSelection(next);
        return;
      }
      if (isPadDoubleTap(key)) {
        setSelection([...selectionBeforeTap, key]);
        return;
      }
      selectionBeforeTap = new Set(selected);
      setSelection([key]);
    });

    pad.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      pad.classList.add("drop-target");
    });

    pad.addEventListener("dragleave", () =>
      pad.classList.remove("drop-target")
    );

    pad.addEventListener("drop", (event) => {
      event.preventDefault();
      pad.classList.remove("drop-target");
      const paletteIndex = Number(event.dataTransfer.getData("text/plain"));
      if (!schedule || Number.isNaN(paletteIndex)) return;
      assign(page, targetPadsOnPage(page, i), schedule.palette[paletteIndex]);
      setSelection([]);
    });

    pad.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (!schedule) return;
      if (isLocked()) {
        showToast("LOCK中はアサインできません");
        return;
      }
      openMenu(page, i, event.clientX, event.clientY);
    });
  });
});

// ---------- 右クリックメニュー ----------

function openMenu(page, index, x, y) {
  menuTarget = { page, index };
  menuPosition = { x, y };
  const p = pageAt(page);
  const hasColor = canFadeColor(p.colors[index]);
  menu.querySelector('[data-action="delete"]').hidden =
    isRunning() || p.colors[index] === null;
  menu.querySelector('[data-action="cancel-temp"]').hidden =
    p.temp_colors[index] === null;
  menu.querySelector('[data-action="fade-out"]').hidden = !hasColor;
  menu.querySelector('[data-action="fade-in"]').hidden = !hasColor;
  menu.hidden = false;
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - height - 8)}px`;
}

function closeMenu() {
  menu.hidden = true;
  menuTarget = null;
}

menu.addEventListener("click", (event) => {
  const action = event.target.dataset.action;
  if (!action || !menuTarget) return;
  const { page, index } = menuTarget;
  const targets = targetPadsOnPage(page, index);
  const p = pageAt(page);
  closeMenu();

  if (action === "edit") {
    const current = isRunning()
      ? (p.temp_colors[index] ?? p.colors[index])
      : p.colors[index];
    if (current === SMPTE) {
      showToast("SMPTEカラーバーは編集できません");
      return;
    }
    openColorPanel(current, menuPosition.x, menuPosition.y, (value) =>
      assign(page, targets, value)
    );
  } else if (action === "fade-out") {
    setFades(page, targets, FADE_OUT);
  } else if (action === "fade-in") {
    setFades(page, targets, FADE_IN);
  } else if (action === "delete") {
    assign(page, targets, null);
  } else if (action === "cancel-temp") {
    cancelTemp(page, targets);
  }
  setSelection([]);
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".menu")) closeMenu();
  if (!event.target.closest(".pad, .swatch, .menu, .color-panel"))
    setSelection([]);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMenu();
    closeColorPanel();
    setSelection([]);
  }
});

// ---------- RUN / SWITCH / LOCK / sw Lock ----------

function switchBlockReason(t) {
  if (isLocked()) return "LOCK中はSWITCHできません";
  if (!isRunning()) return "SWITCHはRUN中だけ使えます";
  if (t < schedule.t0) return "切り替え待ちです";
  const can = schedule.pages.some(
    (p) => !p.switch_lock && p.temp_colors.some((v) => v !== null)
  );
  if (!can) return "SWITCHできるページがありません";
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
  send("/api/console/switch", {
    t0: Sequencer.switchStartTime(schedule.t0, t),
  });
});

lockInput.checked = localStorage.getItem(LOCK_STORAGE_KEY) === "1";
lockInput.addEventListener("change", () => {
  localStorage.setItem(LOCK_STORAGE_KEY, lockInput.checked ? "1" : "0");
});

swLockInputs.forEach((input) => {
  input.addEventListener("change", () => {
    const page = Number(input.dataset.page);
    send("/api/console/switch-lock", {
      page,
      switch_lock: input.checked,
    });
  });
});

// ---------- QRコード ----------

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

qrLinks.forEach((link) => {
  link.addEventListener("click", async (event) => {
    event.preventDefault();
    const page = Number(link.dataset.page);
    await copyText(AUDIENCE_URLS[page]);
    showToast(
      `PAGE.${String(page + 1).padStart(2, "0")} のURLをコピーしました`
    );
  });
});

// ---------- 毎フレームの描画 ----------

let lastStatus = "";
const lastMonitorValues = Array(PAGE_COUNT).fill(undefined);
const lastCurrentPads = Array(PAGE_COUNT).fill(-1);

function render() {
  const t = Sequencer.now();
  let statusFrame = { kind: "standby" };

  for (let page = 0; page < PAGE_COUNT; page++) {
    const view = pageScheduleView(page);
    const frame = Sequencer.frameAt(view, t);
    if (page === 0) statusFrame = frame;
    const value = frame.kind === "standby" ? SMPTE : frame.value;
    if (value !== lastMonitorValues[page]) {
      Sequencer.paint(monitors[page].monitor, value);
      monitors[page].code.textContent = value === null ? "NO ASSIGN" : value;
      lastMonitorValues[page] = value;
    }
    const currentPad = frame.kind === "pad" ? frame.pad : -1;
    if (currentPad !== lastCurrentPads[page]) {
      pagePads[page].forEach(({ pad }, i) => {
        pad.classList.toggle("current", i === currentPad);
      });
      lastCurrentPads[page] = currentPad;
    }
  }

  const text = Sequencer.formatClock(t);
  if (text !== lastStatus) {
    statusLine.textContent = text;
    lastStatus = text;
  }

  const running = isRunning();
  runButton.classList.toggle("running", running);
  runButton.classList.toggle(
    "blink",
    running && statusFrame.kind === "pad" && statusFrame.step % 2 === 0
  );
  runButton.classList.toggle("disabled", isLocked());

  const pending =
    running &&
    schedule?.t0 != null &&
    t < schedule.t0 &&
    schedule.pages?.some((p) => p.prev_colors !== null);
  switchButton.classList.toggle("pending", pending);
  switchButton.classList.toggle(
    "disabled",
    !pending && schedule !== null && switchBlockReason(t) !== null
  );

  consoleView.classList.toggle("locked", isLocked());

  requestAnimationFrame(render);
}
requestAnimationFrame(render);

const consoleFit = document.getElementById("console-fit");
const CONSOLE_WIDTH = 1100;

function fitConsole() {
  consoleView.style.width = `${CONSOLE_WIDTH}px`;
  consoleView.style.transform = "none";
  const naturalHeight = consoleView.offsetHeight;
  const scale = Math.min(
    window.innerHeight / naturalHeight,
    window.innerWidth / CONSOLE_WIDTH,
  );
  consoleFit.style.width = `${CONSOLE_WIDTH * scale}px`;
  consoleFit.style.height = `${naturalHeight * scale}px`;
  consoleView.style.transformOrigin = "top left";
  consoleView.style.transform = `scale(${scale})`;
}

window.addEventListener("resize", fitConsole);
fitConsole();
