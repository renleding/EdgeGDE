/**
 * EdgeGDE — Personal Intelligence DB Web UI
 *
 * Uses data-id attributes and event delegation — no inline onclick escaping issues.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'

export const docIntelUiRouter = new Hono()

docIntelUiRouter.get('/', (c) => {
  const p = '<!DOCTYPE html>' +
'<html lang="en">' +
'<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">' +
'<title>EdgeGDE Personal Document DB</title>' +
'<style>' +
'*{margin:0;padding:0;box-sizing:border-box}' +
'body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0b;color:#e4e4e7;min-height:100vh}' +
'.h{padding:16px 20px;border-bottom:1px solid #2a2a2e;display:flex;align-items:center;justify-content:space-between}' +
'.h h1{font-size:16px;color:#3b82f6}' +
'.i{display:flex;gap:12px;align-items:center;font-size:12px;color:#71717a;padding:8px 20px;border-bottom:1px solid #2a2a2e}' +
'.m{max-width:1000px;margin:0 auto;padding:16px}' +
'.tb{display:flex;gap:8px;margin-bottom:12px;align-items:center}' +
'.tb input{flex:1;padding:6px 10px;border-radius:6px;border:1px solid #2a2a2e;background:#141416;color:#e4e4e7;font-size:13px}' +
'.tb button{padding:6px 14px;border-radius:6px;border:none;font-size:13px;cursor:pointer;background:#3b82f6;color:#fff}' +
'.dx{color:#ef4444;cursor:pointer;padding:4px 8px;border-radius:4px;font-size:14px;font-weight:700}' +
'.dx:hover{background:#ef444420}' +
'table{width:100%;border-collapse:collapse;font-size:13px}' +
'th{text-align:left;padding:8px 10px;color:#71717a;border-bottom:1px solid #2a2a2e;font-weight:600}' +
'td{padding:8px 10px;border-bottom:1px solid #2a2a2e}' +
'tr:hover{background:#141416}' +
'.b{padding:2px 6px;border-radius:4px;font-size:11px}' +
'.b-ok{background:#22c55e20;color:#22c55e}' +
'.b-w{background:#eab30820;color:#eab308}' +
'.b-f{background:#ef444420;color:#ef4444}' +
'.e{padding:40px;text-align:center;color:#71717a}' +
'.e p{font-size:15px;margin-bottom:4px}' +
'#dz{position:fixed;top:0;left:0;width:100%;height:100%;background:#3b82f620;border:3px dashed #3b82f6;display:none;align-items:center;justify-content:center;z-index:999;font-size:24px;color:#3b82f6;font-weight:600}' +
'</style></head><body>' +
'<div id="dz">Drop file to upload</div>' +
'<div class="h"><h1>EdgeGDE Personal Document DB</h1></div>' +
'<div class="i"><span id="info-files">0 files</span><span id="info-size">0 KB</span></div>' +
'<div class="m">' +
'<div class="tb"><input id="q" placeholder="Search..." onkeyup="R()">' +
'<button id="ub">+ Upload</button>' +
'<input type="file" id="f" accept="*" style="position:absolute;left:-9999px">' +
'<span id="c" style="font-size:12px;color:#71717a"></span></div>' +
'<table><thead><tr><th>Filename</th><th>Type</th><th>Status</th><th>Conf</th><th>Date</th><th>Size</th><th></th></tr></thead>' +
'<tbody id="b"></tbody></table>' +
'<div id="p" style="display:none;margin-top:12px;padding:16px;border-radius:8px;background:#141416;border:1px solid #2a2a2e">' +
'<div style="display:flex;justify-content:space-between;margin-bottom:12px">' +
'<b id="t" style="font-size:14px"></b>' +
'<span id="pc" style="cursor:pointer;color:#71717a">X</span></div>' +
'<div id="fld"></div></div></div>' +
'<script>' +
'var D=[];' +
'function sz(b){if(!b)return"-";if(b<1024)return b+"B";if(b<1048576)return(b/1024).toFixed(0)+"KB";return(b/1048576).toFixed(1)+"MB"}' +
'function ts(D){var t=0;D.forEach(function(d){if(d.original_size_bytes)t+=d.original_size_bytes});return t}' +
'function up(f,cb){var fd=new FormData();fd.append("file",f);fetch("/api/v1/doc-intel/ingest",{method:"POST",headers:{"x-tenant":"personal"},body:fd}).then(function(r){if(r.ok&&cb)cb()}).catch(function(){})}' +
'function L(){fetch("/api/v1/doc-intel/documents",{headers:{"x-tenant":"personal"}}).then(function(r){return r.json()}).then(function(d){D=d.documents||[];R()}).catch(function(){document.getElementById("b").innerHTML="<tr><td colspan=7 class=e><p>Failed to load documents</p></td></tr>"})}' +
'function R(){var q=(document.getElementById("q").value||"").toLowerCase();var F=D.filter(function(d){return(d.filename_display||"").toLowerCase().indexOf(q)>-1||(d.document_type||"").indexOf(q)>-1});var total=ts(D);document.getElementById("info-files").textContent=F.length+"/"+D.length+" files";document.getElementById("info-size").textContent="Total = "+sz(total);document.getElementById("c").textContent=F.length+"/"+D.length;if(F.length===0){document.getElementById("b").innerHTML=D.length===0?"<tr><td colspan=7 class=e><p>No documents yet</p><small>Click +Upload or drag a file to add your first document</small></td></tr>":"<tr><td colspan=7 class=e><p>No matches</p></td></tr>";return}' +
'document.getElementById("b").innerHTML=F.map(function(d){var s=d.ocr_status||"pending";var sc=s==="completed"?"b-ok":s==="completed_with_warnings"?"b-w":"b-f";var cf=d.confidence!=null?(d.confidence*100).toFixed(0)+"%":"-";var dt=d.created_at?new Date(d.created_at*1000).toLocaleDateString("en-AU"):"-";var id=d.document_id;return"<tr data-id=\\\""+id+"\\\"><td>"+(d.filename_display||"-")+"</td><td>"+(d.document_type||"")+"</td><td><span class=\\\"b "+sc+"\\\">"+s+"</span></td><td>"+cf+"</td><td>"+dt+"</td><td>"+sz(d.original_size_bytes)+"</td><td><span class=dx data-del=\\\""+id+"\\\">X</span></td></tr>"}).join("")}' +
'function O(i){document.getElementById("p").style.display="block";document.getElementById("t").textContent=i.slice(0,8)+"...";var doc=D.find(function(x){return x.document_id===i});if(doc&&doc.fields_r2_key){fetch("/api/v1/doc-intel/documents/download?r2_key="+doc.fields_r2_key).then(function(r){return r.json()}).then(function(d){var fs=d.fields||[];document.getElementById("fld").innerHTML=fs.map(function(f){return"<div class=fr><span class=fn>"+(f.name||"")+"</span><span class=fv>"+(f.value||"")+"</span></div>"}).join("")+"<div class=fr style=margin-top:12px;border-top:1px solid #2a2a2e;padding-top:12px;border-bottom:none><span class=dx data-del=\\\""+i+"\\\">Delete document</span></div>"}).catch(function(){document.getElementById("fld").innerHTML="<div class=fr>Fields unavailable</div>"})}else{document.getElementById("fld").innerHTML="<div class=fr>No extracted fields</div>";document.getElementById("fld").innerHTML+="<div class=fr style=margin-top:12px;border-top:1px solid #2a2a2e;padding-top:12px;border-bottom:none><span class=dx data-del=\\\""+i+"\\\">Delete document</span></div>"}}' +
'function DL(i){if(!confirm("Delete this document and all its data?"))return;fetch("/api/v1/doc-intel/documents/"+i,{method:"DELETE",headers:{"x-tenant":"personal"}}).then(function(r){if(!r.ok)throw Error("Delete failed");document.getElementById("p").style.display="none";L()}).catch(function(e){alert("Failed to delete: "+e.message)})}' +
'document.getElementById("b").onclick=function(e){var tr=e.target.closest("[data-id]");if(tr)O(tr.getAttribute("data-id"));var del=e.target.closest("[data-del]");if(del)DL(del.getAttribute("data-del"))};' +
'document.getElementById("pc").onclick=function(){document.getElementById("p").style.display="none"};' +
'document.getElementById("ub").onclick=function(){document.getElementById("f").click()};' +
'document.getElementById("f").onchange=function(){var btn=document.getElementById("ub");btn.textContent="Uploading...";btn.disabled=true;var f=this;up(f.files[0],function(){btn.textContent="+ Upload";btn.disabled=false;f.value="";setTimeout(L,2000)})};' +
'document.ondragover=function(e){e.preventDefault();document.getElementById("dz").style.display="flex"};' +
'document.ondragleave=function(e){e.preventDefault();document.getElementById("dz").style.display="none"};' +
'document.ondrop=function(e){e.preventDefault();document.getElementById("dz").style.display="none";var f=e.dataTransfer.files[0];if(!f)return;var btn=document.getElementById("ub");btn.textContent="Uploading...";btn.disabled=true;up(f,function(){btn.textContent="+ Upload";btn.disabled=false;setTimeout(L,2000)})};' +
'L()' +
'</script></body></html>'
  return c.html(p)
})
