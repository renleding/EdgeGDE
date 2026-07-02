/**
 * Widget test setup — creates DOM elements matching the chat embed HTML.
 * Each test gets a fresh DOM setup in beforeEach.
 */
import { beforeEach } from 'vitest'

beforeEach(() => {
  document.body.innerHTML = `
    <div id="gde-chat">
      <div id="gde-header">
        <h1>Test Chat</h1>
        <button id="gde-minimize-btn">_</button>
        <button id="gde-close-btn">✕</button>
      </div>
      <div id="gde-body">
        <div id="message-list">
          <div class="welcome">Welcome! What is your name?</div>
        </div>
        <input id="chat-guest-name" type="hidden" value="" />
        <input id="chat-text-input" type="text" placeholder="Type a message..." />
        <button id="chat-send-btn">→</button>
      </div>
      <input id="chat-tenant-id" type="hidden" data-tenant="alpha-broker-01" value="alpha-broker-01" />
      <input id="chat-session-id" type="hidden" value="" />
    </div>
  `
})
