const screenView = document.getElementById("screen");
const statusLine = document.getElementById("status");
const offlineLine = document.getElementById("offline");
const hint = document.getElementById("hint");

let schedule = null;
let lastFrameKey = "";

Sequencer.startClockSync();
Sequencer.startPolling(
  `/api/audience/${AUDIENCE_ID}/version`,
  `/api/audience/${AUDIENCE_ID}/schedule`,
  (received) => {
    schedule = received;
  },
  (connected) => {
    offlineLine.hidden = connected;
  },
);

// 画面を描くたびに今の時刻から色を計算する（タイマーで順送りにしない）
function render() {
  const t = Sequencer.now();
  const frame = Sequencer.frameAt(schedule, t);
  const value = frame.kind === "standby" ? Sequencer.SMPTE : frame.value;
  const text = Sequencer.statusText(frame, t);

  const key = `${value}|${text}`;
  if (key !== lastFrameKey) {
    Sequencer.paint(screenView, value);
    statusLine.textContent = text;
    lastFrameKey = key;
  }
  requestAnimationFrame(render);
}
requestAnimationFrame(render);

// タップで全画面にし、演出中に画面が消えないようにする
let wakeLock = null;

async function keepScreenOn() {
  try {
    wakeLock = await navigator.wakeLock?.request("screen");
  } catch {
    // HTTPS でない場合など、使えない環境では何もしない
  }
}

document.addEventListener("click", async () => {
  hint.classList.add("hidden");
  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen?.().catch(() => {});
  }
  keepScreenOn();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && wakeLock !== null) keepScreenOn();
});

setTimeout(() => hint.classList.add("hidden"), 5000);
