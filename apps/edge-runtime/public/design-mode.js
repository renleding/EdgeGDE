/**
 * Orca Design Mode — in-page picker, capture and resolver transport (IDD-016).
 *
 * Runs inside the EdgeGDE admin console tab. Provides:
 *  - Design Mode toggle (floating button) and click-to-pick overlay
 *  - On pick: schema-conformant capture payload assembly (in-page fields)
 *  - Delivery to the Orca CDP capture controller when present
 *    (window.__orcaDesignModePick binding — raw CDP §6.2 recipe upgrades the
 *    payload with the exact backendDOMNodeId, DOM.getOuterHTML snapshot,
 *    CSS.getComputedStyleForNode subset, box-model geometry and a
 *    Page.captureScreenshot clip), else same-origin POST /design-mode/resolve
 *  - Portal-safe: Radix portal elements (body-level roots outside the React
 *    tree) are picked and classified like any other node
 *  - Status surfacing: capture status, transport errors, resolver response
 *  - Action confirmation loop (IDD-016 §13.1 item 7): after the Orca CDP
 *    controller executes a bridged action and hot-reloads the tab, this
 *    script re-exposes __orcaDesignModeRenderConfirmation and renders the
 *    before/after + verdict panel (Design Mode state survives the reload
 *    via sessionStorage)
 *
 * Capture never mutates the page (IDD-016 §11 invariant 9). The overlay is
 * the Design Mode feature UI itself and is fully removed on disable.
 *
 * Contract: docs/IDD-016-orca-resolver-bridge-v1.md
 * Schema:   packages/orca-resolver-bridge/schemas/orca-resolver-request.schema.json
 */
(function () {
  'use strict';

  var CONTRACT_VERSION = '1.0.0';
  var MAX_OUTER_HTML = 200000;   // §6.6
  var MAX_TEXT_CONTENT = 2000;   // §6.6
  var STYLE_KEYS = [             // §6.3 frozen subset
    'display', 'visibility', 'opacity', 'pointer-events', 'cursor',
    'color', 'background-color', 'font-size', 'font-weight', 'text-align'
  ];
  var ORCA_ROOT_ID = 'orca-design-mode-root';

  // Scoped styles for the confirmation panel. Injected by the script itself
  // so the panel is readable on ANY page (admin console or bare fixture),
  // not only on the page that ships the admin stylesheet.
  var CONFIRM_STYLES =
    '.orca-confirm-card{position:fixed;top:14px;right:14px;z-index:2147483647;width:min(460px,92vw);' +
    'max-height:82vh;overflow:auto;background:#161b22;border:1px solid #2d3140;border-radius:8px;' +
    'box-shadow:0 8px 30px rgba(0,0,0,.5);color:#e1e4e8;font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
    '.orca-confirm-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;' +
    'border-bottom:1px solid #2d3140;position:sticky;top:0;background:#161b22}' +
    '.orca-confirm-title{font-weight:600;color:#f0f6fc;font-size:13px}' +
    '.orca-confirm-dismiss{background:none;border:1px solid #2d3140;color:#8b949e;border-radius:6px;cursor:pointer;padding:2px 8px;font-size:12px}' +
    '.orca-confirm-dismiss:hover{color:#e1e4e8;border-color:#4a4d55}' +
    '.orca-confirm-body{padding:10px 12px}' +
    '.orca-confirm-verdict{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}' +
    '.orca-confirm-verdict .verdict-text{font-size:13px;font-weight:600}' +
    '.orca-confirm-verdict .verdict-text.ok{color:#3fb950}' +
    '.orca-confirm-verdict .verdict-text.bad{color:#f85149}' +
    '.orca-confirm-verdict .verdict-text.warn{color:#d29922}' +
    '.orca-confirm-verdict .verdict-text.muted{color:#8b949e}' +
    '.orca-confirm-note{font-size:11px;color:#d29922;background:#2d2716;border:1px solid #d2992240;border-radius:6px;padding:6px 8px;margin:6px 0}' +
    '.orca-confirm-shots{display:flex;gap:10px;margin:8px 0}' +
    '.orca-confirm-shot{flex:1;min-width:0}' +
    '.orca-confirm-shot figcaption{font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}' +
    '.orca-confirm-shot img{max-width:100%;height:auto;display:block;border:1px solid #2d3140;border-radius:4px;background:#0d1117}' +
    '.orca-confirm-shot-missing{border:1px dashed #2d3140;border-radius:4px;padding:14px;color:#8b949e;font-size:11px;text-align:center}' +
    '.orca-confirm-section{margin:8px 0}' +
    '.orca-confirm-section h4{font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;margin:0 0 4px}' +
    '.orca-confirm-kv{display:flex;gap:8px;margin:3px 0;font-size:12px}' +
    '.orca-confirm-kv .k{color:#8b949e;min-width:130px}' +
    '.orca-confirm-kv .v{color:#e1e4e8;word-break:break-all}' +
    '.orca-confirm-actions{display:flex;gap:8px;margin-top:10px}' +
    '.orca-confirm-actions button{background:#1c2128;color:#e1e4e8;border:1px solid #2d3140;border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer}' +
    '.orca-confirm-actions button:hover{background:#2d3140}' +
    '.orca-confirm-error{border:1px solid #da363340;background:#2d1616;border-radius:6px;padding:8px;margin:6px 0}' +
    '.orca-confirm-error .code{color:#f85149;font-weight:600}' +
    '.orca-confirm pre{background:#0d1117;border:1px solid #2d3140;border-radius:6px;padding:8px;overflow:auto;max-height:180px;font-size:10px}' +
    '.orca-confirm .flag{display:inline-block;background:#d2992220;color:#d29922;border:1px solid #d29922;border-radius:10px;padding:1px 8px;font-size:10px;margin:2px 4px 2px 0}';

  var STATE = {
    active: false,
    root: null,
    overlay: null,
    highlight: null,
    requestId: null,
    lastPayload: null,
    lastResponse: null,
    lastConfirmation: null,
    executing: false,
    handlersInstalled: false
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Small utilities
  // ──────────────────────────────────────────────────────────────────────────

  function uuidv4() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function $(id) { return document.getElementById(id); }

  function log(level, message) {
    var logEl = $('transportLog');
    if (!logEl) return;
    var entry = document.createElement('div');
    entry.className = 'log-entry ' + level;
    entry.textContent = '[' + nowISO() + '] ' + message;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
    while (logEl.children.length > 100) logEl.removeChild(logEl.firstChild);
  }

  function setStatus(elementId, message, type) {
    var el = $(elementId);
    if (!el) return;
    var dotClass = type === 'error' ? 'error' : type === 'success' ? 'active' : type === 'warning' ? 'pending' : 'inactive';
    el.className = 'overlay-info' + (type === 'error' ? ' error' : type === 'warning' ? ' warning' : '');
    el.innerHTML = '<span class="status-dot ' + dotClass + '"></span> ' + escapeHtml(message);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function syntaxHighlight(json) {
    return escapeHtml(json)
      .replace(/(&quot;(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\&]*?)&quot;)(\s*:)?/g, function (m, str, _g, colon) {
        return colon ? '<span class="key">' + str + '</span>:' : '<span class="string">' + str + '</span>';
      })
      .replace(/\b(\d+\.?\d*)\b/g, '<span class="number">$1</span>')
      .replace(/\b(true|false)\b/g, '<span class="boolean">$1</span>')
      .replace(/\bnull\b/g, '<span class="boolean">null</span>');
  }

  function showTab(name) {
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
    document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
    document.querySelectorAll('.tab').forEach(function (t) {
      if (t.getAttribute('data-tab') === name) t.classList.add('active');
    });
    var panel = $('tab-' + name);
    if (panel) panel.classList.add('active');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // In-page capture (fields that do not require CDP)
  // ──────────────────────────────────────────────────────────────────────────

  function siblingIndex(el) {
    var p = el.parentElement;
    if (!p) return 1;
    var n = 0;
    for (var i = 0; i < p.children.length; i++) {
      if (p.children[i].tagName === el.tagName) {
        n++;
        if (p.children[i] === el) return n;
      }
    }
    return 1;
  }

  function seg(el) {
    var o = { tag: el.tagName.toLowerCase(), index: siblingIndex(el) };
    if (el.id) o.id = el.id;
    var cls = [];
    for (var i = 0; i < el.classList.length; i++) {
      var c = el.classList[i];
      if (c && c.indexOf('orca-') !== 0) cls.push(c);
    }
    if (cls.length) o.classes = cls;
    return o;
  }

  function ancestorPath(el) {
    var path = [];
    var cur = el.parentElement;
    while (cur) {
      path.push(seg(cur));
      if (cur.tagName === 'HTML') break;
      cur = cur.parentElement;
    }
    if (!path.length || path[path.length - 1].tag !== 'html') {
      path.push({ tag: 'html', index: 1 });
    }
    if (path.length > 8) path = path.slice(0, 7).concat([{ tag: 'html', index: 1 }]);
    return path;
  }

  function structuralHashSegments(path, elementSeg) {
    var parts = path.map(function (s) { return s.tag + ':' + s.index + ':' + (s.id || ''); });
    parts.push(elementSeg.tag + ':' + elementSeg.index + ':' + (elementSeg.id || ''));
    return parts.join('|');
  }

  function sha256Hex(text) {
    var buf = new TextEncoder().encode(text);
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      return crypto.subtle.digest('SHA-256', buf).then(function (b) {
        return Array.from(new Uint8Array(b)).map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
      });
    }
    return Promise.resolve('');
  }

  function computedStyles(el) {
    var cs = window.getComputedStyle(el);
    var out = {};
    STYLE_KEYS.forEach(function (k) { out[k] = cs.getPropertyValue(k); });
    return out;
  }

  function relevantAttributes(el) {
    var keys = ['id', 'name', 'class', 'type', 'placeholder', 'aria-label', 'aria-describedby', 'role', 'href', 'title', 'data-testid'];
    var out = {};
    keys.forEach(function (k) {
      var v = el.getAttribute(k);
      if (v) out[k] = v;
    });
    return out;
  }

  function isAppRoot(el) {
    if (!el || el.tagName !== 'DIV') return false;
    var appRootIds = ['root', 'app', '__next', 'next', '___gatsby', 'gatsby-focus-wrapper'];
    if (appRootIds.indexOf(el.id) !== -1) return true;
    if (el.hasAttribute('data-reactroot')) return true;
    for (var i = 0; i < el.classList.length; i++) {
      if (el.classList[i] === 'app-root') return true;
    }
    return false;
  }

  /**
   * §6.2 portal classification. Radix portals attach at body-level roots
   * outside the main React tree. Markers: [data-radix-portal], [data-portal],
   * .portal-root / .radix-portal-root, or a body-level div outside the app root.
   */
  function portalInfo(el) {
    var cur = el.parentElement;
    while (cur) {
      if (cur.hasAttribute('data-radix-portal')) {
        return { in_portal: true, portal_root_hint: 'div[data-radix-portal]' };
      }
      if (cur.hasAttribute('data-portal')) {
        return { in_portal: true, portal_root_hint: 'div[data-portal]' };
      }
      if (cur.parentElement && cur.parentElement.tagName === 'BODY' && !isAppRoot(cur)) {
        var cls = Array.from(cur.classList);
        if (cls.indexOf('portal-root') !== -1 || cls.indexOf('radix-portal-root') !== -1) {
          return { in_portal: true, portal_root_hint: 'body > div.' + cls.join('.') };
        }
        // Body-level div that is not the app root → Radix-style portal container.
        var hint = 'body > div:nth-child(' + (Array.prototype.indexOf.call(cur.parentElement.children, cur) + 1) + ')';
        if (cur.id) hint = 'body > div#' + cur.id;
        else if (cls.length) hint = 'body > div.' + cls.join('.');
        return { in_portal: true, portal_root_hint: hint };
      }
      cur = cur.parentElement;
    }
    return { in_portal: false, portal_root_hint: null };
  }

  function truncateOuterHtml(html) {
    if (html.length <= MAX_OUTER_HTML) return { html: html, truncated: false };
    var cut = html.substring(0, MAX_OUTER_HTML);
    var last = cut.lastIndexOf('>');
    if (last > 0) cut = cut.substring(0, last + 1);
    return { html: cut, truncated: true };
  }

  function placeholderScreenshot(el) {
    // Standalone (no CDP controller) preview only. The Orca CDP controller
    // replaces this with a real Page.captureScreenshot clip per §6.2 step 7.
    var rect = el.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) {
      // Canvas 2D unavailable (headless test DOM / canvas blocked) — return a
      // schema-valid 1x1 transparent PNG placeholder instead of crashing the
      // pick flow; the controller replaces it with a real clip anyway.
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    }
    ctx.fillStyle = '#161b22';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#58a6ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.fillStyle = '#8b949e';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(el.tagName.toLowerCase() + ' (preview)', w / 2, h / 2 + 4);
    return canvas.toDataURL('image/png');
  }

  function arrayBufferToBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  /** Build the in-page half of the §6 request payload. */
  function buildPayload(el, x, y) {
    STATE.requestId = uuidv4();
    var elementSeg = seg(el);
    var path = ancestorPath(el);
    var outer = truncateOuterHtml(el.outerHTML);
    var text = (el.textContent || '').trim().substring(0, MAX_TEXT_CONTENT);
    var portal = portalInfo(el);
    var rect = el.getBoundingClientRect();
    var dataUri = placeholderScreenshot(el);

    return sha256Hex(structuralHashSegments(path, elementSeg)).then(function (hash) {
      return {
        schema_version: CONTRACT_VERSION,
        request_id: STATE.requestId,
        captured_at: nowISO(),
        timeout_ms: readTimeoutMs(),
        page: {
          url: window.location.href,
          target_id: 'in-page-standalone',
          title: document.title,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          device_pixel_ratio: window.devicePixelRatio || 1
        },
        element: {
          backend_dom_node_id: 0, // upgraded by the CDP controller (§6.2 steps 2–3)
          dom_snapshot: {
            outer_html: outer.html,
            tag: el.tagName.toLowerCase(),
            attributes: relevantAttributes(el),
            text_content: text,
            ancestor_path: path,
            structural_hash: hash,
            child_count: el.children.length,
            truncated: outer.truncated
          },
          computed_styles: computedStyles(el),
          geometry: {
            x: rect.x, y: rect.y, width: rect.width, height: rect.height,
            coordinate_space: 'viewport'
          },
          portal: {
            in_portal: portal.in_portal,
            portal_root_hint: portal.portal_root_hint || undefined
          },
          screenshot: {
            storage: 'data_uri',
            data_uri: dataUri,
            mime_type: 'image/png',
            width: Math.max(1, Math.round(rect.width)),
            height: Math.max(1, Math.round(rect.height)),
            sha256: ''
          }
        },
        context: {
          app: readSetting('appContext', 'salestrekker'),
          locale: readSetting('localeContext', 'en-AU'),
          hints: { capture_source: 'in_page', design_mode: true }
        }
      };
    });
  }

  function readSetting(id, fallback) {
    var el = $(id);
    return el && el.value ? String(el.value) : fallback;
  }

  function readTimeoutMs() {
    var raw = parseInt(readSetting('timeoutMs', '10000'), 10);
    if (isNaN(raw)) return 10000;
    return Math.min(30000, Math.max(1000, raw));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Delivery: CDP controller binding first, same-origin proxy fallback
  // ──────────────────────────────────────────────────────────────────────────

  function synthesizeUnreachable(requestId, detail) {
    return {
      schema_version: CONTRACT_VERSION,
      request_id: requestId,
      resolved_at: nowISO(),
      resolver: { version: 'orca-design-mode@1.0.0', latency_ms: 0, node_live: false, target_id: '' },
      error: {
        code: 'RESOLVER_UNREACHABLE',
        message: 'Design Mode transport failed: ' + detail,
        retryable: true,
        retry_policy: 'backoff',
        details: { transports_attempted: ['mcp', 'http'], ladder_ms: [5000, 15000, 25000, 60000] },
        known_bug_flags: []
      },
      warnings: []
    };
  }

  function postToResolverProxy(payload) {
    var endpoint = (window.location.origin || '') + '/design-mode/resolve';
    log('info', 'POST ' + endpoint + ' (standalone — in-page capture)');
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    }).then(function (res) {
      return res.json().then(function (body) { return { ok: res.ok, status: res.status, body: body }; });
    }).then(function (r) {
      if (!r.ok && !r.body) throw new Error('HTTP ' + r.status);
      renderResponse(r.body && r.body.response ? r.body : { transport: 'http_proxy', response: r.body });
    }).catch(function (e) {
      renderTransportError(payload, String(e));
    });
  }

  function deliverPick(payload, x, y) {
    setStatus('captureStatus', 'Capture ready — delivering to resolver…', 'pending');
    log('info', 'pick ' + payload.element.dom_snapshot.tag + ' request_id=' + payload.request_id +
      (payload.element.portal.in_portal ? ' [portal: ' + payload.element.portal.portal_root_hint + ']' : ''));

    // Path A: Orca CDP capture controller installed the Runtime binding
    // (window.__orcaDesignModePick via Runtime.addBinding). Its shim owns
    // __orcaDesignModeDeliverPick, upgrades the pick via the raw-CDP §6.2
    // recipe (exact backendDOMNodeId, outerHTML, computed styles, box model,
    // clipped screenshot), transports MCP-first, and writes the envelope back
    // through __orcaDesignModeRenderResponse.
    if (typeof window.__orcaDesignModePick === 'function') {
      log('info', 'Orca CDP controller binding present — raw CDP capture upgrade (§6.2)');
      window.__orcaDesignModeDeliverPick(payload, x, y);
      return;
    }

    // Path B: standalone admin console — same-origin proxy (MCP-first inside).
    postToResolverProxy(payload);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Rendering: status, transport errors, resolver response (§13.1 items 6–8)
  // ──────────────────────────────────────────────────────────────────────────

  function populateRawTab(envelope) {
    var rawPre = $('rawResponse');
    if (rawPre) { rawPre.style.display = ''; rawPre.innerHTML = syntaxHighlight(JSON.stringify(envelope, null, 2)); }
    var rawEmpty = $('rawEmpty');
    if (rawEmpty) rawEmpty.style.display = 'none';
  }

  function renderResponse(result) {
    var transport = result.transport || 'unknown';
    var envelope = result.response || result;
    STATE.lastResponse = envelope;
    log('success', 'resolver responded via ' + transport + ' request_id=' + envelope.request_id);

    var err = envelope.error;
    if (err) {
      setStatus('resolverStatus', 'Error ' + err.code + ' — ' + err.message, 'error');
      var ec = $('errorContent');
      if (ec) {
        ec.innerHTML =
          '<div class="key-value"><span class="key">code</span><span class="value">' + escapeHtml(err.code) + '</span></div>' +
          '<div class="key-value"><span class="key">retryable</span><span class="value">' + err.retryable + '</span></div>' +
          '<div class="key-value"><span class="key">retry_policy</span><span class="value">' + escapeHtml(err.retry_policy || '') + '</span></div>' +
          '<div class="key-value"><span class="key">message</span><span class="value">' + escapeHtml(err.message || '') + '</span></div>' +
          (err.details ? '<details class="collapsible"><summary>details</summary><pre class="json-highlight">' + syntaxHighlight(JSON.stringify(err.details, null, 2)) + '</pre></details>' : '') +
          ((err.known_bug_flags && err.known_bug_flags.length) ? '<div class="key-value"><span class="key">known_bug_flags</span><span class="value badge-yellow">' + escapeHtml(err.known_bug_flags.join(', ')) + '</span></div>' : '');
      }
      populateRawTab(envelope);
      showTab('error');
      return;
    }

    var res = envelope.resolution || {};
    var conf = typeof res.confidence === 'number' ? res.confidence.toFixed(2) : 'n/a';
    var badge = res.confidence === 1 ? 'badge-green' : res.confidence >= 0.9 ? 'badge-blue' : res.confidence >= 0.5 ? 'badge-yellow' : 'badge-red';
    setStatus('resolverStatus', 'Resolved — confidence ' + conf + ' via ' + (res.resolution_path || 'n/a'), 'success');

    var rc = $('resolutionContent');
    if (rc) {
      var html = '<div class="key-value"><span class="key">confidence</span><span class="value"><span class="badge ' + badge + '">' + conf + '</span></span></div>';
      html += '<div class="key-value"><span class="key">resolution_path</span><span class="value">' + escapeHtml(res.resolution_path || '') + '</span></div>';
      html += '<div class="key-value"><span class="key">strategy</span><span class="value">' + escapeHtml(res.strategy || '') + '</span></div>';
      if (res.element_ref) {
        html += '<div class="key-value"><span class="key">element_ref.selector</span><span class="value">' + escapeHtml(res.element_ref.selector || '') + '</span></div>';
        html += '<div class="key-value"><span class="key">element_ref.target_id</span><span class="value">' + escapeHtml(res.element_ref.target_id || '') + '</span></div>';
      }
      if (res.action_hints && res.action_hints.length) {
        html += '<div class="key-value"><span class="key">action_hints</span><span class="value">' + escapeHtml(res.action_hints.join(', ')) + '</span></div>';
      }
      if (res.known_bug_flags && res.known_bug_flags.length) {
        html += '<div class="key-value"><span class="key">known_bug_flags</span><span class="value badge-yellow">' + escapeHtml(res.known_bug_flags.join(', ')) + '</span></div>';
      }
      if (res.known_bug_workarounds && res.known_bug_workarounds.length) {
        html += '<details class="collapsible"><summary>known_bug_workarounds (' + res.known_bug_workarounds.length + ')</summary><pre class="json-highlight">' + syntaxHighlight(JSON.stringify(res.known_bug_workarounds, null, 2)) + '</pre></details>';
      }
      if (res.fallback_match) {
        html += '<details class="collapsible"><summary>fallback_match</summary><pre class="json-highlight">' + syntaxHighlight(JSON.stringify(res.fallback_match, null, 2)) + '</pre></details>';
      }
      if (res.action_outcome && res.action_outcome.verification) {
        var v = res.action_outcome.verification;
        html += '<div class="key-value"><span class="key">verification.verdict</span><span class="value">' + escapeHtml(v.verdict || '') + '</span></div>';
        if (v.diff_summary) html += '<div class="key-value"><span class="key">diff_summary</span><span class="value">' + escapeHtml(v.diff_summary) + '</span></div>';
      }
      rc.innerHTML = html;
    }
    populateRawTab(envelope);
    showTab('resolution');
  }

  function renderTransportError(payload, detail) {
    var envelope = synthesizeUnreachable(payload.request_id, detail);
    log('error', 'transport failure: ' + detail);
    renderResponse({ transport: 'unreachable', response: envelope });
  }

  function renderCapture(payload) {
    STATE.lastPayload = payload;
    var el = $('capturePayload');
    if (el) el.innerHTML = syntaxHighlight(JSON.stringify(payload, null, 2));
    var details = $('captureDetails');
    if (details) details.style.display = '';
    var preview = $('capturePreview');
    if (preview) {
      var shot = payload.element && payload.element.screenshot;
      if (shot && shot.storage === 'data_uri' && shot.data_uri) {
        preview.style.display = '';
        preview.innerHTML = '<img src="' + shot.data_uri.substring(0, 4000000) + '" alt="element capture">';
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Execution guard + action confirmation panel (IDD-016 §13.1 item 7)
  // ──────────────────────────────────────────────────────────────────────────

  function setExecutionGuard(executing) {
    STATE.executing = !!executing;
    if (STATE.highlight) STATE.highlight.style.display = 'none';
    setStatus('captureStatus',
      STATE.executing ? 'Executing bridged action — picking paused…' : 'Active — hover to inspect, click to capture',
      STATE.executing ? 'warning' : 'success');
    log('info', STATE.executing ? 'execution guard ON — picker paused for action dispatch' : 'execution guard OFF — picking resumed');
  }

  function confirmEl(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function confirmKv(host, key, value) {
    var row = confirmEl('div', 'orca-confirm-kv');
    var k = confirmEl('span', 'k'); k.textContent = key;
    var v = confirmEl('span', 'v'); v.textContent = value == null ? '' : String(value);
    row.appendChild(k); row.appendChild(v);
    host.appendChild(row);
  }

  function confirmBadge(text, cls) {
    return confirmEl('span', 'badge ' + (cls || 'badge-gray'));
  }

  function confirmBadgeText(host, text, cls) {
    var b = confirmBadge(text, cls);
    b.textContent = text;
    host.appendChild(b);
    return b;
  }

  function confirmJsonDetails(host, summary, obj) {
    if (obj === undefined || obj === null) return;
    var d = confirmEl('details', 'collapsible');
    var s = confirmEl('summary'); s.textContent = summary;
    var pre = confirmEl('pre', 'json-highlight');
    pre.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
    d.appendChild(s); d.appendChild(pre);
    host.appendChild(d);
  }

  function confirmShot(host, shot, label) {
    var fig = confirmEl('figure', 'orca-confirm-shot');
    var cap = confirmEl('figcaption'); cap.textContent = label;
    fig.appendChild(cap);
    if (shot && shot.storage === 'data_uri' && shot.data_uri && shot.data_uri.length <= 4000000) {
      var img = confirmEl('img');
      img.src = shot.data_uri;
      img.alt = label;
      fig.appendChild(img);
    } else {
      var ph = confirmEl('div', 'orca-confirm-shot-missing');
      ph.textContent = shot ? 'screenshot exceeds the 4M data-URI cap (blob_ref)' : 'not captured';
      fig.appendChild(ph);
    }
    host.appendChild(fig);
  }

  function verdictBadge(verdict) {
    if (verdict === 'verified') return { text: 'VERIFIED — state change confirmed', cls: 'badge-green', tone: 'ok' };
    if (verdict === 'no_state_change') return { text: 'UNVERIFIED — NO STATE CHANGE', cls: 'badge-red', tone: 'bad' };
    if (verdict === 'false_positive_detected') return { text: 'FALSE POSITIVE DETECTED', cls: 'badge-red', tone: 'bad' };
    if (verdict === 'not_verified') return { text: 'NOT VERIFIED', cls: 'badge-gray', tone: 'muted' };
    return { text: 'VERIFICATION PENDING', cls: 'badge-gray', tone: 'muted' };
  }

  /**
   * Render the action confirmation panel (before/after region captures +
   * verification verdict + state-diff evidence). Called by the Orca CDP
   * controller via window.__orcaDesignModeRenderConfirmation after the
   * hot-reload, and from sessionStorage restore for the interim notice.
   *
   * Frozen badge decisions (IDD-016 bridge comment, t_f86d149b):
   *  - inputs: resolution.confidence, resolution_path, fallback_match
   *  - verdict from action_outcome.verification {verified, verdict,
   *    diff_summary, false_positive_guard}
   *  - error path renders error {code, message, retryable, retry_policy}
   *  - no_state_change shows diff evidence + the unverified verdict —
   *    NEVER a success badge
   */
  function renderConfirmation(session, interim) {
    if (!session) return;
    STATE.lastConfirmation = session;
    // Pending stash semantics: the controller writes it before the
    // hot-reload; the interim render keeps it alive across further reloads;
    // the FULL render (post-reload injection) consumes and clears it.
    try {
      if (interim) sessionStorage.setItem('orcaDesignMode.pending', JSON.stringify(session));
      else sessionStorage.removeItem('orcaDesignMode.pending');
    } catch (e) {}
    ensureRoot();

    var host = $('confirmationContent');
    var selfHosted = false;
    if (!host) {
      host = confirmEl('div');
      host.id = 'confirmationContent';
      var card = confirmEl('div', 'orca-confirm-card');
      var head = confirmEl('div', 'orca-confirm-head');
      var title = confirmEl('span', 'orca-confirm-title');
      title.textContent = 'Orca Action Confirmation';
      head.appendChild(title);
      card.appendChild(head);
      card.appendChild(host);
      STATE.root.appendChild(card);
      selfHosted = true;
    }
    while (host.firstChild) host.removeChild(host.firstChild);

    var phase = session.phase || 'unknown';
    var res = session.resolution || {};
    var conf = typeof res.confidence === 'number' ? res.confidence : null;

    // ── Interim notice: action done, page reloading / re-capturing ──
    if (interim || phase === 'reloading') {
      var iw = confirmEl('div', 'orca-confirm-body');
      confirmKv(iw, 'Status', 'Action completed — page hot-reloaded, re-capturing the affected region…');
      if (session.request_id) confirmKv(iw, 'request_id', session.request_id);
      if (session.verdict) confirmKv(iw, 'verdict', session.verdict);
      host.appendChild(iw);
      setStatus('confirmationStatus', 'Action completed — reloading for visual confirmation…', 'warning');
      log('info', 'confirmation: interim notice (request_id=' + (session.request_id || 'n/a') + ')');
      return;
    }

    var body = confirmEl('div', 'orca-confirm-body');
    var headRow = confirmEl('div', 'orca-confirm-verdict');
    var vBadge = confirmEl('span', 'badge badge-gray');
    var statusLine = '';
    var statusType = 'success';

    if (phase === 'error') {
      var err = session.error || {};
      vBadge.className = 'badge badge-red';
      vBadge.textContent = 'ERROR ' + (err.code || 'UNKNOWN');
      statusLine = 'Error ' + (err.code || 'unknown') + ' — ' + (err.message || '');
      statusType = 'error';
    } else if (phase === 'rejection') {
      vBadge.className = 'badge badge-yellow';
      vBadge.textContent = 'ACTION REJECTED';
      statusLine = 'Resolver declined the action in-band — see rejection reason';
      statusType = 'warning';
    } else if (phase === 'human_confirm') {
      vBadge.className = 'badge badge-blue';
      vBadge.textContent = 'AWAITING CONFIRMATION';
      statusLine = 'Resolution below the auto-execute policy — human confirmation required';
      statusType = 'warning';
    } else if (phase === 'no_action') {
      vBadge.className = 'badge badge-gray';
      vBadge.textContent = 'NO COMPATIBLE ACTION';
      statusLine = 'Resolved, but the element exposes no auto-executable action hint';
      statusType = 'inactive';
    } else {
      var vb = verdictBadge(session.verdict);
      vBadge.className = 'badge ' + vb.cls;
      vBadge.textContent = vb.text;
      statusLine = 'Verdict: ' + (session.verdict || 'pending');
      statusType = session.verdict === 'verified' ? 'success'
        : (session.verdict === 'no_state_change' || session.verdict === 'false_positive_detected') ? 'error'
        : 'warning';
    }
    headRow.appendChild(vBadge);
    body.appendChild(headRow);

    // ── Resolution provenance (frozen decision 2) ──
    if (phase !== 'error') {
      var rsec = confirmEl('div', 'orca-confirm-section');
      var rh = confirmEl('h4'); rh.textContent = 'Resolution'; rsec.appendChild(rh);
      if (conf !== null) {
        var crow = confirmEl('div', 'orca-confirm-kv');
        var ck = confirmEl('span', 'k'); ck.textContent = 'confidence';
        var cv = confirmEl('span', 'v');
        var cb = confirmEl('span', conf === 1 ? 'badge badge-green' : conf >= 0.9 ? 'badge badge-blue' : conf >= 0.5 ? 'badge badge-yellow' : 'badge badge-red');
        cb.textContent = String(conf);
        cv.appendChild(cb);
        crow.appendChild(ck); crow.appendChild(cv);
        rsec.appendChild(crow);
      }
      if (res.resolution_path) confirmKv(rsec, 'resolution_path', res.resolution_path);
      if (res.strategy) confirmKv(rsec, 'strategy', res.strategy);
      if (res.element_ref && res.element_ref.selector) confirmKv(rsec, 'selector hint', res.element_ref.selector);
      if (res.fallback_match) {
        confirmKv(rsec, 'fallback matched_on', (res.fallback_match.matched_on || []).join(', '));
        confirmKv(rsec, 'fallback match_score', String(res.fallback_match.match_score));
        if (res.fallback_match.differences && res.fallback_match.differences.length) {
          confirmKv(rsec, 'fallback differences', res.fallback_match.differences.join('; '));
        }
        confirmKv(rsec, 'fallback candidates', String(res.fallback_match.candidate_count));
      }
      if (session.element && session.element.tag) {
        confirmKv(rsec, 'picked element', '<' + session.element.tag + '>' + (session.element.in_portal ? ' [portal]' : ''));
      }
      body.appendChild(rsec);
    }

    // ── Action + verification verdict (frozen decision 3) ──
    if (session.action && session.action.executed !== undefined) {
      var asec = confirmEl('div', 'orca-confirm-section');
      var ah = confirmEl('h4'); ah.textContent = 'Action'; asec.appendChild(ah);
      if (session.action.requested_action) {
        confirmKv(asec, 'requested', session.action.requested_action.type +
          (session.action.requested_action.value ? '=' + session.action.requested_action.value : ''));
      }
      confirmKv(asec, 'executed', String(session.action.executed));
      if (session.action.action_tier) confirmKv(asec, 'action_tier', session.action.action_tier);
      body.appendChild(asec);
    }
    if (session.verification) {
      var vsec = confirmEl('div', 'orca-confirm-section');
      var vh = confirmEl('h4'); vh.textContent = 'Verification (state-diff)'; vsec.appendChild(vh);
      confirmKv(vsec, 'method', session.verification.method || 'state_diff');
      confirmKv(vsec, 'state_changed', String(session.verification.state_changed));
      if (session.verification.diff_summary) confirmKv(vsec, 'diff_summary', session.verification.diff_summary);
      if (session.verification.false_positive_guard) confirmKv(vsec, 'false_positive_guard', session.verification.false_positive_guard);
      body.appendChild(vsec);
      if (session.verdict === 'no_state_change') {
        var note = confirmEl('div', 'orca-confirm-note');
        note.textContent = 'The action executed but the state-diff shows no change. This is NOT a success — no success badge is shown.';
        body.appendChild(note);
      }
      if (session.verdict === 'false_positive_detected') {
        var fp = confirmEl('div', 'orca-confirm-note');
        fp.textContent = 'A known false-positive pattern matched (guard: ' +
          (session.verification.false_positive_guard || 'unnamed') + '). The change was not accepted as proof.';
        body.appendChild(fp);
      }
    }
    if (session.rejection) {
      var jsec = confirmEl('div', 'orca-confirm-section');
      var jh = confirmEl('h4'); jh.textContent = 'Rejection'; jsec.appendChild(jh);
      confirmKv(jsec, 'code', session.rejection.code || '');
      confirmKv(jsec, 'reason_code', session.rejection.reason_code || '');
      confirmKv(jsec, 'reason', session.rejection.reason || '');
      body.appendChild(jsec);
    }

    // ── Error payload (frozen decision 4) ──
    if (phase === 'error' && session.error) {
      var esec = confirmEl('div', 'orca-confirm-error');
      var er = confirmEl('div');
      var ec = confirmEl('span', 'code'); ec.textContent = session.error.code || 'ERROR';
      er.appendChild(ec);
      er.appendChild(document.createTextNode(' ' + (session.error.message || '')));
      esec.appendChild(er);
      confirmKv(esec, 'retryable', String(session.error.retryable));
      confirmKv(esec, 'retry_policy', session.error.retry_policy || '');
      confirmJsonDetails(esec, 'error details', session.error.details);
      if (session.error.known_bug_flags && session.error.known_bug_flags.length) {
        confirmKv(esec, 'known_bug_flags', session.error.known_bug_flags.join(', '));
      }
      body.appendChild(esec);
    }

    // ── Known-bug flags + workarounds ──
    if (session.known_bug_flags && session.known_bug_flags.length) {
      var bsec = confirmEl('div', 'orca-confirm-section');
      var bh = confirmEl('h4'); bh.textContent = 'Known-bug flags'; bsec.appendChild(bh);
      session.known_bug_flags.forEach(function (f) {
        confirmBadgeText(bsec, f, 'badge-yellow');
      });
      body.appendChild(bsec);
    }
    if (session.known_bug_workarounds && session.known_bug_workarounds.length) {
      confirmJsonDetails(body, 'known_bug_workarounds (' + session.known_bug_workarounds.length + ')', session.known_bug_workarounds);
    }

    // ── Before / after region captures ──
    if (session.before || session.after) {
      var ssec = confirmEl('div', 'orca-confirm-section');
      var sh = confirmEl('h4'); sh.textContent = 'Region capture — before / after hot-reload'; ssec.appendChild(sh);
      var shots = confirmEl('div', 'orca-confirm-shots');
      confirmShot(shots, session.before, 'BEFORE (pick)');
      confirmShot(shots, session.after, 'AFTER (post-reload)');
      ssec.appendChild(shots);
      if (session.after_element) {
        confirmKv(ssec, 'after re-locate', session.after_element.via || '');
        confirmKv(ssec, 'after region DOM changed', String(session.after_element.dom_changed));
      }
      if (session.recapture_error) {
        var rn = confirmEl('div', 'orca-confirm-note');
        rn.textContent = 'After-capture unavailable: ' + session.recapture_error;
        ssec.appendChild(rn);
      }
      body.appendChild(ssec);
    }

    // ── Evidence meta ──
    var msec = confirmEl('div', 'orca-confirm-section');
    var mh = confirmEl('h4'); mh.textContent = 'Evidence'; msec.appendChild(mh);
    if (session.request_id) confirmKv(msec, 'request_id', session.request_id);
    if (session.session_id) confirmKv(msec, 'session_id', session.session_id);
    if (session.transport) confirmKv(msec, 'transport', session.transport);
    if (session.resolver) {
      confirmKv(msec, 'resolver', session.resolver.version || '');
      confirmKv(msec, 'resolver latency_ms', String(session.resolver.latency_ms));
      confirmKv(msec, 'node_live', String(session.resolver.node_live));
    }
    if (session.reload) confirmKv(msec, 'hot-reload', session.reload.wait || String(session.reload.reloaded));
    if (session.policy) confirmKv(msec, 'policy', session.policy.decision + (session.policy.hint ? ' (' + session.policy.hint + ')' : ''));
    confirmJsonDetails(msec, 'warnings', session.warnings && session.warnings.length ? session.warnings : null);
    confirmJsonDetails(msec, 'stage log', session.stage_log && session.stage_log.length ? session.stage_log : null);
    body.appendChild(msec);

    // ── Panel actions ──
    var act = confirmEl('div', 'orca-confirm-actions');
    var copyBtn = confirmEl('button');
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy evidence JSON';
    copyBtn.addEventListener('click', function () {
      var txt = JSON.stringify(session, null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(
          function () { log('success', 'confirmation evidence copied to clipboard'); },
          function () { log('error', 'clipboard copy failed'); }
        );
      }
    });
    var dismissBtn = confirmEl('button');
    dismissBtn.type = 'button';
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.addEventListener('click', function () {
      if (selfHosted) {
        var card = host.closest('.orca-confirm-card');
        if (card && card.parentNode) card.parentNode.removeChild(card);
      } else {
        while (host.firstChild) host.removeChild(host.firstChild);
      }
      try { sessionStorage.removeItem('orcaDesignMode.pending'); } catch (e) {}
      setStatus('confirmationStatus', 'Confirmation dismissed', 'inactive');
    });
    act.appendChild(copyBtn);
    act.appendChild(dismissBtn);
    body.appendChild(act);

    host.appendChild(body);

    setStatus('confirmationStatus', statusLine, statusType);
    log(statusType === 'error' ? 'error' : statusType === 'warning' ? 'warning' : 'success',
      'confirmation rendered: phase=' + phase +
      (session.verdict ? ' verdict=' + session.verdict : '') +
      ' confidence=' + (conf === null ? 'n/a' : conf));
    try { host.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Pick flow
  // ──────────────────────────────────────────────────────────────────────────

  function isOrcaUi(el) {
    return el && el.closest && el.closest('#' + ORCA_ROOT_ID);
  }

  function onPickClick(event) {
    if (!STATE.active || STATE.executing) return;
    var x = event.clientX;
    var y = event.clientY;
    var el = document.elementFromPoint(x, y);
    if (!el || isOrcaUi(el)) return;
    // Suppress the page's own handlers — this click is a PICK, not an
    // activation. (Guard order matters: clicks on our own UI must pass
    // through unsuppressed so the FAB stays clickable.)
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    setStatus('captureStatus', 'Capturing element <' + el.tagName.toLowerCase() + '>…', 'pending');
    log('info', 'pick at (' + x + ',' + y + ')');

    buildPayload(el, x, y).then(function (payload) {
      setStatus('captureStatus', 'Captured <' + payload.element.dom_snapshot.tag + '> — structural_hash ' + payload.element.dom_snapshot.structural_hash.substring(0, 12) + '…', 'success');
      renderCapture(payload);
      deliverPick(payload, x, y);
    }).catch(function (e) {
      setStatus('captureStatus', 'Capture failed: ' + e, 'error');
      log('error', 'capture failed: ' + e);
    });
  }

  function onPickHover(event) {
    if (!STATE.active || !STATE.highlight || STATE.executing) return;
    var el = document.elementFromPoint(event.clientX, event.clientY);
    if (!el || isOrcaUi(el)) {
      STATE.highlight.style.display = 'none';
      return;
    }
    var r = el.getBoundingClientRect();
    var h = STATE.highlight;
    h.style.display = 'block';
    h.style.left = (r.left + window.scrollX) + 'px';
    h.style.top = (r.top + window.scrollY) + 'px';
    h.style.width = r.width + 'px';
    h.style.height = r.height + 'px';
    var label = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList && el.classList.length ? '.' + Array.from(el.classList).slice(0, 3).join('.') : '');
    h.textContent = label;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Overlay lifecycle
  // ──────────────────────────────────────────────────────────────────────────

  function ensureRoot() {
    if (STATE.root) return STATE.root;
    var root = document.createElement('div');
    root.id = ORCA_ROOT_ID;
    root.innerHTML =
      '<div id="orca-design-mode-overlay" style="position:fixed;inset:0;z-index:2147483646;background:transparent;cursor:crosshair;pointer-events:none"></div>' +
      '<div id="orca-design-mode-highlight" style="position:absolute;z-index:2147483647;border:2px solid #58a6ff;background:rgba(88,166,255,0.12);border-radius:3px;pointer-events:none;display:none;font:11px/1.4 monospace;color:#58a6ff;padding:1px 4px;white-space:pre"></div>' +
      '<button id="orca-design-mode-fab" type="button" style="position:fixed;right:18px;bottom:18px;z-index:2147483647;padding:10px 14px;border-radius:999px;border:1px solid #2d3140;background:#161b22;color:#e1e4e8;font:12px/1 -apple-system,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,0.4)">◉ Design Mode</button>';
    document.body.appendChild(root);
    STATE.root = root;
    STATE.overlay = root.querySelector('#orca-design-mode-overlay');
    STATE.highlight = root.querySelector('#orca-design-mode-highlight');
    // Panel styles are self-contained so the confirmation panel renders on
    // any page, not just the admin console (which ships its own stylesheet).
    if (!$('orca-design-mode-styles')) {
      var st = document.createElement('style');
      st.id = 'orca-design-mode-styles';
      st.textContent = CONFIRM_STYLES;
      document.head.appendChild(st);
    }
    return root;
  }

  var boundClick = null;
  var boundHover = null;
  var boundKey = null;

  function enable() {
    if (STATE.active) return;
    STATE.active = true;
    ensureRoot();

    boundClick = function (ev) { onPickClick(ev); };
    boundHover = function (ev) { onPickHover(ev); };
    boundKey = function (ev) { if (ev.key === 'Escape') disable(); };

    // Document-level capture listeners. The overlay is pointer-events:none,
    // so elementFromPoint sees the real page and the highlight tracks the
    // hovered element. Capture-phase click lets us suppress the page's own
    // handlers for the PICK click (the pick is not an activation).
    document.addEventListener('click', boundClick, true);
    document.addEventListener('mousemove', boundHover, true);
    document.addEventListener('keydown', boundKey, true);
    document.documentElement.style.cursor = 'crosshair';
    try { sessionStorage.setItem('orcaDesignMode.active', '1'); } catch (e) {}

    var btn = STATE.root.querySelector('#orca-design-mode-fab');
    btn.textContent = '◉ Design Mode ON (Esc to exit)';
    btn.style.borderColor = '#3fb950';
    btn.style.color = '#3fb950';

    setStatus('designModeStatusText', 'Active — hover to inspect, click to capture', 'success');
    var info = $('overlayInfo');
    if (info) info.style.display = '';
    log('success', 'Design Mode enabled — click any element to capture (portals included)');
  }

  function disable() {
    if (!STATE.active) return;
    STATE.active = false;
    if (boundClick) document.removeEventListener('click', boundClick, true);
    if (boundHover) document.removeEventListener('mousemove', boundHover, true);
    if (boundKey) document.removeEventListener('keydown', boundKey, true);
    document.documentElement.style.cursor = '';
    try {
      sessionStorage.removeItem('orcaDesignMode.active');
      sessionStorage.removeItem('orcaDesignMode.pending');
    } catch (e) {}
    if (STATE.root && STATE.root.parentNode) STATE.root.parentNode.removeChild(STATE.root);
    STATE.root = STATE.overlay = STATE.highlight = null;
    boundClick = boundHover = boundKey = null;

    setStatus('designModeStatusText', 'Inactive', 'inactive');
    var info = $('overlayInfo');
    if (info) info.style.display = 'none';
    var toggleText = $('toggleText');
    if (toggleText) toggleText.textContent = 'Enable Design Mode';
    var toggleIcon = $('toggleIcon');
    if (toggleIcon) toggleIcon.textContent = '◉';
    log('info', 'Design Mode disabled — overlay removed, page left unmutated');
  }

  function toggle() {
    if (STATE.active) disable();
    else enable();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public surface
  // ──────────────────────────────────────────────────────────────────────────

  window.orcaDesignMode = {
    enable: enable,
    disable: disable,
    toggle: toggle,
    isActive: function () { return STATE.active; },
    getLastPayload: function () { return STATE.lastPayload; },
    getLastResponse: function () { return STATE.lastResponse; },
    setExecutionGuard: setExecutionGuard,
    getLastConfirmation: function () { return STATE.lastConfirmation; }
  };
  window.toggleDesignMode = toggle;
  window.showTab = showTab;

  // CDP controller integration points (see automation/orca/design_mode_capture.py).
  // Default delivery is the same-origin proxy; the controller's binding shim
  // (Runtime.addBinding) replaces this with the raw-CDP upgrade path.
  window.__orcaDesignModeDeliverPick = postToResolverProxy;
  window.__orcaDesignModeRenderResponse = function (result) {
    renderResponse(result);
  };
  // Confirmation-loop entry point: the Orca CDP controller injects the
  // session payload (before/after captures + verdict) after the hot-reload.
  window.__orcaDesignModeRenderConfirmation = function (session) {
    renderConfirmation(session, false);
  };

  // Restore Design Mode + any pending confirmation across the confirmation
  // loop's hot-reload (sessionStorage survives the reload; in-memory STATE
  // does not). The controller re-injects the full payload once the page is
  // ready — until then the interim notice keeps the loop visible.
  // The injected script runs at document-start (body may not exist yet),
  // so defer the restore to DOMContentLoaded when needed.
  function restoreAfterReload() {
    try {
      if (sessionStorage.getItem('orcaDesignMode.active') === '1') {
        enable();
        log('info', 'Design Mode restored after hot-reload');
      }
      var pendingRaw = sessionStorage.getItem('orcaDesignMode.pending');
      if (pendingRaw) renderConfirmation(JSON.parse(pendingRaw), true);
    } catch (e) {
      console.error('[orca] post-reload restore failed', e);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restoreAfterReload);
  } else {
    restoreAfterReload();
  }

  log('info', 'Orca Design Mode loaded (contract ' + CONTRACT_VERSION + ') — click "Enable Design Mode"');
})();
