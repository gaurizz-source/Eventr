import { CognitoUserPool, CognitoUserAttribute, CognitoUser, AuthenticationDetails } from 'amazon-cognito-identity-js';
import { awsConfig } from './aws-config.js';

// Setup Cognito User Pool Connection
const poolData = {
    UserPoolId: awsConfig.UserPoolId,
    ClientId: awsConfig.ClientId
};
const userPool = new CognitoUserPool(poolData);

const API_BASE_URL = awsConfig.ApiBaseUrl;

// Global Application State Core
const state = {
  currentUser: null, 
  activeView: 'student-dashboard',
  currentAuthMode: 'login', // Tracks active form state context ('login' or 'register')
  rsvps: [], 
  opportunities: [] 
};

// --- INITIALIZATION RUNTIME ---
document.addEventListener("DOMContentLoaded", () => {
    const loader = document.getElementById('loading-screen');
    if (loader) {
        setTimeout(() => { loader.style.display = 'none'; }, 400);
    }
    checkPersistentSession();
    fetchLiveOpportunities();
});

// Checks if user has an active valid persistent login session stored on refresh
function checkPersistentSession() {
    const cognitoUser = userPool.getCurrentUser();
    if (cognitoUser) {
        cognitoUser.getSession((err, session) => {
            if (err || !session.isValid()) {
                handleSignOutLocal();
                return;
            }
            
            cognitoUser.getUserAttributes((err, attributes) => {
                if (err) return;
                const userProfile = {};
                attributes.forEach(attr => {
                    userProfile[attr.Name] = attr.Value;
                });

                state.currentUser = {
                    name: userProfile['name'] || "User",
                    email: cognitoUser.getUsername(),
                    role: userProfile['custom:role'] || 'Student',
                    branch: userProfile['custom:branch'] || 'CSE',
                    year: userProfile['custom:year'] || '2026'
                };

                localStorage.setItem('evntr_id_token', session.getIdToken().getJwtToken());
                localStorage.setItem('evntr_access_token', session.getAccessToken().getJwtToken());
                
                // Refresh UI with user details
                updateNavProfile();
                fetchUserRSVPs();
                
                // Stay on current dashboard view, don't kick user out
              // Light up the correct button green based on the current active view context
  if (viewName === 'student-dashboard' && studentBtn) {
    studentBtn.classList.add('active'); //  FIXED
  }
  if (viewName === 'host-dashboard' && hostBtn) {
    hostBtn.classList.add('active');    //  FIXED
  }
            });
        });
    } else {
        updateNavProfile();
        renderAllOpportunities();
    }
}

// Fetch global live opportunities directly from database table
function fetchLiveOpportunities() {
    fetch(`${API_BASE_URL}/events`)
        .then(res => res.json())
        .then(data => {
            state.opportunities = data;
            renderAllOpportunities();
        })
        .catch(err => {
            console.error("Cloud Database Fetch Error:", err);
            renderAllOpportunities();
        });
}

// Fetch user registrations dynamically using verification tokens
function fetchUserRSVPs() {
    const idToken = localStorage.getItem('evntr_id_token');
    if (!idToken || !state.currentUser) return;

    fetch(`${API_BASE_URL}/rsvp?email=${encodeURIComponent(state.currentUser.email)}`, {
        headers: { "Authorization": idToken }
    })
    .then(res => res.json())
    .then(data => {
        state.rsvps = data.map(r => r.eventId);
        renderRsvps();
        renderAllOpportunities();
    })
    .catch(err => console.error("Error syncing RSVPs:", err));
}

// Routing System between Views
// Routing System between Views (Fixed Green Active Accent Class)
window.switchView = function(viewName) {
  // Remove active styling from all view content blocks
  document.querySelectorAll('.view-container').forEach(el => el.classList.remove('active'));
  
  // Remove active styling from navigation buttons
  const studentBtn = document.getElementById('btn-nav-student');
  const hostBtn = document.getElementById('btn-nav-host');
  if (studentBtn) studentBtn.classList.remove('active');
  if (hostBtn) hostBtn.classList.remove('active');

  state.activeView = viewName;
  
  // Show the requested container screen
  const targetEl = document.getElementById('view-' + viewName);
  if (targetEl) targetEl.classList.add('active');

  // Light up the correct button green based on the current active view context
  if (viewName === 'student-dashboard' && studentBtn) {
    studentBtn.classList.add('active');
  }
  if (viewName === 'host-dashboard' && hostBtn) {
    hostBtn.classList.add('active');
  }
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

// Dynamic Authentication Screen Tab Control Engine
window.toggleAuthForm = function(formType) {
  state.currentAuthMode = formType;
  
  const tabLogin = document.getElementById('auth-tab-login');
  const tabRegister = document.getElementById('auth-tab-register');
  const registerFields = document.getElementById('register-fields-group');
  const submitBtn = document.getElementById('auth-submit-btn');
  
  const nameInput = document.getElementById('auth-stud-name');
  const yearInput = document.getElementById('auth-stud-year');

  if (formType === 'register') {
    if (tabLogin) tabLogin.classList.remove('active');
    if (tabRegister) tabRegister.classList.add('active');
    if (registerFields) registerFields.style.display = 'block';
    if (submitBtn) submitBtn.innerText = "Create Account";
    
    if (nameInput) nameInput.required = true;
    if (yearInput) yearInput.required = true;
  } else {
    if (tabRegister) tabRegister.classList.remove('active');
    if (tabLogin) tabLogin.classList.add('active');
    if (registerFields) registerFields.style.display = 'none';
    if (submitBtn) submitBtn.innerText = "Sign In";
    
    if (nameInput) nameInput.required = false;
    if (yearInput) yearInput.required = false;
  }
};

// UNIFIED HANDLER FOR SIGN IN AND SIGN UP (Clears up any function name conflicts)
window.handleAuthWorkflowSubmit = function(e) {
    e.preventDefault();
    
    const email = document.getElementById('auth-core-email').value.trim();
    const password = document.getElementById('auth-core-password').value;

    if (state.currentAuthMode === 'register') {
        // --- COGNITO SIGNUP WORKFLOW ---
        const name = document.getElementById('auth-stud-name').value.trim();
        const branch = document.getElementById('auth-stud-branch').value;
        const year = document.getElementById('auth-stud-year').value;

        window.showToast("Registering with AWS Cloud Identity Directory...", "success");

        const attributeList = [
            new CognitoUserAttribute({ Name: 'name', Value: name }),
            new CognitoUserAttribute({ Name: 'custom:role', Value: 'Student' }),
            new CognitoUserAttribute({ Name: 'custom:branch', Value: branch }),
            new CognitoUserAttribute({ Name: 'custom:year', Value: year.toString() }),
            new CognitoUserAttribute({ Name: 'custom:societyName', Value: 'N/A' }),
            new CognitoUserAttribute({ Name: 'custom:approved', Value: 'true' })
        ];

        userPool.signUp(email, password, attributeList, null, (err, result) => {
            if (err) {
                window.showToast(err.message || "Registration failed.", "error");
                console.error(err);
                return;
            }
            window.showToast("Account created! Checking mailbox for code...", "success");
            
            setTimeout(() => {
                const code = prompt(`Please input the validation token dispatched to ${email}:`);
                if (code) {
                    const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
                    cognitoUser.confirmRegistration(code, true, (confirmErr) => {
                        if (confirmErr) {
                            window.showToast(confirmErr.message || "Invalid validation code.", "error");
                            return;
                        }
                        window.showToast("Identity verified! Please sign in.", "success");
                        window.toggleAuthForm('login');
                    });
                }
            }, 600);
        });

    } else {
        // --- COGNITO SIGN IN WORKFLOW ---
        window.showToast("Verifying credentials database...", "success");
        
        const authDetails = new AuthenticationDetails({ Username: email, Password: password });
        const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });

        cognitoUser.authenticateUser(authDetails, {
            onSuccess: (result) => {
                // Save security session tokens locally
                localStorage.setItem('evntr_id_token', result.getIdToken().getJwtToken());
                localStorage.setItem('evntr_access_token', result.getAccessToken().getJwtToken());
                
                window.showToast("Welcome back! Access granted.", "success");
                
                // Fetch attributes immediately so that the profile updates to GK instantly
                cognitoUser.getUserAttributes((err, attributes) => {
                    if (err) {
                        console.error("Attributes fetch fallback error:", err);
                        state.currentUser = { name: "Gauri Kumari", email: email };
                    } else {
                        const userProfile = {};
                        attributes.forEach(attr => {
                            userProfile[attr.Name] = attr.Value;
                        });
                        
                        state.currentUser = {
                            name: userProfile['name'] || "Gauri Kumari",
                            email: cognitoUser.getUsername(),
                            role: userProfile['custom:role'] || 'Student',
                            branch: userProfile['custom:branch'] || 'CSE',
                            year: userProfile['custom:year'] || '2026'
                        };
                    }
                    
                    // Render the GK profile avatar badge and redirect to dashboard
                    updateNavProfile();
                    fetchUserRSVPs();
                    window.switchView('student-dashboard');
                });
            },
            onFailure: (err) => {
                window.showToast(err.message || "Login authentication failed.", "error");
                console.error(err);
            }
        });
    }
};

// Toast notifications helper engine
window.showToast = function(message, type = 'success') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  root.appendChild(toast);
  setTimeout(() => { toast.remove(); }, 3500);
};

// Global Session Termination Handler
window.handleSignOut = function() {
  const cognitoUser = userPool.getCurrentUser();
  if (cognitoUser) {
      cognitoUser.signOut();
  }
  handleSignOutLocal();
};

function handleSignOutLocal() {
    state.currentUser = null;
    state.rsvps = [];
    localStorage.clear();
    window.showToast('Logged out securely.', 'success');
    updateNavProfile();
    renderAllOpportunities();
    renderRsvps();
    window.switchView('student-dashboard');
}

// Injects the dynamic profile button structure into your HTML placeholder wrapper
function updateNavProfile() {
  const container = document.getElementById('nav-auth-section');
  if (!container) return;

  if (state.currentUser) {
    // Falls back to "GK" if names aren't processed yet
    const initials = state.currentUser.name ? state.currentUser.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : "GK";
    
    container.innerHTML = `
      <div style="display:flex; align-items:center; gap: 1rem;">
        <div class="user-avatar" style="width:32px; height:32px; background:#4f46e5; color:white; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:0.85rem;">${initials}</div>
        <span onclick="handleSignOut()" style="font-size:0.8rem; color:#ef4444; font-weight:600; cursor:pointer;">(Logout)</span>
      </div>
    `;
  } else {
    container.innerHTML = `<button class="nav-btn auth-btn" onclick="switchView('auth-page')">Log In / Sign Up</button>`;
  }
}

// Template builder for the event dashboard grid cards
function renderAllOpportunities() {
  const allGrid = document.getElementById('opportunities-root');
  if (!allGrid) return;
  
  let allHtml = '';
  const dataset = state.opportunities.length > 0 ? state.opportunities : [
    { eventId: "evt_01", title: "Innerve Hackathon 2026", society: "ACM Student Chapter", category: "Technical", eventDate: "Oct 14th - Oct 16th, 2026", registrations: 432 },
    { eventId: "evt_02", title: "Taarangana Street Showdown", society: "Hypnotics Society", category: "Cultural", eventDate: "Nov 02, 2026", registrations: 189 }
  ];

  dataset.forEach(opp => {
    const currentId = opp.eventId || opp.id; 
    const isReg = state.rsvps.includes(currentId);
    allHtml += `
      <div class="card">
        <div class="card-banner">
          <span class="category-badge">${opp.category || 'Event'}</span>
        </div>
        <div class="card-body">
          <span class="card-society">${opp.society || 'Official'}</span>
          <h3 class="card-title">${opp.title}</h3>
          <p style="font-size:0.8rem; margin:0.5rem 0;">Date: ${opp.eventDate || '2026'}</p>
          <div class="card-footer">
            <span class="registrations-count">${opp.registrations || 0} Registered</span>
            <button class="btn-card-action">${isReg ? "Registered ✓" : "View details"}</button>
          </div>
        </div>
      </div>
    `;
  });
  allGrid.innerHTML = allHtml;
}

// Render registered events into sidebar panels
function renderRsvps() {
  const root = document.getElementById('rsvp-list-root');
  const badge = document.getElementById('rsvp-count-badge');
  if (badge) badge.innerText = state.rsvps.length;
  if (!root) return;

  if (state.rsvps.length === 0) {
    root.innerHTML = `<div class="rsvp-empty">No active RSVPs found.</div>`;
    return;
  }

  let html = '';
  state.rsvps.forEach(oppId => {
    const opp = state.opportunities.find(o => (o.eventId === oppId || o.id === oppId));
    if (opp) {
      html += `<div style="padding:0.5rem 0; font-size:0.85rem; border-bottom:1px solid #e2e8f0;"><b>${opp.title}</b></div>`;
    }
  });
  root.innerHTML = html;
}