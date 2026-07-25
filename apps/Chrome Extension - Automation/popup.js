/**
 * Hermes Workflow Recorder — Popup UI
 */
let selectedSessionId = null;

async function refresh() {
  const status = await chrome.runtime.sendMessage({ action: 'getStatus' });
  const dot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const originText = document.getElementById('originText');
  const startBtn = document.getElementById('startBtn');

  if (status.isRecording) {
    dot.className = 'dot recording';
    statusText.textContent = `Recording — ${status.sessionEvents} events`;
    originText.textContent = status.sessionOrigin || 'No tab';
    startBtn.textContent = '■ Stop Recording';
    startBtn.className = 'btn start active';
  } else {
    dot.className = 'dot';
    statusText.textContent = 'Not recording — click Start';
    originText.textContent = '';
    startBtn.textContent = '▶ Start Recording';
    startBtn.className = 'btn start';
  }

  const sessions = await chrome.runtime.sendMessage({ action: 'getSessions' });
  const list = document.getElementById('sessionList');
  const exportBtn = document.getElementById('exportBtn');

  if (!sessions || sessions.length === 0) {
    list.innerHTML = '<div class="empty">No sessions recorded yet</div>';
    exportBtn.disabled = true;
    return;
  }

  list.innerHTML = sessions.slice().reverse().map(s => {
    const date = new Date(s.startTime).toLocaleString();
    const isSelected = selectedSessionId === s.id;
    return `<div class="session-item" data-id="${s.id}" style="${isSelected ? 'border: 1px solid #4CAF50;' : ''}">
      <div class="si-origin">${s.origin} <span class="badge-count">${s.eventCount}</span></div>
      <div class="si-meta">${date} — ${s.eventCount} events</div>
    </div>`;
  }).join('');

  list.querySelectorAll('.session-item').forEach(el => {
    el.addEventListener('click', () => {
      selectedSessionId = el.dataset.id;
      exportBtn.disabled = false;
      exportBtn.textContent = `Export Selected as Playwright`;
      refresh();
    });
  });
}

// Start/Stop button
document.getElementById('startBtn').addEventListener('click', async () => {
  const btn = document.getElementById('startBtn');
  const status = await chrome.runtime.sendMessage({ action: 'getStatus' });

  if (status.isRecording) {
    await chrome.runtime.sendMessage({ action: 'stop' });
  } else {
    btn.textContent = 'Starting...';
    btn.disabled = true;
    const result = await chrome.runtime.sendMessage({ action: 'start' });
    btn.disabled = false;
    if (!result.ok) {
      alert(result.reason || 'Failed to start recording. Reload the extension and try again.');
    }
  }
  refresh();
});

// Export button
document.getElementById('exportBtn').addEventListener('click', async () => {
  if (!selectedSessionId) return;

  const btn = document.getElementById('exportBtn');
  btn.textContent = 'Exporting...';
  btn.disabled = true;

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'exportSession',
      sessionId: selectedSessionId,
    });

    if (result && result.exported) {
      btn.textContent = 'Exported!';
      setTimeout(() => {
        btn.textContent = 'Export Selected as Playwright';
        btn.disabled = false;
      }, 2000);
    } else {
      console.error('Export failed:', result?.error || 'unknown');
      btn.textContent = 'Export Failed';
      setTimeout(() => {
        btn.textContent = 'Export Selected as Playwright';
        btn.disabled = false;
      }, 3000);
    }
  } catch (e) {
    console.error('Export error:', e);
    btn.textContent = 'Export Error';
    setTimeout(() => {
      btn.textContent = 'Export Selected as Playwright';
      btn.disabled = false;
    }, 3000);
  }
});

// Clear button
document.getElementById('clearBtn').addEventListener('click', async () => {
  if (confirm('Clear all recorded sessions?')) {
    await chrome.runtime.sendMessage({ action: 'clearAll' });
    selectedSessionId = null;
    refresh();
  }
});

// Initial load
refresh();
