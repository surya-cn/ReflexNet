import { supabase, initAuth, getSessionToken } from './auth';
import { GameArena } from './game';
import { TelemetryProcessor } from './telemetry';

// UI Elements
const uiLayer = document.getElementById('ui-layer')!;
const authPanel = document.getElementById('auth-panel')!;
const authForm = document.getElementById('auth-form') as HTMLFormElement;
const authSubmitBtn = document.getElementById('auth-submit-btn')!;
const authToggleLink = document.getElementById('auth-toggle-link')!;
const googleLoginBtn = document.getElementById('google-login-btn')!;
const authSubtitle = document.getElementById('auth-subtitle')!;
const usernameGroup = document.getElementById('username-group')!;
const usernameInput = document.getElementById('username') as HTMLInputElement;
const passwordReqs = document.getElementById('password-reqs')!;
const forgotPasswordLink = document.getElementById('forgot-password-link')!;
const forgotPasswordPanel = document.getElementById('forgot-password-panel')!;
const forgotPasswordForm = document.getElementById('forgot-password-form') as HTMLFormElement;
const backToLoginLink = document.getElementById('back-to-login-link')!;
const resetMessage = document.getElementById('reset-message')!;
const apiSetupPanel = document.getElementById('api-setup-panel')!;
const apiSetupForm = document.getElementById('api-setup-form') as HTMLFormElement;
const testApiBtn = document.getElementById('test-api-btn')!;
const saveApiBtn = document.getElementById('save-api-btn') as HTMLButtonElement;
const apiTestResult = document.getElementById('api-test-result')!;
const apiHelpPanel = document.getElementById('api-help-panel')!;
const openApiHelpLink = document.getElementById('open-api-help-link')!;
const closeApiHelpBtn = document.getElementById('close-api-help-btn')!;
const apiSettingsPanel = document.getElementById('api-settings-panel')!;
const apiSettingsForm = document.getElementById('api-settings-form') as HTMLFormElement;
const newGroqApiKey = document.getElementById('new-groq-api-key') as HTMLInputElement;
const settingsApiTestResult = document.getElementById('settings-api-test-result')!;
const openApiSettingsBtn = document.getElementById('open-api-settings-btn')!;
const closeApiSettingsBtn = document.getElementById('close-api-settings-btn')!;
const updateApiBtn = document.getElementById('update-api-btn') as HTMLButtonElement;
const settingsOpenApiHelpLink = document.getElementById('settings-open-api-help-link')!;
const setupPanel = document.getElementById('setup-panel')!;
const hudPanel = document.getElementById('hud-panel')!;
const resultsPanel = document.getElementById('results-panel')!;
const historySidebar = document.getElementById('history-sidebar')!;
const bottomRightMenu = document.getElementById('bottom-right-menu')!;
const topMenu = document.getElementById('top-menu')!;
const transitionOverlay = document.getElementById('transition-overlay')!;
const transitionTitle = document.getElementById('transition-title')!;
const transitionCountdown = document.getElementById('transition-countdown')!;
const pauseMenu = document.getElementById('pause-menu')!;
const resumeBtn = document.getElementById('resume-btn')!;

const targetsHitText = document.getElementById('targets-hit')!;
const drillTimerText = document.getElementById('drill-timer')!;

// Gauntlet State
const GAUNTLET_MODES = ['flicking', 'micro_adjustment', 'tracking'];
let currentModeIndex = 0;
let assessmentData: Record<string, any> = {};
let currentConfig = { dpi: 800, pollingRate: 1000, game: 'CS2', sens: null as number | null };
let arena: GameArena | null = null;
let transitionInterval: number | null = null;

// Game Engine Yaw Constants Dictionary
const GAME_YAW_RATES: Record<string, number> = {
  "CS2": 0.022,
  "VALORANT": 0.07,
  "Apex Legends": 0.022,
  "Call of Duty": 0.0066,
  "The Finals": 0.0066,
  "Overwatch 2": 0.0066,
  "Rainbow Six Siege": 0.00573,
  "Fortnite": 0.005555
};

function calculateInGameSens(cm360: number, dpi: number, game: string): string {
  // Default to Source engine (0.022) if the game string isn't found
  const yaw = GAME_YAW_RATES[game] || 0.022; 
  const sensitivity = (360 * 2.54) / (cm360 * yaw * dpi);
  
  // Return fixed to 3 decimal places, which is standard for game engines
  return sensitivity.toFixed(3); 
}

function calculateCm360(sens: number, dpi: number, game: string): number {
  const yaw = GAME_YAW_RATES[game] || 0.022; 
  return (360 * 2.54) / (sens * yaw * dpi);
}

// ============================================================================
// Auth & History Initialization
// ============================================================================

let initialLoad = true;

initAuth(async (session) => {
  if (session) {
    const user = session.user;
    const name = user.user_metadata?.username || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Player';
    document.getElementById('history-username')!.innerText = name;

    if (initialLoad) {
      authPanel.classList.add('hidden');
      topMenu.classList.add('hidden');
      hudPanel.classList.add('hidden');
      resultsPanel.classList.add('hidden');
      
      const { data: profile, error } = await supabase.from('profiles').select('encrypted_groq_key').eq('id', user.id).single();

      if (error && error.code === 'PGRST116') {
        // Row doesn't exist yet
        apiSetupPanel.classList.remove('hidden');
        setupPanel.classList.add('hidden');
        historySidebar.classList.add('hidden');
        bottomRightMenu.classList.add('hidden');
      } else if (profile && profile.encrypted_groq_key) {
        apiSetupPanel.classList.add('hidden');
        setupPanel.classList.remove('hidden');
        historySidebar.classList.remove('hidden');
        bottomRightMenu.classList.remove('hidden');
      } else {
        // Row exists but key is null
        apiSetupPanel.classList.remove('hidden');
        setupPanel.classList.add('hidden');
        historySidebar.classList.add('hidden');
        bottomRightMenu.classList.add('hidden');
      }
      initialLoad = false;
    }
    await loadHistory();
  } else {
    authPanel.classList.remove('hidden');
    apiSetupPanel.classList.add('hidden');
    setupPanel.classList.add('hidden');
    historySidebar.classList.add('hidden');
    bottomRightMenu.classList.add('hidden');
    topMenu.classList.add('hidden');
    hudPanel.classList.add('hidden');
    resultsPanel.classList.add('hidden');
  }
});

async function loadHistory() {
  const list = document.getElementById('history-list')!;
  list.innerHTML = '<li class="history-empty">Loading history...</li>';

  const { data, error } = await supabase
    .from('telemetry_sessions')
    .select('created_at, metrics_summary, recommended_cm_per_360, target_game, dpi, recommended_edpi')
    .order('created_at', { ascending: false })
    .limit(10); // UI display limit

  if (error || !data || data.length === 0) {
    list.innerHTML = '<li class="history-empty">No previous sessions found.</li>';
    return;
  }

  list.innerHTML = '';
  data.forEach((session, i) => {
    const li = document.createElement('li');
    const date = new Date(session.created_at).toLocaleDateString();
    
    const flickEff = session.metrics_summary?.flicking?.path_efficiency?.toFixed(2) || '--';
    const trackAcc = session.metrics_summary?.tracking?.tracking_accuracy 
      ? (session.metrics_summary.tracking.tracking_accuracy * 100).toFixed(0) + '%' 
      : '--';

    let inGameSensDisplay = 'N/A';
    let edpiDisplay = '';
    const gameName = session.target_game || 'Unknown Game';
    
    if (session.recommended_cm_per_360 && session.target_game && session.dpi) {
      inGameSensDisplay = calculateInGameSens(session.recommended_cm_per_360, session.dpi, session.target_game);
      
      // Fallback eDPI calculation for older legacy logs
      const parsedSens = parseFloat(inGameSensDisplay);
      if (!isNaN(parsedSens)) {
        edpiDisplay = ` | eDPI: <strong style="color:var(--accent);">${Math.round(parsedSens * session.dpi)}</strong>`;
      }
    }
    
    // Modern logs have recommended_edpi saved natively
    if (session.recommended_edpi != null) {
      edpiDisplay = ` | eDPI: <strong style="color:var(--accent);">${Math.round(session.recommended_edpi)}</strong>`;
    }

    li.innerHTML = `
      <strong>Attempt #${data.length - i} (${date})</strong><br/>
      <span style="color:#94a3b8; font-size:0.8rem; margin-bottom: 2px; display: inline-block;">
        Game: <strong>${gameName}</strong>
      </span><br/>
      <span style="color:#94a3b8; font-size:0.8rem;">
        Flick Eff: ${flickEff} | Track Acc: ${trackAcc} <br/>
        Recommended Sens: <strong style="color:var(--accent);">${inGameSensDisplay}</strong>${edpiDisplay}
      </span>
    `;
    list.appendChild(li);
  });
}

// ============================================================================
// Forms & UI Handlers
// ============================================================================

let isRegisterMode = false;

authToggleLink.addEventListener('click', (e) => {
  e.preventDefault();
  isRegisterMode = !isRegisterMode;
  authSubmitBtn.innerText = isRegisterMode ? 'Register' : 'Login';
  authToggleLink.innerText = isRegisterMode ? 'Already registered? Click here to login' : 'Not registered yet? Click here to register';
  authSubtitle.innerText = isRegisterMode ? 'Create a new account' : 'AI-Powered Sensitivity Optimization';
  document.getElementById('auth-error')!.innerText = '';
  
  if (isRegisterMode) {
    usernameGroup.classList.remove('hidden');
    passwordReqs.classList.remove('hidden');
    forgotPasswordLink.classList.add('hidden');
    usernameInput.required = true;
  } else {
    usernameGroup.classList.add('hidden');
    passwordReqs.classList.add('hidden');
    forgotPasswordLink.classList.remove('hidden');
    usernameInput.required = false;
  }
});

// Google Login
const errBox = document.getElementById('auth-error')!;

googleLoginBtn.addEventListener('click', async () => {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
    }
  });
  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('already registered') || msg.includes('different provider') || msg.includes('provideremailmismatch') || msg.includes('useralreadyexists')) {
      errBox.innerText = "An account with this email exists. Please sign in using your original method to link them.";
    } else {
      errBox.innerText = error.message;
    }
  }
});

window.addEventListener('DOMContentLoaded', () => {
  if (window.location.hash.includes('error_description=')) {
    const params = new URLSearchParams(window.location.hash.substring(1));
    const errDesc = (params.get('error_description') || '').toLowerCase();
    if (errDesc.includes('already registered') || errDesc.includes('different provider') || errDesc.includes('provideremailmismatch') || errDesc.includes('useralreadyexists')) {
      errBox.innerText = "An account with this email exists. Please sign in using your original method to link them.";
      window.history.replaceState(null, '', window.location.pathname);
    }
  }
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = (document.getElementById('email') as HTMLInputElement).value;
  const password = (document.getElementById('password') as HTMLInputElement).value;
  const errBox = document.getElementById('auth-error')!;
  errBox.innerText = isRegisterMode ? 'Registering...' : 'Logging in...';

  if (isRegisterMode) {
    const username = usernameInput.value.trim();
    const strongPasswordRegex = /^(?=.*[A-Z])(?=.*[!@#$&*]).{8,}$/;
    if (!strongPasswordRegex.test(password)) {
      errBox.innerText = 'Password must be at least 8 characters, with 1 uppercase letter and 1 symbol.';
      return;
    }

    const { error } = await supabase.auth.signUp({ 
      email, 
      password,
      options: { data: { username } }
    });
    
    if (error) {
      errBox.innerText = error.message;
    } else {
      errBox.innerText = 'Registration successful! An email has been sent. Please verify and login back.';
      errBox.style.color = 'var(--accent)';
      setTimeout(() => {
        isRegisterMode = false;
        authSubmitBtn.innerText = 'Login';
        authToggleLink.innerText = 'Not registered yet? Click here to register';
        authSubtitle.innerText = 'AI-Powered Sensitivity Optimization';
        usernameGroup.classList.add('hidden');
        passwordReqs.classList.add('hidden');
        forgotPasswordLink.classList.remove('hidden');
        usernameInput.required = false;
        errBox.innerText = '';
        errBox.style.color = '#ef4444'; // reset to error red
      }, 5000);
    }
  } else {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('already registered') || msg.includes('different provider') || msg.includes('provideremailmismatch') || msg.includes('useralreadyexists')) {
        errBox.innerText = "An account with this email exists. Please sign in using your original method to link them.";
      } else {
        errBox.innerText = error.message;
      }
    } else {
      errBox.innerText = '';
    }
  }
});

let validatedGroqKey = '';

testApiBtn.addEventListener('click', async () => {
  const keyInput = (document.getElementById('groq-api-key') as HTMLInputElement).value.trim();
  if (!keyInput) {
    apiTestResult.innerText = 'Please enter a valid Groq API Key.';
    apiTestResult.style.color = '#ef4444';
    return;
  }
  
  testApiBtn.innerText = 'Testing...';
  apiTestResult.innerText = '';
  
  try {
    const res = await fetch('http://localhost:5000/api/verify-groq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: keyInput })
    });
    
    if (res.ok) {
      const data = await res.json();
      apiTestResult.innerText = 'Connection Successful! You can now continue.';
      apiTestResult.style.color = 'var(--accent)';
      validatedGroqKey = data.encryptedKey;
      saveApiBtn.disabled = false;
    } else {
      const data = await res.json();
      apiTestResult.innerText = data.error || 'Failed to verify key.';
      apiTestResult.style.color = '#ef4444';
      saveApiBtn.disabled = true;
    }
  } catch (err) {
    apiTestResult.innerText = 'Network error while verifying key.';
    apiTestResult.style.color = '#ef4444';
    saveApiBtn.disabled = true;
  }
  
  testApiBtn.innerText = 'Test Connection';
});

apiSetupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validatedGroqKey) return;
  
  saveApiBtn.innerText = 'Saving...';
  saveApiBtn.disabled = true;
  
  const sessionRes = await supabase.auth.getSession();
  const userId = sessionRes.data.session?.user.id;
  
  const { error } = await supabase.from('profiles').upsert({ 
    id: userId,
    encrypted_groq_key: validatedGroqKey,
    updated_at: new Date().toISOString()
  }, { 
    onConflict: 'id' 
  });
  
  if (error) {
    apiTestResult.innerText = 'Failed to save key: ' + error.message;
    apiTestResult.style.color = '#ef4444';
    saveApiBtn.innerText = 'Save & Continue';
    saveApiBtn.disabled = false;
  } else {
    // Proceed to calibration
    apiSetupPanel.classList.add('hidden');
    setupPanel.classList.remove('hidden');
    historySidebar.classList.remove('hidden');
    bottomRightMenu.classList.remove('hidden');
  }
});

// ============================================================================
// API Help Toggles
// ============================================================================
openApiHelpLink.addEventListener('click', (e) => {
  e.preventDefault();
  apiSetupPanel.classList.add('hidden');
  apiHelpPanel.classList.remove('hidden');
});

closeApiHelpBtn.addEventListener('click', () => {
  apiHelpPanel.classList.add('hidden');
  apiSetupPanel.classList.remove('hidden');
});

// ============================================================================
// API Settings Panel Flow
// ============================================================================

openApiSettingsBtn.addEventListener('click', () => {
  newGroqApiKey.value = '';
  settingsApiTestResult.innerText = '';
  apiSettingsPanel.classList.remove('hidden');
});

closeApiSettingsBtn.addEventListener('click', () => {
  apiSettingsPanel.classList.add('hidden');
});

settingsOpenApiHelpLink.addEventListener('click', (e) => {
  e.preventDefault();
  apiSettingsPanel.classList.add('hidden');
  apiHelpPanel.classList.remove('hidden');
});

apiSettingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const keyInput = newGroqApiKey.value.trim();
  if (!keyInput) return;

  updateApiBtn.innerText = 'Testing...';
  updateApiBtn.disabled = true;
  settingsApiTestResult.innerText = '';

  try {
    const res = await fetch('http://localhost:5000/api/verify-groq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: keyInput })
    });

    if (res.ok) {
      const data = await res.json();
      settingsApiTestResult.innerText = 'Connection Successful! Saving...';
      settingsApiTestResult.style.color = 'var(--accent)';

      const sessionRes = await supabase.auth.getSession();
      const userId = sessionRes.data.session?.user.id;

      const { error } = await supabase.from('profiles').upsert({
        id: userId,
        encrypted_groq_key: data.encryptedKey,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'id'
      });

      if (error) {
        settingsApiTestResult.innerText = 'Failed to save key: ' + error.message;
        settingsApiTestResult.style.color = '#ef4444';
        updateApiBtn.innerText = 'Update Key';
        updateApiBtn.disabled = false;
      } else {
        settingsApiTestResult.innerText = 'API Key updated successfully!';
        setTimeout(() => {
          apiSettingsPanel.classList.add('hidden');
          updateApiBtn.innerText = 'Update Key';
          updateApiBtn.disabled = false;
        }, 2000);
      }
    } else {
      const data = await res.json();
      settingsApiTestResult.innerText = data.error || 'Failed to verify key.';
      settingsApiTestResult.style.color = '#ef4444';
      updateApiBtn.innerText = 'Update Key';
      updateApiBtn.disabled = false;
    }
  } catch (err) {
    settingsApiTestResult.innerText = 'Network error while verifying key.';
    settingsApiTestResult.style.color = '#ef4444';
    updateApiBtn.innerText = 'Update Key';
    updateApiBtn.disabled = false;
  }
});

// ============================================================================
// Forgot Password Flow
// ============================================================================

forgotPasswordLink.addEventListener('click', (e) => {
  e.preventDefault();
  authPanel.classList.add('hidden');
  forgotPasswordPanel.classList.remove('hidden');
  resetMessage.innerText = '';
});

backToLoginLink.addEventListener('click', (e) => {
  e.preventDefault();
  forgotPasswordPanel.classList.add('hidden');
  authPanel.classList.remove('hidden');
});

forgotPasswordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = (document.getElementById('reset-email') as HTMLInputElement).value.trim();
  if (!email) return;

  resetMessage.innerText = 'Sending link...';
  resetMessage.style.color = 'var(--accent)';

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });

  if (error) {
    resetMessage.innerText = error.message;
    resetMessage.style.color = '#ef4444';
  } else {
    resetMessage.innerText = 'Password reset link sent! Please check your email.';
    resetMessage.style.color = 'var(--accent)';
  }
});

// FIXED SIGN OUT LOGIC
document.getElementById('sign-out-btn')?.addEventListener('click', async () => {
  await supabase.auth.signOut();
  if (arena) arena.cleanup();
  window.location.reload(); 
});

document.getElementById('open-setup-btn')?.addEventListener('click', () => {
  if (transitionInterval) {
    clearInterval(transitionInterval);
    transitionInterval = null;
  }
  if (arena) {
    arena.cleanup();
    arena = null;
  }
  transitionOverlay.classList.add('hidden');
  hudPanel.classList.add('hidden');
  resultsPanel.classList.add('hidden');
  setupPanel.classList.remove('hidden');
  topMenu.classList.add('hidden');
});

document.getElementById('setup-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  currentConfig.dpi = parseInt((document.getElementById('dpi') as HTMLInputElement).value);
  currentConfig.pollingRate = parseInt((document.getElementById('polling-rate') as HTMLSelectElement).value);
  currentConfig.game = (document.getElementById('target-game') as HTMLSelectElement).value;
  
  const sensValue = (document.getElementById('current-sens') as HTMLInputElement).value;
  currentConfig.sens = sensValue ? parseFloat(sensValue) : null;

  setupPanel.classList.add('hidden');
  topMenu.classList.remove('hidden');
  
  currentModeIndex = 0;
  assessmentData = {};
  startGauntletDrill();
});

// ============================================================================
// The Sequential Gauntlet Pipeline
// ============================================================================

function startGauntletDrill() {
  const mode = GAUNTLET_MODES[currentModeIndex];
  
  transitionOverlay.classList.add('hidden');
  hudPanel.classList.remove('hidden');

  if (arena) {
    arena.cleanup();
  }
  
  arena = new GameArena('game-container', mode, onTargetHit, onTick, onDrillComplete, currentConfig.pollingRate);
  arena.start();
}

document.addEventListener('drill-paused', () => {
  pauseMenu.classList.remove('hidden');
});

document.addEventListener('drill-resumed', () => {
  pauseMenu.classList.add('hidden');
});

resumeBtn.addEventListener('click', () => {
  if (arena) {
    document.getElementById('game-container')?.requestPointerLock();
  }
});

function onTick(remainingMs: number) {
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  
  drillTimerText.innerText = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function onTargetHit(count: number) {
  const mode = GAUNTLET_MODES[currentModeIndex];
  if (mode === 'tracking') {
    targetsHitText.innerText = `Accuracy: ${count}%`;
  } else {
    targetsHitText.innerText = `Targets: ${count}`;
  }
}

async function onDrillComplete(events: any) {
  const mode = GAUNTLET_MODES[currentModeIndex];
  
  if (mode === 'tracking') {
    assessmentData[mode] = events;
  } else {
    assessmentData[mode] = TelemetryProcessor.calculateSummary(events);
  }

  currentModeIndex++;

  if (currentModeIndex < GAUNTLET_MODES.length) {
    hudPanel.classList.add('hidden');
    transitionOverlay.classList.remove('hidden');
    transitionTitle.innerText = `Preparing ${GAUNTLET_MODES[currentModeIndex].replace('_', ' ').toUpperCase()}...`;
    
    let countdown = 3;
    transitionCountdown.innerText = countdown.toString();
    
    transitionInterval = window.setInterval(() => {
      countdown--;
      transitionCountdown.innerText = countdown.toString();
      if (countdown <= 0) {
        if (transitionInterval) clearInterval(transitionInterval);
        startGauntletDrill();
      }
    }, 1000);

  } else {
    hudPanel.classList.add('hidden');
    resultsPanel.classList.remove('hidden');
    document.getElementById('res-diagnostic')!.innerText = "Analyzing sequential telemetry...";
    
    await submitAssessment();
  }
}

// ============================================================================
// API Submission
// ============================================================================

async function submitAssessment() {
  const token = getSessionToken();
  if (!token) return;

  const payload = {
    target_game: currentConfig.game,
    dpi: currentConfig.dpi,
    polling_rate: currentConfig.pollingRate,
    currentSens: currentConfig.sens || undefined,
    metrics_summary: assessmentData
  };

  try {
    const response = await fetch('http://localhost:5000/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const aiData = await response.json();
    
    document.getElementById('res-game')!.innerText = aiData.target_game;
    document.getElementById('res-cm360')!.innerText = aiData.recommended_cm_per_360.toFixed(1);
    document.getElementById('res-game-sens')!.innerText = aiData.recommended_sens.toFixed(3);
    document.getElementById('res-edpi')!.innerText = Math.round(aiData.recommended_edpi).toString();

    const deltaContainer = document.getElementById('res-delta-container');
    if (deltaContainer) {
      if (currentConfig.sens) {
        const oldEdpi = Math.round(currentConfig.sens * currentConfig.dpi);
        deltaContainer.innerHTML = `<div class="delta-indicator" style="margin-top: 1rem; color: var(--accent); font-weight: bold; font-size: 1.1rem; text-align: center; border: 1px solid var(--border); padding: 0.5rem; border-radius: 8px; background: rgba(0, 255, 136, 0.1);">Old eDPI: ${oldEdpi} &rarr; New eDPI: ${Math.round(aiData.recommended_edpi)}</div>`;
      } else {
        deltaContainer.innerHTML = '';
      }
    }

    document.getElementById('res-confidence')!.innerText = (aiData.confidence_score * 100).toFixed(0) + '%';
    document.getElementById('res-diagnostic')!.innerText = aiData.diagnostic_summary;

    // Refresh history sidebar
    loadHistory();

  } catch (err) {
    console.error(err);
    document.getElementById('res-diagnostic')!.innerText = "Error analyzing data. Check console.";
  }
}

document.getElementById('restart-btn')?.addEventListener('click', () => {
  resultsPanel.classList.add('hidden');
  setupPanel.classList.remove('hidden');
  topMenu.classList.add('hidden');
});
// ============================================================================
// Video Background Management
// ============================================================================
const bgVideo = document.getElementById('bg-video') as HTMLVideoElement;
const updateVideoVisibility = () => {
  if (bgVideo) {
    const isHudVisible = !hudPanel.classList.contains('hidden');
    const isResultsVisible = !resultsPanel.classList.contains('hidden');
    
    if (isHudVisible || isResultsVisible) {
      bgVideo.pause();
      bgVideo.style.display = 'none';
    } else {
      bgVideo.style.display = 'block';
      bgVideo.play().catch(err => console.log('Video play interrupted:', err));
    }
  }
};

const videoObserver = new MutationObserver(updateVideoVisibility);
[hudPanel, resultsPanel, authPanel, setupPanel].forEach(el => {
  if (el) videoObserver.observe(el, { attributes: true, attributeFilter: ['class'] });
});
// Initial check
updateVideoVisibility();

