/* ═══════════════════════════════════════════════════════════
   Gastos Familiares — Login
   ═══════════════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', () => {
    // Revisamos los parámetros de la URL
    const urlParams = new URLSearchParams(window.location.search);
    
    // Si la URL contiene "?verified=true", mostramos el cartel
    if (urlParams.get('verified') === 'true') {
        const modal = document.getElementById('verified-modal');
        if (modal) {
            modal.style.display = 'flex';
            
            // Opcional: Que se cierre solo después de 5 segundos
            setTimeout(() => {
                modal.style.display = 'none';
            }, 5000);
        }
    }
});
const supabaseUrl = window.ENV.SUPABASE_URL;
const supabaseAnonKey = window.ENV.SUPABASE_ANON_KEY;
const supabaseDb = supabase.createClient(supabaseUrl, supabaseAnonKey);
window.supabase = supabaseDb;

const emailInput = document.getElementById('login-email');
const passwordInput = document.getElementById('login-password');
const btnLogin = document.getElementById('btn-login');
const errorMsg = document.getElementById('error-msg');
const togglePw = document.getElementById('toggle-pw');

/* ─── Toggle password visibility ───────────────────── */
togglePw.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    togglePw.setAttribute('aria-label', isPassword ? 'Ocultar contraseña' : 'Mostrar contraseña');
});

/* ─── Show error ────────────────────────────────────── */
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

/* ─── Login ─────────────────────────────────────────── */
btnLogin.addEventListener('click', async () => {
    clearError();
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
        showError('Por favor ingresa tu correo y contraseña.');
        return;
    }

    btnLogin.disabled = true;
    btnLogin.innerHTML = '<span class="spinner"></span>';

    const { data, error } = await supabaseDb.auth.signInWithPassword({ email, password });

    if (error) {
        btnLogin.disabled = false;
        btnLogin.textContent = 'Entrar';
        if (error.message.includes('Invalid login credentials')) {
            showError('Correo o contraseña incorrectos.');
        } else {
            showError(error.message);
        }
        return;
    }

    window.location.href = 'index.html';
});

/* ─── Enter key submits ─────────────────────────────── */
passwordInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') btnLogin.click();
});
emailInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') passwordInput.focus();
});

checkSession();
