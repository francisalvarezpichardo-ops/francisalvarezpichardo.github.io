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
const curSym  = code => (CURRENCIES.find(c => c.code === code) || {}).sym  || '$';
const curFlag = code => (CURRENCIES.find(c => c.code === code) || {}).flag || '🌐';

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

// ══════════════════════════════════════════════════════════════
// ── ADVANCED CREDIT SCORING ENGINE ────────────────────────────
// ══════════════════════════════════════════════════════════════

function calculateAge(birthDateStr) {
  if (!birthDateStr) return NaN;
  const birth = new Date(birthDateStr);
  if (isNaN(birth)) return NaN;
  return Math.floor((Date.now() - birth) / (365.25 * 24 * 3600 * 1000));
}

function checkOverdueLoans() {
  if (!currentUser) return false;
  const loans = DB.filter('loans', l => l.userId === currentUser.id && l.status === 'overdue');
  return loans.length > 0;
}

function checkCooldown() {
  if (!currentUser) return null;
  const key = 'rejection_cooldown_' + currentUser.id;
  const cooldown = DB.get(key);
  if (!cooldown) return null;
  const daysPassed = (Date.now() - new Date(cooldown.rejectedAt)) / (1000 * 3600 * 24);
  if (daysPassed < 30) return Math.ceil(30 - daysPassed);
  DB.set(key, null); // expired
  return null;
}

function getTrustBonus() {
  if (!currentUser) return 0;
  const loans = DB.filter('loans', l => l.userId === currentUser.id);
  const paidOff = loans.filter(l => l.status === 'paid').length;
  if (paidOff >= 3) return 80;
  if (paidOff >= 2) return 55;
  if (paidOff >= 1) return 30;
  return 0;
}

/**
 * Advanced multi-factor credit scoring engine.
 * Returns: { score, hardRejects, warnings, approved, interestRate, riskTier, dti, incomeRatio, trustBonus }
 */
function advancedCreditScore({ monthlyIncome, debtLevel, employmentYears, amount, termMonths, age, purpose, dependents, occupationType }) {
  const hardRejects = [];
  const warnings    = [];

  // ─── FASE 1 / IDENTIDAD: Edad ───────────────────────────
  if (isNaN(age) || age < 18)
    hardRejects.push({ phase: 1, code: 'AGE_LOW', reason: 'Edad mínima requerida: 18 años.' });
  if (age > 70)
    hardRejects.push({ phase: 1, code: 'AGE_HIGH', reason: 'Edad máxima permitida: 70 años.' });

  // ─── FASE 2 / CAPACIDAD DE PAGO ─────────────────────────
  const income = monthlyIncome || 0;
  const debt   = debtLevel || 0;
  if (!income || income < 500)
    hardRejects.push({ phase: 2, code: 'INCOME_LOW', reason: 'Ingreso mensual mínimo requerido: $500.00.' });

  const dti = income > 0 ? (debt / income) * 100 : 999;
  if (dti > 55)
    hardRejects.push({ phase: 2, code: 'DTI_CRITICAL', reason: `Índice Deuda/Ingreso (DTI) crítico: ${dti.toFixed(1)}%. Máximo permitido: 55%.` });
  else if (dti > 40)
    warnings.push('DTI elevado (' + dti.toFixed(1) + '%). Se recomienda reducir deudas existentes antes de solicitar.');
  else if (dti > 25)
    warnings.push('DTI moderado (' + dti.toFixed(1) + '%). Considere reducir sus obligaciones financieras.');

  // ─── FASE 3 / HISTORIAL CREDITICIO ──────────────────────
  // (overdue loans handled separately in buildVerificationPhases)

  // ─── FASE 4 / ESTABILIDAD LABORAL ───────────────────────
  const empYears = employmentYears || 0;
  if (empYears < 0.5 && amount > 3000)
    hardRejects.push({ phase: 4, code: 'EMP_TOO_SHORT', reason: 'Mínimo 6 meses de antigüedad laboral para préstamos superiores a $3,000.' });
  else if (empYears < 1)
    warnings.push('Antigüedad laboral menor a 12 meses. Factor de riesgo aplicado.');

  const incomeRatio = income > 0 ? amount / income : 999;
  if (incomeRatio > 10)
    hardRejects.push({ phase: 4, code: 'RATIO_CRITICAL', reason: `Monto solicitado (${incomeRatio.toFixed(1)}x ingreso mensual) supera el límite máximo de 10x.` });
  else if (incomeRatio > 6)
    warnings.push(`Monto solicitado alto en relación al ingreso mensual (${incomeRatio.toFixed(1)}x). Puede afectar la tasa.`);

  if (dependents >= 4)
    warnings.push(`${dependents} dependientes declarados. Factor de carga familiar considerado.`);

  // ─── TRUST BONUS (Historial positivo FJAP) ───────────────
  const trustBonus = getTrustBonus();

  // ─── PUNTAJE BASE ────────────────────────────────────────
  let score = 330 + trustBonus;

  // Ingresos (hasta +180)
  score += Math.min(180, (income / 5000) * 160);

  // DTI (hasta +140) — menor DTI = más puntos
  score += dti < 8  ? 140 :
           dti < 15 ? 115 :
           dti < 25 ? 85  :
           dti < 35 ? 50  :
           dti < 45 ? 20  : 5;

  // Estabilidad laboral (hasta +95)
  score += Math.min(95, empYears * 24);

  // Relación monto/ingreso-término (hasta +110)
  const ltv = amount / (income * termMonths || 1);
  score += ltv < 0.25 ? 110 :
           ltv < 0.45 ? 85  :
           ltv < 0.70 ? 60  :
           ltv < 1.1  ? 30  : 8;

  // Propósito (bonus/penalización)
  const purposeAdj = { negocio: 28, vehiculo: 18, hogar: 22, deudas: -18, otros: 0 };
  score += purposeAdj[purpose] || 0;

  // Ocupación (bonus)
  const occupationAdj = { empresario: 20, independiente: 5, empleado: 10, jubilado: 15, otro: 0 };
  score += occupationAdj[occupationType] || 0;

  // Dependientes (penalización)
  score -= Math.min(50, (dependents || 0) * 9);

  // Clamp 200–900
  score = Math.round(Math.min(900, Math.max(200, score)));

  // ─── DECISIÓN FINAL ──────────────────────────────────────
  let approved     = hardRejects.length === 0;
  let interestRate = null;
  let riskTier     = null;

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

/**
 * Builds the ordered list of verification phase objects from scoring results.
 */
function buildVerificationPhases(params, scoringResult) {
  const { hardRejects, warnings, score, dti, incomeRatio, approved, interestRate, riskTier, trustBonus } = scoringResult;
  const findReject = phase => hardRejects.find(r => r.phase === phase);
  const hasWarn    = (...keys) => warnings.some(w => keys.some(k => w.toLowerCase().includes(k)));

  const phases = [];
  let blocked = false;

  // ── FASE 1: Verificación de Identidad ───────────────────
  const r1 = findReject(1);
  phases.push({
    icon: '🪪', label: 'Verificación de Identidad',
    subtext: 'Cédula, edad, dirección residencial',
    duration: 1900,
    status: r1 ? 'fail' : 'pass',
    resultText: r1 ? r1.reason : `Identidad confirmada · Edad válida: ${params.age} años`,
    hardFail: !!r1,
  });
  if (r1) blocked = true;

  // ── FASE 2: Capacidad de Pago ────────────────────────────
  const r2 = blocked ? null : findReject(2);
  const dtiWarn = !blocked && !r2 && dti >= 25;
  phases.push({
    icon: '💰', label: 'Capacidad de Pago',
    subtext: 'Ingresos, deudas activas, índice DTI',
    duration: 2300,
    status: blocked ? 'skipped' : r2 ? 'fail' : dtiWarn ? 'warning' : 'pass',
    resultText: blocked ? 'No evaluado'
      : r2 ? r2.reason
      : dtiWarn ? `DTI: ${dti}% — observación registrada`
      : `DTI: ${dti}% ✓ · Ingresos verificados`,
    hardFail: !blocked && !!r2,
  });
  if (!blocked && r2) blocked = true;

  // ── FASE 3: Historial Crediticio FJAP ───────────────────
  const hasOverdue = !blocked && checkOverdueLoans();
  phases.push({
    icon: '📋', label: 'Historial Crediticio FJAP',
    subtext: 'Comportamiento previo, morosidades, puntos de confianza',
    duration: 2100,
    status: blocked ? 'skipped' : hasOverdue ? 'fail' : trustBonus > 0 ? 'pass' : 'pass',
    resultText: blocked ? 'No evaluado'
      : hasOverdue ? 'Préstamo vencido activo detectado — solicitud bloqueada'
      : trustBonus > 0 ? `Sin incidentes · Bono de confianza +${trustBonus} pts aplicado ✦`
      : 'Sin historial previo · Perfil limpio',
    hardFail: !blocked && hasOverdue,
  });
  if (!blocked && hasOverdue) blocked = true;

  // ── FASE 4: Estabilidad Laboral ──────────────────────────
  const r4 = blocked ? null : findReject(4);
  const empWarn = !blocked && !r4 && hasWarn('antigüedad', 'laboral', 'empleo', 'meses');
  phases.push({
    icon: '💼', label: 'Estabilidad Laboral',
    subtext: 'Empleador, antigüedad, tipo de ocupación',
    duration: 1700,
    status: blocked ? 'skipped' : r4 ? 'fail' : empWarn ? 'warning' : 'pass',
    resultText: blocked ? 'No evaluado'
      : r4 ? r4.reason
      : empWarn ? `Antigüedad ${params.employmentYears} año(s) — condición aplicada`
      : `Estabilidad confirmada · ${params.employmentYears} año(s) en el empleo`,
    hardFail: !blocked && !!r4,
  });
  if (!blocked && r4) blocked = true;

  // ── FASE 5: Motor de Riesgo IA ───────────────────────────
  const scoreInsuff = !blocked && score < 550;
  phases.push({
    icon: '🤖', label: 'Motor de Riesgo IA',
    subtext: 'Análisis predictivo · 22 variables financieras',
    duration: 3100,
    status: blocked ? 'skipped' : scoreInsuff ? 'fail' : score < 650 ? 'warning' : 'pass',
    resultText: blocked ? 'No evaluado'
      : scoreInsuff ? `Score FJAP insuficiente: ${score} pts (mínimo: 550)`
      : `Score FJAP: ${score} pts · Tier ${riskTier}`,
    hardFail: !blocked && scoreInsuff,
  });
  if (!blocked && scoreInsuff) blocked = true;

  // ── FASE 6: Decisión Final del Comité ───────────────────
  phases.push({
    icon: '⚖️', label: 'Decisión del Comité de Crédito',
    subtext: 'Resolución definitiva del expediente',
    duration: 2000,
    status: blocked ? 'fail' : 'pass',
    resultText: blocked
      ? 'Solicitud denegada — criterios de calificación no cumplidos'
      : `Aprobado · Tasa asignada ${interestRate}% anual · Nivel ${riskTier}`,
    hardFail: false,
  });

  return phases;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function animatePhases(phases) {
  const list = $('verify-phases-list');
  list.innerHTML = '';

  // Render all rows as "pending"
  phases.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'vphase-item';
    row.id = 'vphase-' + i;
    row.innerHTML = `
      <div class="vphase-status-wrap">
        <div class="vphase-status pending" id="vstatus-${i}"><span class="vphase-dot"></span></div>
      </div>
      <div class="vphase-icon-wrap">${p.icon}</div>
      <div class="vphase-body">
        <div class="vphase-label">${p.label}</div>
        <div class="vphase-sub" id="vsub-${i}">${p.subtext}</div>
      </div>
      <div class="vphase-badge hidden" id="vbadge-${i}"></div>`;
    list.appendChild(row);
  });

  let firstFail = false;

  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];

    if (p.status === 'skipped') {
      setPhaseSkipped(i);
      continue;
    }

    // Running state
    const statusEl = $('vstatus-' + i);
    statusEl.className = 'vphase-status running';
    statusEl.innerHTML = '<div class="vphase-spin"></div>';
    $('vphase-' + i).classList.add('active');
    $('vphase-' + i).scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    await sleep(p.duration);

    // Final state
    const icons  = { pass: '✓', warning: '⚠', fail: '✗' };
    statusEl.className = `vphase-status ${p.status}`;
    statusEl.innerHTML = `<span>${icons[p.status]}</span>`;
    $('vphase-' + i).classList.remove('active');
    $('vphase-' + i).classList.add('done');

    const badge = $('vbadge-' + i);
    badge.textContent = p.resultText;
    badge.className = `vphase-badge ${p.status}`;
    badge.classList.remove('hidden');

    await sleep(250);

    if (p.hardFail && !firstFail) {
      firstFail = true;
      await sleep(300);
      for (let j = i + 1; j < phases.length; j++) {
        setPhaseSkipped(j);
        await sleep(80);
      }
      break;
    }
  }
}

function setPhaseSkipped(i) {
  const s = $('vstatus-' + i);
  if (s) { s.className = 'vphase-status skipped'; s.innerHTML = '<span>—</span>'; }
  const b = $('vbadge-' + i);
  if (b) { b.textContent = 'No evaluado'; b.className = 'vphase-badge skipped'; b.classList.remove('hidden'); }
}

function showVerificationResult(scoringResult) {
  const resEl = $('verify-result');
  if (!resEl) return;

  const { approved, score, interestRate, riskTier, hardRejects, warnings, trustBonus } = scoringResult;
  const monthly = approved ? calcMonthly(applyAmount, interestRate, applyTerm) : 0;

  const scoreColor = score >= 750 ? '#34d399' : score >= 650 ? '#f59e0b' : score >= 550 ? '#fb923c' : '#f87171';
  const pct = Math.max(0, Math.min(1, (score - 200) / 700));
  const circumference = 2 * Math.PI * 50;
  const initialOffset = circumference; // starts full, animates down
  const targetOffset  = +(circumference * (1 - pct)).toFixed(1);

  const tierDesc = { AAA: 'Riesgo Mínimo', AA: 'Riesgo Muy Bajo', A: 'Riesgo Bajo', B: 'Riesgo Moderado', C: 'Riesgo Alto', D: 'No Califica' };

  if (approved) {
    resEl.innerHTML = `
      <div class="vresult approved">
        <div class="vresult-icon-big">✅</div>
        <h3 class="vresult-title">¡Préstamo Pre-Aprobado!</h3>
        <p class="vresult-subtitle">Tu solicitud ha sido aprobada por el Comité de Crédito FJAP</p>

        <div class="score-ring-wrap">
          <svg viewBox="0 0 120 120" class="score-ring-svg" width="130" height="130">
            <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="9"/>
            <circle class="score-ring-progress" cx="60" cy="60" r="50" fill="none"
              stroke="${scoreColor}" stroke-width="9" stroke-linecap="round"
              stroke-dasharray="${circumference}" stroke-dashoffset="${initialOffset}"
              transform="rotate(-90 60 60)" style="transition:stroke-dashoffset 1.6s cubic-bezier(.4,0,.2,1)"/>
          </svg>
          <div class="score-ring-inner">
            <div class="score-ring-num" style="color:${scoreColor}">${score}</div>
            <div class="score-ring-lbl">Score FJAP</div>
          </div>
        </div>

        <div class="vresult-grid">
          <div class="vresult-cell"><div class="vc-label">Tasa Anual</div><div class="vc-val gold">${interestRate}%</div></div>
          <div class="vresult-cell"><div class="vc-label">Nivel de Riesgo</div><div class="vc-val">Tier ${riskTier}</div></div>
          <div class="vresult-cell"><div class="vc-label">Clasificación</div><div class="vc-val">${tierDesc[riskTier] || ''}</div></div>
          <div class="vresult-cell"><div class="vc-label">Cuota Est.</div><div class="vc-val gold">${curSym(selectedCurrency)}${monthly.toFixed(2)}</div></div>
        </div>

        ${trustBonus > 0 ? `<div class="trust-bonus-badge">✦ Bono de Cliente Fiel: +${trustBonus} puntos aplicados</div>` : ''}

        ${warnings.length ? `
          <div class="vresult-warnings">
            <div class="vw-title">⚠ Observaciones del Comité</div>
            ${warnings.map(w => `<div class="vw-item">· ${w}</div>`).join('')}
          </div>` : ''}

        <p class="vresult-note">Confirma tu préstamo para recibir los fondos en tu billetera virtual.</p>
      </div>`;

    // Animate the ring after DOM paint
    setTimeout(() => {
      const ring = resEl.querySelector('.score-ring-progress');
      if (ring) ring.style.strokeDashoffset = targetOffset;
    }, 80);

  } else {
    const reason = hardRejects.length ? hardRejects[0].reason : 'Score crediticio insuficiente para calificar.';
    const rejectCode = hardRejects.length ? hardRejects[0].code : 'SCORE_LOW';

    // Save 30-day cooldown
    DB.set('rejection_cooldown_' + currentUser.id, {
      userId: currentUser.id,
      rejectedAt: new Date().toISOString(),
      reason, code: rejectCode
    });

    resEl.innerHTML = `
      <div class="vresult rejected">
        <div class="vresult-icon-big">❌</div>
        <h3 class="vresult-title">Solicitud No Aprobada</h3>
        <p class="vresult-subtitle">El comité de crédito no pudo aprobar tu solicitud en este momento</p>

        <div class="score-ring-wrap">
          <svg viewBox="0 0 120 120" class="score-ring-svg" width="130" height="130">
            <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="9"/>
            <circle class="score-ring-progress" cx="60" cy="60" r="50" fill="none"
              stroke="#f87171" stroke-width="9" stroke-linecap="round"
              stroke-dasharray="${circumference}" stroke-dashoffset="${initialOffset}"
              transform="rotate(-90 60 60)" style="transition:stroke-dashoffset 1.6s cubic-bezier(.4,0,.2,1)"/>
          </svg>
          <div class="score-ring-inner">
            <div class="score-ring-num" style="color:#f87171">${score}</div>
            <div class="score-ring-lbl">Score FJAP</div>
          </div>
        </div>

        <div class="reject-reason-box">
          <div class="rrb-title">🚫 Motivo Principal</div>
          <div class="rrb-text">${reason}</div>
          <div class="rrb-code">Código: ${rejectCode}</div>
        </div>

        <div class="vresult-grid">
          <div class="vresult-cell"><div class="vc-label">Score Obtenido</div><div class="vc-val" style="color:#f87171">${score}</div></div>
          <div class="vresult-cell"><div class="vc-label">Mínimo Requerido</div><div class="vc-val">550 pts</div></div>
          <div class="vresult-cell"><div class="vc-label">Nivel Asignado</div><div class="vc-val" style="color:#f87171">Tier D</div></div>
          <div class="vresult-cell"><div class="vc-label">Próxima Solicitud</div><div class="vc-val">30 días</div></div>
        </div>

        <div class="reject-tips">
          <div class="rt-title">💡 Cómo mejorar tu perfil para la próxima solicitud:</div>
          <div class="rt-item">• Reduce tus deudas actuales para bajar el índice DTI</div>
          <div class="rt-item">• Aumenta tu antigüedad laboral (mínimo 12 meses)</div>
          <div class="rt-item">• Solicita un monto menor acorde a tu ingreso</div>
          <div class="rt-item">• Mantén un ingreso mensual estable y documentado</div>
        </div>

        <p class="vresult-note" style="color:#f87171">⏳ Podrás volver a solicitar en 30 días.</p>
      </div>`;

    setTimeout(() => {
      const ring = resEl.querySelector('.score-ring-progress');
      if (ring) ring.style.strokeDashoffset = targetOffset;
    }, 80);
  }

  resEl.classList.remove('hidden');

  // Show/hide submit button
  const submitBtn = $('btn-submit');
  if (submitBtn) submitBtn.style.display = approved ? '' : 'none';

  // Update header
  const titleEl = $('verify-title');
  const subEl   = $('verify-subtitle');
  const spinWrap = $('verify-spinner-wrap');
  if (titleEl) titleEl.textContent = approved ? 'Evaluación Completada' : 'Evaluación Finalizada';
  if (subEl) subEl.textContent = approved ? 'Tu perfil ha sido aprobado' : 'Tu solicitud no fue aprobada';
  if (spinWrap) spinWrap.innerHTML = approved
    ? '<div class="verify-done-ring">✓</div>'
    : '<div class="verify-fail-ring">✗</div>';
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

// ── LOAN VALIDATION ─────────────────────────────────────────
function validateStep1() {
  const birthDate = $('f-birthDate')?.value;
  const address   = ($('f-address')?.value || '').trim();
  const cedula    = ($('f-cedula')?.value  || '').replace(/\D/g, '');

  if (!birthDate) return 'La fecha de nacimiento es requerida.';
  const age = calculateAge(birthDate);
  if (isNaN(age) || age < 18) return 'Debes tener al menos 18 años para solicitar un préstamo.';
  if (age > 70) return 'La edad máxima permitida es 70 años.';

  if (!cedula)         return 'La cédula / documento de identidad es requerido.';
  if (cedula.length < 6)  return 'La cédula debe tener al menos 6 dígitos.';
  if (cedula.length > 11) return 'La cédula no puede superar los 11 dígitos.';

  if (address.length < 5) return 'La dirección residencial completa es requerida (mínimo 5 caracteres).';
  return null;
}

function validateStep2() {
  const income    = +($('f-income')?.value || 0);
  const debt      = +($('f-debt')?.value || 0);
  const employer  = ($('f-employer')?.value || '').trim();
  const empYears  = $('f-empyears')?.value;
  const ref1name  = ($('f-ref1name')?.value || '').trim();
  const ref1phone = ($('f-ref1phone')?.value || '').replace(/\D/g, '');
  const ref2name  = ($('f-ref2name')?.value || '').trim();
  const ref2phone = ($('f-ref2phone')?.value || '').replace(/\D/g, '');

  if (!income || income <= 0) return 'El ingreso mensual es requerido.';
  if (income < 200)           return 'El ingreso mínimo aceptable es de $200.00 mensuales.';
  if (debt < 0)               return 'El monto de deuda no puede ser negativo.';
  if (debt >= income)         return 'Tu deuda mensual no puede ser igual o mayor a tu ingreso mensual.';
  if (employer.length < 2)    return 'El nombre del empleador / empresa es requerido.';
  if (empYears === '' || empYears === null || empYears === undefined) return 'Los años de empleo son requeridos.';
  if (+empYears < 0)          return 'Los años de empleo no pueden ser negativos.';

  if (ref1name.length < 3)    return 'El nombre de la Referencia Personal 1 es requerido.';
  if (!ref1phone)             return 'El teléfono de la Referencia Personal 1 es requerido.';
  if (ref1phone.length < 7)   return 'El teléfono de la Referencia 1 debe tener al menos 7 dígitos.';
  if (ref1phone.length > 10)  return 'El teléfono de la Referencia 1 no puede superar los 10 dígitos.';

  if (ref2name.length < 3)    return 'El nombre de la Referencia Personal 2 es requerido.';
  if (!ref2phone)             return 'El teléfono de la Referencia Personal 2 es requerido.';
  if (ref2phone.length < 7)   return 'El teléfono de la Referencia 2 debe tener al menos 7 dígitos.';
  if (ref2phone.length > 10)  return 'El teléfono de la Referencia 2 no puede superar los 10 dígitos.';

  return null;
}

function validateStep3() {
  if (!applyAmount || applyAmount < 100) return 'El monto del préstamo debe ser al menos $100.';
  if (!applyTerm   || applyTerm   < 1  ) return 'El plazo mínimo es 1 mes.';
  return null;
}

function showStepError(msg) {
  let errEl = $('step-error-msg');
  if (!errEl) {
    errEl = document.createElement('div');
    errEl.id = 'step-error-msg';
    errEl.className = 'step-error-banner';
    const card = document.querySelector('#page-apply .card');
    if (card) card.insertBefore(errEl, card.firstChild);
  }
  errEl.textContent = '⚠ ' + msg;
  errEl.style.display = 'block';
  errEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setTimeout(() => { if (errEl) errEl.style.display = 'none'; }, 5000);
}

// ── LOAN OPERATIONS ─────────────────────────────────────────
function createLoan(data) {
  const rate     = data.interestRate || 15.5;
  const monthly  = calcMonthly(data.amount, rate, data.termMonths);
  const total    = monthly * data.termMonths;
  const inv      = 'FJAP-' + Date.now();
  const approved = data.approved !== false;

  const loan = {
    id: DB.nextId('loan'), userId: currentUser.id,
    amount: data.amount, termMonths: data.termMonths,
    interestRate: rate,
    paymentType: data.paymentType,
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
    occupationType: data.occupationType || 'empleado',
    reference1Name: data.reference1Name || null,
    reference1Phone: data.reference1Phone || null,
    reference2Name: data.reference2Name || null,
    reference2Phone: data.reference2Phone || null,
    invoiceNumber: inv,
    creditScore: data.creditScore,
    riskTier: data.riskTier,
    approvedAt: approved ? new Date().toISOString() : null,
    createdAt: new Date().toISOString()
  };
  DB.push('loans', loan);

  if (approved) {
    const users = DB.get('users') || [];
    const idx   = users.findIndex(u => u.id === currentUser.id);
    if (idx !== -1) {
      users[idx].creditScore = data.creditScore;
      DB.set('users', users);
      currentUser = users[idx];
      DB.set('session', currentUser);
    }
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
const fmtDate  = iso => new Date(iso).toLocaleDateString('es', { day:'2-digit', month:'short', year:'numeric' });
const fmtMoney = (n, currency) => `${curSym(currency || 'USD')}${Number(n).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
  const loans  = DB.filter('loans', l => l.userId === currentUser.id);
  const wallet = getWallet() || { balance: 0, currency: 'USD' };
  const active = loans.filter(l => l.status === 'approved' || l.status === 'active').length;
  const score  = currentUser.creditScore;
  $('stat-balance').textContent = fmtMoney(wallet.balance, wallet.currency);
  $('stat-loans').textContent   = loans.length;
  $('stat-active').textContent  = active;
  $('stat-score').textContent   = score ? score : '—';

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
  const grid  = $('loans-grid');
  if (!loans.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="icon">💳</div><h3>Aún no tienes préstamos</h3><p>Solicita tu primer préstamo ahora. Nuestro sistema de IA evaluará tu solicitud en segundos.</p><button class="btn btn-gold btn-lg" onclick="showPage('apply')">✦ Solicitar mi primer préstamo</button></div>`;
    return;
  }
  grid.innerHTML = loans.map(l => loanCardHTML(l)).join('');
}
function loanCardHTML(l) {
  const sym  = curSym(l.currency);
  const flag = curFlag(l.currency);
  return `
  <div class="loan-card">
    <div class="loan-card-head">
      <div>
        <div class="loan-id">ID: #${l.id}</div>
        ${statusBadge(l.status)} ${l.riskTier ? tierBadge(l.riskTier) : ''}
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
  const sym     = curSym(loan.currency);
  const amort   = buildAmortization(loan.amount, loan.interestRate, loan.termMonths);
  const container = $('page-loan-detail');

  const purposeMap = { negocio:'Inversión Negocio', vehiculo:'Vehículo', hogar:'Remodelación Hogar', deudas:'Consolidar Deudas', otros:'Otros' };
  const payMap     = { monthly:'Mensual', biweekly:'Quincenal', weekly:'Semanal' };
  const amortMap   = { french:'Francés (Cuota Fija)', german:'Alemán (Capital Fijo)', american:'Americano' };

  container.innerHTML = `
    <div class="page-header">
      <div>
        <button class="btn btn-ghost btn-sm" onclick="showPage('loans')">← Mis Préstamos</button>
        <div class="page-title" style="margin-top:12px"><span class="icon">📋</span> Préstamo #${loan.id}</div>
        <div style="margin-top:6px">${statusBadge(loan.status)} ${loan.riskTier ? tierBadge(loan.riskTier) : ''} <span class="badge badge-zinc" style="margin-left:4px">${curFlag(loan.currency)} ${loan.currency}</span></div>
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
      <div class="meta-item"><div class="dt">Tier de Riesgo</div><div class="dd">${loan.riskTier || '—'}</div></div>
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

// ══════════════════════════════════════════════════════════════
// ── APPLY FORM ─────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
let applyStep = 1;
let applyData = {};
let selectedCurrency = 'USD';
let applyAmount = 5000;
let applyTerm   = 12;
let lastScoringResult = null;

function initApplyForm() {
  // Check cooldown
  const coolDays = checkCooldown();
  if (coolDays) {
    showAlert(`⏳ Tu solicitud fue rechazada recientemente. Podrás aplicar en ${coolDays} día(s).`, 'error');
    showPage('loans');
    return;
  }

  applyStep = 1; applyData = {}; selectedCurrency = 'USD'; applyAmount = 5000; applyTerm = 12;
  lastScoringResult = null;

  // Reset verification UI
  const phaseList = $('verify-phases-list');
  if (phaseList) phaseList.innerHTML = '';
  const resEl = $('verify-result');
  if (resEl) resEl.classList.add('hidden');
  const spinWrap = $('verify-spinner-wrap');
  if (spinWrap) spinWrap.innerHTML = '<div class="spin-ring"></div>';
  const titleEl = $('verify-title');
  if (titleEl) titleEl.textContent = 'Analizando tu Solicitud...';
  const subEl = $('verify-subtitle');
  if (subEl) subEl.textContent = 'Por favor no cierres esta ventana';
  const trackEl = $('verify-tracking');
  if (trackEl) trackEl.classList.add('hidden');

  updateStepUI();
  renderCurrencyPicker();
  updateAmountDisplay();

  // Pre-fill cedula from user profile
  const cedulaField = $('f-cedula');
  if (cedulaField && currentUser?.cedula) {
    cedulaField.value = currentUser.cedula.replace(/\D/g, '').slice(0, 11);
  }

  const amtSlider = $('amt-slider');
  if (amtSlider) amtSlider.addEventListener('input', e => { applyAmount = +e.target.value; updateAmountDisplay(); });
  const termSlider = $('term-slider');
  if (termSlider) termSlider.addEventListener('input', e => { applyTerm = +e.target.value; $('term-val').textContent = e.target.value; });
}

function updateAmountDisplay() {
  const sym = curSym(selectedCurrency);
  const elAmt = $('amount-big');
  if (elAmt) elAmt.innerHTML = `<span class="amount-sym">${sym}</span>${Number(applyAmount).toLocaleString('es')}`;
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
    const dot  = $('sdot-' + i);
    const line = $('sline-' + i);
    if (dot)  dot.className  = `step-dot ${i < applyStep ? 'done' : i === applyStep ? 'current' : 'pending'}`;
    if (line) line.className = `step-line ${i < applyStep ? 'done' : 'pending'}`;
    const panel = $('spanel-' + i);
    if (panel) panel.className = `step-panel ${i === applyStep ? 'active' : ''}`;
  }
  const backBtn   = $('btn-back');
  const nextBtn   = $('btn-next');
  const submitBtn = $('btn-submit');
  if (backBtn)   backBtn.style.display   = applyStep > 1 && applyStep < 4 ? '' : 'none';
  if (nextBtn)   nextBtn.style.display   = applyStep < 4 ? '' : 'none';
  if (nextBtn)   nextBtn.textContent     = applyStep < 3 ? 'Continuar →' : '⚡ Evaluar Perfil';
  if (submitBtn) submitBtn.style.display = 'none'; // controlled by showVerificationResult
}

function collectStep3() {
  applyData.amount          = applyAmount;
  applyData.termMonths      = applyTerm;
  applyData.paymentType     = $('sel-payment')?.value  || 'monthly';
  applyData.amortizationType = $('sel-amort')?.value   || 'french';
  applyData.purpose         = $('sel-purpose')?.value  || 'otros';
  applyData.currency        = selectedCurrency;
}

window.applyNext = async () => {
  // ── Validate current step before advancing ──
  if (applyStep === 1) {
    const err = validateStep1();
    if (err) { showStepError(err); return; }
  }
  if (applyStep === 2) {
    const err = validateStep2();
    if (err) { showStepError(err); return; }
  }
  if (applyStep === 3) {
    const err = validateStep3();
    if (err) { showStepError(err); return; }
  }

  // ── Advance steps 1→2 and 2→3 ──
  if (applyStep < 3) {
    applyStep++;
    updateStepUI();
    return;
  }

  // ── Step 3 → 4: RUN VERIFICATION ──────────────────────────
  if (applyStep === 3) {
    collectStep3();

    // Build params from form
    const params = {
      monthlyIncome:   +($('f-income')?.value     || 0),
      debtLevel:       +($('f-debt')?.value        || 0),
      employmentYears: +($('f-empyears')?.value    || 0),
      amount:          applyAmount,
      termMonths:      applyTerm,
      age:             calculateAge($('f-birthDate')?.value),
      purpose:         $('sel-purpose')?.value     || 'otros',
      dependents:      +($('f-dependents')?.value  || 0),
      occupationType:  $('f-occupation')?.value    || 'empleado',
    };

    // Run scoring
    const scoringResult = advancedCreditScore(params);
    lastScoringResult   = scoringResult;

    // Build verification phases
    const phases = buildVerificationPhases(params, scoringResult);

    // Show step 4
    applyStep = 4;
    updateStepUI();

    // Set verification tracking code
    const trackCode = 'EXP-' + Date.now().toString(36).toUpperCase().slice(-8);
    const trackEl   = $('verify-tracking');
    const codeEl    = $('verify-code');
    if (codeEl)  codeEl.textContent = trackCode;
    if (trackEl) trackEl.classList.remove('hidden');

    // Animate phases
    await animatePhases(phases);

    // Small pause then show result
    await sleep(600);
    showVerificationResult(scoringResult);
  }
};

window.applyBack = () => { if (applyStep > 1 && applyStep < 4) { applyStep--; updateStepUI(); } };

window.submitLoan = () => {
  if (!lastScoringResult || !lastScoringResult.approved) {
    showAlert('Esta solicitud no está aprobada.', 'error');
    return;
  }
  const d = {
    ...applyData,
    birthDate:      $('f-birthDate')?.value       || '',
    maritalStatus:  $('f-marital')?.value         || 'single',
    address:        $('f-address')?.value         || '',
    dependents:     +($('f-dependents')?.value    || 0),
    monthlyIncome:  +($('f-income')?.value        || 0),
    debtLevel:      +($('f-debt')?.value          || 0),
    employer:       $('f-employer')?.value        || '',
    employmentYears: +($('f-empyears')?.value     || 0),
    occupationType: $('f-occupation')?.value      || 'empleado',
    reference1Name:  $('f-ref1name')?.value       || '',
    reference1Phone: $('f-ref1phone')?.value      || '',
    reference2Name:  $('f-ref2name')?.value       || '',
    reference2Phone: $('f-ref2phone')?.value      || '',
    creditScore:    lastScoringResult.score,
    riskTier:       lastScoringResult.riskTier,
    interestRate:   lastScoringResult.interestRate,
    approved:       true,
  };
  const loan = createLoan(d);
  showAlert('🎉 ¡Préstamo aprobado! Fondos acreditados en tu billetera.', 'success');
  setTimeout(() => { showLoanDetail(loan.id); }, 900);
};

// ── WALLET ───────────────────────────────────────────────────
function renderWallet() {
  const wallet = getWallet() || { balance: 0, currency: 'USD' };
  const txs    = DB.filter('transactions', t => t.walletId === wallet.id)
    .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

  $('wallet-balance').textContent  = fmtMoney(wallet.balance, wallet.currency);
  $('wallet-currency').textContent = `${curFlag(wallet.currency)} ${wallet.currency}`;

  const list = $('tx-list');
  if (!txs.length) {
    list.innerHTML = `<div class="empty"><div class="icon">💸</div><h3>Sin movimientos</h3><p>Realiza tu primer depósito o solicita un préstamo</p></div>`;
    return;
  }
  const isIn     = t => ['deposit','transfer_in','loan_disbursement'].includes(t.type);
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

let walletAction = 'deposit';
window.openWalletModal = (action) => {
  walletAction = action;
  const title = { deposit:'Depositar Fondos', withdraw:'Retirar Fondos', transfer:'Transferir' };
  $('wallet-modal-title').textContent = title[action] || 'Operación';
  $('wallet-transfer-row').style.display = action === 'transfer' ? '' : 'none';
  $('wallet-modal-err').textContent = '';
  $('wallet-amount-input').value = '';
  $('wallet-desc-input').value   = '';
  if ($('wallet-recipient')) $('wallet-recipient').value = '';
  $('wallet-modal-overlay').classList.remove('hidden');
};
window.closeWalletModal = () => $('wallet-modal-overlay').classList.add('hidden');
window.submitWalletOp = () => {
  const amount  = +$('wallet-amount-input').value;
  const desc    = $('wallet-desc-input').value;
  const errEl   = $('wallet-modal-err');
  if (!amount || amount <= 0) { errEl.textContent = 'Ingresa un monto válido'; return; }
  if (walletAction === 'deposit') {
    deposit(amount, desc);
    closeWalletModal(); renderWallet();
    showAlert('Depósito realizado con éxito', 'success');
  } else if (walletAction === 'withdraw') {
    const ok = withdraw(amount, desc);
    if (!ok) { errEl.textContent = 'Saldo insuficiente'; return; }
    closeWalletModal(); renderWallet();
    showAlert('Retiro realizado con éxito', 'success');
  } else if (walletAction === 'transfer') {
    const email = $('wallet-recipient')?.value;
    if (!email) { errEl.textContent = 'Ingresa el email del destinatario'; return; }
    const result = transfer(amount, email, desc);
    if (result.error) { errEl.textContent = result.error; return; }
    closeWalletModal(); renderWallet();
    showAlert('Transferencia realizada con éxito', 'success');
  }
};

// ── INVOICE ───────────────────────────────────────────────────
window.showInvoice = (id) => {
  const loan = DB.find('loans', l => l.id === id);
  if (!loan) return;
  const sym  = curSym(loan.currency);
  const flag = curFlag(loan.currency);
  const purposeMap = { negocio:'Inversión en Negocio', vehiculo:'Vehículo', hogar:'Remodelación Hogar', deudas:'Consolidar Deudas', otros:'Otros' };
  const payMap     = { monthly:'Mensual', biweekly:'Quincenal', weekly:'Semanal' };
  const amortMap   = { french:'Francés (Cuota Fija)', german:'Alemán (Capital Fijo)', american:'Americano' };
  const user  = currentUser;
  const now   = new Date().toLocaleDateString('es', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });

  $('invoice-body').innerHTML = `
    <div class="inv-header">
      <div><div class="inv-brand">FJAP <span>Préstamos</span></div><p style="color:#888;font-size:12px;margin-top:4px">Plataforma de Préstamos Personales<br>contacto@fjap.com</p></div>
      <div class="inv-num" style="text-align:right">
        <p style="font-size:11px;color:#888">Factura N°</p>
        <h2>${loan.invoiceNumber}</h2>
        <span style="display:inline-block;background:#d1fae5;color:#065f46;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;margin-top:4px">✓ Aprobado</span>
        <div style="margin-top:4px;font-size:12px;font-weight:700;color:#92400e">${loan.riskTier ? 'Tier ' + loan.riskTier : ''}</div>
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
        <p>Score IA: <span class="val" style="color:#059669">${loan.creditScore || '—'} pts</span></p>
        <p>Tier de Riesgo: <span class="val">${loan.riskTier || '—'}</span></p>
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
window.closeInvoice  = () => $('invoice-overlay').classList.add('hidden');
window.printInvoice  = () => {
  const body = $('invoice-body').innerHTML;
  const win  = window.open('', '_blank');
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
  const email    = $('l-email').value.trim();
  const password = $('l-pass').value;
  if (!email || !password) { $('auth-err').textContent = 'Completa todos los campos'; return; }
  const r = login({ email, password });
  if (r.error) { $('auth-err').textContent = r.error; return; }
  $('auth-overlay').classList.add('hidden');
  showApp('home');
};
window.doRegister = () => {
  const email    = $('r-email').value.trim();
  const password = $('r-pass').value;
  const fullName = $('r-name').value.trim();
  const phone    = $('r-phone').value.trim();
  const cedula   = $('r-cedula').value.trim();
  if (!email || !password || !fullName || !phone || !cedula) { $('auth-err').textContent = 'Completa todos los campos'; return; }
  if (password.length < 6) { $('auth-err').textContent = 'La contraseña debe tener mínimo 6 caracteres'; return; }
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
  a.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:600;animation:fadein .3s;max-width:380px';
  a.classList.remove('hidden');
  setTimeout(() => a.classList.add('hidden'), 4000);
}

// ── INIT ─────────────────────────────────────────────────────
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
window.showLoanDetail = showLoanDetail;
window.showPage       = showPage;
window.logout         = logout;
window.showApp        = showApp;
