/* ═══════════════════════════════════════════════════════════
   Gastos Familiares — Supabase backend con autenticación
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

/* ─── State ────────────────────────────────────────── */
let expenses  = [];
let incomes  = [];
let cards    = [];
let purchases = [];
let editingExpenseId   = null;
let deletingExpenseId  = null;
let editingPurchaseId  = null;
let deletingPurchaseId = null;
let deletingCardId     = null;

/* ─── DOM: Expenses ────────────────────────────────── */
const expenseTable        = document.getElementById('expense-table');
const categoryFilter      = document.getElementById('category-filter');
const addExpenseButton    = document.getElementById('add-expense');
const expenseName         = document.getElementById('expense-name');
const expenseAmount       = document.getElementById('expense-amount');
const expenseCategory     = document.getElementById('expense-category');
const expenseSource       = document.getElementById('expense-source');
const expenseDate         = document.getElementById('expense-date');

/* ─── DOM: Incomes ─────────────────────────────────── */
const incomePapaInput = document.getElementById('income-papa');
const incomeMamaInput = document.getElementById('income-mama');

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
const cardSummaryEl            = document.getElementById('card-summary');

/* ─── DOM: Summary ────────────────────────────────── */
const totalBalanceEl    = document.getElementById('total-balance');
const totalIncomesEl    = document.getElementById('total-incomes');
const totalExpensesPaidEl = document.getElementById('total-expenses-paid');

/* ─── DOM: Logout ──────────────────────────────────── */
const btnLogout = document.getElementById('btn-logout');

/* ═══════════════════════════════════════════════════════════
   AUTH GUARD
   ═══════════════════════════════════════════════════════════ */

async function init() {
    const { data: { session } } = await supabaseDb.auth.getSession();
    if (!session) {
        window.location.href = 'login.html';
        return;
    }

    supabaseDb.auth.onAuthStateChange((event, _session) => {
        if (event === 'SIGNED_OUT') {
            window.location.href = 'login.html';
        }
    });

    await loadAll();
}

btnLogout.addEventListener('click', async () => {
    await supabaseDb.auth.signOut();
    window.location.href = 'login.html';
});

/* ═══════════════════════════════════════════════════════════
   DATA LOADING
   ═══════════════════════════════════════════════════════════ */

async function loadAll() {
    // 1. Obtenemos la sesión actual para saber qué usuario está navegando
    const { data: { session } } = await supabaseDb.auth.getSession();
    if (!session) return; // Si no hay sesión, no hacemos nada
    
    const userId = session.user.id;

    // 2. Traemos los datos de Supabase filtrando SOLAMENTE los que coincidan con su user_id
    const [expRes, incRes, cardRes, purRes] = await Promise.all([
        supabaseDb.from('expenses').select('*').eq('user_id', userId).order('date', { ascending: false }),
        supabaseDb.from('incomes').select('*').eq('user_id', userId).order('id'),
        supabaseDb.from('cards').select('*').eq('user_id', userId).order('id'),
        supabaseDb.from('card_purchases').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    ]);

    if (expRes.error)  { console.error('expenses:', expRes.error);  return; }
    if (incRes.error)  { console.error('incomes:', incRes.error);  return; }
    if (cardRes.error) { console.error('cards:', cardRes.error);   return; }
    if (purRes.error)  { console.error('card_purchases:', purRes.error); return; }

    expenses  = expRes.data  || [];
    incomes  = incRes.data  || [];
    cards    = cardRes.data || [];
    purchases = purRes.data || [];

    await ensureDefaultIncomes();

    renderIncomes();
    renderCards();
    renderCardSelectors();
    updateUI();
    renderInstallments();
    initReports();
}

/* Ensure the two default income rows exist for this user */
async function ensureDefaultIncomes() {
    const labels = ['Sueldo Papá', 'Sueldo Mamá'];
    for (const label of labels) {
        if (!incomes.find(i => i.label === label)) {
            const { data, error } = await supabaseDb
                .from('incomes')
                .insert({ label, amount: 0 })
                .select();
            if (!error && data && data[0]) {
                incomes.push(data[0]);
            }
        }
    }
}

/* ═══════════════════════════════════════════════════════════
   INCOMES
   ═══════════════════════════════════════════════════════════ */

function renderIncomes() {
    const papa = incomes.find(i => i.label === 'Sueldo Papá');
    const mama = incomes.find(i => i.label === 'Sueldo Mamá');
    incomePapaInput.value = papa ? papa.amount : 0;
    incomeMamaInput.value = mama ? mama.amount : 0;
    updateBalanceSummary();
}

async function saveIncome(label, amount) {
    const existing = incomes.find(i => i.label === label);
    if (existing) {
        const { error } = await supabaseDb
            .from('incomes')
            .update({ amount, updated_at: new Date().toISOString() })
            .eq('id', existing.id);
        if (error) { console.error(error); return; }
        existing.amount = amount;
    } else {
        const { data, error } = await supabaseDb
            .from('incomes')
            .insert({ label, amount })
            .select();
        if (error) { console.error(error); return; }
        incomes.push(data[0]);
    }
    updateBalanceSummary();
}

let incomeSaveTimer = null;
function scheduleIncomeSave() {
    clearTimeout(incomeSaveTimer);
    incomeSaveTimer = setTimeout(async () => {
        const papa = parseFloat(incomePapaInput.value) || 0;
        const mama = parseFloat(incomeMamaInput.value) || 0;
        await saveIncome('Sueldo Papá', papa);
        await saveIncome('Sueldo Mamá', mama);
    }, 600);
}

incomePapaInput.addEventListener('input', scheduleIncomeSave);
incomeMamaInput.addEventListener('input', scheduleIncomeSave);

function updateBalanceSummary() {
    const totalInc = incomes.reduce((s, i) => s + (i.amount || 0), 0);
    const totalExp = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const balance  = totalInc - totalExp;

    const papaIncome = (incomes.find(i => i.label === 'Sueldo Papá')?.amount) || 0;
    const mamaIncome = (incomes.find(i => i.label === 'Sueldo Mamá')?.amount) || 0;
    const papaExpenses = expenses.filter(e => e.source === 'Sueldo Papá').reduce((s, e) => s + (e.amount || 0), 0);
    const mamaExpenses = expenses.filter(e => e.source === 'Sueldo Mamá').reduce((s, e) => s + (e.amount || 0), 0);

    document.getElementById('balance-papa').textContent = (papaIncome - papaExpenses).toFixed(2);
    document.getElementById('balance-mama').textContent = (mamaIncome - mamaExpenses).toFixed(2);
    totalIncomesEl.textContent      = totalInc.toFixed(2);
    totalExpensesPaidEl.textContent = totalExp.toFixed(2);
    totalBalanceEl.textContent      = balance.toFixed(2);
}

/* ═══════════════════════════════════════════════════════════
   EXPENSES
   ═══════════════════════════════════════════════════════════ */

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

    const { data, error } = await supabaseDb
        .from('expenses')
        .insert({ name, amount, category, source, date })
        .select();
    if (error) { console.error(error); return; }

    expenses.unshift(data[0]);

    expenseName.value   = '';
    expenseAmount.value = '';
    expenseCategory.value = '';
    expenseSource.value = '';
    expenseDate.value   = '';
    addExpenseButton.disabled = true;

    updateUI();
    updateBalanceSummary();
    renderReport();
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
        filtered.forEach(expense => {
            const row = document.createElement('tr');
            const label = CATEGORY_LABELS[expense.category] || expense.category;
            const dateFormatted = formatDate(expense.date);
            const sourceHtml = expense.source
                ? `<span class="source-pill">${escapeHtml(expense.source)}</span>`
                : '—';
            row.innerHTML = `
                <td>${escapeHtml(expense.name)}</td>
                <td class="amount-cell">$${expense.amount.toFixed(2)}</td>
                <td><span class="category-pill">${label}</span></td>
                <td>${sourceHtml}</td>
                <td>${dateFormatted}</td>
                <td>
                    <div class="action-cell">
                        <button class="icon-btn edit" title="Editar" onclick="openEditModal(${expense.id})">✏️</button>
                        <button class="icon-btn delete" title="Eliminar" onclick="openDeleteModal(${expense.id})">🗑️</button>
                    </div>
                </td>`;
            expenseTable.appendChild(row);
        });
    }

    updateBalanceSummary();
}

/* ─── Edit expense ────────────────────────────────── */
window.openEditModal = async function(id) {
    const expense = expenses.find(e => e.id === id);
    if (!expense) return;

    document.getElementById('edit-expense-name').value     = expense.name;
    document.getElementById('edit-expense-amount').value    = expense.amount;
    document.getElementById('edit-expense-category').value  = expense.category;
    document.getElementById('edit-expense-source').value   = expense.source || '';
    document.getElementById('edit-expense-date').value      = expense.date;

    editingExpenseId = id;
    openModal('edit-modal');
};

document.getElementById('confirm-edit').addEventListener('click', async () => {
    const name     = document.getElementById('edit-expense-name').value.trim();
    const amount   = parseFloat(document.getElementById('edit-expense-amount').value);
    const category = document.getElementById('edit-expense-category').value;
    const source   = document.getElementById('edit-expense-source').value;
    const date     = document.getElementById('edit-expense-date').value;

    if (!name || isNaN(amount) || amount <= 0 || !category || !source || !date) {
        alert('Por favor completa todos los campos.');
        return;
    }

    const { error } = await supabaseDb
        .from('expenses')
        .update({ name, amount, category, source, date })
        .eq('id', editingExpenseId);
    if (error) { console.error(error); return; }

    const index = expenses.findIndex(e => e.id === editingExpenseId);
    if (index > -1) {
        expenses[index] = { ...expenses[index], name, amount, category, source, date };
    }
    closeModal('edit-modal');
    updateUI();
    updateBalanceSummary();
    renderReport();
});

/* ─── Delete expense ───────────────────────────────── */
window.openDeleteModal = function(id) {
    deletingExpenseId = id;
    openModal('delete-modal');
};

document.getElementById('confirm-delete').addEventListener('click', async () => {
    const { error } = await supabaseDb
        .from('expenses')
        .delete()
        .eq('id', deletingExpenseId);
    if (error) { console.error(error); return; }

    expenses = expenses.filter(e => e.id !== deletingExpenseId);
    closeModal('delete-modal');
    updateUI();
    updateBalanceSummary();
    renderReport();
});

categoryFilter.addEventListener('change', updateUI);

/* ═══════════════════════════════════════════════════════════
   CREDIT CARDS
   ═══════════════════════════════════════════════════════════ */

function renderCards() {
    cardsListEl.innerHTML = '';
    cards.forEach(card => {
        const chip = document.createElement('div');
        chip.className = 'card-chip';
        chip.innerHTML = `
            <span class="card-chip-name">${escapeHtml(card.name)}</span>
            <span class="card-chip-close">cierre día ${CARD_CLOSE_DAY}</span>
            <button class="card-chip-remove" title="Eliminar tarjeta" onclick="openDeleteCardModal(${card.id})">×</button>`;
        cardsListEl.appendChild(chip);
    });
}

function renderCardSelectors() {
    const optionsHtml = '<option value="" disabled selected>Tarjeta</option>' +
        cards.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    purchaseCardSelect.innerHTML = optionsHtml;
    const editCardSelect = document.getElementById('edit-purchase-card');
    if (editCardSelect) editCardSelect.innerHTML = optionsHtml;
}

/* ─── Add card ─────────────────────────────────────── */
function checkCardInputs() {
    addCardBtn.disabled = !newCardNameInput.value.trim();
}
newCardNameInput.addEventListener('input', checkCardInputs);

addCardBtn.addEventListener('click', async () => {
    const name = newCardNameInput.value.trim();
    if (!name) return;

    const { data, error } = await supabaseDb
        .from('cards')
        .insert({ name, close_day: CARD_CLOSE_DAY })
        .select();
    if (error) { console.error(error); return; }

    cards.push(data[0]);
    newCardNameInput.value = '';
    addCardBtn.disabled = true;

    renderCards();
    renderCardSelectors();
});

/* ─── Delete card ───────────────────────────────────── */
window.openDeleteCardModal = function(id) {
    deletingCardId = id;
    openModal('delete-card-modal');
};

document.getElementById('confirm-delete-card').addEventListener('click', async () => {
    const { error } = await supabaseDb
        .from('cards')
        .delete()
        .eq('id', deletingCardId);
    if (error) { console.error(error); return; }

    cards = cards.filter(c => c.id !== deletingCardId);
    purchases.forEach(p => { if (p.card_id === deletingCardId) p.card_id = null; });

    closeModal('delete-card-modal');
    renderCards();
    renderCardSelectors();
    renderInstallments();
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
    const cardId       = parseInt(purchaseCardSelect.value, 10);
    const purchaseDate = purchaseDateInput.value;
    const firstDate    = firstInstallmentDateInput.value;

    if (!name || isNaN(amount) || amount <= 0 || !installments || installments <= 0 || !cardId || !purchaseDate || !firstDate) return;

    const { data, error } = await supabaseDb
        .from('card_purchases')
        .insert({
            name,
            amount,
            installments,
            paidCount: Math.min(paidCount, installments),
            card_id: cardId,
            purchaseDate,
            firstInstallmentDate: firstDate,
        })
        .select();
    if (error) { console.error(error); return; }

    purchases.unshift(data[0]);

    purchaseNameInput.value         = '';
    purchaseAmountInput.value       = '';
    purchaseInstallmentsInput.value = '';
    purchasePaidInput.value         = '';
    purchaseCardSelect.value        = '';
    purchaseDateInput.value         = '';
    firstInstallmentDateInput.value = '';
    addPurchaseBtn.disabled = true;

    renderInstallments();
});

/* ─── Render installments grouped by card ───────────── */
function renderInstallments() {
    installmentsListEl.innerHTML = '';

    if (purchases.length === 0) {
        installmentsListEl.innerHTML = `
            <div class="installment-empty">
                <span class="empty-icon">💳</span>
                Sin compras en cuotas. ¡Agrega la primera!
            </div>`;
        cardSummaryEl.innerHTML = '';
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

        let cardMonthly = 0;
        let cardRemaining = 0;

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
                     onclick="toggleInstallmentPaid(${p.id}, ${i})"
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
                <button class="icon-btn edit" title="Editar" onclick="openEditPurchaseModal(${p.id})">✏️</button>
                <button class="icon-btn delete" title="Eliminar" onclick="openDeletePurchaseModal(${p.id})">🗑️</button>
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

/* ─── Toggle installment paid ───────────────────────── */
window.toggleInstallmentPaid = async function(purchaseId, boxIndex) {
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

    const { error } = await supabaseDb
        .from('card_purchases')
        .update({ paidCount: newPaidCount })
        .eq('id', purchaseId);
    if (error) { console.error(error); return; }

    p.paidCount = newPaidCount;
    renderInstallments();
};

/* ─── Edit purchase ─────────────────────────────────── */
window.openEditPurchaseModal = function(id) {
    const p = purchases.find(x => x.id === id);
    if (!p) return;

    document.getElementById('edit-purchase-name').value         = p.name;
    document.getElementById('edit-purchase-amount').value     = p.amount;
    document.getElementById('edit-purchase-installments').value = p.installments;
    document.getElementById('edit-purchase-paid').value        = p.paidCount;
    document.getElementById('edit-purchase-date').value        = p.purchaseDate;
    document.getElementById('edit-first-installment-date').value = p.firstInstallmentDate;

    const editCardSelect = document.getElementById('edit-purchase-card');
    if (p.card_id) editCardSelect.value = p.card_id;
    else editCardSelect.value = '';

    editingPurchaseId = id;
    openModal('edit-purchase-modal');
};

document.getElementById('confirm-edit-purchase').addEventListener('click', async () => {
    const name         = document.getElementById('edit-purchase-name').value.trim();
    const amount       = parseFloat(document.getElementById('edit-purchase-amount').value);
    const installments = parseInt(document.getElementById('edit-purchase-installments').value, 10);
    const paidCount    = parseInt(document.getElementById('edit-purchase-paid').value, 10) || 0;
    const cardId       = parseInt(document.getElementById('edit-purchase-card').value, 10) || null;
    const purchaseDate = document.getElementById('edit-purchase-date').value;
    const firstDate    = document.getElementById('edit-first-installment-date').value;

    if (!name || isNaN(amount) || amount <= 0 || !installments || installments <= 0 || !purchaseDate || !firstDate) {
        alert('Por favor completa todos los campos.');
        return;
    }

    const clampedPaid = Math.min(paidCount, installments);

    const { error } = await supabaseDb
        .from('card_purchases')
        .update({
            name, amount, installments,
            paidCount: clampedPaid,
            card_id: cardId,
            purchaseDate,
            firstInstallmentDate: firstDate,
        })
        .eq('id', editingPurchaseId);
    if (error) { console.error(error); return; }

    const index = purchases.findIndex(x => x.id === editingPurchaseId);
    if (index > -1) {
        purchases[index] = { ...purchases[index], name, amount, installments, paidCount: clampedPaid, card_id: cardId, purchaseDate, firstInstallmentDate: firstDate };
    }
    closeModal('edit-purchase-modal');
    renderInstallments();
});

/* ─── Delete purchase ───────────────────────────────── */
window.openDeletePurchaseModal = function(id) {
    deletingPurchaseId = id;
    openModal('delete-purchase-modal');
};

document.getElementById('confirm-delete-purchase').addEventListener('click', async () => {
    const { error } = await supabaseDb
        .from('card_purchases')
        .delete()
        .eq('id', deletingPurchaseId);
    if (error) { console.error(error); return; }

    purchases = purchases.filter(x => x.id !== deletingPurchaseId);
    closeModal('delete-purchase-modal');
    renderInstallments();
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
const reportPrevBtn      = document.getElementById('report-prev');
const reportNextBtn      = document.getElementById('report-next');
const reportTableEl      = document.getElementById('report-table');
const reportTotalEl      = document.getElementById('report-total');
const reportCountEl      = document.getElementById('report-count');
const reportAvgEl        = document.getElementById('report-avg');
const reportsLegendEl    = document.getElementById('reports-legend');

function initReports() {
    reportMonthSelect.innerHTML = MONTH_NAMES.map((m, i) => `<option value="${i}">${m}</option>`).join('');
    const now = new Date();
    const minYear = expenses.length ? Math.min(...expenses.map(e => parseInt(e.date.slice(0,4),10))) : now.getFullYear();
    const maxYear = Math.max(now.getFullYear(), minYear);
    let yearsHtml = '';
    for (let y = maxYear; y >= minYear; y--) yearsHtml += `<option value="${y}">${y}</option>`;
    reportYearSelect.innerHTML = yearsHtml;

    reportMonthSelect.value = reportMonth;
    reportYearSelect.value  = reportYear;

    reportMonthSelect.addEventListener('change', () => { reportMonth = parseInt(reportMonthSelect.value,10); renderReport(); });
    reportYearSelect.addEventListener('change',  () => { reportYear  = parseInt(reportYearSelect.value,10);  renderReport(); });
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
    const minYear = expenses.length ? Math.min(...expenses.map(e => parseInt(e.date.slice(0,4),10))) : reportYear;
    if (reportYear < minYear) {
        let yearsHtml = '';
        for (let y = reportYear; y >= reportYear; y--) yearsHtml += `<option value="${y}">${y}</option>`;
        reportYearSelect.innerHTML = yearsHtml;
    }
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
    reportTotalEl.textContent = `${total.toFixed(2)}`;
    reportCountEl.textContent = String(count);
    reportAvgEl.textContent   = `${avg.toFixed(2)}`;

    const byCategory = {};
    filtered.forEach(e => {
        const cat = e.category || 'Otro';
        byCategory[cat] = (byCategory[cat] || 0) + e.amount;
    });

    const cats = Object.keys(byCategory).sort((a,b) => byCategory[b] - byCategory[a]);
    const values = cats.map(c => byCategory[c]);
    const colors = cats.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

    if (reportChart) reportChart.destroy();

    const ctx = document.getElementById('reports-chart');
    if (count === 0) {
        ctx.getContext('2d').clearRect(0, 0, ctx.width, ctx.height);
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
                            label: (ctx) => {
                                const v = ctx.parsed;
                                const pct = total ? ((v / total) * 100).toFixed(1) : 0;
                                return ` ${ctx.label}: ${v.toFixed(2)} (${pct}%)`;
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
                <td>${escapeHtml(e.name)}</td>
                <td class="amount-cell">${e.amount.toFixed(2)}</td>
                <td><span class="category-pill">${label}</span></td>
                <td>${sourceHtml}</td>
                <td>${formatDate(e.date)}</td>`;
            reportTableEl.appendChild(row);
        });
    }
}

/* ═══════════════════════════════════════════════════════════
   TABS & MODALS
   ═══════════════════════════════════════════════════════════ */

document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
    });
});

function openModal(id) {
    const el = document.getElementById(id);
    el.classList.add('is-open');
    el.addEventListener('click', backdropClose);
}

function closeModal(id) {
    const el = document.getElementById(id);
    el.classList.remove('is-open');
    el.removeEventListener('click', backdropClose);
}

function backdropClose(e) {
    if (e.target === e.currentTarget) closeModal(e.currentTarget.id);
}

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        ['edit-modal', 'delete-modal', 'edit-purchase-modal', 'delete-purchase-modal', 'delete-card-modal'].forEach(closeModal);
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
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
