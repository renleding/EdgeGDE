/**
 * EdgeGDE — Personal Intelligence DB Web UI
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
'body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0b;color:#e4e4e7}' +
'.h{padding:16px 20px;border-bottom:1px solid #2a2a2e;display:flex;align-items:center;justify-content:space-between}' +
'.h h1{font-size:16px;color:#3b82f6}' +
'.m{max-width:1000px;margin:0 auto;padding:16px}' +
'.tb{display:flex;gap:8px;margin-bottom:12px}' +
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
'</style></head><body>' +
'<div class="h"><h1>EdgeGDE Personal Document DB</h1></div>' +
'<div class="m">' +
'<div class="tb"><input id="q" placeholder="Search..." onkeyup="R()">' +
'<button onclick="U()">+ Upload</button>' +
'<input type="file" id="f" style="display:none">' +
'<span id="c" style="font-size:12px;color:#71717a;line-height:32px"></span></div>' +
'<table><thead><tr><th>Filename</th><th>Type</th><th>Status</th><th>Conf</th><th>Date</th><th></th></tr></thead>' +
'<tbody id="b"></tbody></table>' +
'<div id="p" style="display:none;margin-top:12px;padding:16px;border-radius:8px;background:#141416;border:1px solid #2a2a2e">' +
'<div style="display:flex;justify-content:space-between;margin-bottom:12px">' +
'<b id="t" style="font-size:14px"></b>' +
'<span style="cursor:pointer;color:#71717a" onclick="document.getElementById(\'p\').style.display=\'none\'">X</span></div>' +
'<div id="fld"></div></div></div>' +
'<script>' +
'var D=[];' +
'function L(){fetch("/api/v1/doc-intel/documents",{headers:{"x-tenant":"personal"}}).then(function(r){return r.json()}).then(function(d){D=d.documents||[];R()}).catch(function(){document.getElementById("b").innerHTML="<tr><td colspan=6 class=e><p>Failed to load documents</p></td></tr>"})}' +
'function R(){var q=(document.getElementById("q").value||"").toLowerCase();var F=D.filter(function(d){return(d.filename_display||"").toLowerCase().indexOf(q)>-1||(d.document_type||"").indexOf(q)>-1});document.getElementById("c").textContent=F.length+"/"+D.length;if(F.length===0){document.getElementById("b").innerHTML=D.length===0?"<tr><td colspan=6 class=e><p>No documents yet</p><small>Click +Upload to add your first document</small></td></tr>":"<tr><td colspan=6 class=e><p>No matches</p></td></tr>";return}' +
'document.getElementById("b").innerHTML=F.map(function(d){var s=d.ocr_status||"pending";var sc=s==="completed"?"b-ok":s==="completed_with_warnings"?"b-w":"b-f";var cf=d.confidence!=null?(d.confidence*100).toFixed(0)+"%":"-";var dt=d.created_at?new Date(d.created_at*1000).toLocaleDateString("en-AU"):"-";var id=d.document_id;return"<tr><td onclick=\'O("+id+")\'>"+(d.filename_display||"-")+"</td><td onclick=\'O("+id+")\'>"+(d.document_type||"")+"</td><td onclick=\'O("+id+")\'><span class=\\"b "+sc+"\\">"+s+"</span></td><td onclick=\'O("+id+")\'>"+cf+"</td><td onclick=\'O("+id+")\'>"+dt+"</td><td><span class=dx onclick=\'DL("+id+")\'>X</span></td></tr>"}).join("")}' +
'function O(i){var p=document.getElementById("p");p.style.display="block";document.getElementById("t").textContent=i.slice(0,8)+"...";var doc=D.find(function(x){return x.document_id===i});if(doc&&doc.fields_r2_key){fetch("/api/v1/doc-intel/documents/download?r2_key="+doc.fields_r2_key).then(function(r){return r.json()}).then(function(d){var fs=d.fields||[];document.getElementById("fld").innerHTML=fs.map(function(f){return"<div class=fr><span class=fn>"+(f.name||"")+"</span><span class=fv>"+(f.value||"")+"</span></div>"}).join("")+"<div class=fr style=margin-top:12px;border-top:1px solid #2a2a2e;padding-top:12px;border-bottom:none><span class=dx onclick=\'DL("+i+")\'>Delete document</span></div>"}).catch(function(){document.getElementById("fld").innerHTML="<div class=fr>Fields unavailable</div>"})}else{document.getElementById("fld").innerHTML="<div class=fr>No extracted fields</div>";document.getElementById("fld").innerHTML+="<div class=fr style=margin-top:12px;border-top:1px solid #2a2a2e;padding-top:12px;border-bottom:none><span class=dx onclick=\'DL("+i+")\'>Delete document</span></div>"}}' +
'function DL(i){if(!confirm("Delete this document and all its data?"))return;fetch("/api/v1/doc-intel/documents/"+i,{method:"DELETE",headers:{"x-tenant":"personal"}}).then(function(r){if(!r.ok)throw Error("Delete failed");document.getElementById("p").style.display="none";L()}).catch(function(e){alert("Failed to delete: "+e.message)})}' +
'function U(){document.getElementById("f").click()}' +
'document.getElementById("f").onchange=function(){var f=this.files[0];if(!f)return;var fd=new FormData();fd.append("file",f);var btn=document.querySelector(".tb button");btn.textContent="Uploading...";btn.disabled=true;fetch("/api/v1/doc-intel/ingest",{method:"POST",headers:{"x-tenant":"personal"},body:fd}).then(function(){btn.textContent="+ Upload";btn.disabled=false;document.getElementById("f").value="";setTimeout(L,3000)}).catch(function(){btn.textContent="+ Upload";btn.disabled=false})}' +
'L()' +
'</script></body></html>'
  return c.html(p)
})
