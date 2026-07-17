/**
 * Hermes Workflow Recorder — Background Service Worker
 * 
 * Records user interactions via Chrome Debugger API.
 * All data stays local to chrome.storage.
 */

const SESSION_TIMEOUT_MS = 300000;
const MAX_EVENTS_PER_SESSION = 50000;

let activeTabId = null;
let activeSession = null;
let isRecording = false;

// ── Session Management ──

function generateSessionId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = Math.random().toString(36).substring(2, 6);
  return `${ts}-${rand}`;
}

function getSessionKey(tabId, url) {
  try { return new URL(url).origin; } catch { return `tab-${tabId}`; }
}

async function getOrCreateSession(tabId, url) {
  const now = Date.now();
  const key = getSessionKey(tabId, url);

  if (activeSession && activeSession.key === key && (now - activeSession.lastEvent) < SESSION_TIMEOUT_MS) {
    activeSession.lastEvent = now;
    return activeSession;
  }

  if (activeSession && activeSession.events.length > 0) {
    await saveSession(activeSession);
  }

  activeSession = {
    id: generateSessionId(),
    key, tabId, origin: key, url,
    startTime: now, lastEvent: now, eventCount: 0, events: [],
    finalized: false,
  };

  activeSession.events.push({ type: '_session_start', ts: now, url, origin: key });
  updateBadge();
  return activeSession;
}

async function saveSession(session) {
  if (session.finalized || session.events.length === 0) return;
  session.finalized = true;

  const data = await chrome.storage.local.get('sessions') || {};
  const sessions = data.sessions || [];
  sessions.push({
    id: session.id, origin: session.origin,
    startTime: session.startTime, endTime: Date.now(),
    eventCount: session.events.length, url: session.url,
  });
  await chrome.storage.local.set({ sessions });
  await chrome.storage.local.set({ [`events_${session.id}`]: session.events });
}

function addEvent(type, data) {
  if (!activeSession || activeSession.eventCount >= MAX_EVENTS_PER_SESSION) return;
  activeSession.events.push({ type, ts: Date.now(), ...data });
  activeSession.eventCount++;
  activeSession.lastEvent = Date.now();
  updateBadge();
}

// ── Debugger ──

async function attachDebugger(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
    await chrome.debugger.sendCommand({ tabId }, 'Input.enable');
    activeTabId = tabId;
    isRecording = true;
    updateBadge();

    try {
      const result = await chrome.debugger.sendCommand({ tabId }, 'Page.getNavigationHistory');
      const entry = result.entries?.[result.currentIndex];
      if (entry) await getOrCreateSession(tabId, entry.url);
    } catch {}

    console.log(`[Recorder] Attached OK tab=${tabId}`);
    return true;
  } catch (e) {
    console.error(`[Recorder] Attach fail: ${e.message}`);
    isRecording = false;
    updateBadge();
    return false;
  }
}

async function detachDebugger(tabId) {
  try {
    if (activeSession) {
      activeSession.events.push({ type: '_session_end', ts: Date.now() });
      await saveSession(activeSession);
      activeSession = null;
    }
    await chrome.debugger.detach({ tabId });
    isRecording = false;
    activeTabId = null;
    activeSession = null;
    updateBadge();
  } catch (e) {
    console.error(`[Recorder] Detach error: ${e.message}`);
  }
}

// ── Event Handling ──

function handleDebuggerEvent(source, method, params) {
  if (!isRecording || source.tabId !== activeTabId) return;

  if (method === 'Page.frameNavigated' && params.frame?.url) {
    getOrCreateSession(source.tabId, params.frame.url);
    addEvent('navigation', { url: params.frame.url, title: params.frame.title || '' });
    return;
  }

  if (method === 'Input.dispatchMouseEvent' && params.type === 'mousePressed') {
    addEvent('click', { x: Math.round(params.x), y: Math.round(params.y), button: params.button, clickCount: params.clickCount || 1 });
    return;
  }

  if (method === 'Input.dispatchKeyEvent' && params.type === 'keyDown' && params.text) {
    const text = params.text;
    if (text.length > 0 && text.length <= 200 && text !== '\r' && text !== '\t' && text !== '\b') {
      addEvent('type', { text });
    }
  }
}

// ── Tab Change Handling ──

async function onTabActivated(activeInfo) {
  if (!isRecording) return;
  if (activeTabId !== null && activeTabId !== activeInfo.tabId) {
    await detachDebugger(activeTabId);
  }
  if (activeInfo.tabId) {
    const tab = await chrome.tabs.get(activeInfo.tabId).catch(() => null);
    if (tab && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
      await attachDebugger(activeInfo.tabId);
    }
  }
}

// ── Badge ──

function updateBadge() {
  if (!isRecording) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  chrome.action.setBadgeText({ text: String(activeSession?.eventCount || '•') });
  chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
}

// ── Popup Messages ──

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Synchronous responses first
  if (msg.action === 'getStatus') {
    sendResponse({ isRecording, activeTabId, sessionEvents: activeSession?.eventCount || 0, sessionOrigin: activeSession?.origin || null });
    return;
  }

  // Async responses need return true;
  if (msg.action === 'start') {
    // Popup sends the tabId; background just attaches
    const tabId = msg.tabId;
    if (!tabId) {
      sendResponse({ ok: false, reason: 'Missing tab ID.' });
      return true;
    }
    attachDebugger(tabId).then(result => {
      if (result) {
        chrome.tabs.get(tabId).then(tab => {
          if (tab?.url) getOrCreateSession(tabId, tab.url);
        });
      }
      sendResponse({ ok: result, isRecording, reason: result ? null : 'Debugger attach failed. Close Chrome DevTools if open, then retry.' });
    });
    return true;
  }

  if (msg.action === 'stop') {
    if (activeTabId) detachDebugger(activeTabId);
    sendResponse({ ok: true, isRecording: false });
    return;
  }

  if (msg.action === 'getSessions') {
    chrome.storage.local.get('sessions').then(d => sendResponse(d.sessions || []));
    return true;
  }

  if (msg.action === 'getSessionEvents') {
    chrome.storage.local.get(`events_${msg.sessionId}`).then(d => sendResponse(d[`events_${msg.sessionId}`] || []));
    return true;
  }

  if (msg.action === 'clearAll') {
    chrome.storage.local.clear().then(() => { activeSession = null; isRecording = false; activeTabId = null; updateBadge(); sendResponse({ cleared: true }); });
    return true;
  }

  if (msg.action === 'exportSession') {
    chrome.storage.local.get(`events_${msg.sessionId}`).then(async (data) => {
      const events = data[`events_${msg.sessionId}`] || [];
      const storage = await chrome.storage.local.get('sessions');
      const sessionInfo = (storage.sessions || []).find(s => s.id === msg.sessionId);
      const replay = {
        title: sessionInfo?.origin || 'Unknown',
        steps: events.filter(e => e.type === 'click' || e.type === 'type' || e.type === 'navigation').map(e => {
          if (e.type === 'click') return { type: 'click', x: e.x, y: e.y, button: e.button };
          if (e.type === 'type') return { type: 'keyDown', text: e.text };
          if (e.type === 'navigation') return { type: 'navigate', url: e.url };
          return null;
        }).filter(Boolean),
      };
      const blob = new Blob([JSON.stringify(replay, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      await chrome.downloads.download({ url, filename: `workflow-${msg.sessionId}.json`, saveAs: true });
      URL.revokeObjectURL(url);
      sendResponse({ exported: true });
    });
    return true;
  }
});

// Tab listeners
chrome.tabs.onActivated.addListener(onTabActivated);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && tabId === activeTabId) {
    getOrCreateSession(tabId, changeInfo.url);
  }
});

// Debugger event handlers
chrome.debugger.onEvent.addListener(handleDebuggerEvent);
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === activeTabId) {
    isRecording = false;
    activeTabId = null;
    updateBadge();
  }
});

console.log('[Recorder] Loaded');
