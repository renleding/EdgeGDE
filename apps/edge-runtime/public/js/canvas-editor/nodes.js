/**
 * EdgeGDE Canvas Editor — Node Validation + Drop Indicator
 */
(function () {
  'use strict';

  var EDITOR_IDS = {
    'canvas-root': 1, 'editor-overlay': 1, 'editor-toolbar': 1,
    'canvas-container': 1, 'drop-indicator': 1,
  };

  window.EditorNodes = {
    /** True if element is a selectable canvas node (not editor chrome) */
    isCanvasNode: function (el) {
      if (!el || !el.id) return false;
      if (EDITOR_IDS[el.id]) return false;
      if (el.closest('#editor-toolbar')) return false;
      return true;
    },

    /** Create the drag-drop indicator line */
    dropIndicator: null,

    createDropIndicator: function () {
      var el = document.getElementById('drop-indicator');
      if (el) return el;
      el = document.createElement('div');
      el.id = 'drop-indicator';
      el.style.cssText = 'position:fixed;height:3px;background:#58a6ff;border-radius:2px;z-index:101;pointer-events:none;display:none;box-shadow:0 0 8px rgba(88,166,255,0.4);';
      document.body.appendChild(el);
      return el;
    },

    showDropIndicator: function (x, y) {
      if (!this.dropIndicator) this.dropIndicator = this.createDropIndicator();
      this.dropIndicator.style.display = 'block';
      this.dropIndicator.style.left = '40px';
      this.dropIndicator.style.width = (window.innerWidth - 80) + 'px';
      this.dropIndicator.style.top = Math.max(0, y - 1) + 'px';
    },

    hideDropIndicator: function () {
      if (this.dropIndicator) this.dropIndicator.style.display = 'none';
    },

    /** Highlight a node with the selection overlay */
    highlightNode: function (nodeId) {
      var overlay = document.getElementById('editor-overlay');
      if (!overlay) return;
      var el = document.getElementById(nodeId);
      if (!el) {
        overlay.style.display = 'none';
        return;
      }
      var rect = el.getBoundingClientRect();
      overlay.style.display = 'block';
      overlay.style.left = (rect.left + window.scrollX) + 'px';
      overlay.style.top = (rect.top + window.scrollY) + 'px';
      overlay.style.width = rect.width + 'px';
      overlay.style.height = rect.height + 'px';
    },

    /** Re-render canvas from server */
    renderCanvas: function () {
      var state = window.EditorState.get();
      var savedScrollY = window.scrollY;
      var root = document.getElementById('canvas-root');
      if (!root) return;

      // Save active text edit
      var activeTextEl = document.activeElement;
      var activeTextContent = '';
      if (activeTextEl && activeTextEl.isContentEditable) {
        state.activeTextNodeId = activeTextEl.getAttribute('data-node-id') || activeTextEl.id;
        activeTextContent = activeTextEl.textContent || '';
      }

      // Fetch re-compiled HTML
      var xhr = new XMLHttpRequest();
      xhr.open('GET', '/api/canvas/' + state.canvasId + '/html', false);
      xhr.send();
      if (xhr.status === 200) {
        root.innerHTML = xhr.responseText;
      }

      window.scrollTo(0, savedScrollY);

      // Restore selection highlight
      if (state.selectedNodeId) {
        this.highlightNode(state.selectedNodeId);
      }

      // Update version display
      var verEl = document.getElementById('canvas-version');
      if (verEl) verEl.textContent = 'v' + state.lastAppliedVersion;
      if (root) root.setAttribute('data-version', state.lastAppliedVersion);

      // Restore text edit cursor
      if (state.activeTextNodeId && activeTextContent) {
        var textEl = document.getElementById(state.activeTextNodeId);
        if (textEl && textEl.isContentEditable) {
          textEl.focus();
          var sel = window.getSelection();
          var range = document.createRange();
          range.selectNodeContents(textEl);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    },
  };
})();
