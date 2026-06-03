'use strict';
// Timer / stopwatch module
const Timer = (() => {
  let remaining = 0;   // seconds
  let active    = false;
  let lastTick  = 0;
  let intervalId = null;

  function reset() {
    const s = State.settings;
    remaining = s.timerType === 'countdown' ? s.timerDuration * 60 : 0;
    lastTick  = 0;
  }

  function start() {
    if (active) return;
    if (lastTick === 0) reset();
    active    = true;
    lastTick  = Date.now();
    intervalId = setInterval(tick, 500);
    Editor.updateStatusBar();
  }

  function pause() {
    if (!active) return;
    active = false;
    clearInterval(intervalId);
    intervalId = null;
    Editor.updateStatusBar();
  }

  function toggle() { active ? pause() : start(); }

  function stopReset() {
    pause();
    lastTick = 0;
    reset();
    Editor.updateStatusBar();
  }

  function tick() {
    if (!active) return;
    const now = Date.now();
    const elapsed = Math.floor((now - lastTick) / 1000);
    if (elapsed < 1) return;
    lastTick = now;
    if (State.settings.timerType === 'countdown') {
      remaining -= elapsed;
      if (remaining <= 0) {
        remaining = 0;
        pause();
        onFinished();
      }
    } else {
      remaining += elapsed;
    }
    Editor.updateStatusBar();
  }

  function onFinished() {
    if (State.settings.timerSound) beep();
    if (State.settings.timerAlert) {
      document.getElementById('timer-alert-dlg').showModal();
    }
  }

  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 660;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.8);
    } catch (_) {}
  }

  function format() {
    const r = Math.max(0, remaining);
    const m = Math.floor(r / 60);
    const s = r % 60;
    const disp = `${m}'${String(s).padStart(2,'0')}"`;
    return active ? `[${disp}]` : (lastTick !== 0 ? disp : (
      State.settings.timerType === 'countdown'
        ? `${State.settings.timerDuration}'00"`
        : `0'00"`
    ));
  }

  function isActive() { return active; }

  return { start, pause, toggle, stopReset, format, isActive, reset };
})();
