/**
 * EdgeGDE Canvas Editor — WebMCP Runtime
 * Intercepts form submits and clicks on mcp-tool elements.
 */
(function () {
  'use strict';

  function mcpExtractPayload(el) {
    if (el.tagName === 'FORM') {
      var data = {};
      var inputs = el.querySelectorAll('[name]');
      for (var i = 0; i < inputs.length; i++) {
        data[inputs[i].name] = inputs[i].value;
      }
      return data;
    }
    return {};
  }

  // Intercept form submits
  document.addEventListener('submit', function (e) {
    var el = e.target;
    var toolAttr = el.getAttribute('mcp-tool');
    if (!toolAttr) return;
    e.preventDefault();
    window.EditorWS.sendMcpCall(toolAttr, mcpExtractPayload(el));
  });

  // Intercept clicks on mcp-tool elements
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[mcp-tool]');
    if (!el) return;
    var state = window.EditorState.get();
    if (state.isDragging) return;
    if (state.selectedNodeId) return;
    if (!window.EditorNodes.isCanvasNode(el)) return;
    e.preventDefault();
    e.stopPropagation();
    window.EditorWS.sendMcpCall(
      el.getAttribute('mcp-tool'),
      mcpExtractPayload(el)
    );
  });
})();
