/**
 * Hermes Workflow Recorder — Background Service Worker
 *
 * Receives events from content scripts, manages recording sessions.
 * No debugger API needed — content scripts capture DOM events directly.
 * 
 * All data stays local to chrome.storage.
 */

const SESSION_TIMEOUT_MS = 300000;
const MAX_EVENTS_PER_SESSION = 50000;

let activeSession = null;
let isRecording = false;

// ── Session Management ──

function generateSessionId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = Math.random().toString(36).substring(2, 6);
  return `${ts}-${rand}`;
}

function getSessionKey(url) {
  try { return new URL(url).origin; } catch { return 'unknown'; }
}

async function getOrCreateSession(url) {
  const now = Date.now();
  const key = getSessionKey(url);

  if (activeSession && activeSession.key === key && (now - activeSession.lastEvent) < SESSION_TIMEOUT_MS) {
    activeSession.lastEvent = now;
    return activeSession;
  }

  // Save old session before starting new one
  if (activeSession && activeSession.events.length > 0) {
    await saveSession(activeSession);
  }

  activeSession = {
    id: generateSessionId(),
    key, origin: key, url,
    startTime: now, lastEvent: now, eventCount: 0, events: [],
    finalized: false,
  };
  activeSession.events.push({ type: '_session_start', ts: now, url, origin: key });
  updateBadge();
  return activeSession;
}

async function saveSession(session) {
  if (session.finalized) return;
  session.finalized = true;

  try {
    const data = await chrome.storage.local.get('sessions');
    const sessions = data.sessions || [];
    const sessionData = {
      id: session.id,
      origin: session.origin,
      startTime: session.startTime,
      endTime: Date.now(),
      eventCount: session.events.length,
      url: session.url,
      events: session.events,
    };
    sessions.push(sessionData);
    // Keep last 50 sessions
    if (sessions.length > 50) sessions.splice(0, sessions.length - 50);
    await chrome.storage.local.set({ sessions });
  } catch (e) {
    console.error('[Recorder] saveSession error:', e);
  }
}

function addEvent(event) {
  if (!isRecording || !activeSession || activeSession.eventCount >= MAX_EVENTS_PER_SESSION) return;
  activeSession.events.push(event);
  activeSession.eventCount++;
  activeSession.lastEvent = Date.now();
  updateBadge();
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

// ── Handle events from content scripts ──

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Events from content scripts
  if (msg.action === 'event' && sender.tab) {
    if (!isRecording) return;
    const event = msg.event;
    event.url = sender.tab.url || '';
    getOrCreateSession(event.url);
    addEvent(event);
    return;
  }

  // Popup: start recording
  if (msg.action === 'start') {
    isRecording = true;
    updateBadge();
    sendResponse({ ok: true, isRecording });
    return;
  }

  // Popup: stop recording
  if (msg.action === 'stop') {
    if (activeSession) {
      activeSession.events.push({ type: '_session_end', ts: Date.now() });
      saveSession(activeSession);
      activeSession = null;
    }
    isRecording = false;
    updateBadge();
    sendResponse({ ok: true, isRecording: false });
    return;
  }

  // Popup: get current status
  if (msg.action === 'getStatus') {
    sendResponse({
      isRecording,
      sessionEvents: activeSession?.eventCount || 0,
      sessionOrigin: activeSession?.origin || null,
    });
    return;
  }

  // Popup: get all sessions
  if (msg.action === 'getSessions') {
    chrome.storage.local.get('sessions').then(d => {
      sendResponse(d.sessions || []);
    }).catch(e => {
      console.error('[Recorder] getSessions error:', e);
      sendResponse([]);
    });
    return true;
  }

  // Popup: clear all data
  if (msg.action === 'clearAll') {
    chrome.storage.local.clear().then(() => {
      activeSession = null;
      isRecording = false;
      updateBadge();
      sendResponse({ cleared: true });
    }).catch(e => {
      console.error('[Recorder] clearAll error:', e);
      sendResponse({ cleared: false });
    });
    return true;
  }

  // Popup: export session as Playwright JSON
  if (msg.action === 'exportSession') {
    const sessionId = msg.sessionId;
    console.log('[Recorder] Export requested for:', sessionId);

    chrome.storage.local.get('sessions').then(async (data) => {
      try {
        const sessions = data.sessions || [];
        const sessionInfo = sessions.find(s => s.id === sessionId);

        if (!sessionInfo) {
          console.error('[Recorder] Session not found:', sessionId);
          sendResponse({ exported: false, error: 'Session not found' });
          return;
        }

        const events = sessionInfo.events || [];
        console.log('[Recorder] Exporting', events.length, 'events from', sessionInfo.origin);

        const steps = events.filter(e => e.type === 'click' || e.type === 'type' || e.type === 'navigation')
          .map(e => {
            if (e.type === 'click') return { type: 'click', selector: e.id || e.role || e.tag, text: (e.text || '').substring(0, 60) };
            if (e.type === 'type') return { type: 'keyDown', field: e.name || e.id || '' };
            if (e.type === 'navigation') return { type: 'navigate', url: e.url };
            return null;
          }).filter(Boolean);

        const replay = {
          title: sessionInfo.origin || 'Unknown',
          createdAt: new Date().toISOString(),
          steps: steps,
          eventCount: events.length,
        };

        const blob = new Blob([JSON.stringify(replay, null, 2)], { type: 'application/json' });
        const blobUrl = URL.createObjectURL(blob);

        const downloadResult = await chrome.downloads.download({
          url: blobUrl,
          filename: `workflow-${sessionId}.json`,
        });

        console.log('[Recorder] Download started:', downloadResult);
        URL.revokeObjectURL(blobUrl);
        sendResponse({ exported: true, downloadId: downloadResult });
      } catch (e) {
        console.error('[Recorder] Export error:', e.message, e.stack);
        sendResponse({ exported: false, error: e.message });
      }
    }).catch(e => {
      console.error('[Recorder] Storage read error:', e);
      sendResponse({ exported: false, error: 'Storage error: ' + e.message });
    });
    return true;
  }
});

// Track URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && isRecording) {
    getOrCreateSession(changeInfo.url);
  }
});

console.log('[Recorder] Loaded — content script based');
