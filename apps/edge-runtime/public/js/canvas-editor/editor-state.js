/**
 * EdgeGDE Canvas Editor — Shared State
 * Controlled state object with setter guards.
 * Loads after EventBus, before everything else.
 */
window.EditorState = {
  state: {
    selectedNodeId: null,
    lastAppliedVersion: 0,
    nodes: {},
    viewport: 'desktop',
    canvasId: null,
    doId: null,
    isDragging: false,
    savedScrollY: 0,
    activeTextNodeId: null,
  },

  set(partial) {
    const prev = { ...this.state };
    Object.assign(this.state, partial);
    // Only emit if something actually changed
    for (const key of Object.keys(partial)) {
      if (prev[key] !== this.state[key]) {
        window.EventBus.emit('state:' + key, this.state[key]);
      }
    }
    window.EventBus.emit('state:changed', { prev, next: { ...this.state } });
  },

  get() {
    return this.state;
  },

  /** Guards — throw early if state isn't ready */
  require(key) {
    if (this.state[key] == null) throw new Error(`EditorState.${key} not initialized`);
  },
};
