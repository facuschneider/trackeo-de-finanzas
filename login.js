/* ═══════════════════════════════════════════════════════════
    Gastos Familiares — Login
═══════════════════════════════════════════════════════════ */
const supabaseUrl = window.ENV.SUPABASE_URL;
const supabaseAnonKey = window.ENV.SUPABASE_Anon_KEY ?? window.ENV.SUPABASE_ANON_KEY;
const supabaseDb = supabase.createClient(supabaseUrl, supabaseAnonKey);
window.supabase = supabaseDb;

const emailInput    = document.getElementById('login-email');
const passwordInput = document.getElementById('login-password');
const btnLogin      = document.getElementById('btn-login');
const loginForm     = document.getElementById('login-form');
const errorMsg      = document.getElementById('error-msg');
const togglePw      = document.getElementById('toggle-pw');

/* ─── Toggle password visibility ───────────────────── */
togglePw.addEventListener('click', () => {
  const isPassword = passwordInput.type === 'password';
  passwordInput.type = isPassword ? 'text' : 'password';
  togglePw.setAttribute('aria-label', isPassword ? 'Ocultar contraseña' : 'Mostrar contraseña');
});

/* ─── Show / clear error ───────────────────────────── */
function showError(msg) {
  // Nos aseguramos de extraer el texto si por alguna razón llega un objeto
  errorMsg.textContent = typeof msg === 'object' ? (msg.message || JSON.stringify(msg)) : msg;
  errorMsg.classList.add('show');
}
function clearError() {
  errorMsg.classList.remove('show');
  errorMsg.textContent = '';
}

/* ─── Verified toast y cierre de sesión forzado (Supabase Email Link) ─── */
window.addEventListener('DOMContentLoaded', async () => {
  // 1. Detectamos si la URL viene desde el mail de confirmación (contiene access_token)
  if (window.location.hash.includes('access_token')) {
    const modal = document.getElementById('verified-modal');
    if (modal) {
      // Mostramos tu cartelito/modal personalizado
      modal.style.display = 'flex';
      
      // Limpiamos la URL (borra el hash largo y feo) sin recargar la página
      window.history.replaceState({}, document.title, window.location.pathname);
      
      // Ocultamos el cartel después de 5 segundos
      setTimeout(() => { modal.style.display = 'none'; }, 5000);
    }

    // 2. El truco clave: Forzamos el cierre de sesión automático que hace Supabase
    // para que no salte al index y se quede acá en el login
    try {
      await supabaseDb.auth.signOut();
    } catch (signOutErr) {
      console.error('Error al limpiar sesión automática:', signOutErr);
    }
  }
});

/* ─── Redirect if already logged in ─────────────────── */
async function checkSession() {
  // Si en la URL viene el token del mail, NO comprobamos sesión para evitar redirigir al index
  if (window.location.hash.includes('access_token')) return;

  document.body.classList.add('loading-auth');
  try {
    const { data: { session } } = await supabaseDb.auth.getSession();
    if (session) {
      window.location.href = 'index.html';
      return;
    }
  } catch (err) {
    console.error('Session check failed:', err);
  } finally {
    document.body.classList.remove('loading-auth');
  }
}

/* ─── Login handler (unificado vía form submit) ────── */
async function handleLogin(e) {
  if (e) e.preventDefault();
  clearError();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showError('Por favor ingresa tu correo y contraseña.');
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showError('El formato del correo no es válido.');
    return;
  }

  btnLogin.disabled = true;
  btnLogin.innerHTML = '<span class="spinner"></span>';

  try {
    const { data, error } = await supabaseDb.auth.signInWithPassword({ email, password });

    if (error) {
      btnLogin.disabled = false;
      btnLogin.textContent = 'Entrar';
      
      if (error.message.includes('Invalid login credentials')) {
        showError('Correo o contraseña incorrectos.');
      } else if (error.message.includes('Email not confirmed')) {
        showError('Confirmá tu correo antes de iniciar sesión.');
      } else {
        showError(error.message);
      }
      return;
    }

    window.location.href = 'index.html';
  } catch (err) {
    btnLogin.disabled = false;
    btnLogin.textContent = 'Entrar';
    showError('Error de conexión. Verificá tu internet.');
    console.error(err);
  }
}

loginForm.addEventListener('submit', handleLogin);

/* ─── Enter key navigation ─────────────────────────── */
emailInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); passwordInput.focus(); }
});

/* ─── Escuchador global para cierre de sesión ──────── */
supabaseDb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    const page = (window.location.pathname.split('/').pop() || '').toLowerCase();
    if (page !== 'login.html' && page !== 'register.html') {
      window.location.href = 'login.html';
    }
  }
});

/* ─── Init ─────────────────────────────────────────── */
checkSession();