/**
 * Content script — injected into every page.
 * Captures user interactions: clicks, keyboard input, navigation.
 * Sends events to the background service worker.
 */
(function() {
  // Don't run on chrome:// or extension pages
  if (location.protocol === 'chrome-extension:' || location.protocol === 'chrome:') return;

  // Marker to verify content script ran
  const marker = document.createElement('meta');
  marker.name = 'hermes-active';
  marker.content = 'true';
  document.head.appendChild(marker);

  let lastKeyTime = 0;

  // Click events
  document.addEventListener('click', (e) => {
    const target = e.target;
    const info = {
      type: 'click',
      ts: Date.now(),
      tag: target.tagName,
      id: target.id || null,
      class: Array.from(target.classList).slice(0, 3).join('.') || null,
      text: (target.textContent || '').trim().substring(0, 60) || null,
      href: target.href || target.closest('a')?.href || null,
      role: target.getAttribute('role') || null,
      x: e.clientX,
      y: e.clientY,
    };
    chrome.runtime.sendMessage({ action: 'event', event: info }).catch(() => {});
  }, true);

  // Keyboard input (only printable text, debounced)
  document.addEventListener('keydown', (e) => {
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    const now = Date.now();
    if (now - lastKeyTime > 5000) {
      // Start of typing — send first character
      const target = e.target;
      chrome.runtime.sendMessage({
        action: 'event',
        event: {
          type: 'type',
          ts: now,
          tag: target.tagName,
          id: target.id || null,
          name: target.getAttribute('name') || null,
          placeholder: target.getAttribute('placeholder') || null,
        }
      }).catch(() => {});
    }
    lastKeyTime = now;
  }, true);

  // Page navigation (SPA hash changes)
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      chrome.runtime.sendMessage({
        action: 'event',
        event: { type: 'navigation', ts: Date.now(), url: location.href }
      }).catch(() => {});
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial page load
  chrome.runtime.sendMessage({
    action: 'event',
    event: { type: 'navigation', ts: Date.now(), url: location.href }
  }).catch(() => {});

// Message bridge: listen for page-level requests and forward to background
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'hermes-start') {
    chrome.runtime.sendMessage({ action: 'start' }).then(r => {
      window.postMessage({ type: 'hermes-result', action: 'start', ok: r.ok }, '*');
    });
  }
  if (e.data && e.data.type === 'hermes-stop') {
    chrome.runtime.sendMessage({ action: 'stop' }).then(r => {
      window.postMessage({ type: 'hermes-result', action: 'stop', ok: r.ok }, '*');
    });
  }
  if (e.data && e.data.type === 'hermes-request-events') {
    chrome.runtime.sendMessage({ action: 'getSessions' }).then(sessions => {
      if (!sessions || sessions.length === 0) {
        window.postMessage({ type: 'hermes-events', sessions: [] }, '*');
        return;
      }
      const latest = sessions[sessions.length - 1];
      window.postMessage({ type: 'hermes-events', session: latest, events: latest.events || [] }, '*');
    });
  }
  if (e.data && e.data.type === 'hermes-request-all-sessions') {
    chrome.runtime.sendMessage({ action: 'getSessions' }).then(sessions => {
      const allSessions = (sessions || []).map(s => ({ ...s, events: s.events || [] }));
      window.postMessage({ type: 'hermes-all-sessions', sessions: allSessions }, '*');
    });
  }
});

})();
