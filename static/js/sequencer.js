// console と audience で共通の処理。色は「今の時刻」から毎回計算する。
const Sequencer = (() => {
  const PAD_COUNT = 12;
  const PAD_MS = 500;
  const LOOP_MS = PAD_MS * PAD_COUNT;
  const RUN_LEAD_MS = 2000;
  const SWITCH_LEAD_MS = 2000;
  const POLL_MS = 1000;
  const CLOCK_SYNC_MS = 60000;
  const SMPTE = "SMPTE";

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

  // 今表示すべきものを返す。
  // { kind: "standby" } … 待機中（SMPTEカラーバー）
  // { kind: "pad", pad, step, value } … pad番目のパッドを表示中
  function frameAt(schedule, t) {
    if (!schedule || schedule.state !== "run" || schedule.t0 === null) {
      return { kind: "standby" };
    }
    let colors = schedule.colors;
    if (t < schedule.t0) {
      // SWITCH直後で新しい t0 がまだ来ていない間は、切り替え前の色を出す
      if (!schedule.prev_colors) return { kind: "standby" };
      colors = schedule.prev_colors;
    }
    const step = Math.floor((t - schedule.t0) / PAD_MS);
    // JavaScript の % は負の数で負の結果になるので、0〜11 に直す
    const pad = ((step % PAD_COUNT) + PAD_COUNT) % PAD_COUNT;
    return { kind: "pad", pad, step, value: colors[pad] };
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
    SMPTE,
    now,
    startClockSync,
    frameAt,
    runStartTime,
    switchStartTime,
    formatClock,
    padLabel,
    statusText,
    paint,
    getJSON,
    postJSON,
    startPolling,
  };
})();
