# Why CDP Evaluate Fails for React Forms

## Sign In Button

The Salestrekker sign-in form uses React state to control the Sign in button's `disabled` attribute. When using CDP evaluate with native setter:

```javascript
// This FILLS the field visually but React doesn't register it
const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
s.call(el, 'value');
el.dispatchEvent(new Event('input', {bubbles: true}));
```

The Sign in button stays disabled because React's form validation logic checks:
1. The `onChange`/`onInput` handler it registered (not a manual dispatchEvent)
2. Whether the event `isTrusted` — CDP synthetic events set this to `false`
3. Internal React state that isn't updated by prototype value setters

## Fix

`page.locator().type()` sends real CDP Input.insertText commands which trigger:
- Native DOM input events with `isTrusted: true`
- React's synthetic event system properly
- React form validation → button enables

## Data Entry Persistence

Same issue applies to form fields in the home loan editor. CDP evaluate + native setter:
- Visually fills the field
- React may or may not register the change
- When Save is clicked, the field value may be empty on the server

`page.locator().type()` reliably persists because React registers the keyboard events.
