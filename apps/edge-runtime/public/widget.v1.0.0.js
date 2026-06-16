/**
 * EdgeGDE — Chat Widget Bootstrapper v1.0.0
 * Self-contained embed script. Creates an iframe for full isolation.
 * Usage:
 *   <script src="https://your-worker.dev/public/widget.v1.0.0.js" data-tenant="afirmico" defer></script>
 */
(function() {
  'use strict';

  var scriptTag = document.currentScript;
  var tenantId = scriptTag.getAttribute('data-tenant');
  if (!tenantId) { console.warn('[EdgeGDE] data-tenant attribute required'); return; }

  // Resolve base URL from script src
  var src = scriptTag.src || '';
  var baseUrl = src.split('/public/')[0] || 'https://edgegde-calculator.renleding.workers.dev';

  // Ensure mount point
  var root = document.getElementById('edgegde-chat-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'edgegde-chat-root';
    document.body.appendChild(root);
  }

  // Inject iframe
  var iframe = document.createElement('iframe');
  iframe.src = baseUrl + '/embed/chat?tenant=' + encodeURIComponent(tenantId);
  iframe.style.cssText = 'position:fixed;bottom:20px;right:20px;width:' + Math.min(380, Math.max(120, window.innerWidth - 40)) + 'px;height:' + Math.min(600, Math.max(120, window.innerHeight - 40)) + 'px;max-width:calc(100vw - 40px);max-height:calc(100vh - 40px);border:none;z-index:2147483647;background:transparent';
  iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin');
  iframe.setAttribute('title', 'Chat Assistant');
  root.appendChild(iframe);

  function clampIframeToViewport() {
    var maxWidth = Math.max(120, window.innerWidth - 40);
    var maxHeight = Math.max(120, window.innerHeight - 40);
    var currentWidth = parseFloat(iframe.style.width) || 380;
    var currentHeight = parseFloat(iframe.style.height) || 600;
    iframe.style.width = Math.min(currentWidth, maxWidth) + 'px';
    iframe.style.height = Math.min(currentHeight, maxHeight) + 'px';
  }

  window.addEventListener('resize', clampIframeToViewport);

  // Listen for resize messages from iframe
  window.addEventListener('message', function(ev) {
    if (ev.origin !== baseUrl) return;
    if (ev.data && ev.data.type === 'resize') {
      iframe.style.width = Math.min(ev.data.width || 380, Math.max(120, window.innerWidth - 40)) + 'px';
      iframe.style.height = Math.min(ev.data.height || 600, Math.max(120, window.innerHeight - 40)) + 'px';
    }
  });
})();
