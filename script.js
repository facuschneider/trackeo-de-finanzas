/* ═══════════════════════════════════════════════════════════
   Gastos Familiares — Script principal
   Refactorizado:
   - Sueldos dinámicos (N ingresos personalizables)
   - Dinero extra simple con animación
   - Balance dinámico con color según signo
   - Cuotas pendientes descuentan del saldo en tiempo real
   - Selector de origen poblado dinámicamente desde los sueldos
═══════════════════════════════════════════════════════════ */

const supabaseUrl = window.ENV.SUPABASE_URL;
const supabaseAnonKey = window.ENV.SUPABASE_ANON_KEY;
const supabaseDb = supabase.createClient(supabaseUrl, supabaseAnonKey);
window.supabase = supabaseDb;

const CATEGORY_LABELS = {
  'Alimentación': '🍽 Alimentación',
  'Transporte':   '🚌 Transporte',
  'Compras':      '🛍 Compras',
  'Departamento': '🏠 Departamento',
  'Ferretería':   '🔧 Ferretería',
  'Otro':         '📦 Otro',
};
const CARD_CLOSE_DAY = 15;
const EXTRA_INCOME_LABEL = '__extra__'; // Label reservado para dinero extra

/* ─── State ────────────────────────────────────────── */
let expenses  = [];
let incomes   = [];   // Incluye sueldos + extras
let cards     = [];
let purchases = [];
let currentUserId = null;

let editingExpenseId   = null;
let deletingExpenseId  = null;
let editingPurchaseId  = null;
let deletingPurchaseId = null;
let deletingCardId     = null;
let editingIncomeId    = null;
let deletingIncomeId   = null;

/* ─── DOM: Incomes (dinámicos) ─────────────────────── */
const incomesListEl       = document.getElementById('incomes-list');
const newIncomeNameInput  = document.getElementById('new-income-name');
const newIncomeAmountInput = document.getElementById('new-income-amount');
const addIncomeBtn        = document.getElementById('add-income');
const extraAmountInput    = document.getElementById('extra-amount');
const addExtraBtn         = document.getElementById('add-extra');
const extraSection        = document.querySelector('.extra-money-section');

/* ─── DOM: Expenses ────────────────────────────────── */
const expenseTable     = document.getElementById('expense-table');
const categoryFilter   = document.getElementById('category-filter');
const addExpenseButton = document.getElementById('add-expense');
const expenseName      = document.getElementById('expense-name');
const expenseAmount    = document.getElementById('expense-amount');
const expenseCategory  = document.getElementById('expense-category');
const expenseSource    = document.getElementById('expense-source');
const expenseDate      = document.getElementById('expense-date');

/* ─── DOM: Cards ───────────────────────────────────── */
const cardsListEl      = document.getElementById('cards-list');
const newCardNameInput = document.getElementById('new-card-name');
const addCardBtn       = document.getElementById('add-card');

/* ─── DOM: Purchases ───────────────────────────────── */
const purchaseNameInput         = document.getElementById('purchase-name');
const purchaseAmountInput       = document.getElementById('purchase-amount');
const purchaseInstallmentsInput = document.getElementById('purchase-installments');
const purchasePaidInput         = document.getElementById('purchase-paid');
const purchaseCardSelect        = document.getElementById('purchase-card');
const purchaseDateInput         = document.getElementById('purchase-date');
const firstInstallmentDateInput = document.getElementById('first-installment-date');
const addPurchaseBtn            = document.getElementById('add-purchase');
const installmentsListEl        = document.getElementById('installments-list');
const cardSummaryEl             = document.getElementById('card-summary');

/* ─── DOM: Summary ─────────────────────────────────── */
const totalBalanceEl           = document.getElementById('total-balance');
const headerBalanceWrap        = document.getElementById('header-balance-wrap');
const totalIncomesEl           = document.getElementById('total-incomes');
const totalExpensesPaidEl      = document.getElementById('total-expenses-paid');
const totalPendingInstallEl    = document.getElementById('total-pending-installments');

/* ─── DOM: Logout ──────────────────────────────────── */
const btnLogout = document.getElementById('btn-logout');

/* ═══════════════════════════════════════════════════════════
   TOAST SYSTEM
═══════════════════════════════════════════════════════════ */
function showToast(message, type = 'success', duration = 3000) {
  const container = document.getElementById('toast-container');
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

/* ═══════════════════════════════════════════════════════════
   LOADING STATE HELPER
═══════════════════════════════════════════════════════════ */
async function withLoading(btn, fn) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try { await fn(); }
  finally { btn.disabled = false; btn.innerHTML = original; }
}

/* ═══════════════════════════════════════════════════════════
   ANIMATED NUMBER COUNTER
═══════════════════════════════════════════════════════════ */
function animateNumber(el, from, to, duration = 600) {
  const start = performance.now();
  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = from + (to - from) * eased;
    el.textContent = current.toFixed(2);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ═══════════════════════════════════════════════════════════
   AUTH GUARD
═══════════════════════════════════════════════════════════ */
async function init() {
  document.body.classList.add('loading-auth');
  try {
    const { data: { session } } = await supabaseDb.auth.getSession();
    if (!session) {
      window.location.href = 'login.html';
      return;
    }
    currentUserId = session.user.id;

    supabaseDb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') window.location.href = 'login.html';
    });

    await loadAll();
  } catch (err) {
    console.error('Init error:', err);
    showToast('Error al inicializar la app.', 'error');
  } finally {
    document.body.classList.remove('loading-auth');
  }
}

btnLogout.addEventListener('click', async () => {
  btnLogout.disabled = true;
  await supabaseDb.auth.signOut();
  window.location.href = 'login.html';
});

/* ═══════════════════════════════════════════════════════════
   DATA LOADING
═══════════════════════════════════════════════════════════ */
async function loadAll() {
  if (!currentUserId) {
    const { data: { session } } = await supabaseDb.auth.getSession();
    if (!session) return;
    currentUserId = session.user.id;
  }

  expenseTable.innerHTML = '<tr><td colspan="6"><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div></td></tr>';

  try {
    const [expRes, incRes, cardRes, purRes] = await Promise.all([
      supabaseDb.from('expenses').select('*').eq('user_id', currentUserId).order('date', { ascending: false }),
      supabaseDb.from('incomes').select('*').eq('user_id', currentUserId).order('id'),
      supabaseDb.from('cards').select('*').eq('user_id', currentUserId).order('id'),
      supabaseDb.from('card_purchases').select('*').eq('user_id', currentUserId).order('created_at', { ascending: false }),
    ]);

    const firstError = [expRes, incRes, cardRes, purRes].find(r => r.error);
    if (firstError) {
      showToast('Error al cargar datos: ' + firstError.error.message, 'error');
      return;
    }

    expenses  = expRes.data  || [];
    incomes   = incRes.data  || [];
    cards     = cardRes.data || [];
    purchases = purRes.data  || [];

    renderIncomes();
    renderCards();
    renderCardSelectors();
    renderExpenseSourceOptions();
    updateUI();
    renderInstallments();
    initReports();
  } catch (err) {
    console.error('loadAll error:', err);
    showToast('Error de conexión. Verificá tu internet.', 'error');
  }
}

/* ═══════════════════════════════════════════════════════════
   INCOMES DINÁMICOS (sueldos + extras)
═══════════════════════════════════════════════════════════ */
function isExtraIncome(income) {
  return income.label === EXTRA_INCOME_LABEL;
}

function getRegularIncomes() {
  return incomes.filter(i => !isExtraIncome(i));
}

function getExtraIncomes() {
  return incomes.filter(i => isExtraIncome(i));
}

function getTotalExtras() {
  return getExtraIncomes().reduce((s, i) => s + (i.amount || 0), 0);
}

function renderIncomes() {
  const regular = getRegularIncomes();
  incomesListEl.innerHTML = '';

  if (regular.length === 0) {
    incomesListEl.innerHTML = `
      <div class="incomes-list-empty">
        Aún no agregaste ingresos fijos. Usá el formulario de abajo para crear el primero.
      </div>`;
  } else {
    regular.forEach(inc => {
      const item = document.createElement('div');
      item.className = 'income-item-dynamic';
      item.innerHTML = `
        <div class="income-item-info">
          <div class="income-item-name">${escapeHtml(inc.label)}</div>
          <div class="income-item-amount">$${(inc.amount || 0).toFixed(2)}</div>
        </div>
        <div class="income-item-actions">
          <button class="icon-btn edit" title="Editar" data-action="edit-income" data-id="${inc.id}">✏️</button>
          <button class="icon-btn delete" title="Eliminar" data-action="delete-income" data-id="${inc.id}">🗑️</button>
        </div>`;
      incomesListEl.appendChild(item);
    });
  }

  renderExpenseSourceOptions();
  updateBalanceSummary();
}

/* Event delegation para lista de ingresos */
incomesListEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.action === 'edit-income') openEditIncomeModal(id);
  if (btn.dataset.action === 'delete-income') openDeleteIncomeModal(id);
});

/* ─── Validación de inputs para agregar sueldo ────── */
function checkIncomeInputs() {
  const valid = newIncomeNameInput.value.trim() &&
                newIncomeAmountInput.value &&
                parseFloat(newIncomeAmountInput.value) > 0;
  addIncomeBtn.disabled = !valid;
}
newIncomeNameInput.addEventListener('input', checkIncomeInputs);
newIncomeAmountInput.addEventListener('input', checkIncomeInputs);

/* ─── Agregar nuevo sueldo ─────────────────────────── */
addIncomeBtn.addEventListener('click', async () => {
  const label = newIncomeNameInput.value.trim();
  const amount = parseFloat(newIncomeAmountInput.value);
  if (!label || isNaN(amount) || amount <= 0) return;

  await withLoading(addIncomeBtn, async () => {
    const { data, error } = await supabaseDb
      .from('incomes')
      .insert({ label, amount, user_id: currentUserId })
      .select();

    if (error) {
      showToast('Error al agregar ingreso: ' + error.message, 'error');
      return;
    }
    incomes.push(data[0]);
    newIncomeNameInput.value = '';
    newIncomeAmountInput.value = '';
    addIncomeBtn.disabled = true;
    renderIncomes();
    showToast('Ingreso agregado', 'success');
  });
});

/* ─── Editar sueldo ────────────────────────────────── */
function openEditIncomeModal(id) {
  const inc = incomes.find(i => i.id === id);
  if (!inc || isExtraIncome(inc)) return;
  document.getElementById('edit-income-name').value = inc.label;
  document.getElementById('edit-income-amount').value = inc.amount;
  editingIncomeId = id;
  openModal('edit-income-modal');
}

document.getElementById('confirm-edit-income').addEventListener('click', async () => {
  const label = document.getElementById('edit-income-name').value.trim();
  const amount = parseFloat(document.getElementById('edit-income-amount').value);

  if (!label || isNaN(amount) || amount < 0) {
    showToast('Completá todos los campos correctamente.', 'error');
    return;
  }

  const btn = document.getElementById('confirm-edit-income');
  await withLoading(btn, async () => {
    const { error } = await supabaseDb
      .from('incomes')
      .update({ label, amount })
      .eq('id', editingIncomeId)
      .eq('user_id', currentUserId);

    if (error) {
      showToast('Error al editar: ' + error.message, 'error');
      return;
    }
    const idx = incomes.findIndex(i => i.id === editingIncomeId);
    if (idx > -1) incomes[idx] = { ...incomes[idx], label, amount };
    closeModal('edit-income-modal');
    renderIncomes();
    showToast('Ingreso actualizado', 'success');
  });
});

/* ─── Eliminar sueldo ──────────────────────────────── */
function openDeleteIncomeModal(id) {
  deletingIncomeId = id;
  openModal('delete-income-modal');
}

document.getElementById('confirm-delete-income').addEventListener('click', async () => {
  const btn = document.getElementById('confirm-delete-income');
  await withLoading(btn, async () => {
    const { error } = await supabaseDb
      .from('incomes')
      .delete()
      .eq('id', deletingIncomeId)
      .eq('user_id', currentUserId);

    if (error) {
      showToast('Error al eliminar: ' + error.message, 'error');
      return;
    }
    incomes = incomes.filter(i => i.id !== deletingIncomeId);
    closeModal('delete-income-modal');
    renderIncomes();
    showToast('Ingreso eliminado', 'success');
  });
});

/* ═══════════════════════════════════════════════════════════
   DINERO EXTRA (suma directa al saldo)
═══════════════════════════════════════════════════════════ */
function checkExtraInput() {
  const amount = parseFloat(extraAmountInput.value);
  addExtraBtn.disabled = !(extraAmountInput.value && !isNaN(amount) && amount > 0);
}
extraAmountInput.addEventListener('input', checkExtraInput);

addExtraBtn.addEventListener('click', async () => {
  const amount = parseFloat(extraAmountInput.value);
  if (isNaN(amount) || amount <= 0) return;

  const previousBalance = computeBalance();

  await withLoading(addExtraBtn, async () => {
    const { data, error } = await supabaseDb
      .from('incomes')
      .insert({
        label: EXTRA_INCOME_LABEL,
        amount,
        user_id: currentUserId,
      })
      .select();

    if (error) {
      showToast('Error al agregar dinero extra: ' + error.message, 'error');
      return;
    }
    incomes.push(data[0]);
    extraAmountInput.value = '';
    addExtraBtn.disabled = true;

    // Animación de confirmación en la sección
    if (extraSection) {
      extraSection.classList.remove('extra-pulse');
      void extraSection.offsetWidth; // reflow para reiniciar animación
      extraSection.classList.add('extra-pulse');
    }

    // Animación del balance (contador + pulso)
    const newBalance = computeBalance();
    animateBalance(previousBalance, newBalance);

    updateBalanceSummary();
    showToast(`+$${amount.toFixed(2)} sumados al saldo`, 'success');
  });
});

/* ═══════════════════════════════════════════════════════════
   BALANCE DINÁMICO (con cuotas pendientes)
═══════════════════════════════════════════════════════════ */
function computePendingInstallments() {
  let pending = 0;
  purchases.forEach(p => {
    const remaining = p.installments - p.paidCount;
    if (remaining > 0) {
      const installmentAmount = p.amount / p.installments;
      pending += installmentAmount * remaining;
    }
  });
  return pending;
}

function computeBalance() {
  const totalInc = incomes.reduce((s, i) => s + (i.amount || 0), 0);
  const totalExp = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const pending  = computePendingInstallments();
  return totalInc - totalExp - pending;
}

function updateBalanceSummary() {
  const totalInc = incomes.reduce((s, i) => s + (i.amount || 0), 0);
  const totalExp = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const pending  = computePendingInstallments();
  const balance  = totalInc - totalExp - pending;

  totalIncomesEl.textContent        = totalInc.toFixed(2);
  totalExpensesPaidEl.textContent   = totalExp.toFixed(2);
  totalPendingInstallEl.textContent = pending.toFixed(2);

  // Actualizar balance del header con color dinámico
  const previousText = totalBalanceEl.textContent;
  const newText = balance.toFixed(2);

  // Aplicar color según signo
  headerBalanceWrap.classList.remove('balance-positive', 'balance-negative');
  if (balance >= 0) {
    headerBalanceWrap.classList.add('balance-positive');
  } else {
    headerBalanceWrap.classList.add('balance-negative');
  }

  // Solo animar el número si cambió
  if (previousText !== newText) {
    const from = parseFloat(previousText.replace(/,/g, '')) || 0;
    const to = balance;
    animateNumber(totalBalanceEl, from, to, 500);
  }
}

/* Animación de pulso en el balance (usada al sumar dinero extra) */
function animateBalance(from, to) {
  // Primero el contador numérico
  animateNumber(totalBalanceEl, from, to, 700);

  // Luego el pulso visual
  headerBalanceWrap.classList.remove('balance-pulse', 'balance-shake');
  void headerBalanceWrap.offsetWidth;

  if (to < 0 && from >= 0) {
    // Si pasó de positivo a negativo, shake
    headerBalanceWrap.classList.add('balance-shake');
  } else {
    headerBalanceWrap.classList.add('balance-pulse');
  }
}

/* ═══════════════════════════════════════════════════════════
   EXPENSES
═══════════════════════════════════════════════════════════ */
/* Poblar selector de origen dinámicamente desde los sueldos */
function renderExpenseSourceOptions() {
  const regular = getRegularIncomes();
  const optionsHtml = '<option value="" disabled selected>Origen</option>' +
    regular.map(i => `<option value="${escapeHtml(i.label)}">${escapeHtml(i.label)}</option>`).join('');
  expenseSource.innerHTML = optionsHtml;
  const editSource = document.getElementById('edit-expense-source');
  if (editSource) editSource.innerHTML = optionsHtml;
}

function checkInputs() {
  const valid = expenseName.value.trim() &&
                expenseAmount.value &&
                parseFloat(expenseAmount.value) > 0 &&
                expenseCategory.value &&
                expenseSource.value &&
                expenseDate.value;
  addExpenseButton.disabled = !valid;
}
[expenseName, expenseAmount, expenseCategory, expenseSource, expenseDate].forEach(el => {
  el.addEventListener('input', checkInputs);
});

addExpenseButton.addEventListener('click', async () => {
  const name     = expenseName.value.trim();
  const amount   = parseFloat(expenseAmount.value);
  const category = expenseCategory.value;
  const source   = expenseSource.value;
  const date     = expenseDate.value;

  if (!name || isNaN(amount) || amount <= 0 || !category || !source || !date) return;

  await withLoading(addExpenseButton, async () => {
    const { data, error } = await supabaseDb
      .from('expenses')
      .insert({ name, amount, category, source, date, user_id: currentUserId })
      .select();

    if (error) {
      showToast('Error al agregar gasto: ' + error.message, 'error');
      return;
    }
    expenses.unshift(data[0]);
    expenseName.value = '';
    expenseAmount.value = '';
    expenseCategory.value = '';
    expenseSource.value = '';
    expenseDate.value = '';
    addExpenseButton.disabled = true;
    updateUI();
    renderReport();
    showToast('Gasto agregado', 'success');
  });
});

function updateUI() {
  const filterValue = categoryFilter.value;
  const filtered = filterValue === 'All'
    ? expenses
    : expenses.filter(e => e.category === filterValue);

  expenseTable.innerHTML = '';

  if (filtered.length === 0) {
    const row = document.createElement('tr');
    row.className = 'empty-row';
    row.innerHTML = `
      <td colspan="6">
        <span class="empty-icon">📋</span>
        Sin gastos registrados. ¡Agrega el primero!
      </td>`;
    expenseTable.appendChild(row);
  } else {
    filtered.forEach((expense, idx) => {
      const row = document.createElement('tr');
      if (idx === 0) row.classList.add('new-row');
      const label = CATEGORY_LABELS[expense.category] || expense.category;
      const dateFormatted = formatDate(expense.date);
      const sourceHtml = expense.source
        ? `<span class="source-pill">${escapeHtml(expense.source)}</span>`
        : '—';
      row.innerHTML = `
        <td data-label="Descripción">${escapeHtml(expense.name)}</td>
        <td data-label="Monto" class="amount-cell">$${expense.amount.toFixed(2)}</td>
        <td data-label="Categoría"><span class="category-pill">${label}</span></td>
        <td data-label="Origen">${sourceHtml}</td>
        <td data-label="Fecha">${dateFormatted}</td>
        <td data-label="Acciones">
          <div class="action-cell">
            <button class="icon-btn edit" title="Editar" data-action="edit" data-id="${expense.id}">✏️</button>
            <button class="icon-btn delete" title="Eliminar" data-action="delete" data-id="${expense.id}">🗑️</button>
          </div>
        </td>`;
      expenseTable.appendChild(row);
    });
  }
  updateBalanceSummary();
}

expenseTable.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.action === 'edit') openEditModal(id);
  if (btn.dataset.action === 'delete') openDeleteModal(id);
});

function openEditModal(id) {
  const expense = expenses.find(e => e.id === id);
  if (!expense) return;
  document.getElementById('edit-expense-name').value     = expense.name;
  document.getElementById('edit-expense-amount').value   = expense.amount;
  document.getElementById('edit-expense-category').value = expense.category;
  document.getElementById('edit-expense-source').value   = expense.source || '';
  document.getElementById('edit-expense-date').value     = expense.date;
  editingExpenseId = id;
  openModal('edit-modal');
}

document.getElementById('confirm-edit').addEventListener('click', async () => {
  const name     = document.getElementById('edit-expense-name').value.trim();
  const amount   = parseFloat(document.getElementById('edit-expense-amount').value);
  const category = document.getElementById('edit-expense-category').value;
  const source   = document.getElementById('edit-expense-source').value;
  const date     = document.getElementById('edit-expense-date').value;

  if (!name || isNaN(amount) || amount <= 0 || !category || !source || !date) {
    showToast('Completá todos los campos.', 'error');
    return;
  }

  const btn = document.getElementById('confirm-edit');
  await withLoading(btn, async () => {
    const { error } = await supabaseDb
      .from('expenses')
      .update({ name, amount, category, source, date })
      .eq('id', editingExpenseId)
      .eq('user_id', currentUserId);

    if (error) {
      showToast('Error al editar: ' + error.message, 'error');
      return;
    }
    const index = expenses.findIndex(e => e.id === editingExpenseId);
    if (index > -1) {
      expenses[index] = { ...expenses[index], name, amount, category, source, date };
    }
    closeModal('edit-modal');
    updateUI();
    renderReport();
    showToast('Gasto actualizado', 'success');
  });
});

function openDeleteModal(id) {
  deletingExpenseId = id;
  openModal('delete-modal');
}

document.getElementById('confirm-delete').addEventListener('click', async () => {
  const btn = document.getElementById('confirm-delete');
  await withLoading(btn, async () => {
    const { error } = await supabaseDb
      .from('expenses')
      .delete()
      .eq('id', deletingExpenseId)
      .eq('user_id', currentUserId);

    if (error) {
      showToast('Error al eliminar: ' + error.message, 'error');
      return;
    }
    expenses = expenses.filter(e => e.id !== deletingExpenseId);
    closeModal('delete-modal');
    updateUI();
    renderReport();
    showToast('Gasto eliminado', 'success');
  });
});

categoryFilter.addEventListener('change', updateUI);

/* ═══════════════════════════════════════════════════════════
   CREDIT CARDS
═══════════════════════════════════════════════════════════ */
function renderCards() {
  cardsListEl.innerHTML = '';
  if (cards.length === 0) {
    cardsListEl.innerHTML = '<div style="color:var(--muted);font-size:13px;">Sin tarjetas. Agregá la primera.</div>';
    return;
  }
  cards.forEach(card => {
    const chip = document.createElement('div');
    chip.className = 'card-chip';
    chip.innerHTML = `
      <span class="card-chip-name">${escapeHtml(card.name)}</span>
      <span class="card-chip-close">cierre día ${CARD_CLOSE_DAY}</span>
      <button class="card-chip-remove" title="Eliminar tarjeta" data-card-id="${card.id}">×</button>`;
    cardsListEl.appendChild(chip);
  });
}

cardsListEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.card-chip-remove');
  if (!btn) return;
  openDeleteCardModal(Number(btn.dataset.cardId));
});

function renderCardSelectors() {
  const optionsHtml = '<option value="" disabled selected>Tarjeta</option>' +
    cards.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  purchaseCardSelect.innerHTML = optionsHtml;
  const editCardSelect = document.getElementById('edit-purchase-card');
  if (editCardSelect) editCardSelect.innerHTML = optionsHtml;
}

function checkCardInputs() {
  addCardBtn.disabled = !newCardNameInput.value.trim();
}
newCardNameInput.addEventListener('input', checkCardInputs);

addCardBtn.addEventListener('click', async () => {
  const name = newCardNameInput.value.trim();
  if (!name) return;

  await withLoading(addCardBtn, async () => {
    const { data, error } = await supabaseDb
      .from('cards')
      .insert({ name, close_day: CARD_CLOSE_DAY, user_id: currentUserId })
      .select();

    if (error) {
      showToast('Error al agregar tarjeta: ' + error.message, 'error');
      return;
    }
    cards.push(data[0]);
    newCardNameInput.value = '';
    addCardBtn.disabled = true;
    renderCards();
    renderCardSelectors();
    showToast('Tarjeta agregada', 'success');
  });
});

function openDeleteCardModal(id) {
  deletingCardId = id;
  openModal('delete-card-modal');
}

document.getElementById('confirm-delete-card').addEventListener('click', async () => {
  const btn = document.getElementById('confirm-delete-card');
  await withLoading(btn, async () => {
    const { error } = await supabaseDb
      .from('cards')
      .delete()
      .eq('id', deletingCardId)
      .eq('user_id', currentUserId);

    if (error) {
      showToast('Error al eliminar tarjeta: ' + error.message, 'error');
      return;
    }
    cards = cards.filter(c => c.id !== deletingCardId);
    purchases.forEach(p => { if (p.card_id === deletingCardId) p.card_id = null; });
    closeModal('delete-card-modal');
    renderCards();
    renderCardSelectors();
    renderInstallments();
    showToast('Tarjeta eliminada', 'success');
  });
});

/* ═══════════════════════════════════════════════════════════
   INSTALLMENT PURCHASES
═══════════════════════════════════════════════════════════ */
function checkPurchaseInputs() {
  const installments = parseInt(purchaseInstallmentsInput.value, 10) || 0;
  const paid = parseInt(purchasePaidInput.value, 10) || 0;
  const valid = purchaseNameInput.value.trim() &&
                purchaseAmountInput.value &&
                parseFloat(purchaseAmountInput.value) > 0 &&
                installments > 0 &&
                paid >= 0 && paid <= installments &&
                purchaseCardSelect.value &&
                purchaseDateInput.value &&
                firstInstallmentDateInput.value;
  addPurchaseBtn.disabled = !valid;
}
[purchaseNameInput, purchaseAmountInput, purchaseInstallmentsInput, purchasePaidInput, purchaseCardSelect, purchaseDateInput, firstInstallmentDateInput]
  .forEach(el => el.addEventListener('input', checkPurchaseInputs));

addPurchaseBtn.addEventListener('click', async () => {
  const name         = purchaseNameInput.value.trim();
  const amount       = parseFloat(purchaseAmountInput.value);
  const installments = parseInt(purchaseInstallmentsInput.value, 10);
  const paidCount    = parseInt(purchasePaidInput.value, 10) || 0;
  const cardId       = purchaseCardSelect.value ? Number(purchaseCardSelect.value) : null;
  const purchaseDate = purchaseDateInput.value;
  const firstDate    = firstInstallmentDateInput.value;

  if (!name || isNaN(amount) || amount <= 0 || !installments || installments <= 0 || !cardId || !purchaseDate || !firstDate) return;

  await withLoading(addPurchaseBtn, async () => {
    const { data, error } = await supabaseDb
      .from('card_purchases')
      .insert({
        name, amount, installments,
        paidCount: Math.min(paidCount, installments),
        card_id: cardId,
        purchaseDate,
        firstInstallmentDate: firstDate,
        user_id: currentUserId,
      })
      .select();

    if (error) {
      showToast('Error al agregar compra: ' + error.message, 'error');
      return;
    }
    purchases.unshift(data[0]);
    purchaseNameInput.value = '';
    purchaseAmountInput.value = '';
    purchaseInstallmentsInput.value = '';
    purchasePaidInput.value = '';
    purchaseCardSelect.value = '';
    purchaseDateInput.value = '';
    firstInstallmentDateInput.value = '';
    addPurchaseBtn.disabled = true;
    renderInstallments();
    showToast('Compra agregada', 'success');
  });
});

function renderInstallments() {
  installmentsListEl.innerHTML = '';
  if (purchases.length === 0) {
    installmentsListEl.innerHTML = `
      <div class="installment-empty">
        <span class="empty-icon">💳</span>
        Sin compras en cuotas. ¡Agrega la primera!
      </div>`;
    cardSummaryEl.innerHTML = '';
    updateBalanceSummary();
    return;
  }

  let grandMonthly = 0;
  let grandRemaining = 0;
  const grouped = {};
  purchases.forEach(p => {
    const key = p.card_id || 'none';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(p);
  });

  cards.forEach(card => {
    const cardPurchases = grouped[card.id] || [];
    if (cardPurchases.length === 0) return;

    let cardMonthly = 0, cardRemaining = 0;
    const header = document.createElement('div');
    header.className = 'card-group-header';
    header.innerHTML = `💳 ${escapeHtml(card.name)} <span class="card-group-summary">cierre día ${CARD_CLOSE_DAY}</span>`;
    installmentsListEl.appendChild(header);

    cardPurchases.forEach(p => {
      const stats = renderPurchaseItem(p);
      cardMonthly += stats.monthly;
      cardRemaining += stats.remaining;
      installmentsListEl.appendChild(stats.el);
    });

    const summary = document.createElement('div');
    summary.className = 'card-group-header';
    summary.style.borderTop = '1px solid var(--border)';
    summary.style.borderBottom = 'none';
    summary.style.marginTop = '8px';
    summary.innerHTML = `<span style="font-weight:400;color:var(--muted);font-size:13px;">Total ${escapeHtml(card.name)}: cuota mensual $${cardMonthly.toFixed(2)} · saldo $${cardRemaining.toFixed(2)}</span>`;
    installmentsListEl.appendChild(summary);

    grandMonthly += cardMonthly;
    grandRemaining += cardRemaining;
  });

  if (grouped['none'] && grouped['none'].length > 0) {
    const header = document.createElement('div');
    header.className = 'card-group-header';
    header.innerHTML = `💳 Sin tarjeta asignada`;
    installmentsListEl.appendChild(header);
    let noneMonthly = 0, noneRemaining = 0;
    grouped['none'].forEach(p => {
      const stats = renderPurchaseItem(p);
      noneMonthly += stats.monthly;
      noneRemaining += stats.remaining;
      installmentsListEl.appendChild(stats.el);
    });
    const summary = document.createElement('div');
    summary.className = 'card-group-header';
    summary.style.borderTop = '1px solid var(--border)';
    summary.style.borderBottom = 'none';
    summary.style.marginTop = '8px';
    summary.innerHTML = `<span style="font-weight:400;color:var(--muted);font-size:13px;">Total sin tarjeta: cuota mensual $${noneMonthly.toFixed(2)} · saldo $${noneRemaining.toFixed(2)}</span>`;
    installmentsListEl.appendChild(summary);
    grandMonthly += noneMonthly;
    grandRemaining += noneRemaining;
  }

  cardSummaryEl.innerHTML = `Total general: cuota mensual <strong>$${grandMonthly.toFixed(2)}</strong> · saldo <strong>$${grandRemaining.toFixed(2)}</strong>`;
  updateBalanceSummary();
}

function renderPurchaseItem(p) {
  const installmentAmount = p.amount / p.installments;
  const remaining = p.installments - p.paidCount;
  const monthly = installmentAmount;
  const remainingTotal = installmentAmount * remaining;
  const isComplete = p.paidCount >= p.installments;
  const progressPct = (p.paidCount / p.installments) * 100;

  let boxesHtml = '';
  for (let i = 0; i < p.installments; i++) {
    const dueDate = addMonths(p.firstInstallmentDate, i);
    const isPaid = i < p.paidCount;
    const isCurrent = i === p.paidCount && !isComplete;
    boxesHtml += `
      <div class="box-wrap">
        <div class="box ${isPaid ? 'paid' : ''} ${isCurrent ? 'current' : ''}"
             data-action="toggle" data-pid="${p.id}" data-idx="${i}"
             title="Cuota ${i + 1} — ${monthLabel(dueDate)}">
          ${i + 1}
        </div>
        <span class="box-label">${monthLabel(dueDate).slice(0, 3)}</span>
      </div>`;
  }

  const cardName = p.card_id ? (cards.find(c => c.id === p.card_id)?.name || '—') : '—';
  const item = document.createElement('div');
  item.className = 'installment-item' + (isComplete ? ' is-complete' : '');
  item.innerHTML = `
    <div class="installment-head">
      <div>
        <div class="installment-title">${escapeHtml(p.name)}</div>
        <div class="installment-meta">
          <span>Total: <strong>$${p.amount.toFixed(2)}</strong></span>
          <span>Cuota: <strong>$${installmentAmount.toFixed(2)}</strong></span>
          <span>Tarjeta: <strong>${escapeHtml(cardName)}</strong></span>
          <span>Comprado: <strong>${formatDate(p.purchaseDate)}</strong></span>
          <span>1ª cuota: <strong>${formatDate(p.firstInstallmentDate)}</strong></span>
        </div>
      </div>
      <div class="installment-actions">
        <button class="icon-btn edit" title="Editar" data-action="edit-purchase" data-id="${p.id}">✏️</button>
        <button class="icon-btn delete" title="Eliminar" data-action="delete-purchase" data-id="${p.id}">🗑️</button>
      </div>
    </div>
    <div class="installment-progress">
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${progressPct}%"></div>
      </div>
      <div class="progress-label">
        <span>Cuota ${p.paidCount} de ${p.installments}</span>
        <span class="paid">${isComplete ? 'Completo' : `Faltan ${remaining}`}</span>
      </div>
    </div>
    <div class="installment-boxes">${boxesHtml}</div>`;
  return { el: item, monthly, remaining: remainingTotal };
}

installmentsListEl.addEventListener('click', (e) => {
  const box = e.target.closest('.box[data-action="toggle"]');
  if (box) {
    toggleInstallmentPaid(Number(box.dataset.pid), Number(box.dataset.idx));
    return;
  }
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.action === 'edit-purchase') openEditPurchaseModal(id);
  if (btn.dataset.action === 'delete-purchase') openDeletePurchaseModal(id);
});

/* ─── Toggle cuota pagada (actualiza balance en tiempo real) ─ */
async function toggleInstallmentPaid(purchaseId, boxIndex) {
  const p = purchases.find(x => x.id === purchaseId);
  if (!p) return;

  let newPaidCount = p.paidCount;
  if (boxIndex < p.paidCount) {
    if (boxIndex === p.paidCount - 1) newPaidCount = p.paidCount - 1;
    else return;
  } else if (boxIndex === p.paidCount) {
    newPaidCount = p.paidCount + 1;
  } else {
    return;
  }

  const previousBalance = computeBalance();

  const { error } = await supabaseDb
    .from('card_purchases')
    .update({ paidCount: newPaidCount })
    .eq('id', purchaseId)
    .eq('user_id', currentUserId);

  if (error) {
    showToast('Error al actualizar cuota', 'error');
    return;
  }
  p.paidCount = newPaidCount;
  renderInstallments();

  // Actualizar balance en tiempo real con animación
  const newBalance = computeBalance();
  animateBalance(previousBalance, newBalance);

  const action = newPaidCount > p.paidCount - 1 ? 'pagada' : 'desmarcada';
  showToast(`Cuota ${action} — saldo actualizado`, 'success', 2000);
}

function openEditPurchaseModal(id) {
  const p = purchases.find(x => x.id === id);
  if (!p) return;
  document.getElementById('edit-purchase-name').value         = p.name;
  document.getElementById('edit-purchase-amount').value       = p.amount;
  document.getElementById('edit-purchase-installments').value = p.installments;
  document.getElementById('edit-purchase-paid').value         = p.paidCount;
  document.getElementById('edit-purchase-date').value         = p.purchaseDate;
  document.getElementById('edit-first-installment-date').value = p.firstInstallmentDate;
  const editCardSelect = document.getElementById('edit-purchase-card');
  editCardSelect.value = p.card_id || '';
  editingPurchaseId = id;
  openModal('edit-purchase-modal');
}

document.getElementById('confirm-edit-purchase').addEventListener('click', async () => {
  const name         = document.getElementById('edit-purchase-name').value.trim();
  const amount       = parseFloat(document.getElementById('edit-purchase-amount').value);
  const installments = parseInt(document.getElementById('edit-purchase-installments').value, 10);
  const paidCount    = parseInt(document.getElementById('edit-purchase-paid').value, 10) || 0;
  const cardId       = document.getElementById('edit-purchase-card').value ? Number(document.getElementById('edit-purchase-card').value) : null;
  const purchaseDate = document.getElementById('edit-purchase-date').value;
  const firstDate    = document.getElementById('edit-first-installment-date').value;

  if (!name || isNaN(amount) || amount <= 0 || !installments || installments <= 0 || !purchaseDate || !firstDate) {
    showToast('Completá todos los campos.', 'error');
    return;
  }

  const clampedPaid = Math.min(paidCount, installments);
  const btn = document.getElementById('confirm-edit-purchase');

  await withLoading(btn, async () => {
    const { error } = await supabaseDb
      .from('card_purchases')
      .update({
        name, amount, installments,
        paidCount: clampedPaid,
        card_id: cardId,
        purchaseDate,
        firstInstallmentDate: firstDate,
      })
      .eq('id', editingPurchaseId)
      .eq('user_id', currentUserId);

    if (error) {
      showToast('Error al editar compra: ' + error.message, 'error');
      return;
    }
    const index = purchases.findIndex(x => x.id === editingPurchaseId);
    if (index > -1) {
      purchases[index] = { ...purchases[index], name, amount, installments, paidCount: clampedPaid, card_id: cardId, purchaseDate, firstInstallmentDate };
    }
    closeModal('edit-purchase-modal');
    renderInstallments();
    showToast('Compra actualizada', 'success');
  });
});

function openDeletePurchaseModal(id) {
  deletingPurchaseId = id;
  openModal('delete-purchase-modal');
}

document.getElementById('confirm-delete-purchase').addEventListener('click', async () => {
  const btn = document.getElementById('confirm-delete-purchase');
  await withLoading(btn, async () => {
    const { error } = await supabaseDb
      .from('card_purchases')
      .delete()
      .eq('id', deletingPurchaseId)
      .eq('user_id', currentUserId);

    if (error) {
      showToast('Error al eliminar compra: ' + error.message, 'error');
      return;
    }
    purchases = purchases.filter(x => x.id !== deletingPurchaseId);
    closeModal('delete-purchase-modal');
    renderInstallments();
    showToast('Compra eliminada', 'success');
  });
});

/* ═══════════════════════════════════════════════════════════
   MONTHLY REPORTS
═══════════════════════════════════════════════════════════ */
const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const CHART_COLORS = ['#16A34A','#0EA5E9','#F59E0B','#EF4444','#8B5CF6','#EC4899','#14B8A6','#F97316','#6366F1','#84CC16'];
let reportChart = null;
let reportMonth = new Date().getMonth();
let reportYear  = new Date().getFullYear();

const reportMonthSelect = document.getElementById('report-month');
const reportYearSelect  = document.getElementById('report-year');
const reportPrevBtn     = document.getElementById('report-prev');
const reportNextBtn     = document.getElementById('report-next');
const reportTableEl     = document.getElementById('report-table');
const reportTotalEl     = document.getElementById('report-total');
const reportCountEl     = document.getElementById('report-count');
const reportAvgEl       = document.getElementById('report-avg');
const reportsLegendEl   = document.getElementById('reports-legend');

function initReports() {
  reportMonthSelect.innerHTML = MONTH_NAMES.map((m, i) => `<option value="${i}">${m}</option>`).join('');
  syncReportSelectors();

  reportMonthSelect.addEventListener('change', () => {
    reportMonth = parseInt(reportMonthSelect.value, 10);
    renderReport();
  });
  reportYearSelect.addEventListener('change', () => {
    reportYear = parseInt(reportYearSelect.value, 10);
    renderReport();
  });
  reportPrevBtn.addEventListener('click', () => {
    reportMonth--;
    if (reportMonth < 0) { reportMonth = 11; reportYear--; }
    syncReportSelectors();
    renderReport();
  });
  reportNextBtn.addEventListener('click', () => {
    reportMonth++;
    if (reportMonth > 11) { reportMonth = 0; reportYear++; }
    syncReportSelectors();
    renderReport();
  });
  renderReport();
}

function syncReportSelectors() {
  reportMonthSelect.value = reportMonth;

  const now = new Date();
  const minYear = expenses.length
    ? Math.min(...expenses.map(e => parseInt(e.date.slice(0, 4), 10)))
    : now.getFullYear();
  const maxYear = Math.max(now.getFullYear(), minYear, reportYear);

  let yearsHtml = '';
  for (let y = maxYear; y >= minYear; y--) {
    yearsHtml += `<option value="${y}">${y}</option>`;
  }
  reportYearSelect.innerHTML = yearsHtml;
  reportYearSelect.value = reportYear;
}

function renderReport() {
  const monthStr = String(reportMonth + 1).padStart(2, '0');
  const yearStr  = String(reportYear);
  const filtered = expenses.filter(e => {
    if (!e.date) return false;
    const [y, m] = e.date.split('-');
    return y === yearStr && m === monthStr;
  });

  const total = filtered.reduce((s, e) => s + e.amount, 0);
  const count = filtered.length;
  const avg = count ? total / count : 0;

  reportTotalEl.textContent = total.toFixed(2);
  reportCountEl.textContent = String(count);
  reportAvgEl.textContent   = avg.toFixed(2);

  const byCategory = {};
  filtered.forEach(e => {
    const cat = e.category || 'Otro';
    byCategory[cat] = (byCategory[cat] || 0) + e.amount;
  });

  const cats   = Object.keys(byCategory).sort((a, b) => byCategory[b] - byCategory[a]);
  const values = cats.map(c => byCategory[c]);
  const colors = cats.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

  if (reportChart) { reportChart.destroy(); reportChart = null; }

  const ctx = document.getElementById('reports-chart');
  if (count === 0) {
    const context = ctx.getContext('2d');
    context.clearRect(0, 0, ctx.width, ctx.height);
    context.fillStyle = '#64748B';
    context.font = '14px Inter, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('Sin gastos en este mes', ctx.width / 2, ctx.height / 2);
    reportsLegendEl.innerHTML = '<div class="legend-item" style="justify-content:center;color:var(--muted);">Sin gastos en este mes.</div>';
  } else {
    reportChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: cats.map(c => CATEGORY_LABELS[c] || c),
        datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (tipCtx) => {
                const v = tipCtx.parsed;
                const pct = total ? ((v / total) * 100).toFixed(1) : 0;
                return ` ${tipCtx.label}: $${v.toFixed(2)} (${pct}%)`;
              },
            },
          },
        },
        cutout: '62%',
      },
    });

    reportsLegendEl.innerHTML = cats.map((c, i) => {
      const pct = total ? ((byCategory[c] / total) * 100).toFixed(1) : 0;
      return `<div class="legend-item">
        <span class="legend-dot" style="background:${colors[i]};"></span>
        <span class="legend-label">${CATEGORY_LABELS[c] || c}</span>
        <span class="legend-value">${byCategory[c].toFixed(2)}<span class="legend-pct">${pct}%</span></span>
      </div>`;
    }).join('');
  }

  reportTableEl.innerHTML = '';
  if (filtered.length === 0) {
    const row = document.createElement('tr');
    row.className = 'empty-row';
    row.innerHTML = `<td colspan="5"><span class="empty-icon">📭</span> Sin gastos en ${MONTH_NAMES[reportMonth]} ${reportYear}.</td>`;
    reportTableEl.appendChild(row);
  } else {
    filtered.forEach(e => {
      const row = document.createElement('tr');
      const label = CATEGORY_LABELS[e.category] || e.category;
      const sourceHtml = e.source ? `<span class="source-pill">${escapeHtml(e.source)}</span>` : '—';
      row.innerHTML = `
        <td data-label="Descripción">${escapeHtml(e.name)}</td>
        <td data-label="Monto" class="amount-cell">$${e.amount.toFixed(2)}</td>
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
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');

    if (tab.dataset.tab === 'reports' && reportChart) {
      setTimeout(() => reportChart.resize(), 50);
    }
  });
});

function openModal(id) {
  const el = document.getElementById(id);
  el.classList.add('is-open');
  el.addEventListener('click', backdropClose);
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  const el = document.getElementById(id);
  el.classList.remove('is-open');
  el.removeEventListener('click', backdropClose);
  if (!document.querySelector('.modal.is-open')) {
    document.body.style.overflow = '';
  }
}
function backdropClose(e) {
  if (e.target === e.currentTarget) closeModal(e.currentTarget.id);
}

document.addEventListener('click', (e) => {
  const closeBtn = e.target.closest('[data-close]');
  if (closeBtn) closeModal(closeBtn.dataset.close);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['edit-modal', 'delete-modal', 'edit-purchase-modal', 'delete-purchase-modal', 'delete-card-modal', 'edit-income-modal', 'delete-income-modal'].forEach(closeModal);
  }
});

/* ═══════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════ */
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

/* ═══════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════ */
init();