/* ═══════════════════════════════════════════════════════════
   PACERUN — app.js
   Lógica completa: Auth, Activity Tracking, Feed IA,
   Comunidade, Ranking, Progresso, Perfil, Compartilhamento
   ═══════════════════════════════════════════════════════════ */

'use strict';

// ── Estado global ─────────────────────────────────────────
const State = {
  user: null,
  userProfile: null,
  activity: {
    running: false,
    paused: false,
    type: 'running',
    startTime: null,
    pausedTime: 0,
    pauseStart: null,
    intervalId: null,
    watchId: null,
    positions: [],
    distance: 0,
    duration: 0,
    speeds: [],
    maxSpeed: 0,
    photo: null,
  },
  currentPage: 'activity',
  currentActivity: null, // para compartilhar depois
  map: null,
  polyline: null,
  userMarker: null,
};

// ── Aguarda Firebase estar pronto ─────────────────────────
window.addEventListener('firebase-ready', init);

function init() {
  const { auth, onAuthStateChanged } = window.__firebase;

  // Esconde splash após 2s
  setTimeout(() => {
    document.getElementById('splash').style.display = 'none';
    onAuthStateChanged(auth, handleAuthChange);
  }, 2000);
}

// ── Auth State ────────────────────────────────────────────
let _appSetupDone = false;

async function handleAuthChange(user) {
  if (user) {
    State.user = user;
    await loadUserProfile(user.uid);

    // Bloqueia acesso se o perfil não foi completado (cadastro via link pendente)
    const profileComplete = State.userProfile?.name && State.userProfile.name.trim() !== '';
    if (!profileComplete) {
      // Usuário logado via email-link mas ainda não completou o perfil
      document.getElementById('auth-screen').classList.remove('hidden');
      document.getElementById('app').classList.add('hidden');
      window._pendingUser = user;
      window._pendingEmail = user.email;
      showAuthStep('complete');
      if (!_appSetupDone) { setupAuth(); }
      return;
    }

    showApp();
    if (!_appSetupDone) {
      _appSetupDone = true;
      setupApp();
    } else {
      // Re-login: só atualiza o header
      updateHeaderUI();
      loadProfileData();
    }
  } else {
    _appSetupDone = false;
    showAuth();
    setupAuth();
  }
}

async function loadUserProfile(uid) {
  const { db, doc, getDoc } = window.__firebase;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      State.userProfile = snap.data();
    } else {
      // Perfil ainda não criado (usuário no meio do fluxo de cadastro)
      State.userProfile = { name: '', weight: 70, totalRuns: 0, totalDistance: 0, totalDuration: 0 };
    }
  } catch (e) {
    console.error('loadUserProfile error:', e);
    State.userProfile = { name: '', weight: 70, totalRuns: 0, totalDistance: 0, totalDuration: 0 };
  }
  updateHeaderUI();
}

// ── Auth UI ───────────────────────────────────────────────
function showAuth() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  showAuthStep('login');
  setTimeout(() => {
    const saved = getSavedCredentials();
    if (saved) {
      const emailEl = document.getElementById('login-email');
      const pwdEl = document.getElementById('login-password');
      const keepEl = document.getElementById('keep-connected');
      if (emailEl) emailEl.value = saved.email || '';
      if (pwdEl) pwdEl.value = saved.password || '';
      if (keepEl) keepEl.checked = true;
    } else {
      const emailEl = document.getElementById('login-email');
      const pwdEl = document.getElementById('login-password');
      if (emailEl) emailEl.value = '';
      if (pwdEl) pwdEl.value = '';
    }
  }, 100);
}

// ── Credenciais salvas (manter conectado) ─────────────────
function getSavedCredentials() {
  try {
    const raw = localStorage.getItem('pacerun_saved_creds');
    return raw ? JSON.parse(atob(raw)) : null;
  } catch { return null; }
}
function saveCredentials(email, password) {
  localStorage.setItem('pacerun_saved_creds', btoa(JSON.stringify({ email, password })));
}
function clearCredentials() {
  localStorage.removeItem('pacerun_saved_creds');
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

// ── Helpers de navegação entre etapas ────────────────────
function showAuthStep(step) {
  ['auth-step-login', 'auth-step-email', 'auth-step-complete'].forEach(id => {
    document.getElementById(id)?.classList.add('hidden');
  });
  document.getElementById('auth-step-' + step)?.classList.remove('hidden');
}

function setupAuth() {
  // ── ETAPA 1: Login ────────────────────────────────────
  document.getElementById('btn-login').addEventListener('click', async () => {
    const { auth, signInWithEmailAndPassword } = window.__firebase;
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const keepMe = document.getElementById('keep-connected')?.checked || false;
    const errEl = document.getElementById('login-error');
    const btn = document.getElementById('btn-login');

    if (!email || !password) { showError(errEl, 'Preencha e-mail e senha.'); return; }

    btn.textContent = 'Entrando...';
    btn.disabled = true;
    try {
      await signInWithEmailAndPassword(auth, email, password);
      keepMe ? saveCredentials(email, password) : clearCredentials();
    } catch (e) {
      showError(errEl, authErrorMsg(e.code));
    } finally {
      btn.textContent = 'Entrar';
      btn.disabled = false;
    }
  });

  // Navega para cadastro
  document.getElementById('btn-go-register').addEventListener('click', () => {
    showAuthStep('email');
  });

  // Volta para login
  document.getElementById('btn-back-to-login').addEventListener('click', () => {
    showAuthStep('login');
  });

  // Esqueci senha
  document.getElementById('btn-forgot').addEventListener('click', async () => {
    const { auth, sendPasswordResetEmail } = window.__firebase;
    const email = document.getElementById('login-email').value.trim();
    const errEl = document.getElementById('login-error');
    if (!email) { showError(errEl, 'Digite seu e-mail acima primeiro.'); return; }
    try {
      await sendPasswordResetEmail(auth, email);
      showToast('✉️ E-mail de recuperação enviado!');
    } catch (e) {
      showError(errEl, 'E-mail não encontrado.');
    }
  });

  // ── ETAPA 2: Envia link de cadastro por e-mail ─────────
  document.getElementById('btn-send-link').addEventListener('click', async () => {
    const { auth, sendSignInLinkToEmail } = window.__firebase;
    const email = document.getElementById('reg-email').value.trim();
    const errEl = document.getElementById('reg-error');
    const succEl = document.getElementById('reg-success');
    const btn = document.getElementById('btn-send-link');

    if (!email || !email.includes('@')) {
      showError(errEl, 'Digite um e-mail válido.'); return;
    }

    btn.textContent = 'Enviando...';
    btn.disabled = true;

    // URL que o Firebase vai redirecionar após o clique no e-mail
    // Deve ser a URL exata do seu app no GitHub Pages
    const actionCodeSettings = {
      url: 'https://rafaelandrade88.github.io/pacerun/',
      handleCodeInApp: true,
    };

    try {
      await sendSignInLinkToEmail(auth, email, actionCodeSettings);
      // Salva o e-mail localmente para recuperar na etapa 3
      window.localStorage.setItem('pacerun_email_for_link', email);
      errEl.classList.add('hidden');
      succEl.classList.remove('hidden');
      btn.textContent = 'Link enviado ✓';
    } catch (e) {
      console.error(e);
      showError(errEl, authErrorMsg(e.code) || 'Erro ao enviar e-mail. Tente novamente.');
      btn.textContent = 'Enviar link de acesso';
      btn.disabled = false;
    }
  });

  // ── ETAPA 3: Completa cadastro (retorno do link) ───────
  document.getElementById('btn-complete-register')?.addEventListener('click', completeRegistration);

  // Verifica ao carregar se a URL tem um link de sign-in do Firebase
  checkEmailLink();
}

// ── Verifica se a URL atual é um link de sign-in Firebase ──
async function checkEmailLink() {
  const { auth, isSignInWithEmailLink, signInWithEmailLink, db,
    doc, setDoc, getDoc, updateProfile, serverTimestamp } = window.__firebase;

  if (!isSignInWithEmailLink(auth, window.location.href)) return;

  // É um link de cadastro — recupera o e-mail salvo
  let email = window.localStorage.getItem('pacerun_email_for_link');
  if (!email) {
    // Se abriu em outro dispositivo, pede o e-mail
    email = window.prompt('Por favor, confirme seu e-mail para concluir o cadastro:');
    if (!email) return;
  }

  try {
    // Faz o sign-in via link
    const result = await signInWithEmailLink(auth, email, window.location.href);
    window.localStorage.removeItem('pacerun_email_for_link');

    // Limpa a URL para não reutilizar o link
    window.history.replaceState(null, '', '/pacerun/');

    // Verifica se o perfil já existe (re-abertura do link)
    const snap = await getDoc(doc(db, 'users', result.user.uid));
    if (snap.exists() && snap.data().name) {
      // Já completou antes — só entra
      return;
    }

    // Primeiro acesso — mostra etapa 3
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
    showAuthStep('complete');
    // Armazena email temporariamente para etapa 3
    window._pendingUser = result.user;
    window._pendingEmail = email;

  } catch (e) {
    console.error('Email link error:', e);
    showToast('Link inválido ou expirado. Solicite um novo.');
    showAuthStep('login');
  }
}

// ── Finaliza cadastro com nome + senha ──────────────────
async function completeRegistration() {
  const { auth, db, updateProfile, doc, setDoc, serverTimestamp } = window.__firebase;

  const name = document.getElementById('complete-name').value.trim();
  const pass1 = document.getElementById('complete-password').value;
  const pass2 = document.getElementById('complete-password2').value;
  const errEl = document.getElementById('complete-error');
  const btn = document.getElementById('btn-complete-register');

  if (!name) { showError(errEl, 'Digite seu nome.'); return; }
  if (pass1.length < 6) { showError(errEl, 'Senha deve ter pelo menos 6 caracteres.'); return; }
  if (pass1 !== pass2) { showError(errEl, 'As senhas não coincidem.'); return; }

  btn.textContent = 'Criando conta...';
  btn.disabled = true;

  try {
    const user = window._pendingUser || auth.currentUser;
    if (!user) {
      showError(errEl, 'Sessão expirada. Feche o app, clique no link do e-mail novamente e tente outra vez.');
      btn.textContent = 'Criar minha conta';
      btn.disabled = false;
      return;
    }

    // 1. Atualiza o nome de exibição
    await updateProfile(user, { displayName: name });

    // 2. Define a senha usando updatePassword (funciona para usuários Email Link)
    const { updatePassword } = window.__firebase;
    try {
      await updatePassword(user, pass1);
    } catch (pwErr) {
      // requires-recent-login: o token do email link já expirou
      if (pwErr.code === 'auth/requires-recent-login') {
        showError(errEl, 'Por segurança, o link expirou. Solicite um novo link de acesso.');
        btn.textContent = 'Criar minha conta';
        btn.disabled = false;
        return;
      }
      // Outros erros de senha: loga mas não impede — o usuário pode definir senha depois
      console.warn('updatePassword warning:', pwErr.code);
    }

    // 3. Cria o perfil no Firestore
    await setDoc(doc(db, 'users', user.uid), {
      name,
      email: user.email || window._pendingEmail || '',
      weight: 70,
      photoURL: '',
      totalRuns: 0,
      totalDistance: 0,
      totalDuration: 0,
      createdAt: serverTimestamp(),
    });

    // 4. Limpa estado temporário
    window._pendingUser = null;
    window._pendingEmail = null;

    // 5. Atualiza perfil local e abre o app
    State.userProfile = { name, weight: 70, totalRuns: 0, totalDistance: 0, totalDuration: 0, photoURL: '' };
    updateHeaderUI();

    showToast('🎉 Bem-vindo ao PaceRun, ' + name.split(' ')[0] + '!');

    // Esconde auth e abre o app manualmente (não espera onAuthStateChanged)
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    if (!_appSetupDone) {
      _appSetupDone = true;
      setupApp();
    }

  } catch (e) {
    console.error('completeRegistration error:', e.code, e.message);
    const msg = e.code === 'permission-denied'
      ? 'Permissão negada no Firestore. Verifique as regras.'
      : e.code === 'auth/weak-password'
        ? 'Senha muito fraca. Use pelo menos 6 caracteres.'
        : `Erro: ${e.message || e.code}`;
    showError(errEl, msg);
    btn.textContent = 'Criar minha conta';
    btn.disabled = false;
  }
}

function authErrorMsg(code) {
  const msgs = {
    'auth/user-not-found': 'Usuário não encontrado.',
    'auth/wrong-password': 'Senha incorreta.',
    'auth/invalid-email': 'E-mail inválido.',
    'auth/email-already-in-use': 'E-mail já cadastrado.',
    'auth/weak-password': 'Senha muito fraca.',
    'auth/too-many-requests': 'Muitas tentativas. Tente novamente mais tarde.',
    'auth/invalid-credential': 'E-mail ou senha inválidos.',
  };
  return msgs[code] || 'Erro ao autenticar. Tente novamente.';
}

// ── App Setup ─────────────────────────────────────────────
function setupApp() {
  setupNav();
  setupActivityPage();
  setupProfilePage();
  setupNotifications();
  setupHamburgerMenu();
  setupRaces();
  window.RACES_DATABASE = RACES_DATABASE;
  navigateTo('activity');
  loadFeed();
  loadRanking('distance');
  loadProfileData();
  setTimeout(checkCommunityNotifications, 3000);
  setTimeout(checkInterruptedActivity, 1500);
}

function updateHeaderUI() {
  const name = State.userProfile?.name || State.user?.displayName || 'Atleta';
  const firstName = name.split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia,' : hour < 18 ? 'Boa tarde,' : 'Boa noite,';

  document.getElementById('header-name').textContent = firstName;
  document.querySelector('.header-greeting').textContent = greeting;

  const avatarUrl = State.userProfile?.photoURL || getAvatarUrl(name);
  document.getElementById('header-avatar').src = avatarUrl;
}

function getAvatarUrl(name) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=1A6BF0&color=fff&size=64&bold=true`;
}

// ── Navigation ────────────────────────────────────────────
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      if (page) navigateTo(page);
    });
  });
  document.getElementById('header-avatar')?.addEventListener('click', () => navigateTo('profile'));
}

function navigateTo(page) {
  State.currentPage = page;

  // Esconde todas as páginas limpando active e hidden
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active', 'hidden');
    p.style.removeProperty('display');
  });

  // Ativa a página alvo
  const target = document.getElementById('page-' + page);
  if (target) {
    target.classList.add('active');
    target.style.removeProperty('display');
  }

  // Controles fixos de atividade
  const fixedControls = document.getElementById('activity-controls-fixed');
  if (fixedControls) {
    fixedControls.classList.toggle('visible', page === 'activity');
  }

  // Nav highlight
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');

  // Scroll topo nas páginas de lista
  if (page !== 'activity') {
    document.getElementById('app-main')?.scrollTo(0, 0);
  }

  // Carrega dados
  if (page === 'progress') loadProgress();
  if (page === 'ranking') loadRanking(document.querySelector('.ranking-tab.active')?.dataset.rank || 'distance');
  if (page === 'community') loadCommunity();
  if (page === 'feed') refreshFeedIfNeeded();
  if (page === 'profile') loadProfileData();
}

// ════════════════════════════════════════════════════════
// ACTIVITY TRACKING
// ════════════════════════════════════════════════════════
function setupActivityPage() {
  // Start/Pause e Stop (nos controles fixos)
  document.getElementById('btn-start-stop').addEventListener('click', handleStartStop);
  document.getElementById('btn-stop').addEventListener('click', handleStop);

  // Photo button
  document.getElementById('btn-photo-activity').addEventListener('click', () => {
    document.getElementById('activity-photo-input')?.click();
  });

  // Activity photo (inline)
  const actPhotoInput = document.createElement('input');
  actPhotoInput.type = 'file';
  actPhotoInput.accept = 'image/*';
  actPhotoInput.id = 'activity-photo-input';
  actPhotoInput.className = 'hidden';
  document.body.appendChild(actPhotoInput);
  actPhotoInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) readFileAsDataURL(file).then(url => { State.activity.photo = url; showToast('Foto adicionada!'); });
  });

  // Modal buttons
  document.getElementById('btn-add-photo').addEventListener('click', () => {
    document.getElementById('activity-photo-input').click();
  });
  document.getElementById('activity-photo-input')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    readFileAsDataURL(file).then(url => {
      State.activity.photo = url;
      const preview = document.getElementById('summary-photo-preview');
      preview.src = url;
      preview.classList.remove('hidden');
    });
  });

  document.getElementById('btn-save-activity').addEventListener('click', saveActivity);
  document.getElementById('btn-discard-activity').addEventListener('click', () => {
    document.getElementById('modal-summary').classList.add('hidden');
    resetActivity();
  });
  document.getElementById('btn-share-activity').addEventListener('click', () => {
    document.getElementById('modal-summary').classList.add('hidden');
    openShareModal(State.currentActivity);
  });

  // Share modal
  setupShareModal();
}

function handleStartStop() {
  if (!State.activity.running) {
    startActivity();
  } else if (!State.activity.paused) {
    pauseActivity();
  } else {
    resumeActivity();
  }
}

function startActivity() {
  if (!navigator.geolocation) { showToast('GPS não disponível neste dispositivo.'); return; }

  State.activity.running = true;
  State.activity.paused = false;
  State.activity.startTime = Date.now();
  State.activity.pausedTime = 0;
  State.activity.positions = [];
  State.activity.distance = 0;
  State.activity.speeds = [];
  State.activity.maxSpeed = 0;
  State.activity.photo = null;

  // Atualiza ícones
  document.getElementById('icon-start').classList.add('hidden');
  document.getElementById('icon-pause').classList.remove('hidden');
  document.getElementById('icon-resume').classList.add('hidden');
  document.getElementById('btn-start-stop').classList.add('running');
  document.getElementById('btn-stop').disabled = false;

  // Inicia mapa
  initMap();
  document.getElementById('map-idle').classList.add('hidden');
  document.querySelector('.gps-dot').classList.add('active');

  // Timer
  State.activity.intervalId = setInterval(updateActivityUI, 1000);

  // GPS Watch
  State.activity.watchId = navigator.geolocation.watchPosition(
    onPositionUpdate,
    err => console.warn('GPS error:', err),
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
  );
}

function pauseActivity() {
  State.activity.paused = true;
  State.activity.pauseStart = Date.now();
  clearInterval(State.activity.intervalId);
  State.activity.intervalId = null;

  document.getElementById('icon-pause').classList.add('hidden');
  document.getElementById('icon-resume').classList.remove('hidden');
  document.getElementById('btn-start-stop').classList.remove('running');
}

function resumeActivity() {
  State.activity.paused = false;
  State.activity.pausedTime += Date.now() - State.activity.pauseStart;

  document.getElementById('icon-pause').classList.remove('hidden');
  document.getElementById('icon-resume').classList.add('hidden');
  document.getElementById('btn-start-stop').classList.add('running');

  State.activity.intervalId = setInterval(updateActivityUI, 1000);
}

function handleStop() {
  if (!State.activity.running) return;

  // Para tudo
  clearInterval(State.activity.intervalId);
  navigator.geolocation.clearWatch(State.activity.watchId);
  State.activity.running = false;
  State.activity.paused = false;

  // Reseta botões
  document.getElementById('icon-start').classList.remove('hidden');
  document.getElementById('icon-pause').classList.add('hidden');
  document.getElementById('icon-resume').classList.add('hidden');
  document.getElementById('btn-start-stop').classList.remove('running');
  document.getElementById('btn-stop').disabled = true;
  document.querySelector('.gps-dot').classList.remove('active');

  // Calcula dados finais
  const duration = computeElapsed();
  const dist = State.activity.distance;
  const avgSpeed = dist > 0 && duration > 0 ? (dist / (duration / 3600)) : 0;
  const pace = avgSpeed > 0 ? 60 / avgSpeed : 0;
  const paceMin = Math.floor(pace);
  const paceSec = Math.round((pace - paceMin) * 60);
  const calories = calcCalories(dist, duration);
  const weight = State.userProfile?.weight || 70;

  State.currentActivity = {
    type: State.activity.type,
    distance: dist,
    duration,
    avgSpeed,
    maxSpeed: State.activity.maxSpeed,
    pace: `${paceMin}:${String(paceSec).padStart(2, '0')}`,
    calories,
    weight,
    photo: State.activity.photo,
    positions: State.activity.positions,
    kmSplits: State.activity.kmSplits || [],
    timestamp: Date.now(),
  };

  showSummaryModal(State.currentActivity);
}

function onPositionUpdate(pos) {
  const { latitude, longitude, speed, accuracy } = pos.coords;
  const positions = State.activity.positions;

  if (positions.length > 0) {
    const last = positions[positions.length - 1];
    const d = haversine(last.lat, last.lng, latitude, longitude);
    if (d > 0.005 && accuracy < 50) {
      const prevDist = State.activity.distance;
      State.activity.distance += d;

      // ── Rastreamento de pace por km ──────────────────────
      if (!State.activity.kmSplits) State.activity.kmSplits = [];
      const prevKm = Math.floor(prevDist);
      const currKm = Math.floor(State.activity.distance);
      if (currKm > prevKm && currKm > 0) {
        // Cruzou a marca de 1km — registra o pace deste km
        const elapsed = computeElapsed();
        const kmTime = elapsed - (State.activity.kmSplits.reduce((s, k) => s + k.secs, 0));
        const pace = kmTime / 60; // min/km
        const paceMin = Math.floor(pace);
        const paceSec = Math.round((pace - paceMin) * 60);
        State.activity.kmSplits.push({
          km: currKm,
          secs: kmTime,
          pace: `${paceMin}:${String(paceSec).padStart(2, '0')}`,
        });
      }

      if (State.polyline) {
        State.polyline.addLatLng([latitude, longitude]);
      }
    }
  }

  positions.push({ lat: latitude, lng: longitude });

  const currentSpeed = speed != null ? speed * 3.6 : 0;
  if (currentSpeed > 0) State.activity.speeds.push(currentSpeed);
  if (currentSpeed > State.activity.maxSpeed) State.activity.maxSpeed = currentSpeed;

  document.getElementById('act-speed').textContent = currentSpeed.toFixed(1);
  document.getElementById('act-max-speed').textContent = State.activity.maxSpeed.toFixed(1);

  if (State.map) {
    State.map.setView([latitude, longitude], 17);
    if (State.userMarker) {
      State.userMarker.setLatLng([latitude, longitude]);
    } else {
      State.userMarker = window.L?.circleMarker([latitude, longitude], {
        radius: 8, fillColor: '#5BFFA0', fillOpacity: 1,
        color: '#1A6BF0', weight: 3
      }).addTo(State.map);
    }
  }
}

function updateActivityUI() {
  const elapsed = computeElapsed();
  const dist = State.activity.distance;
  const avgSpeed = dist > 0 ? dist / (elapsed / 3600) : 0;
  const pace = avgSpeed > 0 ? 60 / avgSpeed : 0;
  const paceMin = Math.floor(pace);
  const paceSec = Math.round((pace - paceMin) * 60);

  document.getElementById('act-distance').textContent = dist.toFixed(2);
  document.getElementById('act-duration').textContent = formatDuration(elapsed);
  document.getElementById('act-pace').textContent = avgSpeed > 0
    ? `${paceMin}:${String(paceSec).padStart(2, '0')}`
    : '--:--';
  document.getElementById('act-calories').textContent = Math.round(calcCalories(dist, elapsed));

  // Velocidade média
  const speeds = State.activity.speeds;
  const avgSpd = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
  document.getElementById('act-avg-speed').textContent = avgSpd.toFixed(1);
}

function computeElapsed() {
  if (!State.activity.startTime) return 0;
  const now = Date.now();
  const raw = now - State.activity.startTime - State.activity.pausedTime;
  return Math.max(0, raw / 1000); // segundos
}

// ── Map (Leaflet) ──────────────────────────────────────────
function initMap() {
  if (State.map) return;
  if (!window.L) return;

  // Tenta obter posição inicial
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude, longitude } = pos.coords;
    const container = document.getElementById('map-container');

    State.map = L.map(container, { zoomControl: false, attributionControl: false }).setView([latitude, longitude], 16);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(State.map);

    State.polyline = L.polyline([], {
      color: '#1A6BF0', weight: 5, opacity: 0.9
    }).addTo(State.map);

  }, () => {
    // Sem permissão GPS
    showToast('Permissão de GPS necessária para rastrear sua rota.');
  }, { enableHighAccuracy: true, timeout: 8000 });
}

// ── Activity Save ──────────────────────────────────────────
async function saveActivity() {
  if (!State.currentActivity) { showToast('Nenhuma atividade para salvar.'); return; }
  if (!State.user) { showToast('Você precisa estar logado.'); return; }

  const { db, collection, addDoc, doc, updateDoc, getDoc, serverTimestamp } = window.__firebase;
  const btn = document.getElementById('btn-save-activity');
  btn.textContent = 'Salvando...';
  btn.disabled = true;

  try {
    const act = State.currentActivity;

    // Upload de foto se houver (Cloudinary)
    let photoURL = '';
    if (act.photo && act.photo.startsWith('data:')) {
      const uploaded = await uploadActivityPhoto(act.photo, `act_${Date.now()}`);
      photoURL = uploaded || '';
    }

    // Dados da atividade
    const activityData = {
      userId: State.user.uid,
      userName: State.userProfile?.name || State.user.displayName || 'Atleta',
      userPhotoURL: State.userProfile?.photoURL || '',
      type: act.type || 'running',
      distance: parseFloat((act.distance || 0).toFixed(3)),
      duration: Math.round(act.duration || 0),
      avgSpeed: parseFloat((act.avgSpeed || 0).toFixed(2)),
      maxSpeed: parseFloat((act.maxSpeed || 0).toFixed(2)),
      pace: act.pace || '--:--',
      calories: Math.round(act.calories || 0),
      photoURL,
      kmSplits: act.kmSplits || [],
      timestamp: serverTimestamp(),
      date: new Date().toISOString(),
    };

    // Salva a atividade
    await addDoc(collection(db, 'activities'), activityData);

    // Atualiza totais do usuário com transaction segura
    try {
      const userRef = doc(db, 'users', State.user.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const d = userSnap.data();
        await updateDoc(userRef, {
          totalRuns: (d.totalRuns || 0) + 1,
          totalDistance: parseFloat(((d.totalDistance || 0) + activityData.distance).toFixed(3)),
          totalDuration: (d.totalDuration || 0) + activityData.duration,
        });
        State.userProfile = {
          ...State.userProfile,
          totalRuns: (d.totalRuns || 0) + 1,
          totalDistance: parseFloat(((d.totalDistance || 0) + activityData.distance).toFixed(3)),
          totalDuration: (d.totalDuration || 0) + activityData.duration,
        };
      }
    } catch (profileErr) {
      // Não impede o salvamento da atividade se atualizar totais falhar
      console.warn('Erro ao atualizar totais do usuário:', profileErr);
    }

    showToast('Atividade salva com sucesso! 🎉');
    document.getElementById('modal-summary').classList.add('hidden');
    resetActivity();

    // Verifica conquistas
    const newTotal = State.userProfile?.totalDistance || 0;
    const newRuns = State.userProfile?.totalRuns || 0;
    checkAchievements(newTotal, newRuns);

    if (State.currentPage === 'progress') loadProgress();

  } catch (e) {
    console.error('saveActivity error:', e);
    // Mostra o erro real para facilitar diagnóstico
    const msg = e.code === 'permission-denied'
      ? 'Permissão negada. Verifique as regras do Firestore.'
      : e.code === 'unavailable'
        ? 'Sem conexão. Tente novamente.'
        : `Erro: ${e.message || e.code || 'desconhecido'}`;
    showToast(msg, 5000);
  } finally {
    btn.textContent = 'Salvar atividade';
    btn.disabled = false;
  }
}

function showSummaryModal(act) {
  const container = document.getElementById('summary-stats');

  // Splits por km
  const splitsHtml = act.kmSplits && act.kmSplits.length > 0
    ? `<div class="km-splits-section">
        <h4 class="km-splits-title">⚡ Pace por km</h4>
        <div class="km-splits-list">
          ${act.kmSplits.map(s => {
      // Classifica o pace: verde=rápido, amarelo=médio, vermelho=lento
      const secs = s.secs;
      const color = secs < 360 ? 'var(--green-neon)' : secs < 480 ? 'var(--amber)' : 'var(--blue-300)';
      return `<div class="km-split-item">
              <span class="km-split-label">KM ${s.km}</span>
              <div class="km-split-bar-wrap">
                <div class="km-split-bar" style="width:${Math.min(100, (480 / Math.max(secs, 1)) * 100)}%;background:${color}"></div>
              </div>
              <span class="km-split-pace" style="color:${color}">${s.pace}</span>
            </div>`;
    }).join('')}
        </div>
       </div>`
    : '';

  container.innerHTML = `
    <div class="summary-stat highlight">
      <div class="v">${act.distance.toFixed(2)}</div>
      <div class="l">km percorridos</div>
    </div>
    <div class="summary-stat">
      <div class="v">${formatDuration(act.duration)}</div>
      <div class="l">duração</div>
    </div>
    <div class="summary-stat">
      <div class="v">${act.pace}</div>
      <div class="l">ritmo médio</div>
    </div>
    <div class="summary-stat">
      <div class="v">${Math.round(act.calories)}</div>
      <div class="l">kcal</div>
    </div>
    <div class="summary-stat">
      <div class="v">${act.avgSpeed.toFixed(1)}</div>
      <div class="l">km/h média</div>
    </div>
    <div class="summary-stat">
      <div class="v">${act.maxSpeed.toFixed(1)}</div>
      <div class="l">km/h máx</div>
    </div>
    ${splitsHtml}
  `;

  document.getElementById('summary-photo-preview').classList.add('hidden');
  if (act.photo) {
    document.getElementById('summary-photo-preview').src = act.photo;
    document.getElementById('summary-photo-preview').classList.remove('hidden');
  }
  document.getElementById('modal-summary').classList.remove('hidden');
}

function resetActivity() {
  Object.assign(State.activity, {
    running: false, paused: false,
    startTime: null, pausedTime: 0, pauseStart: null,
    intervalId: null, watchId: null,
    positions: [], distance: 0, duration: 0,
    speeds: [], maxSpeed: 0, photo: null,
  });

  document.getElementById('act-distance').textContent = '0.00';
  document.getElementById('act-duration').textContent = '00:00';
  document.getElementById('act-pace').textContent = '--:--';
  document.getElementById('act-calories').textContent = '0';
  document.getElementById('act-speed').textContent = '0.0';
  document.getElementById('act-max-speed').textContent = '0.0';
  document.getElementById('act-avg-speed').textContent = '0.0';

  document.getElementById('map-idle').classList.remove('hidden');

  // Destroi mapa para resetar
  if (State.map) {
    State.map.remove();
    State.map = null;
    State.polyline = null;
    State.userMarker = null;
  }
}

// ════════════════════════════════════════════════════════
// FEED — IA powered via Anthropic API
// ════════════════════════════════════════════════════════
let _feedLoaded = false;

function refreshFeedIfNeeded() {
  // Recarrega se: nunca carregou OU último carregamento foi há mais de 6h (renovação diária)
  const lastLoad = parseInt(localStorage.getItem('pacerun_feed_ts') || '0');
  const sixHours = 6 * 60 * 60 * 1000;
  if (!_feedLoaded || (Date.now() - lastLoad > sixHours)) {
    _feedLoaded = false;
    loadFeed();
  }
}

async function loadFeed() {
  const loadingEl = document.getElementById('feed-loading');
  const contentEl = document.getElementById('feed-content');

  loadingEl.classList.remove('hidden');
  contentEl.classList.add('hidden');

  // Tenta usar cache do dia
  const cached = localStorage.getItem('pacerun_feed_cache');
  const cachedTs = parseInt(localStorage.getItem('pacerun_feed_ts') || '0');
  const sixHours = 6 * 60 * 60 * 1000;

  if (cached && (Date.now() - cachedTs < sixHours)) {
    try {
      const articles = JSON.parse(cached);
      renderFeed(articles);
      loadingEl.classList.add('hidden');
      contentEl.classList.remove('hidden');
      _feedLoaded = true;
      return;
    } catch { /* cache inválido, segue para buscar novo */ }
  }

  // Detecta localização
  let locationLabel = 'Brasil';
  try {
    const pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 })
    );
    const { latitude, longitude } = pos.coords;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`);
      const geoData = await r.json();
      locationLabel = geoData.address?.city || geoData.address?.town || geoData.address?.state || 'sua região';
    } catch { locationLabel = 'sua região'; }
  } catch { /* sem GPS */ }

  document.getElementById('feed-location-label').textContent = `Conteúdo para ${locationLabel}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        messages: [{
          role: 'user',
          content: `Você é um editor esportivo especializado em corrida e caminhada no Brasil.

Gere 5 artigos variados sobre corrida ou caminhada relevantes para a região: ${locationLabel}.
Retorne APENAS JSON válido (sem markdown, sem explicações) neste formato exato:
{
  "articles": [
    {
      "tag": "Treino",
      "title": "Título específico e atraente",
      "description": "Resumo curto de 2 frases que aparece no card fechado.",
      "fullText": "Texto completo com 5 a 7 parágrafos ricos em informação, dicas práticas e motivação para corredores brasileiros. Separe os parágrafos com \\n\\n. Seja específico, use exemplos reais e linguagem acessível.",
      "readTime": "4 min"
    }
  ]
}

Use tags variadas: Dica, Treino, Nutrição, Evento, Motivação, Saúde, Equipamento.
Os títulos devem ser específicos, práticos e diferentes entre si.
Hoje é ${new Date().toLocaleDateString('pt-BR')} — gere conteúdo fresco e atual.`
        }]
      })
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';
    const clean = text.replace(/```json[\s\S]*?```/g, t => t.slice(7, -3)).replace(/```/g, '').trim();
    const parsed = JSON.parse(clean);
    const articles = parsed.articles || [];

    // Salva no cache
    localStorage.setItem('pacerun_feed_cache', JSON.stringify(articles));
    localStorage.setItem('pacerun_feed_ts', Date.now().toString());

    renderFeed(articles);
  } catch (e) {
    console.error('Feed error:', e);
    // Fallback com conteúdo rico
    renderFeed([
      {
        tag: 'Treino',
        title: '5 treinos para aumentar seu ritmo em 30 dias',
        description: 'O treinamento intervalado é a forma mais eficiente de melhorar sua velocidade.',
        fullText: 'O treinamento intervalado (HIIT) é considerado o método mais eficaz para corredores que querem melhorar o ritmo rapidamente. A ciência mostra que alternar períodos de alta intensidade com recuperação ativa treina tanto o sistema aeróbico quanto o anaeróbico.\n\nSemana 1-2: Comece com intervalos de 30 segundos em ritmo forte, seguidos de 90 segundos de trote. Repita 6-8 vezes, duas vezes por semana.\n\nSemana 3-4: Aumente para 1 minuto forte e 1 minuto de recuperação. Adicione uma terceira sessão semanal com um rodão longo em ritmo confortável.\n\nAlém dos intervalos, inclua corridas de progressão — comece devagar e acelere gradualmente nos últimos 20% do percurso. Esse treino ensina seu corpo a correr rápido quando está cansado.\n\nNão esqueça do descanso: músculos crescem e se adaptam durante o repouso. Atletas amadores costumam errar por excesso de treino. Durma bem, se alimente adequadamente e respeite os dias de recuperação.',
        readTime: '4 min'
      },
      {
        tag: 'Nutrição',
        title: 'O que comer antes e depois de correr',
        description: 'A alimentação certa pode fazer a diferença entre uma corrida ótima e uma sofrível.',
        fullText: 'A nutrição para corredores vai muito além de comer macarrão antes de uma prova. O que você come nas 2-3 horas anteriores à corrida tem impacto direto na sua energia, foco e recuperação.\n\nPré-corrida (1-2h antes): Prefira carboidratos de fácil digestão — banana com mel, torrada com geleia, aveia com frutas. Evite gorduras e fibras em excesso, que podem causar desconforto gastrointestinal.\n\nDurante corridas longas (acima de 60 min): Considere géis energéticos ou tâmaras a cada 45 minutos para manter a glicemia estável e evitar o "muro".\n\nPós-corrida (até 30 min após): A janela anabólica é real. Consuma proteínas + carboidratos — iogurte com granola, ovo com pão integral, shake de proteína com banana. Isso acelera a recuperação muscular.\n\nHidratação: Beba 500ml de água 2h antes de correr. Durante, 150-200ml a cada 20 minutos. Após, repôs 150% do peso perdido em suor.',
        readTime: '5 min'
      },
      {
        tag: 'Saúde',
        title: 'Como evitar as lesões mais comuns na corrida',
        description: 'Joelho do corredor, fascite plantar e canelite têm causas preveníveis.',
        fullText: 'Cerca de 70% dos corredores se lesionam pelo menos uma vez por ano. A boa notícia é que a maioria das lesões é prevenível com algumas mudanças simples de hábito.\n\nJoelho do corredor (síndrome patelofemoral): Causado geralmente por fraqueza nos glúteos e quadríceps. Inclua agachamentos, elevações de quadril e exercícios de fortalecimento lateral 2-3x por semana.\n\nFascite plantar: Dor no calcanhar, especialmente pela manhã. Causas: aumento brusco de volume de treino, calçado inadequado e encurtamento do músculo gastrocnêmio. Alongue a panturrilha diariamente e role uma bolinha de tênis sob o pé.\n\nCanelite (síndrome do estresse tibial): Comum em iniciantes que aumentam o volume rápido demais. Siga a regra dos 10%: nunca aumente seu volume semanal em mais de 10%.\n\nSolados e pisada: Consulte uma loja especializada para análise de pisada. Um calçado adequado ao seu tipo de pisada (neutra, pronada ou supinada) reduz drasticamente o risco de lesões.',
        readTime: '4 min'
      },
      {
        tag: 'Motivação',
        title: 'A psicologia por trás de manter a consistência',
        description: 'Motivação vem e vai — disciplina e hábito são o que realmente te mantém correndo.',
        fullText: 'Todo corredor conhece aqueles dias em que a última coisa que quer fazer é calçar o tênis. A ciência do comportamento tem respostas práticas para isso.\n\nO sistema de recompensa do cérebro: Correr libera dopamina, endorfina e serotonina — mas apenas após alguns minutos de atividade. O truque é chegar nesses primeiros 10 minutos. Diga a si mesmo: "Vou correr só 10 minutos, e se não quiser continuar, paro." Quase sempre você vai continuar.\n\nIdentidade, não metas: Pesquisas mostram que pessoas que se identificam como corredores (não apenas como "alguém tentando correr") têm muito mais consistência. Mude a narrativa interna: "Eu sou um corredor" em vez de "Estou tentando correr".\n\nTorne inevitável: Deixe o tênis ao lado da cama, programe o alarme com a roupa já separada, combine com alguém. Reduza ao máximo a resistência para começar.\n\nCelebração de pequenas vitórias: Cada saída conta. Um registro no app, uma foto, uma anotação no diário — reconheça cada conquista, por menor que seja. O cérebro aprende a associar correr com prazer.',
        readTime: '4 min'
      },
      {
        tag: 'Equipamento',
        title: 'Como escolher o tênis certo para seu tipo de pisada',
        description: 'O calçado errado é responsável por boa parte das lesões em corredores.',
        fullText: 'Escolher um tênis de corrida vai muito além de estética ou marca. O calçado precisa se adaptar ao seu tipo de pisada, ao tipo de terreno e ao seu volume de treino.\n\nTipos de pisada: Pronada (o pé entorta para dentro) — precisa de tênis com suporte medial. Supinada (entorta para fora) — precisa de amortecimento extra. Neutra — maior variedade de opções disponíveis.\n\nComo descobrir sua pisada: Olhe o desgaste do seu tênis atual. Desgaste no lado interno = pronação. Lado externo = supinação. Central = neutra. Lojas especializadas oferecem análise gratuita na esteira.\n\nDrop e amortecimento: Drop é a diferença de altura entre calcanhar e ponta do pé. Alto drop (8-12mm) distribui mais impacto no calcanhar — bom para quem aterrissa no calcanhar. Baixo drop (0-4mm) incentiva pisada no médio/antepé.\n\nVida útil: Um tênis de corrida dura em média 600-800km. Marque no app quando comprou e quantos km rodou. Usar um tênis desgastado é uma das principais causas de lesão.',
        readTime: '5 min'
      },
    ]);
  }

  loadingEl.classList.add('hidden');
  contentEl.classList.remove('hidden');
  _feedLoaded = true;
}

function renderFeed(articles) {
  const contentEl = document.getElementById('feed-content');
  contentEl.innerHTML = articles.map((a, i) => {
    // Converte \n\n em parágrafos HTML
    const fullHtml = (a.fullText || a.description)
      .split('\n\n')
      .map(p => `<p style="margin-bottom:12px">${p.trim()}</p>`)
      .join('');

    return `
    <article class="news-card" id="news-card-${i}" onclick="toggleFeedCard(${i})">
      <div class="news-card-body">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span class="news-card-tag">${a.tag}</span>
          <svg class="news-card-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <h3 class="news-card-title">${a.title}</h3>
        <p class="news-card-desc">${a.description}</p>
        <p class="news-card-meta">⏱ ${a.readTime} de leitura · toque para ler</p>
      </div>
      <div class="news-card-full">${fullHtml}</div>
    </article>`;
  }).join('');
}

window.toggleFeedCard = function (i) {
  const card = document.getElementById('news-card-' + i);
  if (!card) return;
  const isExpanded = card.classList.contains('expanded');
  document.querySelectorAll('.news-card.expanded').forEach(c => c.classList.remove('expanded'));
  if (!isExpanded) {
    card.classList.add('expanded');
    // Scroll suave para o card
    setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }
};

// ════════════════════════════════════════════════════════
// COMMUNITY
// ════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════
// COMUNIDADE — 4 sub-abas
// ════════════════════════════════════════════════════════

function setupCommunityTabs() {
  document.querySelectorAll('.comm-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.comm-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const section = tab.dataset.comm;
      document.querySelectorAll('.comm-section').forEach(s => s.classList.add('hidden'));
      document.getElementById('comm-' + section)?.classList.remove('hidden');
      if (section === 'runners') loadCommunityRunners();
      if (section === 'challenges') loadChallenges();
      if (section === 'events') loadCommunityEvents();
      if (section === 'leaderboard') loadLeaderboard();
    });
  });
}

async function loadCommunity() {
  setupCommunityTabs();
  loadCommunityRunners();
}

async function loadCommunityRunners(searchTerm = '') {
  const { db, collection, getDocs, query, orderBy, limit, where } = window.__firebase;
  const listEl = document.getElementById('comm-runners-list');
  if (!listEl) return;
  listEl.innerHTML = '<p style="padding:20px;color:var(--text-muted);text-align:center">Carregando...</p>';

  try {
    const q = query(collection(db, 'users'), orderBy('totalDistance', 'desc'), limit(30));
    const snap = await getDocs(q);
    let users = [];
    snap.forEach(d => { if (d.id !== State.user?.uid) users.push({ id: d.id, ...d.data() }); });

    if (searchTerm) users = users.filter(u => u.name?.toLowerCase().includes(searchTerm.toLowerCase()));

    if (users.length === 0) {
      listEl.innerHTML = `<div style="padding:40px 20px;text-align:center;color:var(--text-muted)"><div style="font-size:40px;margin-bottom:12px">👥</div><p>Convide amigos para o PaceRun!</p></div>`;
      return;
    }

    const actPromises = users.slice(0, 20).map(async u => {
      try {
        const aq = query(collection(db, 'activities'), where('userId', '==', u.id), orderBy('timestamp', 'desc'), limit(1));
        const aSnap = await getDocs(aq);
        if (!aSnap.empty) u.lastActivity = aSnap.docs[0].data();
      } catch { }
      return u;
    });
    await Promise.all(actPromises);

    listEl.innerHTML = users.map(u => {
      const dist = (u.totalDistance || 0).toFixed(1);
      const last = u.lastActivity;
      const lastText = last ? `${last.type === 'running' ? '🏃' : '🚶'} ${last.distance?.toFixed(2)} km · ${formatDateShort(last.date)}` : 'Sem atividades';
      return `<div class="user-card">
        <img class="user-avatar" src="${u.photoURL || getAvatarUrl(u.name || 'U')}" alt="${u.name}" onerror="this.src='${getAvatarUrl(u.name || 'U')}'" />
        <div class="user-info">
          <div class="user-name">${u.name || 'Atleta'}</div>
          <div class="user-stats">${dist} km · ${u.totalRuns || 0} atividades</div>
          <div class="community-activity-badge">${lastText}</div>
        </div>
        <div style="color:var(--blue-300);font-family:var(--font-display);font-size:18px;font-weight:800;text-align:right;flex-shrink:0">${dist}<br><span style="font-size:11px;color:var(--text-muted);font-family:var(--font-body);font-weight:400">km</span></div>
      </div>`;
    }).join('');
  } catch (e) {
    listEl.innerHTML = '<p style="padding:20px;color:var(--text-muted);text-align:center">Erro ao carregar.</p>';
  }
}

document.getElementById('community-search')?.addEventListener('input', e => {
  loadCommunityRunners(e.target.value);
});

// ── DESAFIOS ──────────────────────────────────────────────
const CHALLENGES = [
  { id: 'c1', emoji: '🔥', title: 'Semana de Fogo', desc: 'Complete 3 corridas em 7 dias', target: 3, unit: 'corridas', type: 'weekly_runs', xp: 150 },
  { id: 'c2', emoji: '🌅', title: 'Madrugador', desc: 'Corra antes das 7h por 5 dias', target: 5, unit: 'manhãs', type: 'early_runs', xp: 200 },
  { id: 'c3', emoji: '🏅', title: 'Primeiro 5K', desc: 'Complete uma corrida de 5 km', target: 5, unit: 'km', type: 'single_run_dist', xp: 100 },
  { id: 'c4', emoji: '💪', title: 'Consistência', desc: 'Corra por 4 semanas seguidas', target: 4, unit: 'semanas', type: 'streak_weeks', xp: 300 },
  { id: 'c5', emoji: '⚡', title: 'Velocista', desc: 'Alcance pace abaixo de 5:30/km', target: 1, unit: 'vez', type: 'fast_pace', xp: 250 },
  { id: 'c6', emoji: '🗺️', title: 'Explorador', desc: 'Acumule 20 km em uma semana', target: 20, unit: 'km', type: 'weekly_km', xp: 200 },
  { id: 'c7', emoji: '🎯', title: 'Meio Maratona', desc: 'Corra 21 km acumulados', target: 21, unit: 'km', type: 'total_km', xp: 400 },
  { id: 'c8', emoji: '👟', title: '100 km de Clube', desc: 'Acumule 100 km no total', target: 100, unit: 'km', type: 'total_km', xp: 1000 },
];

function loadChallenges() {
  const listEl = document.getElementById('comm-challenges-list');
  if (!listEl) return;

  const totalDist = State.userProfile?.totalDistance || 0;
  const totalRuns = State.userProfile?.totalRuns || 0;
  const savedProgress = JSON.parse(localStorage.getItem('pacerun_challenges') || '{}');

  listEl.innerHTML = CHALLENGES.map(c => {
    let progress = 0;
    if (c.type === 'total_km') progress = Math.min(totalDist, c.target);
    if (c.type === 'weekly_runs') progress = Math.min(totalRuns % 3, c.target);
    if (c.type === 'single_run_dist') progress = totalDist >= c.target ? c.target : Math.min(totalDist, c.target);
    const pct = Math.min(100, Math.round((progress / c.target) * 100));
    const done = pct >= 100;

    return `<div class="challenge-card ${done ? 'done' : ''}">
      <div class="challenge-top">
        <div class="challenge-icon">${c.emoji}</div>
        <div class="challenge-info">
          <div class="challenge-title">${c.title} ${done ? '✅' : ''}</div>
          <div class="challenge-desc">${c.desc}</div>
        </div>
        <div class="challenge-xp">+${c.xp} XP</div>
      </div>
      <div class="challenge-progress-wrap">
        <div class="challenge-progress-bar" style="width:${pct}%"></div>
      </div>
      <div class="challenge-progress-text">${done ? 'Concluído!' : `${progress.toFixed(progress % 1 === 0 ? 0 : 1)} / ${c.target} ${c.unit}`}</div>
    </div>`;
  }).join('');
}

// ── EVENTOS (Corridas reais de SP/Guarulhos) ──────────────
function loadCommunityEvents() {
  const listEl = document.getElementById('comm-events-list');
  if (!listEl) return;

  const allRaces = [
    ...((window.RACES_DATABASE || {})['são paulo'] || []),
    ...((window.RACES_DATABASE || {})['guarulhos'] || []),
  ].filter(r => r.date && r.date.length >= 8).sort((a, b) => {
    const [da, ma, ya] = a.date.split('/');
    const [db2, mb, yb] = b.date.split('/');
    return new Date(`${ya}-${ma}-${da}`) - new Date(`${yb}-${mb}-${db2}`);
  });

  if (allRaces.length === 0) {
    listEl.innerHTML = '<p style="padding:20px;color:var(--text-muted);text-align:center">Nenhum evento cadastrado.</p>';
    return;
  }

  listEl.innerHTML = allRaces.map(r => {
    const distTags = (r.distances || []).map(d => `<span class="race-tag dist">${d}</span>`).join('');
    return `<div class="race-card">
      <div class="race-card-top">
        <div class="race-date-badge"><div class="day">${r.day}</div><div class="month">${r.month}</div></div>
        <div class="race-info">
          <div class="race-name">${r.name}</div>
          <div class="race-meta">${distTags}<span class="race-tag city">📍 ${r.location}</span></div>
        </div>
      </div>
      ${r.description ? `<p class="race-desc">${r.description}</p>` : ''}
      ${r.link ? `<a href="${r.link}" target="_blank" rel="noopener" class="race-link">🔗 Ver inscrições</a>` : ''}
    </div>`;
  }).join('');

  listEl.innerHTML += `<div class="races-disclaimer">📍 Dados de <a href="https://esportividade.com.br/corrida-de-rua/" target="_blank" style="color:var(--blue-300)">esportividade.com.br</a></div>`;
}

// ── PLACAR ────────────────────────────────────────────────
async function loadLeaderboard() {
  const { db, collection, getDocs, query, orderBy, limit } = window.__firebase;
  const listEl = document.getElementById('comm-leaderboard-list');
  if (!listEl) return;
  listEl.innerHTML = '<p style="padding:20px;color:var(--text-muted);text-align:center">Carregando...</p>';

  // Tabs de placar
  document.querySelectorAll('.leader-tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.leader-tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      renderLeaderboard(t.dataset.leader);
    });
  });

  try {
    const q = query(collection(db, 'users'), orderBy('totalDistance', 'desc'), limit(20));
    const snap = await getDocs(q);
    const users = [];
    snap.forEach(d => users.push({ id: d.id, ...d.data() }));
    window._leaderboardUsers = users;
    renderLeaderboard('distance');
  } catch (e) {
    listEl.innerHTML = '<p style="padding:20px;color:var(--text-muted);text-align:center">Erro ao carregar.</p>';
  }
}

function renderLeaderboard(type) {
  const listEl = document.getElementById('comm-leaderboard-list');
  const users = window._leaderboardUsers || [];
  if (!listEl || users.length === 0) return;

  const sorted = [...users].sort((a, b) => {
    if (type === 'distance') return (b.totalDistance || 0) - (a.totalDistance || 0);
    if (type === 'runs') return (b.totalRuns || 0) - (a.totalRuns || 0);
    if (type === 'time') return (b.totalDuration || 0) - (a.totalDuration || 0);
    return 0;
  });

  const medals = ['🥇', '🥈', '🥉'];
  listEl.innerHTML = sorted.slice(0, 10).map((u, i) => {
    const isMe = u.id === State.user?.uid;
    let value = '';
    if (type === 'distance') value = `${(u.totalDistance || 0).toFixed(1)} km`;
    if (type === 'runs') value = `${u.totalRuns || 0} corridas`;
    if (type === 'time') value = formatDuration(u.totalDuration || 0);

    return `<div class="ranking-item ${i < 3 ? 'top-' + (i + 1) : ''} ${isMe ? 'me' : ''}">
      <div class="rank-pos">${medals[i] || i + 1}</div>
      <img class="user-avatar" style="width:40px;height:40px" src="${u.photoURL || getAvatarUrl(u.name || 'U')}" alt="${u.name}" onerror="this.src='${getAvatarUrl(u.name || 'U')}'" />
      <div class="ranking-user-info">
        <div class="name">${u.name || 'Atleta'} ${isMe ? '<span style="color:var(--blue-300);font-size:11px">· você</span>' : ''}</div>
        <div class="detail">${u.totalRuns || 0} atividades</div>
      </div>
      <div class="ranking-value">${value}</div>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════════
// RANKING
// ════════════════════════════════════════════════════════
async function loadRanking(type = 'distance') {
    const { db, collection, getDocs, query, orderBy, limit } = window.__firebase;
    const listEl = document.getElementById('ranking-list');
    listEl.innerHTML = '<p style="padding:20px;color:var(--text-muted);text-align:center">Carregando...</p>';

    document.querySelectorAll('.ranking-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.rank === type);
    });

    try {
      const sortField = type === 'distance' ? 'distance' : 'avgSpeed';
      const q = query(
        collection(db, 'activities'),
        orderBy(sortField, 'desc'),
        limit(20)
      );
      const snap = await getDocs(q);
      const activities = [];
      snap.forEach(d => activities.push({ id: d.id, ...d.data() }));

      // Agrupa por usuário (melhor resultado)
      const byUser = {};
      activities.forEach(a => {
        if (!byUser[a.userId] || a[sortField] > byUser[a.userId][sortField]) {
          byUser[a.userId] = a;
        }
      });

      const ranked = Object.values(byUser)
        .sort((a, b) => b[sortField] - a[sortField])
        .slice(0, 10);

      if (ranked.length === 0) {
        listEl.innerHTML = '<p style="padding:20px;color:var(--text-muted);text-align:center">Sem atividades ainda. Seja o primeiro!</p>';
        return;
      }

      listEl.innerHTML = ranked.map((a, i) => {
        const pos = i + 1;
        const topClass = pos <= 3 ? `top-${pos}` : '';
        const medals = ['🥇', '🥈', '🥉'];
        const medal = medals[i] || pos;

        const value = type === 'distance'
          ? `${a.distance.toFixed(2)}<small>km</small>`
          : `${a.pace}<small>/km</small>`;

        return `
        <div class="ranking-item ${topClass}">
          <div class="rank-pos">${typeof medal === 'string' ? medal : pos}</div>
          <img class="user-avatar" style="width:40px;height:40px" src="${a.userPhotoURL || getAvatarUrl(a.userName || 'U')}" alt="${a.userName}" onerror="this.src='${getAvatarUrl(a.userName || 'U')}'" />
          <div class="ranking-user-info">
            <div class="name">${a.userName || 'Atleta'}</div>
            <div class="detail">${a.type === 'running' ? '🏃 Corrida' : '🚶 Caminhada'} · ${formatDateShort(a.date)}</div>
          </div>
          <div class="ranking-value">${value}</div>
        </div>
      `;
      }).join('');
    } catch (e) {
      listEl.innerHTML = '<p style="padding:20px;color:var(--text-muted);text-align:center">Erro ao carregar ranking.</p>';
    }
  }

  document.querySelectorAll('.ranking-tab').forEach(tab => {
    tab.addEventListener('click', () => loadRanking(tab.dataset.rank));
  });

  // ════════════════════════════════════════════════════════
  // PROGRESS
  // ════════════════════════════════════════════════════════
  async function loadProgress() {
    const { db, collection, getDocs, query, orderBy, where } = window.__firebase;
    const listEl = document.getElementById('progress-list');
    const summaryEl = document.getElementById('progress-summary');
    if (!State.user) return;

    listEl.innerHTML = '<p style="padding:20px;color:var(--text-muted);text-align:center">Carregando...</p>';
    summaryEl.innerHTML = '';

    try {
      let activities = [];
      try {
        const q = query(collection(db, 'activities'), where('userId', '==', State.user.uid), orderBy('timestamp', 'desc'));
        const snap = await getDocs(q);
        snap.forEach(d => activities.push({ id: d.id, ...d.data() }));
      } catch {
        const q2 = query(collection(db, 'activities'), where('userId', '==', State.user.uid));
        const snap2 = await getDocs(q2);
        snap2.forEach(d => activities.push({ id: d.id, ...d.data() }));
        activities.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
      }

      const totalDist = activities.reduce((s, a) => s + (a.distance || 0), 0);
      const totalTime = activities.reduce((s, a) => s + (a.duration || 0), 0);
      const totalCal = activities.reduce((s, a) => s + (a.calories || 0), 0);
      const totalRuns = activities.length;

      // ── Semana atual ──────────────────────────────────────
      const now = new Date();
      const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay());
      weekStart.setHours(0, 0, 0, 0);
      const weekActivities = activities.filter(a => {
        const d = new Date(a.date || 0);
        return d >= weekStart;
      });
      const weekTarget = 3;
      const weekPct = Math.min(100, Math.round((weekActivities.length / weekTarget) * 100));

      // ── Série de semanas ──────────────────────────────────
      const weeksWithActivity = new Set();
      activities.forEach(a => {
        const d = new Date(a.date || 0);
        const weekKey = `${d.getFullYear()}-W${Math.ceil(d.getDate() / 7)}`;
        weeksWithActivity.add(weekKey);
      });

      // ── Gráfico anual por mês ─────────────────────────────
      const monthlyData = Array(12).fill(0);
      const monthlyDist = Array(12).fill(0);
      const currentYear = now.getFullYear();
      activities.forEach(a => {
        const d = new Date(a.date || 0);
        if (d.getFullYear() === currentYear) {
          monthlyData[d.getMonth()]++;
          monthlyDist[d.getMonth()] += a.distance || 0;
        }
      });
      const maxMonth = Math.max(...monthlyData, 1);
      const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      const yearDist = monthlyDist.reduce((s, v) => s + v, 0);
      const yearRuns = monthlyData.reduce((s, v) => s + v, 0);
      const yearTime = activities.filter(a => new Date(a.date || 0).getFullYear() === currentYear)
        .reduce((s, a) => s + (a.duration || 0), 0);

      // ── Metas pessoais ────────────────────────────────────
      const weeklyGoal = 3;   // atividades/semana
      const monthlyGoal = 20;  // km/mês
      const currentMonthRuns = monthlyData[now.getMonth()];
      const currentMonthDist = monthlyDist[now.getMonth()];

      summaryEl.innerHTML = `
      <!-- Esta Semana -->
      <div class="progress-week-section">
        <div class="progress-week-header">
          <span>Esta semana</span>
          <span class="progress-week-count">${weekActivities.length} / ${weekTarget} atividades</span>
        </div>
        <div class="progress-week-bar-wrap">
          <div class="progress-week-bar" style="width:${weekPct}%"></div>
        </div>
        <div class="progress-week-dots">
          ${Array(weekTarget).fill(0).map((_, i) =>
        `<div class="week-dot ${i < weekActivities.length ? 'filled' : ''}"></div>`
      ).join('')}
        </div>
      </div>

      <!-- Metas -->
      <div class="progress-goals-section">
        <h3 class="progress-section-title">🎯 Minhas Metas</h3>
        <div class="goal-card">
          <div class="goal-info">
            <span class="goal-label">Meta semanal</span>
            <span class="goal-value">${currentMonthRuns} / ${weeklyGoal} atividades</span>
          </div>
          <div class="goal-bar-wrap"><div class="goal-bar" style="width:${Math.min(100, (currentMonthRuns / weeklyGoal) * 100)}%"></div></div>
        </div>
        <div class="goal-card">
          <div class="goal-info">
            <span class="goal-label">Meta mensal de distância</span>
            <span class="goal-value">${currentMonthDist.toFixed(1)} / ${monthlyGoal} km</span>
          </div>
          <div class="goal-bar-wrap"><div class="goal-bar blue" style="width:${Math.min(100, (currentMonthDist / monthlyGoal) * 100)}%"></div></div>
        </div>
      </div>

      <!-- Série -->
      <div class="progress-streak-section">
        <h3 class="progress-section-title">🔥 Série</h3>
        <div class="streak-row">
          <div class="streak-card"><div class="streak-val">${weeksWithActivity.size}</div><div class="streak-lbl">Semanas ativas</div></div>
          <div class="streak-card"><div class="streak-val">${totalRuns}</div><div class="streak-lbl">Atividades totais</div></div>
          <div class="streak-card"><div class="streak-val">${totalDist.toFixed(0)}</div><div class="streak-lbl">km totais</div></div>
        </div>
      </div>

      <!-- Estatísticas anuais -->
      <div class="progress-stats-section">
        <div class="progress-stats-header">
          <h3 class="progress-section-title">📊 Distância (km) — ${currentYear}</h3>
        </div>
        <div class="year-chart">
          ${months.map((m, i) => `
            <div class="year-bar-col">
              <div class="year-bar-wrap">
                <div class="year-bar" style="height:${monthlyData[i] > 0 ? Math.max(8, Math.round((monthlyData[i] / maxMonth) * 80)) : 0}px" title="${monthlyDist[i].toFixed(1)} km"></div>
              </div>
              <span class="year-bar-label">${m}</span>
            </div>`).join('')}
        </div>
        <div class="year-totals">
          <div class="year-total-item"><div class="year-total-val">${yearRuns}</div><div class="year-total-lbl">Atividades</div></div>
          <div class="year-total-item"><div class="year-total-val">${formatDuration(yearTime)}</div><div class="year-total-lbl">Tempo total</div></div>
          <div class="year-total-item"><div class="year-total-val">${yearDist.toFixed(1)}</div><div class="year-total-lbl">km</div></div>
        </div>
      </div>
    `;

      // ── Atividades recentes ───────────────────────────────
      if (activities.length === 0) {
        listEl.innerHTML = '<p style="padding:40px 20px;color:var(--text-muted);text-align:center">Nenhuma atividade ainda.<br>Complete sua primeira corrida! 🏃</p>';
        return;
      }

      listEl.innerHTML = `<h3 class="progress-section-title" style="padding:0 16px 12px">📋 Atividades Recentes</h3>` +
        activities.map(a => `
        <div class="history-card" onclick="openActivityDetail('${a.id}')">
          <div class="history-card-header">
            <span class="history-type-badge ${a.type || 'running'}">${a.type === 'walking' ? '🚶 Caminhada' : '🏃 Corrida'}</span>
            <span class="history-date">${formatDateFull(a.date)}</span>
          </div>
          <div class="history-main-stat">${(a.distance || 0).toFixed(2)} <span>km</span></div>
          <div class="history-details">
            <div class="history-detail"><div class="v">${formatDuration(a.duration || 0)}</div><div class="l">Duração</div></div>
            <div class="history-detail"><div class="v">${a.pace || '--:--'}</div><div class="l">Ritmo</div></div>
            <div class="history-detail"><div class="v">${Math.round(a.calories || 0)}</div><div class="l">kcal</div></div>
          </div>
          ${a.kmSplits && a.kmSplits.length > 0 ? `
          <div class="history-splits">
            ${a.kmSplits.map(s => `<span class="split-badge">KM${s.km} ${s.pace}</span>`).join('')}
          </div>` : ''}
        </div>`
        ).join('');
    } catch (e) {
      console.error('loadProgress error:', e);
      listEl.innerHTML = `<p style="padding:20px;color:var(--text-muted);text-align:center">Erro: ${e.message}</p>`;
    }
  }

  // Detalhe de atividade
  window.openActivityDetail = async function (id) {
    const { db, doc, getDoc } = window.__firebase;
    const snap = await getDoc(doc(db, 'activities', id));
    if (!snap.exists()) return;

    const a = snap.data();
    const content = document.getElementById('activity-detail-content');
    content.innerHTML = `
    <h2 class="modal-title">${a.type === 'running' ? '🏃 Corrida' : '🚶 Caminhada'}</h2>
    <p style="text-align:center;color:var(--text-secondary);margin-bottom:20px">${formatDateFull(a.date)}</p>
    ${a.photoURL ? `<img src="${a.photoURL}" style="width:100%;border-radius:12px;margin-bottom:16px;max-height:200px;object-fit:cover" alt="foto" />` : ''}
    <div class="summary-stats">
      <div class="summary-stat highlight"><div class="v">${a.distance.toFixed(2)}</div><div class="l">km</div></div>
      <div class="summary-stat"><div class="v">${formatDuration(a.duration)}</div><div class="l">Duração</div></div>
      <div class="summary-stat"><div class="v">${a.pace}</div><div class="l">Ritmo /km</div></div>
      <div class="summary-stat"><div class="v">${Math.round(a.calories)}</div><div class="l">kcal</div></div>
      <div class="summary-stat"><div class="v">${a.avgSpeed.toFixed(1)}</div><div class="l">km/h média</div></div>
      <div class="summary-stat"><div class="v">${(a.maxSpeed || 0).toFixed(1)}</div><div class="l">km/h máx</div></div>
    </div>
  `;

    // Botão compartilhar detalhe
    document.getElementById('btn-share-from-detail').onclick = () => {
      document.getElementById('modal-activity-detail').classList.add('hidden');
      openShareModal({ ...a, distance: a.distance, duration: a.duration });
    };

    document.getElementById('modal-activity-detail').classList.remove('hidden');
  };

  document.getElementById('btn-close-detail')?.addEventListener('click', () => {
    document.getElementById('modal-activity-detail').classList.add('hidden');
  });

  // ════════════════════════════════════════════════════════
  // PROFILE
  // ════════════════════════════════════════════════════════
  function loadProfileData() {
    if (!State.user || !State.userProfile) return;

    const p = State.userProfile;
    const name = p.name || State.user.displayName || 'Atleta';
    const email = State.user.email || '';

    document.getElementById('profile-name').textContent = name;
    document.getElementById('profile-email').textContent = email;
    document.getElementById('profile-name-input').value = name;
    document.getElementById('profile-weight').value = p.weight || 70;

    // Adiciona bust de cache para garantir foto mais recente
    const baseUrl = p.photoURL || getAvatarUrl(name);
    const avatarUrl = p.photoURL
      ? `${p.photoURL}?v=${Date.now()}`
      : baseUrl;

    document.getElementById('profile-avatar').src = avatarUrl;
    document.getElementById('header-avatar').src = avatarUrl;

    document.getElementById('profile-stats-row').innerHTML = `
    <div class="profile-stat"><div class="v">${p.totalRuns || 0}</div><div class="l">Corridas</div></div>
    <div class="profile-stat"><div class="v">${(p.totalDistance || 0).toFixed(1)}</div><div class="l">km totais</div></div>
    <div class="profile-stat"><div class="v">${formatDuration(p.totalDuration || 0)}</div><div class="l">Tempo</div></div>
  `;
  }

  function setupProfilePage() {
    // Avatar
    document.getElementById('btn-change-avatar').addEventListener('click', () => {
      document.getElementById('avatar-file-input').click();
    });

    document.getElementById('avatar-file-input').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const url = await readFileAsDataURL(file);
      await uploadAvatar(url);
    });

    // Save profile
    document.getElementById('btn-save-profile').addEventListener('click', saveProfile);

    // Logout
    document.getElementById('btn-logout').addEventListener('click', async () => {
      const { auth, signOut } = window.__firebase;
      await signOut(auth);
      showToast('Até logo! 👋');
    });
  }

  async function uploadAvatar(dataURL) {
    const CLOUD_NAME = 'dzesgiw8e';
    const UPLOAD_PRESET = 'pacerun_unsigned';

    const { db, doc, updateDoc } = window.__firebase;

    try {
      showToast('Enviando foto...');

      // Usa timestamp no public_id para garantir nova imagem a cada upload
      const ts = Date.now();
      const formData = new FormData();
      formData.append('file', dataURL);
      formData.append('upload_preset', UPLOAD_PRESET);
      formData.append('public_id', `pacerun/avatars/${State.user.uid}_${ts}`);

      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error?.message || `HTTP ${res.status}`);
      }

      const data = await res.json();
      // Adiciona bust de cache na URL para o browser não usar a foto antiga
      const url = `${data.secure_url}?v=${ts}`;

      await updateDoc(doc(db, 'users', State.user.uid), { photoURL: data.secure_url });
      State.userProfile.photoURL = data.secure_url;

      // Força reload nos elementos de imagem
      const avatarEls = document.querySelectorAll('#profile-avatar, #header-avatar');
      avatarEls.forEach(el => {
        el.src = '';
        el.src = url;
      });

      showToast('Foto de perfil atualizada! ✅');
    } catch (e) {
      console.error('Upload avatar error:', e);
      showToast(`Erro ao enviar foto: ${e.message}`);
    }
  }

  // ── Upload de foto de atividade (Cloudinary) ──────────────
  async function uploadActivityPhoto(dataURL, activityId) {
    const CLOUD_NAME = 'dzesgiw8e';
    const UPLOAD_PRESET = 'pacerun_unsigned';

    try {
      const formData = new FormData();
      formData.append('file', dataURL);
      formData.append('upload_preset', UPLOAD_PRESET);
      formData.append('public_id', `pacerun/activities/${State.user.uid}/${activityId}`);

      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) return null;
      const data = await res.json();
      return data.secure_url;
    } catch (e) {
      console.error('Upload activity photo error:', e);
      return null;
    }
  }

  async function saveProfile() {
    const { db, doc, updateDoc, auth, updateProfile } = window.__firebase;
    const name = document.getElementById('profile-name-input').value.trim();
    const weight = parseInt(document.getElementById('profile-weight').value) || 70;
    const btn = document.getElementById('btn-save-profile');

    if (!name) { showToast('Digite seu nome.'); return; }

    btn.textContent = 'Salvando...';
    btn.disabled = true;

    try {
      await updateDoc(doc(db, 'users', State.user.uid), { name, weight });
      await updateProfile(auth.currentUser, { displayName: name });
      State.userProfile = { ...State.userProfile, name, weight };
      updateHeaderUI();
      loadProfileData();
      showToast('Perfil atualizado!');
    } catch (e) {
      showToast('Erro ao salvar perfil.');
    } finally {
      btn.textContent = 'Salvar alterações';
      btn.disabled = false;
    }
  }

  // ════════════════════════════════════════════════════════
  // SHARE
  // ════════════════════════════════════════════════════════
  function setupShareModal() {
    document.getElementById('btn-close-share').addEventListener('click', () => {
      document.getElementById('modal-share').classList.add('hidden');
    });

    document.getElementById('share-instagram').addEventListener('click', () => shareInstagramStories());
    document.getElementById('share-facebook').addEventListener('click', () => shareFacebook());
    document.getElementById('share-whatsapp').addEventListener('click', () => shareWhatsApp());
    document.getElementById('share-other').addEventListener('click', () => shareNative());
  }

  function openShareModal(activity) {
    State.currentActivity = activity;
    const preview = document.getElementById('share-preview');
    const a = activity;

    preview.innerHTML = `
    <div style="padding:20px;background:var(--blue-900);border-radius:12px">
      <div style="font-family:var(--font-display);font-size:40px;font-weight:800;color:var(--white)">${a.distance?.toFixed(2) || '0.00'} <span style="font-size:20px;color:var(--blue-300)">km</span></div>
      <div style="display:flex;gap:20px;justify-content:center;margin-top:12px">
        <div><div style="font-size:18px;font-weight:700">${a.pace || '--:--'}</div><div style="font-size:11px;color:var(--text-muted)">Ritmo</div></div>
        <div><div style="font-size:18px;font-weight:700">${formatDuration(a.duration || 0)}</div><div style="font-size:11px;color:var(--text-muted)">Duração</div></div>
        <div><div style="font-size:18px;font-weight:700">${Math.round(a.calories || 0)}</div><div style="font-size:11px;color:var(--text-muted)">kcal</div></div>
      </div>
      <div style="margin-top:12px;font-size:13px;color:var(--text-secondary)">via PaceRun 🏃</div>
    </div>
  `;

    document.getElementById('modal-share').classList.remove('hidden');
  }

  function buildShareText() {
    const a = State.currentActivity;
    if (!a) return '';
    return `🏃 Acabei de completar ${a.distance?.toFixed(2) || '0'} km em ${formatDuration(a.duration || 0)}!\n⚡ Ritmo: ${a.pace || '--'} /km | 🔥 ${Math.round(a.calories || 0)} kcal\n\nvia PaceRun`;
  }

  function shareWhatsApp() {
    const text = encodeURIComponent(buildShareText());
    window.open(`https://wa.me/?text=${text}`, '_blank');
  }

  function shareInstagramStories() {
    // Instagram Stories só aceita via app nativo
    if (navigator.share) {
      navigator.share({ title: 'Minha corrida no PaceRun', text: buildShareText() })
        .catch(() => showToast('Compartilhamento cancelado.'));
    } else {
      copyToClipboard(buildShareText());
      showToast('Texto copiado! Cole no Instagram Stories 📋');
    }
  }

  function shareFacebook() {
    copyToClipboard(buildShareText());
    showToast('Texto copiado! Cole no Facebook Stories 📋');
  }

  function shareNative() {
    if (navigator.share) {
      navigator.share({ title: 'Minha atividade no PaceRun', text: buildShareText() })
        .catch(() => { });
    } else {
      copyToClipboard(buildShareText());
      showToast('Texto copiado para a área de transferência!');
    }
  }

  function copyToClipboard(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => { });
    }
  }

  // ════════════════════════════════════════════════════════
  // UTILS
  // ════════════════════════════════════════════════════════
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function calcCalories(distKm, durationSec) {
    const weight = State.userProfile?.weight || 70;
    const MET = State.activity.type === 'running' ? 8.5 : 3.5;
    const hours = durationSec / 3600;
    return MET * weight * hours;
  }

  function formatDuration(seconds) {
    const s = Math.round(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  function formatDateFull(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  }

  function formatDateShort(isoStr) {
    if (!isoStr) return '';
    try {
      return new Date(isoStr).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    } catch { return ''; }
  }

  function showError(el, msg) {
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 5000);
  }

  function showToast(msg, duration = 3000) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(window._toastTimeout);
    window._toastTimeout = setTimeout(() => t.classList.add('hidden'), duration);
  }

  function readFileAsDataURL(file) {
    return new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = e => res(e.target.result);
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });
  }

  // ════════════════════════════════════════════════════════
  // NOTIFICAÇÕES + CONQUISTAS
  // ════════════════════════════════════════════════════════
  const ACHIEVEMENTS = [
    { id: 'first_run', minRuns: 1, emoji: '🏃', title: 'Primeira atividade!', desc: 'Você completou sua primeira atividade no PaceRun. Bem-vindo!' },
    { id: 'km_5', minKm: 5, emoji: '⭐', title: '5 km acumulados!', desc: 'Você já percorreu 5 km no total. Continue assim!' },
    { id: 'km_10', minKm: 10, emoji: '🔟', title: '10 km acumulados!', desc: 'Marca dos 10 km atingida. Você está no caminho certo!' },
    { id: 'km_25', minKm: 25, emoji: '🥈', title: '25 km acumulados!', desc: 'Um quarto de maratona percorrido! Incrível evolução.' },
    { id: 'km_50', minKm: 50, emoji: '🥇', title: '50 km acumulados!', desc: 'Meio centenário! Você é um atleta de verdade.' },
    { id: 'km_100', minKm: 100, emoji: '💯', title: '100 km acumulados!', desc: 'Centenário! Uma conquista e tanto. Parabéns!' },
    { id: 'runs_10', minRuns: 10, emoji: '🔥', title: '10 atividades!', desc: '10 atividades completadas. A consistência é tudo!' },
    { id: 'runs_50', minRuns: 50, emoji: '🏆', title: '50 atividades!', desc: 'Você é um corredor dedicado. 50 atividades!' },
  ];

  function getNotifs() {
    try { return JSON.parse(localStorage.getItem('pacerun_notifs') || '[]'); } catch { return []; }
  }
  function saveNotifs(n) { localStorage.setItem('pacerun_notifs', JSON.stringify(n)); }

  function addNotif(notif) {
    const notifs = getNotifs();
    if (notif.id && notifs.find(n => n.id === notif.id)) return; // sem duplicata
    notifs.unshift({ ...notif, ts: Date.now(), read: false });
    if (notifs.length > 50) notifs.splice(50);
    saveNotifs(notifs);
    updateNotifBadge();
    showToast(`${notif.emoji} ${notif.title}`);
  }

  function updateNotifBadge() {
    const unread = getNotifs().filter(n => !n.read).length;
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    if (unread > 0) { badge.textContent = unread > 9 ? '9+' : unread; badge.classList.remove('hidden'); }
    else { badge.classList.add('hidden'); }
  }

  function setupNotifications() {
    document.getElementById('btn-notifications')?.addEventListener('click', openNotifModal);
    document.getElementById('btn-close-notifications')?.addEventListener('click', () => {
      document.getElementById('modal-notifications').classList.add('hidden');
    });
    document.getElementById('btn-mark-all-read')?.addEventListener('click', () => {
      saveNotifs(getNotifs().map(n => ({ ...n, read: true })));
      updateNotifBadge();
      openNotifModal();
    });
    updateNotifBadge();
  }

  function openNotifModal() {
    const notifs = getNotifs();
    const el = document.getElementById('notifications-list');
    el.innerHTML = notifs.length === 0
      ? `<div class="notif-empty"><div style="font-size:40px;margin-bottom:12px">🔔</div><p>Nenhuma notificação ainda.<br>Complete atividades para ganhar conquistas!</p></div>`
      : notifs.map(n => `
        <div class="notif-item ${n.read ? '' : 'unread'}">
          <div class="notif-icon ${n.type || 'achievement'}">${n.emoji}</div>
          <div class="notif-body">
            <div class="notif-title">${n.title}</div>
            <div class="notif-desc">${n.desc}</div>
            <div class="notif-time">${formatTimeAgo(n.ts)}</div>
          </div>
        </div>`).join('');
    document.getElementById('modal-notifications').classList.remove('hidden');
  }

  function checkAchievements(totalKm, totalRuns) {
    ACHIEVEMENTS.forEach(a => {
      const kmOk = !a.minKm || totalKm >= a.minKm;
      const runsOk = !a.minRuns || totalRuns >= a.minRuns;
      if (kmOk && runsOk) addNotif({ id: a.id, emoji: a.emoji, title: a.title, desc: a.desc, type: 'achievement' });
    });
  }

  async function checkCommunityNotifications() {
    if (!State.user) return;
    const { db, collection, query, orderBy, limit, getDocs, where } = window.__firebase;
    try {
      const q = query(
        collection(db, 'activities'),
        where('userId', '!=', State.user.uid),
        orderBy('userId'), orderBy('timestamp', 'desc'),
        limit(5)
      );
      const snap = await getDocs(q);
      snap.forEach(d => {
        const a = d.data();
        addNotif({
          id: `comm_${d.id}`,
          emoji: a.type === 'walking' ? '🚶' : '🏃',
          title: `${a.userName} completou uma atividade!`,
          desc: `${(a.distance || 0).toFixed(2)} km em ${formatDuration(a.duration || 0)} · Ritmo ${a.pace || '--'}`,
          type: 'community',
        });
      });
    } catch { /* índice não criado ainda */ }
  }

  function formatTimeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (m < 1) return 'agora mesmo';
    if (m < 60) return `há ${m} min`;
    if (h < 24) return `há ${h}h`;
    return `há ${d} dia${d > 1 ? 's' : ''}`;
  }

  // ════════════════════════════════════════════════════════
  // PRÓXIMAS CORRIDAS
  // ════════════════════════════════════════════════════════

  function setupRaces() {
    document.getElementById('btn-open-races')?.addEventListener('click', () => {
      document.getElementById('modal-races').classList.remove('hidden');
      document.getElementById('races-empty').classList.remove('hidden');
      document.getElementById('races-list').innerHTML = '';
    });

    document.getElementById('btn-close-races')?.addEventListener('click', () => {
      document.getElementById('modal-races').classList.add('hidden');
    });

    document.getElementById('btn-search-races')?.addEventListener('click', () => {
      const city = document.getElementById('races-city-input').value.trim();
      if (city) searchRaces(city);
    });

    document.getElementById('races-city-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const city = e.target.value.trim();
        if (city) searchRaces(city);
      }
    });

    // Chips de cidades rápidas
    document.querySelectorAll('.city-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.city-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        document.getElementById('races-city-input').value = chip.dataset.city;
        searchRaces(chip.dataset.city);
      });
    });
  }

  // ── Dados reais extraídos do Esportividade (São Paulo e Guarulhos) ─────────
  // Fonte: https://esportividade.com.br/corrida-de-rua/
  // Atualizado em: Junho 2026
  // ── Database de eventos reais (Esportividade, Prefeitura SP, Brasil Que Corre) ──
  const RACES_DATABASE = {
    'são paulo': [
      { name: 'Treino gratuito Vem Com Nóis – Av. Paulista', date: '10/06/2026', day: '10', month: 'JUN', distances: ['5km'], type: 'Treino Gratuito', location: 'Av. Paulista — São Paulo', description: 'Treino noturno gratuito na Av. Paulista, ponto de encontro Provisório Bar.', link: 'https://esportividade.com.br/evento/treino-gratuito-de-corrida-do-vem-com-nois-na-av-paulista-10-06-2026/', confirmed: true },
      { name: 'adidas Runners – Treino gratuito no Ceret', date: '11/06/2026', day: '11', month: 'JUN', distances: ['5km', '10km'], type: 'Treino Gratuito', location: 'CERET — Zona Leste, São Paulo', description: 'Treino gratuito do grupo adidas Runners no CERET.', link: 'https://esportividade.com.br/evento/adidas-runners-treino-gratuito-no-ceret-11-06-2026/', confirmed: true },
      { name: 'Urban Walk 2026 – Parque Villa-Lobos', date: '13/06/2026', day: '13', month: 'JUN', distances: ['5km', '10km'], type: 'Caminhada', location: 'Parque Villa-Lobos — São Paulo', description: 'Evento de caminhada e corrida urbana no Parque Villa-Lobos.', link: 'https://esportividade.com.br/evento/urban-walk-2026-parque-villa-lobos-sao-paulo/', confirmed: true },
      { name: 'Corrida Copa do Mundo no Ceret 2026', date: '13/06/2026', day: '13', month: 'JUN', distances: ['5km', '10km'], type: 'Corrida de Rua', location: 'CERET — Zona Leste, São Paulo', description: 'Corrida temática Copa do Mundo no CERET.', link: 'https://esportividade.com.br/evento/corrida-copa-do-mundo-no-ceret-2026-sao-paulo/', confirmed: true },
      { name: 'VEJA Shift Run – Treino gratuito', date: '13/06/2026', day: '13', month: 'JUN', distances: ['5km'], type: 'Treino Gratuito', location: 'VEJA Oscar Freire — São Paulo', description: 'Treino gratuito de corrida com a VEJA na Oscar Freire.', link: 'https://esportividade.com.br/evento/veja-shift-run-treino-gratuito-de-corrida-13-06-2026/', confirmed: true },
      { name: 'Live! Run XP – Etapa Indaiatuba (Junho)', date: '21/06/2026', day: '21', month: 'JUN', distances: ['5km', '10km', '21km'], type: 'Corrida de Rua', location: 'Indaiatuba — SP', description: 'Etapa de junho do circuito Live! Run XP em Indaiatuba.', link: 'https://esportividade.com.br/corrida-de-rua/live-run-xp/', confirmed: true },
      { name: 'Live! Run XP – Etapa Jundiaí (Junho)', date: '28/06/2026', day: '28', month: 'JUN', distances: ['5km', '10km', '21km'], type: 'Corrida de Rua', location: 'Jundiaí — SP', description: 'Etapa de junho do circuito Live! Run XP em Jundiaí.', link: 'https://esportividade.com.br/corrida-de-rua/live-run-xp/', confirmed: true },
      { name: 'Live! Run XP – Etapa São Paulo (Julho)', date: '12/07/2026', day: '12', month: 'JUL', distances: ['5km', '10km', '21km'], type: 'Corrida de Rua', location: 'São Paulo — SP', description: 'Etapa de julho do circuito Live! Run XP em São Paulo.', link: 'https://esportividade.com.br/corrida-de-rua/live-run-xp/', confirmed: true },
      { name: 'Live! Run XP – Etapa Ribeirão Preto (Julho)', date: '19/07/2026', day: '19', month: 'JUL', distances: ['5km', '10km'], type: 'Corrida de Rua', location: 'Ribeirão Preto — SP', description: 'Etapa de julho do circuito Live! Run XP em Ribeirão Preto.', link: 'https://esportividade.com.br/corrida-de-rua/live-run-xp/', confirmed: true },
      { name: 'Live! Run XP – Etapa Sorocaba (Julho)', date: '26/07/2026', day: '26', month: 'JUL', distances: ['5km', '10km'], type: 'Corrida de Rua', location: 'Sorocaba — SP', description: 'Etapa de julho do circuito Live! Run XP em Sorocaba.', link: 'https://esportividade.com.br/corrida-de-rua/live-run-xp/', confirmed: true },
      { name: 'Live! Run XP – Etapa São Paulo (Agosto)', date: '16/08/2026', day: '16', month: 'AGO', distances: ['5km', '10km', '21km'], type: 'Corrida de Rua', location: 'São Paulo — SP', description: 'Etapa de agosto do circuito Live! Run XP em São Paulo.', link: 'https://esportividade.com.br/corrida-de-rua/live-run-xp/', confirmed: true },
      { name: 'Netshoes Run', date: '23/08/2026', day: '23', month: 'AGO', distances: ['5km', '10km'], type: 'Corrida de Rua', location: 'Parque do Povo — Marginal Pinheiros, São Paulo', description: 'Corrida oficial Netshoes no Parque do Povo.', link: 'https://prefeitura.sp.gov.br/web/esportes/w/corridas_de_rua/8722', confirmed: true },
      { name: 'Todateen Night Run 2026', date: '29/08/2026', day: '29', month: 'AGO', distances: ['5km', '10km'], type: 'Corrida Noturna', location: 'Sambódromo do Anhembi — São Paulo', description: 'Corrida noturna Todateen no Sambódromo do Anhembi.', link: 'https://prefeitura.sp.gov.br/web/esportes/w/corridas_de_rua/8722', confirmed: true },
      { name: 'Run The Bridge', date: '30/08/2026', day: '30', month: 'AGO', distances: ['5km', '10km', '21km'], type: 'Corrida de Rua', location: 'Ponte Estaiada — Marginal Pinheiros, São Paulo', description: 'Corrida com largada na icônica Ponte Estaiada.', link: 'https://prefeitura.sp.gov.br/web/esportes/w/corridas_de_rua/8722', confirmed: true },
      { name: 'Palmeiras Run', date: '30/08/2026', day: '30', month: 'AGO', distances: ['5km', '10km'], type: 'Corrida de Rua', location: 'Allianz Parque — São Paulo', description: 'Corrida oficial do Palmeiras com chegada no Allianz Parque.', link: 'https://prefeitura.sp.gov.br/web/esportes/w/corridas_de_rua/8722', confirmed: true },
      { name: '19ª Corrida Juventus Viva a Mooca', date: '30/08/2026', day: '30', month: 'AGO', distances: ['5km', '10km'], type: 'Corrida de Rua', location: 'Clube Juventus — Mooca, São Paulo', description: 'Tradicional corrida do Clube Atlético Juventus na Mooca.', link: 'https://prefeitura.sp.gov.br/web/esportes/w/corridas_de_rua/8722', confirmed: true },
      { name: 'Santander Track&Fields – Obelisco Ibirapuera', date: '13/09/2026', day: '13', month: 'SET', distances: ['5km', '10km'], type: 'Corrida de Rua', location: 'Obelisco do Ibirapuera — São Paulo', description: 'Etapa da série Santander T&F no Obelisco do Ibirapuera.', link: 'https://www.olympics.com/pt/noticias/corrida-de-rua-sao-paulo-2026-calendario-provas', confirmed: true },
      { name: 'Santander Track&Fields – Esporte Clube Pinheiros', date: '13/09/2026', day: '13', month: 'SET', distances: ['5km', '10km'], type: 'Corrida de Rua', location: 'Esporte Clube Pinheiros — São Paulo', description: 'Etapa da série Santander T&F no Esporte Clube Pinheiros.', link: 'https://www.olympics.com/pt/noticias/corrida-de-rua-sao-paulo-2026-calendario-provas', confirmed: true },
      { name: 'Live! Run XP – Etapa São Paulo (Setembro)', date: '13/09/2026', day: '13', month: 'SET', distances: ['5km', '10km', '21km'], type: 'Corrida de Rua', location: 'São Paulo — SP', description: 'Etapa de setembro do circuito Live! Run XP em São Paulo.', link: 'https://esportividade.com.br/corrida-de-rua/live-run-xp/', confirmed: true },
      { name: 'Maratona Internacional de SP (FILA) – USP', date: '20/09/2026', day: '20', month: 'SET', distances: ['5km', '10km', '21km', '42km'], type: 'Maratona', location: 'Campus USP — São Paulo', description: 'Maratona Internacional de São Paulo da FILA, uma das maiores corridas do Brasil.', link: 'https://www.olympics.com/pt/noticias/corrida-de-rua-sao-paulo-2026-calendario-provas', confirmed: true },
      { name: 'Santander Track&Fields – JK Iguatemi III', date: '11/10/2026', day: '11', month: 'OUT', distances: ['5km', '10km', '21km'], type: 'Corrida de Rua', location: 'Shopping JK Iguatemi — São Paulo', description: 'Etapa do T&F Series no JK Iguatemi com opção de 21km.', link: 'https://www.olympics.com/pt/noticias/corrida-de-rua-sao-paulo-2026-calendario-provas', confirmed: true },
      { name: 'Athenas Run Longer', date: '18/10/2026', day: '18', month: 'OUT', distances: ['7km', '14km', '21km', '28km'], type: 'Corrida de Rua', location: 'Parque do Povo — Marginal Pinheiros, São Paulo', description: 'Corrida especial Athenas com distâncias longas: 7, 14, 21 e 28km.', link: 'https://www.olympics.com/pt/noticias/corrida-de-rua-sao-paulo-2026-calendario-provas', confirmed: true },
      { name: 'Santander Track&Fields – Center Norte III', date: '18/10/2026', day: '18', month: 'OUT', distances: ['5km', '10km'], type: 'Corrida de Rua', location: 'Shopping Center Norte — São Paulo', description: 'Etapa da série Santander T&F no Shopping Center Norte.', link: 'https://www.olympics.com/pt/noticias/corrida-de-rua-sao-paulo-2026-calendario-provas', confirmed: true },
      { name: 'Santander Track&Fields – Pátio Higienópolis', date: '19/10/2026', day: '19', month: 'OUT', distances: ['5km', '10km'], type: 'Corrida de Rua', location: 'Praça Charles Miller — São Paulo', description: 'Etapa da série Santander T&F com largada na Praça Charles Miller.', link: 'https://www.olympics.com/pt/noticias/corrida-de-rua-sao-paulo-2026-calendario-provas', confirmed: true },
      { name: 'Nike SP City Marathon 2026', date: '01/11/2026', day: '01', month: 'NOV', distances: ['10km', '21km', '42km'], type: 'Maratona', location: 'São Paulo — SP', description: 'Nike SP City Marathon 2026 com percurso reformulado. Uma das corridas mais aguardadas do ano.', link: 'https://esportividade.com.br/nike-sp-city-marathon-percurso-muda-para-2026-e-nike-realiza-treinos-gratis/', confirmed: false },
      { name: 'Circuito das Estações – Verão', date: '15/11/2026', day: '15', month: 'NOV', distances: ['5km', '10km'], type: 'Corrida de Rua', location: 'Praça Charles Miller — São Paulo', description: 'Etapa de Verão do tradicional Circuito das Estações.', link: 'https://prefeitura.sp.gov.br/web/esportes/w/corridas_de_rua/8722', confirmed: true },
      { name: 'Corrida Internacional de São Silvestre', date: '31/12/2026', day: '31', month: 'DEZ', distances: ['15km'], type: 'Corrida Internacional', location: 'Av. Paulista — São Paulo', description: 'A mais tradicional corrida de rua do Brasil na Av. Paulista, desde 1924.', link: 'https://www.saosilvestre.com.br/', confirmed: true },
    ],
    'guarulhos': [
      { name: 'Corrida Rotary Guarulhos', date: '13/09/2026', day: '13', month: 'SET', distances: ['5km', '10km'], type: 'Corrida de Rua', location: 'Guarulhos — SP', description: 'Corrida organizada pelo Rotary Club de Guarulhos.', link: 'https://brasilquecorre.com/saopaulo', confirmed: true },
      { name: 'Calendário completo — Esportividade', date: '', day: '📅', month: 'SP', distances: ['5km', '10km', '21km'], type: 'Calendário', location: 'Guarulhos — SP', description: 'Acesse o calendário completo de corridas na região metropolitana de SP, incluindo Guarulhos.', link: 'https://esportividade.com.br/corrida-de-rua/', confirmed: true },
      { name: 'Buscar corridas em Guarulhos 2026', date: '', day: '🔍', month: 'Google', distances: [], type: 'Pesquisa', location: 'Guarulhos — SP', description: 'Toque para buscar eventos de corrida em Guarulhos no Google.', link: 'https://www.google.com/search?q=corridas+de+rua+guarulhos+2026', confirmed: false },
    ],
  };

  // ── Paginação de eventos ───────────────────────────────
  const EVENTS_PAGE_SIZE = 5;
  let _eventsPage = 0;
  let _eventsAll  = [];

  async function searchRaces(city) {
    const loadingEl = document.getElementById('races-loading');
    const emptyEl = document.getElementById('races-empty');
    const listEl = document.getElementById('races-list');

    emptyEl.classList.add('hidden');
    listEl.innerHTML = '';
    loadingEl.classList.remove('hidden');
    document.getElementById('races-loading-city').textContent = city;

    // Simula loading para melhor UX
    await new Promise(r => setTimeout(r, 600));

    const cityKey = city.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

    let races = null;
    for (const key of Object.keys(RACES_DATABASE)) {
      const nk = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (cityKey.includes(nk) || nk.includes(cityKey)) { races = RACES_DATABASE[key]; break; }
    }

    if (races) {
      const today = new Date(); today.setHours(0,0,0,0);
      _eventsAll = races
        .filter(r => {
          if (!r.date || r.date.length < 8) return true;
          const [d, m, y] = r.date.split('/');
          return new Date(`${y}-${m}-${d}`) >= today;
        })
        .sort((a, b) => {
          if (!a.date || a.date.length < 8) return 1;
          if (!b.date || b.date.length < 8) return -1;
          const [da, ma, ya] = a.date.split('/');
          const [db2, mb, yb] = b.date.split('/');
          return new Date(`${ya}-${ma}-${da}`) - new Date(`${yb}-${mb}-${db2}`);
        });
    } else {
      _eventsAll = [
        { name: `Calendário Esportividade`, date: '', day: '📅', month: '2026', distances: ['Várias'], type: 'Calendário', location: city, description: `Para ${city}, acesse o calendário completo no Esportividade.`, link: 'https://esportividade.com.br/corrida-de-rua/', confirmed: true },
        { name: `Buscar corridas em ${city} 2026`, date: '', day: '🔍', month: 'Google', distances: [], type: 'Pesquisa', location: city, description: `Buscar eventos em ${city} no Google.`, link: `https://www.google.com/search?q=corridas+de+rua+${encodeURIComponent(city)}+2026`, confirmed: false },
      ];
    }

    _eventsPage = 0;
    renderEventsPage(listEl);
    loadingEl.classList.add('hidden');
  }

  function renderEventsPage(listEl) {
    const start   = _eventsPage * EVENTS_PAGE_SIZE;
    const page    = _eventsAll.slice(start, start + EVENTS_PAGE_SIZE);
    const hasMore = start + EVENTS_PAGE_SIZE < _eventsAll.length;
    const remaining = _eventsAll.length - (start + EVENTS_PAGE_SIZE);

    listEl.querySelector('.btn-more-events')?.remove();
    listEl.querySelector('.races-disclaimer')?.remove();

    const html = page.map(r => {
      const distTags = (r.distances || []).map(d => `<span class="race-tag dist">${d}</span>`).join('');
      const linkEl = r.link
        ? `<a href="${r.link}" target="_blank" rel="noopener noreferrer" class="race-link"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Ver inscrições</a>`
        : `<p class="race-no-link">🔍 Pesquise o nome do evento</p>`;
      const unconfirmed = !r.confirmed ? `<span class="race-tag type" style="background:rgba(255,77,77,0.1);color:#FF8080">Não confirmado</span>` : '';
      return `<div class="race-card">
        <div class="race-card-top">
          <div class="race-date-badge"><div class="day">${r.day||'--'}</div><div class="month">${r.month||'---'}</div></div>
          <div class="race-info">
            <div class="race-name">${r.name}</div>
            <div class="race-meta">${distTags}${r.type?`<span class="race-tag type">${r.type}</span>`:''}${r.location?`<span class="race-tag city">📍 ${r.location}</span>`:''}${unconfirmed}</div>
          </div>
        </div>
        ${r.description?`<p class="race-desc">${r.description}</p>`:''}${linkEl}
      </div>`;
    }).join('');

    if (_eventsPage === 0) {
      listEl.innerHTML = html;
    } else {
      listEl.insertAdjacentHTML('beforeend', html);
    }

    if (hasMore) {
      listEl.insertAdjacentHTML('beforeend', `
        <button class="btn-more-events" onclick="window.loadMoreEvents()">
          📅 Ver mais ${Math.min(remaining, EVENTS_PAGE_SIZE)} eventos
          <span style="color:var(--text-muted);font-size:11px;display:block;margin-top:3px">${remaining} restante${remaining!==1?'s':''}</span>
        </button>`);
    }

    listEl.insertAdjacentHTML('beforeend', `
      <div class="races-disclaimer">
        📍 Fontes: <a href="https://esportividade.com.br/corrida-de-rua/" target="_blank" style="color:var(--blue-300)">Esportividade</a> · <a href="https://prefeitura.sp.gov.br/web/esportes/w/corridas_de_rua/8722" target="_blank" style="color:var(--blue-300)">Prefeitura SP</a> · Confirme datas nos sites oficiais.
      </div>`);
  }

  window.loadMoreEvents = function() {
    _eventsPage++;
    const listEl = document.getElementById('races-list');
    renderEventsPage(listEl);
    setTimeout(() => {
      const cards = listEl.querySelectorAll('.race-card');
      const firstNew = cards[_eventsPage * EVENTS_PAGE_SIZE];
      if (firstNew) firstNew.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  // ════════════════════════════════════════════════════════
  // MENU HAMBURGUER
  // ════════════════════════════════════════════════════════
  const APP_VERSION = 'v1.5.0';

  function setupHamburgerMenu() {
    const overlay = document.getElementById('hamburger-overlay');
    const drawer  = document.getElementById('hamburger-drawer');

    // Abre o drawer
    document.getElementById('btn-hamburger')?.addEventListener('click', openDrawer);

    // Fecha ao clicar no overlay ou no X
    overlay?.addEventListener('click', closeDrawer);
    document.getElementById('btn-close-drawer')?.addEventListener('click', closeDrawer);

    // Navegação pelos itens do drawer
    document.querySelectorAll('.drawer-item[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        navigateTo(btn.dataset.page);
        closeDrawer();
      });
    });

    // Releases
    document.getElementById('drawer-btn-releases')?.addEventListener('click', () => {
      closeDrawer();
      document.getElementById('modal-releases').classList.remove('hidden');
    });
    document.getElementById('btn-close-releases')?.addEventListener('click', () => {
      document.getElementById('modal-releases').classList.add('hidden');
    });

    // Notificações via drawer
    document.getElementById('drawer-btn-notifications')?.addEventListener('click', () => {
      closeDrawer();
      openNotifModal();
    });

    // Logout via drawer
    document.getElementById('drawer-btn-logout')?.addEventListener('click', async () => {
      const { auth, signOut } = window.__firebase;
      closeDrawer();
      await signOut(auth);
    });

    // Swipe para fechar (iOS)
    let touchStartX = 0;
    drawer?.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
    drawer?.addEventListener('touchend', e => {
      const diff = e.changedTouches[0].clientX - touchStartX;
      if (diff < -60) closeDrawer(); // swipe left fecha
    }, { passive: true });

    // Define versão em todos os lugares
    document.querySelectorAll('#drawer-version, #drawer-footer-version, .drawer-badge').forEach(el => {
      el.textContent = APP_VERSION;
    });

    updateDrawerUser();
  }

  function openDrawer() {
    document.getElementById('hamburger-overlay').classList.remove('hidden');
    document.getElementById('hamburger-drawer').classList.remove('hidden');
    // Pequeno delay para a animação funcionar
    requestAnimationFrame(() => {
      document.getElementById('hamburger-drawer').classList.add('open');
      document.getElementById('hamburger-overlay').classList.add('open');
    });
    updateDrawerUser();
    updateDrawerNotifBadge();
  }

  function closeDrawer() {
    const drawer  = document.getElementById('hamburger-drawer');
    const overlay = document.getElementById('hamburger-overlay');
    drawer.classList.remove('open');
    overlay.classList.remove('open');
    setTimeout(() => {
      drawer.classList.add('hidden');
      overlay.classList.add('hidden');
    }, 280);
  }

  function updateDrawerUser() {
    const name  = State.userProfile?.name || State.user?.displayName || 'Atleta';
    const email = State.user?.email || '';
    const photo = State.userProfile?.photoURL;

    const nameEl   = document.getElementById('drawer-user-name');
    const emailEl  = document.getElementById('drawer-user-email');
    const avatarEl = document.getElementById('drawer-avatar');

    if (nameEl)  nameEl.textContent  = name;
    if (emailEl) emailEl.textContent = email;
    if (avatarEl) {
      avatarEl.src = photo ? `${photo}?v=${Date.now()}` : getAvatarUrl(name);
    }
  }

  function updateDrawerNotifBadge() {
    const count = getNotifs().filter(n => !n.read).length;
    const badge = document.getElementById('drawer-notif-badge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 9 ? '9+' : count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  // ── PWA Service Worker Registration ───────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(e => console.warn('SW:', e));
    });
  }