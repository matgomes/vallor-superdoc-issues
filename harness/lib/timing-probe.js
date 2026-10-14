window.__timing = { longTasks: [], loaf: [], frameDurations: [] };

function observeTimingType(type, onEntries) {
  if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return;
  new PerformanceObserver((list) => onEntries(list.getEntries())).observe({ type, buffered: true });
}

observeTimingType("longtask", (entries) => {
  for (const entry of entries) window.__timing.longTasks.push({ start: entry.startTime, duration: entry.duration });
});
observeTimingType("long-animation-frame", (entries) => {
  for (const entry of entries) window.__timing.loaf.push({ start: entry.startTime, duration: entry.duration, renderTime: entry.renderTime });
});

window.__timingFrameState = { lastFrameAt: performance.now() };
function recordTimingFrame() {
  const now = performance.now();
  window.__timing.frameDurations.push(now - window.__timingFrameState.lastFrameAt);
  window.__timingFrameState.lastFrameAt = now;
  requestAnimationFrame(recordTimingFrame);
}
requestAnimationFrame(recordTimingFrame);
