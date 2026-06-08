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
  iframe.style.cssText = 'position:fixed;bottom:20px;right:20px;width:380px;height:600px;max-height:80vh;border:none;z-index:2147483647;background:transparent';
  iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin');
  iframe.setAttribute('title', 'Chat Assistant');
  root.appendChild(iframe);

  // Listen for resize messages from iframe
  window.addEventListener('message', function(ev) {
    if (ev.origin !== baseUrl) return;
    if (ev.data && ev.data.type === 'resize') {
      iframe.style.height = (ev.data.height || 600) + 'px';
      iframe.style.width = (ev.data.width || 380) + 'px';
    }
  });
})();
