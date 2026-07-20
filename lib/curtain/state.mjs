export const STATES = Object.freeze({
  IDLE: "idle",
  WORKING: "working",
  // Context compaction: real work with no live output. Without its own state a
  // compacting session sits on the previous DONE and reads as finished.
  COMPACTING: "compacting",
  DONE: "done",
  NEEDS: "needs",
});

export const isState = (s) => Object.values(STATES).includes(s);

export const formatElapsed = (sec) => {
  let s = Number(sec);
  if (!Number.isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`;
};

export const computeElapsed = (nowSec, sinceSec) => {
  const since = Number(sinceSec);
  if (!Number.isFinite(since) || since <= 0) return 0;
  return Math.max(0, Math.floor(Number(nowSec) - since));
};
