/**
 * EdgeGDE — Document Intelligence API Mount
 *
 * Mounts all doc-intel sub-routers under /api/v1/doc-intel.
 * Tenant routing via x-tenant header.
 *
 * Also exports the doc-intel UI router for top-level mounting at /doc-intel/.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { ingestRouter } from './doc-intel/routes/ingest'
import { jobsRouter } from './doc-intel/routes/jobs'
import { searchRouter } from './doc-intel/routes/search'
import { documentsRouter } from './doc-intel/routes/documents'
import { docIntelUiRouter } from './doc-intel/ui-route'
import { uiRouter } from './doc-intel/routes/ui'

export const docIntelRouter = new Hono()

// Health check
docIntelRouter.get('/healthz', (c) => c.json({ status: 'ok', service: 'doc-intel' }))

// UI page at /api/v1/doc-intel/ui — inline SPA
docIntelRouter.get('/ui', async (c) => {
  const { html } = await import('hono/html')
  return c.html(html`<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Edge Document Intelligence</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0b;color:#e4e4e7;min-height:100vh}
.header{padding:20px 24px;border-bottom:1px solid #2a2a2e;display:flex;align-items:center;justify-content:space-between}
.header h1{font-size:18px;font-weight:600;color:#3b82f6}
.header span{font-size:13px;color:#71717a}
.main{max-width:1200px;margin:0 auto;padding:24px}
.toolbar{display:flex;gap:12px;margin-bottom:20px;align-items:center}
.toolbar input{flex:1;padding:8px 12px;border-radius:8px;border:1px solid #2a2a2e;background:#141416;color:#e4e4e7;font-size:14px}
.toolbar button{padding:8px 16px;border-radius:8px;border:none;font-size:14px;cursor:pointer;background:#3b82f6;color:#fff}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:10px 12px;font-size:12px;color:#71717a;text-transform:uppercase;border-bottom:1px solid #2a2a2e}
td{padding:10px 12px;font-size:14px;border-bottom:1px solid #2a2a2e}
tr:hover{background:#141416;cursor:pointer}
.b{padding:2px 8px;border-radius:4px;font-size:12px}
.b-completed{background:#22c55e20;color:#22c55e}
.b-warnings{background:#eab30820;color:#eab308}
.b-failed{background:#ef444420;color:#ef4444}
</style></head>
<body>
<div class="header"><h1>Edge Document Intelligence</h1><span id="t">personal</span></div>
<div class="main">
<div class="toolbar">
<input id="s" placeholder="Search..." oninput="f()">
<button onclick="document.getElementById('u').click()">+ Upload</button>
<input type="file" id="u" onchange="up(this)" style="display:none">
</div>
<table id="tbl"><thead><tr><th>Filename</th><th>Type</th><th>Status</th><th>Conf</th><th>Date</th></tr></thead>
<tbody id="b"></tbody></table>
<div id="d" style="display:none;margin-top:20px;padding:20px;border-radius:12px;background:#141416;border:1px solid #2a2a2e">
<h2 id="dt" style="margin-bottom:16px;font-size:16px"></h2>
<div id="df"></div>
<button onclick="document.getElementById('d').style.display='none'" style="margin-top:12px;padding:6px 12px;border-radius:6px;border:1px solid #2a2a2e;background:transparent;color:#71717a;cursor:pointer">Close</button>
</div></div>
<script>
let docs=[];let sel=null
async function l(){const r=await fetch('/api/v1/doc-intel/documents');const d=await r.json();docs=d.documents||[];rL()}
function rL(){document.getElementById('b').innerHTML=docs.map(d=>{
const sc=d.ocr_status==='completed'?'completed':d.ocr_status==='completed_with_warnings'?'warnings':'failed'
return \`<tr onclick="sd('\${d.document_id}')"><td>\${d.filename_display||'—'}</td><td>\${d.document_type||'?'}</td>
<td><span class="b b-\${sc}">\${d.ocr_status}</span></td><td>\${d.confidence?(d.confidence*100).toFixed(0)+'%':'—'}</td>
<td>\${new Date(d.created_at*1e3).toLocaleDateString('en-AU')}</td></tr>\`}).join('')}
function f(){const q=document.getElementById('s').value.toLowerCase()
const fl=docs.filter(d=>(d.filename_display||'').toLowerCase().includes(q)||(d.document_type||'').toLowerCase().includes(q))
document.getElementById('b').innerHTML=fl.map(d=>{
const sc=d.ocr_status==='completed'?'completed':d.ocr_status==='completed_with_warnings'?'warnings':'failed'
return \`<tr onclick="sd('\${d.document_id}')"><td>\${d.filename_display||'—'}</td><td>\${d.document_type||'?'}</td>
<td><span class="b b-\${sc}">\${d.ocr_status}</span></td><td>\${d.confidence?(d.confidence*100).toFixed(0)+'%':'—'}</td>
<td>\${new Date(d.created_at*1e3).toLocaleDateString('en-AU')}</td></tr>\`}).join('')}
async function sd(id){sel=id;const p=document.getElementById('d');p.style.display='block'
document.getElementById('dt').textContent='Doc: '+id.slice(0,8)+'...'
const doc=docs.find(d=>d.document_id===id)
if(doc && doc.fields_r2_key){try{
const r=await fetch('/api/v1/doc-intel/documents/download?r2_key='+doc.fields_r2_key);const d=await r.json()
const fs=d.fields||[];document.getElementById('df').innerHTML=fs.map(f=>
\`<div style="display:flex;padding:8px 0;border-bottom:1px solid #2a2a2e"><span style="width:200px;font-weight:500;color:#71717a;font-size:13px">\${f.name}</span>
<span style="flex:1;font-size:14px">\${f.value||''}</span>
<span style="width:60px;text-align:right;font-size:12px;color:#71717a">\${f.confidence?(f.confidence*100).toFixed(0)+'%':''}</span></div>\`).join('')
}catch(e){document.getElementById('df').innerHTML='<div style="color:#71717a;font-size:13px">Fields unavailable</div>'}}
else{document.getElementById('df').innerHTML='<div style="color:#71717a;font-size:13px">No extracted fields</div>'}}
async function up(i){const f=i.files[0];if(!f)return;const fd=new FormData();fd.append('file',f)
const btn=document.querySelector('.toolbar button');btn.textContent='Uploading...';btn.disabled=true
await fetch('/api/v1/doc-intel/ingest',{method:'POST',headers:{'x-tenant':'personal'},body:fd})
btn.textContent='+ Upload';btn.disabled=false;i.value='';setTimeout(l,3000)}
l()
</script></body></html>`)
})

// Ingest — accepts multipart file uploads
docIntelRouter.route('/', ingestRouter)

// Job lifecycle — M1 poller management
docIntelRouter.route('/', jobsRouter)

// Search + audit — document and audit queries
docIntelRouter.route('/', searchRouter)

// Document storage — R2 proxy for the M1 poller
docIntelRouter.route('/', documentsRouter)

// UI — embedded SPA for document browsing
docIntelRouter.route('/', uiRouter)

// Re-export the UI routers for mounting in index.ts
export { docIntelUiRouter, uiRouter }
