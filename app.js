// ── STORAGE ────────────────────────────────────────────────
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
  find: (k, pred) => (DB.get(k) || []).find(pred),
  filter: (k, pred) => (DB.get(k) || []).filter(pred),
  nextId: k => { const n = (DB.get('seq_' + k) || 0) + 1; DB.set('seq_' + k, n); return n; },
};

// ── CURRENCIES ─────────────────────────────────────────────
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
const curSym = code => (CURRENCIES.find(c => c.code === code) || {}).sym || '$';
const curFlag= code => (CURRENCIES.find(c => c.code === code) || {}).flag || '🌐';

// ── MATH ───────────────────────────────────────────────────
function calcMonthly(principal, annualRate, months) {
  if (annualRate === 0) return principal / months;
  const r = annualRate / 100 / 12;
  return (principal * r * Math.pow(1+r, months)) / (Math.pow(1+r, months) - 1);
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
    rows.push({ period: i, date: d.toLocaleDateString('es', {month:'short',year:'numeric'}),
      principal: +(princ.toFixed(2)), interest: +(interest.toFixed(2)),
      payment: +(monthly.toFixed(2)), balance: +(balance.toFixed(2)) });
  }
  return rows;
}
function creditScore({ monthlyIncome, debtLevel, employmentYears, amount, termMonths }) {
  let s = 500;
  s += Math.min(200, (monthlyIncome / 10000) * 50);
  s += Math.max(0, 150 - debtLevel * 1.5);
  s += Math.min(100, employmentYears * 20);
  const ltv = amount / (monthlyIncome * termMonths);
  s += ltv < 0.5 ? 150 : ltv < 1 ? 100 : 50;
  return Math.round(Math.min(900, Math.max(300, s)));
}

// ── AUTH ───────────────────────────────────────────────────
let currentUser = DB.get('session') || null;

function register({ email, password, fullName, phone, cedula }) {
  if (DB.find('users', u => u.email === email)) return { error: 'El email ya está registrado' };
  const salt = Math.random().toString(36).slice(2);
  const hash = btoa(password + salt);
  const user = { id: DB.nextId('user'), email, passwordHash: hash, salt, fullName, phone, cedula, creditScore: null, createdAt: new Date().toISOString() };
  DB.push('users', user);
  DB.push('wallets', { id: DB.nextId('wallet'), userId: user.id, balance: 0, currency: 'USD', createdAt: new Date().toISOString() });
  currentUser = user;
  DB.set('session', user);
  return { user };
}
function login({ email, password }) {
  const user = DB.find('users', u => u.email === email);
  if (!user) return { error: 'Credenciales inválidas' };
  if (btoa(password + user.salt) !== user.passwordHash) return { error: 'Credenciales inválidas' };
  currentUser = user;
  DB.set('session', user);
  return { user };
}
function logout() { currentUser = null; DB.set('session', null); showLanding(); }
function requireAuth() { if (!currentUser) { showLanding(); return false; } return true; }

// ── WALLET OPERATIONS ──────────────────────────────────────
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
  const sender = getWallet();
  if (!sender || sender.balance < amount) return { error: 'Saldo insuficiente' };
  const recipient = DB.find('users', u => u.email === recipientEmail);
  if (!recipient) return { error: 'Destinatario no encontrado' };
  const recipientWallet = DB.find('wallets', w => w.userId === recipient.id);
  const ref = 'TRF-' + Date.now();
  DB.update('wallets', sender.id, { balance: sender.balance - amount });
  DB.push('transactions', { id: DB.nextId('tx'), walletId: sender.id, type: 'transfer_out', amount, description: description || `Transferencia a ${recipientEmail}`, reference: ref, createdAt: new Date().toISOString() });
  if (recipientWallet) {
    DB.update('wallets', recipientWallet.id, { balance: recipientWallet.balance + amount });
    DB.push('transactions', { id: DB.nextId('tx'), walletId: recipientWallet.id, type: 'transfer_in', amount, description: 'Transferencia recibida', reference: ref, createdAt: new Date().toISOString() });
  }
  return { ok: true };
}

// ── LOAN OPERATIONS ─────────────────────────────────────────
function createLoan(data) {
  const monthly = calcMonthly(data.amount, 15.5, data.termMonths);
  const total   = monthly * data.termMonths;
  const score   = creditScore({ monthlyIncome: data.monthlyIncome, debtLevel: data.debtLevel || 0, employmentYears: data.employmentYears, amount: data.amount, termMonths: data.termMonths });
  const approved = score >= 650;
  const inv = 'FJAP-' + Date.now();
  const loan = {
    id: DB.nextId('loan'), userId: currentUser.id,
    amount: data.amount, termMonths: data.termMonths,
    interestRate: 15.5, paymentType: data.paymentType,
    amortizationType: data.amortizationType,
    currency: data.currency || 'USD',
    status: approved ? 'approved' : 'pending',
    monthlyPayment: +(monthly.toFixed(2)),
    totalToPay: +(total.toFixed(2)),
    purpose: data.purpose, monthlyIncome: data.monthlyIncome,
    employer: data.employer, employmentYears: data.employmentYears,
    address: data.address, birthDate: data.birthDate,
    maritalStatus: data.maritalStatus, dependents: data.dependents || 0,
    debtLevel: data.debtLevel || 0,
    reference1Name: data.reference1Name || null,
    reference1Phone: data.reference1Phone || null,
    invoiceNumber: inv, creditScore: score,
    approvedAt: approved ? new Date().toISOString() : null,
    createdAt: new Date().toISOString()
  };
  DB.push('loans', loan);
  if (approved) {
    const users = DB.get('users') || [];
    const idx = users.findIndex(u => u.id === currentUser.id);
    if (idx !== -1) { users[idx].creditScore = score; DB.set('users', users); currentUser = users[idx]; DB.set('session', currentUser); }
    deposit(data.amount, `Desembolso préstamo #${loan.id} — ${inv}`);
  }
  return loan;
}

// ── DOM HELPERS ─────────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = (tag, attrs, ...children) => {
  const e = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k,v]) => { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); });
  children.forEach(c => e.append(typeof c === 'string' ? c : c));
  return e;
};
const fmtDate = iso => new Date(iso).toLocaleDateString('es', { day:'2-digit', month:'short', year:'numeric' });
const fmtMoney = (n, currency) => `${curSym(currency || 'USD')}${Number(n).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function statusBadge(status) {
  const map = { approved:'badge-green', active:'badge-green', pending:'badge-amber', paid:'badge-blue', overdue:'badge-red' };
  const label = { approved:'Aprobado', active:'Activo', pending:'Pendiente', paid:'Pagado', overdue:'Atrasado' };
  return `<span class="badge ${map[status]||'badge-zinc'}">${label[status]||status}</span>`;
}

// ── PAGE VISIBILITY ─────────────────────────────────────────
function showLanding() {
  $('landing').classList.remove('hidden');
  $('app').classList.add('hidden');
  $('landing-nav').classList.remove('hidden');
}
function showApp(page) {
  if (!requireAuth()) return;
  $('landing').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('landing-nav').classList.add('hidden');
  renderSidebar();
  showPage(page || 'home');
}
function showPage(page) {
  document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
  const target = $('page-' + page);
  if (target) { target.classList.remove('hidden'); renderPage(page); }
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.page === page);
  });
}
function renderPage(page) {
  const renderers = { home: renderHome, loans: renderLoans, wallet: renderWallet };
  if (renderers[page]) renderers[page]();
}

// ── SIDEBAR ─────────────────────────────────────────────────
function renderSidebar() {
  const u = $('sidebar-user-info');
  if (u && currentUser) {
    u.innerHTML = `<div class="name">${currentUser.fullName}</div><div class="email">${currentUser.email}</div>`;
  }
}

// ── HOME ─────────────────────────────────────────────────────
function renderHome() {
  const loans = DB.filter('loans', l => l.userId === currentUser.id);
  const wallet = getWallet() || { balance: 0, currency: 'USD' };
  const active = loans.filter(l => l.status === 'approved' || l.status === 'active').length;
  const score = currentUser.creditScore;
  $('stat-balance').textContent = fmtMoney(wallet.balance, wallet.currency);
  $('stat-loans').textContent = loans.length;
  $('stat-active').textContent = active;
  $('stat-score').textContent = score ? score : '—';

  const recent = $('recent-loans');
  if (!loans.length) {
    recent.innerHTML = `<div class="empty"><div class="icon">💳</div><h3>Aún no tienes préstamos</h3><p>Solicita tu primer préstamo ahora</p><button class="btn btn-gold" onclick="showPage('apply')">Solicitar Préstamo</button></div>`;
    return;
  }
  recent.innerHTML = loans.slice(-3).reverse().map(l => loanCardHTML(l)).join('');
}

// ── LOANS ─────────────────────────────────────────────────────
function renderLoans() {
  const loans = DB.filter('loans', l => l.userId === currentUser.id);
  const grid = $('loans-grid');
  if (!loans.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="icon">💳</div><h3>Aún no tienes préstamos</h3><p>Solicita tu primer préstamo ahora. Nuestro sistema de IA evaluará tu solicitud en segundos.</p><button class="btn btn-gold btn-lg" onclick="showPage('apply')">✦ Solicitar mi primer préstamo</button></div>`;
    return;
  }
  grid.innerHTML = loans.map(l => loanCardHTML(l)).join('');
}
function loanCardHTML(l) {
  const sym = curSym(l.currency);
  const flag = curFlag(l.currency);
  return `
  <div class="loan-card">
    <div class="loan-card-head">
      <div>
        <div class="loan-id">ID: #${l.id}</div>
        ${statusBadge(l.status)}
      </div>
      <div>
        <div class="loan-currency">${flag} ${l.currency || 'USD'}</div>
        <div class="loan-amount">${sym}${Number(l.amount).toLocaleString('es')}</div>
      </div>
    </div>
    <div class="loan-details">
      <div class="loan-detail-item"><div class="dt">Plazo</div><div class="dd">${l.termMonths} meses</div></div>
      <div class="loan-detail-item"><div class="dt">Cuota</div><div class="dd gold">${sym}${l.monthlyPayment.toFixed(2)}</div></div>
      <div class="loan-detail-item"><div class="dt">Interés</div><div class="dd">${l.interestRate}%</div></div>
      <div class="loan-detail-item"><div class="dt">Fecha</div><div class="dd">${fmtDate(l.createdAt)}</div></div>
    </div>
    <div class="loan-card-actions">
      <button class="btn btn-ghost btn-sm" style="flex:1" onclick="showLoanDetail(${l.id})">Ver Detalles</button>
      ${l.invoiceNumber ? `<button class="btn btn-outline btn-sm" onclick="showInvoice(${l.id})" title="Ver Factura">🧾</button>` : ''}
    </div>
    ${l.invoiceNumber ? `<div class="invoice-num">${l.invoiceNumber}</div>` : ''}
  </div>`;
}

// ── LOAN DETAIL ──────────────────────────────────────────────
function showLoanDetail(id) {
  const loan = DB.find('loans', l => l.id === id);
  if (!loan) return;
  const sym = curSym(loan.currency);
  const amort = buildAmortization(loan.amount, loan.interestRate, loan.termMonths);
  const container = $('page-loan-detail');

  const purposeMap = { negocio:'Inversión Negocio', vehiculo:'Vehículo', hogar:'Remodelación Hogar', deudas:'Consolidar Deudas', otros:'Otros' };
  const payMap = { monthly:'Mensual', biweekly:'Quincenal', weekly:'Semanal' };
  const amortMap = { french:'Francés (Cuota Fija)', german:'Alemán (Capital Fijo)', american:'Americano' };

  container.innerHTML = `
    <div class="page-header">
      <div>
        <button class="btn btn-ghost btn-sm" onclick="showPage('loans')">← Mis Préstamos</button>
        <div class="page-title" style="margin-top:12px"><span class="icon">📋</span> Préstamo #${loan.id}</div>
        <div style="margin-top:6px">${statusBadge(loan.status)} <span class="badge badge-zinc" style="margin-left:4px">${curFlag(loan.currency)} ${loan.currency}</span></div>
      </div>
      ${loan.invoiceNumber ? `<button class="btn btn-outline" onclick="showInvoice(${loan.id})">🧾 Ver Factura</button>` : ''}
    </div>
    <div class="detail-meta">
      <div class="meta-item"><div class="dt">Monto</div><div class="dd gold">${sym}${Number(loan.amount).toLocaleString('es', {minimumFractionDigits:2})}</div></div>
      <div class="meta-item"><div class="dt">Cuota ${payMap[loan.paymentType]||''}</div><div class="dd gold">${sym}${loan.monthlyPayment.toFixed(2)}</div></div>
      <div class="meta-item"><div class="dt">Total a pagar</div><div class="dd">${sym}${loan.totalToPay.toFixed(2)}</div></div>
      <div class="meta-item"><div class="dt">Tasa anual</div><div class="dd">${loan.interestRate}%</div></div>
      <div class="meta-item"><div class="dt">Plazo</div><div class="dd">${loan.termMonths} meses</div></div>
      <div class="meta-item"><div class="dt">Amortización</div><div class="dd">${amortMap[loan.amortizationType]||loan.amortizationType}</div></div>
      <div class="meta-item"><div class="dt">Score IA</div><div class="dd gold">${loan.creditScore || '—'}</div></div>
      <div class="meta-item"><div class="dt">Propósito</div><div class="dd">${purposeMap[loan.purpose]||loan.purpose}</div></div>
    </div>
    <div class="card" style="overflow-x:auto">
      <h3 style="margin-bottom:16px;font-size:16px;font-weight:700">📊 Tabla de Amortización</h3>
      <table class="amort-table">
        <thead><tr><th>#</th><th>Fecha</th><th>Capital</th><th>Interés</th><th>Cuota</th><th>Saldo</th></tr></thead>
        <tbody>${amort.map(r => `
          <tr>
            <td>${r.period}</td>
            <td>${r.date}</td>
            <td>${sym}${r.principal.toFixed(2)}</td>
            <td>${sym}${r.interest.toFixed(2)}</td>
            <td class="gold">${sym}${r.payment.toFixed(2)}</td>
            <td>${sym}${r.balance.toFixed(2)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  document.querySelectorAll('.app-page').forEach(p => p.classList.add('hidden'));
  container.classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
}

// ── APPLY FORM ──────────────────────────────────────────────
let applyStep = 1;
let applyData = {};
let selectedCurrency = 'USD';
let applyAmount = 5000;
let applyTerm = 12;

function initApplyForm() {
  applyStep = 1; applyData = {}; selectedCurrency = 'USD'; applyAmount = 5000; applyTerm = 12;
  updateStepUI();
  renderCurrencyPicker();
  updateAmountDisplay();

  const amtSlider = $('amt-slider');
  if (amtSlider) amtSlider.addEventListener('input', e => { applyAmount = +e.target.value; updateAmountDisplay(); });
  const termSlider = $('term-slider');
  if (termSlider) termSlider.addEventListener('input', e => { applyTerm = +e.target.value; $('term-val').textContent = e.target.value; });
}

function updateAmountDisplay() {
  const sym = curSym(selectedCurrency);
  const el = $('amount-big');
  if (el) el.innerHTML = `<span class="amount-sym">${sym}</span>${Number(applyAmount).toLocaleString('es')}`;
  const mn = $('range-min'), mx = $('range-max');
  if (mn) mn.textContent = sym + '100';
  if (mx) mx.textContent = sym + '50,000';
}

function renderCurrencyPicker() {
  const grid = $('currency-grid');
  if (!grid) return;
  grid.innerHTML = CURRENCIES.map(c => `
    <button class="currency-btn ${c.code === selectedCurrency ? 'selected' : ''}" onclick="selectCurrency('${c.code}')">
      <span class="cflag">${c.flag}</span>
      <span class="ccode">${c.code}</span>
    </button>`).join('');
}
window.selectCurrency = code => {
  selectedCurrency = code;
  renderCurrencyPicker();
  updateAmountDisplay();
  const lbl = $('currency-label');
  if (lbl) { const c = CURRENCIES.find(x => x.code === code); lbl.textContent = c ? `${c.flag} ${c.name} — ${c.sym}` : ''; }
};

function updateStepUI() {
  for (let i = 1; i <= 4; i++) {
    const dot = $('sdot-' + i);
    const line = $('sline-' + i);
    if (dot) dot.className = `step-dot ${i < applyStep ? 'done' : i === applyStep ? 'current' : 'pending'}`;
    if (line) line.className = `step-line ${i < applyStep ? 'done' : 'pending'}`;
    const panel = $('spanel-' + i);
    if (panel) panel.className = `step-panel ${i === applyStep ? 'active' : ''}`;
  }
  $('btn-back') && ($('btn-back').style.display = applyStep > 1 && applyStep < 4 ? '' : 'none');
  $('btn-next') && ($('btn-next').style.display = applyStep < 4 ? '' : 'none');
  if ($('btn-next')) $('btn-next').textContent = applyStep < 3 ? 'Continuar →' : '⚡ Evaluar Perfil';
  $('btn-submit') && ($('btn-submit').style.display = applyStep === 4 && !$('scoring-loader')?.classList.contains('hidden') ? 'none' : applyStep === 4 ? '' : 'none');
}

window.applyNext = () => {
  if (applyStep < 3) { applyStep++; updateStepUI(); return; }
  if (applyStep === 3) {
    collectStep3();
    applyStep = 4; updateStepUI();
    $('scoring-loader').classList.remove('hidden');
    $('score-result').classList.add('hidden');
    $('btn-submit').style.display = 'none';
    setTimeout(() => {
      $('scoring-loader').classList.add('hidden');
      $('score-result').classList.remove('hidden');
      $('btn-submit').style.display = '';
      const score = creditScore({ monthlyIncome: applyData.monthlyIncome || 3000, debtLevel: applyData.debtLevel || 0, employmentYears: applyData.employmentYears || 1, amount: applyAmount, termMonths: applyTerm });
      $('score-num').textContent = score;
      const lbl = score >= 800 ? 'Excelente' : score >= 650 ? 'Bueno' : score >= 500 ? 'Moderado' : 'Alto Riesgo';
      $('score-lbl').textContent = lbl;
      const pre = $('score-pretitle');
      if (score >= 650) { pre.textContent = '¡Préstamo Pre-Aprobado!'; pre.style.color = '#34d399'; }
      else { pre.textContent = 'Solicitud en Revisión'; pre.style.color = 'var(--gold)'; }
    }, 3200);
  }
};
window.applyBack = () => { if (applyStep > 1) { applyStep--; updateStepUI(); } };

function collectStep3() {
  applyData.amount = applyAmount;
  applyData.termMonths = applyTerm;
  applyData.paymentType = $('sel-payment')?.value || 'monthly';
  applyData.amortizationType = $('sel-amort')?.value || 'french';
  applyData.purpose = $('sel-purpose')?.value || 'otros';
  applyData.currency = selectedCurrency;
}

window.submitLoan = () => {
  const d = {
    ...applyData,
    birthDate: $('f-birthDate')?.value || '',
    maritalStatus: $('f-marital')?.value || 'single',
    address: $('f-address')?.value || '',
    dependents: +($('f-dependents')?.value || 0),
    monthlyIncome: +($('f-income')?.value || 0),
    debtLevel: +($('f-debt')?.value || 0),
    employer: $('f-employer')?.value || '',
    employmentYears: +($('f-empyears')?.value || 0),
    reference1Name: $('f-ref1name')?.value || '',
    reference1Phone: $('f-ref1phone')?.value || '',
  };
  const loan = createLoan(d);
  showAlert('¡Préstamo creado con éxito!', 'success');
  setTimeout(() => { showLoanDetail(loan.id); }, 800);
};

// ── WALLET ───────────────────────────────────────────────────
function renderWallet() {
  const wallet = getWallet() || { balance: 0, currency: 'USD' };
  const txs = DB.filter('transactions', t => t.walletId === wallet.id)
    .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

  $('wallet-balance').textContent = fmtMoney(wallet.balance, wallet.currency);
  $('wallet-currency').textContent = `${curFlag(wallet.currency)} ${wallet.currency}`;

  const list = $('tx-list');
  if (!txs.length) {
    list.innerHTML = `<div class="empty"><div class="icon">💸</div><h3>Sin movimientos</h3><p>Realiza tu primer depósito o solicita un préstamo</p></div>`;
    return;
  }
  const isIn = t => ['deposit','transfer_in','loan_disbursement'].includes(t.type);
  const typeIcon = { deposit:'⬇️', withdrawal:'⬆️', transfer_in:'⬇️', transfer_out:'⬆️', loan_disbursement:'🏦', loan_payment:'💳' };
  list.innerHTML = txs.map(t => `
    <div class="tx-item">
      <div class="tx-icon ${isIn(t) ? 'in' : 'out'}">${typeIcon[t.type] || '💰'}</div>
      <div class="tx-info">
        <div class="tx-desc">${t.description}</div>
        <div class="tx-date">${fmtDate(t.createdAt)}${t.reference ? ' · ' + t.reference : ''}</div>
      </div>
      <div class="tx-amount ${isIn(t) ? 'in' : 'out'}">${isIn(t) ? '+' : '-'}${fmtMoney(t.amount, wallet.currency)}</div>
    </div>`).join('');
}

// Wallet modal
let walletAction = 'deposit';
window.openWalletModal = (action) => {
  walletAction = action;
  const modal = $('wallet-modal-overlay');
  const title = { deposit:'Depositar Fondos', withdraw:'Retirar Fondos', transfer:'Transferir' };
  $('wallet-modal-title').textContent = title[action] || 'Operación';
  $('wallet-transfer-row').style.display = action === 'transfer' ? '' : 'none';
  $('wallet-modal-err').textContent = '';
  $('wallet-amount-input').value = '';
  $('wallet-desc-input').value = '';
  if ($('wallet-recipient')) $('wallet-recipient').value = '';
  modal.classList.remove('hidden');
};
window.closeWalletModal = () => $('wallet-modal-overlay').classList.add('hidden');
window.submitWalletOp = () => {
  const amount = +$('wallet-amount-input').value;
  const description = $('wallet-desc-input').value;
  const errEl = $('wallet-modal-err');
  if (!amount || amount <= 0) { errEl.textContent = 'Ingresa un monto válido'; return; }
  if (walletAction === 'deposit') {
    deposit(amount, description);
    closeWalletModal(); renderWallet();
    showAlert('Depósito realizado con éxito', 'success');
  } else if (walletAction === 'withdraw') {
    const ok = withdraw(amount, description);
    if (!ok) { errEl.textContent = 'Saldo insuficiente'; return; }
    closeWalletModal(); renderWallet();
    showAlert('Retiro realizado con éxito', 'success');
  } else if (walletAction === 'transfer') {
    const email = $('wallet-recipient')?.value;
    if (!email) { errEl.textContent = 'Ingresa el email del destinatario'; return; }
    const result = transfer(amount, email, description);
    if (result.error) { errEl.textContent = result.error; return; }
    closeWalletModal(); renderWallet();
    showAlert('Transferencia realizada con éxito', 'success');
  }
};

// ── INVOICE ───────────────────────────────────────────────────
window.showInvoice = (id) => {
  const loan = DB.find('loans', l => l.id === id);
  if (!loan) return;
  const sym = curSym(loan.currency);
  const flag = curFlag(loan.currency);
  const purposeMap = { negocio:'Inversión en Negocio', vehiculo:'Vehículo', hogar:'Remodelación Hogar', deudas:'Consolidar Deudas', otros:'Otros' };
  const payMap = { monthly:'Mensual', biweekly:'Quincenal', weekly:'Semanal' };
  const amortMap = { french:'Francés (Cuota Fija)', german:'Alemán (Capital Fijo)', american:'Americano' };
  const user = currentUser;
  const now = new Date().toLocaleDateString('es', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });

  $('invoice-body').innerHTML = `
    <div class="inv-header">
      <div><div class="inv-brand">FJAP <span>Préstamos</span></div><p style="color:#888;font-size:12px;margin-top:4px">Plataforma de Préstamos Personales<br>contacto@fjap.com</p></div>
      <div class="inv-num" style="text-align:right">
        <p style="font-size:11px;color:#888">Factura N°</p>
        <h2>${loan.invoiceNumber}</h2>
        <span style="display:inline-block;background:#d1fae5;color:#065f46;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;margin-top:4px">✓ Aprobado</span>
        <div style="margin-top:6px;font-size:13px;font-weight:700">${flag} ${loan.currency}</div>
      </div>
    </div>
    <div class="inv-cols">
      <div class="inv-section">
        <h4>Cliente</h4>
        <p class="val">${user.fullName}</p>
        <p>${user.email}</p>
        <p>Cédula: ${user.cedula}</p>
        <p>Tel: ${user.phone}</p>
      </div>
      <div class="inv-section">
        <h4>Detalles del Documento</h4>
        <p>Emisión: <span class="val">${fmtDate(loan.createdAt)}</span></p>
        ${loan.approvedAt ? `<p>Aprobación: <span class="val">${fmtDate(loan.approvedAt)}</span></p>` : ''}
        <p>ID Préstamo: <span class="val">#${loan.id}</span></p>
        <p>Score IA: <span class="val" style="color:#059669">${loan.creditScore || 785} — Excelente</span></p>
      </div>
    </div>
    <table class="inv-table">
      <thead><tr><th>Concepto</th><th style="text-align:right">Valor</th></tr></thead>
      <tbody>
        <tr><td>Capital Prestado</td><td style="text-align:right;font-weight:700">${sym}${Number(loan.amount).toLocaleString('es',{minimumFractionDigits:2})}</td></tr>
        <tr><td>Tasa de Interés Anual</td><td style="text-align:right">${loan.interestRate}%</td></tr>
        <tr><td>Plazo</td><td style="text-align:right">${loan.termMonths} meses</td></tr>
        <tr><td>Sistema de Amortización</td><td style="text-align:right">${amortMap[loan.amortizationType]||loan.amortizationType}</td></tr>
        <tr><td>Frecuencia de Pago</td><td style="text-align:right">${payMap[loan.paymentType]||loan.paymentType}</td></tr>
        <tr><td>Propósito</td><td style="text-align:right">${purposeMap[loan.purpose]||loan.purpose}</td></tr>
        <tr><td>Cuota ${payMap[loan.paymentType]||loan.paymentType}</td><td style="text-align:right;font-weight:700;color:#d97706">${sym}${loan.monthlyPayment.toFixed(2)}</td></tr>
        <tr class="total"><td>TOTAL A PAGAR</td><td style="text-align:right">${sym}${loan.totalToPay.toFixed(2)}</td></tr>
      </tbody>
    </table>
    <div class="inv-sigs">
      <div class="inv-sig"><div class="inv-sig-line"></div><p>Firma del Cliente</p><p style="font-weight:700;color:#333;font-size:12px;margin-top:2px">${user.fullName}</p></div>
      <div class="inv-sig"><div class="inv-sig-line"></div><p>Firma Autorizada</p><p style="font-weight:700;color:#333;font-size:12px;margin-top:2px">FJAP Préstamos Personales</p></div>
    </div>
    <div class="inv-footer">Este documento es válido como comprobante de préstamo aprobado por FJAP Préstamos Personales.<br>Generado automáticamente el ${now} · ${loan.invoiceNumber}</div>`;

  $('invoice-overlay').classList.remove('hidden');
};
window.closeInvoice = () => $('invoice-overlay').classList.add('hidden');
window.printInvoice = () => {
  const body = $('invoice-body').innerHTML;
  const win = window.open('', '_blank');
  win.document.write(`<html><head><title>Factura</title><style>
    *{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;color:#111;background:#fff;padding:40px}
    .inv-header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:24px;border-bottom:2px solid #f59e0b;margin-bottom:24px}
    .inv-brand{font-size:22px;font-weight:900}.inv-brand span{color:#f59e0b}
    .inv-cols{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px}
    .inv-section h4{font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
    .inv-section p{font-size:13px;color:#333;margin-bottom:2px}.inv-section .val{font-weight:700;color:#111}
    .inv-table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px}
    .inv-table th{background:#f9fafb;padding:10px 12px;text-align:left;font-size:11px;color:#888;font-weight:600}
    .inv-table td{padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#333}
    .inv-table tr.total td{font-weight:700;font-size:14px;background:#fffbeb;color:#92400e}
    .inv-sigs{display:flex;justify-content:space-between;margin-top:32px;padding-top:20px;border-top:1px solid #e5e7eb}
    .inv-sig{text-align:center}.inv-sig-line{width:160px;border-top:1px solid #ccc;margin-bottom:6px}
    .inv-sig p{font-size:11px;color:#888}.inv-footer{margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-size:11px;color:#aaa}
  </style></head><body>${body}</body></html>`);
  win.document.close(); win.focus(); win.print(); win.close();
};

// ── AUTH MODAL ───────────────────────────────────────────────
window.openAuth = (tab) => {
  $('auth-overlay').classList.remove('hidden');
  switchAuthTab(tab || 'login');
};
window.closeAuth = (e) => { if (!e || e.target === $('auth-overlay')) $('auth-overlay').classList.add('hidden'); };
window.switchAuthTab = (tab) => {
  $('tab-login').classList.toggle('active', tab === 'login');
  $('tab-register').classList.toggle('active', tab === 'register');
  $('form-login').classList.toggle('hidden', tab !== 'login');
  $('form-register').classList.toggle('hidden', tab !== 'register');
  $('auth-err').textContent = '';
};
window.doLogin = () => {
  const email = $('l-email').value.trim();
  const password = $('l-pass').value;
  if (!email || !password) { $('auth-err').textContent = 'Completa todos los campos'; return; }
  const r = login({ email, password });
  if (r.error) { $('auth-err').textContent = r.error; return; }
  $('auth-overlay').classList.add('hidden');
  showApp('home');
};
window.doRegister = () => {
  const email = $('r-email').value.trim();
  const password = $('r-pass').value;
  const fullName = $('r-name').value.trim();
  const phone = $('r-phone').value.trim();
  const cedula = $('r-cedula').value.trim();
  if (!email || !password || !fullName || !phone || !cedula) { $('auth-err').textContent = 'Completa todos los campos'; return; }
  const r = register({ email, password, fullName, phone, cedula });
  if (r.error) { $('auth-err').textContent = r.error; return; }
  $('auth-overlay').classList.add('hidden');
  showApp('home');
};

// ── ALERTS ───────────────────────────────────────────────────
function showAlert(msg, type) {
  const a = $('global-alert');
  a.textContent = msg;
  a.className = `alert alert-${type === 'success' ? 'success' : 'error'}`;
  a.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:600;animation:fadein .3s';
  a.classList.remove('hidden');
  setTimeout(() => a.classList.add('hidden'), 3000);
}

// ── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (currentUser) { showApp('home'); } else { showLanding(); }
  // apply form init when page shown
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
window.showLoanDetail = showLoanDetail;
window.showPage = showPage;
window.logout = logout;
window.showApp = showApp;
