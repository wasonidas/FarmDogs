'use strict';
const form=document.getElementById('import-form'),result=document.getElementById('result');
form.addEventListener('submit',async event=>{
 event.preventDefault();const button=form.querySelector('button');button.disabled=true;
 try{
  const input=JSON.parse(document.getElementById('snapshot').value);
  const initial=await fetch('/api/state',{cache:'no-store'});if(!initial.ok)throw Error('El observador no responde.');
  const state=await initial.json();
  const response=await fetch('/api/account/import',{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':state.token},body:JSON.stringify(input)});
  const saved=await response.json();if(!response.ok)throw Error(saved.error||'No se pudo guardar la lectura.');
  result.textContent=`Lectura guardada. Consulta VIP: ${saved.account.vipAt}. Consulta de seeding: ${saved.account.seedingAt}.`;
  document.getElementById('snapshot').value='';
 }catch(error){result.textContent=error.message;}finally{button.disabled=false;}
});
