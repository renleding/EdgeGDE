/**
 * EdgeGDE — Personal Document DB Web UI
 *
 * Password-protected UI with sister page showing extracted fields.
 * Password via ?pw= query parameter.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono'
import { resolveBindings } from './lib/errors'
import { queryAll } from './lib/db'
import { decryptFields } from '../../lib/encryption'

const PAGE_PASSWORD = 'EdgeGDE2024'

export const docIntelUiRouter = new Hono()

// ── Password gate helper ──────────────────────────────────────────────────

function checkPw(c: any): boolean {
  const pw = c.req.query('pw') || ''
  return pw === PAGE_PASSWORD
}

function loginPage(): string {
  return '<!DOCTYPE html>' +
'<html lang="en">' +
'<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">' +
'<title>EdgeGDE Personal Document DB</title>' +
'<style>' +
'*{margin:0;padding:0;box-sizing:border-box}' +
'body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh}' +
'.c{text-align:center}' +
'.c h1{font-size:18px;color:#3b82f6;margin-bottom:24px}' +
'.c input{padding:10px 14px;border-radius:8px;border:1px solid #2a2a2e;background:#141416;color:#e4e4e7;font-size:14px;width:240px;outline:none}' +
'.c input:focus{border-color:#3b82f6}' +
'.c button{margin-top:12px;padding:10px 24px;border-radius:8px;border:none;font-size:14px;cursor:pointer;background:#3b82f6;color:#fff}' +
'.c .e{color:#ef4444;font-size:12px;margin-top:8px;display:none}' +
'</style></head><body>' +
'<div class="c">' +
'<h1>EdgeGDE Personal Document DB</h1>' +
'<input id="p" type="password" placeholder="Enter password" onkeydown="if(event.key===\'Enter\')go()">' +
'<br><button onclick="go()">Access</button>' +
'<div class="e" id="e">Incorrect password</div>' +
'</div>' +
'<script>' +
'function go(){var p=document.getElementById("p").value;if(!p)return;window.location.href="?pw="+encodeURIComponent(p)}' +
'</script></body></html>'
}

// ── Fields sister page ────────────────────────────────────────────────────

function fmtDate(v: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const parts = v.split('-')
    return parts[2] + '-' + parts[1] + '-' + parts[0]
  }
  return v
}

function fieldsPage(allFields: any[], docs: any[]): string {
  let rows = ''
  for (const f of allFields) {
    const isOverride = f.overridden
    const raw = isOverride ? f.overrideValue : f.field_value
    const fname = f.field_name
    const val = /date|dob|expiry/i.test(fname) ? fmtDate(raw) : raw
    const docType = f.document_type || '?'
    const conf = f.confidence != null ? (f.confidence * 100).toFixed(0) + '%' : '\u2014'
    const docId = f.document_id
    const overrideClass = isOverride ? ' ov' : ''
    const badge = isOverride ? '<span class="ob">edited</span>' : ''
    rows += '<tr>' +
      '<td class="fn" id="fn-' + docId + '-' + fname + '">' + fname + '</td>' +
      '<td class="vl' + overrideClass + '" id="v-' + docId + '-' + fname + '">' + val + '</td>' +
      '<td class="vc">' + conf + '</td>' +
      '<td>' + docType + '</td>' +
      '<td>' + badge + '</td>' +
      '<td class="ac"><span class="ed" data-docid="' + docId + '" data-fname="' + fname + '">edit</span>' +
      '<span class="dx" data-del="' + docId + '" data-fname="' + fname + '">X</span></td>' +
    '</tr>'
  }

  let docOpts = ''
  for (const d of docs) {
    const label = (d.filename_display || d.document_id).slice(0, 24)
    docOpts += '<option value="' + d.document_id + '">' + label + '</option>'
  }

  return '<!DOCTYPE html>' +
'<html lang="en">' +
'<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">' +
'<title>EdgeGDE Document Fields</title>' +
'<style>' +
'*{margin:0;padding:0;box-sizing:border-box}' +
'body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0b;color:#e4e4e7}' +
'.h{padding:16px 20px;border-bottom:1px solid #2a2a2e;display:flex;align-items:center;justify-content:space-between}' +
'.h h1{font-size:16px;color:#3b82f6}' +
'.h a{font-size:12px;color:#71717a;text-decoration:none}' +
'.h a:hover{color:#3b82f6}' +
'.m{max-width:1200px;margin:0 auto;padding:16px}' +
'.s{font-size:12px;color:#71717a;margin-bottom:12px}' +
'table{width:100%;border-collapse:collapse;font-size:13px}' +
'th{text-align:left;padding:8px 10px;color:#71717a;border-bottom:1px solid #2a2a2e;font-weight:600}' +
'td{padding:8px 10px;border-bottom:1px solid #2a2a2e}' +
'tr:hover{background:#141416}' +
'.fn{width:160px;color:#71717a;font-size:12px;font-weight:500}' +
'.vl{flex:1;font-size:13px}' +
'.vl.ov{color:#22c55e}' +
'.vc{width:60px;font-size:12px;color:#71717a}' +
'.ac{width:90px}' +
'.ob{padding:2px 6px;border-radius:4px;font-size:10px;background:#22c55e20;color:#22c55e}' +
'.ed{cursor:pointer;font-size:12px;color:#71717a}' +
'.ed:hover{color:#3b82f6}' +
'.dx{cursor:pointer;font-size:12px;color:#ef4444;margin-left:10px;padding:2px 6px;border-radius:4px}' +
'.dx:hover{background:#ef444420}' +
'.dl{cursor:pointer;font-size:12px;color:#ef4444;margin-left:8px}' +
'.dl:hover{color:#ff6b6b}' +
'.ei{border:1px solid #3b82f6;background:#141416;color:#e4e4e7;padding:4px 8px;border-radius:4px;font-size:13px;width:100%}' +
'.es{cursor:pointer;font-size:12px;color:#22c55e;margin-left:8px}' +
'.ec{cursor:pointer;font-size:12px;color:#ef4444;margin-left:4px}' +
'.af{margin-top:16px;padding:12px;background:#141416;border-radius:8px;border:1px solid #2a2a2e;display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
'.af select,.af input{padding:6px 10px;border-radius:6px;border:1px solid #2a2a2e;background:#0a0a0b;color:#e4e4e7;font-size:12px}' +
'.af button{padding:6px 14px;border-radius:6px;border:none;font-size:12px;cursor:pointer;background:#3b82f6;color:#fff}' +
'</style></head><body>' +
'<div class="h"><h1>EdgeGDE Document Fields</h1><a href="/api/v1/doc-intel/ui?pw=' + PAGE_PASSWORD + '">\u2190 Back to Documents</a></div>' +
'<div class="m">' +
'<div class="s">' + allFields.length + ' fields across all documents</div>' +
'<table><thead><tr><th>Field</th><th>Value</th><th>Conf</th><th>Document</th><th></th><th></th></tr></thead>' +
'<tbody>' + rows + '</tbody></table>' +
'<div class="af"><select id="ad">' + docOpts + '</select>' +
'<input id="afn" placeholder="Field name">' +
'<input id="afv" placeholder="Value">' +
'<button onclick="addF()">+ Add Field</button></div></div>' +
'<script>' +
'var E=null;' +
'function addF(){var d=document.getElementById("ad").value;var n=document.getElementById("afn").value;var v=document.getElementById("afv").value;if(!n||!v)return;fetch("/api/v1/doc-intel/documents/custom-fields",{method:"POST",headers:{"Content-Type":"application/json","x-tenant":"personal"},body:JSON.stringify({document_id:d,field_name:n,field_value:v})}).then(function(r){if(r.ok)location.reload();else alert("Add field failed: "+r.status)})["catch"](function(e){alert("Add field error: "+e)})}' +
'window.addEventListener("click",function(e){var x=e.target.closest("[data-del]");if(x&&x.getAttribute("data-del")){if(!confirm("Delete this field?"))return;fetch("/api/v1/doc-intel/fields/"+encodeURIComponent(x.getAttribute("data-del"))+"/"+encodeURIComponent(x.getAttribute("data-fname")),{method:"DELETE",headers:{"x-tenant":"personal"}}).then(function(r){if(r.ok)location.reload();else alert("Delete failed: "+r.status)})["catch"](function(){alert("Network error")});return}var ed=e.target.closest(".ed");if(ed&&!x){E={d:ed.getAttribute("data-docid"),f:ed.getAttribute("data-fname")};var nc=document.getElementById("fn-"+E.d+"-"+E.f);var vc=document.getElementById("v-"+E.d+"-"+E.f);E.o=E.f;nc.innerHTML="";var ni=document.createElement("input");ni.className="ei";ni.id="inpN";ni.value=E.f;ni.style.width="140px";nc.appendChild(ni);vc.innerHTML="";var vi=document.createElement("input");vi.className="ei";vi.id="inpV";vi.value=vc.textContent;vc.appendChild(vi);var sb=document.createElement("span");sb.className="es";sb.setAttribute("data-act","sv");sb.textContent="save";vc.appendChild(sb);var cb=document.createElement("span");cb.className="ec";cb.setAttribute("data-act","cl");cb.textContent="x";vc.appendChild(cb);document.getElementById("inpN").focus()};var sv=e.target.closest("[data-act=sv]");if(sv&&E){var inpN=document.getElementById("inpN");var inpV=document.getElementById("inpV");var nn=(inpN&&inpN.value)||E.f;var nv=(inpV&&inpV.value)||"";if(!nv&&nv!=="")return;fetch("/api/v1/doc-intel/fields/"+encodeURIComponent(E.d)+"/"+encodeURIComponent(E.o||E.f),{method:"PUT",headers:{"Content-Type":"application/json","x-tenant":"personal"},body:JSON.stringify({value:nv,field_name:nn})}).then(function(r){if(r.ok)location.reload();else alert("Save failed: "+r.status)})["catch"](function(){alert("Save network error")})}var cl=e.target.closest("[data-act=cl]");if(cl&&E){var nc2=document.getElementById("fn-"+E.d+"-"+E.f);var vc2=document.getElementById("v-"+E.d+"-"+E.f);nc2.innerHTML=E.o||E.f;vc2.innerHTML=""}})' +
'</script></body></html>'
}

// ── Route: fields sister page ─────────────────────────────────────────────

docIntelUiRouter.get('/fields', async (c) => {
  if (!checkPw(c)) {
    return c.html(loginPage())
  }

  try {
    const tenant = (c.req.header('x-tenant') || 'personal') as 'personal' | 'afirmico'
    const bindings = resolveBindings(c.env as Record<string, unknown>, tenant)
    if (bindings instanceof Response) return bindings
    const { db, r2 } = bindings

    const docs = await queryAll<any>(
      db,
      `SELECT document_id, document_type, filename_display, ocr_status, confidence, fields_r2_key, created_at
       FROM documents ORDER BY created_at DESC LIMIT 200`,
    )

    // Build flat list of all fields across all documents (unique by field name)
    const allFields: any[] = []
    const seen = new Set<string>()
    for (const doc of docs) {
      let docFields: any[] = []

      if (doc.fields_r2_key) {
        try {
          const obj = await r2.get(doc.fields_r2_key)
          if (obj) {
            const raw = await obj.json() as Record<string, unknown>
            const ef = (raw.encrypted_fields || raw.fields || []) as Record<string, unknown>[]
            if (ef.length > 0 && ef[0].field_value_encrypted) {
              const decrypted = await decryptFields(
                ef.map((f: Record<string, unknown>) => ({
                  field_name: f.field_name as string,
                  field_value_encrypted: f.field_value_encrypted as string,
                  key_version: (f.key_version ?? 1) as number,
                  data_classification: (f.classification ?? 'CONFIDENTIAL') as string,
                })),
                db,
                tenant,
                c.env as Record<string, unknown>,
              )
              docFields = decrypted || []
            } else {
              docFields = ef
            }
          }
        } catch {}
      }

      const overrides = await queryAll<any>(
        db,
        `SELECT field_name, field_value FROM custom_fields WHERE document_id = ?`,
        doc.document_id,
      )
      // Build override map and tombstone set
      const overrideMap: Record<string, string> = {}
      const tombstone = new Set<string>()
      for (const ov of overrides) {
        if (ov.field_value && ov.field_value.startsWith('MANUAL_OVERRIDE:')) {
          overrideMap[ov.field_name] = ov.field_value.substring(16)
        } else if (ov.field_value === '_DELETED_') {
          tombstone.add(ov.field_name)
        }
      }

      // Track unique field names globally
      for (const f of docFields) {
        const fname = f.field_name || f.name || ''
        if (seen.has(fname)) continue
        if (tombstone.has(fname)) { seen.add(fname); continue }
        seen.add(fname)
        const overridden = overrideMap[fname] !== undefined
        allFields.push({
          field_name: fname,
          field_value: f.field_value || f.value || '',
          confidence: doc.confidence,
          document_id: doc.document_id,
          document_type: doc.document_type,
          overridden,
          overrideValue: overrideMap[fname] || '',
        })
      }

      for (const [key, val] of Object.entries(overrideMap)) {
        if (seen.has(key) || tombstone.has(key)) continue
        if (!docFields.some((f: any) => (f.field_name || f.name) === key)) {
          seen.add(key)
          allFields.push({
            field_name: key,
            field_value: '',
            confidence: doc.confidence,
            document_id: doc.document_id,
            document_type: doc.document_type,
            overridden: true,
            overrideValue: val,
          })
        }
      }
    }

    return c.html(fieldsPage(allFields, docs))
  } catch (err: any) {
    return c.html('<h1>Error: ' + err.message + '</h1>')
  }
})

// ── Route: main UI ────────────────────────────────────────────────────────

docIntelUiRouter.get('/', (c) => {
  if (!checkPw(c)) {
    return c.html(loginPage())
  }

  const p = '<!DOCTYPE html>' +
'<html lang="en">' +
'<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">' +
'<title>EdgeGDE Personal Document DB</title>' +
'<style>' +
'*{margin:0;padding:0;box-sizing:border-box}' +
'body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0b;color:#e4e4e7;min-height:100vh}' +
'.h{padding:16px 20px;border-bottom:1px solid #2a2a2e;display:flex;align-items:center;justify-content:space-between}' +
'.h h1{font-size:16px;color:#3b82f6}' +
'.h a{font-size:12px;color:#71717a;text-decoration:none}' +
'.h a:hover{color:#3b82f6}' +
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
'<div class="h"><h1>EdgeGDE Personal Document DB</h1><a href="/api/v1/doc-intel/ui/fields?pw=' + PAGE_PASSWORD + '">View Fields &#8594;</a></div>' +
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
