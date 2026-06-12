/**
 * EdgeGDE Canvas Editor — Event Bus
 * Lightweight pub/sub for cross-module communication.
 * Foundation module — must load first.
 */
window.EventBus = {
  events: {},
  on(event, handler) {
    (this.events[event] ||= []).push(handler);
    return () => {
      const h = this.events[event];
      if (h) this.events[event] = h.filter(fn => fn !== handler);
    };
  },
  emit(event, payload) {
    (this.events[event] || []).forEach(h => h(payload));
  },
  once(event, handler) {
    const wrapper = (payload) => {
      handler(payload);
      const h = this.events[event];
      if (h) this.events[event] = h.filter(fn => fn !== wrapper);
    };
    this.on(event, wrapper);
  },
};
