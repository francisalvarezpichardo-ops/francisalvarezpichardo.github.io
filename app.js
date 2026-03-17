// ── STORAGE ──────────────────────────────────────────────────
const DB = {
  get: k => JSON.parse(localStorage.getItem('fjap_' + k) || 'null'),
  set: (k, v) => localStorage.setItem('fjap_' + k, JSON.stringify(v)),
  push: (k, item) => { const arr = DB.get(k) || []; arr.push(item); DB.set(k, arr); return item; },
  update: (k, id, patch) => {
    const arr = DB.get(k) || [];
    const idx = arr.findIndex(x => x.id === id);
    if (idx !== -1) { arr[idx] = { ...arr[idx], ...patch }; DB.set(k, arr); return arr[idx]; }
    return null;
  },
  find:   (k, pred) => (DB.get(k) || []).find(pred),
  filter: (k, pred) => (DB.get(k) || []).filter(pred),
  nextId: k => { const n = (DB.get('seq_' + k) || 0) + 1; DB.set('seq_' + k, n); return n; },
};

// ── CURRENCIES ────────────────────────────────────────────────
const CURRENCIES = [
  { code:'USD', name:'Dólar Americano',      flag:'🇺🇸', sym:'$'   },
  { code:'DOP', name:'Peso Dominicano',      flag:'🇩🇴', sym:'RD$' },
  { code:'EUR', name:'Euro',                 flag:'🇪🇺', sym:'€'   },
  { code:'MXN', name:'Peso Mexicano',        flag:'🇲🇽', sym:'$'   },
  { code:'COP', name:'Peso Colombiano',      flag:'🇨🇴', sym:'$'   },
  { code:'CLP', name:'Peso Chileno',         flag:'🇨🇱', sym:'$'   },
  { code:'PEN', name:'Sol Peruano',          flag:'🇵🇪', sym:'S/'  },
  { code:'ARS', name:'Peso Argentino',       flag:'🇦🇷', sym:'$'   },
  { code:'BRL', name:'Real Brasileño',       flag:'🇧🇷', sym:'R$'  },
  { code:'GTQ', name:'Quetzal Guatemalteco', flag:'🇬🇹', sym:'Q'   },
];
const curSym  = code => (CURRENCIES.find(c => c.code === code) || {}).sym  || '$';
const curFlag = code => (CURRENCIES.find(c => c.code === code) || {}).flag || '🌐';

// ── MATH ──────────────────────────────────────────────────────
function calcMonthly(principal, annualRate, months) {
  if (annualRate === 0) return principal / months;
  const r = annualRate / 100 / 12;
  return (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
}
function buildAmortization(principal, annualRate, months) {
  const r = annualRate / 100 / 12;
  const monthly = calcMonthly(principal, annualRate, months);
  let balance = principal; const rows = []; const now = new Date();
  for (let i = 1; i <= months; i++) {
    const interest = balance * r;
    const princ = monthly - interest;
    balance = Math.max(0, balance - princ);
    const d = new Date(now); d.setMonth(d.getMonth() + i);
    rows.push({ period: i, date: d.toLocaleDateString('es', { month: 'short', year: 'numeric' }),
      principal: +(princ.toFixed(2)), interest: +(interest.toFixed(2)),
      payment: +(monthly.toFixed(2)), balance: +(balance.toFixed(2)) });
  }
  return rows;
}

// ══════════════════════════════════════════════════════════════
// ── CREDIT SCORING ENGINE ─────────────────────────────────────
// ══════════════════════════════════════════════════════════════
function calculateAge(birthDateStr) {
  if (!birthDateStr) return NaN;
  const birth = new Date(birthDateStr);
  if (isNaN(birth)) return NaN;
  return Math.floor((Date.now() - birth) / (365.25 * 24 * 3600 * 1000));
}
function checkOverdueLoans() {
  if (!currentUser) return false;
  return DB.filter('loans', l => l.userId === currentUser.id && l.status === 'overdue').length > 0;
}
function checkCooldown() {
  if (!currentUser) return null;
  const key = 'rejection_cooldown_' + currentUser.id;
  const cooldown = DB.get(key);
  if (!cooldown) return null;
  const daysPassed = (Date.now() - new Date(cooldown.rejectedAt)) / (1000 * 3600 * 24);
  if (daysPassed < 30) return Math.ceil(30 - daysPassed);
  DB.set(key, null); return null;
}
function getTrustBonus() {
  if (!currentUser) return 0;
  const paidOff = DB.filter('loans', l => l.userId === currentUser.id && l.status === 'paid').length;
  return paidOff >= 3 ? 80 : paidOff >= 2 ? 55 : paidOff >= 1 ? 30 : 0;
}
function advancedCreditScore({ monthlyIncome, debtLevel, employmentYears, amount, termMonths, age, purpose, dependents, occupationType }) {
  const hardRejects = [], warnings = [];
  if (isNaN(age) || age < 18) hardRejects.push({ phase: 1, code: 'AGE_LOW', reason: 'Edad mínima requerida: 18 años.' });
  if (age > 70) hardRejects.push({ phase: 1, code: 'AGE_HIGH', reason: 'Edad máxima permitida: 70 años.' });
  const income = monthlyIncome || 0, debt = debtLevel || 0;
  if (!income || income < 500) hardRejects.push({ phase: 2, code: 'INCOME_LOW', reason: 'Ingreso mensual mínimo: $500.00.' });
  const dti = income > 0 ? (debt / income) * 100 : 999;
  if (dti > 55) hardRejects.push({ phase: 2, code: 'DTI_CRITICAL', reason: `DTI crítico: ${dti.toFixed(1)}%. Máximo: 55%.` });
  else if (dti > 40) warnings.push('DTI elevado (' + dti.toFixed(1) + '%).');
  else if (dti > 25) warnings.push('DTI moderado (' + dti.toFixed(1) + '%).');
  const empYears = employmentYears || 0;
  if (empYears < 0.5 && amount > 3000) hardRejects.push({ phase: 4, code: 'EMP_TOO_SHORT', reason: 'Mínimo 6 meses de antigüedad para montos > $3,000.' });
  else if (empYears < 1) warnings.push('Antigüedad laboral < 12 meses.');
  const incomeRatio = income > 0 ? amount / income : 999;
  if (incomeRatio > 10) hardRejects.push({ phase: 4, code: 'RATIO_CRITICAL', reason: `Monto supera 10x el ingreso mensual.` });
  else if (incomeRatio > 6) warnings.push(`Monto alto en relación al ingreso (${incomeRatio.toFixed(1)}x).`);
  if (dependents >= 4) warnings.push(`${dependents} dependientes declarados.`);
  const trustBonus = getTrustBonus();
  let score = 330 + trustBonus;
  score += Math.min(180, (income / 5000) * 160);
  score += dti < 8 ? 140 : dti < 15 ? 115 : dti < 25 ? 85 : dti < 35 ? 50 : dti < 45 ? 20 : 5;
  score += Math.min(95, empYears * 24);
  const ltv = amount / (income * termMonths || 1);
  score += ltv < 0.25 ? 110 : ltv < 0.45 ? 85 : ltv < 0.70 ? 60 : ltv < 1.1 ? 30 : 8;
  const purposeAdj = { negocio: 28, vehiculo: 18, hogar: 22, deudas: -18, otros: 0 };
  score += purposeAdj[purpose] || 0;
  const occupationAdj = { empresario: 20, independiente: 5, empleado: 10, jubilado: 15, otro: 0 };
  score += occupationAdj[occupationType] || 0;
  score -= Math.min(50, (dependents || 0) * 9);
  score = Math.round(Math.min(900, Math.max(200, score)));
  let approved = hardRejects.length === 0, interestRate = null, riskTier = null;
  if (approved) {
    if      (score >= 800) { interestRate = 11.5; riskTier = 'AAA'; }
    else if (score >= 720) { interestRate = 13.5; riskTier = 'AA';  }
    else if (score >= 650) { interestRate = 16;   riskTier = 'A';   }
    else if (score >= 570) { interestRate = 21;   riskTier = 'B';   }
    else if (score >= 550) { interestRate = 26;   riskTier = 'C';   }
    else { approved = false; riskTier = 'D'; }
  }
  return { score, hardRejects, warnings, approved, interestRate, riskTier,
           dti: +dti.toFixed(1), incomeRatio: +incomeRatio.toFixed(1), trustBonus };
}
function buildVerificationPhases(params, s) {
  const { hardRejects, warnings, score, dti, incomeRatio, approved, interestRate, riskTier, trustBonus } = s;
  const findR = phase => hardRejects.find(r => r.phase === phase);
  const phases = []; let blocked = false;
  const r1 = findR(1);
  phases.push({ icon:'🪪', label:'Verificación de Identidad', subtext:'Cédula, edad, dirección', duration:1900, status: r1 ? 'fail' : 'pass', resultText: r1 ? r1.reason : `Identidad confirmada · ${params.age} años`, hardFail: !!r1 });
  if (r1) blocked = true;
  const r2 = blocked ? null : findR(2);
  phases.push({ icon:'💰', label:'Capacidad de Pago', subtext:'Ingresos, deudas, DTI', duration:2300, status: blocked ? 'skipped' : r2 ? 'fail' : dti >= 25 ? 'warning' : 'pass', resultText: blocked ? 'No evaluado' : r2 ? r2.reason : `DTI: ${dti}% ${dti >= 25 ? '⚠' : '✓'}`, hardFail: !blocked && !!r2 });
  if (!blocked && r2) blocked = true;
  const hasOverdue = !blocked && checkOverdueLoans();
  phases.push({ icon:'📋', label:'Historial Crediticio FJAP', subtext:'Comportamiento previo, morosidades', duration:2100, status: blocked ? 'skipped' : hasOverdue ? 'fail' : 'pass', resultText: blocked ? 'No evaluado' : hasOverdue ? 'Préstamo vencido activo — bloqueado' : trustBonus > 0 ? `Bono de confianza +${trustBonus} pts ✦` : 'Perfil limpio', hardFail: !blocked && hasOverdue });
  if (!blocked && hasOverdue) blocked = true;
  const r4 = blocked ? null : findR(4);
  phases.push({ icon:'💼', label:'Estabilidad Laboral', subtext:'Empleador, antigüedad', duration:1700, status: blocked ? 'skipped' : r4 ? 'fail' : empYears(params) < 1 ? 'warning' : 'pass', resultText: blocked ? 'No evaluado' : r4 ? r4.reason : `${params.employmentYears} año(s) en el empleo ✓`, hardFail: !blocked && !!r4 });
  if (!blocked && r4) blocked = true;
  const scoreInsuff = !blocked && score < 550;
  phases.push({ icon:'🤖', label:'Motor de Riesgo IA', subtext:'22 variables financieras', duration:3100, status: blocked ? 'skipped' : scoreInsuff ? 'fail' : score < 650 ? 'warning' : 'pass', resultText: blocked ? 'No evaluado' : scoreInsuff ? `Score insuficiente: ${score} pts (mín. 550)` : `Score FJAP: ${score} pts · Tier ${riskTier}`, hardFail: !blocked && scoreInsuff });
  if (!blocked && scoreInsuff) blocked = true;
  phases.push({ icon:'⚖️', label:'Decisión del Comité', subtext:'Resolución definitiva', duration:2000, status: blocked ? 'fail' : 'pass', resultText: blocked ? 'Solicitud denegada' : `Aprobado · ${interestRate}% anual · Tier ${riskTier}`, hardFail: false });
  return phases;
}
function empYears(p) { return p.employmentYears || 0; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function animatePhases(phases) {
  const list = $('verify-phases-list'); list.innerHTML = '';
  phases.forEach((p, i) => {
    const row = document.createElement('div'); row.className = 'vphase-item'; row.id = 'vphase-' + i;
    row.innerHTML = `<div class="vphase-status-wrap"><div class="vphase-status pending" id="vstatus-${i}"><span class="vphase-dot"></span></div></div><div class="vphase-icon-wrap">${p.icon}</div><div class="vphase-body"><div class="vphase-label">${p.label}</div><div class="vphase-sub">${p.subtext}</div></div><div class="vphase-badge hidden" id="vbadge-${i}"></div>`;
    list.appendChild(row);
  });
  let firstFail = false;
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    if (p.status === 'skipped') { setPhaseSkipped(i); continue; }
    const statusEl = $('vstatus-' + i);
    statusEl.className = 'vphase-status running'; statusEl.innerHTML = '<div class="vphase-spin"></div>';
    $('vphase-' + i).classList.add('active');
    $('vphase-' + i).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    await sleep(p.duration);
    const icons = { pass:'✓', warning:'⚠', fail:'✗' };
    statusEl.className = `vphase-status ${p.status}`; statusEl.innerHTML = `<span>${icons[p.status]}</span>`;
    $('vphase-' + i).classList.remove('active'); $('vphase-' + i).classList.add('done');
    const badge = $('vbadge-' + i); badge.textContent = p.resultText; badge.className = `vphase-badge ${p.status}`; badge.classList.remove('hidden');
    await sleep(250);
    if (p.hardFail && !firstFail) {
      firstFail = true; await sleep(300);
      for (let j = i + 1; j < phases.length; j++) { setPhaseSkipped(j); await sleep(80); }
      break;
    }
  }
}
function setPhaseSkipped(i) {
  const s = $('vstatus-' + i); if (s) { s.className = 'vphase-status skipped'; s.innerHTML = '<span>—</span>'; }
  const b = $('vbadge-' + i); if (b) { b.textContent = 'No evaluado'; b.className = 'vphase-badge skipped'; b.classList.remove('hidden'); }
}
function showVerificationResult(sr) {
  const resEl = $('verify-result'); if (!resEl) return;
  const { approved, score, interestRate, riskTier, hardRejects, warnings, trustBonus } = sr;
  const monthly = approved ? calcMonthly(applyAmount, interestRate, applyTerm) : 0;
  const scoreColor = score >= 750 ? '#34d399' : score >= 650 ? '#f59e0b' : score >= 550 ? '#fb923c' : '#f87171';
  const circumference = 2 * Math.PI * 50;
  const targetOffset = +(circumference * (1 - Math.max(0, Math.min(1, (score - 200) / 700)))).toFixed(1);
  const tierDesc = { AAA:'Riesgo Mínimo', AA:'Riesgo Muy Bajo', A:'Riesgo Bajo', B:'Riesgo Moderado', C:'Riesgo Alto', D:'No Califica' };
  if (approved) {
    resEl.innerHTML = `<div class="vresult approved"><div class="vresult-icon-big">✅</div><h3 class="vresult-title">¡Préstamo Pre-Aprobado!</h3><p class="vresult-subtitle">Aprobado por el Comité de Crédito FJAP</p>
    <div class="score-ring-wrap"><svg viewBox="0 0 120 120" width="130" height="130"><circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="9"/><circle class="score-ring-progress" cx="60" cy="60" r="50" fill="none" stroke="${scoreColor}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference}" transform="rotate(-90 60 60)" style="transition:stroke-dashoffset 1.6s cubic-bezier(.4,0,.2,1)"/></svg><div class="score-ring-inner"><div class="score-ring-num" style="color:${scoreColor}">${score}</div><div class="score-ring-lbl">Score FJAP</div></div></div>
    <div class="vresult-grid"><div class="vresult-cell"><div class="vc-label">Tasa Anual</div><div class="vc-val gold">${interestRate}%</div></div><div class="vresult-cell"><div class="vc-label">Tier</div><div class="vc-val">${riskTier}</div></div><div class="vresult-cell"><div class="vc-label">Clasificación</div><div class="vc-val">${tierDesc[riskTier]||''}</div></div><div class="vresult-cell"><div class="vc-label">Cuota Est.</div><div class="vc-val gold">${curSym(selectedCurrency)}${monthly.toFixed(2)}</div></div></div>
    ${trustBonus > 0 ? `<div class="trust-bonus-badge">✦ Bono Cliente Fiel: +${trustBonus} pts</div>` : ''}
    ${warnings.length ? `<div class="vresult-warnings"><div class="vw-title">⚠ Observaciones</div>${warnings.map(w => `<div class="vw-item">· ${w}</div>`).join('')}</div>` : ''}
    <p class="vresult-note">Confirma para recibir los fondos en tu billetera.</p></div>`;
  } else {
    const reason = hardRejects.length ? hardRejects[0].reason : 'Score insuficiente.';
    const rejectCode = hardRejects.length ? hardRejects[0].code : 'SCORE_LOW';
    DB.set('rejection_cooldown_' + currentUser.id, { userId: currentUser.id, rejectedAt: new Date().toISOString(), reason, code: rejectCode });
    resEl.innerHTML = `<div class="vresult rejected"><div class="vresult-icon-big">❌</div><h3 class="vresult-title">Solicitud No Aprobada</h3><p class="vresult-subtitle">El comité no pudo aprobar tu solicitud</p>
    <div class="score-ring-wrap"><svg viewBox="0 0 120 120" width="130" height="130"><circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="9"/><circle class="score-ring-progress" cx="60" cy="60" r="50" fill="none" stroke="#f87171" stroke-width="9" stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference}" transform="rotate(-90 60 60)" style="transition:stroke-dashoffset 1.6s cubic-bezier(.4,0,.2,1)"/></svg><div class="score-ring-inner"><div class="score-ring-num" style="color:#f87171">${score}</div><div class="score-ring-lbl">Score FJAP</div></div></div>
    <div class="reject-reason-box"><div class="rrb-title">🚫 Motivo</div><div class="rrb-text">${reason}</div><div class="rrb-code">Código: ${rejectCode}</div></div>
    <div class="vresult-grid"><div class="vresult-cell"><div class="vc-label">Score</div><div class="vc-val" style="color:#f87171">${score}</div></div><div class="vresult-cell"><div class="vc-label">Mínimo</div><div class="vc-val">550 pts</div></div><div class="vresult-cell"><div class="vc-label">Nivel</div><div class="vc-val" style="color:#f87171">Tier D</div></div><div class="vresult-cell"><div class="vc-label">Próxima solicitud</div><div class="vc-val">30 días</div></div></div>
    <div class="reject-tips"><div class="rt-title">💡 Cómo mejorar:</div><div class="rt-item">• Reduce tus deudas para bajar el DTI</div><div class="rt-item">• Aumenta tu antigüedad laboral</div><div class="rt-item">• Solicita un monto menor</div><div class="rt-item">• Mantén ingresos estables</div></div>
    <p class="vresult-note" style="color:#f87171">⏳ Podrás volver a solicitar en 30 días.</p></div>`;
  }
  setTimeout(() => { const ring = resEl.querySelector('.score-ring-progress'); if (ring) ring.style.strokeDashoffset = targetOffset; }, 80);
  resEl.classList.remove('hidden');
  const submitBtn = $('btn-submit'); if (submitBtn) submitBtn.style.display = approved ? '' : 'none';
  const spinWrap = $('verify-spinner-wrap');
  if ($('verify-title')) $('verify-title').textContent = approved ? 'Evaluación Completada' : 'Evaluación Finalizada';
  if ($('verify-subtitle')) $('verify-subtitle').textContent = approved ? 'Tu perfil fue aprobado' : 'Solicitud no aprobada';
  if (spinWrap) spinWrap.innerHTML = approved ? '<div class="verify-done-ring">✓</div>' : '<div class="verify-fail-ring">✗</div>';
}

// ── AUTH ──────────────────────────────────────────────────────
let currentUser = DB.get('session') || null;
function register({ email, password, fullName, phone, cedula }) {
  if (DB.find('users', u => u.email === email)) return { error: 'El email ya está registrado.' };
  const salt = Math.random().toString(36).slice(2);
  const hash = btoa(password + salt);
  const user = { id: DB.nextId('user'), email, passwordHash: hash, salt, fullName, phone, cedula, creditScore: null, createdAt: new Date().toISOString() };
  DB.push('users', user);
  DB.push('wallets', { id: DB.nextId('wallet'), userId: user.id, balance: 0, currency: 'USD', createdAt: new Date().toISOString() });
  currentUser = user; DB.set('session', user); return { user };
}
function login({ email, password }) {
  const user = DB.find('users', u => u.email === email);
  if (!user) return { error: 'Credenciales inválidas.' };
  if (btoa(password + user.salt) !== user.passwordHash) return { error: 'Credenciales inválidas.' };
  currentUser = user; DB.set('session', user); return { user };
}
function logout() { currentUser = null; DB.set('session', null); showLanding(); }
function requireAuth() { if (!currentUser) { showLanding(); return false; } return true; }

// ── WALLET ────────────────────────────────────────────────────
function getWallet() { return DB.find('wallets', w => w.userId === currentUser.id); }
function deposit(amount, description) {
  const w = getWallet(); if (!w) return;
  DB.update('wallets', w.id, { balance: w.balance + amount });
  DB.push('transactions', { id: DB.nextId('tx'), walletId: w.id, type: 'deposit', amount, description: description || 'Depósito', createdAt: new Date().toISOString() });
}
function withdraw(amount, description) {
  const w = getWallet(); if (!w || w.balance < amount) return false;
  DB.update('wallets', w.id, { balance: w.balance - amount });
  DB.push('transactions', { id: DB.nextId('tx'), walletId: w.id, type: 'withdrawal', amount, description: description || 'Retiro', createdAt: new Date().toISOString() });
  return true;
}
function transfer(amount, recipientEmail, description) {
  const sender = getWallet(); if (!sender || sender.balance < amount) return { error: 'Saldo insuficiente.' };
  const recipient = DB.find('users', u => u.email === recipientEmail); if (!recipient) return { error: 'Destinatario no encontrado.' };
  const rWallet = DB.find('wallets', w => w.userId === recipient.id);
  const ref = 'TRF-' + Date.now();
  DB.update('wallets', sender.id, { balance: sender.balance - amount });
  DB.push('transactions', { id: DB.nextId('tx'), walletId: sender.id, type: 'transfer_out', amount, description: description || `Transferencia a ${recipientEmail}`, reference: ref, createdAt: new Date().toISOString() });
  if (rWallet) { DB.update('wallets', rWallet.id, { balance: rWallet.balance + amount }); DB.push('transactions', { id: DB.nextId('tx'), walletId: rWallet.id, type: 'transfer_in', amount, description: 'Transferencia recibida', reference: ref, createdAt: new Date().toISOString() }); }
  return { ok: true };
}

// ── CARD VALIDATION ───────────────────────────────────────────
function validateCard(number, exp, cvv, name) {
  const digits = number.replace(/\s/g, '');
  if (digits.length !== 16) return 'El número de tarjeta debe tener exactamente 16 dígitos.';
  if (!/^\d{16}$/.test(digits)) return 'El número de tarjeta solo puede contener dígitos.';
  if (!luhnCheck(digits)) return 'Número de tarjeta inválido (falla verificación Luhn).';
  if (!/^\d{2}\/\d{2}$/.test(exp)) return 'Fecha de vencimiento inválida. Usa MM/AA.';
  const [mm, yy] = exp.split('/').map(Number);
  if (mm < 1 || mm > 12) return 'Mes de vencimiento inválido (01-12).';
  const now = new Date(), expDate = new Date(2000 + yy, mm - 1, 1);
  if (expDate < new Date(now.getFullYear(), now.getMonth(), 1)) return 'La tarjeta está vencida.';
  const cvvClean = cvv.replace(/\D/g, '');
  if (cvvClean.length < 3 || cvvClean.length > 4) return 'El CVV debe tener 3 o 4 dígitos.';
  if (!name || name.trim().length < 3) return 'Ingresa el nombre completo del titular.';
  return null;
}
function luhnCheck(num) {
  let sum = 0, alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = parseInt(num[i], 10);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}
window.formatCardNumber = (input) => {
  let v = input.value.replace(/\D/g, '').slice(0, 16);
  input.value = v.match(/.{1,4}/g)?.join(' ') || v;
  const preview = $('cp-number');
  if (preview) {
    const padded = v.padEnd(16, '•');
    preview.textContent = padded.match(/.{1,4}/g).join(' ');
  }
  const expEl = $('cp-exp');
  const expInput = $('card-exp');
  if (expEl && expInput) expEl.textContent = expInput.value || 'MM/AA';
};
window.formatCardExp = (input) => {
  let v = input.value.replace(/\D/g, '').slice(0, 4);
  if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
  input.value = v;
  const expEl = $('cp-exp');
  if (expEl) expEl.textContent = v || 'MM/AA';
};
window.formatPayCard = (input) => {
  let v = input.value.replace(/\D/g, '').slice(0, 16);
  input.value = v.match(/.{1,4}/g)?.join(' ') || v;
  const preview = $('pcp-number');
  if (preview) { const padded = v.padEnd(16, '•'); preview.textContent = padded.match(/.{1,4}/g).join(' '); }
};
window.formatPayCardExp = (input) => {
  let v = input.value.replace(/\D/g, '').slice(0, 4);
  if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
  input.value = v;
  const expEl = $('pcp-exp');
  if (expEl) expEl.textContent = v || 'MM/AA';
};

// ── CARD MODAL ────────────────────────────────────────────────
let cardAction = 'deposit';
window.openCardModal = (action) => {
  cardAction = action;
  const titles = { deposit:'⬇ Depositar Fondos', withdraw:'⬆ Retirar Fondos', transfer:'↔ Transferir Fondos' };
  $('card-modal-title').textContent = titles[action] || 'Operación';
  $('card-transfer-row').style.display = action === 'transfer' ? '' : 'none';
  $('card-modal-err').style.display = 'none';
  $('card-number').value = ''; $('card-exp').value = ''; $('card-cvv').value = '';
  $('card-name').value = ''; $('card-amount').value = ''; $('card-desc').value = '';
  if ($('card-recipient')) $('card-recipient').value = '';
  $('cp-number').textContent = '•••• •••• •••• ••••'; $('cp-name').textContent = 'TU NOMBRE'; $('cp-exp').textContent = 'MM/AA';
  $('card-modal-overlay').classList.remove('hidden');
};
window.closeCardModal = () => $('card-modal-overlay').classList.add('hidden');
window.submitCardOp = () => {
  const number = $('card-number').value;
  const exp    = $('card-exp').value;
  const cvv    = $('card-cvv').value;
  const name   = $('card-name').value;
  const amount = +$('card-amount').value;
  const desc   = $('card-desc').value;
  const errEl  = $('card-modal-err');
  const cardErr = validateCard(number, exp, cvv, name);
  if (cardErr) { errEl.textContent = cardErr; errEl.style.display = 'block'; return; }
  if (!amount || amount <= 0) { errEl.textContent = 'Ingresa un monto válido.'; errEl.style.display = 'block'; return; }
  if (cardAction === 'deposit') {
    deposit(amount, desc || `Depósito con tarjeta ****${number.replace(/\s/g,'').slice(-4)}`);
    closeCardModal(); renderWallet(); showAlert('✅ Depósito realizado con éxito', 'success');
  } else if (cardAction === 'withdraw') {
    const ok = withdraw(amount, desc || `Retiro a tarjeta ****${number.replace(/\s/g,'').slice(-4)}`);
    if (!ok) { errEl.textContent = 'Saldo insuficiente.'; errEl.style.display = 'block'; return; }
    closeCardModal(); renderWallet(); showAlert('✅ Retiro realizado con éxito', 'success');
  } else if (cardAction === 'transfer') {
    const email = $('card-recipient')?.value;
    if (!email) { errEl.textContent = 'Ingresa el email del destinatario.'; errEl.style.display = 'block'; return; }
    const result = transfer(amount, email, desc);
    if (result.error) { errEl.textContent = result.error; errEl.style.display = 'block'; return; }
    closeCardModal(); renderWallet(); showAlert('✅ Transferencia realizada', 'success');
  }
};

// ── LOAN PAYMENT MODULE ───────────────────────────────────────
let payingLoanId = null;
function renderPayPage() {
  const loans = DB.filter('loans', l => l.userId === currentUser.id && (l.status === 'approved' || l.status === 'active'));
  const cont = $('pay-content');
  if (!loans.length) {
    cont.innerHTML = `<div class="empty"><div class="icon">💰</div><h3>Sin préstamos activos</h3><p>Cuando tengas un préstamo aprobado podrás pagar tus cuotas aquí.</p><button class="btn btn-gold" onclick="showPage('apply');initApplyForm()">Solicitar Préstamo</button></div>`;
    return;
  }
  cont.innerHTML = `
    <div class="pay-grid">
      ${loans.map(l => {
        const sym = curSym(l.currency);
        const paid = DB.filter('payments', p => p.loanId === l.id).reduce((s, p) => s + p.amount, 0);
        const remaining = Math.max(0, l.totalToPay - paid);
        const pct = Math.round((paid / l.totalToPay) * 100);
        return `<div class="pay-loan-card">
          <div class="plc-head">
            <div><div class="plc-id">Préstamo #${l.id}</div><span class="badge badge-green">Activo</span></div>
            <div class="plc-amount">${sym}${Number(l.amount).toLocaleString('es')}</div>
          </div>
          <div class="plc-progress-wrap">
            <div class="plc-progress-bar"><div class="plc-progress-fill" style="width:${pct}%"></div></div>
            <div class="plc-progress-labels"><span>${pct}% pagado</span><span>${sym}${remaining.toFixed(2)} restante</span></div>
          </div>
          <div class="plc-details">
            <div class="plc-det"><span>Cuota mensual</span><strong class="gold">${sym}${l.monthlyPayment.toFixed(2)}</strong></div>
            <div class="plc-det"><span>Tasa anual</span><strong>${l.interestRate}%</strong></div>
            <div class="plc-det"><span>Plazo</span><strong>${l.termMonths} meses</strong></div>
            <div class="plc-det"><span>Total pagado</span><strong>${sym}${paid.toFixed(2)}</strong></div>
          </div>
          <button class="btn btn-gold btn-full" onclick="openPayCardModal(${l.id})">💳 Pagar Cuota — ${sym}${l.monthlyPayment.toFixed(2)}</button>
        </div>`;
      }).join('')}
    </div>
    <div class="card" style="margin-top:24px">
      <h3 style="font-size:16px;font-weight:700;margin-bottom:20px">📜 Historial de Pagos</h3>
      <div id="payment-history-list">${renderPaymentHistory()}</div>
    </div>`;
}
function renderPaymentHistory() {
  const allPayments = DB.filter('payments', p => {
    const loan = DB.find('loans', l => l.id === p.loanId);
    return loan && loan.userId === currentUser.id;
  }).sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt));
  if (!allPayments.length) return `<div class="empty" style="padding:40px"><div class="icon" style="font-size:32px">📭</div><p>Sin pagos registrados aún.</p></div>`;
  return allPayments.map(p => {
    const loan = DB.find('loans', l => l.id === p.loanId);
    const sym = curSym(loan?.currency || 'USD');
    return `<div class="tx-item"><div class="tx-icon in">✅</div><div class="tx-info"><div class="tx-desc">Pago Préstamo #${p.loanId} — ****${p.cardLast4}</div><div class="tx-date">${fmtDate(p.paidAt)} · Ref: ${p.ref}</div></div><div class="tx-amount in">-${sym}${p.amount.toFixed(2)}</div></div>`;
  }).join('');
}
window.openPayCardModal = (loanId) => {
  payingLoanId = loanId;
  const loan = DB.find('loans', l => l.id === loanId); if (!loan) return;
  const sym = curSym(loan.currency);
  const paid = DB.filter('payments', p => p.loanId === loanId).reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(0, loan.totalToPay - paid);
  $('pay-summary-box').innerHTML = `
    <div class="psb-row"><span>Préstamo</span><strong>#${loan.id}</strong></div>
    <div class="psb-row"><span>Cuota a Pagar</span><strong class="gold">${sym}${loan.monthlyPayment.toFixed(2)}</strong></div>
    <div class="psb-row"><span>Saldo Restante</span><strong>${sym}${remaining.toFixed(2)}</strong></div>`;
  $('pay-card-err').style.display = 'none';
  $('pay-card-number').value = ''; $('pay-card-exp').value = ''; $('pay-card-cvv').value = ''; $('pay-card-name').value = '';
  $('pcp-number').textContent = '•••• •••• •••• ••••'; $('pcp-name').textContent = 'TU NOMBRE'; $('pcp-exp').textContent = 'MM/AA';
  $('pay-card-overlay').classList.remove('hidden');
};
window.closePayCardModal = () => $('pay-card-overlay').classList.add('hidden');
window.confirmLoanPayment = () => {
  const number = $('pay-card-number').value;
  const exp    = $('pay-card-exp').value;
  const cvv    = $('pay-card-cvv').value;
  const name   = $('pay-card-name').value;
  const errEl  = $('pay-card-err');
  const cardErr = validateCard(number, exp, cvv, name);
  if (cardErr) { errEl.textContent = cardErr; errEl.style.display = 'block'; return; }
  const loan = DB.find('loans', l => l.id === payingLoanId); if (!loan) return;
  const payAmount = loan.monthlyPayment;
  const cardLast4 = number.replace(/\s/g, '').slice(-4);
  const ref = 'PAY-' + Date.now();
  DB.push('payments', { id: DB.nextId('payment'), loanId: loan.id, userId: currentUser.id, amount: payAmount, cardLast4, ref, paidAt: new Date().toISOString() });
  const allPaid = DB.filter('payments', p => p.loanId === loan.id).reduce((s, p) => s + p.amount, 0);
  if (allPaid >= loan.totalToPay - 0.01) {
    DB.update('loans', loan.id, { status: 'paid' });
    showAlert('🎉 ¡Préstamo pagado completamente!', 'success');
  } else {
    showAlert(`✅ Pago de ${curSym(loan.currency)}${payAmount.toFixed(2)} registrado`, 'success');
  }
  closePayCardModal();
  renderPayPage();
  renderHome();
};

// ── LOAN CREATE ───────────────────────────────────────────────
function createLoan(data) {
  const rate = data.interestRate || 15.5;
  const monthly = calcMonthly(data.amount, rate, data.termMonths);
  const total = monthly * data.termMonths;
  const inv = 'FJAP-' + Date.now();
  const loan = { id: DB.nextId('loan'), userId: currentUser.id, amount: data.amount, termMonths: data.termMonths, interestRate: rate, paymentType: data.paymentType, amortizationType: data.amortizationType, currency: data.currency || 'USD', status: 'approved', monthlyPayment: +(monthly.toFixed(2)), totalToPay: +(total.toFixed(2)), purpose: data.purpose, monthlyIncome: data.monthlyIncome, employer: data.employer, employmentYears: data.employmentYears, address: data.address, birthDate: data.birthDate, maritalStatus: data.maritalStatus, dependents: data.dependents || 0, debtLevel: data.debtLevel || 0, occupationType: data.occupationType || 'empleado', reference1Name: data.reference1Name || null, reference1Phone: data.reference1Phone || null, reference2Name: data.reference2Name || null, reference2Phone: data.reference2Phone || null, invoiceNumber: inv, creditScore: data.creditScore, riskTier: data.riskTier, approvedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
  DB.push('loans', loan);
  const users = DB.get('users') || []; const idx = users.findIndex(u => u.id === currentUser.id);
  if (idx !== -1) { users[idx].creditScore = data.creditScore; DB.set('users', users); currentUser = users[idx]; DB.set('session', currentUser); }
  deposit(data.amount, `Desembolso préstamo #${loan.id} — ${inv}`);
  return loan;
}

// ── DOM HELPERS ───────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmtDate  = iso => new Date(iso).toLocaleDateString('es', { day:'2-digit', month:'short', year:'numeric' });
const fmtMoney = (n, currency) => `${curSym(currency || 'USD')}${Number(n).toLocaleString('es', { minimumFractionDigits:2, maximumFractionDigits:2 })}`;

function statusBadge(status) {
  const map   = { approved:'badge-green', active:'badge-green', pending:'badge-amber', paid:'badge-blue', overdue:'badge-red' };
  const label = { approved:'Aprobado', active:'Activo', pending:'Pendiente', paid:'Pagado', overdue:'Atrasado' };
  return `<span class="badge ${map[status]||'badge-zinc'}">${label[status]||status}</span>`;
}
function tierBadge(tier) {
  if (!tier) return '';
  const map = { AAA:'badge-green', AA:'badge-green', A:'badge-blue', B:'badge-amber', C:'badge-red', D:'badge-red' };
  return `<span class="badge ${map[tier]||'badge-zinc'}">Tier ${tier}</span>`;
}

// ── PAGE VISIBILITY ───────────────────────────────────────────
function showLanding() { $('landing').classList.remove('hidden'); $('app').classList.add('hidden'); $('landing-nav').classList.remove('hidden'); }
function showApp(page) { if (!requireAuth()) return; $('landing').classList.add('hidden'); $('app').classList.remove('hidden'); $('landing-nav').classList.add('hidden'); renderSidebar(); showPage(page || 'home'); }
function showPage(page) {
  document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
  const target = $('page-' + page); if (target) { target.classList.remove('hidden'); renderPage(page); }
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page));
}
function renderPage(page) {
  const renderers = { home: renderHome, loans: renderLoans, wallet: renderWallet, pay: renderPayPage, business: () => showBizTab('portfolio'), accounting: renderAccounting, ai: renderAiPage };
  if (renderers[page]) renderers[page]();
}

// ── SIDEBAR ───────────────────────────────────────────────────
function renderSidebar() {
  const u = $('sidebar-user-info');
  if (u && currentUser) u.innerHTML = `<div class="name">${currentUser.fullName}</div><div class="email">${currentUser.email}</div>`;
}

// ── HOME ──────────────────────────────────────────────────────
function renderHome() {
  const loans  = DB.filter('loans', l => l.userId === currentUser.id);
  const wallet = getWallet() || { balance:0, currency:'USD' };
  const activeLoans = loans.filter(l => l.status === 'approved' || l.status === 'active');
  const totalDebt = activeLoans.reduce((s, l) => s + l.totalToPay, 0);
  const totalPaid = activeLoans.reduce((s, l) => s + DB.filter('payments', p => p.loanId === l.id).reduce((a, p) => a + p.amount, 0), 0);
  $('stat-balance').textContent = fmtMoney(wallet.balance, wallet.currency);
  $('stat-loans').textContent   = loans.length;
  $('stat-debt').textContent    = fmtMoney(Math.max(0, totalDebt - totalPaid), 'USD');
  $('stat-score').textContent   = currentUser.creditScore ? currentUser.creditScore : '—';
  const recent = $('recent-loans');
  if (!loans.length) { recent.innerHTML = `<div class="empty"><div class="icon">💳</div><h3>Sin préstamos</h3><p>Solicita tu primer préstamo</p><button class="btn btn-gold" onclick="showPage('apply')">Solicitar</button></div>`; return; }
  recent.innerHTML = loans.slice(-3).reverse().map(l => loanCardHTML(l)).join('');
}

// ── LOANS ─────────────────────────────────────────────────────
function renderLoans() {
  const loans = DB.filter('loans', l => l.userId === currentUser.id);
  const grid = $('loans-grid');
  if (!loans.length) { grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="icon">💳</div><h3>Sin préstamos</h3><button class="btn btn-gold btn-lg" onclick="showPage('apply')">✦ Solicitar</button></div>`; return; }
  grid.innerHTML = loans.map(l => loanCardHTML(l)).join('');
}
function loanCardHTML(l) {
  const sym = curSym(l.currency); const flag = curFlag(l.currency);
  const paid = DB.filter('payments', p => p.loanId === l.id).reduce((s, p) => s + p.amount, 0);
  const pct  = l.totalToPay > 0 ? Math.round((paid / l.totalToPay) * 100) : 0;
  return `<div class="loan-card">
    <div class="loan-card-head"><div><div class="loan-id">ID: #${l.id}</div>${statusBadge(l.status)} ${l.riskTier ? tierBadge(l.riskTier) : ''}</div><div><div class="loan-currency">${flag} ${l.currency||'USD'}</div><div class="loan-amount">${sym}${Number(l.amount).toLocaleString('es')}</div></div></div>
    <div style="margin:10px 0"><div style="height:4px;background:var(--bg3);border-radius:2px"><div style="height:4px;background:var(--gold);border-radius:2px;width:${pct}%"></div></div><div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-top:4px"><span>${pct}% pagado</span><span>${sym}${Math.max(0, l.totalToPay - paid).toFixed(2)} restante</span></div></div>
    <div class="loan-details"><div class="loan-detail-item"><div class="dt">Plazo</div><div class="dd">${l.termMonths} meses</div></div><div class="loan-detail-item"><div class="dt">Cuota</div><div class="dd gold">${sym}${l.monthlyPayment.toFixed(2)}</div></div><div class="loan-detail-item"><div class="dt">Tasa</div><div class="dd">${l.interestRate}%</div></div><div class="loan-detail-item"><div class="dt">Fecha</div><div class="dd">${fmtDate(l.createdAt)}</div></div></div>
    <div class="loan-card-actions">
      <button class="btn btn-ghost btn-sm" style="flex:1" onclick="showLoanDetail(${l.id})">Ver Detalles</button>
      ${l.status === 'approved' || l.status === 'active' ? `<button class="btn btn-gold btn-sm" onclick="openPayCardModal(${l.id})">💳 Pagar</button>` : ''}
      ${l.invoiceNumber ? `<button class="btn btn-outline btn-sm" onclick="showInvoice(${l.id})">🧾</button>` : ''}
    </div>
  </div>`;
}

// ── LOAN DETAIL ───────────────────────────────────────────────
function showLoanDetail(id) {
  const loan = DB.find('loans', l => l.id === id); if (!loan) return;
  const sym = curSym(loan.currency); const amort = buildAmortization(loan.amount, loan.interestRate, loan.termMonths);
  const container = $('page-loan-detail');
  const purposeMap = { negocio:'Inversión Negocio', vehiculo:'Vehículo', hogar:'Hogar', deudas:'Consolidar Deudas', otros:'Otros' };
  const payMap = { monthly:'Mensual', biweekly:'Quincenal', weekly:'Semanal' };
  const amortMap = { french:'Francés', german:'Alemán', american:'Americano' };
  container.innerHTML = `
    <div class="page-header"><div><button class="btn btn-ghost btn-sm" onclick="showPage('loans')">← Mis Préstamos</button><div class="page-title" style="margin-top:12px">📋 Préstamo #${loan.id}</div><div style="margin-top:6px">${statusBadge(loan.status)} ${loan.riskTier ? tierBadge(loan.riskTier) : ''}</div></div>${loan.invoiceNumber ? `<button class="btn btn-outline" onclick="showInvoice(${loan.id})">🧾 Factura</button>` : ''}</div>
    <div class="detail-meta">
      <div class="meta-item"><div class="dt">Monto</div><div class="dd gold">${sym}${Number(loan.amount).toLocaleString('es',{minimumFractionDigits:2})}</div></div>
      <div class="meta-item"><div class="dt">Cuota</div><div class="dd gold">${sym}${loan.monthlyPayment.toFixed(2)}</div></div>
      <div class="meta-item"><div class="dt">Total</div><div class="dd">${sym}${loan.totalToPay.toFixed(2)}</div></div>
      <div class="meta-item"><div class="dt">Tasa</div><div class="dd">${loan.interestRate}%</div></div>
      <div class="meta-item"><div class="dt">Plazo</div><div class="dd">${loan.termMonths} meses</div></div>
      <div class="meta-item"><div class="dt">Score</div><div class="dd gold">${loan.creditScore||'—'}</div></div>
      <div class="meta-item"><div class="dt">Tier</div><div class="dd">${loan.riskTier||'—'}</div></div>
      <div class="meta-item"><div class="dt">Propósito</div><div class="dd">${purposeMap[loan.purpose]||loan.purpose}</div></div>
    </div>
    <div class="card" style="overflow-x:auto"><h3 style="margin-bottom:16px;font-size:16px;font-weight:700">📊 Tabla de Amortización</h3>
      <table class="amort-table"><thead><tr><th>#</th><th>Fecha</th><th>Capital</th><th>Interés</th><th>Cuota</th><th>Saldo</th></tr></thead>
      <tbody>${amort.map(r => `<tr><td>${r.period}</td><td>${r.date}</td><td>${sym}${r.principal.toFixed(2)}</td><td>${sym}${r.interest.toFixed(2)}</td><td class="gold">${sym}${r.payment.toFixed(2)}</td><td>${sym}${r.balance.toFixed(2)}</td></tr>`).join('')}</tbody></table>
    </div>`;
  document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
  container.classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
}

// ── APPLY FORM ────────────────────────────────────────────────
let applyStep = 1, applyData = {}, selectedCurrency = 'USD', applyAmount = 5000, applyTerm = 12, lastScoringResult = null;

function initApplyForm() {
  const coolDays = checkCooldown();
  if (coolDays) { showAlert(`⏳ Podrás aplicar en ${coolDays} día(s).`, 'error'); showPage('loans'); return; }
  applyStep = 1; applyData = {}; selectedCurrency = 'USD'; applyAmount = 5000; applyTerm = 12; lastScoringResult = null;
  const phaseList = $('verify-phases-list'); if (phaseList) phaseList.innerHTML = '';
  const resEl = $('verify-result'); if (resEl) resEl.classList.add('hidden');
  const spinWrap = $('verify-spinner-wrap'); if (spinWrap) spinWrap.innerHTML = '<div class="spin-ring"></div>';
  if ($('verify-title')) $('verify-title').textContent = 'Analizando Solicitud...';
  if ($('verify-subtitle')) $('verify-subtitle').textContent = 'No cierres esta ventana';
  const trackEl = $('verify-tracking'); if (trackEl) trackEl.classList.add('hidden');
  updateStepUI(); renderCurrencyPicker(); updateAmountDisplay();
  const amtSlider = $('amt-slider'); if (amtSlider) amtSlider.addEventListener('input', e => { applyAmount = +e.target.value; updateAmountDisplay(); });
  const termSlider = $('term-slider'); if (termSlider) termSlider.addEventListener('input', e => { applyTerm = +e.target.value; $('term-val').textContent = e.target.value; });
  const cedulaField = $('f-cedula'); if (cedulaField && currentUser?.cedula) cedulaField.value = currentUser.cedula.replace(/\D/g,'').slice(0,11);
}
function updateAmountDisplay() {
  const sym = curSym(selectedCurrency);
  const elAmt = $('amount-big'); if (elAmt) elAmt.innerHTML = `<span class="amount-sym">${sym}</span>${Number(applyAmount).toLocaleString('es')}`;
  const mn = $('range-min'), mx = $('range-max');
  if (mn) mn.textContent = sym + '100'; if (mx) mx.textContent = sym + '50,000';
}
function renderCurrencyPicker() {
  const grid = $('currency-grid'); if (!grid) return;
  grid.innerHTML = CURRENCIES.map(c => `<button class="currency-btn ${c.code===selectedCurrency?'selected':''}" onclick="selectCurrency('${c.code}')"><span class="cflag">${c.flag}</span><span class="ccode">${c.code}</span></button>`).join('');
}
window.selectCurrency = code => {
  selectedCurrency = code; renderCurrencyPicker(); updateAmountDisplay();
  const lbl = $('currency-label'); if (lbl) { const c = CURRENCIES.find(x=>x.code===code); lbl.textContent = c ? `${c.flag} ${c.name} — ${c.sym}` : ''; }
};
function updateStepUI() {
  for (let i = 1; i <= 4; i++) {
    const dot = $('sdot-' + i); const line = $('sline-' + i);
    if (dot)  dot.className  = `step-dot ${i < applyStep ? 'done' : i === applyStep ? 'current' : 'pending'}`;
    if (line) line.className = `step-line ${i < applyStep ? 'done' : 'pending'}`;
    const panel = $('spanel-' + i); if (panel) panel.className = `step-panel ${i === applyStep ? 'active' : ''}`;
  }
  const backBtn=$('btn-back'), nextBtn=$('btn-next'), submitBtn=$('btn-submit');
  if (backBtn)   backBtn.style.display   = applyStep > 1 && applyStep < 4 ? '' : 'none';
  if (nextBtn)   nextBtn.style.display   = applyStep < 4 ? '' : 'none';
  if (nextBtn)   nextBtn.textContent     = applyStep < 3 ? 'Continuar →' : '⚡ Evaluar Perfil';
  if (submitBtn) submitBtn.style.display = 'none';
}
function validateStep1() {
  const birthDate = $('f-birthDate')?.value;
  const address = ($('f-address')?.value || '').trim();
  const cedula = ($('f-cedula')?.value || '').replace(/\D/g,'');
  if (!birthDate) return 'La fecha de nacimiento es requerida.';
  const age = calculateAge(birthDate);
  if (isNaN(age) || age < 18) return 'Debes tener al menos 18 años.';
  if (age > 70) return 'Edad máxima: 70 años.';
  if (!cedula) return 'La cédula es requerida.';
  if (cedula.length !== 11) return 'La cédula debe tener exactamente 11 dígitos.';
  if (address.length < 5) return 'La dirección completa es requerida.';
  return null;
}
function validateStep2() {
  const income = +($('f-income')?.value||0), debt = +($('f-debt')?.value||0);
  const employer = ($('f-employer')?.value||'').trim(), empYears = $('f-empyears')?.value;
  const ref1name = ($('f-ref1name')?.value||'').trim(), ref1phone = ($('f-ref1phone')?.value||'').replace(/\D/g,'');
  const ref2name = ($('f-ref2name')?.value||'').trim(), ref2phone = ($('f-ref2phone')?.value||'').replace(/\D/g,'');
  if (!income || income <= 0) return 'El ingreso mensual es requerido.';
  if (income < 200) return 'Ingreso mínimo: $200.';
  if (debt < 0) return 'La deuda no puede ser negativa.';
  if (debt >= income) return 'La deuda no puede ser igual o mayor al ingreso.';
  if (employer.length < 2) return 'El nombre del empleador es requerido.';
  if (empYears === '' || empYears === null) return 'Los años de empleo son requeridos.';
  if (+empYears < 0) return 'Los años de empleo no pueden ser negativos.';
  if (ref1name.length < 3) return 'Nombre de Referencia 1 requerido.';
  if (ref1phone.length !== 11) return 'Teléfono Referencia 1: exactamente 11 dígitos.';
  if (ref2name.length < 3) return 'Nombre de Referencia 2 requerido.';
  if (ref2phone.length !== 11) return 'Teléfono Referencia 2: exactamente 11 dígitos.';
  return null;
}
function validateStep3() {
  if (!applyAmount || applyAmount < 100) return 'El monto debe ser al menos $100.';
  if (!applyTerm || applyTerm < 1) return 'El plazo mínimo es 1 mes.';
  return null;
}
function showStepError(msg) {
  let errEl = $('step-error-msg');
  if (!errEl) { errEl = document.createElement('div'); errEl.id = 'step-error-msg'; errEl.className = 'step-error-banner'; const card = document.querySelector('#page-apply .card'); if (card) card.insertBefore(errEl, card.firstChild); }
  errEl.textContent = '⚠ ' + msg; errEl.style.display = 'block';
  errEl.scrollIntoView({ behavior:'smooth', block:'nearest' });
  setTimeout(() => { if (errEl) errEl.style.display = 'none'; }, 5000);
}
function collectStep3() {
  applyData.amount = applyAmount; applyData.termMonths = applyTerm;
  applyData.paymentType = $('sel-payment')?.value || 'monthly';
  applyData.amortizationType = $('sel-amort')?.value || 'french';
  applyData.purpose = $('sel-purpose')?.value || 'otros';
  applyData.currency = selectedCurrency;
}
window.applyNext = async () => {
  if (applyStep === 1) { const err = validateStep1(); if (err) { showStepError(err); return; } }
  if (applyStep === 2) { const err = validateStep2(); if (err) { showStepError(err); return; } }
  if (applyStep === 3) { const err = validateStep3(); if (err) { showStepError(err); return; } }
  if (applyStep < 3) { applyStep++; updateStepUI(); return; }
  if (applyStep === 3) {
    collectStep3();
    const params = { monthlyIncome: +($('f-income')?.value||0), debtLevel: +($('f-debt')?.value||0), employmentYears: +($('f-empyears')?.value||0), amount: applyAmount, termMonths: applyTerm, age: calculateAge($('f-birthDate')?.value), purpose: $('sel-purpose')?.value||'otros', dependents: +($('f-dependents')?.value||0), occupationType: $('f-occupation')?.value||'empleado' };
    const scoringResult = advancedCreditScore(params); lastScoringResult = scoringResult;
    const phases = buildVerificationPhases(params, scoringResult);
    applyStep = 4; updateStepUI();
    const trackCode = 'EXP-' + Date.now().toString(36).toUpperCase().slice(-8);
    const trackEl = $('verify-tracking'); const codeEl = $('verify-code');
    if (codeEl) codeEl.textContent = trackCode; if (trackEl) trackEl.classList.remove('hidden');
    await animatePhases(phases); await sleep(600); showVerificationResult(scoringResult);
  }
};
window.applyBack = () => { if (applyStep > 1 && applyStep < 4) { applyStep--; updateStepUI(); } };
window.submitLoan = () => {
  if (!lastScoringResult || !lastScoringResult.approved) { showAlert('Solicitud no aprobada.', 'error'); return; }
  const d = { ...applyData, birthDate: $('f-birthDate')?.value||'', maritalStatus: $('f-marital')?.value||'single', address: $('f-address')?.value||'', dependents: +($('f-dependents')?.value||0), monthlyIncome: +($('f-income')?.value||0), debtLevel: +($('f-debt')?.value||0), employer: $('f-employer')?.value||'', employmentYears: +($('f-empyears')?.value||0), occupationType: $('f-occupation')?.value||'empleado', reference1Name: $('f-ref1name')?.value||'', reference1Phone: $('f-ref1phone')?.value||'', reference2Name: $('f-ref2name')?.value||'', reference2Phone: $('f-ref2phone')?.value||'', creditScore: lastScoringResult.score, riskTier: lastScoringResult.riskTier, interestRate: lastScoringResult.interestRate };
  const loan = createLoan(d);
  showAlert('🎉 ¡Préstamo aprobado! Fondos en tu billetera.', 'success');
  setTimeout(() => { showLoanDetail(loan.id); }, 900);
};

// ── WALLET PAGE ───────────────────────────────────────────────
function renderWallet() {
  const wallet = getWallet() || { balance:0, currency:'USD' };
  const txs = DB.filter('transactions', t => t.walletId === wallet.id).sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt));
  $('wallet-balance').textContent  = fmtMoney(wallet.balance, wallet.currency);
  $('wallet-currency').textContent = `${curFlag(wallet.currency)} ${wallet.currency}`;
  const list = $('tx-list');
  if (!txs.length) { list.innerHTML = `<div class="empty"><div class="icon">💸</div><h3>Sin movimientos</h3><p>Realiza tu primer depósito con tarjeta</p></div>`; return; }
  const isIn = t => ['deposit','transfer_in','loan_disbursement'].includes(t.type);
  const typeIcon = { deposit:'⬇️', withdrawal:'⬆️', transfer_in:'⬇️', transfer_out:'⬆️', loan_disbursement:'🏦' };
  list.innerHTML = txs.map(t => `<div class="tx-item"><div class="tx-icon ${isIn(t)?'in':'out'}">${typeIcon[t.type]||'💰'}</div><div class="tx-info"><div class="tx-desc">${t.description}</div><div class="tx-date">${fmtDate(t.createdAt)}${t.reference?' · '+t.reference:''}</div></div><div class="tx-amount ${isIn(t)?'in':'out'}">${isIn(t)?'+':'-'}${fmtMoney(t.amount, wallet.currency)}</div></div>`).join('');
}

// ══════════════════════════════════════════════════════════════
// ── BUSINESS MODULE ───────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
const BIZ_CLIENTS = [
  { id:1, name:'María González',   loan:25000, paid:18000, status:'al_dia',   collector:'Pedro R.',   nextDate:'2025-08-15', daysOverdue:0 },
  { id:2, name:'Carlos Rodríguez', loan:12000, paid:6000,  status:'al_dia',   collector:'Ana M.',     nextDate:'2025-08-20', daysOverdue:0 },
  { id:3, name:'Rosa Martínez',    loan:8000,  paid:3200,  status:'moroso',   collector:'Pedro R.',   nextDate:'2025-07-30', daysOverdue:16 },
  { id:4, name:'Luis Fernández',   loan:50000, paid:35000, status:'al_dia',   collector:'Ana M.',     nextDate:'2025-08-25', daysOverdue:0 },
  { id:5, name:'Ana Torres',       loan:5000,  paid:0,     status:'critico',  collector:'Pedro R.',   nextDate:'2025-07-20', daysOverdue:30 },
  { id:6, name:'José Ramírez',     loan:15000, paid:12000, status:'al_dia',   collector:'Juan P.',    nextDate:'2025-08-10', daysOverdue:0 },
  { id:7, name:'Carmen López',     loan:9000,  paid:2000,  status:'moroso',   collector:'Juan P.',    nextDate:'2025-07-28', daysOverdue:18 },
  { id:8, name:'Miguel Díaz',      loan:30000, paid:30000, status:'pagado',   collector:'Ana M.',     nextDate:'—',          daysOverdue:0 },
];
const BIZ_COLLECTORS = [
  { id:1, name:'Pedro R.',  zone:'Norte',    assigned:3, collected:18500, efficiency:88 },
  { id:2, name:'Ana M.',    zone:'Sur',      assigned:3, collected:22000, efficiency:94 },
  { id:3, name:'Juan P.',   zone:'Este',     assigned:2, collected:9500,  efficiency:76 },
];
const BIZ_MICROCREDITS = [
  { id:1, client:'Tienda La Esperanza', amount:2000,  purpose:'Inventario', rate:28, term:6,  status:'activo' },
  { id:2, client:'Taller Mecánico JR',  amount:3500,  purpose:'Equipos',    rate:26, term:12, status:'activo' },
  { id:3, client:'Panadería El Sol',    amount:1500,  purpose:'Capital',    rate:30, term:3,  status:'pagado' },
  { id:4, client:'Colmado Doña Rosa',   amount:2500,  purpose:'Inventario', rate:28, term:9,  status:'activo' },
];
window.showBizTab = (tab) => {
  document.querySelectorAll('.biz-tab').forEach((t, i) => {
    const tabs = ['portfolio','collectors','routes','micro','delinquency'];
    t.classList.toggle('active', tabs[i] === tab);
  });
  const cont = $('biz-content');
  if (tab === 'portfolio') {
    const total = BIZ_CLIENTS.reduce((s,c) => s+c.loan, 0);
    const recovered = BIZ_CLIENTS.reduce((s,c) => s+c.paid, 0);
    cont.innerHTML = `
      <div class="biz-stats"><div class="biz-stat"><div class="bs-val">$${total.toLocaleString()}</div><div class="bs-lbl">Cartera Total</div></div><div class="biz-stat"><div class="bs-val">$${recovered.toLocaleString()}</div><div class="bs-lbl">Recuperado</div></div><div class="biz-stat"><div class="bs-val">${BIZ_CLIENTS.filter(c=>c.status==='moroso'||c.status==='critico').length}</div><div class="bs-lbl">En Mora</div></div><div class="biz-stat"><div class="bs-val">${Math.round(recovered/total*100)}%</div><div class="bs-lbl">Tasa Cobro</div></div></div>
      <div class="card"><table class="biz-table"><thead><tr><th>Cliente</th><th>Préstamo</th><th>Pagado</th><th>Cobrador</th><th>Estado</th></tr></thead><tbody>
        ${BIZ_CLIENTS.map(c => {
          const statusMap = { al_dia:'<span class="badge badge-green">Al día</span>', moroso:'<span class="badge badge-amber">Moroso</span>', critico:'<span class="badge badge-red">Crítico</span>', pagado:'<span class="badge badge-blue">Pagado</span>' };
          return `<tr><td><strong>${c.name}</strong></td><td>$${c.loan.toLocaleString()}</td><td><div style="min-width:100px"><div style="height:4px;background:var(--bg3);border-radius:2px;margin-bottom:2px"><div style="height:4px;background:var(--gold);border-radius:2px;width:${Math.round(c.paid/c.loan*100)}%"></div></div>$${c.paid.toLocaleString()}</div></td><td>${c.collector}</td><td>${statusMap[c.status]||c.status}</td></tr>`;
        }).join('')}
      </tbody></table></div>`;
  } else if (tab === 'collectors') {
    cont.innerHTML = `<div class="biz-stats">${BIZ_COLLECTORS.map(c => `<div class="collector-card"><div class="cc-avatar">${c.name[0]}</div><div class="cc-info"><div class="cc-name">${c.name}</div><div class="cc-zone">📍 Zona ${c.zone}</div></div><div class="cc-stats"><div><strong>${c.assigned}</strong><span>Clientes</span></div><div><strong>$${c.collected.toLocaleString()}</strong><span>Cobrado</span></div><div><strong>${c.efficiency}%</strong><span>Eficiencia</span></div></div><div style="margin-top:12px"><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3);margin-bottom:4px"><span>Eficiencia</span><span>${c.efficiency}%</span></div><div style="height:6px;background:var(--bg3);border-radius:3px"><div style="height:6px;background:${c.efficiency>90?'#34d399':c.efficiency>75?'#f59e0b':'#f87171'};border-radius:3px;width:${c.efficiency}%"></div></div></div></div>`).join('')}</div>`;
  } else if (tab === 'routes') {
    cont.innerHTML = `<div class="routes-grid">${BIZ_COLLECTORS.map(c => {
      const clients = BIZ_CLIENTS.filter(cl => cl.collector === c.name);
      return `<div class="card"><div style="display:flex;align-items:center;gap:10px;margin-bottom:16px"><div class="cc-avatar" style="width:36px;height:36px;font-size:14px">${c.name[0]}</div><div><strong>${c.name}</strong><div style="font-size:12px;color:var(--text3)">Zona ${c.zone}</div></div></div>${clients.map(cl => `<div class="route-stop"><div class="rs-dot ${cl.status==='moroso'||cl.status==='critico'?'urgent':'normal'}"></div><div class="rs-info"><div class="rs-name">${cl.name}</div><div class="rs-meta">$${cl.loan.toLocaleString()} · ${cl.daysOverdue>0?`<span style="color:#f87171">${cl.daysOverdue} días mora</span>`:'Al día'}</div></div></div>`).join('')}</div>`;
    }).join('')}</div>`;
  } else if (tab === 'micro') {
    cont.innerHTML = `<div class="biz-stats"><div class="biz-stat"><div class="bs-val">${BIZ_MICROCREDITS.filter(m=>m.status==='activo').length}</div><div class="bs-lbl">Activos</div></div><div class="biz-stat"><div class="bs-val">$${BIZ_MICROCREDITS.filter(m=>m.status==='activo').reduce((s,m)=>s+m.amount,0).toLocaleString()}</div><div class="bs-lbl">Cartera Micro</div></div></div>
      <div class="card"><table class="biz-table"><thead><tr><th>Negocio</th><th>Monto</th><th>Propósito</th><th>Tasa</th><th>Plazo</th><th>Estado</th></tr></thead><tbody>
        ${BIZ_MICROCREDITS.map(m => `<tr><td><strong>${m.client}</strong></td><td>$${m.amount.toLocaleString()}</td><td>${m.purpose}</td><td>${m.rate}%</td><td>${m.term} meses</td><td>${m.status==='activo'?'<span class="badge badge-green">Activo</span>':'<span class="badge badge-blue">Pagado</span>'}</td></tr>`).join('')}
      </tbody></table></div>`;
  } else if (tab === 'delinquency') {
    const morosos = BIZ_CLIENTS.filter(c => c.status === 'moroso' || c.status === 'critico');
    cont.innerHTML = `<div class="biz-stats"><div class="biz-stat" style="border-color:rgba(248,113,113,0.3)"><div class="bs-val" style="color:#f87171">${morosos.length}</div><div class="bs-lbl">En Mora</div></div><div class="biz-stat" style="border-color:rgba(248,113,113,0.3)"><div class="bs-val" style="color:#f87171">$${morosos.reduce((s,c)=>s+(c.loan-c.paid),0).toLocaleString()}</div><div class="bs-lbl">Deuda Vencida</div></div><div class="biz-stat"><div class="bs-val">${Math.round(morosos.length/BIZ_CLIENTS.length*100)}%</div><div class="bs-lbl">Índice Mora</div></div></div>
      <div class="card">${morosos.map(c => `<div class="delinquency-row"><div class="dlq-left"><div class="dlq-name">${c.name}</div><div class="dlq-meta">Cobrador: ${c.collector} · Vencido: ${c.daysOverdue} días</div></div><div class="dlq-right"><div class="dlq-amount">$${(c.loan-c.paid).toLocaleString()}</div>${c.status==='critico'?'<span class="badge badge-red">Crítico</span>':'<span class="badge badge-amber">Moroso</span>'}</div></div>`).join('')}</div>`;
  }
};

// ══════════════════════════════════════════════════════════════
// ── ACCOUNTING MODULE ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
function renderAccounting() {
  const loans    = DB.filter('loans', l => l.userId === currentUser.id);
  const payments = DB.filter('payments', p => p.userId === currentUser.id);
  const totalLoaned    = loans.reduce((s, l) => s + l.amount, 0);
  const totalInterest  = loans.reduce((s, l) => s + (l.totalToPay - l.amount), 0);
  const totalCollected = payments.reduce((s, p) => s + p.amount, 0);
  const totalPending   = loans.filter(l=>l.status==='approved'||l.status==='active').reduce((s,l) => {
    const paid = DB.filter('payments', p => p.loanId === l.id).reduce((a,p) => a+p.amount, 0);
    return s + Math.max(0, l.totalToPay - paid);
  }, 0);
  const months = {};
  payments.forEach(p => {
    const key = new Date(p.paidAt).toLocaleDateString('es', { month:'short', year:'numeric' });
    months[key] = (months[key] || 0) + p.amount;
  });
  const cont = $('accounting-content');
  cont.innerHTML = `
    <div class="acc-stats">
      <div class="acc-stat green"><div class="as-icon">💵</div><div class="as-body"><div class="as-val">$${totalLoaned.toLocaleString('es',{minimumFractionDigits:2})}</div><div class="as-lbl">Capital Prestado</div></div></div>
      <div class="acc-stat blue"><div class="as-icon">📈</div><div class="as-body"><div class="as-val">$${totalInterest.toLocaleString('es',{minimumFractionDigits:2})}</div><div class="as-lbl">Intereses Proyectados</div></div></div>
      <div class="acc-stat gold"><div class="as-icon">✅</div><div class="as-body"><div class="as-val">$${totalCollected.toLocaleString('es',{minimumFractionDigits:2})}</div><div class="as-lbl">Total Cobrado</div></div></div>
      <div class="acc-stat red"><div class="as-icon">⏳</div><div class="as-body"><div class="as-val">$${totalPending.toLocaleString('es',{minimumFractionDigits:2})}</div><div class="as-lbl">Saldo Pendiente</div></div></div>
    </div>
    <div class="acc-grid">
      <div class="card">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:16px">📊 Balance Financiero</h3>
        <div class="acc-balance-rows">
          <div class="acc-balance-row"><span>Capital desembolsado</span><span class="gold">-$${totalLoaned.toFixed(2)}</span></div>
          <div class="acc-balance-row"><span>Pagos recibidos</span><span style="color:#34d399">+$${totalCollected.toFixed(2)}</span></div>
          <div class="acc-balance-row"><span>Intereses proyectados</span><span style="color:#60a5fa">+$${totalInterest.toFixed(2)}</span></div>
          <div class="acc-balance-row total"><span>Balance Neto</span><span class="gold">$${(totalCollected - totalLoaned + totalInterest).toFixed(2)}</span></div>
        </div>
      </div>
      <div class="card">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:16px">📅 Ingresos por Mes</h3>
        ${Object.keys(months).length ? Object.entries(months).reverse().map(([m, v]) => `<div class="acc-month-row"><span>${m}</span><div class="amr-bar-wrap"><div class="amr-bar" style="width:${Math.round(v/Math.max(...Object.values(months))*100)}%"></div></div><span class="gold">$${v.toFixed(2)}</span></div>`).join('') : '<p style="color:var(--text3);font-size:13px">Sin pagos registrados aún.</p>'}
      </div>
    </div>
    <div class="card" style="margin-top:20px">
      <h3 style="font-size:15px;font-weight:700;margin-bottom:16px">📋 Estado de Resultados</h3>
      <table class="biz-table">
        <thead><tr><th>Concepto</th><th>Monto</th><th>%</th></tr></thead>
        <tbody>
          <tr><td>Ingresos por Capital Prestado</td><td class="gold">$${totalLoaned.toFixed(2)}</td><td>—</td></tr>
          <tr><td>Ingresos por Intereses</td><td class="gold">$${totalInterest.toFixed(2)}</td><td>${totalLoaned > 0 ? ((totalInterest/totalLoaned)*100).toFixed(1) : 0}%</td></tr>
          <tr><td>Total Ingresos</td><td class="gold">$${(totalLoaned + totalInterest).toFixed(2)}</td><td>100%</td></tr>
          <tr><td>Pagos Cobrados</td><td style="color:#34d399">$${totalCollected.toFixed(2)}</td><td>${(totalLoaned + totalInterest) > 0 ? ((totalCollected/(totalLoaned+totalInterest))*100).toFixed(1) : 0}%</td></tr>
          <tr style="font-weight:700"><td>Saldo Pendiente por Cobrar</td><td style="color:#f87171">$${totalPending.toFixed(2)}</td><td>—</td></tr>
        </tbody>
      </table>
    </div>`;
}
window.exportAccounting = () => {
  const loans = DB.filter('loans', l => l.userId === currentUser.id);
  const payments = DB.filter('payments', p => p.userId === currentUser.id);
  let csv = 'Tipo,Referencia,Monto,Fecha,Descripcion\n';
  loans.forEach(l => { csv += `Préstamo,${l.invoiceNumber},${l.amount},${l.createdAt},"Desembolso préstamo #${l.id}"\n`; csv += `Interés,${l.invoiceNumber},${(l.totalToPay-l.amount).toFixed(2)},${l.createdAt},"Intereses préstamo #${l.id} (${l.interestRate}%)"\n`; });
  payments.forEach(p => { csv += `Pago,${p.ref},${p.amount},${p.paidAt},"Pago cuota préstamo #${p.loanId} — tarjeta ****${p.cardLast4}"\n`; });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
  link.download = `FJAP_Contabilidad_${new Date().toISOString().slice(0,10)}.csv`;
  link.click(); showAlert('📥 Archivo CSV exportado', 'success');
};

// ══════════════════════════════════════════════════════════════
// ── AI ASSISTANT ──────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
function renderAiPage() {
  const riskPanel = $('ai-risk-panel'); if (!riskPanel) return;
  const loans = DB.filter('loans', l => l.userId === currentUser.id && (l.status==='approved'||l.status==='active'));
  const score = currentUser.creditScore;
  const wallet = getWallet() || { balance:0, currency:'USD' };
  const totalDebt = loans.reduce((s,l)=>{ const paid=DB.filter('payments',p=>p.loanId===l.id).reduce((a,p)=>a+p.amount,0); return s+Math.max(0,l.totalToPay-paid); }, 0);
  const riskLevel = !score ? 'Sin datos' : score >= 750 ? 'Bajo' : score >= 600 ? 'Moderado' : 'Alto';
  const riskColor = !score ? 'var(--text3)' : score >= 750 ? '#34d399' : score >= 600 ? '#f59e0b' : '#f87171';
  riskPanel.innerHTML = `
    <div class="risk-item"><span>Score FJAP</span><strong style="color:${riskColor}">${score||'—'}</strong></div>
    <div class="risk-item"><span>Nivel de Riesgo</span><strong style="color:${riskColor}">${riskLevel}</strong></div>
    <div class="risk-item"><span>Balance</span><strong class="gold">${fmtMoney(wallet.balance,'USD')}</strong></div>
    <div class="risk-item"><span>Deuda Activa</span><strong style="color:#f87171">${fmtMoney(totalDebt,'USD')}</strong></div>
    <div class="risk-item"><span>Préstamos</span><strong>${loans.length} activo(s)</strong></div>`;
}
async function sendAiMessage() {
  const input = $('ai-input'); if (!input) return;
  const msg = input.value.trim(); if (!msg) return;
  input.value = '';
  addAiMessage(msg, 'user');
  const thinking = addAiMessage('⏳ Analizando...', 'bot', true);
  const loans  = DB.filter('loans', l => l.userId === currentUser.id);
  const wallet = getWallet() || { balance:0, currency:'USD' };
  const payments = DB.filter('payments', p => p.userId === currentUser.id);
  const totalPaid = payments.reduce((s,p)=>s+p.amount, 0);
  const context = `Eres el Asistente Financiero FJAP. Responde SIEMPRE en español. Sé conciso, útil y profesional. Datos del cliente: Nombre: ${currentUser.fullName}, Score FJAP: ${currentUser.creditScore||'no evaluado'}, Balance billetera: $${wallet.balance.toFixed(2)} USD, Préstamos activos: ${loans.filter(l=>l.status==='approved'||l.status==='active').length}, Total prestado: $${loans.reduce((s,l)=>s+l.amount,0).toFixed(2)}, Total pagado: $${totalPaid.toFixed(2)}, Tasas disponibles: AAA 11.5%, AA 13.5%, A 16%, B 21%, C 26%. Sistema FJAP ofrece: préstamos personales, billetera virtual, pagos con tarjeta, módulo empresarial, contabilidad integrada.`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ model:'claude-sonnet-4-20250514', max_tokens:600,
        system: context,
        messages:[{ role:'user', content: msg }]
      })
    });
    const data = await res.json();
    const reply = data.content?.[0]?.text || 'Lo siento, no pude procesar tu consulta.';
    thinking.remove();
    addAiMessage(reply, 'bot');
  } catch {
    thinking.remove();
    addAiMessage('No se pudo conectar con el asistente. Verifica tu conexión.', 'bot');
  }
}
function addAiMessage(text, role, isTemp=false) {
  const messages = $('ai-messages'); if (!messages) return null;
  const div = document.createElement('div'); div.className = `ai-msg ai-msg-${role}`;
  div.innerHTML = role==='bot' ? `<div class="ai-avatar">🤖</div><div class="ai-bubble">${text.replace(/\n/g,'<br>')}</div>` : `<div class="ai-bubble ai-bubble-user">${text}</div>`;
  messages.appendChild(div); div.scrollIntoView({ behavior:'smooth', block:'end' });
  return isTemp ? div : null;
}
window.quickAsk = (question) => { const input = $('ai-input'); if (input) { input.value = question; sendAiMessage(); } };
window.sendAiMessage = sendAiMessage;

// ── INVOICE ───────────────────────────────────────────────────
window.showInvoice = (id) => {
  const loan = DB.find('loans', l => l.id === id); if (!loan) return;
  const sym  = curSym(loan.currency); const flag = curFlag(loan.currency);
  const purposeMap = { negocio:'Inversión en Negocio', vehiculo:'Vehículo', hogar:'Hogar', deudas:'Consolidar Deudas', otros:'Otros' };
  const payMap  = { monthly:'Mensual', biweekly:'Quincenal', weekly:'Semanal' };
  const amortMap = { french:'Francés', german:'Alemán', american:'Americano' };
  const user = currentUser;
  const now  = new Date().toLocaleDateString('es', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  $('invoice-body').innerHTML = `<div class="inv-header"><div><div class="inv-brand">FJAP <span>Préstamos</span></div><p style="color:#888;font-size:12px;margin-top:4px">Plataforma Fintech · contacto@fjap.com</p></div><div class="inv-num" style="text-align:right"><p style="font-size:11px;color:#888">Factura N°</p><h2>${loan.invoiceNumber}</h2><span style="display:inline-block;background:#d1fae5;color:#065f46;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;margin-top:4px">✓ Aprobado</span><div style="margin-top:4px;font-size:11px;font-weight:700;color:#92400e">${loan.riskTier?'Tier '+loan.riskTier:''}</div><div style="margin-top:6px;font-size:13px;font-weight:700">${flag} ${loan.currency}</div></div></div>
  <div class="inv-cols"><div class="inv-section"><h4>Cliente</h4><p class="val">${user.fullName}</p><p>${user.email}</p><p>Cédula: ${user.cedula}</p><p>Tel: ${user.phone}</p></div><div class="inv-section"><h4>Documento</h4><p>Emisión: <span class="val">${fmtDate(loan.createdAt)}</span></p>${loan.approvedAt?`<p>Aprobación: <span class="val">${fmtDate(loan.approvedAt)}</span></p>`:''}<p>ID: <span class="val">#${loan.id}</span></p><p>Score IA: <span class="val" style="color:#059669">${loan.creditScore||'—'} pts</span></p></div></div>
  <table class="inv-table"><thead><tr><th>Concepto</th><th style="text-align:right">Valor</th></tr></thead><tbody>
    <tr><td>Capital Prestado</td><td style="text-align:right;font-weight:700">${sym}${Number(loan.amount).toLocaleString('es',{minimumFractionDigits:2})}</td></tr>
    <tr><td>Tasa Anual</td><td style="text-align:right">${loan.interestRate}%</td></tr>
    <tr><td>Plazo</td><td style="text-align:right">${loan.termMonths} meses</td></tr>
    <tr><td>Amortización</td><td style="text-align:right">${amortMap[loan.amortizationType]||loan.amortizationType}</td></tr>
    <tr><td>Frecuencia</td><td style="text-align:right">${payMap[loan.paymentType]||loan.paymentType}</td></tr>
    <tr><td>Cuota</td><td style="text-align:right;font-weight:700;color:#d97706">${sym}${loan.monthlyPayment.toFixed(2)}</td></tr>
    <tr class="total"><td>TOTAL A PAGAR</td><td style="text-align:right">${sym}${loan.totalToPay.toFixed(2)}</td></tr>
  </tbody></table>
  <div class="inv-sigs"><div class="inv-sig"><div class="inv-sig-line"></div><p>Firma del Cliente</p><p style="font-weight:700;color:#333;font-size:12px;margin-top:2px">${user.fullName}</p></div><div class="inv-sig"><div class="inv-sig-line"></div><p>Firma Autorizada</p><p style="font-weight:700;color:#333;font-size:12px;margin-top:2px">FJAP Préstamos</p></div></div>
  <div class="inv-footer">Documento válido como comprobante de préstamo aprobado por FJAP Préstamos.<br>Generado el ${now} · ${loan.invoiceNumber}</div>`;
  $('invoice-overlay').classList.remove('hidden');
};
window.closeInvoice = () => $('invoice-overlay').classList.add('hidden');
window.printInvoice = () => {
  const body = $('invoice-body').innerHTML;
  const win = window.open('','_blank');
  win.document.write(`<html><head><title>Factura FJAP</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;color:#111;background:#fff;padding:40px}.inv-header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:24px;border-bottom:2px solid #f59e0b;margin-bottom:24px}.inv-brand{font-size:22px;font-weight:900}.inv-brand span{color:#f59e0b}.inv-cols{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px}.inv-section h4{font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}.inv-section p{font-size:13px;color:#333;margin-bottom:2px}.inv-section .val{font-weight:700;color:#111}.inv-table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px}.inv-table th{background:#f9fafb;padding:10px 12px;text-align:left;font-size:11px;color:#888;font-weight:600}.inv-table td{padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#333}.inv-table tr.total td{font-weight:700;font-size:14px;background:#fffbeb;color:#92400e}.inv-sigs{display:flex;justify-content:space-between;margin-top:32px;padding-top:20px;border-top:1px solid #e5e7eb}.inv-sig{text-align:center}.inv-sig-line{width:160px;border-top:1px solid #ccc;margin-bottom:6px}.inv-sig p{font-size:11px;color:#888}.inv-footer{margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-size:11px;color:#aaa}</style></head><body>${body}</body></html>`);
  win.document.close(); win.focus(); win.print(); win.close();
};

// ── AUTH MODAL ────────────────────────────────────────────────
window.openAuth = (tab) => { $('auth-overlay').classList.remove('hidden'); switchAuthTab(tab || 'login'); };
window.closeAuth = (e) => { if (!e || e.target === $('auth-overlay')) $('auth-overlay').classList.add('hidden'); };
window.switchAuthTab = (tab) => {
  $('tab-login').classList.toggle('active', tab==='login'); $('tab-register').classList.toggle('active', tab==='register');
  $('form-login').classList.toggle('hidden', tab!=='login'); $('form-register').classList.toggle('hidden', tab!=='register');
  $('auth-err').textContent = '';
};
window.doLogin = () => {
  const email=$('l-email').value.trim(), password=$('l-pass').value;
  if (!email||!password) { $('auth-err').textContent='Completa todos los campos.'; return; }
  const r = login({ email, password }); if (r.error) { $('auth-err').textContent=r.error; return; }
  $('auth-overlay').classList.add('hidden'); showApp('home');
};
window.doRegister = () => {
  const fullName=$('r-name').value.trim(), email=$('r-email').value.trim(), password=$('r-pass').value;
  const phone=$('r-phone').value.replace(/\D/g,''), cedula=$('r-cedula').value.replace(/\D/g,'');
  if (!fullName||!email||!password||!phone||!cedula) { $('auth-err').textContent='Completa todos los campos.'; return; }
  if (password.length<6) { $('auth-err').textContent='Contraseña mínimo 6 caracteres.'; return; }
  if (phone.length!==11) { $('auth-err').textContent='Teléfono: exactamente 11 dígitos.'; return; }
  if (cedula.length!==11) { $('auth-err').textContent='Cédula: exactamente 11 dígitos.'; return; }
  const r = register({ email, password, fullName, phone, cedula }); if (r.error) { $('auth-err').textContent=r.error; return; }
  $('auth-overlay').classList.add('hidden'); showApp('home');
};

// ── ALERTS ────────────────────────────────────────────────────
function showAlert(msg, type) {
  const a = $('global-alert'); a.textContent = msg;
  a.className = `alert alert-${type==='success'?'success':'error'}`;
  a.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:600;animation:fadein .3s;max-width:380px';
  a.classList.remove('hidden'); setTimeout(() => a.classList.add('hidden'), 4000);
}

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (currentUser) { showApp('home'); } else { showLanding(); }
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      if (page === 'logout') { logout(); return; }
      showPage(page);
      if (page === 'apply') initApplyForm();
    });
  });
  $('btn-apply-nav')?.addEventListener('click', () => { showPage('apply'); initApplyForm(); });
});
window.showLoanDetail = showLoanDetail; window.showPage = showPage; window.logout = logout; window.showApp = showApp;
