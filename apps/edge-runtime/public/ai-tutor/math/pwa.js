/* Math Tutor PWA — Client App */
(function() {
  'use strict';

  const API = '/api/tutor/math/ask';
  const UPLOAD_API = '/api/tutor/math/upload';
  const TEST_API = '/api/tutor/math/test';
  const SCORE_API = '/api/tutor/math/score';
  const SAVE_RESULT_API = '/api/tutor/math/save-result';
  const RESULTS_API = '/api/tutor/math/results';
  const PROGRESS_API = '/api/tutor/math/progress';
  const CSV_API = '/api/tutor/math/progress/csv';
  const VIEWS = ['chat', 'practice', 'dashboard'];

  const MATH_TOPICS = [
    'All Topics',
    'Area',
    'Perimeter',
    'Volume',
    'Surface Area',
    'Algebra',
    'Equations',
    'Linear Equations',
    'Quadratic Equations',
    'Simultaneous Equations',
    'Inequalities',
    'Ratios & Rates',
    'Proportions',
    'Percentages',
    'Fractions & Decimals',
    'Angles & Geometry',
    'Triangles & Pythagoras',
    'Trigonometry',
    'Circles',
    'Coordinate Geometry',
    'Graphing',
    'Measurement',
    'Statistics',
    'Probability',
    'Networks',
    'Financial Maths',
    'Number Theory',
    'Indices & Exponents',
    'Time & Rates',
    'Scale Drawings',
  ];

  // ── Document context for AI & test state ──
  let docContext = '';
  let currentTest = null; // { questions, testId, topic } for tracking active test

  // ── Student ID for cross-device history ──
  let studentId = localStorage.getItem('tutor_student_id');
  if (!studentId) {
    studentId = 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('tutor_student_id', studentId);
  }

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

  // ── Populate topic dropdown ──
  function populateTopics() {
    const select = document.getElementById('practice-topic');
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = MATH_TOPICS.map(t =>
      `<option value="${t === 'All Topics' ? '' : t}"${(!currentVal && t === 'All Topics') || currentVal === t ? ' selected' : ''}>${t}</option>`
    ).join('');
  }
  populateTopics();

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
          context: docContext || undefined,
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
        let extractedText = '';
        if (file.name.endsWith('.pdf') && typeof pdfjsLib !== 'undefined') {
          const arrayBuf = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
          for (let i = 1; i <= Math.min(pdf.numPages, 20); i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            extractedText += content.items.map((item) => item.str).join(' ') + '\n';
          }
        } else {
          extractedText = await file.text();
        }

        docContext = (docContext + '\n\n' + extractedText).slice(0, 64000);

        await fetch(UPLOAD_API, { method: 'POST', body: form });

        sendMessage(`I've uploaded "${file.name}" for study. Please read it and confirm what topics it covers so I know you understand it. Be specific — list the key topics, formulas, or concepts found in the document.`);
      } catch (e) {
        addMsg('tutor', `Could not process "${file.name}". Try a text file or PDF. (${e.message || e})`);
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
        currentTest = { questions: data.questions, testId: data.testId, topic: topic || 'All Topics' };
        renderTestForm(data.questions);
      }
    } catch {
      practiceArea.innerHTML = '<p>Could not generate test. Try again.</p>';
    }
  });

  function renderTestForm(questions) {
    practiceArea.innerHTML = `<div class="test-form">
      ${questions.map((q, i) =>
        `<div class="card test-question" data-q="${i}">
          <p><strong>Q${i+1}.</strong> ${escapeHtml(q.question)} <span class="q-type">${q.type}</span></p>
          ${q.type === 'multiple-choice'
            ? q.options.map(o =>
                `<label class="mcq-option"><input type="radio" name="q${i}" value="${escapeHtml(o)}"> ${escapeHtml(o)}</label>`
              ).join('')
            : `<textarea class="sa-input" rows="3" data-q="${i}" placeholder="Type your answer..."></textarea>`}
        </div>`
      ).join('')}
      <button class="btn-primary" id="btn-submit-test">Submit Test</button>
      <button class="btn-secondary" id="btn-reset-test" style="margin-left:0.5rem">Cancel</button>
    </div>`;
    document.getElementById('btn-submit-test').addEventListener('click', submitTest);
    document.getElementById('btn-reset-test').addEventListener('click', () => {
      practiceArea.hidden = true;
      practiceArea.innerHTML = '';
      currentTest = null;
    });
  }

  async function submitTest() {
    const questions = currentTest.questions;
    const answers = questions.map((q, i) => {
      if (q.type === 'multiple-choice') {
        const selected = document.querySelector(`input[name="q${i}"]:checked`);
        return selected ? selected.value : '';
      }
      const ta = document.querySelector(`textarea[data-q="${i}"]`);
      return ta ? ta.value : '';
    });

    // Disable button and show progress
    const btn = document.getElementById('btn-submit-test');
    if (btn) { btn.disabled = true; btn.textContent = 'Scoring...'; }

    try {
      // Send to score endpoint
      const resp = await fetch(SCORE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions, answers })
      });
      const result = await resp.json();

      // Re-render as review
      renderTestReview(questions, answers, result);

      // Save to KV for cross-device history
      try {
        await fetch(SAVE_RESULT_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentId,
            testId: currentTest.testId,
            topic: currentTest.topic,
            questions,
            answers,
            results: result.results,
            score: result.score,
            total: result.total,
            percentage: result.percentage,
          })
        });
      } catch {
        // Silent fail — review still shows
      }
    } catch {
      practiceArea.innerHTML = '<p>Could not score test. Try again.</p>';
    }
  }

  function renderTestReview(questions, answers, result) {
    const { results, score, total, percentage } = result;
    const gradeColor = percentage >= 80 ? '#4caf50' : percentage >= 50 ? '#ff9800' : '#e94560';

    practiceArea.innerHTML = `
      <div class="test-review">
        <div class="score-summary" style="border-color: ${gradeColor}">
          <div class="score-circle" style="background: ${gradeColor}">${percentage}%</div>
          <div class="score-details">
            <span class="score-fraction">${score} / ${total} correct</span>
            <span class="score-label">${percentage >= 80 ? 'Great work!' : percentage >= 50 ? 'Good effort — keep practising' : 'Keep studying — you\'ll improve!'}</span>
          </div>
        </div>
        <div class="review-questions">
          ${questions.map((q, i) => {
            const r = results[i];
            const icon = r.isCorrect ? '✅' : '❌';
            const optClass = r.isCorrect ? 'correct' : 'wrong';
            return `<div class="card review-question ${optClass}">
              <p><strong>Q${i+1}.</strong> ${escapeHtml(q.question)} <span class="review-icon">${icon}</span></p>
              ${q.type === 'multiple-choice'
                ? q.options.map(o => {
                    const isUser = answers[i] === o;
                    const isCorrect = o === r.correctAnswer;
                    let cls = 'mcq-option review-option';
                    if (isUser && isCorrect) cls += ' selected-correct';
                    else if (isUser && !isCorrect) cls += ' selected-wrong';
                    else if (!isUser && isCorrect) cls += ' missed-correct';
                    const marker = isUser ? (isCorrect ? ' ✓' : ' ✗') : (isCorrect ? ' ✓' : '');
                    return `<div class="${cls}">${escapeHtml(o)}${marker}</div>`;
                  }).join('')
                : `<div class="sa-review">
                     <div class="sa-user${r.isCorrect ? ' sa-correct' : ' sa-wrong'}">Your answer: ${escapeHtml(answers[i] || '(no answer)')}</div>
                     <div class="sa-correct-answer">Correct answer: ${escapeHtml(r.correctAnswer)}</div>
                   </div>`}
            </div>`;
          }).join('')}
        </div>
        <button class="btn-primary" id="btn-new-test">New Test</button>
        <button class="btn-secondary" id="btn-close-review" style="margin-left:0.5rem">Back to Start</button>
      </div>`;

    document.getElementById('btn-new-test').addEventListener('click', () => {
      currentTest = null;
      practiceArea.innerHTML = '';
      practiceArea.hidden = true;
    });
    document.getElementById('btn-close-review').addEventListener('click', () => {
      currentTest = null;
      practiceArea.innerHTML = '';
      practiceArea.hidden = true;
    });
  }

  // ── Dashboard ──
  async function loadDashboard() {
    try {
      // Load progress
      const resp = await fetch(PROGRESS_API);
      const data = await resp.json();

      if (data.mastery != null) document.querySelector('#card-mastery .card-body').textContent = data.mastery + '%';
      if (data.time_on_task != null) document.querySelector('#card-time .card-body').textContent = data.time_on_task + ' min';
      if (data.test_count != null) document.querySelector('#card-tests .card-body').textContent = data.test_count + ' tests';
      if (data.streak_days != null) document.querySelector('#card-streak .card-body').textContent = data.streak_days + ' days';

      // Mermaid charts
      const chartContainer = document.getElementById('chart-container');
      if (chartContainer) {
        const masteryMermaid = `xychart-beta
  title "Mastery by Strand"
  x-axis "Strand" ["Algebra", "Measurement", "Financial", "Statistics", "Networks"]
  y-axis "Mastery (%)" 0 --> 100
  bar [${data.mastery_chart ? data.mastery_chart : '20, 45, 60, 30, 15'}]`;
        chartContainer.innerHTML = `<div class="mermaid">${masteryMermaid.replace(/</g, '&lt;')}</div>`;
        if (typeof mermaid !== 'undefined') {
          mermaid.run({ nodes: [chartContainer.querySelector('.mermaid')] }).catch(() => {});
        }
      }

      // Load test history
      loadTestHistory();
    } catch { /* dashboard defaults */ }
  }

  async function loadTestHistory() {
    const container = document.querySelector('#card-tests .card-body');
    if (!container) return;

    try {
      const resp = await fetch(`${RESULTS_API}/${studentId}`);
      const data = await resp.json();
      const tests = data.tests || [];

      if (tests.length === 0) {
        container.innerHTML = 'No tests yet';
        return;
      }

      container.innerHTML = tests.length + ' tests';

      // Build history list after the dashboard cards
      const chartContainer = document.getElementById('chart-container');
      if (chartContainer) {
        const historyHtml = `
          <div class="test-history">
            <h3 style="color:var(--muted);font-size:0.9rem;margin:1rem 0 0.5rem 0">Test History (${tests.length})</h3>
            ${tests.slice().reverse().map(t => {
              const date = new Date(t.timestamp);
              const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const pctColor = t.percentage >= 80 ? '#4caf50' : t.percentage >= 50 ? '#ff9800' : '#e94560';
              return `<div class="history-entry" data-testid="${t.testId}">
                <div class="history-meta">
                  <span class="history-topic">${escapeHtml(t.topic)}</span>
                  <span class="history-date">${dateStr}</span>
                </div>
                <div class="history-score" style="color:${pctColor}">${t.score}/${t.total} (${t.percentage}%)</div>
              </div>`;
            }).join('')}
          </div>`;
        chartContainer.insertAdjacentHTML('afterend', historyHtml);

        // Add click handlers for history entries
        document.querySelectorAll('.history-entry').forEach(el => {
          el.addEventListener('click', () => {
            const testId = el.dataset.testid;
            if (testId) showTestResult(testId);
          });
        });
      }
    } catch {
      // History unavailable
    }
  }

  async function showTestResult(testId) {
    try {
      const resp = await fetch(`/api/tutor/math/test/${testId}`);
      const data = await resp.json();
      if (!data.questions || !data.results) return;

      // Switch to practice view and render review
      showView('practice');
      document.getElementById('practice-area').hidden = false;
      renderTestReview(data.questions, data.answers || [], {
        results: data.results,
        score: data.score,
        total: data.total,
        percentage: data.percentage,
      });
    } catch {
      // Could not load
    }
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
