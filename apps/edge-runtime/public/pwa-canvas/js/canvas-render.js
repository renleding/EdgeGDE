// canvas-render.js — render loop, canvas transforms, object drawing

import { state, canvasViewport, canvasStage, safeText } from './canvas-state.js'

function mortgageCalculatorSrcdoc() {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
html,body{width:100%;min-width:0;height:100%;min-height:0}
body{margin:0;padding:clamp(6px,2.5vw,12px);font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#020617;color:#dbeafe;font-size:12px;line-height:1.35;word-break:break-word;overflow-wrap:anywhere;white-space:normal;overflow-x:hidden}
h1{font-size:16px;margin:0 0 8px;color:#66e3ff;overflow-wrap:anywhere}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
label{display:grid;gap:3px;min-width:0;padding:6px;border:1px solid rgba(148,163,184,.14);border-radius:8px;background:rgba(15,23,42,.52)}
label span{color:#9fb3c8;font-size:11px;line-height:1.2;overflow-wrap:anywhere}
input{width:100%;min-width:0;border:1px solid rgba(148,163,184,.28);border-radius:7px;background:#0f172a;color:#e5eefb;padding:7px 8px;font:inherit;font-size:12px}
.results{margin-top:8px;padding:8px;border:1px solid rgba(102,227,255,.25);border-radius:10px;background:rgba(8,47,73,.45);min-width:0;overflow-wrap:anywhere}
.row{display:flex;justify-content:space-between;gap:8px;margin:4px 0;min-width:0}
.total{margin-top:6px;padding-top:6px;border-top:1px solid rgba(226,232,240,.18);font-size:14px;font-weight:800;color:#bbf7d0}
.hint{margin:8px 0 0;color:#94a3b8;font-size:11px}
@media(max-width:520px){.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<h1>Mortgage Calculator</h1>
<div class="grid">
<label><span>Home price</span><input id="price" data-currency type="text" inputmode="decimal" value="$500,000"></label>
<label><span>Down payment</span><input id="down" data-currency type="text" inputmode="decimal" value="$100,000"></label>
<label><span>Interest rate %</span><input id="rate" type="number" min="0" step="0.01" value="6.5"></label>
<label><span>Term years</span><input id="term" type="number" min="1" step="1" value="30"></label>
<label><span>Property tax / yr</span><input id="tax" data-currency type="text" inputmode="decimal" value="$6,000"></label>
<label><span>Insurance / yr</span><input id="insurance" data-currency type="text" inputmode="decimal" value="$1,800"></label>
<label><span>HOA / mo</span><input id="hoa" data-currency type="text" inputmode="decimal" value="$0"></label>
</div>
<div class="results" id="results"></div>
<p class="hint">Local iframe calculation only. EdgeGDE policy/audit governs any saved or submitted action.</p>
<script>
const $=id=>document.getElementById(id);
const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
function rawNumber(id){return Number(String($(id).value).replace(/[^0-9.-]/g,''))||0}
function num(id){return rawNumber(id)}
function calc(){
  const price=num('price'), down=num('down'), rate=num('rate')/100/12, term=num('term')*12;
  const principal=Math.max(0,price-down);
  const payment=principal===0||rate===0?principal/Math.max(1,term):principal*rate/(1-Math.pow(1+rate,-Math.max(1,term)));
  const tax=num('tax')/12, ins=num('insurance')/12, hoa=num('hoa');
  const total=payment+tax+ins+hoa;
  $('results').innerHTML='<div class="row"><span>Principal</span><strong>'+money.format(principal)+'</strong></div>'+
    '<div class="row"><span>Principal & interest</span><strong>'+money.format(payment)+'/mo</strong></div>'+
    '<div class="row"><span>Tax + insurance + HOA</span><strong>'+money.format(tax+ins+hoa)+'/mo</strong></div>'+
    '<div class="row total"><span>Estimated monthly</span><strong>'+money.format(total)+'</strong></div>';
}
function formatCurrencyValue(id){$(id).value=money.format(rawNumber(id))}
document.querySelectorAll('input').forEach(input=>{
  input.addEventListener('input',calc);
  input.addEventListener('keydown',event=>{
    if(event.key==='Enter'){
      event.preventDefault();
      if(input.hasAttribute('data-currency')) formatCurrencyValue(input.id);
      calc();
      input.blur();
    }
  });
});
document.querySelectorAll('[data-currency]').forEach(input=>formatCurrencyValue(input.id));
calc();
</script>
</body>
</html>`
}

export function objectBody(object) {
  if (object.variant === 'edge-calculator') {
    const srcdoc = mortgageCalculatorSrcdoc().replace(/"/g, '&quot;')
    return `<iframe title="Mortgage calculator iframe" srcdoc="${srcdoc}"></iframe>`
  }
  if (object.type === 'mcp-app') {
    return '<iframe title="Sandboxed MCP App preview" srcdoc="<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><style>html,body{width:100%;min-width:0;height:100%;min-height:0}*{box-sizing:border-box}body{margin:0;padding:clamp(8px,3vw,18px);font-family:system-ui,sans-serif;background:#020617;color:#cbd5e1;word-break:break-word;overflow-wrap:anywhere;line-break:anywhere;white-space:normal;overflow-x:hidden}h1{font-size:18px;margin:0 0 10px;color:#66e3ff;overflow-wrap:anywhere}p{margin:0;max-width:100%;line-height:1.5}</style></head><body><h1>Sandboxed MCP App</h1><p>EdgeGDE brokers policy, audit, and MCP calls. This iframe cannot call MCP servers directly. Text wraps to the iframe width while the window is resized.</p></body></html>"></iframe>'
  }
  if (object.type === 'bundle-review') {
    return '<strong>Bundle review</strong><br>Manifest, permission diff, trust boundary, snapshot target, and restore path are shown before activation.'
  }
  return safeText(object.body || 'Local object draft. Authoritative state remains in EdgeGDE workspace state.')
}

export function applyTransform() {
  const { x, y, scale } = state.transform
  canvasViewport.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
  canvasStage.style.setProperty('--scale', String(scale))
}

export function renderObjects() {
  canvasViewport.innerHTML = ''
  for (const object of state.objects) {
    const el = document.createElement('article')
    el.className = `canvas-object${state.selectedIds.includes(object.id) ? ' selected' : ''}${state.snappingId === object.id ? ' snapping' : ''}`
    el.dataset.id = object.id
    el.style.width = `${object.width}px`
    el.style.height = `${object.height}px`
    el.style.transform = `translate(${object.x}px, ${object.y}px)`
    el.innerHTML = `
      <div class="object-handle" data-handle="true">
        <strong>${safeText(object.title)}</strong>
        <span class="object-badge">${safeText(object.type)}</span>
      </div>
      <div class="object-body">${objectBody(object)}</div>
      <div class="resize-handle n" data-resize="n" aria-hidden="true"></div>
      <div class="resize-handle ne" data-resize="ne" aria-hidden="true"></div>
      <div class="resize-handle e" data-resize="e" aria-hidden="true"></div>
      <div class="resize-handle se" data-resize="se" aria-hidden="true"></div>
      <div class="resize-handle s" data-resize="s" aria-hidden="true"></div>
      <div class="resize-handle sw" data-resize="sw" aria-hidden="true"></div>
      <div class="resize-handle w" data-resize="w" aria-hidden="true"></div>
      <div class="resize-handle nw" data-resize="nw" aria-hidden="true"></div>
    `
    canvasViewport.appendChild(el)
  }
  applyTransform()
}

export function updateObjectElement(object) {
  const el = canvasViewport.querySelector(`[data-id="${object.id}"]`)
  if (!el) return
  el.style.width = `${object.width}px`
  el.style.height = `${object.height}px`
  el.style.transform = `translate(${object.x}px, ${object.y}px)`
  el.classList.toggle('selected', state.selectedIds.includes(object.id))
  el.classList.toggle('snapping', state.snappingId === object.id)
}
