// canvas-persistence.js — IndexedDB draft save/load, online/offline, service worker registration

import { state, offlineBadge, now, normalizeObject, initialObjects } from './canvas-state.js'
import { renderObjects, applyTransform } from './canvas-render.js'
import { updateSelection } from './canvas-selection.js'

// ── Online/offline badge ──

export function updateOfflineBadge() {
  offlineBadge.textContent = navigator.onLine ? 'online' : 'offline draft'
  offlineBadge.style.color = navigator.onLine ? 'var(--good)' : 'var(--warn)'
  offlineBadge.style.borderColor = navigator.onLine ? 'rgba(52, 211, 153, 0.35)' : 'rgba(251, 191, 36, 0.35)'
  offlineBadge.style.background = navigator.onLine ? 'rgba(52, 211, 153, 0.08)' : 'rgba(251, 191, 36, 0.08)'
}

// ── IndexedDB ──

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('edgegde-pwa-canvas', 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('drafts')) {
        db.createObjectStore('drafts', { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveDraft() {
  try {
    const db = await openDatabase()
    const tx = db.transaction('drafts', 'readwrite')
    tx.objectStore('drafts').put({
      id: 'canvas-draft',
      version: state.version,
      objects: state.objects,
      proposals: state.proposals,
      transform: state.transform,
      savedAt: now(),
      authority: 'local_draft_only'
    })
    tx.oncomplete = () => db.close()
  } catch {
    // Ignore IndexedDB failures; draft is never authoritative.
  }
}

export async function loadDraft() {
  try {
    const db = await openDatabase()
    const tx = db.transaction('drafts', 'readonly')
    const request = tx.objectStore('drafts').get('canvas-draft')
    request.onsuccess = () => {
      const draft = request.result
      if (draft && Array.isArray(draft.objects)) {
        state.version = draft.version || 0
        state.objects = draft.objects.map(normalizeObject)
        state.proposals = draft.proposals || []
        state.selectedIds = []
        state.selectedId = null
        state.transform = draft.transform || state.transform
        applyTransform()
      }
      db.close()
    }
  } catch {
    state.objects = initialObjects
  }
}

// ── Service Worker ──

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  try {
    await navigator.serviceWorker.register('/pwa-canvas/sw.js', { scope: '/pwa-canvas/' })
  } catch {
    // PWA remains functional without service worker registration.
  }
}

// ── Event listeners for online/offline ──

export function setupPersistenceHandlers() {
  document.getElementById('save-draft').addEventListener('click', saveDraft)
  window.addEventListener('online', updateOfflineBadge)
  window.addEventListener('offline', updateOfflineBadge)
}
