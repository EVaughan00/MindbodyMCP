import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, requireAdmin } from '../src/http.js';

// Served at /admin (see vercel.json rewrites). Password-protected via ADMIN_PASSWORD.
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (!requireAdmin(req, res)) return;
  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(PAGE);
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mindbody MCP — Admin</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e8eaed;margin:0;padding:32px}
  h1{font-size:20px;margin:0 0 4px}
  .sub{color:#9aa0aa;font-size:13px;margin:0 0 24px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;max-width:1000px}
  @media(max-width:780px){.grid{grid-template-columns:1fr}}
  .card{background:#1a1d24;border:1px solid #2a2f3a;border-radius:12px;padding:20px}
  h2{font-size:15px;margin:0 0 14px}
  label{display:block;font-size:12px;color:#9aa0aa;margin:12px 0 5px}
  input{width:100%;padding:9px 11px;border-radius:7px;border:1px solid #2a2f3a;background:#0f1115;color:#e8eaed;font-size:13px}
  button{margin-top:18px;padding:10px 16px;border:0;border-radius:7px;background:#4f8cff;color:#fff;font-size:13px;font-weight:600;cursor:pointer}
  button:hover{background:#3d7bef}
  button.danger{background:#3a1d22;color:#ffb4bd;margin:0}
  button.danger:hover{background:#52262e}
  .tenant{border:1px solid #2a2f3a;border-radius:9px;padding:12px 14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:10px}
  .tenant .meta{font-size:12px;color:#9aa0aa;margin-top:3px}
  .tenant code{color:#4f8cff}
  .msg{font-size:13px;margin-top:12px;min-height:18px}
  .msg.ok{color:#7ee0a2}.msg.err{color:#ffb4bd}
  .hint{font-size:11px;color:#6b7280;margin-top:4px}
  .empty{color:#6b7280;font-size:13px}
</style></head>
<body>
  <h1>Mindbody MCP — Admin</h1>
  <p class="sub">Manage studio tenants. Each tenant connects via Claude using its Tenant ID + password.</p>
  <div class="grid">
    <div class="card">
      <h2>Add / update tenant</h2>
      <form id="form">
        <label>Tenant ID <span class="hint">(slug used at login; lowercase)</span></label>
        <input name="id" required placeholder="downtown-yoga">
        <label>Display name</label>
        <input name="name" placeholder="Downtown Yoga">
        <label>Login password <span class="hint">(blank = keep existing on update)</span></label>
        <input name="password" type="text" placeholder="set a password for this studio">
        <label>Mindbody API Key</label>
        <input name="mindbodyApiKey" placeholder="(blank = keep existing)">
        <label>Mindbody Site ID</label>
        <input name="mindbodySiteId" placeholder="-99">
        <label>Source name</label>
        <input name="mindbodySourceName" placeholder="(blank = keep existing)">
        <label>Source password</label>
        <input name="mindbodySourcePassword" placeholder="(blank = keep existing)">
        <label>API URL <span class="hint">(optional override)</span></label>
        <input name="mindbodyApiUrl" placeholder="https://api.mindbodyonline.com/public/v6">
        <button type="submit">Save tenant</button>
        <div id="msg" class="msg"></div>
      </form>
    </div>
    <div class="card">
      <h2>Tenants</h2>
      <div id="list" class="empty">Loading…</div>
    </div>
  </div>
<script>
const api='/api/admin/tenants';
const msg=document.getElementById('msg');
function show(t,ok){msg.textContent=t;msg.className='msg '+(ok?'ok':'err');}
async function load(){
  const r=await fetch(api);
  if(!r.ok){document.getElementById('list').textContent='Failed to load ('+r.status+')';return;}
  const {tenants}=await r.json();
  const el=document.getElementById('list');
  if(!tenants.length){el.className='empty';el.textContent='No tenants yet.';return;}
  el.className='';
  el.innerHTML=tenants.map(t=>\`<div class="tenant"><div>
    <div><code>\${t.id}</code> — \${escapeHtml(t.name)}</div>
    <div class="meta">site \${escapeHtml(t.mindbodySiteId)} · key \${t.hasApiKey?'set':'—'} · source \${t.hasSourcePassword?'set':'—'}</div>
  </div><button class="danger" data-id="\${t.id}">Delete</button></div>\`).join('');
  el.querySelectorAll('button.danger').forEach(b=>b.onclick=()=>del(b.dataset.id));
}
function escapeHtml(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
document.getElementById('form').onsubmit=async e=>{
  e.preventDefault();
  const data=Object.fromEntries(new FormData(e.target).entries());
  const r=await fetch(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const j=await r.json().catch(()=>({}));
  if(r.ok){show('Saved tenant "'+j.tenant.id+'".',true);e.target.reset();load();}
  else show(j.error||('Error '+r.status),false);
};
async function del(id){
  if(!confirm('Delete tenant "'+id+'"?'))return;
  const r=await fetch(api+'?id='+encodeURIComponent(id),{method:'DELETE'});
  if(r.ok){show('Deleted "'+id+'".',true);load();}else show('Delete failed',false);
}
load();
</script>
</body></html>`;
