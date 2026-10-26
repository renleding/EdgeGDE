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

  var STATE = {
    active: false,
    root: null,
    overlay: null,
    highlight: null,
    requestId: null,
    lastPayload: null,
    lastResponse: null,
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
    var ctx = canvas.getContext('2d');
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
  // Pick flow
  // ──────────────────────────────────────────────────────────────────────────

  function isOrcaUi(el) {
    return el && el.closest && el.closest('#' + ORCA_ROOT_ID);
  }

  function onPickClick(event) {
    if (!STATE.active) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    var x = event.clientX;
    var y = event.clientY;
    var el = document.elementFromPoint(x, y);
    if (!el || isOrcaUi(el)) return;

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
    if (!STATE.active || !STATE.highlight) return;
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
      '<div id="orca-design-mode-overlay" style="position:fixed;inset:0;z-index:2147483646;background:transparent;cursor:crosshair"></div>' +
      '<div id="orca-design-mode-highlight" style="position:absolute;z-index:2147483647;border:2px solid #58a6ff;background:rgba(88,166,255,0.12);border-radius:3px;pointer-events:none;display:none;font:11px/1.4 monospace;color:#58a6ff;padding:1px 4px;white-space:pre"></div>' +
      '<button id="orca-design-mode-fab" type="button" style="position:fixed;right:18px;bottom:18px;z-index:2147483647;padding:10px 14px;border-radius:999px;border:1px solid #2d3140;background:#161b22;color:#e1e4e8;font:12px/1 -apple-system,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,0.4)">◉ Design Mode</button>';
    document.body.appendChild(root);
    STATE.root = root;
    STATE.overlay = root.querySelector('#orca-design-mode-overlay');
    STATE.highlight = root.querySelector('#orca-design-mode-highlight');
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

    STATE.overlay.addEventListener('click', boundClick, true);
    STATE.overlay.addEventListener('mousemove', boundHover, true);
    document.addEventListener('keydown', boundKey, true);

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
    if (STATE.overlay && boundClick) STATE.overlay.removeEventListener('click', boundClick, true);
    if (STATE.overlay && boundHover) STATE.overlay.removeEventListener('mousemove', boundHover, true);
    if (boundKey) document.removeEventListener('keydown', boundKey, true);
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
    getLastResponse: function () { return STATE.lastResponse; }
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

  log('info', 'Orca Design Mode loaded (contract ' + CONTRACT_VERSION + ') — click "Enable Design Mode"');
})();
