const expenseTable        = document.getElementById('expense-table');
const totalExpenseDisplay = document.getElementById('total-expense');
const categoryFilter      = document.getElementById('category-filter');
const addExpenseButton    = document.getElementById('add-expense');
const expenseName         = document.getElementById('expense-name');
const expenseAmount       = document.getElementById('expense-amount');
const expenseCategory     = document.getElementById('expense-category');
const expenseDate         = document.getElementById('expense-date');

// Category labels for display
const CATEGORY_LABELS = {
    'Alimentación': '🍽 Alimentación',
    'Transporte':   '🚌 Transporte',
    'Compras':      '🛍 Compras',
    'Otro':         '📦 Otro',
    // Legacy support for old English values
    'Food':      '🍽 Alimentación',
    'Transport': '🚌 Transporte',
    'Shopping':  '🛍 Compras',
    'Other':     '📦 Otro',
};

let expenses = JSON.parse(localStorage.getItem('expenses')) || [];
let editingExpenseId  = null;
let deletingExpenseId = null;

/* ─── Render ───────────────────────────────────────── */
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
            <td colspan="5">
                <span class="empty-icon">📋</span>
                Sin gastos registrados. ¡Agrega el primero!
            </td>`;
        expenseTable.appendChild(row);
    } else {
        filtered.forEach(expense => {
            const row = document.createElement('tr');
            const label = CATEGORY_LABELS[expense.category] || expense.category;
            const dateFormatted = formatDate(expense.date);
            row.innerHTML = `
                <td>${escapeHtml(expense.name)}</td>
                <td class="amount-cell">$${expense.amount.toFixed(2)}</td>
                <td><span class="category-pill">${label}</span></td>
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

    // Total of filtered expenses
    const total = filtered.reduce((sum, e) => sum + e.amount, 0);
    totalExpenseDisplay.textContent = total.toFixed(2);
}

/* ─── Helpers ──────────────────────────────────────── */
function formatDate(dateStr) {
    if (!dateStr) return '—';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ─── Input validation ─────────────────────────────── */
function checkInputs() {
    const valid = expenseName.value.trim() &&
                  expenseAmount.value &&
                  parseFloat(expenseAmount.value) > 0 &&
                  expenseCategory.value &&
                  expenseDate.value;
    addExpenseButton.disabled = !valid;
}

[expenseName, expenseAmount, expenseCategory, expenseDate].forEach(el => {
    el.addEventListener('input', checkInputs);
});

/* ─── Add expense ──────────────────────────────────── */
addExpenseButton.addEventListener('click', () => {
    const name     = expenseName.value.trim();
    const amount   = parseFloat(expenseAmount.value);
    const category = expenseCategory.value;
    const date     = expenseDate.value;

    if (!name || isNaN(amount) || amount <= 0 || !category || !date) return;

    expenses.push({ id: Date.now(), name, amount, category, date });
    localStorage.setItem('expenses', JSON.stringify(expenses));

    expenseName.value   = '';
    expenseAmount.value = '';
    expenseCategory.value = '';
    expenseDate.value   = '';
    addExpenseButton.disabled = true;

    updateUI();
});

/* ─── Edit modal ───────────────────────────────────── */
function openEditModal(id) {
    const expense = expenses.find(e => e.id === id);
    if (!expense) return;

    document.getElementById('edit-expense-name').value     = expense.name;
    document.getElementById('edit-expense-amount').value   = expense.amount;
    document.getElementById('edit-expense-category').value = expense.category;
    document.getElementById('edit-expense-date').value     = expense.date;

    editingExpenseId = id;
    openModal('edit-modal');
}

document.getElementById('confirm-edit').addEventListener('click', () => {
    const name     = document.getElementById('edit-expense-name').value.trim();
    const amount   = parseFloat(document.getElementById('edit-expense-amount').value);
    const category = document.getElementById('edit-expense-category').value;
    const date     = document.getElementById('edit-expense-date').value;

    if (!name || isNaN(amount) || amount <= 0 || !category || !date) {
        alert('Por favor completa todos los campos.');
        return;
    }

    const index = expenses.findIndex(e => e.id === editingExpenseId);
    if (index > -1) {
        expenses[index] = { id: editingExpenseId, name, amount, category, date };
        localStorage.setItem('expenses', JSON.stringify(expenses));
        updateUI();
    }
    closeModal('edit-modal');
});

/* ─── Delete modal ─────────────────────────────────── */
function openDeleteModal(id) {
    deletingExpenseId = id;
    openModal('delete-modal');
}

document.getElementById('confirm-delete').addEventListener('click', () => {
    expenses = expenses.filter(e => e.id !== deletingExpenseId);
    localStorage.setItem('expenses', JSON.stringify(expenses));
    updateUI();
    closeModal('delete-modal');
});

/* ─── Modal helpers ────────────────────────────────── */
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

// Close modals with Escape key
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        ['edit-modal', 'delete-modal', 'edit-purchase-modal', 'delete-purchase-modal'].forEach(closeModal);
    }
});

/* ─── Category filter ──────────────────────────────── */
categoryFilter.addEventListener('change', updateUI);

/* ─── Init ─────────────────────────────────────────── */
updateUI();

/* ═══════════════════════════════════════════════════════════
   CREDIT CARD INSTALLMENT TRACKER
   ═══════════════════════════════════════════════════════════ */

// ─── Tab switching ───────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
    });
});

// ─── Card settings ──────────────────────────────────
const cardCloseDayInput   = document.getElementById('card-close-day');
const saveCardSettingsBtn = document.getElementById('save-card-settings');
const cardSettingsHint    = document.getElementById('card-settings-hint');

let cardSettings = JSON.parse(localStorage.getItem('cardSettings')) || { closeDay: null };

function renderCardSettings() {
    if (cardSettings.closeDay) {
        cardCloseDayInput.value = cardSettings.closeDay;
        cardSettingsHint.textContent = `El resumen cierra el día ${cardSettings.closeDay} de cada mes.`;
    } else {
        cardSettingsHint.textContent = 'Aún no configuraste el día de cierre.';
    }
}

function checkCardSettingsInput() {
    saveCardSettingsBtn.disabled = !cardCloseDayInput.value;
}

cardCloseDayInput.addEventListener('input', checkCardSettingsInput);

saveCardSettingsBtn.addEventListener('click', () => {
    const day = parseInt(cardCloseDayInput.value, 10);
    if (!day || day < 1 || day > 31) return;
    cardSettings = { closeDay: day };
    localStorage.setItem('cardSettings', JSON.stringify(cardSettings));
    saveCardSettingsBtn.disabled = true;
    renderCardSettings();
    renderInstallments();
});

// ─── Purchases (installment plans) ───────────────────
const purchaseNameInput         = document.getElementById('purchase-name');
const purchaseAmountInput       = document.getElementById('purchase-amount');
const purchaseInstallmentsInput = document.getElementById('purchase-installments');
const purchasePaidInput         = document.getElementById('purchase-paid');
const purchaseDateInput         = document.getElementById('purchase-date');
const firstInstallmentDateInput = document.getElementById('first-installment-date');
const addPurchaseBtn            = document.getElementById('add-purchase');
const installmentsListEl        = document.getElementById('installments-list');
const cardSummaryEl             = document.getElementById('card-summary');

let purchases = JSON.parse(localStorage.getItem('cardPurchases')) || [];
let editingPurchaseId  = null;
let deletingPurchaseId = null;

function checkPurchaseInputs() {
    const installments = parseInt(purchaseInstallmentsInput.value, 10) || 0;
    const paid = parseInt(purchasePaidInput.value, 10) || 0;
    const valid = purchaseNameInput.value.trim() &&
                  purchaseAmountInput.value &&
                  parseFloat(purchaseAmountInput.value) > 0 &&
                  installments > 0 &&
                  paid >= 0 && paid <= installments &&
                  purchaseDateInput.value &&
                  firstInstallmentDateInput.value;
    addPurchaseBtn.disabled = !valid;
}

[purchaseNameInput, purchaseAmountInput, purchaseInstallmentsInput, purchasePaidInput, purchaseDateInput, firstInstallmentDateInput]
    .forEach(el => el.addEventListener('input', checkPurchaseInputs));

// ─── Date helpers ────────────────────────────────────
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

// ─── Add purchase ────────────────────────────────────
addPurchaseBtn.addEventListener('click', () => {
    const name         = purchaseNameInput.value.trim();
    const amount       = parseFloat(purchaseAmountInput.value);
    const installments = parseInt(purchaseInstallmentsInput.value, 10);
    const paidCount    = parseInt(purchasePaidInput.value, 10) || 0;
    const purchaseDate = purchaseDateInput.value;
    const firstDate    = firstInstallmentDateInput.value;

    if (!name || isNaN(amount) || amount <= 0 || !installments || installments <= 0 || !purchaseDate || !firstDate) return;

    purchases.push({
        id: Date.now(),
        name,
        amount,
        installments,
        purchaseDate,
        firstInstallmentDate: firstDate,
        paidCount: Math.min(paidCount, installments),
    });
    localStorage.setItem('cardPurchases', JSON.stringify(purchases));

    purchaseNameInput.value         = '';
    purchaseAmountInput.value       = '';
    purchaseInstallmentsInput.value = '';
    purchasePaidInput.value         = '';
    purchaseDateInput.value         = '';
    firstInstallmentDateInput.value = '';
    addPurchaseBtn.disabled = true;

    renderInstallments();
});

// ─── Render installments ─────────────────────────────
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

    let totalMonthly = 0;
    let totalRemaining = 0;

    purchases.forEach(p => {
        const installmentAmount = p.amount / p.installments;
        const remaining = p.installments - p.paidCount;
        totalMonthly += installmentAmount;
        totalRemaining += installmentAmount * remaining;

        const isComplete = p.paidCount >= p.installments;
        const progressPct = (p.paidCount / p.installments) * 100;

        // Build installment boxes
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

        const item = document.createElement('div');
        item.className = 'installment-item' + (isComplete ? ' is-complete' : '');
        item.innerHTML = `
            <div class="installment-head">
                <div>
                    <div class="installment-title">${escapeHtml(p.name)}</div>
                    <div class="installment-meta">
                        <span>Total: <strong>$${p.amount.toFixed(2)}</strong></span>
                        <span>Cuota: <strong>$${installmentAmount.toFixed(2)}</strong></span>
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
        installmentsListEl.appendChild(item);
    });

    cardSummaryEl.innerHTML = `Cuota mensual: <strong>$${totalMonthly.toFixed(2)}</strong> · Saldo: <strong>$${totalRemaining.toFixed(2)}</strong>`;
}

// ─── Toggle installment paid ─────────────────────────
window.toggleInstallmentPaid = function(purchaseId, boxIndex) {
    const p = purchases.find(x => x.id === purchaseId);
    if (!p) return;

    if (boxIndex < p.paidCount) {
        // Only allow unchecking the last paid box (no gaps)
        if (boxIndex === p.paidCount - 1) {
            p.paidCount--;
        }
    } else if (boxIndex === p.paidCount) {
        // Check the next box
        p.paidCount++;
    } else {
        return; // can't check beyond the next one (no gaps)
    }

    localStorage.setItem('cardPurchases', JSON.stringify(purchases));
    renderInstallments();
};

// ─── Edit purchase modal ─────────────────────────────
window.openEditPurchaseModal = function(id) {
    const p = purchases.find(x => x.id === id);
    if (!p) return;

    document.getElementById('edit-purchase-name').value         = p.name;
    document.getElementById('edit-purchase-amount').value       = p.amount;
    document.getElementById('edit-purchase-installments').value = p.installments;
    document.getElementById('edit-purchase-paid').value         = p.paidCount;
    document.getElementById('edit-purchase-date').value         = p.purchaseDate;
    document.getElementById('edit-first-installment-date').value = p.firstInstallmentDate;

    editingPurchaseId = id;
    openModal('edit-purchase-modal');
};

document.getElementById('confirm-edit-purchase').addEventListener('click', () => {
    const name         = document.getElementById('edit-purchase-name').value.trim();
    const amount       = parseFloat(document.getElementById('edit-purchase-amount').value);
    const installments = parseInt(document.getElementById('edit-purchase-installments').value, 10);
    const paidCount    = parseInt(document.getElementById('edit-purchase-paid').value, 10) || 0;
    const purchaseDate = document.getElementById('edit-purchase-date').value;
    const firstDate    = document.getElementById('edit-first-installment-date').value;

    if (!name || isNaN(amount) || amount <= 0 || !installments || installments <= 0 || !purchaseDate || !firstDate) {
        alert('Por favor completa todos los campos.');
        return;
    }

    const index = purchases.findIndex(x => x.id === editingPurchaseId);
    if (index > -1) {
        const clampedPaid = Math.min(paidCount, installments);
        purchases[index] = { ...purchases[index], name, amount, installments, purchaseDate, firstInstallmentDate: firstDate, paidCount: clampedPaid };
        localStorage.setItem('cardPurchases', JSON.stringify(purchases));
        renderInstallments();
    }
    closeModal('edit-purchase-modal');
});

// ─── Delete purchase modal ──────────────────────────
window.openDeletePurchaseModal = function(id) {
    deletingPurchaseId = id;
    openModal('delete-purchase-modal');
};

document.getElementById('confirm-delete-purchase').addEventListener('click', () => {
    purchases = purchases.filter(x => x.id !== deletingPurchaseId);
    localStorage.setItem('cardPurchases', JSON.stringify(purchases));
    renderInstallments();
    closeModal('delete-purchase-modal');
});

// ─── Init card panel ──────────────────────────────────
renderCardSettings();
renderInstallments();
