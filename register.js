/* ═══════════════════════════════════════════════════════════
   Gastos Familiares — Registro
   ═══════════════════════════════════════════════════════════ */

const supabaseUrl = window.ENV.SUPABASE_URL;
const supabaseAnonKey = window.ENV.SUPABASE_ANON_KEY;
const supabaseDb = supabase.createClient(supabaseUrl, supabaseAnonKey);
window.supabase = supabaseDb;

const emailInput = document.getElementById('reg-email');
const passwordInput = document.getElementById('reg-password');
const password2Input = document.getElementById('reg-password2');
const btnRegister = document.getElementById('btn-register');
const errorMsg = document.getElementById('error-msg');
const togglePw = document.getElementById('toggle-pw');
const togglePw2 = document.getElementById('toggle-pw2');

/* ─── Toggle password visibility ───────────────────── */
togglePw.addEventListener('click', () => {
    const isPw = passwordInput.type === 'password';
    passwordInput.type = isPw ? 'text' : 'password';
    togglePw.setAttribute('aria-label', isPw ? 'Ocultar contraseña' : 'Mostrar contraseña');
});
togglePw2.addEventListener('click', () => {
    const isPw = password2Input.type === 'password';
    password2Input.type = isPw ? 'text' : 'password';
    togglePw2.setAttribute('aria-label', isPw ? 'Ocultar contraseña' : 'Mostrar contraseña');
});

/* ─── Show / clear error ────────────────────────────── */
function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.add('show');
}

function clearError() {
    errorMsg.classList.remove('show');
    errorMsg.textContent = '';
}

/* ─── Redirect if already logged in ─────────────────── */
async function checkSession() {
    const { data: { session } } = await supabaseDb.auth.getSession();
    if (session) {
        window.location.href = 'index.html';
    }
}

/* ─── Register ──────────────────────────────────────── */
btnRegister.addEventListener('click', async () => {
    clearError();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const password2 = password2Input.value;

    if (!email || !password || !password2) {
        showError('Por favor completa todos los campos.');
        return;
    }
    if (password.length < 6) {
        showError('La contraseña debe tener al menos 6 caracteres.');
        return;
    }
    if (password !== password2) {
        showError('Las contraseñas no coinciden.');
        return;
    }

    btnRegister.disabled = true;
    btnRegister.innerHTML = '<span class="spinner"></span>';

    const { data, error } = await supabaseDb.auth.signUp({ email, password });

    if (error) {
        btnRegister.disabled = false;
        btnRegister.textContent = 'Registrarme';
        if (error.message.includes('already registered')) {
            showError('Este correo ya está registrado. Inicia sesión.');
        } else {
            showError(error.message);
        }
        return;
    }

    if (data.session) {
        window.location.href = 'index.html';
    } else {
        btnRegister.disabled = false;
        btnRegister.textContent = 'Registrarme';
        showError('Cuenta creada. Inicia sesión para continuar.');
        setTimeout(() => { window.location.href = 'login.html'; }, 1500);
    }
});

/* ─── Enter key submits ─────────────────────────────── */
password2Input.addEventListener('keydown', e => {
    if (e.key === 'Enter') btnRegister.click();
});
emailInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') passwordInput.focus();
});
passwordInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') password2Input.focus();
});

checkSession();
