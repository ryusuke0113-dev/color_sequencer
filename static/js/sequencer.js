// console と audience で共通の処理。色は「今の時刻」から毎回計算する。
const Sequencer = (() => {
  const PAD_COUNT = 12;
  const PAD_MS = 500;
  const LOOP_MS = PAD_MS * PAD_COUNT;
  const RUN_LEAD_MS = 2000;
  const SWITCH_LEAD_MS = 2000;
  const POLL_MS = 1000;
  const CLOCK_SYNC_MS = 60000;
  const FADE_STAGES = 6;
  const STAGE_MS = PAD_MS / FADE_STAGES;
  const PAGE_COUNT = 3;
  const SMPTE = "SMPTE";
  const FADE_NONE = "none";
  const FADE_OUT = "fade_out";
  const FADE_IN = "fade_in";

  // 端末の時計とサーバーの時計の差（ミリ秒）。端末同士のずれを小さくするために使う。
  let clockOffset = 0;

  function now() {
    return Date.now() + clockOffset;
  }

  async function syncClock() {
    let best = null;
    for (let i = 0; i < 5; i++) {
      try {
        const sent = Date.now();
        const data = await getJSON("/api/time");
        const received = Date.now();
        const roundTrip = received - sent;
        if (!best || roundTrip < best.roundTrip) {
          best = { roundTrip, offset: data.now + roundTrip / 2 - received };
        }
      } catch {
        // 取れなかった回は無視する
      }
    }
    if (best) clockOffset = best.offset;
  }

  function startClockSync() {
    syncClock();
    setInterval(syncClock, CLOCK_SYNC_MS);
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbToHex(r, g, b) {
    const to = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
  }

  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: h / 6, s, l };
  }

  function hslToRgb(h, s, l) {
    if (s === 0) {
      const v = l * 255;
      return { r: v, g: v, b: v };
    }
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return {
      r: hue2rgb(p, q, h + 1 / 3) * 255,
      g: hue2rgb(p, q, h) * 255,
      b: hue2rgb(p, q, h - 1 / 3) * 255,
    };
  }

  function hexToHsl(hex) {
    const { r, g, b } = hexToRgb(hex);
    return rgbToHsl(r, g, b);
  }

  function hslToHex(h, s, l) {
    const { r, g, b } = hslToRgb(h, s, l);
    return rgbToHex(r, g, b);
  }

  // 基準色の明度を最大(1.0)とし、factor 倍した色を返す（0.25〜1.0）
  function scaleBrightness(hex, factor) {
    const { h, s, l } = hexToHsl(hex);
    return hslToHex(h, s, l * factor);
  }

  // フェードアウト: 6/6→…→1/6 / フェードイン: 1/6→…→6/6（基準色の明度を最大とする）
  function fadeFactors(mode) {
    if (mode === FADE_OUT) {
      return [6, 5, 4, 3, 2, 1].map((n) => n / FADE_STAGES);
    }
    if (mode === FADE_IN) {
      return [1, 2, 3, 4, 5, 6].map((n) => n / FADE_STAGES);
    }
    return null;
  }

  function applyFade(hex, mode, stage) {
    const factors = fadeFactors(mode);
    if (!factors || !hex || hex === SMPTE) return hex;
    return scaleBrightness(hex, factors[stage]);
  }

  // 今表示すべきものを返す。
  // { kind: "standby" } … 待機中（SMPTEカラーバー）
  // { kind: "pad", pad, step, stage, value, base } … pad番目のパッドを表示中
  function frameAt(schedule, t) {
    if (!schedule || schedule.state !== "run" || schedule.t0 === null) {
      return { kind: "standby" };
    }
    let colors = schedule.colors;
    let fades = schedule.fades || Array(PAD_COUNT).fill(FADE_NONE);
    if (t < schedule.t0) {
      // SWITCH直後で新しい t0 がまだ来ていない間は、切り替え前の色を出す
      if (!schedule.prev_colors) return { kind: "standby" };
      colors = schedule.prev_colors;
      fades = schedule.prev_fades || fades;
    }
    const elapsed = t - schedule.t0;
    const step = Math.floor(elapsed / PAD_MS);
    // JavaScript の % は負の数で負の結果になるので、0〜11 に直す
    const pad = ((step % PAD_COUNT) + PAD_COUNT) % PAD_COUNT;
    const within = ((elapsed % PAD_MS) + PAD_MS) % PAD_MS;
    const stage = Math.min(FADE_STAGES - 1, Math.floor(within / STAGE_MS));
    const base = colors[pad];
    const fade = fades[pad] || FADE_NONE;
    const value =
      typeof base === "string" && base !== SMPTE ? applyFade(base, fade, stage) : base;
    return { kind: "pad", pad, step, stage, value, base, fade };
  }

  function runStartTime(t) {
    return Math.ceil(t / PAD_MS) * PAD_MS + RUN_LEAD_MS;
  }

  function switchStartTime(t0, t) {
    const loops = Math.max(1, Math.ceil((t + SWITCH_LEAD_MS - t0) / LOOP_MS));
    return t0 + loops * LOOP_MS;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  // 例: 2026/10/14 13:30:00:50 （末尾2桁は0.5秒単位で 00 か 50）
  function formatClock(t) {
    const d = new Date(Math.floor(t / PAD_MS) * PAD_MS);
    const date = `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
    const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    return `${date} ${time}:${d.getMilliseconds() >= PAD_MS ? "50" : "00"}`;
  }

  function padLabel(index) {
    return `PAD.${pad2(index + 1)}`;
  }

  function valueLabel(value) {
    if (value === null) return "NO ASSIGN";
    return value;
  }

  function statusText(frame, t) {
    if (frame.kind === "standby") return `${formatClock(t)} PAD.-- STANDBY`;
    return `${formatClock(t)} ${padLabel(frame.pad)} ${valueLabel(frame.value)}`;
  }

  // 要素の見た目をパッドの値に合わせる（カラーコード / SMPTE / 未アサイン）
  function paint(element, value) {
    element.classList.toggle("smpte", value === SMPTE);
    element.classList.toggle("unassigned", value === null);
    element.style.backgroundColor = value && value !== SMPTE ? value : "";
  }

  async function getJSON(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status}`);
    return response.json();
  }

  async function postJSON(url, body = {}) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `通信エラー (${response.status})`);
    return data;
  }

  // 版番号を1秒おきに確認し、変わったときだけ schedule 全体を取得する
  function startPolling(versionUrl, scheduleUrl, onSchedule, onConnection) {
    let version = null;
    async function tick() {
      try {
        const data = await getJSON(versionUrl);
        if (data.version !== version) {
          const schedule = await getJSON(scheduleUrl);
          version = schedule.version;
          onSchedule(schedule);
        }
        onConnection?.(true);
      } catch {
        onConnection?.(false);
      } finally {
        setTimeout(tick, POLL_MS);
      }
    }
    tick();
    return {
      // 自分の操作で受け取った schedule の版番号を伝え、二重取得を防ぐ
      setVersion(v) {
        version = v;
      },
    };
  }

  return {
    PAD_COUNT,
    PAGE_COUNT,
    SMPTE,
    FADE_NONE,
    FADE_OUT,
    FADE_IN,
    now,
    startClockSync,
    frameAt,
    runStartTime,
    switchStartTime,
    formatClock,
    padLabel,
    statusText,
    paint,
    hexToHsl,
    hslToHex,
    getJSON,
    postJSON,
    startPolling,
  };
})();
