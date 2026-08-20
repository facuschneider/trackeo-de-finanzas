/* ═══════════════════════════════════════════════════════════
   GASTOS FAMILIARES — Script principal (RESET COMPLETO)
   Arquitectura limpia y unificada.
   
   MODELO DE CUOTAS:
   Cada cuota tiene:
     - idx: número (1, 2, 3...)
     - status: 'PENDING' | 'PAID'
     - type: 'HISTORICAL' | 'REGULAR'
     - dueDate: YYYY-MM-DD
   
   El "tiempo" (vencida/actual/futura) NO se guarda,
   se calcula dinámicamente según la fecha de cierre.
   
   FÓRMULA DEL SALDO:
   saldo = ingresos - gastos - deducciones
   donde deducciones = cuotas que "cuentan" este ciclo
═══════════════════════════════════════════════════════════ */

// ─── CONFIG & CLIENTE SUPABASE ────────────────────────
const supabaseUrl = window.ENV.SUPABASE_URL;
const supabaseAnonKey = window.ENV.SUPABASE_ANON_KEY;
const supabaseDb = supabase.createClient(supabaseUrl, supabaseAnonKey);
window.supabase = supabaseDb;

const CATEGORY_LABELS = {
  'Alimentación': '🍽 Alimentación', 
  'Transporte': '🚌 Transporte',
  'Compras': '🛍 Compras', 
  'Departamento': '🏠 Departamento',
  'Ferretería': '🔧 Ferretería',
  'Servicios':    '🔧 Servicios',
  'Trabajo':      '💼 Trabajo',
  'Deporte':      '⚽ Deporte',
  'Salud':          '🏥 Salud',
  'Salidas':        '🎬 Salidas',
  'Suscripciones':  '📺 Suscripciones',
  'Otro': '📦 Otro',
};
const CARD_CLOSE_DAY = 15; // Día de cierre de todas las tarjetas
const EXTRA_INCOME_LABEL = '__extra__';

// ─── ESTADO GLOBAL ────────────────────────────────────
let expenses = [], incomes = [], cards = [], purchases = [];
let currentUserId = null;

let editingExpenseId = null, deletingExpenseId = null;
let editingPurchaseId = null, deletingPurchaseId = null;
let deletingCardId = null, editingIncomeId = null, deletingIncomeId = null;

// ─── REFERENCIAS DOM ──────────────────────────────────
const $ = id => document.getElementById(id);

// Incomes
const incomesListEl = $('incomes-list');
const newIncomeNameInput = $('new-income-name');
const newIncomeAmountInput = $('new-income-amount');
const addIncomeBtn = $('add-income');
const extraAmountInput = $('extra-amount');
const addExtraBtn = $('add-extra');
const extraSection = document.querySelector('.extra-money-section');
const incomeTableEl = $('income-table');
const incomeTypeFilterEl = $('income-type-filter');

// Expenses
const expenseTable = $('expense-table');
const categoryFilter = $('category-filter');
const addExpenseButton = $('add-expense');
const expenseName = $('expense-name'), expenseAmount = $('expense-amount');
const expenseCategory = $('expense-category'), expenseSource = $('expense-source');
const expenseDate = $('expense-date');

// Cards
const cardsListEl = $('cards-list');
const newCardNameInput = $('new-card-name');
const addCardBtn = $('add-card');

// Purchases
const purchaseNameInput = $('purchase-name');
const purchaseAmountInput = $('purchase-amount');
const purchaseInstallmentsInput = $('purchase-installments');
const purchaseStartFromInput = $('purchase-start-from');
const purchaseCardSelect = $('purchase-card');
const firstInstallmentDateInput = $('first-installment-date');
const addPurchaseBtn = $('add-purchase');
const installmentsListEl = $('installments-list');
const cardSummaryEl = $('card-summary');

// Balance
const totalBalanceEl = $('total-balance');
const headerBalanceWrap = $('header-balance-wrap');
const totalIncomesEl = $('total-incomes');
const totalExpensesPaidEl = $('total-expenses-paid');
const totalCurrentDeductionsEl = $('total-current-deductions');

const btnLogout = $('btn-logout');

/* ═══════════════════════════════════════════════════════════
   HELPERS GENÉRICOS
═══════════════════════════════════════════════════════════ */

function showToast(message, type = 'success', duration = 3000) {
  const container = $('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

async function withLoading(btn, fn) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try { await fn(); }
  finally { btn.disabled = false; btn.innerHTML = original; }
}

function animateNumber(el, from, to, duration = 600) {
  const start = performance.now();
  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = (from + (to - from) * eased).toFixed(2);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = String(dateStr).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function addMonths(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

function monthLabel(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('es-ES', { month: 'short', year: 'numeric' });
}

/** Suma segura: convierte a número y fallback a 0 */
function toNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

/* ═══════════════════════════════════════════════════════════
   CICLO DE CUOTAS — DÍA 15
   ═══════════════════════════════════════════════════════════ */

/**
 * Devuelve la fecha del último día 15 que ya ocurrió.
 *
 * Ejemplos:
 * - 10/08/2026 -> 15/07/2026
 * - 15/08/2026 -> 15/08/2026
 * - 19/08/2026 -> 15/08/2026
 */
function getCurrentCycleDate() {
  const now = new Date();

  let year = now.getFullYear();
  let month = now.getMonth();

  if (now.getDate() < CARD_CLOSE_DAY) {
    month--;

    if (month < 0) {
      month = 11;
      year--;
    }
  }

  return `${year}-${String(month + 1).padStart(2, '0')}-${String(CARD_CLOSE_DAY).padStart(2, '0')}`;
}

/**
 * Mantengo este nombre porque otras partes del sistema
 * podrían usarlo.
 */
function getClosingDate() {
  return getCurrentCycleDate();
}

/**
 * Determina el estado temporal de una cuota respecto
 * del ciclo actual.
 */
function getTimeStatus(dueDate) {
  const currentCycle = getCurrentCycleDate();

  if (dueDate < currentCycle) return 'OVERDUE';
  if (dueDate === currentCycle) return 'CURRENT';

  return 'FUTURE';
}

/**
 * Devuelve la fecha local actual como YYYY-MM-DD.
 */
function getTodayLocalDate() {
  const now = new Date();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Determina si una fecha pertenece al ciclo actual.
 *
 * Un ciclo va desde el día 15 inclusive
 * hasta el día 15 del mes siguiente.
 */
function isDateInCurrentCycle(dateStr) {
  if (!dateStr) return false;

  const currentCycle = getCurrentCycleDate();
  const nextCycle = addMonths(currentCycle, 1);

  return dateStr >= currentCycle && dateStr < nextCycle;
}

/* ═══════════════════════════════════════════════════════════
   GESTIÓN DE installmentStates
═══════════════════════════════════════════════════════════ */

/**
 * Genera los estados iniciales de una compra nueva.
 * @param {number} installments - Total de cuotas
 * @param {string} firstDate - Fecha de la cuota #1 (YYYY-MM-DD)
 * @param {number} startFrom - Cuota desde la que se empieza a registrar
 *   Las cuotas previas se marcan como HISTORICAL PAID (no afectan saldo).
 */
function generateInstallmentStates(installments, firstDate, startFrom = 1) {
  const states = [];
  const start = Math.max(1, Math.min(startFrom, installments + 1));

  for (let i = 0; i < installments; i++) {
    const idx = i + 1;
    const dueDate = addMonths(firstDate, i);

    if (idx < start) {
      states.push({
        idx,
        status: 'PAID',
        type: 'HISTORICAL',
        dueDate,
        paidAt: null
      });
    } else {
      states.push({
        idx,
        status: 'PENDING',
        type: 'REGULAR',
        dueDate,
        paidAt: null
      });
    }
  }

  return states;
}

/**
 * Migra datos legacy (con paidCount) al formato actual.
 * Si installmentStates está vacío o ausente, se autogenera.
 */
function ensureInstallmentStates(p) {
  if (Array.isArray(p.installmentStates) && p.installmentStates.length > 0) {
    return;
  }

  const installments = toNum(p.installments) || 1;
  const paidCount = toNum(p.paidCount) || 0;
  const firstDate =
    p.firstInstallmentDate ||
    p.purchaseDate ||
    new Date().toISOString().slice(0, 10);

  const startFrom = toNum(p.startFrom) || 1;

  p.installmentStates = [];

  for (let i = 0; i < installments; i++) {
    const idx = i + 1;
    const dueDate = addMonths(firstDate, i);

    if (idx < startFrom) {
      p.installmentStates.push({
        idx,
        status: 'PAID',
        type: 'HISTORICAL',
        dueDate,
        paidAt: null
      });

    } else if (idx <= paidCount) {
      // Ya figuraba como pagada en datos antiguos.
      // No asumimos que fue pagada en el ciclo actual.
      p.installmentStates.push({
        idx,
        status: 'PAID',
        type: 'REGULAR',
        dueDate,
        paidAt: null
      });

    } else {
      p.installmentStates.push({
        idx,
        status: 'PENDING',
        type: 'REGULAR',
        dueDate,
        paidAt: null
      });
    }
  }
}

async function syncAutomaticInstallments() {
  const currentCycle = getCurrentCycleDate();
  const today = getTodayLocalDate();

  const changedPurchases = [];

  for (const p of purchases) {
    ensureInstallmentStates(p);

    let changed = false;

    p.installmentStates.forEach(inst => {
      if (inst.type !== 'REGULAR') return;

      if (
        inst.status === 'PENDING' &&
        inst.dueDate <= currentCycle
      ) {
        inst.status = 'PAID';

        // Registramos cuándo se hizo el reconocimiento automático.
        // Para la cuota del ciclo actual usamos el propio día 15.
        inst.paidAt = inst.dueDate === currentCycle
          ? currentCycle
          : today;

        changed = true;
      }
    });

    if (changed) {
      p.paidCount = p.installmentStates.filter(
        inst => inst.status === 'PAID'
      ).length;

      changedPurchases.push(p);
    }
  }

  // Guardar cambios en Supabase
  for (const p of changedPurchases) {
    const { error } = await supabaseDb
      .from('card_purchases')
      .update({
        paidCount: p.paidCount,
        installmentStates: p.installmentStates
      })
      .eq('id', p.id)
      .eq('user_id', currentUserId);

    if (error) {
      console.error(
        'Error sincronizando cuotas automáticas:',
        error
      );
    }
  }

  return changedPurchases.length;
}

/* ═══════════════════════════════════════════════════════════
   CÁLCULO DEL SALDO — FUENTE DE VERDAD ÚNICA
═══════════════════════════════════════════════════════════ */

/**
 * Calcula el total que se debe descontar del saldo en el ciclo actual.
 *
 * REGLAS (4 únicas):
 * 1. HISTORICAL PAID → NO descuenta (son del pasado, antes del registro)
 * 2. REGULAR PENDING del ciclo actual (OVERDUE o CURRENT) → SÍ descuenta
 * 3. REGULAR PENDING futura → NO descuenta (espera a su ciclo)
 * 4. REGULAR PAID (ya pagada, sea del ciclo actual o adelanto) → SÍ descuenta
 *
 * Nota: una cuota PAID del ciclo actual descuenta porque es un egreso real.
 *       una cuota PAID futura (adelanto) descuenta porque ya se debitó.
 */
function computeCurrentDeductions() {
  let total = 0;
  const currentCycle = getCurrentCycleDate(); // Devuelve "2026-08-15"

  purchases.forEach(p => {
    ensureInstallmentStates(p);

    const amount = toNum(p.amount);
    const installments = toNum(p.installments) || 1;
    const installmentAmount = amount / installments;

    if (!isFinite(installmentAmount) || installmentAmount <= 0) return;

    p.installmentStates.forEach(inst => {
      // 1. Ignorar explícitamente cuotas que fueron marcadas como históricas/viejas pasadas
      if (inst.type === 'HISTORICAL' || inst.type === 'LEGACY_PAID') return;

      // 2. Si la fecha de la cuota coincide exactamente con el ciclo actual (ej: 2026-08-15)
      // O si el comparador de tiempo da 'CURRENT'
      if (inst.dueDate === currentCycle || getTimeStatus(inst.dueDate) === 'CURRENT') {
        total += installmentAmount;
      }
    });
  });

  return Number(total.toFixed(2));
}

function computeBalance() {
  const totalInc = incomes.reduce((s, i) => s + toNum(i.amount), 0);
  const totalExp = expenses.reduce((s, e) => s + toNum(e.amount), 0);
  const deductions = computeCurrentDeductions();
  return Number((totalInc - totalExp - deductions).toFixed(2));
}

function updateBalanceSummary() {
  const totalInc = incomes.reduce((s, i) => s + toNum(i.amount), 0);
  const totalExp = expenses.reduce((s, e) => s + toNum(e.amount), 0);
  const deductions = computeCurrentDeductions();
  const balance = Number((totalInc - totalExp - deductions).toFixed(2));

  totalIncomesEl.textContent = totalInc.toFixed(2);
  totalExpensesPaidEl.textContent = totalExp.toFixed(2);
  totalCurrentDeductionsEl.textContent = deductions.toFixed(2);

  // Color dinámico del balance
  headerBalanceWrap.classList.remove('balance-positive', 'balance-negative');
  headerBalanceWrap.classList.add(balance >= 0 ? 'balance-positive' : 'balance-negative');

  const previousText = totalBalanceEl.textContent;
  const newText = balance.toFixed(2);
  if (previousText !== newText) {
    const from = parseFloat(previousText.replace(/,/g, '')) || 0;
    animateNumber(totalBalanceEl, from, balance, 500);
  }
}

function animateBalance(from, to) {
  animateNumber(totalBalanceEl, from, to, 700);
  headerBalanceWrap.classList.remove('balance-pulse', 'balance-shake');
  void headerBalanceWrap.offsetWidth;
  headerBalanceWrap.classList.add(to < 0 && from >= 0 ? 'balance-shake' : 'balance-pulse');
}

/* ═══════════════════════════════════════════════════════════
   AUTH & DATA LOADING
═══════════════════════════════════════════════════════════ */
async function init() {
  document.body.classList.add('loading-auth');
  try {
    const { data: { session } } = await supabaseDb.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }
    currentUserId = session.user.id;
    supabaseDb.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') window.location.href = 'login.html';
    });
    await loadAll();
  } catch (err) {
    console.error('Init error:', err);
    showToast('Error al inicializar.', 'error');
  } finally {
    document.body.classList.remove('loading-auth');
  }
}

btnLogout.addEventListener('click', async () => {
  btnLogout.disabled = true;
  await supabaseDb.auth.signOut();
  window.location.href = 'login.html';
});

async function loadAll() {
  if (!currentUserId) {
    const { data: { session } } = await supabaseDb.auth.getSession();
    if (!session) return;
    currentUserId = session.user.id;
  }

  try {
    const [expRes, incRes, cardRes, purRes] = await Promise.all([
      supabaseDb.from('expenses').select('*').eq('user_id', currentUserId).order('date', { ascending: false }),
      supabaseDb.from('incomes').select('*').eq('user_id', currentUserId).order('id'),
      supabaseDb.from('cards').select('*').eq('user_id', currentUserId).order('id'),
      supabaseDb.from('card_purchases').select('*').eq('user_id', currentUserId).order('created_at', { ascending: false }),
    ]);

    const firstError = [expRes, incRes, cardRes, purRes].find(r => r.error);
    if (firstError) { showToast('Error al cargar: ' + firstError.error.message, 'error'); return; }

    expenses = expRes.data || [];
    incomes = incRes.data || [];
    cards = cardRes.data || [];
    purchases = (purRes.data || []).map(p => {
      ensureInstallmentStates(p);
      return p;
      });

      // Actualizar automáticamente las cuotas cuyo vencimiento ya llegó
      await syncAutomaticInstallments();

    renderIncomes();
    renderIncomeMovements();
    renderCards();
    renderCardSelectors();
    renderExpenseSourceOptions();
    updateUI();
    renderInstallments();
    initReports();
  } catch (err) {
    console.error('loadAll error:', err);
    showToast('Error de conexión.', 'error');
  }
}

/* ═══════════════════════════════════════════════════════════
   INGRESOS DINÁMICOS
═══════════════════════════════════════════════════════════ */
function isExtraIncome(i) { return i.label === EXTRA_INCOME_LABEL; }
function getRegularIncomes() { return incomes.filter(i => !isExtraIncome(i)); }

function renderIncomes() {
  const regular = getRegularIncomes();
  incomesListEl.innerHTML = '';
  if (regular.length === 0) {
    incomesListEl.innerHTML = '<div class="incomes-list-empty">Aún no agregaste ingresos fijos.</div>';
  } else {
    regular.forEach(inc => {
      const item = document.createElement('div');
      item.className = 'income-item-dynamic';
      item.innerHTML = `
        <div class="income-item-info">
          <div class="income-item-name">${escapeHtml(inc.label)}</div>
          <div class="income-item-amount">$${toNum(inc.amount).toFixed(2)}</div>
        </div>
        <div class="income-item-actions">
          <button class="icon-btn edit" data-action="edit-income" data-id="${inc.id}">✏️</button>
          <button class="icon-btn delete" data-action="delete-income" data-id="${inc.id}">🗑️</button>
        </div>`;
      incomesListEl.appendChild(item);
    });
  }
  renderExpenseSourceOptions();
  updateBalanceSummary();
}

// Event delegation para lista de ingresos
incomesListEl.addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.action === 'edit-income') openEditIncomeModal(id);
  if (btn.dataset.action === 'delete-income') openDeleteIncomeModal(id);
});

function checkIncomeInputs() {
  addIncomeBtn.disabled = !(newIncomeNameInput.value.trim() &&
    newIncomeAmountInput.value && toNum(newIncomeAmountInput.value) > 0);
}
newIncomeNameInput.addEventListener('input', checkIncomeInputs);
newIncomeAmountInput.addEventListener('input', checkIncomeInputs);

addIncomeBtn.addEventListener('click', async () => {
  const label = newIncomeNameInput.value.trim();
  const amount = toNum(newIncomeAmountInput.value);
  if (!label || amount <= 0) return;

  await withLoading(addIncomeBtn, async () => {
    const { data, error } = await supabaseDb.from('incomes')
      .insert({ label, amount, user_id: currentUserId }).select();
    if (error) { showToast('Error: ' + error.message, 'error'); return; }
    incomes.push(data[0]);
    newIncomeNameInput.value = ''; newIncomeAmountInput.value = '';
    addIncomeBtn.disabled = true;
    renderIncomes(); renderIncomeMovements();
    showToast('Ingreso agregado', 'success');
  });
});

function openEditIncomeModal(id) {
  const inc = incomes.find(i => i.id === id);
  if (!inc || isExtraIncome(inc)) return;
  $('edit-income-name').value = inc.label;
  $('edit-income-amount').value = inc.amount;
  editingIncomeId = id;
  openModal('edit-income-modal');
}

$('confirm-edit-income').addEventListener('click', async () => {
  const label = $('edit-income-name').value.trim();
  const amount = toNum($('edit-income-amount').value);
  if (!label || amount < 0) { showToast('Completá los campos.', 'error'); return; }

  await withLoading($('confirm-edit-income'), async () => {
    const { error } = await supabaseDb.from('incomes')
      .update({ label, amount }).eq('id', editingIncomeId).eq('user_id', currentUserId);
    if (error) { showToast('Error: ' + error.message, 'error'); return; }
    const idx = incomes.findIndex(i => i.id === editingIncomeId);
    if (idx > -1) incomes[idx] = { ...incomes[idx], label, amount };
    closeModal('edit-income-modal');
    renderIncomes(); renderIncomeMovements();
    showToast('Ingreso actualizado', 'success');
  });
});

function openDeleteIncomeModal(id) {
  deletingIncomeId = id;
  openModal('delete-income-modal');
}

$('confirm-delete-income').addEventListener('click', async () => {
  await withLoading($('confirm-delete-income'), async () => {
    const { error } = await supabaseDb.from('incomes')
      .delete().eq('id', deletingIncomeId).eq('user_id', currentUserId);
    if (error) { showToast('Error: ' + error.message, 'error'); return; }
    incomes = incomes.filter(i => i.id !== deletingIncomeId);
    closeModal('delete-income-modal');
    renderIncomes(); renderIncomeMovements();
    showToast('Ingreso eliminado', 'success');
  });
});

/* ─── Tabla de movimientos de ingresos ─────────────── */
function renderIncomeMovements() {
  const filter = incomeTypeFilterEl.value;
  let filtered = incomes.slice();
  if (filter === 'salary') filtered = filtered.filter(i => !isExtraIncome(i));
  else if (filter === 'extra') filtered = filtered.filter(i => isExtraIncome(i));
  filtered.sort((a, b) => (toNum(b.id)) - (toNum(a.id)));

  incomeTableEl.innerHTML = '';
  if (filtered.length === 0) {
    incomeTableEl.innerHTML = '<tr class="empty-row"><td colspan="5"><span class="empty-icon">💵</span>Sin movimientos.</td></tr>';
    return;
  }
  filtered.forEach((inc, idx) => {
    const row = document.createElement('tr');
    if (idx === 0) row.classList.add('new-row');
    const isExtra = isExtraIncome(inc);
    const typeLabel = isExtra
      ? '<span class="income-type-pill extra">💰 Extra</span>'
      : '<span class="income-type-pill salary">💼 Sueldo</span>';
    const displayName = isExtra ? 'Dinero extra' : escapeHtml(inc.label);
    const dateStr = inc.created_at ? formatDate(inc.created_at.slice(0, 10)) : '—';
    const actionsHtml = isExtra
      ? `<button class="icon-btn delete" data-action="delete-income-movement" data-id="${inc.id}">🗑️</button>`
      : `<button class="icon-btn edit" data-action="edit-income-movement" data-id="${inc.id}">✏️</button>
         <button class="icon-btn delete" data-action="delete-income-movement" data-id="${inc.id}">🗑️</button>`;
    row.innerHTML = `
      <td data-label="Concepto">${displayName}</td>
      <td data-label="Tipo">${typeLabel}</td>
      <td data-label="Monto" class="amount-cell positive">+$${toNum(inc.amount).toFixed(2)}</td>
      <td data-label="Fecha">${dateStr}</td>
      <td data-label="Acciones"><div class="action-cell">${actionsHtml}</div></td>`;
    incomeTableEl.appendChild(row);
  });
}

incomeTableEl.addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.action.includes('edit')) openEditIncomeModal(id);
  if (btn.dataset.action.includes('delete')) openDeleteIncomeModal(id);
});
incomeTypeFilterEl.addEventListener('change', renderIncomeMovements);

/* ─── Dinero extra ─────────────────────────────────── */
function checkExtraInput() {
  addExtraBtn.disabled = !(extraAmountInput.value && toNum(extraAmountInput.value) > 0);
}
extraAmountInput.addEventListener('input', checkExtraInput);

addExtraBtn.addEventListener('click', async () => {
  const amount = toNum(extraAmountInput.value);
  if (amount <= 0) return;
  const previousBalance = computeBalance();

  await withLoading(addExtraBtn, async () => {
    const { data, error } = await supabaseDb.from('incomes')
      .insert({ label: EXTRA_INCOME_LABEL, amount, user_id: currentUserId }).select();
    if (error) { showToast('Error: ' + error.message, 'error'); return; }
    incomes.push(data[0]);
    extraAmountInput.value = ''; addExtraBtn.disabled = true;
    if (extraSection) {
      extraSection.classList.remove('extra-pulse');
      void extraSection.offsetWidth;
      extraSection.classList.add('extra-pulse');
    }
    animateBalance(previousBalance, computeBalance());
    updateBalanceSummary();
    renderIncomeMovements();
    showToast(`+$${amount.toFixed(2)} sumados al saldo`, 'success');
  });
});

/* ═══════════════════════════════════════════════════════════
   GASTOS
═══════════════════════════════════════════════════════════ */
function renderExpenseSourceOptions() {
  const regular = getRegularIncomes();
  const html = '<option value="" disabled selected>Origen</option>' +
    regular.map(i => `<option value="${escapeHtml(i.label)}">${escapeHtml(i.label)}</option>`).join('');
  expenseSource.innerHTML = html;
  const editSource = $('edit-expense-source');
  if (editSource) editSource.innerHTML = html;
}

function checkInputs() {
  addExpenseButton.disabled = !(expenseName.value.trim() &&
    expenseAmount.value && toNum(expenseAmount.value) > 0 &&
    expenseCategory.value && expenseSource.value && expenseDate.value);
}
[expenseName, expenseAmount, expenseCategory, expenseSource, expenseDate].forEach(el => el.addEventListener('input', checkInputs));

addExpenseButton.addEventListener('click', async () => {
  const name = expenseName.value.trim();
  const amount = toNum(expenseAmount.value);
  const category = expenseCategory.value;
  const source = expenseSource.value;
  const date = expenseDate.value;
  if (!name || amount <= 0 || !category || !source || !date) return;

  await withLoading(addExpenseButton, async () => {
    const { data, error } = await supabaseDb.from('expenses')
      .insert({ name, amount, category, source, date, user_id: currentUserId }).select();
    if (error) { showToast('Error: ' + error.message, 'error'); return; }
    expenses.unshift(data[0]);
    expenseName.value = ''; expenseAmount.value = '';
    expenseCategory.value = ''; expenseSource.value = ''; expenseDate.value = '';
    addExpenseButton.disabled = true;
    updateUI(); renderReport();
    showToast('Gasto agregado', 'success');
  });
});

function updateUI() {
  const filter = categoryFilter.value;
  const filtered = filter === 'All' ? expenses : expenses.filter(e => e.category === filter);
  expenseTable.innerHTML = '';

  if (filtered.length === 0) {
    expenseTable.innerHTML = '<tr class="empty-row"><td colspan="6"><span class="empty-icon">📋</span>Sin gastos registrados.</td></tr>';
  } else {
    filtered.forEach((expense, idx) => {
      const row = document.createElement('tr');
      if (idx === 0) row.classList.add('new-row');
      const label = CATEGORY_LABELS[expense.category] || expense.category;
      const sourceHtml = expense.source ? `<span class="source-pill">${escapeHtml(expense.source)}</span>` : '—';
      row.innerHTML = `
        <td data-label="Descripción">${escapeHtml(expense.name)}</td>
        <td data-label="Monto" class="amount-cell">$${toNum(expense.amount).toFixed(2)}</td>
        <td data-label="Categoría"><span class="category-pill">${label}</span></td>
        <td data-label="Origen">${sourceHtml}</td>
        <td data-label="Fecha">${formatDate(expense.date)}</td>
        <td data-label="Acciones"><div class="action-cell">
          <button class="icon-btn edit" data-action="edit-expense" data-id="${expense.id}">✏️</button>
          <button class="icon-btn delete" data-action="delete-expense" data-id="${expense.id}">🗑️</button>
        </div></td>`;
      expenseTable.appendChild(row);
    });
  }
  updateBalanceSummary();
}

// Event delegation para tabla de gastos
expenseTable.addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.action === 'edit-expense') openEditExpenseModal(id);
  if (btn.dataset.action === 'delete-expense') openDeleteExpenseModal(id);
});

function openEditExpenseModal(id) {
  const expense = expenses.find(e => e.id === id);
  if (!expense) return;
  $('edit-expense-name').value = expense.name;
  $('edit-expense-amount').value = expense.amount;
  $('edit-expense-category').value = expense.category;
  $('edit-expense-source').value = expense.source || '';
  $('edit-expense-date').value = expense.date;
  editingExpenseId = id;
  openModal('edit-modal');
}

$('confirm-edit').addEventListener('click', async () => {
  const name = $('edit-expense-name').value.trim();
  const amount = toNum($('edit-expense-amount').value);
  const category = $('edit-expense-category').value;
  const source = $('edit-expense-source').value;
  const date = $('edit-expense-date').value;
  if (!name || amount <= 0 || !category || !source || !date) {
    showToast('Completá todos los campos.', 'error'); return;
  }
  await withLoading($('confirm-edit'), async () => {
    const { error } = await supabaseDb.from('expenses')
      .update({ name, amount, category, source, date })
      .eq('id', editingExpenseId).eq('user_id', currentUserId);
    if (error) { showToast('Error: ' + error.message, 'error'); return; }
    const idx = expenses.findIndex(e => e.id === editingExpenseId);
    if (idx > -1) expenses[idx] = { ...expenses[idx], name, amount, category, source, date };
    closeModal('edit-modal');
    updateUI(); renderReport();
    showToast('Gasto actualizado', 'success');
  });
});

function openDeleteExpenseModal(id) {
  deletingExpenseId = id;
  openModal('delete-modal');
}

$('confirm-delete').addEventListener('click', async () => {
  await withLoading($('confirm-delete'), async () => {
    const { error } = await supabaseDb.from('expenses')
      .delete().eq('id', deletingExpenseId).eq('user_id', currentUserId);
    if (error) { showToast('Error: ' + error.message, 'error'); return; }
    expenses = expenses.filter(e => e.id !== deletingExpenseId);
    closeModal('delete-modal');
    updateUI(); renderReport();
    showToast('Gasto eliminado', 'success');
  });
});

categoryFilter.addEventListener('change', updateUI);

/* ═══════════════════════════════════════════════════════════
   TARJETAS
═══════════════════════════════════════════════════════════ */
function renderCards() {
  cardsListEl.innerHTML = '';
  if (cards.length === 0) {
    cardsListEl.innerHTML = '<div style="color:var(--muted);font-size:13px;">Sin tarjetas.</div>';
    return;
  }
  cards.forEach(card => {
    const chip = document.createElement('div');
    chip.className = 'card-chip';
    chip.innerHTML = `
      <span class="card-chip-name">${escapeHtml(card.name)}</span>
      <span class="card-chip-close">cierre día ${CARD_CLOSE_DAY}</span>
      <button class="card-chip-remove" data-card-id="${card.id}">×</button>`;
    cardsListEl.appendChild(chip);
  });
}

cardsListEl.addEventListener('click', e => {
  const btn = e.target.closest('.card-chip-remove');
  if (!btn) return;
  deletingCardId = Number(btn.dataset.cardId);
  openModal('delete-card-modal');
});

function renderCardSelectors() {
  const html = '<option value="" disabled selected>Tarjeta</option>' +
    cards.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  purchaseCardSelect.innerHTML = html;
  const editCardSelect = $('edit-purchase-card');
  if (editCardSelect) editCardSelect.innerHTML = html;
}

function checkCardInputs() { addCardBtn.disabled = !newCardNameInput.value.trim(); }
newCardNameInput.addEventListener('input', checkCardInputs);

addCardBtn.addEventListener('click', async () => {
  const name = newCardNameInput.value.trim();
  if (!name) return;
  await withLoading(addCardBtn, async () => {
    const { data, error } = await supabaseDb.from('cards')
      .insert({ name, close_day: CARD_CLOSE_DAY, user_id: currentUserId }).select();
    if (error) { showToast('Error: ' + error.message, 'error'); return; }
    cards.push(data[0]);
    newCardNameInput.value = ''; addCardBtn.disabled = true;
    renderCards(); renderCardSelectors();
    showToast('Tarjeta agregada', 'success');
  });
});

$('confirm-delete-card').addEventListener('click', async () => {
  await withLoading($('confirm-delete-card'), async () => {
    const { error } = await supabaseDb.from('cards')
      .delete().eq('id', deletingCardId).eq('user_id', currentUserId);
    if (error) { showToast('Error: ' + error.message, 'error'); return; }
    cards = cards.filter(c => c.id !== deletingCardId);
    purchases.forEach(p => { if (p.card_id === deletingCardId) p.card_id = null; });
    closeModal('delete-card-modal');
    renderCards(); renderCardSelectors(); renderInstallments();
    showToast('Tarjeta eliminada', 'success');
  });
});

/* ═══════════════════════════════════════════════════════════
   COMPRAS EN CUOTAS — MÓDULO REESCRITO
═══════════════════════════════════════════════════════════ */

function checkPurchaseInputs() {
  const installments = parseInt(purchaseInstallmentsInput.value, 10) || 0;
  const startFrom = parseInt(purchaseStartFromInput.value, 10) || 1;
  const valid = purchaseNameInput.value.trim() &&
    purchaseAmountInput.value && toNum(purchaseAmountInput.value) > 0 &&
    installments > 0 &&
    startFrom >= 1 && startFrom <= installments + 1 &&
    purchaseCardSelect.value &&
    firstInstallmentDateInput.value;
  addPurchaseBtn.disabled = !valid;
}
[purchaseNameInput, purchaseAmountInput, purchaseInstallmentsInput,
 purchaseStartFromInput, purchaseCardSelect, firstInstallmentDateInput]
  .forEach(el => el.addEventListener('input', checkPurchaseInputs));

addPurchaseBtn.addEventListener('click', async () => {
  const name = purchaseNameInput.value.trim();
  const amount = toNum(purchaseAmountInput.value);
  const installments = parseInt(purchaseInstallmentsInput.value, 10);
  const startFrom = parseInt(purchaseStartFromInput.value, 10) || 1;
  const cardId = purchaseCardSelect.value ? Number(purchaseCardSelect.value) : null;
  const firstDate = firstInstallmentDateInput.value;

  if (!name || amount <= 0 || !installments || !cardId || !firstDate) return;

  const installmentStates = generateInstallmentStates(installments, firstDate, startFrom);

  await withLoading(addPurchaseBtn, async () => {
    const { data, error } = await supabaseDb.from('card_purchases')
      .insert({
        name, amount, installments, startFrom,
        paidCount: startFrom - 1,
        card_id: cardId,
        firstInstallmentDate: firstDate,
        installmentStates,
        user_id: currentUserId,
      }).select();

    if (error) { showToast('Error: ' + error.message, 'error'); return; }

    const newPurchase = data[0];
    ensureInstallmentStates(newPurchase);
    purchases.unshift(newPurchase);
    await syncAutomaticInstallments();

    purchaseNameInput.value = '';
    purchaseAmountInput.value = '';
    purchaseInstallmentsInput.value = '';
    purchaseStartFromInput.value = '';
    purchaseCardSelect.value = '';
    firstInstallmentDateInput.value = '';
    addPurchaseBtn.disabled = true;

    renderInstallments();
    updateBalanceSummary();

    const historicalCount = startFrom - 1;
    const msg = historicalCount > 0
      ? `Compra agregada (${historicalCount} cuotas históricas no afectan el saldo)`
      : 'Compra agregada';
    showToast(msg, 'success');
  });
});

/* ─── Render de cuotas ─────────────────────────────── */
function renderInstallments() {
  installmentsListEl.innerHTML = '';
  if (purchases.length === 0) {
    installmentsListEl.innerHTML = '<div class="installment-empty"><span class="empty-icon">💳</span>Sin compras en cuotas.</div>';
    cardSummaryEl.innerHTML = '';
    updateBalanceSummary();
    return;
  }

  let grandCurrent = 0, grandAdvanced = 0, grandPending = 0;
  const grouped = {};
  purchases.forEach(p => {
    const key = p.card_id || 'none';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(p);
  });

  const renderGroup = (cardName, list) => {
    const header = document.createElement('div');
    header.className = 'card-group-header';
    header.innerHTML = `💳 ${escapeHtml(cardName)} <span class="card-group-summary">cierre día ${CARD_CLOSE_DAY}</span>`;
    installmentsListEl.appendChild(header);

    let groupCurrent = 0, groupAdvanced = 0, groupPending = 0;
    list.forEach(p => {
      const stats = renderPurchaseItem(p);
      groupCurrent += stats.current;
      groupAdvanced += stats.advanced;
      groupPending += stats.pending;
      installmentsListEl.appendChild(stats.el);
    });

    const summary = document.createElement('div');
    summary.className = 'card-group-header';
    summary.style.borderTop = '1px solid var(--border)';
    summary.style.borderBottom = 'none';
    summary.style.marginTop = '8px';
    summary.innerHTML = `<span style="font-weight:400;color:var(--muted);font-size:13px;">
      ${escapeHtml(cardName)}: mes actual <strong style="color:var(--text)">$${groupCurrent.toFixed(2)}</strong> ·
      adelantos <strong style="color:var(--accent-dk)">$${groupAdvanced.toFixed(2)}</strong> ·
      futuras <strong style="color:var(--muted)">$${groupPending.toFixed(2)}</strong>
    </span>`;
    installmentsListEl.appendChild(summary);

    grandCurrent += groupCurrent;
    grandAdvanced += groupAdvanced;
    grandPending += groupPending;
  };

  cards.forEach(card => {
    const list = grouped[card.id] || [];
    if (list.length > 0) renderGroup(card.name, list);
  });
  if (grouped['none'] && grouped['none'].length > 0) {
    renderGroup('Sin tarjeta', grouped['none']);
  }

  cardSummaryEl.innerHTML = `Total: mes actual <strong>$${grandCurrent.toFixed(2)}</strong> · adelantos <strong>$${grandAdvanced.toFixed(2)}</strong> · futuras <strong>$${grandPending.toFixed(2)}</strong>`;
  updateBalanceSummary();
}

function renderPurchaseItem(p) {
  ensureInstallmentStates(p);

  const amount = toNum(p.amount);
  const installments = toNum(p.installments) || 1;
  const installmentAmount = amount / installments;

  let currentTotal = 0, advancedTotal = 0, pendingTotal = 0;
  let boxesHtml = '';

  p.installmentStates.forEach(inst => {
    const timeStatus = getTimeStatus(inst.dueDate);
    const isHistorical = inst.type === 'HISTORICAL';
    const isPaid = inst.status === 'PAID';
    const isPending = inst.status === 'PENDING';

    // Totales por categoría
    if (isHistorical) {
      // Las históricas no cuentan en ningún total
    } else if (isPaid) {
      // Pagada: ¿es del ciclo actual o adelanto?
      if (timeStatus === 'FUTURE') advancedTotal += installmentAmount;
      else currentTotal += installmentAmount;
    } else if (isPending) {
      // Pendiente: ¿vence este ciclo o es futura?
      if (timeStatus === 'OVERDUE' || timeStatus === 'CURRENT') currentTotal += installmentAmount;
      else pendingTotal += installmentAmount;
    }

    // Clase visual de la box
    let boxClass = 'box';
    let boxTitle = `Cuota ${inst.idx} — ${monthLabel(inst.dueDate)}`;

    if (isHistorical) {
      boxClass += ' paid historical';
      boxTitle += ' (histórica - no afecta saldo)';
    } else if (isPaid) {
      if (timeStatus === 'FUTURE') {
        boxClass += ' paid advanced';
        boxTitle += ' (adelanto - ya debitada del saldo)';
      } else {
        boxClass += ' paid regular';
        boxTitle += ' (pagada - debita del saldo)';
      }
    } else {
      // PENDING
      if (timeStatus === 'CURRENT') {
        boxClass += ' current';
        boxTitle += ' (vence en este cierre - descuenta del saldo)';
      } else if (timeStatus === 'OVERDUE') {
        boxClass += ' overdue';
        boxTitle += ' (vencida - descuenta del saldo)';
      } else {
        boxClass += ' future';
        boxTitle += ' (futura - no descuenta hasta su ciclo)';
      }
    }

    // Las históricas NO son clickeables
    const clickable = !isHistorical;
    const clickAttr = clickable
      ? `data-action="toggle-installment" data-pid="${p.id}" data-idx="${inst.idx}"`
      : '';

    boxesHtml += `
      <div class="box-wrap">
        <div class="${boxClass}" ${clickAttr} title="${boxTitle}">
          ${inst.idx}
        </div>
        <span class="box-label">${monthLabel(inst.dueDate).slice(0, 3)}</span>
      </div>`;
  });

  const paidCount = p.installmentStates.filter(i => i.status === 'PAID').length;
  const progressPct = (paidCount / installments) * 100;
  const cardName = p.card_id ? (cards.find(c => c.id === p.card_id)?.name || '—') : '—';
  const isComplete = paidCount >= installments;

  const item = document.createElement('div');
  item.className = 'installment-item' + (isComplete ? ' is-complete' : '');
  item.innerHTML = `
    <div class="installment-head">
      <div>
        <div class="installment-title">${escapeHtml(p.name)}</div>
        <div class="installment-meta">
          <span>Total: <strong>$${amount.toFixed(2)}</strong></span>
          <span>Cuota: <strong>$${installmentAmount.toFixed(2)}</strong></span>
          <span>Tarjeta: <strong>${escapeHtml(cardName)}</strong></span>
          <span>1ª cuota: <strong>${formatDate(p.firstInstallmentDate)}</strong></span>
        </div>
      </div>
      <div class="installment-actions">
        <button class="icon-btn edit" data-action="edit-purchase" data-id="${p.id}">✏️</button>
        <button class="icon-btn delete" data-action="delete-purchase" data-id="${p.id}">🗑️</button>
      </div>
    </div>
    <div class="installment-progress">
      <div class="progress-bar"><div class="progress-fill" style="width: ${progressPct}%"></div></div>
      <div class="progress-label">
        <span>${paidCount} de ${installments} cuotas</span>
        <span class="paid">${isComplete ? 'Completo' : `Faltan ${installments - paidCount}`}</span>
      </div>
    </div>
    <div class="installment-legend-row">
      <span class="legend-chip current">● Vence este cierre</span>
      <span class="legend-chip advanced">● Adelanto</span>
      <span class="legend-chip future">● Futura</span>
      <span class="legend-chip historical">● Histórica</span>
    </div>
    <div class="installment-boxes">${boxesHtml}</div>`;

  return { el: item, current: currentTotal, advanced: advancedTotal, pending: pendingTotal };
}

/* ─── Event delegation UNIFICADA para installments ─── */
installmentsListEl.addEventListener('click', e => {
  // 1) Toggle de cuota (click en box)
  const box = e.target.closest('.box[data-action="toggle-installment"]');
  if (box) {
    toggleInstallmentPaid(Number(box.dataset.pid), Number(box.dataset.idx));
    return;
  }
  // 2) Botones de acción (editar / eliminar compra)
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.action === 'edit-purchase') openEditPurchaseModal(id);
  if (btn.dataset.action === 'delete-purchase') openDeletePurchaseModal(id);
});

/**
 * Toggle de cuota pagada.
 *
 * REGLAS CLARAS:
 * - Si la cuota es PENDING → marcar como PAID → RESTA del saldo
 * - Si la cuota es PAID (no histórica) → desmarcar → SUMA al saldo
 * - Históricas no son toggleables
 *
 * El impacto en el saldo se calcula automáticamente vía computeBalance(),
 * que sigue las 4 reglas de computeCurrentDeductions().
 */
async function toggleInstallmentPaid(purchaseId, boxIdx) {
  const p = purchases.find(x => x.id === purchaseId);
  if (!p) return;
  ensureInstallmentStates(p);

  const inst = p.installmentStates.find(i => i.idx === boxIdx);
  if (!inst) return;
  if (inst.type === 'HISTORICAL') {
    showToast('Las cuotas históricas no se pueden modificar', 'error');
    return;
  }

  // Capturar saldo ANTES del cambio
  const previousBalance = computeBalance();

  const amount = toNum(p.amount);
  const installments = toNum(p.installments) || 1;
  const installmentAmount = amount / installments;

  if (!isFinite(installmentAmount) || installmentAmount <= 0) {
    showToast('Monto de cuota inválido', 'error');
    return;
  }

  // Determinar nuevo estado
  let newStatus, actionMsg;
  if (inst.status === 'PENDING') {
    newStatus = 'PAID';

    const timeStatus = getTimeStatus(inst.dueDate);

    actionMsg = timeStatus === 'FUTURE'
    ? `Cuota ${boxIdx} pagada por adelantado`
    : `Cuota ${boxIdx} pagada`;

  // Registrar cuándo se pagó
    inst.paidAt = getTodayLocalDate();

  } else {
    newStatus = 'PENDING';
    actionMsg = `Cuota ${boxIdx} desmarcada`;

  // Si se desmarca, ya no consideramos ese pago
    inst.paidAt = null;
  }

  inst.status = newStatus;
  const newPaidCount = p.installmentStates.filter(i => i.status === 'PAID').length;

  // Persistir
  const { error } = await supabaseDb.from('card_purchases')
    .update({ paidCount: newPaidCount, installmentStates: p.installmentStates })
    .eq('id', purchaseId).eq('user_id', currentUserId);

  if (error) {
    showToast('Error: ' + error.message, 'error');
    // Revertir en memoria
    inst.status = newStatus === 'PAID' ? 'PENDING' : 'PAID';
    return;
  }

  p.paidCount = newPaidCount;
  renderInstallments();

  // ⚠️ Recalcular saldo DESPUÉS del cambio
  const newBalance = computeBalance();
  const delta = Number((newBalance - previousBalance).toFixed(2));

  // Debug en consola
  console.log(
    `[BALANCE] ${actionMsg} | Antes: $${previousBalance.toFixed(2)} → Después: $${newBalance.toFixed(2)} | Δ: $${delta.toFixed(2)} | Cuota: $${installmentAmount.toFixed(2)}`
  );

  // Validación de seguridad: si marcamos como pagada, el saldo DEBE bajar o mantenerse
  if (newStatus === 'PAID' && delta > 0.01) {
    console.error('⚠️ BUG: marcar como pagada subió el saldo. Revisar computeCurrentDeductions()');
  }

  animateBalance(previousBalance, newBalance);

  // Toast con información clara
  let toastMsg;
  if (Math.abs(delta) < 0.01) {
    // La cuota ya estaba descontando este ciclo (era PENDING del mes actual)
    toastMsg = `${actionMsg} ✓ (cuota de $${installmentAmount.toFixed(2)})`;
  } else if (delta < 0) {
    // Saldo bajó → fue un adelanto o impacto real
    toastMsg = `${actionMsg} (-$${Math.abs(delta).toFixed(2)})`;
  } else {
    // Saldo subió → se desmarcó una cuota
    toastMsg = `${actionMsg} (+$${delta.toFixed(2)})`;
  }
  showToast(toastMsg, 'success', 3200);
}

/* ─── Editar compra ────────────────────────────────── */
function openEditPurchaseModal(id) {
  const p = purchases.find(x => x.id === id);
  if (!p) return;
  ensureInstallmentStates(p);
  $('edit-purchase-name').value = p.name;
  $('edit-purchase-amount').value = p.amount;
  $('edit-purchase-installments').value = p.installments;
  $('edit-purchase-card').value = p.card_id || '';
  $('edit-first-installment-date').value = p.firstInstallmentDate;
  editingPurchaseId = id;
  openModal('edit-purchase-modal');
}

$('confirm-edit-purchase').addEventListener('click', async () => {
  const name = $('edit-purchase-name').value.trim();
  const amount = toNum($('edit-purchase-amount').value);
  const installments = parseInt($('edit-purchase-installments').value, 10);
  const cardId = $('edit-purchase-card').value ? Number($('edit-purchase-card').value) : null;
  const firstDate = $('edit-first-installment-date').value;

  if (!name || amount <= 0 || !installments || !firstDate) {
    showToast('Completá los campos.', 'error'); return;
  }

  await withLoading($('confirm-edit-purchase'), async () => {
    const p = purchases.find(x => x.id === editingPurchaseId);
    if (!p) return;
    ensureInstallmentStates(p);

    // Si cambió el total de cuotas o la fecha, regenerar estados conservando lo pagado
    let newStates = p.installmentStates;
    if (installments !== toNum(p.installments) || firstDate !== p.firstInstallmentDate) {
      const preserved = {};
      p.installmentStates.forEach(s => { preserved[s.idx] = { status: s.status, type: s.type, paidAt: s.paidAt || null }; });
      newStates = [];
      for (let i = 0; i < installments; i++) {
        const idx = i + 1;
        const dueDate = addMonths(firstDate, i);
        if (preserved[idx]) {
          newStates.push({ idx, ...preserved[idx], dueDate });
        } else {
          newStates.push({ idx, status: 'PENDING', type: 'REGULAR', dueDate });
        }
      }
    }

    const newPaidCount = newStates.filter(s => s.status === 'PAID').length;

    const { error } = await supabaseDb.from('card_purchases')
      .update({
        name, amount, installments,
        paidCount: newPaidCount,
        card_id: cardId,
        firstInstallmentDate: firstDate,
        installmentStates: newStates,
      })
      .eq('id', editingPurchaseId).eq('user_id', currentUserId);

    if (error) { showToast('Error: ' + error.message, 'error'); return; }

    const idx = purchases.findIndex(x => x.id === editingPurchaseId);
    if (idx > -1) {
      purchases[idx] = {
        ...purchases[idx],
        name, amount, installments,
        paidCount: newPaidCount,
        card_id: cardId,
        firstInstallmentDate: firstDate,
        installmentStates: newStates,
      };
    }
    closeModal('edit-purchase-modal');
    renderInstallments();
    showToast('Compra actualizada', 'success');
  });
});

/* ─── Eliminar compra ──────────────────────────────── */
function openDeletePurchaseModal(id) {
  deletingPurchaseId = id;
  openModal('delete-purchase-modal');
}

$('confirm-delete-purchase').addEventListener('click', async () => {
  await withLoading($('confirm-delete-purchase'), async () => {
    const { error } = await supabaseDb.from('card_purchases')
      .delete().eq('id', deletingPurchaseId).eq('user_id', currentUserId);
    if (error) { showToast('Error: ' + error.message, 'error'); return; }
    purchases = purchases.filter(x => x.id !== deletingPurchaseId);
    closeModal('delete-purchase-modal');
    renderInstallments();
    showToast('Compra eliminada', 'success');
  });
});

/* ═══════════════════════════════════════════════════════════
   REPORTES MENSUALES
═══════════════════════════════════════════════════════════ */
const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const CHART_COLORS = ['#16A34A','#0EA5E9','#F59E0B','#EF4444','#8B5CF6','#EC4899','#14B8A6','#F97316','#6366F1','#84CC16'];
let reportChart = null;
let reportMonth = new Date().getMonth();
let reportYear = new Date().getFullYear();

const reportMonthSelect = $('report-month');
const reportYearSelect = $('report-year');
const reportPrevBtn = $('report-prev');
const reportNextBtn = $('report-next');
const reportTableEl = $('report-table');
const reportTotalEl = $('report-total');
const reportCountEl = $('report-count');
const reportAvgEl = $('report-avg');
const reportsLegendEl = $('reports-legend');

function initReports() {
  reportMonthSelect.innerHTML = MONTH_NAMES.map((m, i) => `<option value="${i}">${m}</option>`).join('');
  syncReportSelectors();
  reportMonthSelect.addEventListener('change', () => { reportMonth = parseInt(reportMonthSelect.value, 10); renderReport(); });
  reportYearSelect.addEventListener('change', () => { reportYear = parseInt(reportYearSelect.value, 10); renderReport(); });
  reportPrevBtn.addEventListener('click', () => {
    reportMonth--;
    if (reportMonth < 0) { reportMonth = 11; reportYear--; }
    syncReportSelectors(); renderReport();
  });
  reportNextBtn.addEventListener('click', () => {
    reportMonth++;
    if (reportMonth > 11) { reportMonth = 0; reportYear++; }
    syncReportSelectors(); renderReport();
  });
  renderReport();
}

function syncReportSelectors() {
  reportMonthSelect.value = reportMonth;
  const now = new Date();
  const minYear = expenses.length ? Math.min(...expenses.map(e => parseInt(e.date.slice(0, 4), 10))) : now.getFullYear();
  const maxYear = Math.max(now.getFullYear(), minYear, reportYear);
  let html = '';
  for (let y = maxYear; y >= minYear; y--) html += `<option value="${y}">${y}</option>`;
  reportYearSelect.innerHTML = html;
  reportYearSelect.value = reportYear;
}

function renderReport() {
  const monthStr = String(reportMonth + 1).padStart(2, '0');
  const yearStr = String(reportYear);
  const filtered = expenses.filter(e => {
    if (!e.date) return false;
    const [y, m] = e.date.split('-');
    return y === yearStr && m === monthStr;
  });

  const total = filtered.reduce((s, e) => s + toNum(e.amount), 0);
  const count = filtered.length;
  const avg = count ? total / count : 0;
  reportTotalEl.textContent = total.toFixed(2);
  reportCountEl.textContent = String(count);
  reportAvgEl.textContent = avg.toFixed(2);

  const byCategory = {};
  filtered.forEach(e => { byCategory[e.category || 'Otro'] = (byCategory[e.category || 'Otro'] || 0) + toNum(e.amount); });
  const cats = Object.keys(byCategory).sort((a, b) => byCategory[b] - byCategory[a]);
  const values = cats.map(c => byCategory[c]);
  const colors = cats.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

  if (reportChart) { reportChart.destroy(); reportChart = null; }
  const ctx = $('reports-chart');

  if (count === 0) {
    const c = ctx.getContext('2d');
    c.clearRect(0, 0, ctx.width, ctx.height);
    c.fillStyle = '#64748B'; c.font = '14px Inter'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('Sin gastos en este mes', ctx.width / 2, ctx.height / 2);
    reportsLegendEl.innerHTML = '<div class="legend-item" style="justify-content:center;color:var(--muted);">Sin gastos.</div>';
  } else {
    reportChart = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: cats.map(c => CATEGORY_LABELS[c] || c), datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }] },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (tip) => { const v = tip.parsed; const pct = total ? ((v / total) * 100).toFixed(1) : 0; return ` ${tip.label}: $${v.toFixed(2)} (${pct}%)`; } } } },
        cutout: '62%',
      },
    });
    reportsLegendEl.innerHTML = cats.map((c, i) => {
      const pct = total ? ((byCategory[c] / total) * 100).toFixed(1) : 0;
      return `<div class="legend-item"><span class="legend-dot" style="background:${colors[i]};"></span><span class="legend-label">${CATEGORY_LABELS[c] || c}</span><span class="legend-value">${byCategory[c].toFixed(2)}<span class="legend-pct">${pct}%</span></span></div>`;
    }).join('');
  }

  reportTableEl.innerHTML = '';
  if (filtered.length === 0) {
    reportTableEl.innerHTML = '<tr class="empty-row"><td colspan="5"><span class="empty-icon">📭</span>Sin gastos.</td></tr>';
  } else {
    filtered.forEach(e => {
      const row = document.createElement('tr');
      const label = CATEGORY_LABELS[e.category] || e.category;
      const sourceHtml = e.source ? `<span class="source-pill">${escapeHtml(e.source)}</span>` : '—';
      row.innerHTML = `
        <td data-label="Descripción">${escapeHtml(e.name)}</td>
        <td data-label="Monto" class="amount-cell">$${toNum(e.amount).toFixed(2)}</td>
        <td data-label="Categoría"><span class="category-pill">${label}</span></td>
        <td data-label="Origen">${sourceHtml}</td>
        <td data-label="Fecha">${formatDate(e.date)}</td>`;
      reportTableEl.appendChild(row);
    });
  }
}

/* ═══════════════════════════════════════════════════════════
   TABS & MODALS
═══════════════════════════════════════════════════════════ */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    $('panel-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'reports' && reportChart) setTimeout(() => reportChart.resize(), 50);
  });
});

function openModal(id) {
  const el = $(id);
  el.classList.add('is-open');
  el.addEventListener('click', backdropClose);
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  const el = $(id);
  el.classList.remove('is-open');
  el.removeEventListener('click', backdropClose);
  if (!document.querySelector('.modal.is-open')) document.body.style.overflow = '';
}
function backdropClose(e) { if (e.target === e.currentTarget) closeModal(e.currentTarget.id); }

document.addEventListener('click', e => {
  const closeBtn = e.target.closest('[data-close]');
  if (closeBtn) closeModal(closeBtn.dataset.close);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['edit-modal','delete-modal','edit-purchase-modal','delete-purchase-modal','delete-card-modal','edit-income-modal','delete-income-modal'].forEach(closeModal);
  }
});

/* ═══════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════ */
init();