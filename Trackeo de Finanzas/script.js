// ─── 1. CONFIGURACIÓN E INICIALIZACIÓN DE SUPABASE ───
const SUPABASE_URL = 'https://uboabckurhvfopibbbeo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_MbyFkEEXKir4pXPJjxGqZg_bcx5hRSs';
// CORREGIDO: Se usa window.supabase para evitar error de referencia
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── 2. ELEMENTOS DEL DOM Y CONSTANTES ───
const expenseTable        = document.getElementById('expense-table');
const totalExpenseDisplay = document.getElementById('total-expense');
const categoryFilter      = document.getElementById('category-filter');
const addExpenseButton    = document.getElementById('add-expense');
const expenseName         = document.getElementById('expense-name');
const expenseAmount       = document.getElementById('expense-amount');
const expenseCategory     = document.getElementById('expense-category');
const expenseDate         = document.getElementById('expense-date');

const CATEGORY_LABELS = {
    'Alimentación': '🍽 Alimentación', 'Transporte': '🚌 Transporte',
    'Compras': '🛍 Compras', 'Otro': '📦 Otro',
    'Food': '🍽 Alimentación', 'Transport': '🚌 Transporte',
    'Shopping': '🛍 Compras', 'Other': '📦 Otro',
};

// Arrays globales sincronizados desde la nube
let expenses = [];
let cardSettings = { closeDay: null };
let purchases = [];

let editingExpenseId  = null;
let deletingExpenseId = null;
let editingPurchaseId  = null;
let deletingPurchaseId = null;

// ─── 3. FUNCIONES DE CONEXIÓN ASINCRÓNICA A LA NUBE (SUPABASE) ───

async function loadExpensesFromNube() {
    const { data, error } = await supabaseClient
        .from('expenses')
        .select('*')
        .order('date', { ascending: false });

    if (error) console.error('Error al traer gastos:', error.message);
    else { expenses = data || []; updateUI(); }
}

async function loadCardSettingsFromNube() {
    const { data, error } = await supabaseClient
        .from('card_settings')
        .select('*')
        .limit(1);

    if (error) console.error('Error al traer settings de tarjeta:', error.message);
    else if (data && data.length > 0) {
        // CAMBIO: Mapeamos desde 'closeday' en minúscula que viene de la base de datos
        cardSettings = { closeDay: data[0].closeday }; 
    } else {
        cardSettings = { closeDay: null };
    }
    renderCardSettings();
}

async function loadPurchasesFromNube() {
    const { data, error } = await supabaseClient
        .from('card_purchases')
        .select('*')
        .order('id', { ascending: true });

    if (error) {
        console.error('Error al traer compras de tarjeta:', error.message);
        return;
    }

    // Mapeamos los datos de Supabase asegurando que respeten las mayúsculas
    purchases = (data || []).map(p => ({
        id: p.id,
        name: p.name,
        amount: parseFloat(p.amount),
        installments: parseInt(p.installments, 10),
        purchaseDate: p.purchaseDate,               // Mayúscula igual a Supabase
        firstInstallmentDate: p.firstInstallmentDate, // Mayúscula igual a Supabase
        paidCount: parseInt(p.paidCount, 10) || 0    // Mayúscula igual a Supabase
    }));

    renderInstallments();
}

// ─── 4. MÓDULO: GASTOS COMUNES (RENDER & LOGIC) ───

function updateUI() {
    const filterValue = categoryFilter.value;
    const filtered = filterValue === 'All' ? expenses : expenses.filter(e => e.category === filterValue);
    expenseTable.innerHTML = '';

    if (filtered.length === 0) {
        const row = document.createElement('tr');
        row.className = 'empty-row';
        row.innerHTML = `<td colspan="5"><span class="empty-icon">📋</span>Sin gastos registrados.</td>`;
        expenseTable.appendChild(row);
    } else {
        filtered.forEach(expense => {
            const row = document.createElement('tr');
            const label = CATEGORY_LABELS[expense.category] || expense.category;
            row.innerHTML = `
                <td>${escapeHtml(expense.name)}</td>
                <td class="amount-cell">$${expense.amount.toFixed(2)}</td>
                <td><span class="category-pill">${label}</span></td>
                <td>${formatDate(expense.date)}</td>
                <td>
                    <div class="action-cell">
                        <button class="icon-btn edit" title="Editar" onclick="openEditModal(${expense.id})">✏️</button>
                        <button class="icon-btn delete" title="Eliminar" onclick="openDeleteModal(${expense.id})">🗑️</button>
                    </div>
                </td>`;
            expenseTable.appendChild(row);
        });
    }
    const total = filtered.reduce((sum, e) => sum + e.amount, 0);
    totalExpenseDisplay.textContent = total.toFixed(2);
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function checkInputs() {
    const valid = expenseName.value.trim() && expenseAmount.value && parseFloat(expenseAmount.value) > 0 && expenseCategory.value && expenseDate.value;
    addExpenseButton.disabled = !valid;
}
[expenseName, expenseAmount, expenseCategory, expenseDate].forEach(el => el.addEventListener('input', checkInputs));

addExpenseButton.addEventListener('click', async () => {
    const name = expenseName.value.trim();
    const amount = parseFloat(expenseAmount.value);
    const category = expenseCategory.value;
    const date = expenseDate.value;

    if (!name || isNaN(amount) || amount <= 0 || !category || !date) return;
    addExpenseButton.disabled = true;

    const { error } = await supabaseClient.from('expenses').insert([{ name, amount, category, date }]);
    if (error) { alert('Error: ' + error.message); addExpenseButton.disabled = false; return; }

    expenseName.value = ''; expenseAmount.value = ''; expenseCategory.value = ''; expenseDate.value = '';
    await loadExpensesFromNube();
});

function openEditModal(id) {
    const expense = expenses.find(e => e.id === id);
    if (!expense) return;
    document.getElementById('edit-expense-name').value = expense.name;
    document.getElementById('edit-expense-amount').value = expense.amount;
    document.getElementById('edit-expense-category').value = expense.category;
    document.getElementById('edit-expense-date').value = expense.date;
    editingExpenseId = id;
    openModal('edit-modal');
}

document.getElementById('confirm-edit').addEventListener('click', async () => {
    const name = document.getElementById('edit-expense-name').value.trim();
    const amount = parseFloat(document.getElementById('edit-expense-amount').value);
    const category = document.getElementById('edit-expense-category').value;
    const date = document.getElementById('edit-expense-date').value;

    if (!name || isNaN(amount) || amount <= 0 || !category || !date) return;

    // CORREGIDO: Actualización directo en Supabase
    const { error } = await supabaseClient.from('expenses').update({ name, amount, category, date }).eq('id', editingExpenseId);
    if (error) alert('Error al editar: ' + error.message);
    
    await loadExpensesFromNube();
    closeModal('edit-modal');
});

document.getElementById('open-delete-modal'); // Referencia interna ficticia
function openDeleteModal(id) { deletingExpenseId = id; openModal('delete-modal'); }

document.getElementById('confirm-delete').addEventListener('click', async () => {
    // CORREGIDO: Eliminación directa en Supabase
    const { error } = await supabaseClient.from('expenses').delete().eq('id', deletingExpenseId);
    if (error) alert('Error al eliminar: ' + error.message);
    
    await loadExpensesFromNube();
    closeModal('delete-modal');
});

/* ─── MODAL HELPERS ─── */
function openModal(id) { const el = document.getElementById(id); el.classList.add('is-open'); el.addEventListener('click', backdropClose); }
function closeModal(id) { const el = document.getElementById(id); el.classList.remove('is-open'); el.removeEventListener('click', backdropClose); }
function backdropClose(e) { if (e.target === e.currentTarget) closeModal(e.currentTarget.id); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') ['edit-modal', 'delete-modal', 'edit-purchase-modal', 'delete-purchase-modal'].forEach(closeModal); });
categoryFilter.addEventListener('change', updateUI);

/* ═══════════════════════════════════════════════════════════
   MÓDULO: TARJETA DE CRÉDITO (CON CIERRE AUTOMÁTICO EN LA NUBE)
   ═══════════════════════════════════════════════════════════ */

document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
    });
});

const cardCloseDayInput   = document.getElementById('card-close-day');
const saveCardSettingsBtn = document.getElementById('save-card-settings');
const cardSettingsHint    = document.getElementById('card-settings-hint');

function renderCardSettings() {
    if (cardSettings.closeDay) {
        cardCloseDayInput.value = cardSettings.closeDay;
        cardSettingsHint.textContent = `El resumen cierra el día ${cardSettings.closeDay} de cada mes.`;
    } else {
        cardSettingsHint.textContent = 'Aún no configuraste el día de cierre.';
    }
}

cardCloseDayInput.addEventListener('input', () => { saveCardSettingsBtn.disabled = !cardCloseDayInput.value; });

saveCardSettingsBtn.addEventListener('click', async () => {
    const day = parseInt(cardCloseDayInput.value, 10);
    if (!day || day < 1 || day > 31) return;

    saveCardSettingsBtn.disabled = true;

    try {
        const { data, error: selectError } = await supabaseClient.from('card_settings').select('*');
        if (selectError) throw selectError;

        let error;
        if (data && data.length > 0) {
            // CAMBIO: Enviamos 'closeday' en minúscula
            const { error: updateError } = await supabaseClient
                .from('card_settings')
                .update({ closeday: day }) 
                .eq('id', data[0].id);
            error = updateError;
        } else {
            // CAMBIO: Enviamos 'closeday' en minúscula
            const { error: insertError } = await supabaseClient
                .from('card_settings')
                .insert([{ closeday: day }]);
            error = insertError;
        }

        if (error) throw error;

        await loadCardSettingsFromNube();
        await loadPurchasesFromNube();
        
    } catch (err) {
        console.error("Error crítico al guardar cierre:", err.message);
        alert("No se pudo guardar en la nube: " + err.message);
        saveCardSettingsBtn.disabled = false;
    }
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

function checkPurchaseInputs() {
    const installments = parseInt(purchaseInstallmentsInput.value, 10) || 0;
    const paid = parseInt(purchasePaidInput.value, 10) || 0;
    addPurchaseBtn.disabled = !(purchaseNameInput.value.trim() && purchaseAmountInput.value && parseFloat(purchaseAmountInput.value) > 0 && installments > 0 && paid >= 0 && paid <= installments && purchaseDateInput.value && firstInstallmentDateInput.value);
}
[purchaseNameInput, purchaseAmountInput, purchaseInstallmentsInput, purchasePaidInput, purchaseDateInput, firstInstallmentDateInput].forEach(el => el.addEventListener('input', checkPurchaseInputs));

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

// CORREGIDO: Envía los nombres con las mayúsculas idénticas a tu Supabase
addPurchaseBtn.addEventListener('click', async () => {
    const name         = purchaseNameInput.value.trim();
    const amount       = parseFloat(purchaseAmountInput.value);
    const installments = parseInt(purchaseInstallmentsInput.value, 10);
    const paidCount    = parseInt(purchasePaidInput.value, 10) || 0;
    const purchaseDate = purchaseDateInput.value;
    const firstDate    = firstInstallmentDateInput.value;

    if (!name || isNaN(amount) || amount <= 0 || !installments || installments <= 0 || !purchaseDate || !firstDate) return;
    addPurchaseBtn.disabled = true;

    // Ajustado a las columnas exactas de tu captura de pantalla
    const { error } = await supabaseClient.from('card_purchases').insert([{
        name, 
        amount, 
        installments, 
        purchaseDate, 
        firstInstallmentDate: firstDate, 
        paidCount: Math.min(paidCount, installments)
    }]);

    if (error) { alert('Error: ' + error.message); addPurchaseBtn.disabled = false; return; }

    purchaseNameInput.value = ''; purchaseAmountInput.value = ''; purchaseInstallmentsInput.value = ''; purchasePaidInput.value = ''; purchaseDateInput.value = ''; firstInstallmentDateInput.value = '';
    await loadPurchasesFromNube();
});

// CORREGIDO: Mapea correctamente las propiedades calculadas al vuelo
function renderInstallments() {
    installmentsListEl.innerHTML = '';
    if (purchases.length === 0) {
        installmentsListEl.innerHTML = `<div class="installment-empty"><span class="empty-icon">💳</span>Sin compras en cuotas.</div>`;
        cardSummaryEl.innerHTML = ''; return;
    }

    let totalMonthly = 0, totalRemaining = 0;
    const hoy = new Date();

    purchases.forEach(p => {
        // Lógica de cierre automático usando las propiedades exactas de tu base de datos
        if (cardSettings && cardSettings.closeDay) {
            let cuotasVencidas = 0;
            for (let i = 0; i < p.installments; i++) {
                const fechaCuotaStr = addMonths(p.firstInstallmentDate, i);
                const fechaCuota = new Date(fechaCuotaStr + 'T00:00:00');
                fechaCuota.setDate(cardSettings.closeDay);

                if (fechaCuota <= hoy) cuotasVencidas++;
                else break;
            }
            if (cuotasVencidas > p.paidCount) {
                p.paidCount = cuotasVencidas;
            }
        }

        const installmentAmount = p.amount / p.installments;
        const remaining = p.installments - p.paidCount;
        totalMonthly += installmentAmount;
        totalRemaining += installmentAmount * remaining;

        const isComplete = p.paidCount >= p.installments;
        const progressPct = (p.paidCount / p.installments) * 100;

        let boxesHtml = '';
        for (let i = 0; i < p.installments; i++) {
            const dueDate = addMonths(p.firstInstallmentDate, i);
            boxesHtml += `
                <div class="box-wrap">
                    <div class="box ${i < p.paidCount ? 'paid' : ''} ${(i === p.paidCount && !isComplete) ? 'current' : ''}"
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
                        <span>1ª cuota: <strong>${formatDate(p.firstInstallmentDate)}</strong></span>
                    </div>
                </div>
                <div class="installment-actions">
                    <button class="icon-btn edit" title="Editar" onclick="openEditPurchaseModal(${p.id})">✏️</button>
                    <button class="icon-btn delete" title="Eliminar" onclick="openDeletePurchaseModal(${p.id})">🗑️</button>
                </div>
            </div>
            <div class="installment-progress">
                <div class="progress-bar"><div class="progress-fill" style="width: ${progressPct}%"></div></div>
                <div class="progress-label"><span>Cuota ${p.paidCount} de ${p.installments}</span><span class="paid">${isComplete ? 'Completo' : `Faltan ${remaining}`}</span></div>
            </div>
            <div class="installment-boxes">${boxesHtml}</div>`;
        installmentsListEl.appendChild(item);
    });

    cardSummaryEl.innerHTML = `Cuota mensual: <strong>$${totalMonthly.toFixed(2)}</strong> · Saldo: <strong>$${totalRemaining.toFixed(2)}</strong>`;
}

// CORREGIDO: Sincroniza el click manual respetando la mayúscula 'paidCount'
window.toggleInstallmentPaid = async function(purchaseId, boxIndex) {
    const p = purchases.find(x => x.id === purchaseId);
    if (!p) return;

    let nuevoPaidCount = p.paidCount;
    if (boxIndex < p.paidCount && boxIndex === p.paidCount - 1) nuevoPaidCount--;
    else if (boxIndex === p.paidCount) nuevoPaidCount++;
    else return;

    const { error } = await supabaseClient.from('card_purchases').update({ paidCount: nuevoPaidCount }).eq('id', purchaseId);
    if (!error) await loadPurchasesFromNube();
};

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

// CORREGIDO: Edición con nombres de columnas exactos
document.getElementById('confirm-edit-purchase').addEventListener('click', async () => {
    const name         = document.getElementById('edit-purchase-name').value.trim();
    const amount       = parseFloat(document.getElementById('edit-purchase-amount').value);
    const installments = parseInt(document.getElementById('edit-purchase-installments').value, 10);
    const paidCount    = parseInt(document.getElementById('edit-purchase-paid').value, 10) || 0;
    const purchaseDate = document.getElementById('edit-purchase-date').value;
    const firstDate    = document.getElementById('edit-first-installment-date').value;

    if (!name || isNaN(amount) || amount <= 0 || !installments || installments <= 0 || !purchaseDate || !firstDate) return;

    const clampedPaid = Math.min(paidCount, installments);
    const { error } = await supabaseClient.from('card_purchases').update({ 
        name, 
        amount, 
        installments, 
        purchaseDate, 
        firstInstallmentDate: firstDate, 
        paidCount: clampedPaid 
    }).eq('id', editingPurchaseId);
    
    if (error) alert('Error: ' + error.message);
    await loadPurchasesFromNube();
    closeModal('edit-purchase-modal');
});

window.openDeletePurchaseModal = function(id) { deletingPurchaseId = id; openModal('delete-purchase-modal'); };

document.getElementById('confirm-delete-purchase').addEventListener('click', async () => {
    const { error } = await supabaseClient.from('card_purchases').delete().eq('id', deletingPurchaseId);
    if (error) alert('Error: ' + error.message);
    await loadPurchasesFromNube();
    closeModal('delete-purchase-modal');
});
// ─── 5. CONTROLADOR DE INICIALIZACIÓN ASINCRÓNICA GENERAL ───
async function initApp() {
    // Intentamos cargar gastos comunes
    try {
        await loadExpensesFromNube();
    } catch (e) {
        console.error("Error al iniciar gastos comunes:", e);
    }
    
    // Intentamos cargar la configuración del cierre
    try {
        await loadCardSettingsFromNube();
    } catch (e) {
        console.error("Error al iniciar configuración de tarjeta:", e);
    }
    
    // Intentamos cargar las compras en cuotas
    try {
        await loadPurchasesFromNube();
    } catch (e) {
        console.error("Error al iniciar compras en cuotas:", e);
    }
}

// Ejecutamos la inicialización general
initApp();