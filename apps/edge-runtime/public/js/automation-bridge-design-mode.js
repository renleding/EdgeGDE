/**
 * Automation Bridge Design Mode — Visual Element Picker for EdgeGDE Admin Console
 *
 * Implements the Automation Bridge capture side per IDD-016 v2.0.0:
 * - Design Mode toggle and click-to-pick overlay
 * - CDP capture recipe (§6.2) including Radix portal elements
 * - structural_hash computation (§6.5) with caps (§6.6)
 * - MCP tool call with HTTP fallback and failover (§5.3)
 * - UI rendering of confidence, fallback_match, known_bug_flags, verification verdicts
 *
 * Contract: packages/automation-bridge/
 * Resolver endpoint: http://127.0.0.1:9110 (MCP) / /api/v1/resolver/resolve (HTTP)
 */

(function () {
  'use strict';

  // ────────────────────────────────────────────────────────────────────────
  // Configuration
  // ────────────────────────────────────────────────────────────────────────

  const CONFIG = {
    resolverPort: parseInt(localStorage.getItem('automation-bridge:resolverPort') || '9110', 10),
    mcpTimeout: 2000,
    httpTimeout: 10000,
    maxTransportRetries: 4,
    transportBackoff: [5000, 15000, 25000, 60000],
    contractVersion: '2.0.0',
    confidenceFloor: 0.5,
    autoExecuteThreshold: 0.9,
    approvalThreshold: 0.5,
    screenshotMaxDataUri: 4000000,
    outerHtmlCap: 200000,
    textContentCap: 2000,
    actionValueCap: 100000,
    requestCacheTtlMs: 60000,
  };

  const COMPUTED_STYLE_KEYS = [
    'display', 'visibility', 'opacity', 'pointer-events',
    'cursor', 'color', 'background-color', 'font-size',
    'font-weight', 'text-align',
  ];

  // ────────────────────────────────────────────────────────────────────────
  // State
  // ────────────────────────────────────────────────────────────────────────

  let designModeActive = false;
  let overlay = null;
  let highlight = null;
  let tooltip = null;
  let lastClickEvent = null;
  let requestIdCounter = 0;
  let lastResult = null;
  let resultPanel = null;
  let cdpSessionId = null;

  // ────────────────────────────────────────────────────────────────────────
  // Utility Functions
  // ────────────────────────────────────────────────────────────────────────

  function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function nowIso() {
    return new Date().toISOString().replace(/\.\d{3}/, '.000') + 'Z';
  }

  function kebabCase(str) {
    return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, '&#039;');
  }

  function sha256Hex(str) {
    const msg = new TextEncoder().encode(str);
    return crypto.subtle.digest('SHA-256', msg).then(buf => {
      return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    });
  }

  function truncateAtLastTag(html, maxLen) {
    if (html.length <= maxLen) return { html, truncated: false };
    const truncated = html.slice(0, maxLen);
    const lastGt = truncated.lastIndexOf('>');
    if (lastGt === -1) return { html: truncated, truncated: true };
    return { html: truncated.slice(0, lastGt + 1), truncated: true };
  }

  // ────────────────────────────────────────────────────────────────────────
  // CDP Communication
  // ────────────────────────────────────────────────────────────────────────

  async function cdpSend(method, params = {}) {
    const port = CONFIG.resolverPort;
    const url = `http://127.0.0.1:${port}/cdp`; // State engine exposes CDP proxy
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, params }),
    });
    if (!res.ok) throw new Error(`CDP ${method} failed: ${res.status}`);
    return res.json();
  }

  async function ensureCdpSession() {
    if (cdpSessionId) return cdpSessionId;
    // Attach to the current page's CDP target
    const res = await fetch(`http://127.0.0.1:${CONFIG.resolverPort}/cdp/attach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: window.location.href }),
    });
    if (!res.ok) throw new Error('Failed to attach CDP session');
    const data = await res.json();
    cdpSessionId = data.sessionId;
    return cdpSessionId;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Capture Recipe (IDD-016 §6.2)
  // ────────────────────────────────────────────────────────────────────────

  async function captureElement(element, clickX, clickY) {
    await ensureCdpSession();

    // 1. Get RemoteObjectId for the element
    let remoteObjectId;
    try {
      const res = await cdpSend('Runtime.callFunctionOn', {
        functionDeclaration: '() => document.elementFromPoint(arguments[0], arguments[1])',
        arguments: [{ value: clickX }, { value: clickY }],
        returnByValue: false,
      });
      remoteObjectId = res.result?.objectId;
    } catch (e) {
      // Fallback: use element directly if we have it
      const res = await cdpSend('Runtime.callFunctionOn', {
        functionDeclaration: '(el) => el',
        arguments: [{ value: element }],
        returnByValue: false,
      });
      remoteObjectId = res.result?.objectId;
    }

    if (!remoteObjectId) throw new Error('Could not get remote object for element');

    // 2. DOM.requestNode -> nodeId
    const nodeRes = await cdpSend('DOM.requestNode', { objectId: remoteObjectId });
    const nodeId = nodeRes.nodeId;
    if (!nodeId) throw new Error('DOM.requestNode returned no nodeId');

    // 3. DOM.describeNode -> backendNodeId
    const describeRes = await cdpSend('DOM.describeNode', { nodeId });
    const backendNodeId = describeRes.node?.backendNodeId;
    if (!backendNodeId) throw new Error('DOM.describeNode returned no backendNodeId');

    // 4. DOM.getOuterHTML
    const outerHtmlRes = await cdpSend('DOM.getOuterHTML', { backendNodeId });
    const { html: outerHtml, truncated } = truncateAtLastTag(
      outerHtmlRes.outerHTML || '',
      CONFIG.outerHtmlCap
    );

    // 5. CSS.getComputedStyle (10 keys)
    const styleRes = await cdpSend('CSS.getComputedStyle', { nodeId });
    const computedStyles = {};
    for (const key of COMPUTED_STYLE_KEYS) {
      const prop = styleRes.computedStyle?.find(p => p.name === key);
      computedStyles[key] = prop?.value || '';
    }

    // 6. DOM.getBoxModel or getContentQuads -> geometry
    let geometry = { x: 0, y: 0, width: 0, height: 0, coordinate_space: 'viewport' };
    try {
      const boxRes = await cdpSend('DOM.getBoxModel', { backendNodeId });
      if (boxRes.model) {
        const quad = boxRes.model.content; // or margin/border/padding
        geometry = {
          x: quad[0],
          y: quad[1],
          width: quad[4] - quad[0],
          height: quad[5] - quad[1],
          coordinate_space: 'viewport',
        };
      }
    } catch (e) {
      // Fallback to getContentQuads
      const quadRes = await cdpSend('DOM.getContentQuads', { backendNodeId });
      if (quadRes.quads?.[0]) {
        const q = quadRes.quads[0];
        geometry = {
          x: q[0],
          y: q[1],
          width: q[4] - q[0],
          height: q[5] - q[1],
          coordinate_space: 'viewport',
        };
      }
    }

    // 7. Page.captureScreenshot with clip
    let screenshot = { storage: 'data_uri', mime_type: 'image/png', width: 1, height: 1, sha256: '' };
    try {
      const clip = { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height, scale: 1 };
      const shotRes = await cdpSend('Page.captureScreenshot', { format: 'png', clip });
      if (shotRes.data) {
        const bytes = Uint8Array.from(atob(shotRes.data), c => c.charCodeAt(0));
        const hash = await sha256Hex(String.fromCharCode(...bytes));
        if (shotRes.data.length <= CONFIG.screenshotMaxDataUri) {
          screenshot = {
            storage: 'data_uri',
            data_uri: `data:image/png;base64,${shotRes.data}`,
            mime_type: 'image/png',
            width: geometry.width,
            height: geometry.height,
            sha256: hash,
          };
        } else {
          // Store as blob_ref (caller-side storage)
          screenshot = {
            storage: 'blob_ref',
            blob_id: `screenshot-${Date.now()}`,
            mime_type: 'image/png',
            width: geometry.width,
            height: geometry.height,
            sha256: hash,
          };
        }
      }
    } catch (e) {
      // Screenshot optional for capture
    }

    // Build dom_snapshot
    const tag = element.tagName?.toLowerCase() || 'unknown';
    const attrs = {};
    for (const attr of element.attributes) {
      if (['id', 'name', 'class', 'type', 'placeholder', 'aria-label', 'aria-describedby', 'role', 'href', 'title', 'data-testid'].includes(attr.name)) {
        attrs[attr.name] = attr.value;
      }
    }
    const textContent = (element.textContent || '').trim().slice(0, CONFIG.textContentCap);

    // ancestor_path (nearest-first, max 8, ending at html)
    const ancestorPath = [];
    let current = element.parentElement;
    let depth = 0;
    while (current && depth < 8) {
      const tagName = current.tagName.toLowerCase();
      const siblings = Array.from(current.parentElement?.children || []).filter(e => e.tagName === current.tagName);
      const index = siblings.indexOf(current) + 1;
      ancestorPath.push({
        tag: tagName,
        index,
        id: current.id || undefined,
        classes: Array.from(current.classList || []),
      });
      if (tagName === 'html') break;
      current = current.parentElement;
      depth++;
    }

    // structural_hash
    const structuralHash = await computeStructuralHash(ancestorPath, tag, element.id || '');

    // Portal detection
    let inPortal = false;
    let portalRootHint = '';
    let p = element;
    while (p) {
      if (p.matches('[data-radix-portal]') || p.matches('[data-portal-root]')) {
        inPortal = true;
        portalRootHint = `#${p.id}` || p.tagName.toLowerCase();
        break;
      }
      p = p.parentElement;
    }

    return {
      backend_dom_node_id: backendNodeId,
      dom_snapshot: {
        outer_html: outerHtml,
        tag,
        attributes: attrs,
        text_content: textContent,
        ancestor_path: ancestorPath,
        structural_hash: structuralHash,
        child_count: element.children.length,
        truncated,
      },
      computed_styles: computedStyles,
      geometry,
      portal: {
        in_portal: inPortal,
        portal_root_hint: portalRootHint || undefined,
      },
      screenshot,
    };
  }

  async function computeStructuralHash(ancestorPath, elementTag, elementId) {
    const segments = [];
    for (const step of ancestorPath) {
      segments.push(`${step.tag}:${step.index}:${step.id || ''}`);
    }
    segments.push(`${elementTag}:1:${elementId || ''}`);
    const canonical = segments.join('|');
    return sha256Hex(canonical);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Request Building
  // ────────────────────────────────────────────────────────────────────────

  function buildRequest(capture, action = null, context = {}) {
    return {
      schema_version: CONFIG.contractVersion,
      request_id: uuidv4(),
      captured_at: nowIso(),
      timeout_ms: 10000,
      page: {
        url: window.location.href,
        target_id: cdpSessionId || 'unknown',
        title: document.title,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        device_pixel_ratio: window.devicePixelRatio || 1,
      },
      element: capture,
      action: action || undefined,
      context: {
        app: 'edgegde',
        locale: navigator.language,
        ...context,
      },
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Transport: MCP + HTTP Failover (IDD-016 §5)
  // ────────────────────────────────────────────────────────────────────────

  async function callMcp(request) {
    const url = `http://127.0.0.1:${CONFIG.resolverPort}/mcp`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.mcpTimeout);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: request.request_id,
          method: 'tools/call',
          params: { name: 'mcp_resolve_element', arguments: request },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`MCP HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || 'MCP error');
      return JSON.parse(data.result?.content?.[0]?.text || '{}');
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
  }

  async function callHttp(request) {
    const url = `http://127.0.0.1:${CONFIG.resolverPort}/api/v1/resolver/resolve`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.httpTimeout + 5000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Orca-Bridge-Version': CONFIG.contractVersion,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return await res.json();
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
  }

  async function resolveWithFailover(request) {
    let lastError;
    for (let attempt = 0; attempt < CONFIG.maxTransportRetries; attempt++) {
      try {
        // Try MCP first
        try {
          return await callMcp(request);
        } catch (mcpErr) {
          lastError = mcpErr;
          // MCP failed, try HTTP
        }

        try {
          return await callHttp(request);
        } catch (httpErr) {
          lastError = httpErr;
        }
      } catch (e) {
        lastError = e;
      }

      // Wait before retry (transport backoff)
      if (attempt < CONFIG.maxTransportRetries - 1) {
        await new Promise(r => setTimeout(r, CONFIG.transportBackoff[attempt]));
      }
    }

    // Both transports exhausted — synthesize RESOLVER_UNREACHABLE
    return {
      schema_version: CONFIG.contractVersion,
      request_id: request.request_id,
      resolved_at: nowIso(),
      resolver: { version: 'automation-bridge-client', latency_ms: 0, node_live: false, target_id: '' },
      error: {
        code: 'RESOLVER_UNREACHABLE',
        message: `Both transports failed: ${lastError?.message || 'unknown'}`,
        retryable: true,
        retry_policy: 'backoff',
        details: { transport_errors: String(lastError) },
      },
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Retry Logic (IDD-016 §10)
  // ────────────────────────────────────────────────────────────────────────

  async function resolveWithRetry(request) {
    const cacheKey = `automation-bridge:cache:${request.request_id}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        const env = JSON.parse(cached);
        env._cached = true;
        return env;
      } catch (e) { /* ignore */ }
    }

    let lastEnvelope;
    for (let attempt = 0; attempt <= 2; attempt++) {
      lastEnvelope = await resolveWithFailover(request);

      // Idempotent replay — same request_id returns cached response
      if (lastEnvelope.error) {
        const code = lastEnvelope.error.code;
        const retryable = lastEnvelope.error.retryable;
        const policy = lastEnvelope.error.retry_policy;

        if (!retryable || attempt >= 2) break;

        if (policy === 'backoff' && code === 'RESOLVER_TIMEOUT') {
          await new Promise(r => setTimeout(r, [1000, 3000][attempt] || 1000));
          continue;
        }
        if (policy === 'reattach' && code === 'TARGET_NOT_ATTACHED') {
          cdpSessionId = null; // Force reattach
          await new Promise(r => setTimeout(r, 250));
          continue;
        }
        if (code === 'RESOLVER_UNREACHABLE') {
          await new Promise(r => setTimeout(r, CONFIG.transportBackoff[attempt] || 5000));
          continue;
        }
        break;
      }

      // Success or non-retryable error
      break;
    }

    // Cache successful responses and timeout/reattach (for replay)
    if (lastEnvelope && (!lastEnvelope.error || ['RESOLVER_TIMEOUT', 'TARGET_NOT_ATTACHED'].includes(lastEnvelope.error.code))) {
      sessionStorage.setItem(cacheKey, JSON.stringify(lastEnvelope));
    }

    return lastEnvelope;
  }

  // ────────────────────────────────────────────────────────────────────────
  // UI: Design Mode Toggle, Overlay, Highlight, Tooltip
  // ────────────────────────────────────────────────────────────────────────

  function createStyles() {
    if (document.getElementById('automation-bridge-styles')) return;
    const style = document.createElement('style');
    style.id = 'automation-bridge-styles';
    style.textContent = `
      .automation-bridge-overlay {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        pointer-events: none; z-index: 2147483647;
        background: rgba(0,0,0,0.02);
      }
      .automation-bridge-overlay.active { pointer-events: auto; cursor: crosshair; }
      .automation-bridge-highlight {
        position: absolute; pointer-events: none;
        border: 2px solid #58a6ff; background: rgba(88,166,255,0.15);
        border-radius: 4px; box-shadow: 0 0 0 9999px rgba(0,0,0,0.3);
        transition: all 50ms ease-out;
      }
      .automation-bridge-tooltip {
        position: absolute; pointer-events: none; z-index: 2147483648;
        background: #161b22; border: 1px solid #58a6ff; border-radius: 6px;
        padding: 8px 12px; font-size: 12px; color: #e1e4e8;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        max-width: 280px; box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        white-space: nowrap; opacity: 0; transform: translateY(4px);
        transition: opacity 100ms, transform 100ms;
      }
      .automation-bridge-tooltip.visible { opacity: 1; transform: translateY(0); }
      .automation-bridge-toggle {
        position: fixed; bottom: 24px; right: 24px; z-index: 2147483646;
        padding: 12px 20px; border-radius: 8px; font-size: 13px; font-weight: 600;
        font-family: inherit; cursor: pointer; border: none;
        background: #238636; color: #fff; box-shadow: 0 4px 12px rgba(35,134,54,0.4);
      }
      .automation-bridge-toggle.active { background: #da3633; box-shadow: 0 4px 12px rgba(218,54,51,0.4); }
      .automation-bridge-toggle:hover { opacity: 0.9; }
      .automation-bridge-panel {
        position: fixed; bottom: 24px; left: 24px; right: 24px; max-height: 60vh;
        z-index: 2147483645; background: #161b22; border: 1px solid #2d3140;
        border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        overflow: hidden; display: none; flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px; color: #e1e4e8;
      }
      .automation-bridge-panel.visible { display: flex; }
      .automation-bridge-panel-header { display: flex; align-items: center; justify-content: space-between;
        padding: 12px 16px; border-bottom: 1px solid #2d3140; background: #0d1117; }
      .automation-bridge-panel-title { font-weight: 600; font-size: 14px; }
      .automation-bridge-panel-close { background: none; border: none; color: #8b949e; cursor: pointer; padding: 4px; }
      .automation-bridge-panel-close:hover { color: #f0f6fc; }
      .automation-bridge-panel-body { padding: 16px; overflow-y: auto; }
      .automation-bridge-panel-section { margin-bottom: 16px; }
      .automation-bridge-panel-section h4 { font-size: 11px; text-transform: uppercase; color: #8b949e; margin-bottom: 8px; letter-spacing: 0.5px; }
      .automation-bridge-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; margin-right: 6px; margin-bottom: 4px; }
      .badge-confidence-exact { background: #238636; color: #fff; }
      .badge-confidence-high { background: #d29922; color: #fff; }
      .badge-confidence-med { background: #d29922; color: #fff; }
      .badge-confidence-low { background: #da3633; color: #fff; }
      .badge-fallback { background: #58a6ff; color: #fff; }
      .badge-bug { background: #d2992220; color: #d29922; border: 1px solid #d29922; }
      .badge-verdict-verified { background: #238636; color: #fff; }
      .badge-verdict-no_state_change { background: #da3633; color: #fff; }
      .badge-verdict-false_positive { background: #d29922; color: #fff; }
      .automation-bridge-detail { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; color: #8b949e; background: #0d1117; padding: 8px; border-radius: 6px; border: 1px solid #2d3140; margin-top: 4px; word-break: break-all; }
      .automation-bridge-diff { font-size: 12px; color: #e1e4e8; line-height: 1.5; }
      .automation-bridge-diff .added { color: #3fb950; }
      .automation-bridge-diff .removed { color: #f85149; }
      .automation-bridge-action-btn { padding: 8px 16px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; border: 1px solid #2d3140; margin-right: 8px; margin-bottom: 8px; }
      .automation-bridge-action-btn.primary { background: #238636; color: #fff; border-color: #238636; }
      .automation-bridge-action-btn.secondary { background: #1c2128; color: #e1e4e8; }
      .automation-bridge-action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    `;
    document.head.appendChild(style);
  }

  function createOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'automation-bridge-overlay';
    overlay.addEventListener('click', onOverlayClick);
    overlay.addEventListener('mousemove', onOverlayMouseMove);
    overlay.addEventListener('mouseleave', onOverlayMouseLeave);
    document.body.appendChild(overlay);

    highlight = document.createElement('div');
    highlight.className = 'automation-bridge-highlight';
    overlay.appendChild(highlight);

    tooltip = document.createElement('div');
    tooltip.className = 'automation-bridge-tooltip';
    overlay.appendChild(tooltip);

    createToggle();
    createResultPanel();
  }

  function createToggle() {
    if (document.getElementById('automation-bridge-toggle')) return;
    const btn = document.createElement('button');
    btn.id = 'automation-bridge-toggle';
    btn.className = 'automation-bridge-toggle';
    btn.textContent = 'Design Mode: OFF';
    btn.addEventListener('click', toggleDesignMode);
    document.body.appendChild(btn);
  }

  function createResultPanel() {
    if (resultPanel) return;
    resultPanel = document.createElement('div');
    resultPanel.className = 'automation-bridge-panel';
    resultPanel.innerHTML = `
      <div class="automation-bridge-panel-header">
        <span class="automation-bridge-panel-title">Automation Bridge Design Mode — Capture Result</span>
        <button class="automation-bridge-panel-close" aria-label="Close">&times;</button>
      </div>
      <div class="automation-bridge-panel-body"></div>
    `;
    resultPanel.querySelector('.automation-bridge-panel-close').addEventListener('click', () => {
      resultPanel.classList.remove('visible');
    });
    document.body.appendChild(resultPanel);
  }

  function toggleDesignMode() {
    designModeActive = !designModeActive;
    const btn = document.getElementById('automation-bridge-toggle');
    if (designModeActive) {
      overlay.classList.add('active');
      btn.classList.add('active');
      btn.textContent = 'Design Mode: ON';
    } else {
      overlay.classList.remove('active');
      btn.classList.remove('active');
      btn.textContent = 'Design Mode: OFF';
      hideHighlight();
      hideTooltip();
    }
  }

  function onOverlayMouseMove(e) {
    if (!designModeActive) return;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || target === overlay || target === highlight || target === tooltip ||
        target.id === 'automation-bridge-toggle' || target.closest('.automation-bridge-panel')) {
      hideHighlight();
      hideTooltip();
      return;
    }
    const rect = target.getBoundingClientRect();
    highlight.style.left = `${rect.left + window.scrollX}px`;
    highlight.style.top = `${rect.top + window.scrollY}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
    highlight.style.display = 'block';

    const tag = target.tagName.toLowerCase();
    const id = target.id ? `#${target.id}` : '';
    const cls = target.className ? `.${target.className.split(' ').join('.')}` : '';
    tooltip.textContent = `${tag}${id}${cls}`;
    tooltip.style.left = `${e.clientX + 16}px`;
    tooltip.style.top = `${e.clientY - 32}px`;
    tooltip.classList.add('visible');
  }

  function onOverlayMouseLeave() {
    hideHighlight();
    hideTooltip();
  }

  function hideHighlight() {
    if (highlight) highlight.style.display = 'none';
  }

  function hideTooltip() {
    if (tooltip) tooltip.classList.remove('visible');
  }

  async function onOverlayClick(e) {
    if (!designModeActive) return;
    e.preventDefault();
    e.stopPropagation();

    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || target === overlay || target === highlight || target === tooltip ||
        target.id === 'automation-bridge-toggle' || target.closest('.automation-bridge-panel')) {
      return;
    }

    lastClickEvent = { x: e.clientX, y: e.clientY };

    try {
      showCaptureIndicator(target);
      const capture = await captureElement(target, e.clientX, e.clientY);
      const request = buildRequest(capture);
      const envelope = await resolveWithRetry(request);
      renderResult(envelope);
      hideCaptureIndicator();
    } catch (err) {
      hideCaptureIndicator();
      renderError(err);
    }
  }

  function showCaptureIndicator(el) {
    const existing = document.querySelector('.automation-bridge-capturing');
    if (existing) existing.remove();
    const indicator = document.createElement('div');
    indicator.className = 'automation-bridge-capturing';
    indicator.textContent = 'Capturing…';
    indicator.style.cssText = `
      position: fixed; top: 24px; left: 50%; transform: translateX(-50%);
      background: #58a6ff; color: #0d1117; padding: 8px 16px; border-radius: 6px;
      font-weight: 600; font-size: 13px; z-index: 2147483649;
    `;
    document.body.appendChild(indicator);
  }

  function hideCaptureIndicator() {
    const indicator = document.querySelector('.automation-bridge-capturing');
    if (indicator) indicator.remove();
  }

  // ────────────────────────────────────────────────────────────────────────
  // Results Rendering
  // ────────────────────────────────────────────────────────────────────────

  function renderResult(envelope) {
    lastResult = envelope;
    const body = resultPanel.querySelector('.automation-bridge-panel-body');
    let html = '';

    if (envelope.error) {
      html = renderErrorHtml(envelope.error);
    } else if (envelope.resolution) {
      html = renderResolutionHtml(envelope.resolution);
    } else {
      html = '<div class="automation-bridge-detail">Unknown response format</div>';
    }

    body.innerHTML = html;
    resultPanel.classList.add('visible');

    // Wire action buttons
    body.querySelectorAll('.automation-bridge-action-btn').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        const actionType = ev.target.dataset.action;
        if (actionType) await executeAction(actionType);
      });
    });
  }

  function renderError(err) {
    const body = resultPanel.querySelector('.automation-bridge-panel-body');
    body.innerHTML = renderErrorHtml(err);
    resultPanel.classList.add('visible');
  }

  function renderErrorHtml(err) {
    return `
      <div class="automation-bridge-panel-section">
        <h4>Error: ${escapeHtml(err.code)}</h4>
        <div class="automation-bridge-detail">${escapeHtml(err.message)}</div>
        <div class="automation-bridge-detail">Retryable: ${err.retryable ? 'Yes' : 'No'} | Policy: ${escapeHtml(err.retry_policy || 'none')}</div>
        ${err.details ? `<div class="automation-bridge-detail">Details: ${escapeHtml(JSON.stringify(err.details, null, 2))}</div>` : ''}
        ${err.known_bug_flags?.length ? `
          <div class="automation-bridge-panel-section">
            <h4>Known Bug Flags</h4>
            ${err.known_bug_flags.map(f => `<span class="automation-bridge-badge badge-bug">${escapeHtml(f)}</span>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderResolutionHtml(res) {
    const conf = res.confidence;
    let confClass = 'badge-confidence-low';
    if (conf === 1.0) confClass = 'badge-confidence-exact';
    else if (conf >= 0.9) confClass = 'badge-confidence-high';
    else if (conf >= 0.5) confClass = 'badge-confidence-med';

    let html = `
      <div class="automation-bridge-panel-section">
        <h4>Resolution</h4>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
          <span class="automation-bridge-badge ${confClass}">Confidence: ${conf.toFixed(conf === 1 ? 1 : 3)}</span>
          <span class="automation-bridge-badge ${res.resolution_path === 'fallback_structural' ? 'badge-fallback' : 'badge-confidence-exact'}">
            ${res.resolution_path === 'fallback_structural' ? 'Fallback' : 'Exact'}
          </span>
          <span class="automation-bridge-badge">${escapeHtml(res.strategy)}</span>
          <span class="automation-bridge-badge">${escapeHtml(res.element_type)}</span>
        </div>
      </div>
    `;

    if (res.known_bug_flags?.length) {
      html += `
        <div class="automation-bridge-panel-section">
          <h4>Known Bug Flags</h4>
          ${res.known_bug_flags.map(f => `<span class="automation-bridge-badge badge-bug">${escapeHtml(f)}</span>`).join('')}
          ${res.known_bug_workarounds?.map(w => `
            <div class="automation-bridge-detail" style="margin-top:4px;margin-bottom:8px;">
              <strong>${escapeHtml(w.bug_id)}:</strong> ${escapeHtml(w.workaround)}
              ${w.applied ? ' <span style="color:#3fb950">(applied)</span>' : ''}
              ${w.reason ? ` — ${escapeHtml(w.reason)}` : ''}
            </div>
          `).join('') || ''}
        </div>
      `;
    }

    if (res.resolution_path === 'fallback_structural' && res.fallback_match) {
      const fm = res.fallback_match;
      html += `
        <div class="automation-bridge-panel-section">
          <h4>Fallback Match</h4>
          <div class="automation-bridge-detail">
            Matched on: ${fm.matched_on.map(escapeHtml).join(', ')}<br>
            Score: ${fm.match_score.toFixed(3)}<br>
            Candidates: ${fm.candidate_count}<br>
            Top: ${fm.candidate_refs.slice(0, 3).map(escapeHtml).join(', ')}
            ${fm.differences?.length ? '<br>Differences: ' + fm.differences.map(escapeHtml).join('; ') : ''}
          </div>
        </div>
      `;
    }

    if (res.action_outcome) {
      const ao = res.action_outcome;
      html += `
        <div class="automation-bridge-panel-section">
          <h4>Action Outcome</h4>
          <div class="automation-bridge-detail">
            Requested: ${escapeHtml(ao.requested_action.type)}${ao.requested_action.value ? ` (${escapeHtml(ao.requested_action.value.slice(0, 50))})` : ''}<br>
            Executed: ${ao.executed ? 'Yes' : 'No'}
            ${ao.action_tier ? ` | Tier: ${escapeHtml(ao.action_tier)}` : ''}
          </div>
      `;

      if (ao.rejection) {
        html += `
          <div class="automation-bridge-detail" style="color:#f85149;margin-top:4px;">
            Rejected: ${escapeHtml(ao.rejection.reason_code)} — ${escapeHtml(ao.rejection.reason)}
          </div>
        `;
      }

      if (ao.verification) {
        const v = ao.verification;
        let verdictClass = 'badge-verdict-not_verified';
        if (v.verdict === 'verified') verdictClass = 'badge-verdict-verified';
        else if (v.verdict === 'no_state_change') verdictClass = 'badge-verdict-no_state_change';
        else if (v.verdict === 'false_positive_detected') verdictClass = 'badge-verdict-false_positive';
        html += `
          <div style="margin-top:8px;">
            <span class="automation-bridge-badge ${verdictClass}">Verdict: ${escapeHtml(v.verdict)}</span>
            <span class="automation-bridge-badge">Verified: ${v.verified ? 'Yes' : 'No'}</span>
            <span class="automation-bridge-badge">State Changed: ${v.state_changed ? 'Yes' : 'No'}</span>
            ${v.false_positive_guard ? `<span class="automation-bridge-badge badge-bug">Guard: ${escapeHtml(v.false_positive_guard)}</span>` : ''}
          </div>
          <div class="automation-bridge-diff">${escapeHtml(JSON.stringify(v.diff_summary || {}, null, 2))}</div>
        `;
      }
      
      // Phase 5: Hot-reload confirmation button for executed actions
      if (ao.executed && ao.verification) {
        html += `
          <div class="automation-bridge-panel-section">
            <h4>Confirmation</h4>
            <button class="automation-bridge-action-btn primary" data-action="confirm-hot-reload">
              🔄 Hot Reload & Confirm
            </button>
            <button class="automation-bridge-action-btn secondary" data-action="capture-before">
              📸 Capture Before State
            </button>
          </div>
        `;
      }
      
      html += '</div>';
    }

    // Action buttons for compatible actions
    if (res.action_hints?.length) {
      html += `
        <div class="automation-bridge-panel-section">
          <h4>Execute Action</h4>
          ${res.action_hints.map(a => `
            <button class="automation-bridge-action-btn ${a === 'click' ? 'primary' : 'secondary'}" data-action="${escapeHtml(a)}">
              ${escapeHtml(a.charAt(0).toUpperCase() + a.slice(1))}
            </button>
          `).join('')}
        </div>
      `;
    }

    return html;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Action Execution
  // ────────────────────────────────────────────────────────────────────────

  // Phase 5: Storage for before/after state comparison
  let beforeStateSnapshot = null;
  let pendingConfirmation = null; // { action, request, envelope, timestamp }

  async function executeAction(actionType) {
    if (!lastResult?.resolution) return;

    // Phase 5: Handle confirmation-specific actions
    if (actionType === 'capture-before') {
      await captureBeforeState();
      return;
    }
    if (actionType === 'confirm-hot-reload') {
      await confirmHotReload();
      return;
    }

    const capture = lastResult.resolution; // We need the original capture request
    // We don't have the original capture here — in practice you'd store it
    // For now, re-capture from the same element if possible
    const target = document.elementFromPoint(lastClickEvent?.x || 0, lastClickEvent?.y || 0);
    if (!target) return alert('No target element found');

    try {
      showCaptureIndicator(target);
      const freshCapture = await captureElement(target, lastClickEvent.x, lastClickEvent.y);
      const request = buildRequest(freshCapture, { type: actionType });
      const envelope = await resolveWithRetry(request);
      renderResult(envelope);
      hideCaptureIndicator();
    } catch (err) {
      hideCaptureIndicator();
      renderError(err);
    }
  }

  async function captureBeforeState() {
    if (!lastResult?.resolution) return;
    
    // Store current page state for comparison
    try {
      const snapshot = await captureElement(
        document.elementFromPoint(lastClickEvent?.x || 0, lastClickEvent?.y || 0),
        lastClickEvent?.x || 0,
        lastClickEvent?.y || 0
      );
      beforeStateSnapshot = {
        timestamp: new Date().toISOString(),
        capture: snapshot,
        url: window.location.href,
        title: document.title,
        scrollY: window.scrollY,
      };
      sessionStorage.setItem('automation-bridge:beforeState', JSON.stringify(beforeStateSnapshot));
      
      // Show confirmation
      const body = resultPanel.querySelector('.automation-bridge-panel-body');
      const notice = document.createElement('div');
      notice.className = 'automation-bridge-detail';
      notice.style.color = '#3fb950';
      notice.textContent = '✅ Before state captured. Now perform the action, then click "Hot Reload & Confirm".';
      body.insertBefore(notice, body.firstChild);
      
      // Update button state
      body.querySelectorAll('[data-action="capture-before"]').forEach(btn => {
        btn.textContent = '📸 Before State Captured';
        btn.disabled = true;
        btn.style.opacity = '0.6';
      });
    } catch (err) {
      alert('Failed to capture before state: ' + err.message);
    }
  }

  async function confirmHotReload() {
    if (!lastResult?.resolution) return;
    if (!beforeStateSnapshot) {
      alert('Please capture before state first using "Capture Before State" button.');
      return;
    }

    const afterActionEnvelope = lastResult;
    const actionTaken = afterActionEnvelope.resolution?.action_outcome?.requested_action?.type || 'unknown';
    
    try {
      // Phase 5: Hot reload - force page reload to get fresh state
      showCaptureIndicator(document.body);
      
      // Store the after-action envelope for comparison after reload
      sessionStorage.setItem('automation-bridge:pendingConfirmation', JSON.stringify({
        action: actionTaken,
        beforeState: beforeStateSnapshot,
        afterEnvelope: afterActionEnvelope,
        timestamp: new Date().toISOString(),
      }));
      
      // Trigger hard reload to bypass cache and get fresh server state
      window.location.reload();
      
    } catch (err) {
      hideCaptureIndicator();
      alert('Hot reload failed: ' + err.message);
    }
  }

  // Phase 5: Check for pending confirmation on page load
  function checkPendingConfirmation() {
    const stored = sessionStorage.getItem('automation-bridge:pendingConfirmation');
    if (!stored) return;
    
    try {
      pendingConfirmation = JSON.parse(stored);
      sessionStorage.removeItem('automation-bridge:pendingConfirmation');
      
      // Wait a bit for page to fully load
      setTimeout(() => {
        runConfirmationComparison();
      }, 1000);
    } catch (err) {
      console.warn('Failed to parse pending confirmation:', err);
    }
  }

  async function runConfirmationComparison() {
    if (!pendingConfirmation) return;
    
    const { beforeState, afterEnvelope, action } = pendingConfirmation;
    
    try {
      showCaptureIndicator(document.body);
      
      // Re-capture the same element after reload
      const target = document.elementFromPoint(
        beforeState.capture?.geometry?.x || 0,
        beforeState.capture?.geometry?.y || 0
      );
      
      if (!target) {
        throw new Error('Target element not found after reload');
      }
      
      const afterCapture = await captureElement(target, beforeState.capture?.geometry?.x || 0, beforeState.capture?.geometry?.y || 0);
      const request = buildRequest(afterCapture);
      const afterEnvelope = await resolveWithRetry(request);
      
      // Build comparison
      const comparison = buildConfirmationReport(beforeState, afterEnvelope, afterEnvelope, action);
      
      // Render confirmation panel
      renderConfirmationPanel(comparison);
      
      hideCaptureIndicator();
      
    } catch (err) {
      hideCaptureIndicator();
      const body = resultPanel.querySelector('.automation-bridge-panel-body');
      body.innerHTML = `
        <div class="automation-bridge-panel-section">
          <h4>Confirmation Failed</h4>
          <div class="automation-bridge-detail" style="color:#f85149;">
            ${escapeHtml(err.message)}
          </div>
        </div>
      `;
      resultPanel.classList.add('visible');
    }
  }

  function buildConfirmationReport(beforeState, beforeEnvelope, afterEnvelope, action) {
    const beforeDiff = beforeEnvelope.resolution?.action_outcome?.verification?.diff_summary || {};
    const afterDiff = afterEnvelope.resolution?.action_outcome?.verification?.diff_summary || {};
    
    const beforeVerdict = beforeEnvelope.resolution?.action_outcome?.verification?.verdict || 'unknown';
    const afterVerdict = afterEnvelope.resolution?.action_outcome?.verification?.verdict || 'unknown';
    
    // Determine if the action persisted after reload
    const persisted = afterVerdict === 'verified' || (afterVerdict === 'not_verified' && afterDiff.has_changed);
    const falsePositive = beforeVerdict === 'verified' && afterVerdict === 'no_state_change';
    
    return {
      action,
      before: {
        url: beforeState.url,
        timestamp: beforeState.timestamp,
        verdict: beforeVerdict,
        diff: beforeDiff,
      },
      after: {
        url: window.location.href,
        timestamp: new Date().toISOString(),
        verdict: afterVerdict,
        diff: afterDiff,
      },
      persisted,
      falsePositive,
      confidence: {
        before: beforeEnvelope.resolution?.confidence || 0,
        after: afterEnvelope.resolution?.confidence || 0,
      },
      recommendation: falsePositive 
        ? 'FALSE POSITIVE DETECTED: Action appeared to succeed but did not persist after reload.'
        : persisted
          ? 'CONFIRMED: Action persisted after hot reload.'
          : 'UNCERTAIN: Action state unclear after reload. Manual verification recommended.',
    };
  }

  function renderConfirmationPanel(report) {
    const body = resultPanel.querySelector('.automation-bridge-panel-body');
    
    const verdictClass = report.falsePositive ? 'badge-verdict-false_positive' : 
                        (report.persisted ? 'badge-verdict-verified' : 'badge-verdict-not_verified');
    
    let html = `
      <div class="automation-bridge-panel-section">
        <h4>Hot Reload Confirmation Report</h4>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          <span class="automation-bridge-badge ${verdictClass}">
            ${report.falsePositive ? 'FALSE POSITIVE' : (report.persisted ? 'CONFIRMED' : 'UNCERTAIN')}
          </span>
          <span class="automation-bridge-badge">Action: ${escapeHtml(report.action)}</span>
        </div>
        <div class="automation-bridge-detail">${escapeHtml(report.recommendation)}</div>
      </div>
      
      <div class="automation-bridge-panel-section">
        <h4>Before State (Pre-Reload)</h4>
        <div class="automation-bridge-detail">
          URL: ${escapeHtml(report.before.url)}<br>
          Timestamp: ${escapeHtml(report.before.timestamp)}<br>
          Verdict: ${escapeHtml(report.before.verdict)}<br>
          Diff: ${escapeHtml(JSON.stringify(report.before.diff, null, 2))}
        </div>
      </div>
      
      <div class="automation-bridge-panel-section">
        <h4>After State (Post-Reload)</h4>
        <div class="automation-bridge-detail">
          URL: ${escapeHtml(report.after.url)}<br>
          Timestamp: ${escapeHtml(report.after.timestamp)}<br>
          Verdict: ${escapeHtml(report.after.verdict)}<br>
          Diff: ${escapeHtml(JSON.stringify(report.after.diff, null, 2))}
        </div>
      </div>
      
      <div class="automation-bridge-panel-section">
        <h4>Comparison</h4>
        <div class="automation-bridge-detail">
          Confidence: ${report.confidence.before.toFixed(3)} → ${report.confidence.after.toFixed(3)}<br>
          URL Changed: ${report.after.url !== report.before.url ? 'Yes' : 'No'}<br>
          State Persisted: ${report.persisted ? 'Yes' : 'No'}
        </div>
      </div>
    `;
    
    body.innerHTML = html;
    resultPanel.classList.add('visible');
    
    // Clear before state for next cycle
    beforeStateSnapshot = null;
    sessionStorage.removeItem('automation-bridge:beforeState');
  }

  // ────────────────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────────────────

  window.AutomationBridgeDesignMode = {
    enable: () => { if (!designModeActive) toggleDesignMode(); },
    disable: () => { if (designModeActive) toggleDesignMode(); },
    toggle: toggleDesignMode,
    isActive: () => designModeActive,
    captureAndResolve: async (element, action, context) => {
      const capture = await captureElement(element, 0, 0);
      const request = buildRequest(capture, action, context);
      return resolveWithRetry(request);
    },
    getLastResult: () => lastResult,
    setResolverPort: (port) => { CONFIG.resolverPort = port; localStorage.setItem('automation-bridge:resolverPort', String(port)); },
  };

  // ────────────────────────────────────────────────────────────────────────
  // Init
  // ────────────────────────────────────────────────────────────────────────

  function init() {
    createStyles();
    createOverlay();
    checkPendingConfirmation(); // Phase 5: Check for pending hot-reload confirmation
    console.log('[Automation Bridge] Design Mode ready. Toggle with button or AutomationBridgeDesignMode.toggle()');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();