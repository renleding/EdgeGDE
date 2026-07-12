/**
 * EdgeGDE — Personal Intelligence DB Web UI
 *
 * Serves a single-page HTML application at /doc-intel/ for managing
 * uploaded documents: list, search, upload, view extracted fields,
 * and manage custom key-value fields.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { html } from 'hono/html'

export const docIntelUiRouter = new Hono()

// ═══════════════════════════════════════════════════════════════════════════
// GET /doc-intel/ — serve the SPA
// ═══════════════════════════════════════════════════════════════════════════

docIntelUiRouter.get('/', (c) => {
  return c.html(html`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Personal Intelligence DB</title>
      <style>
        *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
        :root{
          --bg-base:#0a0a0f;
          --bg-surface:#12121a;
          --bg-elevated:#1a1a26;
          --bg-hover:#22223a;
          --border:#2a2a3e;
          --border-focus:#6366f1;
          --text-primary:#e8e8f0;
          --text-secondary:#9494a8;
          --text-muted:#6a6a80;
          --accent:#6366f1;
          --accent-hover:#7c7ff7;
          --accent-dim:#3b3d8a;
          --success:#22c55e;
          --warning:#eab308;
          --error:#ef4444;
          --info:#3b82f6;
          --radius:8px;
          --radius-sm:4px;
        }
        body{
          background:var(--bg-base);
          color:var(--text-primary);
          font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',sans-serif;
          font-size:14px;
          line-height:1.5;
          min-height:100vh;
        }
        .app{max-width:1200px;margin:0 auto;padding:24px}
        header{
          display:flex;align-items:center;justify-content:space-between;
          margin-bottom:28px;padding-bottom:16px;
          border-bottom:1px solid var(--border);
        }
        header h1{font-size:22px;font-weight:600;color:var(--text-primary)}
        header .sub{font-size:12px;color:var(--text-secondary);margin-top:2px}
        .header-actions{display:flex;gap:8px;align-items:center}

        /* ── Search bar ─────────────────────────────────────────────── */
        .search-row{
          display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;
        }
        .search-row input,.search-row select{
          background:var(--bg-surface);border:1px solid var(--border);
          color:var(--text-primary);padding:8px 12px;border-radius:var(--radius);
          font-size:13px;outline:none;transition:border-color .15s;
        }
        .search-row input:focus,.search-row select:focus{
          border-color:var(--border-focus);
        }
        .search-row input{flex:1;min-width:200px}
        .search-row input::placeholder{color:var(--text-muted)}
        .search-row select{min-width:140px}

        /* ── Buttons ────────────────────────────────────────────────── */
        .btn{
          display:inline-flex;align-items:center;gap:6px;
          padding:8px 16px;border-radius:var(--radius);font-size:13px;
          font-weight:500;cursor:pointer;border:1px solid transparent;
          transition:all .15s;white-space:nowrap;
        }
        .btn-primary{
          background:var(--accent);color:#fff;border-color:var(--accent);
        }
        .btn-primary:hover{background:var(--accent-hover);border-color:var(--accent-hover)}
        .btn-secondary{
          background:var(--bg-elevated);color:var(--text-primary);border-color:var(--border);
        }
        .btn-secondary:hover{background:var(--bg-hover);border-color:var(--border-focus)}
        .btn-sm{padding:5px 10px;font-size:12px}
        .btn-icon{width:32px;height:32px;padding:0;display:flex;align-items:center;justify-content:center}

        /* ── Table ──────────────────────────────────────────────────── */
        .table-wrap{
          background:var(--bg-surface);border:1px solid var(--border);
          border-radius:var(--radius);overflow:hidden;
        }
        table{width:100%;border-collapse:collapse}
        thead th{
          text-align:left;padding:10px 14px;font-size:11px;font-weight:600;
          text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);
          background:var(--bg-elevated);border-bottom:1px solid var(--border);
        }
        tbody tr{
          border-bottom:1px solid var(--border);cursor:pointer;
          transition:background .1s;
        }
        tbody tr:last-child{border-bottom:none}
        tbody tr:hover{background:var(--bg-hover)}
        tbody td{padding:10px 14px;font-size:13px}
        .col-filename{color:var(--text-primary);font-weight:500}
        .col-type{color:var(--text-secondary);font-size:12px}
        .col-date{color:var(--text-muted);font-size:12px;white-space:nowrap}
        .col-conf{text-align:right;font-variant-numeric:tabular-nums}

        /* ── Status badges ──────────────────────────────────────────── */
        .badge{
          display:inline-flex;align-items:center;gap:4px;
          padding:2px 8px;border-radius:999px;font-size:11px;font-weight:500;
        }
        .badge-completed{background:#162b1a;color:var(--success)}
        .badge-completed_with_warnings{background:#2b2416;color:var(--warning)}
        .badge-pending,.badge-processing{background:#1a1f36;color:var(--info)}
        .badge-failed{background:#2b1616;color:var(--error)}
        .badge-default{background:var(--bg-elevated);color:var(--text-muted)}

        /* ── Empty state ────────────────────────────────────────────── */
        .empty-state{
          text-align:center;padding:48px 24px;color:var(--text-muted);
        }
        .empty-state .icon{font-size:40px;margin-bottom:12px;opacity:.4}
        .empty-state p{font-size:14px}
        .empty-state .sub{font-size:12px;margin-top:4px}

        /* ── Loading ────────────────────────────────────────────────── */
        .loading-row td{text-align:center;padding:24px;color:var(--text-muted)}
        .spinner{display:inline-block;width:18px;height:18px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle;margin-right:8px}
        @keyframes spin{to{transform:rotate(360deg)}}

        /* ── Detail panel ───────────────────────────────────────────── */
        .detail-overlay{
          position:fixed;inset:0;background:rgba(0,0,0,.6);
          display:flex;align-items:flex-start;justify-content:center;
          padding:48px 16px;z-index:100;overflow-y:auto;
          opacity:0;pointer-events:none;transition:opacity .2s;
        }
        .detail-overlay.open{opacity:1;pointer-events:auto}
        .detail-panel{
          background:var(--bg-surface);border:1px solid var(--border);
          border-radius:var(--radius);max-width:640px;width:100%;
          padding:24px;position:relative;margin-top:auto;margin-bottom:auto;
          box-shadow:0 20px 60px rgba(0,0,0,.5);
        }
        .detail-panel h2{font-size:16px;font-weight:600;margin-bottom:4px;padding-right:32px}
        .detail-panel .meta{font-size:12px;color:var(--text-secondary);margin-bottom:16px}
        .detail-close{
          position:absolute;top:16px;right:16px;background:none;border:none;
          color:var(--text-muted);font-size:20px;cursor:pointer;width:28px;height:28px;
          display:flex;align-items:center;justify-content:center;border-radius:var(--radius-sm);
        }
        .detail-close:hover{background:var(--bg-hover);color:var(--text-primary)}
        .detail-section{margin-bottom:20px}
        .detail-section h3{
          font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;
          color:var(--text-muted);margin-bottom:8px;padding-bottom:6px;
          border-bottom:1px solid var(--border);
        }
        .field-grid{display:grid;grid-template-columns:1fr;gap:4px}
        .field-row{
          display:flex;justify-content:space-between;align-items:center;
          padding:6px 8px;border-radius:var(--radius-sm);
          background:var(--bg-elevated);font-size:13px;
        }
        .field-row .name{color:var(--text-secondary);font-weight:500}
        .field-row .value{color:var(--text-primary);font-family:'SF Mono','Fira Code','Consolas',monospace;font-size:12px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .detail-section .empty-note{font-size:12px;color:var(--text-muted);font-style:italic}

        /* ── Custom fields editor ───────────────────────────────────── */
        .custom-field-form{display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap}
        .custom-field-form input{
          background:var(--bg-elevated);border:1px solid var(--border);
          color:var(--text-primary);padding:6px 10px;border-radius:var(--radius-sm);
          font-size:13px;outline:none;flex:1;min-width:100px;
        }
        .custom-field-form input:focus{border-color:var(--border-focus)}
        .custom-field-form input::placeholder{color:var(--text-muted)}
        .custom-field-form .btn{padding:6px 12px}
        .custom-fields-list{display:flex;flex-direction:column;gap:4px}
        .custom-field-item{
          display:flex;align-items:center;gap:6px;
          padding:6px 8px;background:var(--bg-elevated);border-radius:var(--radius-sm);
        }
        .custom-field-item .cf-key{font-weight:500;color:var(--accent);font-size:12px;min-width:80px}
        .custom-field-item .cf-val{color:var(--text-primary);font-size:12px;flex:1;word-break:break-all}
        .custom-field-item .cf-del{
          background:none;border:none;color:var(--text-muted);cursor:pointer;
          font-size:14px;padding:2px 4px;border-radius:var(--radius-sm);line-height:1;
        }
        .custom-field-item .cf-del:hover{color:var(--error);background:var(--bg-hover)}

        /* ── Upload overlay ─────────────────────────────────────────── */
        .upload-overlay{
          position:fixed;inset:0;background:rgba(0,0,0,.6);
          display:flex;align-items:center;justify-content:center;z-index:99;
          opacity:0;pointer-events:none;transition:opacity .2s;
        }
        .upload-overlay.open{opacity:1;pointer-events:auto}
        .upload-panel{
          background:var(--bg-surface);border:1px solid var(--border);
          border-radius:var(--radius);padding:32px;max-width:420px;width:90%;
          text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5);
        }
        .upload-panel h2{font-size:16px;font-weight:600;margin-bottom:8px}
        .upload-panel p{font-size:13px;color:var(--text-secondary);margin-bottom:20px}
        .upload-panel .drop-zone{
          border:2px dashed var(--border);border-radius:var(--radius);
          padding:32px;cursor:pointer;transition:border-color .15s,background .15s;
        }
        .upload-panel .drop-zone:hover,.upload-panel .drop-zone.dragover{
          border-color:var(--accent);background:var(--bg-elevated);
        }
        .upload-panel .drop-zone .icon{font-size:36px;margin-bottom:8px;opacity:.5}
        .upload-panel .drop-zone p{font-size:13px;margin-bottom:0}
        .upload-panel .drop-zone .hint{font-size:11px;color:var(--text-muted);margin-top:4px}
        .upload-panel .progress-bar{
          height:4px;background:var(--bg-elevated);border-radius:2px;margin:16px 0;overflow:hidden;display:none;
        }
        .upload-panel .progress-bar .fill{
          height:100%;background:var(--accent);border-radius:2px;transition:width .3s;width:0%;
        }
        .upload-panel .upload-status{font-size:12px;color:var(--text-secondary);margin-bottom:12px;min-height:18px}

        /* ── Toast ──────────────────────────────────────────────────── */
        .toast-container{position:fixed;bottom:24px;right:24px;z-index:200;display:flex;flex-direction:column;gap:8px}
        .toast{
          padding:10px 16px;border-radius:var(--radius);font-size:13px;
          box-shadow:0 8px 24px rgba(0,0,0,.4);animation:slideIn .25s ease-out;
          max-width:360px;
        }
        .toast-success{background:#162b1a;border:1px solid #22c55e44;color:var(--success)}
        .toast-error{background:#2b1616;border:1px solid #ef444444;color:var(--error)}
        .toast-info{background:#1a1f36;border:1px solid #3b82f644;color:var(--info)}
        @keyframes slideIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}

        /* ── Scrollbar ──────────────────────────────────────────────── */
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
        ::-webkit-scrollbar-thumb:hover{background:var(--text-muted)}

        /* ── Responsive ─────────────────────────────────────────────── */
        @media(max-width:768px){
          .app{padding:16px}
          header{flex-direction:column;align-items:flex-start;gap:12px}
          .header-actions{width:100%}
          .header-actions .btn{flex:1;justify-content:center}
          .table-wrap{overflow-x:auto}
          table{min-width:600px}
          .detail-panel{margin:0;border-radius:0;min-height:100vh;padding:16px}
          .detail-overlay{padding:0}
        }
      </style>
    </head>
    <body>
      <div class="app" id="app">
        <header>
          <div>
            <h1>Personal Intelligence DB</h1>
            <div class="sub">Document management &amp; field extraction</div>
          </div>
          <div class="header-actions">
            <button class="btn btn-primary" onclick="openUpload()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Upload
            </button>
            <button class="btn btn-secondary btn-sm" onclick="refresh()">↻ Refresh</button>
          </div>
        </header>

        <div class="search-row">
          <input type="text" id="searchQuery" placeholder="Search by filename…" oninput="filterTable()">
          <select id="searchType" onchange="filterTable()">
            <option value="">All types</option>
            <option value="passport">Passport</option>
            <option value="licence">Licence</option>
            <option value="medicare">Medicare</option>
            <option value="payslip">Payslip</option>
            <option value="bank_statement">Bank Statement</option>
          </select>
          <span id="docCount" style="font-size:12px;color:var(--text-muted);align-self:center"></span>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Filename</th>
                <th>Type</th>
                <th>Status</th>
                <th style="text-align:right">Confidence</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody id="docTableBody">
              <tr class="loading-row"><td colspan="5"><span class="spinner"></span>Loading documents…</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ── Upload modal ──────────────────────────────────────────── -->
      <div class="upload-overlay" id="uploadOverlay">
        <div class="upload-panel">
          <h2>Upload Document</h2>
          <p>Upload a document for OCR and field extraction</p>
          <div class="drop-zone" id="dropZone" onclick="document.getElementById('fileInput').click()">
            <div class="icon">📄</div>
            <p>Click to browse or drag &amp; drop</p>
            <div class="hint">PDF, PNG, JPG, TIFF — up to 20MB</div>
          </div>
          <input type="file" id="fileInput" accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif" style="display:none" onchange="handleFileSelect(event)">
          <div class="progress-bar" id="progressBar"><div class="fill" id="progressFill"></div></div>
          <div class="upload-status" id="uploadStatus"></div>
          <div style="display:flex;gap:6px;justify-content:center;margin-top:12px">
            <button class="btn btn-secondary" onclick="closeUpload()">Cancel</button>
          </div>
        </div>
      </div>

      <!-- ── Detail modal ──────────────────────────────────────────── -->
      <div class="detail-overlay" id="detailOverlay">
        <div class="detail-panel" id="detailPanel">
          <button class="detail-close" onclick="closeDetail()">✕</button>
          <div id="detailContent"></div>
        </div>
      </div>

      <!-- ── Toast container ───────────────────────────────────────── -->
      <div class="toast-container" id="toastContainer"></div>

      <script>
        // ── State ──────────────────────────────────────────────────────
        let documents = [];
        let customFields = {};

        // ── Init ───────────────────────────────────────────────────────
        window.onload = function() { refresh(); try { setupDragDrop(); } catch(e) {} };

        // ── Refresh ────────────────────────────────────────────────────
        async function refresh() {
          const tbody = document.getElementById('docTableBody');
          tbody.innerHTML = '<tr class="loading-row"><td colspan="5"><span class="spinner"></span>Loading documents…</td></tr>';
          documents = [];
          customFields = {};
          try {
            const res = await fetch('/api/v1/doc-intel/documents', {
              headers: { 'x-tenant': 'personal' }
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            documents = data.documents || data.data || data || [];
            if (!Array.isArray(documents)) documents = [];
          } catch (e) {
            try { showToast('Failed to load documents: ' + (e instanceof Error ? e.message : String(e)), 'error'); } catch(_) {}
          }
          try { renderTable(); } catch(_) {}
        }

        // ── Render table ───────────────────────────────────────────────
        function renderTable() {
          const tbody = document.getElementById('docTableBody');
          const query = (document.getElementById('searchQuery').value || '').toLowerCase();
          const typeFilter = document.getElementById('searchType').value;

          const filtered = documents.filter(d => {
            const name = (d.filename_display || '').toLowerCase();
            const type = (d.document_type || '');
            if (query && !name.includes(query)) return false;
            if (typeFilter && type !== typeFilter) return false;
            return true;
          });

          document.getElementById('docCount').textContent = filtered.length + ' / ' + documents.length + ' documents';

          if (filtered.length === 0) {
            if (documents.length === 0) {
              tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="icon">📄</div><p>No documents yet</p><div class="sub">Click +Upload to add your first document to the OCR pipeline</div></div></td></tr>';
            } else {
              tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="icon">🔍</div><p>No documents match your search</p><div class="sub">Try a different search term or clear the filter</div></div></td></tr>';
            }
            return;
          }

          tbody.innerHTML = filtered.map(d => {
            const status = d.ocr_status || 'pending';
            const statusLabel = status.replace(/_/g, ' ').replace(/\\b\\w/g, l => l.toUpperCase());
            const badgeClass = 'badge-' + (status === 'completed' ? 'completed' : status === 'completed_with_warnings' ? 'completed_with_warnings' : status === 'failed' ? 'failed' : (status === 'pending' || status === 'processing') ? 'pending' : 'default');
            const conf = d.confidence != null ? (d.confidence * 100).toFixed(0) + '%' : '—';
            const date = d.created_at ? new Date(d.created_at).toLocaleDateString('en-AU', { day:'2-digit', month:'short', year:'numeric' }) : '—';
            return '<tr onclick="openDetail(\'' + d.document_id + '\')">' +
              '<td class="col-filename">' + esc(d.filename_display || 'Untitled') + '</td>' +
              '<td class="col-type">' + esc(formatType(d.document_type || '')) + '</td>' +
              '<td><span class="badge ' + badgeClass + '">' + statusLabel + '</span></td>' +
              '<td style="text-align:right">' + conf + '</td>' +
              '<td class="col-date">' + date + '</td>' +
              '</tr>';
          }).join('');
        }

        function filterTable() { renderTable(); }

        // ── Helpers ────────────────────────────────────────────────────
        function esc(s) {
          const div = document.createElement('div');
          div.textContent = s;
          return div.innerHTML;
        }

        function formatType(t) {
          const map = { passport:'Passport', licence:'Licence', medicare:'Medicare', payslip:'Payslip', bank_statement:'Bank Statement' };
          return map[t] || t.replace(/_/g, ' ').replace(/\\b\\w/g, l => l.toUpperCase());
        }

        // ── Detail panel ───────────────────────────────────────────────
        async function openDetail(docId) {
          const overlay = document.getElementById('detailOverlay');
          const content = document.getElementById('detailContent');
          content.innerHTML = '<p style="text-align:center;padding:24px;color:var(--text-muted)"><span class="spinner"></span>Loading…</p>';
          overlay.classList.add('open');

          const doc = documents.find(d => d.document_id === docId);
          if (!doc) {
            content.innerHTML = '<p style="color:var(--error)">Document not found</p>';
            return;
          }

          // Fetch extracted fields
          let fields = [];
          let ocrText = '';
          if (doc.fields_r2_key) {
            try {
              const fRes = await fetch('/api/v1/doc-intel/documents/download?r2_key=' + encodeURIComponent(doc.fields_r2_key), {
                headers: { 'x-tenant': 'personal' }
              });
              if (fRes.ok) {
                const fData = await fRes.json();
                fields = fData.fields || fData.data || (Array.isArray(fData) ? fData : []);
                if (!Array.isArray(fields)) fields = [];
              }
            } catch {}
          }
          if (doc.ocr_r2_key) {
            try {
              const oRes = await fetch('/api/v1/doc-intel/documents/download?r2_key=' + encodeURIComponent(doc.ocr_r2_key), {
                headers: { 'x-tenant': 'personal' }
              });
              if (oRes.ok) ocrText = await oRes.text();
            } catch {}
          }

          const status = doc.ocr_status || 'pending';
          const statusLabel = status.replace(/_/g, ' ').replace(/\\b\\w/g, l => l.toUpperCase());
          const badgeClass = 'badge-' + (status === 'completed' ? 'completed' : status === 'completed_with_warnings' ? 'completed_with_warnings' : status === 'failed' ? 'failed' : 'pending');
          const date = doc.created_at ? new Date(doc.created_at).toLocaleString('en-AU') : '—';
          const conf = doc.confidence != null ? (doc.confidence * 100).toFixed(1) + '%' : '—';

          // Load custom fields for this doc
          const stored = localStorage.getItem('customFields_' + docId);
          const docCustomFields = stored ? JSON.parse(stored) : [];

          content.innerHTML = '<h2>' + esc(doc.filename_display || 'Untitled') + '</h2>' +
            '<div class="meta">' +
            '  <span class="badge ' + badgeClass + '">' + statusLabel + '</span>' +
            '  &nbsp;·&nbsp; ' + formatType(doc.document_type || '') +
            '  &nbsp;·&nbsp; Confidence: ' + conf +
            '  &nbsp;·&nbsp; ' + date +
            '</div>' +
            // Extracted fields
            '<div class="detail-section">' +
            '  <h3>Extracted Fields</h3>' +
            '  <div class="field-grid">' +
            (fields.length === 0
              ? '<div class="empty-note">No extracted fields available</div>'
              : fields.map(f =>
                  '<div class="field-row"><span class="name">' + esc(f.name || f.field || '?') + '</span><span class="value">' + esc(f.value || '') + '</span></div>'
                ).join('')
            ) +
            '  </div>' +
            '</div>' +
            // Custom fields
            '<div class="detail-section">' +
            '  <h3>Custom Fields</h3>' +
            '  <div class="custom-fields-list" id="customFieldsList">' +
            (docCustomFields.length === 0
              ? '<div class="empty-note" id="noCustomNote">No custom fields added yet</div>'
              : docCustomFields.map((f, i) =>
                  '<div class="custom-field-item" id="cf-item-' + i + '">' +
                  '  <span class="cf-key">' + esc(f.key) + '</span>' +
                  '  <span class="cf-val">' + esc(f.value) + '</span>' +
                  '  <button class="cf-del" onclick="deleteCustomField(\'' + docId + '\',' + i + ')" title="Delete">✕</button>' +
                  '</div>'
                ).join('')
            ) +
            '  </div>' +
            '  <form class="custom-field-form" onsubmit="addCustomField(event, \'' + docId + '\')">' +
            '    <input type="text" id="cfKeyInput" placeholder="Key" required>' +
            '    <input type="text" id="cfValInput" placeholder="Value" required>' +
            '    <button class="btn btn-primary btn-sm" type="submit">+ Add</button>' +
            '  </form>' +
            '</div>' +
            // OCR preview
            (ocrText
              ? '<div class="detail-section">' +
                '  <h3>OCR Text Preview</h3>' +
                '  <pre style="font-size:11px;color:var(--text-secondary);background:var(--bg-elevated);padding:8px;border-radius:var(--radius-sm);max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-word">' + esc(ocrText.substring(0, 2000)) + (ocrText.length > 2000 ? '...' : '') + '</pre>' +
                '</div>'
              : ''
            );
        }

        function closeDetail() {
          document.getElementById('detailOverlay').classList.remove('open');
        }

        // Close detail on overlay click
        document.getElementById('detailOverlay').addEventListener('click', (e) => {
          if (e.target === e.currentTarget) closeDetail();
        });

        // ── Custom fields ──────────────────────────────────────────────
        function addCustomField(event, docId) {
          event.preventDefault();
          const key = document.getElementById('cfKeyInput').value.trim();
          const value = document.getElementById('cfValInput').value.trim();
          if (!key || !value) return;

          const stored = localStorage.getItem('customFields_' + docId);
          const fields = stored ? JSON.parse(stored) : [];
          fields.push({ key, value });
          localStorage.setItem('customFields_' + docId, JSON.stringify(fields));

          document.getElementById('cfKeyInput').value = '';
          document.getElementById('cfValInput').value = '';

          // Attempt to persist via PUT endpoint (may not exist yet)
          persistCustomFields(docId, fields);

          // Re-render
          openDetail(docId);
          showToast('Custom field added', 'success');
        }

        function deleteCustomField(docId, index) {
          const stored = localStorage.getItem('customFields_' + docId);
          if (!stored) return;
          const fields = JSON.parse(stored);
          fields.splice(index, 1);
          localStorage.setItem('customFields_' + docId, JSON.stringify(fields));

          persistCustomFields(docId, fields);
          openDetail(docId);
          showToast('Custom field deleted', 'info');
        }

        async function persistCustomFields(docId, fields) {
          try {
            await fetch('/api/v1/doc-intel/documents/' + encodeURIComponent(docId) + '/custom-fields', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'x-tenant': 'personal' },
              body: JSON.stringify({ fields }),
            });
          } catch {
            // Endpoint may not exist yet — fail gracefully
          }
        }

        // ── Upload ─────────────────────────────────────────────────────
        function openUpload() {
          document.getElementById('uploadOverlay').classList.add('open');
          document.getElementById('uploadStatus').textContent = '';
          document.getElementById('progressBar').style.display = 'none';
          document.getElementById('fileInput').value = '';
        }

        function closeUpload() {
          document.getElementById('uploadOverlay').classList.remove('open');
        }

        document.getElementById('uploadOverlay').addEventListener('click', (e) => {
          if (e.target === e.currentTarget) closeUpload();
        });

        function setupDragDrop() {
          const dz = document.getElementById('dropZone');
          dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
          dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
          dz.addEventListener('drop', (e) => {
            e.preventDefault();
            dz.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) uploadFile(files[0]);
          });
        }

        function handleFileSelect(event) {
          const file = event.target.files[0];
          if (file) uploadFile(file);
        }

        async function uploadFile(file) {
          if (file.size > 20 * 1024 * 1024) {
            showToast('File too large. Maximum 20MB.', 'error');
            return;
          }

          const status = document.getElementById('uploadStatus');
          const bar = document.getElementById('progressBar');
          const fill = document.getElementById('progressFill');
          bar.style.display = 'block';
          fill.style.width = '0%';
          status.textContent = 'Uploading ' + file.name + '…';

          const formData = new FormData();
          formData.append('file', file);

          // use XMLHttpRequest for progress tracking
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/api/v1/doc-intel/ingest');
          xhr.setRequestHeader('x-tenant', 'personal');

          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 100);
              fill.style.width = pct + '%';
            }
          });

          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              status.textContent = 'Upload complete! Refreshing…';
              fill.style.width = '100%';
              showToast('Document uploaded successfully', 'success');
              setTimeout(() => { closeUpload(); refresh(); }, 500);
            } else {
              let msg = 'Upload failed';
              try { const j = JSON.parse(xhr.responseText); msg = j.error || j.message || msg; } catch {}
              status.textContent = msg;
              bar.style.display = 'none';
              showToast(msg, 'error');
            }
          });

          xhr.addEventListener('error', () => {
            status.textContent = 'Network error';
            bar.style.display = 'none';
            showToast('Network error during upload', 'error');
          });

          xhr.send(formData);
        }

        // ── Toast ──────────────────────────────────────────────────────
        function showToast(msg, type) {
          const container = document.getElementById('toastContainer');
          const el = document.createElement('div');
          el.className = 'toast toast-' + (type || 'info');
          el.textContent = msg;
          container.appendChild(el);
          setTimeout(() => {
            el.style.opacity = '0';
            el.style.transition = 'opacity .3s';
            setTimeout(() => el.remove(), 300);
          }, 3500);
        }
      </script>
    </body>
    </html>
  `)
})
