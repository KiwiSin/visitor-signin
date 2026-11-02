// Roll call API test. Run after scripts/smoke-test.mjs on the same server:
//   node scripts/rollcall-test.mjs http://localhost:8080
const B=process.argv[2]||'http://localhost:8080'; let cookie='';
const j=async(p,o={})=>{const r=await fetch(B+p,{method:o.method||'GET',headers:{...(o.body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(o.h||{})},body:o.body?JSON.stringify(o.body):undefined});const s=r.headers.get('set-cookie');if(s&&!o.h)cookie=s.split(';')[0];const t=await r.text();if(!r.ok)throw new Error(p+' '+r.status+' '+t);return r.headers.get('content-type')?.includes('json')?JSON.parse(t):t;};
const ok=(c,m)=>{if(!c)throw new Error('FAIL '+m);console.log('  ✓',m)};
await j('/api/auth/login',{method:'POST',body:{email:'admin@acme.co.nz',password:'correct-horse-battery'}});
const staff=await j('/api/admin/staff'); const jane=staff.find(s=>s.name==='Jane Wilson');
const groups=await j('/api/admin/groups'); const fw=groups.find(g=>g.key==='fire_warden');
ok(jane.group_ids.includes(fw.id),'Jane is in the Fire warden group (from the CSV role)');
const link=await j(`/api/admin/staff/${jane.id}/phone-link`,{method:'POST',body:{send:false}});
const invite=link.url.split('#invite=')[1]; ok(invite&&link.url.includes('/me#invite='),'staff phone link made');
const admCookie=cookie; cookie='';
const claim=await j('/api/me/claim',{method:'POST',body:{invite},h:{}});
const W={'X-Staff-Token':claim.token};
ok((await j('/api/me',{h:W})).isWarden===true,'phone app knows Jane is a fire warden');
let r=await fetch(B+'/api/rollcall/state'); ok(r.status===401,'no access without link');
const st=await j('/api/rollcall/state',{h:W}); ok(st.me.name==='Jane Wilson'&&st.people.length>=2,`warden sees ${st.people.length} people on site, no active roll call: ${st.active===null}`);
// Device A (offline) started at T, marked someone; device B starts online slightly later
const t0=new Date(Date.now()-60000).toISOString();
const p0=st.people[0], p1=st.people[1];
const B1=await j('/api/rollcall/sync',{method:'POST',h:W,body:{clientId:'devB',startedAt:new Date().toISOString(),marks:[{personKey:p1.personKey,status:'safe',at:new Date().toISOString()}]}});
ok(B1.entries.length===st.people.length,'device B started roll call with snapshot of everyone on site');
const A1=await j('/api/rollcall/sync',{method:'POST',h:W,body:{clientId:'devA',startedAt:t0,marks:[{personKey:p0.personKey,status:'safe',at:t0},{personKey:'extra:x1',status:'safe',at:t0,name:'Courier not signed in',kind:'extra'}]}});
ok(A1.id===B1.id,'offline device A joins the same roll call (no duplicate)');
ok(A1.entries.find(e=>e.personKey===p0.personKey).status==='safe'&&A1.entries.find(e=>e.personKey==='extra:x1'),'A\'s offline marks and added person merged');
const old=new Date(Date.now()-120000).toISOString();
const A2=await j('/api/rollcall/sync',{method:'POST',h:W,body:{clientId:'devA',marks:[{personKey:p1.personKey,status:'missing',at:old}]}});
ok(A2.entries.find(e=>e.personKey===p1.personKey).status==='safe','older mark does not overwrite a newer one');
// tablet access
cookie=admCookie; const k=await j('/api/admin/kiosks'); 
const st2=await j('/api/rollcall/state'); ok(st2.active&&st2.active.id===B1.id,'admin sees active roll call');
await j('/api/rollcall/sync',{method:'POST',body:{clientId:B1.clientId,ended:true}});
const st3=await j('/api/rollcall/state'); ok(!st3.active&&st3.lastEnded.id===B1.id,'roll call ended');
const list=await j('/api/admin/rollcalls'); ok(list[0].safe===3&&list[0].total===st.people.length+1,`report: ${list[0].safe} safe of ${list[0].total}`);
const csv=await j(`/api/admin/rollcalls/${B1.id}/csv`); ok(csv.includes('NOT ACCOUNTED FOR')||csv.includes('Safe'),'CSV report');
const n=await j('/api/admin/notifications'); ok(n.some(x=>x.kind==='rollcall'),'roll call email queued to wardens/reception');
await j(`/api/admin/staff/${jane.id}/groups`,{method:'PUT',body:{groupIds:[]}}); 
r=await fetch(B+'/api/rollcall/state',{headers:W}); ok(r.status===401,'taken out of Fire warden group: no roll call access');
r=await fetch(B+'/api/me',{headers:W}); ok(r.status===200,'…but phone sign-in still works');
await j(`/api/admin/staff/${jane.id}/groups`,{method:'PUT',body:{groupIds:[fw.id]}});
await j(`/api/admin/staff/${jane.id}/phone`,{method:'DELETE'}); cookie='';
r=await fetch(B+'/api/rollcall/state',{headers:W}); ok(r.status===401,'removed phone stops working');
console.log('roll call API OK');
