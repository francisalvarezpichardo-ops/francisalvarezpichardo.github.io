
// ── STORAGE ──────────────────────────────────────────────────
const DB = {
  get: k => JSON.parse(localStorage.getItem('fjap_'+k)||'null'),
  set: (k,v) => localStorage.setItem('fjap_'+k,JSON.stringify(v)),
  push: (k,item) => { const a=DB.get(k)||[]; a.push(item); DB.set(k,a); return item; },
  update: (k,id,patch) => { const a=DB.get(k)||[]; const i=a.findIndex(x=>x.id===id); if(i!==-1){a[i]={...a[i],...patch};DB.set(k,a);return a[i];}return null; },
  find:   (k,pred) => (DB.get(k)||[]).find(pred),
  filter: (k,pred) => (DB.get(k)||[]).filter(pred),
  nextId: k => { const n=(DB.get('seq_'+k)||0)+1; DB.set('seq_'+k,n); return n; }
};

// ── CURRENCIES ────────────────────────────────────────────────
const CURRENCIES = [
  {code:'DOP',name:'Peso Dominicano',flag:'🇩🇴',sym:'RD$'},
  {code:'USD',name:'Dólar Americano',flag:'🇺🇸',sym:'$'},
  {code:'EUR',name:'Euro',flag:'🇪🇺',sym:'€'},
  {code:'MXN',name:'Peso Mexicano',flag:'🇲🇽',sym:'$'},
  {code:'COP',name:'Peso Colombiano',flag:'🇨🇴',sym:'$'},
  {code:'BRL',name:'Real Brasileño',flag:'🇧🇷',sym:'R$'},
];
const curSym  = c => (CURRENCIES.find(x=>x.code===c)||{}).sym||'$';
const curFlag = c => (CURRENCIES.find(x=>x.code===c)||{}).flag||'🌐';

// ── MATH ──────────────────────────────────────────────────────
function calcMonthly(p,r,m){if(r===0)return p/m;const mo=r/100/12;return(p*mo*Math.pow(1+mo,m))/(Math.pow(1+mo,m)-1);}
function buildAmortization(p,r,m){
  const mo=r/100/12,monthly=calcMonthly(p,r,m);let bal=p;const rows=[];const now=new Date();
  for(let i=1;i<=m;i++){const int=bal*mo,pri=monthly-int;bal=Math.max(0,bal-pri);const d=new Date(now);d.setMonth(d.getMonth()+i);rows.push({period:i,date:d.toLocaleDateString('es',{month:'short',year:'numeric'}),principal:+pri.toFixed(2),interest:+int.toFixed(2),payment:+monthly.toFixed(2),balance:+bal.toFixed(2)});}
  return rows;
}

// ── CREDIT SCORING ────────────────────────────────────────────
function calculateAge(s){if(!s)return NaN;const b=new Date(s);return isNaN(b)?NaN:Math.floor((Date.now()-b)/(365.25*24*3600*1000));}
function checkOverdueLoans(){return currentUser?DB.filter('loans',l=>l.userId===currentUser.id&&l.status==='overdue').length>0:false;}
function checkCooldown(){if(!currentUser)return null;const k='rejection_cooldown_'+currentUser.id;const c=DB.get(k);if(!c)return null;const d=(Date.now()-new Date(c.rejectedAt))/(1000*3600*24);if(d<30)return Math.ceil(30-d);DB.set(k,null);return null;}
function getTrustBonus(){if(!currentUser)return 0;const p=DB.filter('loans',l=>l.userId===currentUser.id&&l.status==='paid').length;return p>=3?80:p>=2?55:p>=1?30:0;}

function advancedCreditScore({monthlyIncome,debtLevel,employmentYears,amount,termMonths,age,purpose,dependents,occupationType}){
  const hR=[],warn=[];
  if(isNaN(age)||age<18)hR.push({phase:1,code:'AGE_LOW',reason:'Edad mínima requerida: 18 años.'});
  if(age>70)hR.push({phase:1,code:'AGE_HIGH',reason:'Edad máxima permitida: 70 años.'});
  const inc=monthlyIncome||0,debt=debtLevel||0;
  if(!inc||inc<5000)hR.push({phase:2,code:'INCOME_LOW',reason:'Ingreso mínimo requerido: RD$5,000/mes.'});
  const dti=inc>0?(debt/inc)*100:999;
  if(dti>55)hR.push({phase:2,code:'DTI_CRITICAL',reason:`DTI crítico: ${dti.toFixed(1)}%. Máximo: 55%.`});
  else if(dti>40)warn.push('DTI elevado ('+dti.toFixed(1)+'%).');
  const emp=employmentYears||0;
  if(emp<0.5&&amount>15000)hR.push({phase:4,code:'EMP_TOO_SHORT',reason:'Mínimo 6 meses de antigüedad para montos > RD$15,000.'});
  const ir=inc>0?amount/inc:999;
  if(ir>10)hR.push({phase:4,code:'RATIO_CRITICAL',reason:'Monto supera 10x el ingreso mensual.'});
  else if(ir>6)warn.push('Monto alto en relación al ingreso ('+ir.toFixed(1)+'x).');
  const tb=getTrustBonus();
  let score=330+tb;
  score+=Math.min(180,(inc/20000)*160);
  score+=dti<8?140:dti<15?115:dti<25?85:dti<35?50:dti<45?20:5;
  score+=Math.min(95,emp*24);
  const ltv=amount/(inc*termMonths||1);
  score+=ltv<0.25?110:ltv<0.45?85:ltv<0.70?60:ltv<1.1?30:8;
  const pAdj={negocio:28,vehiculo:18,hogar:22,educacion:20,salud:15,deudas:-18,otros:0};
  score+=pAdj[purpose]||0;
  const oAdj={empresario:20,independiente:5,empleado:10,jubilado:15,otro:0};
  score+=oAdj[occupationType]||0;
  score-=Math.min(50,(dependents||0)*9);
  score=Math.round(Math.min(900,Math.max(200,score)));
  let approved=hR.length===0,ir2=null,riskTier=null;
  if(approved){if(score>=800){ir2=11.5;riskTier='AAA';}else if(score>=720){ir2=13.5;riskTier='AA';}else if(score>=650){ir2=16;riskTier='A';}else if(score>=570){ir2=21;riskTier='B';}else if(score>=550){ir2=26;riskTier='C';}else{approved=false;riskTier='D';}}
  return{score,hardRejects:hR,warnings:warn,approved,interestRate:ir2,riskTier,dti:+dti.toFixed(1),incomeRatio:+ir.toFixed(1),trustBonus:tb};
}

function buildVerificationPhases(params,s){
  const{hardRejects,warnings,score,dti,approved,interestRate,riskTier,trustBonus}=s;
  const fR=ph=>hardRejects.find(r=>r.phase===ph);
  const phases=[];let blocked=false;
  const r1=fR(1);
  phases.push({icon:'🪪',label:'Verificación de Identidad',subtext:'Cédula, edad, dirección',duration:1900,status:r1?'fail':'pass',resultText:r1?r1.reason:`Identidad confirmada · ${params.age} años`,hardFail:!!r1});
  if(r1)blocked=true;
  const r2=blocked?null:fR(2);
  phases.push({icon:'💰',label:'Capacidad de Pago',subtext:'Ingresos, deudas, DTI',duration:2300,status:blocked?'skipped':r2?'fail':dti>=25?'warning':'pass',resultText:blocked?'No evaluado':r2?r2.reason:`DTI: ${dti}% ${dti>=25?'⚠':'✓'}`,hardFail:!blocked&&!!r2});
  if(!blocked&&r2)blocked=true;
  const ov=!blocked&&checkOverdueLoans();
  phases.push({icon:'📋',label:'Historial Crediticio FJAP',subtext:'Comportamiento previo, morosidades',duration:2100,status:blocked?'skipped':ov?'fail':'pass',resultText:blocked?'No evaluado':ov?'Préstamo vencido — bloqueado':trustBonus>0?`Bono +${trustBonus} pts ✦`:'Perfil limpio',hardFail:!blocked&&ov});
  if(!blocked&&ov)blocked=true;
  const r4=blocked?null:fR(4);
  const empW=!blocked&&!r4&&(params.employmentYears||0)<1;
  phases.push({icon:'💼',label:'Estabilidad Laboral',subtext:'Empleador, antigüedad',duration:1700,status:blocked?'skipped':r4?'fail':empW?'warning':'pass',resultText:blocked?'No evaluado':r4?r4.reason:`${params.employmentYears} año(s) ✓`,hardFail:!blocked&&!!r4});
  if(!blocked&&r4)blocked=true;
  const sI=!blocked&&score<550;
  phases.push({icon:'🤖',label:'Motor de Riesgo IA',subtext:'22 variables financieras',duration:3100,status:blocked?'skipped':sI?'fail':score<650?'warning':'pass',resultText:blocked?'No evaluado':sI?`Score insuficiente: ${score} (mín. 550)`:`Score FJAP: ${score} · Tier ${riskTier}`,hardFail:!blocked&&sI});
  if(!blocked&&sI)blocked=true;
  phases.push({icon:'⚖️',label:'Decisión del Comité',subtext:'Resolución definitiva',duration:2000,status:blocked?'fail':'pass',resultText:blocked?'Solicitud denegada':`Aprobado · ${interestRate}% anual · Tier ${riskTier}`,hardFail:false});
  return phases;
}

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function animatePhases(phases){
  const list=$('verify-phases-list');list.innerHTML='';
  phases.forEach((p,i)=>{const row=document.createElement('div');row.className='vphase-item';row.id='vphase-'+i;row.innerHTML=`<div class="vphase-status-wrap"><div class="vphase-status pending" id="vstatus-${i}"><span class="vphase-dot"></span></div></div><div class="vphase-icon-wrap">${p.icon}</div><div class="vphase-body"><div class="vphase-label">${p.label}</div><div class="vphase-sub">${p.subtext}</div></div><div class="vphase-badge hidden" id="vbadge-${i}"></div>`;list.appendChild(row);});
  let ff=false;
  for(let i=0;i<phases.length;i++){
    const p=phases[i];if(p.status==='skipped'){setPhaseSkipped(i);continue;}
    const se=$('vstatus-'+i);se.className='vphase-status running';se.innerHTML='<div class="vphase-spin"></div>';
    $('vphase-'+i).classList.add('active');$('vphase-'+i).scrollIntoView({behavior:'smooth',block:'nearest'});
    await sleep(p.duration);
    const icons={pass:'✓',warning:'⚠',fail:'✗'};se.className=`vphase-status ${p.status}`;se.innerHTML=`<span>${icons[p.status]}</span>`;
    $('vphase-'+i).classList.remove('active');$('vphase-'+i).classList.add('done');
    const b=$('vbadge-'+i);b.textContent=p.resultText;b.className=`vphase-badge ${p.status}`;b.classList.remove('hidden');
    await sleep(250);
    if(p.hardFail&&!ff){ff=true;await sleep(300);for(let j=i+1;j<phases.length;j++){setPhaseSkipped(j);await sleep(80);}break;}
  }
}
function setPhaseSkipped(i){const s=$('vstatus-'+i);if(s){s.className='vphase-status skipped';s.innerHTML='<span>—</span>';}const b=$('vbadge-'+i);if(b){b.textContent='No evaluado';b.className='vphase-badge skipped';b.classList.remove('hidden');}}

function showVerificationResult(sr){
  const resEl=$('verify-result');if(!resEl)return;
  const{approved,score,interestRate,riskTier,hardRejects,warnings,trustBonus}=sr;
  const monthly=approved?calcMonthly(applyAmount,interestRate,applyTerm):0;
  const sc=score>=750?'#34d399':score>=650?'#f59e0b':score>=550?'#fb923c':'#f87171';
  const circ=2*Math.PI*50,tOff=+(circ*(1-Math.max(0,Math.min(1,(score-200)/700)))).toFixed(1);
  const tD={AAA:'Riesgo Mínimo',AA:'Riesgo Muy Bajo',A:'Riesgo Bajo',B:'Riesgo Moderado',C:'Riesgo Alto',D:'No Califica'};
  if(approved){
    resEl.innerHTML=`<div class="vresult approved"><div class="vresult-icon-big">✅</div><h3 class="vresult-title">¡Préstamo Pre-Aprobado!</h3><p class="vresult-subtitle">Aprobado — Procede a Firma Digital</p>
    <div class="score-ring-wrap"><svg viewBox="0 0 120 120" width="130" height="130"><circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="9"/><circle class="score-ring-progress" cx="60" cy="60" r="50" fill="none" stroke="${sc}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${circ}" transform="rotate(-90 60 60)" style="transition:stroke-dashoffset 1.6s cubic-bezier(.4,0,.2,1)"/></svg><div class="score-ring-inner"><div class="score-ring-num" style="color:${sc}">${score}</div><div class="score-ring-lbl">Score FJAP</div></div></div>
    <div class="vresult-grid"><div class="vresult-cell"><div class="vc-label">Tasa Anual</div><div class="vc-val gold">${interestRate}%</div></div><div class="vresult-cell"><div class="vc-label">Tier</div><div class="vc-val">${riskTier}</div></div><div class="vresult-cell"><div class="vc-label">Clasificación</div><div class="vc-val">${tD[riskTier]||''}</div></div><div class="vresult-cell"><div class="vc-label">Cuota Est.</div><div class="vc-val gold">${curSym(selectedCurrency)}${monthly.toFixed(2)}</div></div></div>
    ${trustBonus>0?`<div class="trust-bonus-badge">✦ Bono Cliente Fiel: +${trustBonus} pts</div>`:''}
    ${warnings.length?`<div class="vresult-warnings"><div class="vw-title">⚠ Observaciones</div>${warnings.map(w=>`<div class="vw-item">· ${w}</div>`).join('')}</div>`:''}
    <p class="vresult-note">Haz clic en <strong>"Ir a Firma Digital"</strong> para finalizar tu préstamo.</p></div>`;
    setTimeout(()=>{const ring=resEl.querySelector('.score-ring-progress');if(ring)ring.style.strokeDashoffset=tOff;},80);
    const toSign=$('btn-to-sign');if(toSign)toSign.style.display='';
    const nextBtn=$('btn-next');if(nextBtn)nextBtn.style.display='none';
  } else {
    const reason=hardRejects.length?hardRejects[0].reason:'Score insuficiente.';
    const rCode=hardRejects.length?hardRejects[0].code:'SCORE_LOW';
    DB.set('rejection_cooldown_'+currentUser.id,{userId:currentUser.id,rejectedAt:new Date().toISOString(),reason,code:rCode});
    resEl.innerHTML=`<div class="vresult rejected"><div class="vresult-icon-big">❌</div><h3 class="vresult-title">Solicitud No Aprobada</h3><p class="vresult-subtitle">El comité no pudo aprobar esta solicitud</p>
    <div class="score-ring-wrap"><svg viewBox="0 0 120 120" width="130" height="130"><circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="9"/><circle class="score-ring-progress" cx="60" cy="60" r="50" fill="none" stroke="#f87171" stroke-width="9" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${circ}" transform="rotate(-90 60 60)" style="transition:stroke-dashoffset 1.6s cubic-bezier(.4,0,.2,1)"/></svg><div class="score-ring-inner"><div class="score-ring-num" style="color:#f87171">${score}</div><div class="score-ring-lbl">Score FJAP</div></div></div>
    <div class="reject-reason-box"><div class="rrb-title">🚫 Motivo</div><div class="rrb-text">${reason}</div><div class="rrb-code">Código: ${rCode}</div></div>
    <div class="reject-tips"><div class="rt-title">💡 Cómo mejorar:</div><div class="rt-item">• Reduce tus deudas para bajar el DTI</div><div class="rt-item">• Aumenta tu antigüedad laboral</div><div class="rt-item">• Solicita un monto menor</div><div class="rt-item">• Mantén ingresos estables y documentados</div></div>
    <p class="vresult-note" style="color:#f87171">⏳ Podrás volver a solicitar en 30 días.</p></div>`;
    setTimeout(()=>{const ring=resEl.querySelector('.score-ring-progress');if(ring)ring.style.strokeDashoffset=tOff;},80);
  }
  resEl.classList.remove('hidden');
  if($('verify-title'))$('verify-title').textContent=approved?'Evaluación Completada':'Evaluación Finalizada';
  if($('verify-subtitle'))$('verify-subtitle').textContent=approved?'Tu perfil fue aprobado':'Solicitud no aprobada';
  if($('verify-spinner-wrap'))$('verify-spinner-wrap').innerHTML=approved?'<div class="verify-done-ring">✓</div>':'<div class="verify-fail-ring">✗</div>';
}

// ═══════════════════════════════════════════════════════════════
// ── REGISTRATION MULTI-STEP ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
let regStep=1,regData={},faceVerified=false,captchaVerified=false,govtVerified=false;

window.regNext=function(step){
  if(step===1){
    const name=$('r-name').value.trim(),email=$('r-email').value.trim(),pass=$('r-pass').value,pass2=$('r-pass2').value;
    const err=$('auth-err');
    if(!name||!email||!pass||!pass2){err.textContent='Completa todos los campos.';return;}
    if(name.split(' ').filter(Boolean).length<2){err.textContent='Ingresa tu nombre completo (nombre y apellido).';return;}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){err.textContent='Correo electrónico no válido.';return;}
    if(pass.length<8){err.textContent='La contraseña debe tener mínimo 8 caracteres.';return;}
    if(!/[A-Z]/.test(pass)){err.textContent='La contraseña debe tener al menos una letra mayúscula.';return;}
    if(!/[0-9]/.test(pass)){err.textContent='La contraseña debe tener al menos un número.';return;}
    if(pass!==pass2){err.textContent='Las contraseñas no coinciden.';return;}
    err.textContent='';regData={...regData,fullName:name,email,password:pass};
    goToRegStep(2);
  } else if(step===2){
    const cedula=($('r-cedula').value||'').replace(/\D/g,''),birth=$('r-birth').value;
    const phone=($('r-phone').value||'').replace(/\D/g,''),gender=$('r-gender').value;
    const address=($('r-address').value||'').trim(),province=$('r-province').value;
    const err=$('auth-err');
    if(!cedula||!birth||!phone||!gender||!address||!province){err.textContent='Completa todos los campos requeridos.';return;}
    if(cedula.length!==11){err.textContent='La cédula debe tener exactamente 11 dígitos.';return;}
    const age=calculateAge(birth);
    if(isNaN(age)||age<18){err.textContent='❌ Debes ser mayor de 18 años para registrarte.';return;}
    if(age>100){err.textContent='Fecha de nacimiento inválida.';return;}
    if(phone.length!==10){err.textContent='El teléfono debe tener exactamente 10 dígitos.';return;}
    const areaCode=phone.slice(0,3);
    if(!['809','829','849'].includes(areaCode)){err.textContent='Teléfono inválido. Debe iniciar con 809, 829 ó 849.';return;}
    if(address.length<10){err.textContent='Ingresa tu dirección completa.';return;}
    err.textContent='';
    regData={...regData,cedula,birthDate:birth,phone,gender,address,province,age};
    goToRegStep(3);
  }
};
window.regBack=function(step){goToRegStep(step-1);};

function goToRegStep(step){
  regStep=step;
  for(let i=1;i<=3;i++){
    const dot=$('rdot-'+i);const line=$('rline-'+i);const panel=$('rpanel-'+i);
    if(dot)dot.className=`reg-step-dot${i<step?' done':i===step?' active':''}`;
    if(line&&i<3)line.className=`reg-step-line${i<step?' done':''}`;
    if(panel)panel.className=`reg-panel${i===step?' active':' hidden'}`;
  }
  $('auth-err').textContent='';
}

window.formatRegPhone=function(input){
  let v=input.value.replace(/\D/g,'').slice(0,10);
  input.value=v;
};

window.togglePass=function(id,btn){
  const inp=$(id);
  if(inp.type==='password'){inp.type='text';btn.textContent='🙈';}
  else{inp.type='password';btn.textContent='👁';}
};

// Password strength
document.addEventListener('DOMContentLoaded',()=>{
  const passInput=$('r-pass');if(!passInput)return;
  passInput.addEventListener('input',()=>{
    const v=passInput.value;const el=$('pass-strength');if(!el)return;
    let str=0,label='',color='';
    if(v.length>=8)str++;if(/[A-Z]/.test(v))str++;if(/[0-9]/.test(v))str++;if(/[^A-Za-z0-9]/.test(v))str++;
    if(str<=1){label='Débil';color='#f87171';}else if(str===2){label='Regular';color='#f59e0b';}else if(str===3){label='Buena';color='#60a5fa';}else{label='Fuerte ✓';color='#34d399';}
    el.innerHTML=`<div style="display:flex;justify-content:space-between;font-size:11px;margin-top:4px"><span style="color:${color}">${label}</span></div><div style="height:4px;background:var(--bg3);border-radius:2px;margin-top:4px"><div style="height:4px;background:${color};border-radius:2px;width:${str*25}%;transition:width .3s"></div></div>`;
  });
});

// ── FACE RECOGNITION SIMULATION ──────────────────────────────
const FACE_STEPS=[
  {label:'Mire directo a la cámara',icon:'👁',anim:'center',duration:2500},
  {label:'Parpadee lentamente 2 veces',icon:'😑',anim:'blink',duration:3000},
  {label:'Gire la cabeza hacia la izquierda',icon:'←',anim:'left',duration:2500},
  {label:'Gire la cabeza hacia la derecha',icon:'→',anim:'right',duration:2500},
  {label:'Sonría ampliamente',icon:'😁',anim:'smile',duration:2500},
];

window.startFaceRecognition=function(){
  $('face-modal').classList.remove('hidden');
  runFaceSteps();
};

async function runFaceSteps(){
  const frame=$('face-frame');const instr=$('face-instruction');const prog=$('face-progress-inner');
  const fdone=$('face-done-box');fdone.classList.add('hidden');
  const totalTime=FACE_STEPS.reduce((s,x)=>s+x.duration,0)+1500;
  let elapsed=0;

  // Scan animation
  $('face-scan-line').style.animation='faceScan 1.5s linear infinite';
  $('face-frame').style.borderColor='rgba(245,158,11,0.8)';

  for(let i=0;i<FACE_STEPS.length;i++){
    const step=FACE_STEPS[i];
    // Update step dots
    for(let j=0;j<4;j++){const dot=$('fstep-'+j);if(dot){dot.className='fstep'+(j<i?' done':j===i?' active':'');}}
    instr.textContent=step.label;
    // Animate face features
    applyFaceAnim(step.anim);
    await sleep(step.duration);
    elapsed+=step.duration;
    prog.style.width=`${(elapsed/totalTime)*100}%`;
  }

  // Govt check simulation
  instr.textContent='Validando con base de datos JCE...';
  $('face-frame').style.borderColor='rgba(52,211,153,0.8)';
  await sleep(1500);
  prog.style.width='100%';

  // Done
  $('face-scan-line').style.animation='none';
  fdone.classList.remove('hidden');
  instr.textContent='✅ Verificación completada';
  for(let j=0;j<4;j++){const dot=$('fstep-'+j);if(dot)dot.className='fstep done';}

  await sleep(1500);
  $('face-modal').classList.add('hidden');
  faceVerified=true;
  // Update UI
  $('face-check-icon').textContent='✅';
  $('face-check-sub').textContent='Verificación facial completada';
  $('btn-face').textContent='✓ Completado';
  $('btn-face').disabled=true;
  // Unlock captcha
  $('captcha-check-row').style.opacity='1';
  $('captcha-check-row').style.pointerEvents='auto';
  $('captcha-check-sub').textContent='Haz clic en Iniciar para continuar';
  checkRegComplete();
};

function applyFaceAnim(type){
  const el=$('feye-left'),er=$('feye-right'),mouth=$('fmouth'),arrow=$('face-arrow');
  if(!el)return;
  // Reset
  el.style.transform='scaleY(1)';er.style.transform='scaleY(1)';
  mouth.style.borderRadius='0 0 50% 50%';mouth.style.height='8px';
  if(arrow)arrow.style.display='none';
  if(type==='blink'){el.style.transform='scaleY(0.1)';er.style.transform='scaleY(0.1)';setTimeout(()=>{el.style.transform='scaleY(1)';er.style.transform='scaleY(1)';},600);}
  else if(type==='left'){if(arrow){arrow.textContent='←';arrow.style.display='block';arrow.style.left='10px';arrow.style.right='auto';}}
  else if(type==='right'){if(arrow){arrow.textContent='→';arrow.style.display='block';arrow.style.right='10px';arrow.style.left='auto';}}
  else if(type==='smile'){mouth.style.height='16px';mouth.style.borderRadius='0 0 60% 60%';}
}

// ── CAPTCHA ───────────────────────────────────────────────────
let capStep=1,mathAnswer=0,fakeOTPCode='',selectedImages=new Set(),correctImages=new Set();
const EMOJI_SETS={
  house:{target:'🏠',emojis:['🏠','🚗','🏠','🌳','🏠','🐶','🚗','🏠','🌳']},
  car:  {target:'🚗',emojis:['🚗','🏠','🚗','🐶','🌳','🚗','🏠','🐶','🚗']},
};

window.startCaptcha=function(){
  if(!faceVerified)return;
  // Generate math
  const a=Math.floor(Math.random()*15)+3,b=Math.floor(Math.random()*10)+2,ops=['+','-','×'];
  const op=ops[Math.floor(Math.random()*2)];// only + and -
  mathAnswer=op==='+'?a+b:a-b;
  $('math-q').textContent=`${a} ${op} ${b} = ?`;
  $('math-ans').value='';
  // Generate images
  const eKey=Math.random()>0.5?'house':'car';
  const eSet=EMOJI_SETS[eKey];
  const grid=$('img-grid');grid.innerHTML='';selectedImages=new Set();correctImages=new Set();
  $('cap-img-title').textContent=`Selecciona todas las imágenes con ${eSet.target}`;
  eSet.emojis.forEach((em,i)=>{
    if(em===eSet.target)correctImages.add(i);
    const btn=document.createElement('button');btn.className='img-cell';btn.textContent=em;
    btn.dataset.idx=i;btn.onclick=()=>{btn.classList.toggle('selected');selectedImages.has(i)?selectedImages.delete(i):selectedImages.add(i);};
    grid.appendChild(btn);
  });
  // Generate OTP
  fakeOTPCode=String(Math.floor(100000+Math.random()*900000));
  $('fake-otp').textContent=fakeOTPCode;
  // Show modal
  capStep=1;showCapPanel(1);
  $('captcha-modal').classList.remove('hidden');
};

window.capNext=function(step){
  if(step===1){
    const ans=+$('math-ans').value;
    if(ans!==mathAnswer){$('cap-err-1').textContent='Respuesta incorrecta. Intenta de nuevo.';return;}
    $('cap-err-1').textContent='';capStep=2;showCapPanel(2);
  } else if(step===2){
    const sArr=[...selectedImages].sort().join(',');const cArr=[...correctImages].sort().join(',');
    if(sArr!==cArr){$('cap-err-2').textContent='Selección incorrecta. Vuelve a intentarlo.';selectedImages=new Set();document.querySelectorAll('.img-cell').forEach(b=>b.classList.remove('selected'));return;}
    $('cap-err-2').textContent='';capStep=3;showCapPanel(3);
    // Auto-fill OTP hint in 2s (simulating SMS delivery)
    setTimeout(()=>{$('cap-hint-3').style.display='block';},2000);
  } else if(step===3){
    const entered=[...document.querySelectorAll('.otp-input')].map(i=>i.value).join('');
    if(entered!==fakeOTPCode){$('cap-err-3').textContent='Código incorrecto.';return;}
    $('cap-err-3').textContent='';$('cap-done').classList.remove('hidden');
    setTimeout(()=>{
      $('captcha-modal').classList.add('hidden');
      captchaVerified=true;
      $('captcha-check-icon').textContent='✅';
      $('captcha-check-sub').textContent='Verificación anti-bot completada';
      $('btn-captcha').textContent='✓ Completado';$('btn-captcha').disabled=true;
      // Govt check
      runGovtCheck();
    },1200);
  }
};

function showCapPanel(n){
  for(let i=1;i<=3;i++){const p=$('cap-panel-'+i);if(p)p.className='cap-panel'+(i===n?'':' hidden');const d=$('capdot-'+i);if(d)d.className='cap-dot'+(i<=n?' active':'');}
}

window.otpMove=function(input,idx){
  input.value=input.value.replace(/\D/g,'').slice(0,1);
  const inputs=document.querySelectorAll('.otp-input');
  if(input.value&&idx<5)inputs[idx+1].focus();
};

async function runGovtCheck(){
  $('govt-check-row').style.opacity='1';$('govt-check-row').style.pointerEvents='auto';
  $('govt-spinner').classList.remove('hidden');
  $('govt-check-sub').textContent='Consultando Junta Central Electoral...';
  await sleep(2000);
  $('govt-spinner').classList.add('hidden');
  $('govt-check-icon').textContent='✅';
  const age=calculateAge(regData.birthDate||'');
  $('govt-check-sub').textContent=`Cédula validada · ${age} años · Mayor de edad ✓`;
  govtVerified=true;
  $('terms-box').style.display='block';
  checkRegComplete();
}

function checkRegComplete(){
  const termsOk=$('r-terms')?.checked;
  const btn=$('btn-do-register');if(!btn)return;
  if(faceVerified&&captchaVerified&&govtVerified&&termsOk){btn.disabled=false;btn.style.opacity='1';}
  else{btn.disabled=true;btn.style.opacity='.5';}
}
// Terms checkbox watcher
document.addEventListener('change',e=>{if(e.target.id==='r-terms')checkRegComplete();});

// ── AUTH ──────────────────────────────────────────────────────
let currentUser=DB.get('session')||null;

function register({email,password,fullName,phone,cedula,birthDate,gender,address,province}){
  if(DB.find('users',u=>u.email===email.toLowerCase()))return{error:'Este correo ya está registrado.'};
  if(DB.find('users',u=>u.cedula===cedula))return{error:'Esta cédula ya está registrada.'};
  const salt=Math.random().toString(36).slice(2),hash=btoa(password+salt);
  const user={id:DB.nextId('user'),email:email.toLowerCase(),passwordHash:hash,salt,fullName,phone,cedula,birthDate,gender,address,province,creditScore:null,createdAt:new Date().toISOString()};
  DB.push('users',user);
  DB.push('wallets',{id:DB.nextId('wallet'),userId:user.id,balance:0,currency:'DOP',createdAt:new Date().toISOString()});
  currentUser=user;DB.set('session',user);return{user};
}
function login({email,password}){
  const user=DB.find('users',u=>u.email===email.toLowerCase());
  if(!user)return{error:'Credenciales inválidas.'};
  if(btoa(password+user.salt)!==user.passwordHash)return{error:'Credenciales inválidas.'};
  currentUser=user;DB.set('session',user);return{user};
}
function logout(){currentUser=null;DB.set('session',null);showLanding();}
function requireAuth(){if(!currentUser){showLanding();return false;}return true;}

window.doLogin=()=>{
  const email=$('l-email').value.trim(),password=$('l-pass').value;
  if(!email||!password){$('auth-err').textContent='Completa todos los campos.';return;}
  const r=login({email,password});if(r.error){$('auth-err').textContent=r.error;return;}
  $('auth-overlay').classList.add('hidden');showApp('home');
};
window.doRegister=()=>{
  if(!faceVerified||!captchaVerified||!govtVerified){$('auth-err').textContent='Completa toda la verificación de seguridad.';return;}
  if(!$('r-terms').checked){$('auth-err').textContent='Debes aceptar los términos y condiciones.';return;}
  const r=register({...regData});
  if(r.error){$('auth-err').textContent=r.error;return;}
  $('auth-overlay').classList.add('hidden');
  showApp('home');
  showAlert(`🎉 ¡Bienvenido, ${r.user.fullName.split(' ')[0]}!`,'success');
};

// ── WALLET ────────────────────────────────────────────────────
function getWallet(){return DB.find('wallets',w=>w.userId===currentUser.id);}
function deposit(amount,description){
  const w=getWallet();if(!w)return;
  DB.update('wallets',w.id,{balance:w.balance+amount});
  DB.push('transactions',{id:DB.nextId('tx'),walletId:w.id,type:'deposit',amount,description:description||'Depósito',createdAt:new Date().toISOString()});
}
function withdraw(amount,description){
  const w=getWallet();if(!w||w.balance<amount)return false;
  DB.update('wallets',w.id,{balance:w.balance-amount});
  DB.push('transactions',{id:DB.nextId('tx'),walletId:w.id,type:'withdrawal',amount,description:description||'Retiro',createdAt:new Date().toISOString()});
  return true;
}
function transfer(amount,recipientEmail,description){
  const s=getWallet();if(!s||s.balance<amount)return{error:'Saldo insuficiente.'};
  const rec=DB.find('users',u=>u.email===recipientEmail.toLowerCase());if(!rec)return{error:'Destinatario no encontrado.'};
  const rW=DB.find('wallets',w=>w.userId===rec.id);const ref='TRF-'+Date.now();
  DB.update('wallets',s.id,{balance:s.balance-amount});
  DB.push('transactions',{id:DB.nextId('tx'),walletId:s.id,type:'transfer_out',amount,description:description||`Transferencia a ${recipientEmail}`,reference:ref,createdAt:new Date().toISOString()});
  if(rW){DB.update('wallets',rW.id,{balance:rW.balance+amount});DB.push('transactions',{id:DB.nextId('tx'),walletId:rW.id,type:'transfer_in',amount,description:'Transferencia recibida',reference:ref,createdAt:new Date().toISOString()});}
  return{ok:true};
}

// ── CARD VALIDATION ───────────────────────────────────────────
function validateCard(number,exp,cvv,name){
  const d=number.replace(/\s/g,'');
  if(d.length!==16)return'El número de tarjeta debe tener exactamente 16 dígitos.';
  if(!luhnCheck(d))return'Número de tarjeta inválido.';
  if(!/^\d{2}\/\d{2}$/.test(exp))return'Fecha de vencimiento inválida (MM/AA).';
  const[mm,yy]=exp.split('/').map(Number);if(mm<1||mm>12)return'Mes inválido.';
  const now=new Date();if(new Date(2000+yy,mm-1,1)<new Date(now.getFullYear(),now.getMonth(),1))return'Tarjeta vencida.';
  const c=cvv.replace(/\D/g,'');if(c.length<3||c.length>4)return'CVV debe tener 3 o 4 dígitos.';
  if(!name||name.trim().length<3)return'Ingresa el nombre del titular.';
  return null;
}
function luhnCheck(num){let s=0,alt=false;for(let i=num.length-1;i>=0;i--){let n=parseInt(num[i],10);if(alt){n*=2;if(n>9)n-=9;}s+=n;alt=!alt;}return s%10===0;}
window.formatCardNumber=input=>{let v=input.value.replace(/\D/g,'').slice(0,16);input.value=v.match(/.{1,4}/g)?.join(' ')||v;const p=$('cp-number');if(p){const pd=v.padEnd(16,'•');p.textContent=pd.match(/.{1,4}/g).join(' ');}};
window.formatCardExp=input=>{let v=input.value.replace(/\D/g,'').slice(0,4);if(v.length>=3)v=v.slice(0,2)+'/'+v.slice(2);input.value=v;const e=$('cp-exp');if(e)e.textContent=v||'MM/AA';};
window.formatPayCard=input=>{let v=input.value.replace(/\D/g,'').slice(0,16);input.value=v.match(/.{1,4}/g)?.join(' ')||v;const p=$('pcp-number');if(p){const pd=v.padEnd(16,'•');p.textContent=pd.match(/.{1,4}/g).join(' ');}};
window.formatPayCardExp=input=>{let v=input.value.replace(/\D/g,'').slice(0,4);if(v.length>=3)v=v.slice(0,2)+'/'+v.slice(2);input.value=v;const e=$('pcp-exp');if(e)e.textContent=v||'MM/AA';};

// ── CARD MODAL ────────────────────────────────────────────────
let cardAction='deposit';
window.openCardModal=action=>{
  cardAction=action;const titles={deposit:'⬇ Depositar Fondos',withdraw:'⬆ Retirar Fondos',transfer:'↔ Transferir'};
  $('card-modal-title').textContent=titles[action]||'Operación';
  $('card-transfer-row').style.display=action==='transfer'?'':'none';
  $('card-modal-err').style.display='none';
  $('card-number').value='';$('card-exp').value='';$('card-cvv').value='';$('card-name').value='';$('card-amount').value='';$('card-desc').value='';
  if($('card-recipient'))$('card-recipient').value='';
  $('cp-number').textContent='•••• •••• •••• ••••';$('cp-name').textContent='TU NOMBRE';$('cp-exp').textContent='MM/AA';
  $('card-modal-overlay').classList.remove('hidden');
};
window.closeCardModal=()=>$('card-modal-overlay').classList.add('hidden');
window.submitCardOp=()=>{
  const num=$('card-number').value,exp=$('card-exp').value,cvv=$('card-cvv').value,name=$('card-name').value;
  const amount=+$('card-amount').value,desc=$('card-desc').value,errEl=$('card-modal-err');
  const cErr=validateCard(num,exp,cvv,name);if(cErr){errEl.textContent=cErr;errEl.style.display='block';return;}
  if(!amount||amount<=0){errEl.textContent='Ingresa un monto válido.';errEl.style.display='block';return;}
  const last4=num.replace(/\s/g,'').slice(-4);
  if(cardAction==='deposit'){deposit(amount,desc||`Depósito tarjeta ****${last4}`);closeCardModal();renderWallet();showAlert('✅ Depósito realizado','success');}
  else if(cardAction==='withdraw'){const ok=withdraw(amount,desc||`Retiro tarjeta ****${last4}`);if(!ok){errEl.textContent='Saldo insuficiente.';errEl.style.display='block';return;}closeCardModal();renderWallet();showAlert('✅ Retiro realizado','success');}
  else if(cardAction==='transfer'){const email=$('card-recipient')?.value;if(!email){errEl.textContent='Ingresa el email del destinatario.';errEl.style.display='block';return;}const res=transfer(amount,email,desc);if(res.error){errEl.textContent=res.error;errEl.style.display='block';return;}closeCardModal();renderWallet();showAlert('✅ Transferencia realizada','success');}
};

// ── LOAN PAYMENT ──────────────────────────────────────────────
let payingLoanId=null;
function renderPayPage(){
  const loans=DB.filter('loans',l=>l.userId===currentUser.id&&(l.status==='approved'||l.status==='active'));
  const cont=$('pay-content');
  if(!loans.length){cont.innerHTML=`<div class="empty"><div class="icon">💰</div><h3>Sin préstamos activos</h3><p>Cuando tengas un préstamo aprobado podrás pagar aquí.</p><button class="btn btn-gold" onclick="showPage('apply');initApplyForm()">Solicitar Préstamo</button></div>`;return;}
  cont.innerHTML=`<div class="pay-grid">${loans.map(l=>{const sym=curSym(l.currency),paid=DB.filter('payments',p=>p.loanId===l.id).reduce((s,p)=>s+p.amount,0),rem=Math.max(0,l.totalToPay-paid),pct=Math.round((paid/l.totalToPay)*100);
  return`<div class="pay-loan-card"><div class="plc-head"><div><div class="plc-id">Préstamo #${l.id}</div><span class="badge badge-green">Activo</span></div><div class="plc-amount">${sym}${Number(l.amount).toLocaleString('es')}</div></div>
  <div class="plc-progress-wrap"><div class="plc-progress-bar"><div class="plc-progress-fill" style="width:${pct}%"></div></div><div class="plc-progress-labels"><span>${pct}% pagado</span><span>${sym}${rem.toFixed(2)} restante</span></div></div>
  <div class="plc-details"><div class="plc-det"><span>Cuota</span><strong class="gold">${sym}${l.monthlyPayment.toFixed(2)}</strong></div><div class="plc-det"><span>Tasa</span><strong>${l.interestRate}%</strong></div><div class="plc-det"><span>Banco</span><strong style="font-size:11px">${l.bankName||'—'}</strong></div><div class="plc-det"><span>Pagado</span><strong>${sym}${paid.toFixed(2)}</strong></div></div>
  <button class="btn btn-gold btn-full" onclick="openPayCardModal(${l.id})">💳 Pagar Cuota — ${sym}${l.monthlyPayment.toFixed(2)}</button></div>`;}).join('')}</div>
  <div class="card" style="margin-top:24px"><h3 style="font-size:16px;font-weight:700;margin-bottom:20px">📜 Historial de Pagos</h3><div id="pay-hist">${renderPaymentHistory()}</div></div>`;
}
function renderPaymentHistory(){
  const all=DB.filter('payments',p=>{const l=DB.find('loans',x=>x.id===p.loanId);return l&&l.userId===currentUser.id;}).sort((a,b)=>new Date(b.paidAt)-new Date(a.paidAt));
  if(!all.length)return`<div class="empty" style="padding:40px"><div class="icon" style="font-size:32px">📭</div><p>Sin pagos registrados aún.</p></div>`;
  return all.map(p=>{const l=DB.find('loans',x=>x.id===p.loanId);const sym=curSym(l?.currency||'DOP');return`<div class="tx-item"><div class="tx-icon in">✅</div><div class="tx-info"><div class="tx-desc">Pago Préstamo #${p.loanId} — ****${p.cardLast4}</div><div class="tx-date">${fmtDate(p.paidAt)} · ${p.ref}</div></div><div class="tx-amount in">-${sym}${p.amount.toFixed(2)}</div></div>`;}).join('');
}
window.openPayCardModal=loanId=>{
  payingLoanId=loanId;const loan=DB.find('loans',l=>l.id===loanId);if(!loan)return;
  const sym=curSym(loan.currency),paid=DB.filter('payments',p=>p.loanId===loanId).reduce((s,p)=>s+p.amount,0),rem=Math.max(0,loan.totalToPay-paid);
  $('pay-summary-box').innerHTML=`<div class="psb-row"><span>Préstamo</span><strong>#${loan.id}</strong></div><div class="psb-row"><span>Cuota</span><strong class="gold">${sym}${loan.monthlyPayment.toFixed(2)}</strong></div><div class="psb-row"><span>Restante</span><strong>${sym}${rem.toFixed(2)}</strong></div>`;
  $('pay-card-err').style.display='none';
  $('pay-card-number').value='';$('pay-card-exp').value='';$('pay-card-cvv').value='';$('pay-card-name').value='';
  $('pcp-number').textContent='•••• •••• •••• ••••';$('pcp-name').textContent='TU NOMBRE';$('pcp-exp').textContent='MM/AA';
  $('pay-card-overlay').classList.remove('hidden');
};
window.closePayCardModal=()=>$('pay-card-overlay').classList.add('hidden');
window.confirmLoanPayment=()=>{
  const num=$('pay-card-number').value,exp=$('pay-card-exp').value,cvv=$('pay-card-cvv').value,name=$('pay-card-name').value;
  const errEl=$('pay-card-err');const cErr=validateCard(num,exp,cvv,name);
  if(cErr){errEl.textContent=cErr;errEl.style.display='block';return;}
  const loan=DB.find('loans',l=>l.id===payingLoanId);if(!loan)return;
  const last4=num.replace(/\s/g,'').slice(-4),ref='PAY-'+Date.now();
  DB.push('payments',{id:DB.nextId('payment'),loanId:loan.id,userId:currentUser.id,amount:loan.monthlyPayment,cardLast4:last4,ref,paidAt:new Date().toISOString()});
  const allPaid=DB.filter('payments',p=>p.loanId===loan.id).reduce((s,p)=>s+p.amount,0);
  if(allPaid>=loan.totalToPay-0.01){DB.update('loans',loan.id,{status:'paid'});showAlert('🎉 ¡Préstamo pagado completamente!','success');}
  else showAlert(`✅ Pago de ${curSym(loan.currency)}${loan.monthlyPayment.toFixed(2)} registrado`,'success');
  closePayCardModal();renderPayPage();renderHome();
};

// ── LOAN CREATE ───────────────────────────────────────────────
function createLoan(data){
  const rate=data.interestRate||15.5,monthly=calcMonthly(data.amount,rate,data.termMonths),total=monthly*data.termMonths,inv='FJAP-'+Date.now();
  const loan={id:DB.nextId('loan'),userId:currentUser.id,amount:data.amount,termMonths:data.termMonths,interestRate:rate,paymentType:data.paymentType,amortizationType:data.amortizationType,currency:data.currency||'DOP',status:'approved',monthlyPayment:+monthly.toFixed(2),totalToPay:+total.toFixed(2),purpose:data.purpose,monthlyIncome:data.monthlyIncome,employer:data.employer,employmentYears:data.employmentYears,guaranteeType:data.guaranteeType,guaranteeDetail:data.guaranteeDetail,bankName:data.bankName,accountNumber:data.accountNumber,accountType:data.accountType,reference1Name:data.reference1Name||null,reference1Phone:data.reference1Phone||null,reference2Name:data.reference2Name||null,reference2Phone:data.reference2Phone||null,invoiceNumber:inv,creditScore:data.creditScore,riskTier:data.riskTier,digitalSignature:data.digitalSignature||null,approvedAt:new Date().toISOString(),createdAt:new Date().toISOString()};
  DB.push('loans',loan);
  const users=DB.get('users')||[];const idx=users.findIndex(u=>u.id===currentUser.id);
  if(idx!==-1){users[idx].creditScore=data.creditScore;DB.set('users',users);currentUser=users[idx];DB.set('session',currentUser);}
  deposit(data.amount,`Desembolso préstamo #${loan.id} — ${inv}`);
  return loan;
}

// ── DOM HELPERS ───────────────────────────────────────────────
const $=id=>document.getElementById(id);
const fmtDate=iso=>new Date(iso).toLocaleDateString('es',{day:'2-digit',month:'short',year:'numeric'});
const fmtMoney=(n,cur)=>`${curSym(cur||'DOP')}${Number(n).toLocaleString('es',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
function statusBadge(s){const m={approved:'badge-green',active:'badge-green',pending:'badge-amber',paid:'badge-blue',overdue:'badge-red'};const l={approved:'Aprobado',active:'Activo',pending:'Pendiente',paid:'Pagado',overdue:'Atrasado'};return`<span class="badge ${m[s]||'badge-zinc'}">${l[s]||s}</span>`;}
function tierBadge(t){if(!t)return'';const m={AAA:'badge-green',AA:'badge-green',A:'badge-blue',B:'badge-amber',C:'badge-red',D:'badge-red'};return`<span class="badge ${m[t]||'badge-zinc'}">Tier ${t}</span>`;}

// ── PAGE VISIBILITY ───────────────────────────────────────────
function showLanding(){$('landing').classList.remove('hidden');$('app').classList.add('hidden');$('landing-nav').classList.remove('hidden');}
function showApp(page){if(!requireAuth())return;$('landing').classList.add('hidden');$('app').classList.remove('hidden');$('landing-nav').classList.add('hidden');renderSidebar();showPage(page||'home');}
function showPage(page){
  document.querySelectorAll('.app-page').forEach(p=>p.classList.add('hidden'));
  const t=$('page-'+page);if(t){t.classList.remove('hidden');renderPage(page);}
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.page===page));
}
function renderPage(page){const r={home:renderHome,loans:renderLoans,wallet:renderWallet,pay:renderPayPage,business:()=>showBizTab('portfolio'),accounting:renderAccounting,ai:renderAiPage};if(r[page])r[page]();}

function renderSidebar(){const u=$('sidebar-user-info');if(u&&currentUser)u.innerHTML=`<div class="name">${currentUser.fullName}</div><div class="email">${currentUser.email}</div>`;}

// ── HOME ──────────────────────────────────────────────────────
function renderHome(){
  const loans=DB.filter('loans',l=>l.userId===currentUser.id);
  const wallet=getWallet()||{balance:0,currency:'DOP'};
  const aL=loans.filter(l=>l.status==='approved'||l.status==='active');
  const totalDebt=aL.reduce((s,l)=>s+l.totalToPay,0);
  const totalPaid=aL.reduce((s,l)=>s+DB.filter('payments',p=>p.loanId===l.id).reduce((a,p)=>a+p.amount,0),0);
  $('stat-balance').textContent=fmtMoney(wallet.balance,wallet.currency);
  $('stat-loans').textContent=loans.length;
  $('stat-debt').textContent=fmtMoney(Math.max(0,totalDebt-totalPaid),'DOP');
  $('stat-score').textContent=currentUser.creditScore||'—';
  const recent=$('recent-loans');
  if(!loans.length){recent.innerHTML=`<div class="empty"><div class="icon">💳</div><h3>Sin préstamos</h3><p>Solicita tu primer préstamo</p><button class="btn btn-gold" onclick="showPage('apply')">Solicitar</button></div>`;return;}
  recent.innerHTML=loans.slice(-3).reverse().map(l=>loanCardHTML(l)).join('');
}

// ── LOANS ─────────────────────────────────────────────────────
function renderLoans(){const loans=DB.filter('loans',l=>l.userId===currentUser.id);const grid=$('loans-grid');if(!loans.length){grid.innerHTML=`<div class="empty" style="grid-column:1/-1"><div class="icon">💳</div><h3>Sin préstamos</h3><button class="btn btn-gold" onclick="showPage('apply')">✦ Solicitar</button></div>`;return;}grid.innerHTML=loans.map(l=>loanCardHTML(l)).join('');}
function loanCardHTML(l){
  const sym=curSym(l.currency),flag=curFlag(l.currency);
  const paid=DB.filter('payments',p=>p.loanId===l.id).reduce((s,p)=>s+p.amount,0),pct=l.totalToPay>0?Math.round((paid/l.totalToPay)*100):0;
  return`<div class="loan-card"><div class="loan-card-head"><div><div class="loan-id">ID: #${l.id}</div>${statusBadge(l.status)} ${l.riskTier?tierBadge(l.riskTier):''}</div><div><div class="loan-currency">${flag} ${l.currency||'DOP'}</div><div class="loan-amount">${sym}${Number(l.amount).toLocaleString('es')}</div></div></div>
  <div style="margin:10px 0"><div style="height:4px;background:var(--bg3);border-radius:2px"><div style="height:4px;background:var(--gold);border-radius:2px;width:${pct}%"></div></div><div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-top:4px"><span>${pct}% pagado</span><span>${sym}${Math.max(0,l.totalToPay-paid).toFixed(2)} restante</span></div></div>
  <div class="loan-details"><div class="loan-detail-item"><div class="dt">Plazo</div><div class="dd">${l.termMonths} meses</div></div><div class="loan-detail-item"><div class="dt">Cuota</div><div class="dd gold">${sym}${l.monthlyPayment.toFixed(2)}</div></div><div class="loan-detail-item"><div class="dt">Tasa</div><div class="dd">${l.interestRate}%</div></div><div class="loan-detail-item"><div class="dt">Banco</div><div class="dd" style="font-size:11px">${l.bankName||'—'}</div></div></div>
  <div class="loan-card-actions"><button class="btn btn-ghost btn-sm" style="flex:1" onclick="showLoanDetail(${l.id})">Ver Detalles</button>${l.status==='approved'||l.status==='active'?`<button class="btn btn-gold btn-sm" onclick="openPayCardModal(${l.id})">💳 Pagar</button>`:''}${l.invoiceNumber?`<button class="btn btn-outline btn-sm" onclick="showInvoice(${l.id})">🧾</button>`:''}</div></div>`;
}

// ── LOAN DETAIL ───────────────────────────────────────────────
function showLoanDetail(id){
  const loan=DB.find('loans',l=>l.id===id);if(!loan)return;
  const sym=curSym(loan.currency),amort=buildAmortization(loan.amount,loan.interestRate,loan.termMonths);
  const container=$('page-loan-detail');
  container.innerHTML=`<div class="page-header"><div><button class="btn btn-ghost btn-sm" onclick="showPage('loans')">← Mis Préstamos</button><div class="page-title" style="margin-top:12px">📋 Préstamo #${loan.id}</div><div style="margin-top:6px">${statusBadge(loan.status)} ${loan.riskTier?tierBadge(loan.riskTier):''}</div></div>${loan.invoiceNumber?`<button class="btn btn-outline" onclick="showInvoice(${loan.id})">🧾 Factura</button>`:''}</div>
  <div class="detail-meta">
    <div class="meta-item"><div class="dt">Monto</div><div class="dd gold">${sym}${Number(loan.amount).toLocaleString('es',{minimumFractionDigits:2})}</div></div>
    <div class="meta-item"><div class="dt">Cuota</div><div class="dd gold">${sym}${loan.monthlyPayment.toFixed(2)}</div></div>
    <div class="meta-item"><div class="dt">Total</div><div class="dd">${sym}${loan.totalToPay.toFixed(2)}</div></div>
    <div class="meta-item"><div class="dt">Tasa</div><div class="dd">${loan.interestRate}%</div></div>
    <div class="meta-item"><div class="dt">Plazo</div><div class="dd">${loan.termMonths} meses</div></div>
    <div class="meta-item"><div class="dt">Score IA</div><div class="dd gold">${loan.creditScore||'—'}</div></div>
    <div class="meta-item"><div class="dt">Garantía</div><div class="dd">${loan.guaranteeType||'—'}</div></div>
    <div class="meta-item"><div class="dt">Banco</div><div class="dd">${loan.bankName||'—'}</div></div>
  </div>
  <div class="card" style="overflow-x:auto"><h3 style="margin-bottom:16px;font-size:16px;font-weight:700">📊 Tabla de Amortización</h3>
  <table class="amort-table"><thead><tr><th>#</th><th>Fecha</th><th>Capital</th><th>Interés</th><th>Cuota</th><th>Saldo</th></tr></thead>
  <tbody>${amort.map(r=>`<tr><td>${r.period}</td><td>${r.date}</td><td>${sym}${r.principal.toFixed(2)}</td><td>${sym}${r.interest.toFixed(2)}</td><td class="gold">${sym}${r.payment.toFixed(2)}</td><td>${sym}${r.balance.toFixed(2)}</td></tr>`).join('')}</tbody></table></div>`;
  document.querySelectorAll('.app-page').forEach(p=>p.classList.add('hidden'));
  container.classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
}

// ═══════════════════════════════════════════════════════════════
// ── APPLY FORM (5 STEPS) ───────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
let applyStep=1,applyData={},selectedCurrency='DOP',applyAmount=25000,applyTerm=12,lastScoringResult=null;

function initApplyForm(){
  const cd=checkCooldown();if(cd){showAlert(`⏳ Podrás aplicar en ${cd} día(s).`,'error');showPage('loans');return;}
  applyStep=1;applyData={};selectedCurrency='DOP';applyAmount=25000;applyTerm=12;lastScoringResult=null;
  const pl=$('verify-phases-list');if(pl)pl.innerHTML='';
  const re=$('verify-result');if(re)re.classList.add('hidden');
  const sw=$('verify-spinner-wrap');if(sw)sw.innerHTML='<div class="spin-ring"></div>';
  if($('verify-title'))$('verify-title').textContent='Analizando Solicitud...';
  if($('verify-subtitle'))$('verify-subtitle').textContent='No cierres esta ventana';
  if($('verify-tracking'))$('verify-tracking').classList.add('hidden');
  if($('btn-to-sign'))$('btn-to-sign').style.display='none';

  // Show user profile banner
  const banner=$('profile-banner');
  if(banner&&currentUser){banner.innerHTML=`<div class="prof-banner"><div class="pb-avatar">${currentUser.fullName.charAt(0)}</div><div class="pb-info"><div class="pb-name">${currentUser.fullName}</div><div class="pb-details">📧 ${currentUser.email} · 📱 ${currentUser.phone||'—'} · 🪪 ${currentUser.cedula||'—'}</div></div><span class="badge badge-green">✓ Verificado</span></div>`;}

  updateStepUI();renderCurrencyPicker();updateAmountDisplay();
  const amtS=$('amt-slider');if(amtS)amtS.addEventListener('input',e=>{applyAmount=+e.target.value;updateAmountDisplay();});
  const trmS=$('term-slider');if(trmS)trmS.addEventListener('input',e=>{applyTerm=+e.target.value;$('term-val').textContent=e.target.value;});
}

function updateAmountDisplay(){
  const sym=curSym(selectedCurrency);
  const el=$('amount-big');if(el)el.innerHTML=`<span class="amount-sym">${sym}</span>${Number(applyAmount).toLocaleString('es')}`;
  const mn=$('range-min'),mx=$('range-max');
  if(mn)mn.textContent=sym+'1,000';if(mx)mx.textContent=sym+'100,000';
}
function renderCurrencyPicker(){
  const grid=$('currency-grid');if(!grid)return;
  grid.innerHTML=CURRENCIES.map(c=>`<button class="currency-btn ${c.code===selectedCurrency?'selected':''}" onclick="selectCurrency('${c.code}')"><span class="cflag">${c.flag}</span><span class="ccode">${c.code}</span></button>`).join('');
}
window.selectCurrency=code=>{selectedCurrency=code;renderCurrencyPicker();updateAmountDisplay();const lbl=$('currency-label');if(lbl){const c=CURRENCIES.find(x=>x.code===code);lbl.textContent=c?`${c.flag} ${c.name} — ${c.sym}`:'';};};
window.toggleGuaranteeDetail=val=>{const ff=$('fiador-fields');if(ff)ff.style.display=val==='fiador'?'block':'none';};

function updateStepUI(){
  for(let i=1;i<=5;i++){
    const dot=$('sdot-'+i),line=$('sline-'+i),panel=$('spanel-'+i);
    if(dot)dot.className=`step-dot${i<applyStep?' done':i===applyStep?' current':' pending'}`;
    if(line)line.className=`step-line${i<applyStep?' done':' pending'}`;
    if(panel)panel.className=`step-panel${i===applyStep?' active':''}`;
  }
  const bb=$('btn-back'),nb=$('btn-next');
  if(bb)bb.style.display=applyStep>1&&applyStep<4?'':'none';
  if(nb){nb.style.display=applyStep<4?'':'none';nb.textContent=applyStep<3?'Continuar →':applyStep===3?'⚡ Evaluar Perfil':'Continuar →';}
}

function validateStep1(){
  const inc=+($('f-income')?.value||0),debt=+($('f-debt')?.value||0);
  const emp=($('f-employer')?.value||'').trim(),yr=$('f-empyears')?.value;
  const r1n=($('f-ref1name')?.value||'').trim(),r1p=($('f-ref1phone')?.value||'').replace(/\D/g,'');
  const r2n=($('f-ref2name')?.value||'').trim(),r2p=($('f-ref2phone')?.value||'').replace(/\D/g,'');
  if(!inc||inc<=0)return'El ingreso mensual es requerido.';
  if(inc<5000)return'Ingreso mínimo: RD$5,000.';
  if(debt<0)return'La deuda no puede ser negativa.';
  if(debt>=inc)return'La deuda no puede ser igual o mayor al ingreso.';
  if(emp.length<2)return'El nombre del empleador es requerido.';
  if(!yr&&yr!=='0')return'Los años de empleo son requeridos.';
  if(r1n.length<3)return'Nombre de Referencia 1 requerido.';
  if(r1p.length!==10)return'Teléfono Ref. 1: exactamente 10 dígitos.';
  if(r2n.length<3)return'Nombre de Referencia 2 requerido.';
  if(r2p.length!==10)return'Teléfono Ref. 2: exactamente 10 dígitos.';
  return null;
}
function validateStep2(){
  if(!applyAmount||applyAmount<1000)return'El monto mínimo es RD$1,000.';
  if(applyAmount>100000)return'El monto máximo es RD$100,000.';
  if(!applyTerm||applyTerm<1)return'El plazo mínimo es 1 mes.';
  return null;
}
function validateStep3(){
  const bank=($('f-bank')?.value||'').trim();
  const acct=($('f-account-number')?.value||'').replace(/\D/g,'');
  if(!bank)return'Selecciona un banco.';
  if(acct.length<8)return'El número de cuenta debe tener al menos 8 dígitos.';
  return null;
}

function showStepError(msg){
  let e=$('step-error-msg');
  if(!e){e=document.createElement('div');e.id='step-error-msg';e.className='step-error-banner';const c=document.querySelector('#page-apply .card');if(c)c.insertBefore(e,c.firstChild);}
  e.textContent='⚠ '+msg;e.style.display='block';e.scrollIntoView({behavior:'smooth',block:'nearest'});
  setTimeout(()=>{if(e)e.style.display='none';},5000);
}

function collectApplyData(){
  applyData.amount=applyAmount;applyData.termMonths=applyTerm;
  applyData.paymentType=$('sel-payment')?.value||'monthly';
  applyData.amortizationType=$('sel-amort')?.value||'french';
  applyData.purpose=$('sel-purpose')?.value||'otros';
  applyData.currency=selectedCurrency;
  applyData.monthlyIncome=+($('f-income')?.value||0);
  applyData.debtLevel=+($('f-debt')?.value||0);
  applyData.employer=$('f-employer')?.value||'';
  applyData.employmentYears=+($('f-empyears')?.value||0);
  applyData.occupationType=$('f-occupation')?.value||'empleado';
  applyData.reference1Name=$('f-ref1name')?.value||'';
  applyData.reference1Phone=$('f-ref1phone')?.value||'';
  applyData.reference2Name=$('f-ref2name')?.value||'';
  applyData.reference2Phone=$('f-ref2phone')?.value||'';
  applyData.guaranteeType=$('f-guarantee-type')?.value||'personal';
  applyData.guaranteeDetail=$('f-guarantee-detail')?.value||'';
  applyData.bankName=$('f-bank')?.value||'';
  applyData.accountNumber=$('f-account-number')?.value||'';
  applyData.accountType=$('f-account-type')?.value||'ahorro';
}

window.applyNext=async()=>{
  if(applyStep===1){const err=validateStep1();if(err){showStepError(err);return;}applyStep++;updateStepUI();return;}
  if(applyStep===2){const err=validateStep2();if(err){showStepError(err);return;}applyStep++;updateStepUI();return;}
  if(applyStep===3){
    const err=validateStep3();if(err){showStepError(err);return;}
    collectApplyData();
    const age=calculateAge(currentUser.birthDate);
    const params={monthlyIncome:applyData.monthlyIncome,debtLevel:applyData.debtLevel,employmentYears:applyData.employmentYears,amount:applyAmount,termMonths:applyTerm,age:isNaN(age)?25:age,purpose:applyData.purpose,dependents:0,occupationType:applyData.occupationType};
    const sr=advancedCreditScore(params);lastScoringResult=sr;
    const phases=buildVerificationPhases(params,sr);
    applyStep=4;updateStepUI();
    const tc='EXP-'+Date.now().toString(36).toUpperCase().slice(-8);
    if($('verify-code'))$('verify-code').textContent=tc;if($('verify-tracking'))$('verify-tracking').classList.remove('hidden');
    await animatePhases(phases);await sleep(600);showVerificationResult(sr);
  }
};
window.applyBack=()=>{if(applyStep>1&&applyStep<4){applyStep--;updateStepUI();}};

// ── LOAN SIGN PAGE ────────────────────────────────────────────
window.goToSign=function(){
  if(!lastScoringResult||!lastScoringResult.approved){showAlert('Solicitud no aprobada.','error');return;}
  document.querySelectorAll('.app-page').forEach(p=>p.classList.add('hidden'));
  $('page-loan-sign').classList.remove('hidden');
  renderSignPage();
};

function renderSignPage(){
  const sym=curSym(selectedCurrency);
  const monthly=calcMonthly(applyAmount,lastScoringResult.interestRate,applyTerm);
  const total=monthly*applyTerm;
  const sc=$('sign-content');
  sc.innerHTML=`
  <div class="sign-layout">
    <div class="sign-left">
      <div class="card sign-summary">
        <h3 style="font-size:16px;font-weight:800;margin-bottom:20px">📋 Resumen del Préstamo</h3>
        <div class="sign-row"><span>Solicitante</span><strong>${currentUser.fullName}</strong></div>
        <div class="sign-row"><span>Cédula</span><strong>${currentUser.cedula}</strong></div>
        <div class="sign-row"><span>Correo</span><strong>${currentUser.email}</strong></div>
        <div class="sign-row"><span>Monto</span><strong class="gold">${sym}${Number(applyAmount).toLocaleString('es',{minimumFractionDigits:2})}</strong></div>
        <div class="sign-row"><span>Tasa Anual</span><strong>${lastScoringResult.interestRate}%</strong></div>
        <div class="sign-row"><span>Plazo</span><strong>${applyTerm} meses</strong></div>
        <div class="sign-row"><span>Cuota Mensual</span><strong class="gold">${sym}${monthly.toFixed(2)}</strong></div>
        <div class="sign-row total"><span>Total a Pagar</span><strong class="gold">${sym}${total.toFixed(2)}</strong></div>
        <div class="sign-row"><span>Garantía</span><strong>${applyData.guaranteeType||'Personal'}</strong></div>
        <div class="sign-row"><span>Banco</span><strong>${applyData.bankName||'—'}</strong></div>
        <div class="sign-row"><span>Cuenta</span><strong>****${(applyData.accountNumber||'').slice(-4)}</strong></div>
        <div class="sign-row"><span>Score FJAP</span><strong style="color:#34d399">${lastScoringResult.score} pts · Tier ${lastScoringResult.riskTier}</strong></div>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="sign-bank-info">
          <div class="sbi-icon">🏦</div>
          <div><div style="font-weight:700;font-size:14px">Desembolso a:</div><div style="color:var(--gold);font-weight:800">${applyData.bankName||'Tu cuenta bancaria'}</div><div style="font-size:12px;color:var(--text3)">Cuenta ${applyData.accountType==='ahorro'?'de Ahorro':'Corriente'} · ****${(applyData.accountNumber||'').slice(-4)}</div><div style="font-size:11px;color:var(--text2);margin-top:4px">También disponible en tu Billetera Virtual FJAP</div></div>
        </div>
      </div>
    </div>
    <div class="sign-right">
      <div class="card">
        <h3 style="font-size:15px;font-weight:800;margin-bottom:16px">📜 Términos y Condiciones</h3>
        <div class="terms-scroll">
          <p><strong>CONTRATO DE PRÉSTAMO PERSONAL — FJAP PRÉSTAMOS PERSONALES</strong></p>
          <p>El presente contrato se suscribe entre FJAP Préstamos Personales (en adelante "El Prestamista") y el solicitante identificado anteriormente (en adelante "El Prestatario").</p>
          <p><strong>1. OBJETO:</strong> El Prestamista concede al Prestatario un préstamo personal por el monto, tasa y plazo indicados en el resumen adjunto.</p>
          <p><strong>2. TASA DE INTERÉS:</strong> La tasa de interés anual aplicable es la indicada en el Score FJAP, la cual es fija durante toda la vigencia del préstamo.</p>
          <p><strong>3. PAGOS:</strong> El Prestatario se compromete a realizar los pagos en las fechas acordadas. El incumplimiento generará cargos por mora del 5% mensual sobre la cuota vencida.</p>
          <p><strong>4. GARANTÍA:</strong> El préstamo está respaldado por la garantía declarada. En caso de incumplimiento, El Prestamista podrá ejercer las acciones legales correspondientes.</p>
          <p><strong>5. DOMICILIO:</strong> Para efectos legales, las partes fijan domicilio en la República Dominicana, sometiéndose a la jurisdicción de sus tribunales.</p>
          <p><strong>6. DATOS PERSONALES:</strong> El Prestatario autoriza a FJAP a procesar sus datos personales conforme a la Ley 172-13 sobre protección de datos de la República Dominicana.</p>
          <p><strong>7. MORA:</strong> Pagos con más de 30 días de atraso serán reportados al Buró de Crédito y afectarán su historial crediticio.</p>
          <p><strong>8. DESEMBOLSO:</strong> Los fondos serán transferidos a la cuenta bancaria indicada o acreditados en la billetera virtual FJAP dentro de las 24 horas siguientes a la firma.</p>
        </div>
        <label class="terms-check" style="margin-top:16px">
          <input type="checkbox" id="sign-terms-check" onchange="checkSignReady()"/>
          <span>He leído y acepto los Términos y Condiciones del préstamo.</span>
        </label>
      </div>
      <div class="card" style="margin-top:16px">
        <h3 style="font-size:15px;font-weight:800;margin-bottom:16px">✍️ Firma Digital</h3>
        <p style="font-size:13px;color:var(--text2);margin-bottom:14px">Escribe tu nombre completo para firmar digitalmente este contrato:</p>
        <input id="sign-name-input" type="text" class="sign-name-field" placeholder="Escribe tu nombre completo..." oninput="checkSignReady()"/>
        <canvas id="sign-canvas" class="sign-canvas" width="500" height="120"></canvas>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn btn-ghost btn-sm" onclick="clearSignature()">🗑 Limpiar</button>
          <span style="font-size:11px;color:var(--text3);margin:auto 0">O dibuja tu firma en el área de arriba</span>
        </div>
        <div id="sign-err" class="step-error-banner" style="display:none;margin-top:12px"></div>
        <button class="btn btn-gold btn-full" id="btn-confirm-sign" onclick="confirmSign()" style="margin-top:20px;opacity:.5" disabled>
          ✅ Firmar y Recibir Fondos — ${sym}${Number(applyAmount).toLocaleString('es')}
        </button>
      </div>
    </div>
  </div>`;
  initSignCanvas();
}

function checkSignReady(){
  const termsOk=$('sign-terms-check')?.checked;
  const nameOk=($('sign-name-input')?.value||'').trim().split(' ').filter(Boolean).length>=2;
  const btn=$('btn-confirm-sign');
  if(btn){btn.disabled=!(termsOk&&nameOk);btn.style.opacity=termsOk&&nameOk?'1':'.5';}
}

let isDrawing=false,ctx=null;
function initSignCanvas(){
  const canvas=$('sign-canvas');if(!canvas)return;
  ctx=canvas.getContext('2d');ctx.strokeStyle='#f59e0b';ctx.lineWidth=2;ctx.lineCap='round';
  canvas.addEventListener('mousedown',e=>{isDrawing=true;ctx.beginPath();const r=canvas.getBoundingClientRect();ctx.moveTo(e.clientX-r.left,e.clientY-r.top);});
  canvas.addEventListener('mousemove',e=>{if(!isDrawing)return;const r=canvas.getBoundingClientRect();ctx.lineTo(e.clientX-r.left,e.clientY-r.top);ctx.stroke();});
  canvas.addEventListener('mouseup',()=>{isDrawing=false;checkSignReady();});
  canvas.addEventListener('touchstart',e=>{e.preventDefault();isDrawing=true;ctx.beginPath();const r=canvas.getBoundingClientRect(),t=e.touches[0];ctx.moveTo(t.clientX-r.left,t.clientY-r.top);},{passive:false});
  canvas.addEventListener('touchmove',e=>{e.preventDefault();if(!isDrawing)return;const r=canvas.getBoundingClientRect(),t=e.touches[0];ctx.lineTo(t.clientX-r.left,t.clientY-r.top);ctx.stroke();},{passive:false});
  canvas.addEventListener('touchend',()=>{isDrawing=false;checkSignReady();});
}
window.clearSignature=()=>{const c=$('sign-canvas');if(c&&ctx)ctx.clearRect(0,0,c.width,c.height);};

window.confirmSign=()=>{
  if(!lastScoringResult||!lastScoringResult.approved){showAlert('Error: solicitud no aprobada.','error');return;}
  const signName=($('sign-name-input')?.value||'').trim();
  if(signName.split(' ').filter(Boolean).length<2){$('sign-err').textContent='Escribe tu nombre completo para firmar.';$('sign-err').style.display='block';return;}
  if(!$('sign-terms-check')?.checked){$('sign-err').textContent='Debes aceptar los términos.';$('sign-err').style.display='block';return;}
  const d={...applyData,creditScore:lastScoringResult.score,riskTier:lastScoringResult.riskTier,interestRate:lastScoringResult.interestRate,digitalSignature:signName+' — '+new Date().toISOString()};
  const loan=createLoan(d);
  showAlert('🎉 ¡Préstamo aprobado y fondos desembolsados!','success');
  setTimeout(()=>{showLoanDetail(loan.id);},1000);
};

// ── WALLET PAGE ───────────────────────────────────────────────
function renderWallet(){
  const w=getWallet()||{balance:0,currency:'DOP'};
  const txs=DB.filter('transactions',t=>t.walletId===w.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  $('wallet-balance').textContent=fmtMoney(w.balance,w.currency);
  $('wallet-currency').textContent=`${curFlag(w.currency)} ${w.currency}`;
  const list=$('tx-list');
  if(!txs.length){list.innerHTML=`<div class="empty"><div class="icon">💸</div><h3>Sin movimientos</h3><p>Realiza tu primer depósito</p></div>`;return;}
  const isIn=t=>['deposit','transfer_in','loan_disbursement'].includes(t.type);
  const tI={deposit:'⬇️',withdrawal:'⬆️',transfer_in:'⬇️',transfer_out:'⬆️',loan_disbursement:'🏦'};
  list.innerHTML=txs.map(t=>`<div class="tx-item"><div class="tx-icon ${isIn(t)?'in':'out'}">${tI[t.type]||'💰'}</div><div class="tx-info"><div class="tx-desc">${t.description}</div><div class="tx-date">${fmtDate(t.createdAt)}${t.reference?' · '+t.reference:''}</div></div><div class="tx-amount ${isIn(t)?'in':'out'}">${isIn(t)?'+':'-'}${fmtMoney(t.amount,w.currency)}</div></div>`).join('');
}

// ── BUSINESS MODULE ───────────────────────────────────────────
const BIZ_CLIENTS=[
  {id:1,name:'María González',loan:80000,paid:55000,status:'al_dia',collector:'Pedro R.',daysOverdue:0},
  {id:2,name:'Carlos Rodríguez',loan:45000,paid:20000,status:'al_dia',collector:'Ana M.',daysOverdue:0},
  {id:3,name:'Rosa Martínez',loan:30000,paid:12000,status:'moroso',collector:'Pedro R.',daysOverdue:16},
  {id:4,name:'Luis Fernández',loan:100000,paid:75000,status:'al_dia',collector:'Ana M.',daysOverdue:0},
  {id:5,name:'Ana Torres',loan:20000,paid:0,status:'critico',collector:'Pedro R.',daysOverdue:45},
  {id:6,name:'José Ramírez',loan:60000,paid:50000,status:'al_dia',collector:'Juan P.',daysOverdue:0},
  {id:7,name:'Carmen López',loan:35000,paid:8000,status:'moroso',collector:'Juan P.',daysOverdue:22},
  {id:8,name:'Miguel Díaz',loan:50000,paid:50000,status:'pagado',collector:'Ana M.',daysOverdue:0},
];
const BIZ_COLLECTORS=[{id:1,name:'Pedro R.',zone:'Norte',assigned:3,collected:67000,efficiency:88},{id:2,name:'Ana M.',zone:'Sur',assigned:3,collected:94000,efficiency:95},{id:3,name:'Juan P.',zone:'Este',assigned:2,collected:45000,efficiency:76}];
const BIZ_MICROCREDITS=[{id:1,client:'Tienda La Esperanza',amount:8000,purpose:'Inventario',rate:28,term:6,status:'activo'},{id:2,client:'Taller Mecánico JR',amount:15000,purpose:'Equipos',rate:26,term:12,status:'activo'},{id:3,client:'Panadería El Sol',amount:6000,purpose:'Capital',rate:30,term:3,status:'pagado'},{id:4,client:'Colmado Doña Rosa',amount:10000,purpose:'Inventario',rate:28,term:9,status:'activo'}];

window.showBizTab=tab=>{
  document.querySelectorAll('.biz-tab').forEach((t,i)=>t.classList.toggle('active',['portfolio','collectors','routes','micro','delinquency'][i]===tab));
  const cont=$('biz-content');
  if(tab==='portfolio'){
    const total=BIZ_CLIENTS.reduce((s,c)=>s+c.loan,0),rec=BIZ_CLIENTS.reduce((s,c)=>s+c.paid,0);
    cont.innerHTML=`<div class="biz-stats"><div class="biz-stat"><div class="bs-val">RD$${total.toLocaleString()}</div><div class="bs-lbl">Cartera Total</div></div><div class="biz-stat"><div class="bs-val">RD$${rec.toLocaleString()}</div><div class="bs-lbl">Recuperado</div></div><div class="biz-stat"><div class="bs-val">${BIZ_CLIENTS.filter(c=>c.status==='moroso'||c.status==='critico').length}</div><div class="bs-lbl">En Mora</div></div><div class="biz-stat"><div class="bs-val">${Math.round(rec/total*100)}%</div><div class="bs-lbl">Tasa Cobro</div></div></div>
    <div class="card"><table class="biz-table"><thead><tr><th>Cliente</th><th>Préstamo</th><th>Pagado</th><th>Cobrador</th><th>Estado</th></tr></thead><tbody>
    ${BIZ_CLIENTS.map(c=>{const sM={al_dia:'<span class="badge badge-green">Al día</span>',moroso:'<span class="badge badge-amber">Moroso</span>',critico:'<span class="badge badge-red">Crítico</span>',pagado:'<span class="badge badge-blue">Pagado</span>'};return`<tr><td><strong>${c.name}</strong></td><td>RD$${c.loan.toLocaleString()}</td><td><div style="min-width:100px"><div style="height:4px;background:var(--bg3);border-radius:2px;margin-bottom:2px"><div style="height:4px;background:var(--gold);border-radius:2px;width:${Math.round(c.paid/c.loan*100)}%"></div></div>RD$${c.paid.toLocaleString()}</div></td><td>${c.collector}</td><td>${sM[c.status]||c.status}</td></tr>`;}).join('')}
    </tbody></table></div>`;
  } else if(tab==='collectors'){
    cont.innerHTML=`<div class="biz-stats">${BIZ_COLLECTORS.map(c=>`<div class="collector-card"><div style="display:flex;align-items:center;gap:12px;margin-bottom:16px"><div class="cc-avatar">${c.name[0]}</div><div><div class="cc-name">${c.name}</div><div class="cc-zone">📍 Zona ${c.zone}</div></div></div><div class="cc-stats"><div><strong>${c.assigned}</strong><span>Clientes</span></div><div><strong>RD$${c.collected.toLocaleString()}</strong><span>Cobrado</span></div><div><strong>${c.efficiency}%</strong><span>Eficiencia</span></div></div><div style="margin-top:12px"><div style="height:6px;background:var(--bg3);border-radius:3px"><div style="height:6px;background:${c.efficiency>90?'#34d399':c.efficiency>75?'#f59e0b':'#f87171'};border-radius:3px;width:${c.efficiency}%"></div></div></div></div>`).join('')}</div>`;
  } else if(tab==='routes'){
    cont.innerHTML=`<div class="routes-grid">${BIZ_COLLECTORS.map(c=>{const cls=BIZ_CLIENTS.filter(cl=>cl.collector===c.name);return`<div class="card"><div style="display:flex;align-items:center;gap:10px;margin-bottom:16px"><div class="cc-avatar" style="width:36px;height:36px;font-size:14px">${c.name[0]}</div><div><strong>${c.name}</strong><div style="font-size:12px;color:var(--text3)">Zona ${c.zone}</div></div></div>${cls.map(cl=>`<div class="route-stop"><div class="rs-dot ${cl.status==='moroso'||cl.status==='critico'?'urgent':'normal'}"></div><div class="rs-info"><div class="rs-name">${cl.name}</div><div class="rs-meta">RD$${cl.loan.toLocaleString()} · ${cl.daysOverdue>0?`<span style="color:#f87171">${cl.daysOverdue} días mora</span>`:'Al día'}</div></div></div>`).join('')}</div>`;}).join('')}</div>`;
  } else if(tab==='micro'){
    cont.innerHTML=`<div class="biz-stats"><div class="biz-stat"><div class="bs-val">${BIZ_MICROCREDITS.filter(m=>m.status==='activo').length}</div><div class="bs-lbl">Activos</div></div><div class="biz-stat"><div class="bs-val">RD$${BIZ_MICROCREDITS.filter(m=>m.status==='activo').reduce((s,m)=>s+m.amount,0).toLocaleString()}</div><div class="bs-lbl">Cartera Micro</div></div></div>
    <div class="card"><table class="biz-table"><thead><tr><th>Negocio</th><th>Monto</th><th>Propósito</th><th>Tasa</th><th>Plazo</th><th>Estado</th></tr></thead><tbody>
    ${BIZ_MICROCREDITS.map(m=>`<tr><td><strong>${m.client}</strong></td><td>RD$${m.amount.toLocaleString()}</td><td>${m.purpose}</td><td>${m.rate}%</td><td>${m.term} meses</td><td>${m.status==='activo'?'<span class="badge badge-green">Activo</span>':'<span class="badge badge-blue">Pagado</span>'}</td></tr>`).join('')}
    </tbody></table></div>`;
  } else if(tab==='delinquency'){
    const m=BIZ_CLIENTS.filter(c=>c.status==='moroso'||c.status==='critico');
    cont.innerHTML=`<div class="biz-stats"><div class="biz-stat" style="border-color:rgba(248,113,113,.3)"><div class="bs-val" style="color:#f87171">${m.length}</div><div class="bs-lbl">En Mora</div></div><div class="biz-stat" style="border-color:rgba(248,113,113,.3)"><div class="bs-val" style="color:#f87171">RD$${m.reduce((s,c)=>s+(c.loan-c.paid),0).toLocaleString()}</div><div class="bs-lbl">Deuda Vencida</div></div><div class="biz-stat"><div class="bs-val">${Math.round(m.length/BIZ_CLIENTS.length*100)}%</div><div class="bs-lbl">Índice Mora</div></div></div>
    <div class="card">${m.map(c=>`<div class="delinquency-row"><div class="dlq-left"><div class="dlq-name">${c.name}</div><div class="dlq-meta">Cobrador: ${c.collector} · ${c.daysOverdue} días vencido</div></div><div class="dlq-right"><div class="dlq-amount">RD$${(c.loan-c.paid).toLocaleString()}</div>${c.status==='critico'?'<span class="badge badge-red">Crítico</span>':'<span class="badge badge-amber">Moroso</span>'}</div></div>`).join('')}</div>`;
  }
};

// ── ACCOUNTING ────────────────────────────────────────────────
function renderAccounting(){
  const loans=DB.filter('loans',l=>l.userId===currentUser.id);
  const payments=DB.filter('payments',p=>p.userId===currentUser.id);
  const tL=loans.reduce((s,l)=>s+l.amount,0),tI=loans.reduce((s,l)=>s+(l.totalToPay-l.amount),0);
  const tC=payments.reduce((s,p)=>s+p.amount,0);
  const tP=loans.filter(l=>l.status==='approved'||l.status==='active').reduce((s,l)=>{const pd=DB.filter('payments',p=>p.loanId===l.id).reduce((a,p)=>a+p.amount,0);return s+Math.max(0,l.totalToPay-pd);},0);
  const months={};payments.forEach(p=>{const k=new Date(p.paidAt).toLocaleDateString('es',{month:'short',year:'numeric'});months[k]=(months[k]||0)+p.amount;});
  $('accounting-content').innerHTML=`
  <div class="acc-stats">
    <div class="acc-stat green"><div class="as-icon">💵</div><div class="as-body"><div class="as-val">RD$${tL.toLocaleString('es',{minimumFractionDigits:2})}</div><div class="as-lbl">Capital Prestado</div></div></div>
    <div class="acc-stat blue"><div class="as-icon">📈</div><div class="as-body"><div class="as-val">RD$${tI.toLocaleString('es',{minimumFractionDigits:2})}</div><div class="as-lbl">Intereses Proyectados</div></div></div>
    <div class="acc-stat gold"><div class="as-icon">✅</div><div class="as-body"><div class="as-val">RD$${tC.toLocaleString('es',{minimumFractionDigits:2})}</div><div class="as-lbl">Total Cobrado</div></div></div>
    <div class="acc-stat red"><div class="as-icon">⏳</div><div class="as-body"><div class="as-val">RD$${tP.toLocaleString('es',{minimumFractionDigits:2})}</div><div class="as-lbl">Pendiente</div></div></div>
  </div>
  <div class="acc-grid">
    <div class="card"><h3 style="font-size:15px;font-weight:700;margin-bottom:16px">📊 Balance Financiero</h3>
      <div class="acc-balance-rows">
        <div class="acc-balance-row"><span>Capital desembolsado</span><span class="gold">-RD$${tL.toFixed(2)}</span></div>
        <div class="acc-balance-row"><span>Pagos recibidos</span><span style="color:#34d399">+RD$${tC.toFixed(2)}</span></div>
        <div class="acc-balance-row"><span>Intereses proyectados</span><span style="color:#60a5fa">+RD$${tI.toFixed(2)}</span></div>
        <div class="acc-balance-row total"><span>Balance Neto</span><span class="gold">RD$${(tC-tL+tI).toFixed(2)}</span></div>
      </div>
    </div>
    <div class="card"><h3 style="font-size:15px;font-weight:700;margin-bottom:16px">📅 Ingresos por Mes</h3>
      ${Object.keys(months).length?Object.entries(months).reverse().map(([m,v])=>`<div class="acc-month-row"><span>${m}</span><div class="amr-bar-wrap"><div class="amr-bar" style="width:${Math.round(v/Math.max(...Object.values(months))*100)}%"></div></div><span class="gold">RD$${v.toFixed(2)}</span></div>`).join(''):'<p style="color:var(--text3);font-size:13px">Sin pagos registrados aún.</p>'}
    </div>
  </div>
  <div class="card" style="margin-top:20px"><h3 style="font-size:15px;font-weight:700;margin-bottom:16px">📋 Estado de Resultados</h3>
    <table class="biz-table"><thead><tr><th>Concepto</th><th>Monto</th><th>%</th></tr></thead><tbody>
      <tr><td>Ingresos por Capital</td><td class="gold">RD$${tL.toFixed(2)}</td><td>—</td></tr>
      <tr><td>Ingresos por Intereses</td><td class="gold">RD$${tI.toFixed(2)}</td><td>${tL>0?((tI/tL)*100).toFixed(1):0}%</td></tr>
      <tr><td>Total Ingresos</td><td class="gold">RD$${(tL+tI).toFixed(2)}</td><td>100%</td></tr>
      <tr><td>Pagos Cobrados</td><td style="color:#34d399">RD$${tC.toFixed(2)}</td><td>${(tL+tI)>0?((tC/(tL+tI))*100).toFixed(1):0}%</td></tr>
      <tr style="font-weight:700"><td>Pendiente por Cobrar</td><td style="color:#f87171">RD$${tP.toFixed(2)}</td><td>—</td></tr>
    </tbody></table>
  </div>`;
}
window.exportAccounting=()=>{
  const loans=DB.filter('loans',l=>l.userId===currentUser.id);
  const payments=DB.filter('payments',p=>p.userId===currentUser.id);
  let csv='Tipo,Referencia,Monto(DOP),Fecha,Descripcion\n';
  loans.forEach(l=>{csv+=`Préstamo,${l.invoiceNumber},${l.amount},${l.createdAt},"Desembolso #${l.id}"\n`;csv+=`Interés,${l.invoiceNumber},${(l.totalToPay-l.amount).toFixed(2)},${l.createdAt},"Intereses #${l.id} (${l.interestRate}%)"\n`;});
  payments.forEach(p=>{csv+=`Pago,${p.ref},${p.amount},${p.paidAt},"Cuota préstamo #${p.loanId} ****${p.cardLast4}"\n`;});
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const link=document.createElement('a');link.href=URL.createObjectURL(blob);
  link.download=`FJAP_Contabilidad_${new Date().toISOString().slice(0,10)}.csv`;link.click();
  showAlert('📥 CSV exportado','success');
};

// ── AI ASSISTANT ──────────────────────────────────────────────
function renderAiPage(){
  const rp=$('ai-risk-panel');if(!rp)return;
  const loans=DB.filter('loans',l=>l.userId===currentUser.id&&(l.status==='approved'||l.status==='active'));
  const w=getWallet()||{balance:0,currency:'DOP'};
  const tD=loans.reduce((s,l)=>{const pd=DB.filter('payments',p=>p.loanId===l.id).reduce((a,p)=>a+p.amount,0);return s+Math.max(0,l.totalToPay-pd);},0);
  const sc=currentUser.creditScore;const rL=!sc?'Sin datos':sc>=750?'Bajo':sc>=600?'Moderado':'Alto';const rC=!sc?'var(--text3)':sc>=750?'#34d399':sc>=600?'#f59e0b':'#f87171';
  rp.innerHTML=`<div class="risk-item"><span>Score FJAP</span><strong style="color:${rC}">${sc||'—'}</strong></div><div class="risk-item"><span>Nivel Riesgo</span><strong style="color:${rC}">${rL}</strong></div><div class="risk-item"><span>Balance</span><strong class="gold">${fmtMoney(w.balance,'DOP')}</strong></div><div class="risk-item"><span>Deuda Activa</span><strong style="color:#f87171">${fmtMoney(tD,'DOP')}</strong></div><div class="risk-item"><span>Préstamos</span><strong>${loans.length} activo(s)</strong></div>`;
}
async function sendAiMessage(){
  const input=$('ai-input');if(!input)return;const msg=input.value.trim();if(!msg)return;
  input.value='';addAiMessage(msg,'user');
  const th=addAiMessage('⏳ Analizando...','bot',true);
  const loans=DB.filter('loans',l=>l.userId===currentUser.id);
  const w=getWallet()||{balance:0};const pmts=DB.filter('payments',p=>p.userId===currentUser.id);
  const tP=pmts.reduce((s,p)=>s+p.amount,0);
  const ctx=`Eres el Asistente Financiero de FJAP Préstamos Personales, plataforma dominicana. Responde SIEMPRE en español, de forma concisa y profesional. DATOS DEL CLIENTE: Nombre: ${currentUser.fullName}, Score FJAP: ${currentUser.creditScore||'no evaluado'}, Balance: RD$${w.balance.toFixed(2)}, Préstamos activos: ${loans.filter(l=>l.status==='approved'||l.status==='active').length}, Total prestado: RD$${loans.reduce((s,l)=>s+l.amount,0).toFixed(2)}, Total pagado: RD$${tP.toFixed(2)}. TASAS: AAA 11.5%, AA 13.5%, A 16%, B 21%, C 26%. LÍMITE PRÉSTAMO: RD$1,000 a RD$100,000.`;
  try{
    const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:600,system:ctx,messages:[{role:'user',content:msg}]})});
    const data=await res.json();const reply=data.content?.[0]?.text||'No pude procesar tu consulta.';
    th.remove();addAiMessage(reply,'bot');
  }catch{th.remove();addAiMessage('No se pudo conectar. Verifica tu conexión.','bot');}
}
function addAiMessage(text,role,isTemp=false){
  const msgs=$('ai-messages');if(!msgs)return null;
  const div=document.createElement('div');div.className=`ai-msg ai-msg-${role}`;
  div.innerHTML=role==='bot'?`<div class="ai-avatar">🤖</div><div class="ai-bubble">${text.replace(/\n/g,'<br>')}</div>`:`<div class="ai-bubble ai-bubble-user">${text}</div>`;
  msgs.appendChild(div);div.scrollIntoView({behavior:'smooth',block:'end'});
  return isTemp?div:null;
}
window.quickAsk=q=>{const i=$('ai-input');if(i){i.value=q;sendAiMessage();}};
window.sendAiMessage=sendAiMessage;

// ── INVOICE ───────────────────────────────────────────────────
window.showInvoice=id=>{
  const loan=DB.find('loans',l=>l.id===id);if(!loan)return;
  const sym=curSym(loan.currency),flag=curFlag(loan.currency);
  const pM={negocio:'Negocio',vehiculo:'Vehículo',hogar:'Hogar',educacion:'Educación',salud:'Salud',deudas:'Consolidar Deudas',otros:'Otros'};
  const pyM={monthly:'Mensual',biweekly:'Quincenal',weekly:'Semanal'};
  const user=currentUser,now=new Date().toLocaleDateString('es',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  $('invoice-body').innerHTML=`<div class="inv-header"><div><div class="inv-brand">FJAP <span>Préstamos</span></div><p style="color:#888;font-size:12px;margin-top:4px">República Dominicana · contacto@fjap.com</p></div><div class="inv-num" style="text-align:right"><p style="font-size:11px;color:#888">Factura N°</p><h2>${loan.invoiceNumber}</h2><span style="display:inline-block;background:#d1fae5;color:#065f46;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;margin-top:4px">✓ Aprobado</span><div style="margin-top:4px;font-size:11px;font-weight:700;color:#92400e">${loan.riskTier?'Tier '+loan.riskTier:''}</div><div style="margin-top:6px;font-size:13px;font-weight:700">${flag} ${loan.currency}</div></div></div>
  <div class="inv-cols"><div class="inv-section"><h4>Cliente</h4><p class="val">${user.fullName}</p><p>${user.email}</p><p>Cédula: ${user.cedula}</p><p>Tel: ${user.phone}</p><p>Dir: ${user.address||'—'}</p></div><div class="inv-section"><h4>Documento</h4><p>Emisión: <span class="val">${fmtDate(loan.createdAt)}</span></p>${loan.approvedAt?`<p>Aprobación: <span class="val">${fmtDate(loan.approvedAt)}</span></p>`:''}<p>ID: <span class="val">#${loan.id}</span></p><p>Score IA: <span class="val" style="color:#059669">${loan.creditScore||'—'} pts</span></p><p>Banco: <span class="val">${loan.bankName||'—'}</span></p></div></div>
  <table class="inv-table"><thead><tr><th>Concepto</th><th style="text-align:right">Valor</th></tr></thead><tbody>
    <tr><td>Capital Prestado</td><td style="text-align:right;font-weight:700">${sym}${Number(loan.amount).toLocaleString('es',{minimumFractionDigits:2})}</td></tr>
    <tr><td>Tasa Anual</td><td style="text-align:right">${loan.interestRate}%</td></tr>
    <tr><td>Plazo</td><td style="text-align:right">${loan.termMonths} meses</td></tr>
    <tr><td>Propósito</td><td style="text-align:right">${pM[loan.purpose]||loan.purpose}</td></tr>
    <tr><td>Cuota ${pyM[loan.paymentType]||loan.paymentType}</td><td style="text-align:right;font-weight:700;color:#d97706">${sym}${loan.monthlyPayment.toFixed(2)}</td></tr>
    <tr><td>Firma Digital</td><td style="text-align:right;font-size:11px">${loan.digitalSignature?'✓ Firmado digitalmente':'—'}</td></tr>
    <tr class="total"><td>TOTAL A PAGAR</td><td style="text-align:right">${sym}${loan.totalToPay.toFixed(2)}</td></tr>
  </tbody></table>
  <div class="inv-sigs"><div class="inv-sig"><div class="inv-sig-line"></div><p>Firma del Cliente</p><p style="font-weight:700;color:#333;font-size:12px;margin-top:2px">${loan.digitalSignature||user.fullName}</p></div><div class="inv-sig"><div class="inv-sig-line"></div><p>Firma Autorizada</p><p style="font-weight:700;color:#333;font-size:12px;margin-top:2px">FJAP Préstamos Personales</p></div></div>
  <div class="inv-footer">Documento válido — Generado el ${now} · ${loan.invoiceNumber}</div>`;
  $('invoice-overlay').classList.remove('hidden');
};
window.closeInvoice=()=>$('invoice-overlay').classList.add('hidden');
window.printInvoice=()=>{const body=$('invoice-body').innerHTML;const win=window.open('','_blank');win.document.write(`<html><head><title>Factura FJAP</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;color:#111;background:#fff;padding:40px}.inv-header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:24px;border-bottom:2px solid #f59e0b;margin-bottom:24px}.inv-brand{font-size:22px;font-weight:900}.inv-brand span{color:#f59e0b}.inv-cols{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px}.inv-section h4{font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}.inv-section p{font-size:13px;color:#333;margin-bottom:2px}.inv-section .val{font-weight:700;color:#111}.inv-table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px}.inv-table th{background:#f9fafb;padding:10px 12px;text-align:left;font-size:11px;color:#888;font-weight:600}.inv-table td{padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#333}.inv-table tr.total td{font-weight:700;font-size:14px;background:#fffbeb;color:#92400e}.inv-sigs{display:flex;justify-content:space-between;margin-top:32px;padding-top:20px;border-top:1px solid #e5e7eb}.inv-sig{text-align:center}.inv-sig-line{width:160px;border-top:1px solid #ccc;margin-bottom:6px}.inv-sig p{font-size:11px;color:#888}.inv-footer{margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-size:11px;color:#aaa}</style></head><body>${body}</body></html>`);win.document.close();win.focus();win.print();win.close();};

// ── AUTH MODAL ────────────────────────────────────────────────
window.openAuth=tab=>{$('auth-overlay').classList.remove('hidden');switchAuthTab(tab||'login');faceVerified=false;captchaVerified=false;govtVerified=false;regStep=1;regData={};goToRegStep(1);};
window.closeAuth=e=>{if(!e||e.target===$('auth-overlay'))$('auth-overlay').classList.add('hidden');};
window.switchAuthTab=tab=>{$('tab-login').classList.toggle('active',tab==='login');$('tab-register').classList.toggle('active',tab==='register');$('form-login').classList.toggle('hidden',tab!=='login');$('form-register').classList.toggle('hidden',tab!=='register');$('auth-err').textContent='';};

// ── ALERTS ────────────────────────────────────────────────────
function showAlert(msg,type){const a=$('global-alert');a.textContent=msg;a.className=`alert alert-${type==='success'?'success':'error'}`;a.style.cssText='position:fixed;top:20px;right:20px;z-index:9999;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:600;animation:fadein .3s;max-width:380px';a.classList.remove('hidden');setTimeout(()=>a.classList.add('hidden'),4500);}

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  if(currentUser){showApp('home');}else{showLanding();}
  document.querySelectorAll('.nav-item').forEach(btn=>{
    btn.addEventListener('click',()=>{const page=btn.dataset.page;if(page==='logout'){logout();return;}showPage(page);if(page==='apply')initApplyForm();});
  });
  $('btn-apply-nav')?.addEventListener('click',()=>{showPage('apply');initApplyForm();});
});
window.showLoanDetail=showLoanDetail;window.showPage=showPage;window.logout=logout;window.showApp=showApp;
