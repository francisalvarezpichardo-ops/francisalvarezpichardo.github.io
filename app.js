// app.js - Versión modificada con todos los cambios

// ── STORAGE (igual) ──────────────────────────────────────────
const DB = { ... }; // (se mantiene igual, omitido por brevedad)

// ── CURRENCIES (igual) ───────────────────────────────────────
const CURRENCIES = [ ... ]; // (igual)

// ── FUNCIONES AUXILIARES (igual) ─────────────────────────────
const curSym = ...; const curFlag = ...; // (igual)

// ── MATH (igual) ─────────────────────────────────────────────
function calcMonthly(...) {...}
function buildAmortization(...) {...}

// ══════════════════════════════════════════════════════════════
// ── NUEVAS VARIABLES GLOBALES PARA VERIFICACIÓN FACIAL ───────
let facialSteps = { blink: false, turn: false, smile: false };
let govCheckDone = false;

// Funciones para simular verificación facial
window.simulateFacial = (step) => {
  if (step === 'blink') {
    facialSteps.blink = true;
    document.getElementById('facial-step-blink').classList.add('completed');
    document.getElementById('status-blink').style.background = '#34d399';
  } else if (step === 'turn') {
    facialSteps.turn = true;
    document.getElementById('facial-step-turn').classList.add('completed');
    document.getElementById('status-turn').style.background = '#34d399';
  } else if (step === 'smile') {
    facialSteps.smile = true;
    document.getElementById('facial-step-smile').classList.add('completed');
    document.getElementById('status-smile').style.background = '#34d399';
  }
  // Habilitar botón de gobierno si los tres pasos están hechos
  if (facialSteps.blink && facialSteps.turn && facialSteps.smile) {
    document.getElementById('gov-check-btn').disabled = false;
  }
};

window.simulateGovCheck = () => {
  govCheckDone = true;
  document.getElementById('gov-check-btn').disabled = true;
  document.getElementById('gov-check-btn').textContent = '✅ Consulta exitosa';
  // Habilitar botón de registro si todo está OK
  if (govCheckDone) {
    document.getElementById('btn-do-register').disabled = false;
  }
};

// ── REGISTRO MODIFICADO (incluye nuevos campos y validaciones) ──
function register({ fullName, email, password, phone, birthDate, cedula, address, bank, account }) {
  // Validar edad mínima 18 años
  const birth = new Date(birthDate);
  const age = Math.floor((Date.now() - birth) / (365.25 * 24 * 3600 * 1000));
  if (age < 18) return { error: 'Debes ser mayor de 18 años para registrarte.' };

  // Validar teléfono dominicano (10 dígitos y códigos válidos)
  if (!/^(809|829|849)\d{7}$/.test(phone)) {
    return { error: 'Teléfono dominicano inválido. Debe comenzar con 809, 829 o 849 y tener 10 dígitos.' };
  }

  // Validar cédula (11 dígitos)
  if (!/^\d{11}$/.test(cedula)) return { error: 'Cédula debe tener exactamente 11 dígitos.' };

  if (DB.find('users', u => u.email === email)) return { error: 'El email ya está registrado.' };

  const salt = Math.random().toString(36).slice(2);
  const hash = btoa(password + salt);
  const user = {
    id: DB.nextId('user'),
    email,
    passwordHash: hash,
    salt,
    fullName,
    phone,
    cedula,
    birthDate,
    address,
    bank,
    account,
    creditScore: null,
    createdAt: new Date().toISOString()
  };
  DB.push('users', user);
  DB.push('wallets', { id: DB.nextId('wallet'), userId: user.id, balance: 0, currency: 'USD', createdAt: new Date().toISOString() });
  currentUser = user; DB.set('session', user);
  return { user };
}

// ── LOGIN (igual) ─────────────────────────────────────────────
function login({ email, password }) { ... }

// ── LOGOUT (igual) ────────────────────────────────────────────
function logout() { ... }

// ── WALLET (igual) ────────────────────────────────────────────
function getWallet() { ... }
function deposit(...) {...}
function withdraw(...) {...}
function transfer(...) {...}

// ── CARD VALIDATION (igual) ───────────────────────────────────
function validateCard(...) {...}
function luhnCheck(...) {...}
window.formatCardNumber = ...; // (igual)

// ── LOAN PAYMENT (igual) ──────────────────────────────────────
let payingLoanId = null;
function renderPayPage() { ... }
// ... (se mantiene igual)

// ── LOAN CREATE MODIFICADO (ahora incluye garantía y firma) ───
function createLoan(data) {
  const rate = data.interestRate || 15.5;
  const monthly = calcMonthly(data.amount, rate, data.termMonths);
  const total = monthly * data.termMonths;
  const inv = 'FJAP-' + Date.now();
  const loan = {
    id: DB.nextId('loan'),
    userId: currentUser.id,
    amount: data.amount,
    termMonths: data.termMonths,
    interestRate: rate,
    paymentType: data.paymentType,
    amortizationType: data.amortizationType,
    currency: data.currency || 'USD',
    status: 'approved',
    monthlyPayment: +(monthly.toFixed(2)),
    totalToPay: +(total.toFixed(2)),
    purpose: data.purpose,
    collateral: data.collateral, // nueva garantía
    monthlyIncome: data.monthlyIncome,
    employer: data.employer,
    employmentYears: data.employmentYears,
    address: data.address,
    birthDate: data.birthDate,
    dependents: data.dependents || 0,
    debtLevel: data.debtLevel || 0,
    occupationType: data.occupationType || 'empleado',
    reference1Name: data.reference1Name || null,
    reference1Phone: data.reference1Phone || null,
    reference2Name: data.reference2Name || null,
    reference2Phone: data.reference2Phone || null,
    invoiceNumber: inv,
    creditScore: data.creditScore,
    riskTier: data.riskTier,
    approvedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    digitalSignature: data.digitalSignature, // firma digital
    bank: data.bank,   // banco usado para desembolso
    account: data.account
  };
  DB.push('loans', loan);
  const users = DB.get('users') || [];
  const idx = users.findIndex(u => u.id === currentUser.id);
  if (idx !== -1) {
    users[idx].creditScore = data.creditScore;
    DB.set('users', users);
    currentUser = users[idx];
    DB.set('session', currentUser);
  }
  // Simular transferencia a la cuenta bancaria (en lugar de billetera)
  showAlert(`💰 Préstamo aprobado. Se transferirán ${curSym(data.currency)}${data.amount} a tu cuenta ${data.bank} (${data.account})`, 'success');
  // Opcional: también se acredita en billetera virtual
  deposit(data.amount, `Desembolso préstamo #${loan.id} — ${inv}`);
  return loan;
}

// ── DOM HELPERS (igual) ───────────────────────────────────────
const $ = id => document.getElementById(id);
const fmtDate = ...;
const fmtMoney = ...;
function statusBadge(status) { ... }
function tierBadge(tier) { ... }

// ── PAGE VISIBILITY (igual) ───────────────────────────────────
function showLanding() { ... }
function showApp(page) {
  if (!requireAuth()) return;
  $('landing').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('landing-nav').classList.add('hidden');
  // Mostrar botón de WhatsApp
  document.getElementById('whatsapp-float').classList.remove('hidden');
  renderSidebar();
  showPage(page || 'home');
}
function showPage(page) { ... }
function renderPage(page) { ... }

// ── SIDEBAR (igual) ───────────────────────────────────────────
function renderSidebar() { ... }

// ── HOME (igual) ──────────────────────────────────────────────
function renderHome() { ... }

// ── LOANS (igual) ─────────────────────────────────────────────
function renderLoans() { ... }
function loanCardHTML(l) { ... }

// ── LOAN DETAIL (igual) ───────────────────────────────────────
function showLoanDetail(id) { ... }

// ── APPLY FORM MODIFICADO ─────────────────────────────────────
let applyStep = 1, applyData = {}, selectedCurrency = 'USD', applyAmount = 5000, applyTerm = 12, lastScoringResult = null;

function initApplyForm() {
  const coolDays = checkCooldown();
  if (coolDays) { showAlert(`⏳ Podrás aplicar en ${coolDays} día(s).`, 'error'); showPage('loans'); return; }
  applyStep = 1; applyData = {}; selectedCurrency = 'USD'; applyAmount = 5000; applyTerm = 12; lastScoringResult = null;
  // Precargar datos bancarios del usuario actual
  if (currentUser) {
    const bankSelect = $('f-bank');
    if (bankSelect) {
      bankSelect.innerHTML = `
        <option value="popular" ${currentUser.bank === 'popular' ? 'selected' : ''}>Banco Popular Dominicano</option>
        <option value="bhd" ${currentUser.bank === 'bhd' ? 'selected' : ''}>Banco BHD León</option>
        <option value="banreservas" ${currentUser.bank === 'banreservas' ? 'selected' : ''}>Banreservas</option>
        <option value="scotiabank" ${currentUser.bank === 'scotiabank' ? 'selected' : ''}>Scotiabank</option>
        <option value="progreso" ${currentUser.bank === 'progreso' ? 'selected' : ''}>Banco Progreso</option>
        <option value="caribe" ${currentUser.bank === 'caribe' ? 'selected' : ''}>Banco Caribe</option>
      `;
    }
    if ($('f-account')) $('f-account').value = currentUser.account || '';
  }
  // Limpiar checkbox y firma
  if ($('accept-terms')) $('accept-terms').checked = false;
  if ($('digital-signature')) $('digital-signature').value = '';

  const phaseList = $('verify-phases-list'); if (phaseList) phaseList.innerHTML = '';
  const resEl = $('verify-result'); if (resEl) resEl.classList.add('hidden');
  const spinWrap = $('verify-spinner-wrap'); if (spinWrap) spinWrap.innerHTML = '<div class="spin-ring"></div>';
  if ($('verify-title')) $('verify-title').textContent = 'Analizando Solicitud...';
  if ($('verify-subtitle')) $('verify-subtitle').textContent = 'No cierres esta ventana';
  const trackEl = $('verify-tracking'); if (trackEl) trackEl.classList.add('hidden');
  updateStepUI(); renderCurrencyPicker(); updateAmountDisplay();
  const amtSlider = $('amt-slider'); if (amtSlider) amtSlider.addEventListener('input', e => { applyAmount = +e.target.value; updateAmountDisplay(); });
  const termSlider = $('term-slider'); if (termSlider) termSlider.addEventListener('input', e => { applyTerm = +e.target.value; $('term-val').textContent = e.target.value; });
}

function updateAmountDisplay() {
  const sym = curSym(selectedCurrency);
  const elAmt = $('amount-big'); if (elAmt) elAmt.innerHTML = `<span class="amount-sym">${sym}</span>${Number(applyAmount).toLocaleString('es')}`;
  const mn = $('range-min'), mx = $('range-max');
  if (mn) mn.textContent = sym + '100'; if (mx) mx.textContent = sym + '100,000';
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

// Validaciones de los nuevos pasos
function validateStep1() {
  const collateral = ($('f-collateral')?.value || '').trim();
  if (!collateral) return 'La garantía es requerida. Describe el bien que respalda el préstamo.';
  if (applyAmount < 100) return 'El monto debe ser al menos 100.';
  if (applyAmount > 100000) return 'El monto máximo es 100,000.';
  if (applyTerm < 1 || applyTerm > 60) return 'Plazo inválido.';
  return null;
}

function validateStep2() {
  const bank = $('f-bank')?.value;
  const account = ($('f-account')?.value || '').trim();
  if (!bank) return 'Selecciona un banco.';
  if (!account) return 'Número de cuenta requerido.';
  return null;
}

function validateStep3() {
  if (!$('accept-terms')?.checked) return 'Debes aceptar los términos y condiciones.';
  const signature = ($('digital-signature')?.value || '').trim();
  if (!signature) return 'La firma digital es obligatoria.';
  if (signature.length < 3) return 'Firma demasiado corta.';
  return null;
}

window.applyNext = async () => {
  if (applyStep === 1) { const err = validateStep1(); if (err) { showStepError(err); return; } }
  if (applyStep === 2) { const err = validateStep2(); if (err) { showStepError(err); return; } }
  if (applyStep === 3) { const err = validateStep3(); if (err) { showStepError(err); return; } }
  if (applyStep < 3) { applyStep++; updateStepUI(); return; }
  if (applyStep === 3) {
    // Recopilar datos de los pasos 1,2,3
    applyData = {
      ...applyData,
      amount: applyAmount,
      termMonths: applyTerm,
      paymentType: $('sel-payment')?.value || 'monthly',
      amortizationType: $('sel-amort')?.value || 'french',
      purpose: $('sel-purpose')?.value || 'otros',
      currency: selectedCurrency,
      collateral: $('f-collateral')?.value || '',
      bank: $('f-bank')?.value,
      account: $('f-account')?.value,
      digitalSignature: $('digital-signature')?.value
    };
    // Obtener datos personales desde currentUser
    const params = {
      monthlyIncome: +($('f-income')?.value || 0),
      debtLevel: +($('f-debt')?.value || 0),
      employmentYears: +($('f-empyears')?.value || 0),
      amount: applyAmount,
      termMonths: applyTerm,
      age: calculateAge(currentUser.birthDate), // edad desde registro
      purpose: $('sel-purpose')?.value || 'otros',
      dependents: +($('f-dependents')?.value || 0),
      occupationType: $('f-occupation')?.value || 'empleado'
    };
    const scoringResult = advancedCreditScore(params);
    lastScoringResult = scoringResult;
    const phases = buildVerificationPhases(params, scoringResult);
    applyStep = 4; updateStepUI();
    const trackCode = 'EXP-' + Date.now().toString(36).toUpperCase().slice(-8);
    const trackEl = $('verify-tracking'); const codeEl = $('verify-code');
    if (codeEl) codeEl.textContent = trackCode; if (trackEl) trackEl.classList.remove('hidden');
    await animatePhases(phases);
    await sleep(600);
    showVerificationResult(scoringResult);
  }
};

window.submitLoan = () => {
  if (!lastScoringResult || !lastScoringResult.approved) { showAlert('Solicitud no aprobada.', 'error'); return; }
  // Agregar datos faltantes (ingresos, referencias) desde los campos del formulario
  const d = {
    ...applyData,
    birthDate: currentUser.birthDate,
    address: currentUser.address,
    monthlyIncome: +($('f-income')?.value || 0),
    debtLevel: +($('f-debt')?.value || 0),
    employer: $('f-employer')?.value || '',
    employmentYears: +($('f-empyears')?.value || 0),
    occupationType: $('f-occupation')?.value || 'empleado',
    reference1Name: $('f-ref1name')?.value || '',
    reference1Phone: $('f-ref1phone')?.value || '',
    reference2Name: $('f-ref2name')?.value || '',
    reference2Phone: $('f-ref2phone')?.value || '',
    creditScore: lastScoringResult.score,
    riskTier: lastScoringResult.riskTier,
    interestRate: lastScoringResult.interestRate
  };
  const loan = createLoan(d);
  showAlert('🎉 ¡Préstamo aprobado! El dinero será transferido a tu cuenta bancaria.', 'success');
  setTimeout(() => { showLoanDetail(loan.id); }, 900);
};

// ── WALLET PAGE (igual) ───────────────────────────────────────
function renderWallet() { ... }

// ── BUSINESS MODULE (igual) ───────────────────────────────────
window.showBizTab = (tab) => { ... }

// ── ACCOUNTING MODULE (igual) ─────────────────────────────────
function renderAccounting() { ... }
window.exportAccounting = ...;

// ── AI ASSISTANT (igual) ──────────────────────────────────────
function renderAiPage() { ... }
async function sendAiMessage() { ... }
// ...

// ── INVOICE (igual) ───────────────────────────────────────────
window.showInvoice = ...;
window.closeInvoice = ...;
window.printInvoice = ...;

// ── AUTH MODAL (ajustado para nuevos campos) ──────────────────
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
  const fullName=$('r-name').value.trim();
  const email=$('r-email').value.trim();
  const password=$('r-pass').value;
  const phone=$('r-phone').value.replace(/\D/g,'');
  const birthDate=$('r-birth').value;
  const cedula=$('r-cedula').value.replace(/\D/g,'');
  const address=$('r-address').value.trim();
  const bank=$('r-bank').value;
  const account=$('r-account').value.trim();

  if (!fullName||!email||!password||!phone||!birthDate||!cedula||!address||!bank||!account) {
    $('auth-err').textContent='Completa todos los campos.'; return;
  }
  if (password.length<6) { $('auth-err').textContent='Contraseña mínimo 6 caracteres.'; return; }
  // Verificar que los pasos faciales y gov check estén completos
  if (!facialSteps.blink || !facialSteps.turn || !facialSteps.smile || !govCheckDone) {
    $('auth-err').textContent='Debes completar la verificación facial y la consulta gubernamental.'; return;
  }
  const r = register({ fullName, email, password, phone, birthDate, cedula, address, bank, account });
  if (r.error) { $('auth-err').textContent=r.error; return; }
  $('auth-overlay').classList.add('hidden');
  // Resetear pasos faciales
  facialSteps = { blink: false, turn: false, smile: false };
  govCheckDone = false;
  showApp('home');
};

// ── ALERTS (igual) ────────────────────────────────────────────
function showAlert(msg, type) { ... }

// ── INIT (igual, pero mostramos whatsapp solo si logueado) ────
document.addEventListener('DOMContentLoaded', () => {
  if (currentUser) { showApp('home'); } else { showLanding(); }
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      if (page === 'logout') { logout(); document.getElementById('whatsapp-float').classList.add('hidden'); return; }
      showPage(page);
      if (page === 'apply') initApplyForm();
    });
  });
  $('btn-apply-nav')?.addEventListener('click', () => { showPage('apply'); initApplyForm(); });
});

// Exportar funciones globales necesarias
window.showLoanDetail = showLoanDetail;
window.showPage = showPage;
window.logout = logout;
window.showApp = showApp;
window.openPayCardModal = openPayCardModal;
window.closePayCardModal = closePayCardModal;
window.confirmLoanPayment = confirmLoanPayment;