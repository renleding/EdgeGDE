/**
 * EdgeGDE Canvas Editor — User Interactions
 * Click select, drag reorder, text edit, delete.
 */
(function () {
  'use strict';

  var dragState = null;

  // ── Click Selection ───────────────────────────────
  document.addEventListener('click', function (e) {
    if (e.target.closest('[mcp-tool]')) return;
    var el = e.target.closest('[id]');
    if (!window.EditorNodes.isCanvasNode(el)) return;
    window.EditorState.set({ selectedNodeId: el.id });
    window.EditorNodes.highlightNode(el.id);
    e.stopPropagation();
  });

  // Background click deselects
  var rootEl = document.getElementById('canvas-root');
  if (rootEl) {
    rootEl.addEventListener('click', function (e) {
      if (e.target === this && !e.target.closest('[id]')) {
        window.EditorState.set({ selectedNodeId: null });
        var overlay = document.getElementById('editor-overlay');
        if (overlay) overlay.style.display = 'none';
      }
    });
  }

  // ── Drag to Reorder ───────────────────────────────
  document.addEventListener('mousedown', function (e) {
    var sel = window.EditorState.get().selectedNodeId;
    if (!sel) return;
    if (e.target.closest('#editor-toolbar')) return;
    if (e.target.closest('[contenteditable]')) return;
    if (e.target.closest('[mcp-tool]')) return;

    var el = document.getElementById(sel);
    if (!el || !el.contains(e.target)) return;

    dragState = { nodeId: sel, startX: e.clientX, startY: e.clientY, moved: false };
  });

  document.addEventListener('mousemove', function (e) {
    if (!dragState) return;
    var dx = e.clientX - dragState.startX;
    var dy = e.clientY - dragState.startY;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      dragState.moved = true;
      window.EditorState.set({ isDragging: true });
      document.body.style.cursor = 'grabbing';
    }
    if (window.EditorState.get().isDragging) {
      window.EditorNodes.showDropIndicator(e.clientX, e.clientY);
    }
  });

  document.addEventListener('mouseup', function (e) {
    if (!dragState) return;
    window.EditorNodes.hideDropIndicator();
    document.body.style.cursor = '';
    window.EditorState.set({ isDragging: false });

    if (dragState.moved) {
      var dropEl = document.elementFromPoint(e.clientX, e.clientY);
      var validTarget = null;
      while (dropEl) {
        if (dropEl.id && window.EditorNodes.isCanvasNode(dropEl) && dropEl.id !== dragState.nodeId) {
          var ancestor = dropEl;
          var isDescendant = false;
          while (ancestor) {
            if (ancestor.id === dragState.nodeId) { isDescendant = true; break; }
            ancestor = ancestor.parentElement;
          }
          if (!isDescendant) { validTarget = dropEl; break; }
        }
        dropEl = dropEl.parentElement;
      }
      if (validTarget) {
        window.EditorWS.sendMutation({
          type: 'move_node',
          nodeId: dragState.nodeId,
          newParentId: validTarget.id,
        });
      }
    }
    dragState = null;
  });

  // ── Text Editing ──────────────────────────────────
  document.addEventListener('dblclick', function (e) {
    var el = e.target.closest('[id]');
    if (!el) return;
    if (el.tagName === 'SPAN' || el.tagName === 'BUTTON') {
      el.contentEditable = 'plaintext-only';
      el.focus();
      window.EditorState.set({ selectedNodeId: el.id });
      window.EditorNodes.highlightNode(el.id);
    }
  });

  document.addEventListener('blur', function (e) {
    var el = e.target;
    if (el.isContentEditable) {
      el.contentEditable = 'inherit';
      var newText = el.textContent || '';
      window.EditorWS.sendMutation({
        type: 'update_node',
        nodeId: el.id,
        props: { text: newText },
      });
    }
  }, true);

  // ── Delete Node ───────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      var sel = window.EditorState.get().selectedNodeId;
      if (!sel) return;
      if (document.activeElement && document.activeElement.isContentEditable) return;
      e.preventDefault();
      window.EditorWS.sendMutation({
        type: 'delete_node',
        nodeId: sel,
      });
      window.EditorState.set({ selectedNodeId: null });
      var overlay = document.getElementById('editor-overlay');
      if (overlay) overlay.style.display = 'none';
    }
  });
})();
