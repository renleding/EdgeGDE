/* Math Tutor PWA — Client App */
(function() {
  'use strict';

  const API = '/api/tutor/math/ask';
  const UPLOAD_API = '/api/tutor/math/upload';
  const TEST_API = '/api/tutor/math/test';
  const PROGRESS_API = '/api/tutor/math/progress';
  const CSV_API = '/api/tutor/math/progress/csv';
  const VIEWS = ['chat', 'practice', 'dashboard'];

  // ── Navigation ──
  function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const view = document.getElementById('view-' + name);
    const link = document.querySelector(`[data-view="${name}"]`);
    if (view) view.classList.add('active');
    if (link) link.classList.add('active');
  }

  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      showView(link.dataset.view);
      history.replaceState(null, '', '#' + link.dataset.view);
    });
  });

  // Restore view from hash
  const hash = location.hash.slice(1) || 'chat';
  if (VIEWS.includes(hash)) showView(hash);

  // ── Chat ──
  const chatInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('btn-send');
  const chatThread = document.getElementById('chat-thread');
  const fileInput = document.getElementById('file-input');
  const uploadBtn = document.getElementById('btn-upload');

  function addMsg(role, content, working, tip, diagram) {
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    let html = `<div class="msg-content">${escapeHtml(content)}</div>`;
    if (working) html += `<div class="working">${escapeHtml(working)}</div>`;
    if (diagram) html += `<div class="mermaid">${escapeHtml(diagram)}</div>`;
    if (tip) html += `<div class="tip">💡 ${escapeHtml(tip)}</div>`;
    div.innerHTML = html;
    chatThread.appendChild(div);
    // Render any Mermaid diagrams in this message
    if (diagram && typeof mermaid !== 'undefined') {
      mermaid.run({ nodes: [div.querySelector('.mermaid')] }).catch(() => {});
    }
    chatThread.scrollTop = chatThread.scrollHeight;
  }

  function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  async function sendMessage(text) {
    if (!text.trim()) return;
    addMsg('student', text);
    chatInput.value = '';
    sendBtn.disabled = true;

    try {
      const resp = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          tutor_subject: 'maths-standard',
          stream: false
        })
      });
      const data = await resp.json();
      const reply = data?.response || data?.answer || '(no response)';
      const working = data?.working || '';
      const tip = data?.tip || 'Keep practicing — you are building real skills.';
      const diagram = data?.diagram || '';
      addMsg('tutor', reply, working, tip, diagram);
    } catch (err) {
      addMsg('tutor', 'Sorry, I had trouble reaching the tutor engine. Check your connection and try again.');
    } finally {
      sendBtn.disabled = false;
      chatInput.focus();
    }
  }

  sendBtn.addEventListener('click', () => sendMessage(chatInput.value));
  chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(chatInput.value); });

  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    for (const file of fileInput.files) {
      addMsg('student', `📄 Uploading: ${file.name}...`);
      const form = new FormData();
      form.append('file', file);
      try {
        await fetch(UPLOAD_API, { method: 'POST', body: form });
        addMsg('tutor', `Got it! I've read "${file.name}". Ask me anything about it.`);
      } catch {
        addMsg('tutor', `Could not process "${file.name}". Try a PDF or text file.`);
      }
    }
    fileInput.value = '';
  });

  // ── Practice Test ──
  const startBtn = document.getElementById('btn-start-test');
  const practiceArea = document.getElementById('practice-area');

  startBtn.addEventListener('click', async () => {
    const count = document.getElementById('practice-count').value || 5;
    const topic = document.getElementById('practice-topic').value;
    practiceArea.hidden = false;
    practiceArea.innerHTML = '<p>Generating test...</p>';
    try {
      const resp = await fetch(TEST_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: parseInt(count), topic: topic || undefined })
      });
      const data = await resp.json();
      if (data.questions) {
        practiceArea.innerHTML = data.questions.map((q, i) =>
          `<div class="card" style="margin-bottom:0.75rem">
            <p><strong>Q${i+1}.</strong> ${escapeHtml(q.question)}</p>
            ${q.type === 'multiple-choice' ? q.options.map(o =>
              `<label style="display:block;margin:0.25rem 0"><input type="radio" name="q${i}"> ${escapeHtml(o)}</label>`
            ).join('') : '<textarea rows="2" style="width:100%"></textarea>'}
          </div>`
        ).join('') + '<button class="btn-primary" id="btn-submit-test">Submit</button>';
      }
    } catch {
      practiceArea.innerHTML = '<p>Could not generate test. Try again.</p>';
    }
  });

  // ── Dashboard ──
  async function loadDashboard() {
    try {
      const resp = await fetch(PROGRESS_API);
      const data = await resp.json();

      // Update metric cards
      if (data.mastery != null) document.querySelector('#card-mastery .card-body').textContent = data.mastery + '%';
      if (data.time_on_task != null) document.querySelector('#card-time .card-body').textContent = data.time_on_task + ' min';
      if (data.test_count != null) document.querySelector('#card-tests .card-body').textContent = data.test_count + ' tests';
      if (data.streak_days != null) document.querySelector('#card-streak .card-body').textContent = data.streak_days + ' days';

      // Mermaid charts
      const chartContainer = document.getElementById('chart-container');
      if (!chartContainer) return;

      // Mastery bar chart
      const masteryMermaid = `xychart-beta
  title "Mastery by Strand"
  x-axis "Strand" ["Algebra", "Measurement", "Financial", "Statistics", "Networks"]
  y-axis "Mastery (%)" 0 --> 100
  bar [${data.mastery_chart ? data.mastery_chart : '20, 45, 60, 30, 15'}]`;

      chartContainer.innerHTML = `<div class="mermaid">${masteryMermaid.replace(/</g, '&lt;')}</div>`;
      if (typeof mermaid !== 'undefined') {
        mermaid.run({ nodes: [chartContainer.querySelector('.mermaid')] }).catch(() => {});
      }
    } catch { /* dashboard defaults */ }
  }

  document.getElementById('btn-export').addEventListener('click', () => {
    fetch(CSV_API)
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'math-tutor-progress.csv'; a.click();
        URL.revokeObjectURL(url);
      });
  });

  // Load dashboard when view becomes active
  const observer = new MutationObserver(() => {
    if (document.getElementById('view-dashboard').classList.contains('active')) loadDashboard();
  });
  document.querySelectorAll('.view').forEach(v => observer.observe(v, { attributes: true, attributeFilter: ['class'] }));
  loadDashboard();

})();
