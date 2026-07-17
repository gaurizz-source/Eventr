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
  currentAuthMode: 'login', 
  rsvps: [], 
  opportunities: [],
  selectedEventId: null ,
  accessibleOwners: [],
  isSocietyOwner: false,
  rsvpMeta: {},
  lastStatusModalData: { eventTitle: '', registrants: [] },
  eventTotalCounts: {},
  activeHostTab: 'active'
};

// --- INITIALIZATION RUNTIME ---
document.addEventListener("DOMContentLoaded", () => {
    const loader = document.getElementById('loading-screen');
    if (loader) {
        setTimeout(() => { loader.style.display = 'none'; }, 400);
    }
    checkPersistentSession();
    fetchLiveOpportunities();
   document.getElementById('dashboard-search')?.addEventListener('input', applyDashboardFilters);
    document.getElementById('filter-date')?.addEventListener('change', applyDashboardFilters);
    document.getElementById('filter-type')?.addEventListener('change', applyDashboardFilters);
});

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
                    email: userProfile['email'] || cognitoUser.getUsername(),
                    role: userProfile['custom:role'] || 'Student',
                    branch: userProfile['custom:branch'] || 'CSE',
                    year: userProfile['custom:year'] || '2026'
                };

                localStorage.setItem('evntr_id_token', session.getIdToken().getJwtToken());
                localStorage.setItem('evntr_access_token', session.getAccessToken().getJwtToken());
                
              updateNavProfile();
                fetchSocietyAccess().then(() => {
                    updateHostPermissions();
                    fetchUserRSVPs();
                });
            });
        });
    } else {
        updateNavProfile();
        renderAllOpportunities();
    }
}

function fetchLiveOpportunities() {
    fetch(`${API_BASE_URL}/events`)
        .then(res => res.json())
        .then(data => {
            // Agar server se data empty array aaye, tabhi core mock seed inject hoga
            if (data && data.length > 0) {
                state.opportunities = data;
            } else {
                state.opportunities = getInitialMockSeed();
            }
            renderAllOpportunities();
            window.switchHostTimeline('active'); 
            refreshEventCounts();
        })
        .catch(err => {
            console.error("Cloud Database Fetch Error, fallback to seed:", err);
            state.opportunities = getInitialMockSeed();
            renderAllOpportunities();
            window.switchHostTimeline('active');
            refreshEventCounts();
        });
}

function getInitialMockSeed() {
    return [
        { eventId: "evt_m1", id: "evt_m1", title: "Tech Innovation Summit 2026", society: "IEEE Core Team", category: "Technical", eventDate: "2026-07-06", registrations: 47, imageUrl: "https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800", isPaid: false },
        { eventId: "evt_m2", id: "evt_m2", title: "Code Craft Hackathon", society: "ACM Chapter", category: "Technical", eventDate: "2026-08-15", registrations: 12, imageUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800", isPaid: false },
        { eventId: "evt_m3", id: "evt_m3", title: "Taarangana Street Showdown", society: "Hypnotics Society", category: "Cultural", eventDate: "2026-07-01", registrations: 189, imageUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800", isPaid: false }
    ];
}

// ─── MOST-REGISTERED SORT (confirmed + waitlisted combined) ───
function getSortCount(opp) {
    const id = opp.eventId || opp.id;
    return state.eventTotalCounts[id] !== undefined ? state.eventTotalCounts[id] : (Number(opp.registrations) || 0);
}

function sortByMostRegistered(list) {
    return [...list].sort((a, b) => getSortCount(b) - getSortCount(a));
}

function refreshEventCounts() {
    if (!state.opportunities || state.opportunities.length === 0) return;

    Promise.all(
        state.opportunities.map(opp => {
            const eventId = opp.eventId || opp.id;
            return fetch(`${API_BASE_URL}/rsvp/by-event?eventId=${encodeURIComponent(eventId)}`)
                .then(res => res.json())
                .then(data => ({ eventId, count: Array.isArray(data) ? data.length : 0 }))
                .catch(() => ({ eventId, count: null }));
        })
    ).then(results => {
        results.forEach(({ eventId, count }) => {
            if (count !== null) state.eventTotalCounts[eventId] = count;
        });
        // Real counts aa gaye — ab sahi order se re-render karo
        renderAllOpportunities();
        window.switchHostTimeline(state.activeHostTab || 'active');
    });
}

function fetchUserRSVPs() {
    const idToken = localStorage.getItem('evntr_id_token');
    if (!idToken || !state.currentUser) return;

    fetch(`${API_BASE_URL}/rsvp?email=${encodeURIComponent(state.currentUser.email)}`, {
        headers: {  }
    })
    .then(res => res.json())
    .then(data => {
    const kept = data.filter(r => {
    const event = state.opportunities.find(o => (o.eventId === r.eventId || o.id === r.eventId));
    if (!event) return true;
    const isPast = window.getEventTimelineStatus(event.eventDate) === 'past';
    if (!isPast) return true;
    return (r.status || 'confirmed') !== 'waitlisted';
});
    state.rsvps = kept.map(r => r.eventId);
    kept.forEach(r => {
        state.rsvpMeta[r.eventId] = {
            rsvpId: r.rsvpId,
            status: r.status || 'confirmed', // older RSVPs predate the waitlist field — treat as confirmed
            waitlistPosition: r.waitlistPosition || null,
            checkedIn: !!r.checkedIn
        };
    });
        renderRsvps();
        renderAllOpportunities();
    })
    .catch(err => console.error("Error syncing RSVPs:", err));
}
// Global Router Engine
window.switchView = function(viewName) {
  state.activeView = viewName;
  
  if (document.getElementById('view-student-dashboard')) document.getElementById('view-student-dashboard').style.display = 'none';
  if (document.getElementById('view-host-dashboard')) document.getElementById('view-host-dashboard').style.display = 'none';
  if (document.getElementById('view-auth-page')) document.getElementById('view-auth-page').style.display = 'none';
  if (document.getElementById('view-event-details')) document.getElementById('view-event-details').style.display = 'none';

  const studentBtn = document.getElementById('btn-nav-student');
  const hostBtn = document.getElementById('btn-nav-host');
  if (studentBtn) studentBtn.classList.remove('active');
  if (hostBtn) hostBtn.classList.remove('active');

  let elementId = 'view-' + viewName;
  const targetEl = document.getElementById(elementId);
  if (targetEl) {
      targetEl.style.display = 'block';
  }

  if (viewName === 'student-dashboard') {
    if (studentBtn) studentBtn.classList.add('active');
    renderAllOpportunities();
  }
  if (viewName === 'host-dashboard') {
    if (hostBtn) hostBtn.classList.add('active');
    window.switchHostTimeline('active'); 
  }
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.openEventDetails = function(eventId) {
    const opp = state.opportunities.find(o => (o.eventId === eventId || o.id === eventId));
    if (!opp) return;

    state.selectedEventId = eventId;

    if (document.getElementById('detail-title')) document.getElementById('detail-title').innerText = opp.title;
    if (document.getElementById('detail-society')) document.getElementById('detail-society').innerText = `Hosted by ${opp.society || 'Official Chapter'}`;
    if (document.getElementById('detail-category-badge')) document.getElementById('detail-category-badge').innerText = opp.category || 'General';
    if (document.getElementById('detail-reg-count')) document.getElementById('detail-reg-count').innerText = opp.registrations || 0;
    if (document.getElementById('detail-duration-dates')) document.getElementById('detail-duration-dates').innerText = opp.durationText || opp.eventDate;
    renderEventSchedule(opp);
    renderEventExtras(opp);
    
    const heroImg = document.getElementById('detail-hero-image');
    if (heroImg) {
        heroImg.onerror = function() {
            this.onerror = null;
            this.src = 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800';
            window.showToast('Event banner failed to load — showing default image', 'error');
        };
        heroImg.src = opp.imageUrl || 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800';
    }

    const paymentNoticeBar = document.getElementById('detail-payment-notice-bar');
    if (paymentNoticeBar) {
      if (opp.isPaid) {
        paymentNoticeBar.style.display = 'flex';
        document.getElementById('detail-payment-amount').innerText = opp.amount || '0';
        document.getElementById('detail-payment-upi').innerText = opp.upi || 'N/A';
      } else {
        paymentNoticeBar.style.display = 'none';
      }
    }

const capacityNoteEl = document.getElementById('detail-capacity-note');
    const isFull = opp.capacity && (Number(opp.registrations) || 0) >= Number(opp.capacity);
    if (capacityNoteEl) {
        capacityNoteEl.innerText = opp.capacity ? `/ ${opp.capacity} spots` : '';
    }

    const regBtn = document.getElementById('detail-register-btn');
    if (regBtn) {
        const meta = state.rsvpMeta[eventId];
        const isConfirmed = meta && meta.status === 'confirmed';
        const isWaitlisted = meta && meta.status === 'waitlisted';

        if (isConfirmed) {
            regBtn.innerText = "Registered ✓";
            regBtn.style.background = "#10b981";
            regBtn.disabled = true;
        } else if (isWaitlisted) {
            regBtn.innerText = meta.waitlistPosition ? `Waitlisted (#${meta.waitlistPosition})` : "Waitlisted";
            regBtn.style.background = "#f59e0b";
            regBtn.disabled = true;
        } else if (isFull) {
            regBtn.innerText = "Join Waitlist";
            regBtn.style.background = "#f59e0b";
            regBtn.disabled = false;
            regBtn.onclick = () => opp.isPaid ? window.openPaymentConfirmModal(eventId) : window.executeAwsRegistration(eventId);
        } else {
            regBtn.innerText = "Register Now";
            regBtn.style.background = "#4f46e5";
            regBtn.disabled = false;
            regBtn.onclick = () => opp.isPaid ? window.openPaymentConfirmModal(eventId) : window.executeAwsRegistration(eventId);
        }
    }
    window.switchView('event-details');
};


window.executeAwsRegistration = function(eventId, paymentScreenshotUrl) {
    if (!state.currentUser) {
        window.showToast("Please sign in to register for this event!", "error");
        window.switchView('auth-page');
        return;
    }

    const regBtn = document.getElementById('detail-register-btn');

    if (regBtn) {
        regBtn.innerText = "Processing...";
        regBtn.disabled = true;
    }

    fetch(`${API_BASE_URL}/rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            eventId: eventId,
            studentName: state.currentUser.name,
            studentEmail: state.currentUser.email,
            paymentScreenshotUrl: paymentScreenshotUrl || null
        
        })
    })
    .then(async res => {
        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`AWS Server Error (${res.status}): ${errorText}`);
        }
        return res.json();
    })
   .then((result) => {
        const isWaitlisted = result.status === 'waitlisted';

        window.showToast(
            isWaitlisted
                ? "Event is full — you've been added to the waitlist. A confirmation email has been sent (check spam folder too!)."
                : "Registration Confirmed! Slot secured. A confirmation email has been sent (check spam folder too!).",
            isWaitlisted ? "error" : "success"
        );

        if (!state.rsvps.includes(eventId)) {
            state.rsvps.push(eventId);
        }
        state.rsvpMeta[eventId] = {
            rsvpId: result.rsvpId,
            status: result.status,
            waitlistPosition: null // position unknown until next fetchUserRSVPs sync
        };

        const targetEvent = state.opportunities.find(o => (o.eventId === eventId || o.id === eventId));
        if (targetEvent && !isWaitlisted) {
            targetEvent.registrations = (Number(targetEvent.registrations) || 0) + 1;
            const regCountEl = document.getElementById('detail-reg-count');
            if (regCountEl) regCountEl.innerText = targetEvent.registrations;
        }

        // Local total-count cache bhi turant update kar do taaki agla sort sahi rahe
        state.eventTotalCounts[eventId] = (state.eventTotalCounts[eventId] !== undefined
            ? state.eventTotalCounts[eventId]
            : (Number(targetEvent?.registrations) || 0)) + 1;

        if (regBtn) {
            if (isWaitlisted) {
                regBtn.innerText = "Waitlisted";
                regBtn.style.background = "#f59e0b";
            } else {
                regBtn.innerText = "Registered ✓";
                regBtn.style.background = "#10b981";
            }
            regBtn.disabled = true;
        }

        renderRsvps();
        renderAllOpportunities();
        fetchUserRSVPs(); // re-sync to pick up the real waitlist position from the backend
    })
 .catch(err => {
        console.error("🔴 AWS Sync Failure:", err.message);
        window.showToast("Registration failed. Please try again.", "error");
        if (regBtn) {
            regBtn.innerText = "Register Now";
            regBtn.disabled = false;
        }
    });
};

window.handleCancelRsvp = function(eventId) {
    const opp = state.opportunities.find(o => (o.eventId === eventId || o.id === eventId));
    const meta = state.rsvpMeta[eventId];
    const rsvpId = meta && meta.rsvpId;

    if (!rsvpId) {
        window.showToast("Cannot cancel — registration reference missing. Try refreshing.", "error");
        return;
    }

    const isWaitlisted = meta.status === 'waitlisted';
    const confirmText = isWaitlisted
        ? `Leave the waitlist for "${opp ? opp.title : 'this event'}"?`
        : `Cancel your registration for "${opp ? opp.title : 'this event'}"? This cannot be undone. If someone is on the waitlist, they'll automatically be given your spot.`;

    const confirmed = confirm(confirmText);
    if (!confirmed) return;

    fetch(`${API_BASE_URL}/rsvp/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rsvpId, eventId })
    })
    .then(async res => {
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "Failed to cancel registration.");
        }
        return res.json();
    })
    .then(() => {
        window.showToast(isWaitlisted ? "Removed from waitlist." : "Registration cancelled.", "success");

        state.rsvps = state.rsvps.filter(id => id !== eventId);
        delete state.rsvpMeta[eventId];

        if (opp && !isWaitlisted) {
            opp.registrations = Math.max(0, (Number(opp.registrations) || 1) - 1);
        }

        if (state.eventTotalCounts[eventId] !== undefined) {
            state.eventTotalCounts[eventId] = Math.max(0, state.eventTotalCounts[eventId] - 1);
        }

        renderRsvps();
        renderAllOpportunities();

        // If the student is currently looking at this event's detail page, refresh the register button
        if (state.selectedEventId === eventId) {
            window.openEventDetails(eventId);
        }
    })
    .catch(err => {
        console.error("Cancel RSVP failed:", err);
        window.showToast(err.message || "Failed to cancel registration.", "error");
    });
};

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

window.handleAuthWorkflowSubmit = function(e) {
    e.preventDefault();
    const email = document.getElementById('auth-core-email').value.trim();
    const password = document.getElementById('auth-core-password').value;

    if (state.currentAuthMode === 'register') {
        const name = document.getElementById('auth-stud-name').value.trim();
        const branch = document.getElementById('auth-stud-branch').value;
        const year = document.getElementById('auth-stud-year').value;

        window.showToast("Registering with AWS Cloud Identity...", "success");

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
                return;
            }
            window.showToast("Account created! Check mailbox...", "success");
            
            setTimeout(() => {
                const code = prompt(`Please input validation token dispatched to ${email}:`);
                if (code) {
                    const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
                    cognitoUser.confirmRegistration(code, true, (confirmErr) => {
                        if (confirmErr) {
                            window.showToast(confirmErr.message || "Invalid token.", "error");
                            return;
                        }
                        window.showToast("Identity verified! Please sign in.", "success");
                        window.toggleAuthForm('login');
                    });
                }
            }, 600);
        });
    } else {
        window.showToast("Verifying credentials...", "success");
        const authDetails = new AuthenticationDetails({ Username: email, Password: password });
        const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });

        cognitoUser.authenticateUser(authDetails, {
            onSuccess: (result) => {
                localStorage.setItem('evntr_id_token', result.getIdToken().getJwtToken());
                localStorage.setItem('evntr_access_token', result.getAccessToken().getJwtToken());
                window.showToast("Welcome back! Access granted.", "success");
                
                cognitoUser.getUserAttributes((err, attributes) => {
                    if (err) {
                        state.currentUser = { name: "Gauri Kumari", email: email };
                    } else {
                        const userProfile = {};
                        attributes.forEach(attr => { userProfile[attr.Name] = attr.Value; });
                        state.currentUser = {
                            name: userProfile['name'] || "Gauri Kumari",
                            email: userProfile['email'] || cognitoUser.getUsername(),
                            role: userProfile['custom:role'] || 'Student',
                            branch: userProfile['custom:branch'] || 'CSE',
                            year: userProfile['custom:year'] || '2026'
                        };
                    }
                    updateNavProfile();
                    fetchSocietyAccess().then(() => {
                        updateHostPermissions();
                        fetchUserRSVPs();
                        window.switchView('student-dashboard');
                    });
                });
            },
            onFailure: (err) => {
                window.showToast(err.message || "Authentication failed.", "error");
            }
        });
    }
};

window.showToast = function(message, type = 'success') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  root.appendChild(toast);
  setTimeout(() => { toast.remove(); }, 3500);
};

window.handleSignOut = function() {
  const cognitoUser = userPool.getCurrentUser();
  if (cognitoUser) cognitoUser.signOut();
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

function updateNavProfile() {
  const container = document.getElementById('nav-auth-section');
  if (!container) return;

  if (state.currentUser) {
    const initials = state.currentUser.name ? state.currentUser.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : "GK";
    container.innerHTML = `
      <div style="display:flex; align-items:center; gap: 1rem;">
        <div class="user-avatar" style="width:32px; height:32px; background:#4f46e5; color:white; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:0.85rem;">${initials}</div>
        <span onclick="handleSignOut()" style="font-size:0.8rem; color:#ef4444; font-weight:600; cursor:pointer;">(Logout)</span>
      </div>
    `;
  } else {
    container.innerHTML = `<button class="nav-btn auth-btn" onclick="window.switchView('auth-page')">Log In / Sign Up</button>`;
  }
}

function renderAllOpportunities() {
  const allGrid = document.getElementById('opportunities-root');
  if (!allGrid) return;
  
  let allHtml = '';
  const dataset = state.opportunities.filter(opp => {
      const status = window.getEventTimelineStatus(opp.eventDate);
      return status !== 'past';
  });
  const sortedDataset = sortByMostRegistered(dataset);

  sortedDataset.forEach(opp => {
    const currentId = opp.eventId || opp.id; 
    const cardImg = opp.imageUrl || 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800';
    const displayDate = opp.durationText || `Starts: ${opp.eventDate || '2026'}`;
    
    allHtml += `
      <div class="card" style="background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: flex; flex-direction: column;">
        <div class="card-banner" style="height: 160px; width: 100%; background: #cbd5e1; position: relative;">
         <img src="${cardImg}" onerror="this.onerror=null; this.src='https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800'; window.showToast('Event banner failed to load — showing default image', 'error');" style="width:100%; height:100%; object-fit:cover;" alt="Banner">
          <span class="category-badge" style="position: absolute; top: 0.5rem; left: 0.5rem; background: #4f46e5; color: white; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.7rem; font-weight:700;">${opp.category || 'Event'}</span>
        </div>
        <div class="card-body" style="padding: 1rem; flex-grow: 1; display: flex; flex-direction: column;">
          <span class="card-society" style="font-size: 0.75rem; color: #64748b; font-weight:600;">${opp.society || 'Official'}</span>
          <h3 class="card-title" style="font-size: 1.1rem; font-weight: 700; margin: 0.25rem 0; color: #0f172a;">${opp.title}</h3>
          <p style="font-size:0.8rem; color: #475569; margin:0.5rem 0 1rem 0;">📅 ${displayDate}</p>
          <div class="card-footer" style="margin-top: auto; display: flex; justify-content: space-between; align-items: center; padding-top: 0.75rem; border-top: 1px solid #f1f5f9;">
            <span class="registrations-count" style="font-size: 0.8rem; color: #64748b; font-weight:500;">${opp.registrations || 0} Applied</span>
            <button class="btn-card-action" onclick="window.openEventDetails('${currentId}')" style="background:#4f46e5; color:white; border:none; padding:0.4rem 0.8rem; border-radius:6px; cursor:pointer; font-size:0.8rem; font-weight:600;">View details</button>
          </div>
        </div>
      </div>
    `;
  });
  allGrid.innerHTML = allHtml;
}

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
    const meta = state.rsvpMeta[oppId];
    if (opp) {
      const isWaitlisted = meta && meta.status === 'waitlisted';
      const isPastEvent = window.getEventTimelineStatus(opp.eventDate) === 'past';
      const isCheckedIn = meta && meta.checkedIn;
      let actionButtons = '';
      if (isPastEvent && isCheckedIn) {
        actionButtons = `<button onclick="window.handleDownloadCertificate('${oppId}')" style="background:#f0fdf4; color:#059669; border:none; padding:0.3rem 0.6rem; border-radius:6px; cursor:pointer; font-size:0.75rem; font-weight:600;">🎓 Certificate</button>`;
      } else if (isWaitlisted) {
        actionButtons = `<span style="background:#fef3c7; color:#b45309; font-size:0.7rem; font-weight:700; padding:0.15rem 0.4rem; border-radius:4px; white-space:nowrap;">Waitlisted${meta.waitlistPosition ? ' #' + meta.waitlistPosition : ''}</span>
          <button onclick="window.handleCancelRsvp('${oppId}')" style="background:#fef2f2; color:#dc2626; border:none; padding:0.3rem 0.6rem; border-radius:6px; cursor:pointer; font-size:0.75rem; font-weight:600;">Leave</button>`;
      } else {
        actionButtons = `<button onclick="window.openQrModal('${oppId}')" style="background:#eef2ff; color:#4f46e5; border:none; padding:0.3rem 0.6rem; border-radius:6px; cursor:pointer; font-size:0.75rem; font-weight:600;">QR Code</button>
          <button onclick="window.handleCancelRsvp('${oppId}')" style="background:#fef2f2; color:#dc2626; border:none; padding:0.3rem 0.6rem; border-radius:6px; cursor:pointer; font-size:0.75rem; font-weight:600;">Cancel</button>`;
      }
      html += `<div style="padding:0.5rem 0; font-size:0.85rem; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center; gap:0.5rem;">
        <b style="flex:1;">${opp.title}</b>
        ${actionButtons}
      </div>`;
    }
  });
  root.innerHTML = html;
}

window.toggleCreateEventForm = function() {
    const formPanel = document.getElementById('launch-event-panel');
    if (!formPanel) return;
    formPanel.style.display = (formPanel.style.display === 'none' || formPanel.style.display === '') ? 'block' : 'none';
};

// ─── STRICT DATE TIMELINE CALCULATOR (FIXED PARSER) ───
window.getEventTimelineStatus = function(eventDateString) {
  if (!eventDateString) return 'active'; 

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let eventDate = new Date(eventDateString);

  if (isNaN(eventDate.getTime())) {
    return 'active'; 
  }
  
  eventDate.setHours(0, 0, 0, 0);

  if (eventDate.getTime() === today.getTime()) {
    return 'active';   
  } else if (eventDate.getTime() > today.getTime()) {
    return 'future';   
  } else {
    return 'past';     
  }
};

// ─── FIXED SOCIETY TIMELINE COMPONENT ───
window.switchHostTimeline = function(targetTimeline) {
    state.activeHostTab = targetTimeline;

    const tabButtons = document.querySelectorAll('.host-tab-nav-btn');
    tabButtons.forEach(btn => {
        btn.classList.remove('active');
        btn.style.color = '#64748b';
        btn.style.fontWeight = '500';
        btn.style.borderBottom = '2px solid transparent';
    });

    const activeBtn = document.getElementById(`tab-btn-${targetTimeline}`);
    if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.style.color = '#4f46e5';
        activeBtn.style.fontWeight = '700';
        activeBtn.style.borderBottom = '2px solid #4f46e5';
    }

    const gridRoot = document.getElementById('society-opportunities-root');
    if (!gridRoot) return;

   // Only show events the current user owns or has been added to as a member
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    cutoffDate.setHours(0, 0, 0, 0);

    // Only show events the current user owns/is a member of, and that ended within the last 30 days
    const dataset = state.opportunities.filter(opp => {
        const isAccessible = state.accessibleOwners.includes((opp.hostEmail || '').toLowerCase());
        if (!isAccessible) return false;

        const eventDate = new Date(opp.eventDate);
        if (isNaN(eventDate.getTime())) return true; // keep events with bad/missing dates, don't silently hide them
        return eventDate >= cutoffDate;
    });

    const filteredUnsorted = dataset.filter(opp => {
        const targetDate = opp.eventDate || opp.date;
        const computedTimeline = window.getEventTimelineStatus(targetDate);
        return computedTimeline === targetTimeline;
    });
    const filtered = sortByMostRegistered(filteredUnsorted);

    if (filtered.length === 0) {
        gridRoot.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #64748b; padding: 4rem 2rem;">No Event Found</div>`;
        return;
    }
let cardsHtml = '';
    filtered.forEach(opp => {
        const currentId = opp.eventId || opp.id;
        const isOwner = opp.hostEmail && opp.hostEmail.toLowerCase() === (state.currentUser?.email || '').toLowerCase();
        const isPastEvent = window.getEventTimelineStatus(opp.eventDate) === 'past';
        const borderColor = isOwner ? '#10b981' : '#3b82f6';
        cardsHtml += `
          <div class="card" style="background:#ffffff; border:1px solid #e2e8f0; border-left:4px solid ${borderColor}; border-radius:8px; padding:1.25rem; display:flex; flex-direction:column; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
              <span style="font-size:0.75rem; font-weight:700; color:#1e40af; background:#dbeafe; padding:0.25rem 0.5rem; border-radius:4px; width:fit-content; text-transform:uppercase;">${opp.category || 'Event'}</span>
              <span style="font-size:0.65rem; font-weight:700; color:${isOwner ? '#059669' : '#2563eb'}; text-transform:uppercase;">${isOwner ? 'Your Event' : 'Member Access'}</span>
            </div>
            <h4 style="font-size:1.1rem; font-weight:700; margin-top:0.5rem; color:#0f172a;">${opp.title}</h4>
            <span style="font-size:0.8rem; color:#64748b; margin-bottom:0.5rem;">${opp.society || 'Official Chapter'}</span>
            <span style="font-size:0.75rem; color:#94a3b8; margin-bottom:1rem;">Date: ${opp.eventDate || '2026'}</span>
            <div style="margin-top:auto; padding-top:0.75rem; border-top:1px solid #f1f5f9; display:flex; flex-direction:column; gap:0.5rem;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:0.8rem; color:#4f46e5; font-weight:700;">${opp.registrations || 0} Applied</span>
               ${isOwner
                  ? `<div style="display:flex; gap:0.5rem;">
                       <button onclick="window.openEditEventModal('${currentId}')" style="background:#eff6ff; color:#2563eb; border:none; padding:0.35rem 0.75rem; border-radius:6px; cursor:pointer; font-size:0.8rem; font-weight:600;">Edit</button>
                       <button onclick="window.handleDeleteEvent && window.handleDeleteEvent('${currentId}')" style="background:#ef4444; color:white; border:none; padding:0.35rem 0.75rem; border-radius:6px; cursor:pointer; font-size:0.8rem; font-weight:600;">Delete</button>
                     </div>`
                  : ``
                }
              </div>
              <div style="display:flex; gap:0.5rem;">
                <button onclick="window.openStatusModal('${currentId}')" style="flex:1; background:#eef2ff; color:#4f46e5; border:none; padding:0.4rem 0.5rem; border-radius:6px; cursor:pointer; font-size:0.75rem; font-weight:600;">View Status</button>
                <button onclick="window.openScannerModal('${currentId}')" style="flex:1; background:#fef3c7; color:#b45309; border:none; padding:0.4rem 0.5rem; border-radius:6px; cursor:pointer; font-size:0.75rem; font-weight:600;">📷 Scan Check-in</button>
                ${isOwner && !isPastEvent
                  ? `<button onclick="window.openAddMemberModal()" style="flex:1; background:#f0fdf4; color:#059669; border:none; padding:0.4rem 0.5rem; border-radius:6px; cursor:pointer; font-size:0.75rem; font-weight:600;">+ Add Member</button>`
                  : ``
                }
              </div>
            </div>
          </div>
        `;
    });

    gridRoot.innerHTML = cardsHtml;
};

window.handleCreateEventSubmit = function(e) {
  e.preventDefault();

  const title = document.getElementById('form-event-title').value.trim();
  const society = document.getElementById('form-event-society').value.trim();
  const category = document.getElementById('form-event-category').value;
  let imageUrl = document.getElementById('form-event-image').value.trim();
  const startDate = document.getElementById('form-event-start-date').value;
  const endDate = document.getElementById('form-event-end-date').value;
  const certificateTemplateUrl = document.getElementById('form-certificate-template-url').value.trim();
  const capacity = document.getElementById('form-event-capacity').value.trim();
  const teamSize = document.getElementById('form-event-team-size').value;
const eligibilityRaw = document.getElementById('form-event-eligibility').value.trim();
const whyParticipateRaw = document.getElementById('form-event-why-participate').value.trim();
const contactName = document.getElementById('form-event-contact-name').value.trim();
const contactEmail = document.getElementById('form-event-contact-email').value.trim();

const eligibility = eligibilityRaw ? eligibilityRaw.split('\n').map(s => s.trim()).filter(Boolean) : [];
const whyParticipate = whyParticipateRaw ? whyParticipateRaw.split('\n').map(s => s.trim()).filter(Boolean) : [];
const prizes = collectPrizesFromForm();
  const requiresPayment = document.getElementById('form-event-requires-payment').checked;
  const paymentAmount = requiresPayment ? document.getElementById('form-event-amount').value : null;
  const paymentUpi = requiresPayment ? document.getElementById('form-event-upi').value : null;

  if (!imageUrl) {
    imageUrl = 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800'; 
  }

  const formattedDuration = `${startDate} to ${endDate}`;
  const customId = "evt_" + Date.now();

const newEventObj = {
    eventId: customId,
    id: customId,
    title: title,
    society: society,
    category: category,
    eventDate: startDate, 
    endDate: endDate,
    durationText: formattedDuration,
    imageUrl: imageUrl,
    registrations: 0,
    isPaid: requiresPayment,
    amount: paymentAmount,
    upi: paymentUpi,
    capacity: capacity ? Number(capacity) : null,
    schedule: collectScheduleFromForm(),
    hostEmail: state.currentUser && state.currentUser.email ? state.currentUser.email : null,
    teamSize: teamSize || null,
eligibility: eligibility,
whyParticipate: whyParticipate,
prizes: prizes,
contactName: contactName || null,
contactEmail: contactEmail || null,
certificateTemplateUrl: certificateTemplateUrl || null,
certificatePositions: certificateTemplateUrl ? certificatePositionsDraft : null,
  };
  state.opportunities.unshift(newEventObj); 

  // handleCreateEventSubmit ke andar unshift wale line ke paas ye API call lagayein:
const idToken = localStorage.getItem('evntr_id_token');

fetch(`${API_BASE_URL}/events`, { // Aapka event create karne ka endpoint
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        // 'Authorization': idToken
    },
    body: JSON.stringify(newEventObj)
})
.then(res => {
    if(!res.ok) throw new Error("Failed to save event on AWS");
    return res.json();
})
.then(savedEvent => {
    window.showToast("Event permanently saved to AWS Cloud!", "success");
    // Dubara live data fetch karle taaki sync ho jaye
    fetchLiveOpportunities(); 
})
.catch(err => {
    console.error("Cloud saving failed:", err);
    window.showToast("Saved locally, but failed to sync with cloud.", "error");
});

  window.showToast("Event successfully published across platform!", "success");
  document.getElementById('create-event-form').reset();
  document.getElementById('schedule-days-container').innerHTML = '';
  scheduleDayCounter = 0;
  document.getElementById('prizes-container').innerHTML = '';
  document.getElementById('form-certificate-template-url').value = '';
document.getElementById('certificate-position-status').innerText = '';
certificatePositionsDraft = { name: null, eventTitle: null, date: null };
  document.getElementById('payment-details-wrap').style.display = 'none';
  window.toggleCreateEventForm(); 

  renderAllOpportunities();
  window.switchHostTimeline('active');
  window.switchView('student-dashboard'); 
};




function applyDashboardFilters() {
    const grid = document.getElementById('opportunities-root');
    if (!grid) return;

    const searchTerm = (document.getElementById('dashboard-search')?.value || '').toLowerCase().trim();
    const dateFilter = document.getElementById('filter-date')?.value || '';
    const typeFilter = document.getElementById('filter-type')?.value || '';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const filtered = state.opportunities.filter(opp => {
        const status = window.getEventTimelineStatus(opp.eventDate);
        if (status === 'past') return false;

        if (searchTerm) {
            const haystack = `${opp.title} ${opp.society}`.toLowerCase();
            if (!haystack.includes(searchTerm)) return false;
        }

        if (typeFilter) {
            const oppCategory = (opp.category || '').toLowerCase();
            if (oppCategory !== typeFilter.toLowerCase()) return false;
        }

        if (dateFilter) {
            const eventDate = new Date(opp.eventDate);
            if (isNaN(eventDate.getTime())) return false;
            eventDate.setHours(0, 0, 0, 0);
            const diffDays = Math.round((eventDate - today) / (1000 * 60 * 60 * 24));

            if (dateFilter === 'this-week' && (diffDays < 0 || diffDays > 7)) return false;
            if (dateFilter === 'this-month') {
                const isSameMonth = eventDate.getFullYear() === today.getFullYear() &&
                                     eventDate.getMonth() === today.getMonth();
                if (!isSameMonth || diffDays < 0) return false;
            }
        }

        return true;
    });

    renderFilteredOpportunities(filtered);
}

function renderFilteredOpportunities(dataset) {
    const allGrid = document.getElementById('opportunities-root');
    if (!allGrid) return;

    if (dataset.length === 0) {
        allGrid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; color:#64748b; padding:3rem;">No events match your filters.</div>`;
        return;
    }

    let allHtml = '';
    const sortedDataset = sortByMostRegistered(dataset);
    sortedDataset.forEach(opp => {
        const currentId = opp.eventId || opp.id;
        const cardImg = opp.imageUrl || 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800';
        const displayDate = opp.durationText || `Starts: ${opp.eventDate || '2026'}`;

        allHtml += `
          <div class="card" style="background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: flex; flex-direction: column;">
            <div class="card-banner" style="height: 160px; width: 100%; background: #cbd5e1; position: relative;">
              <img src="${cardImg}" onerror="this.onerror=null; this.src='https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800'; window.showToast('Event banner failed to load — showing default image', 'error');" style="width:100%; height:100%; object-fit:cover;" alt="Banner">
              <span class="category-badge" style="position: absolute; top: 0.5rem; left: 0.5rem; background: #4f46e5; color: white; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.7rem; font-weight:700;">${opp.category || 'Event'}</span>
            </div>
            <div class="card-body" style="padding: 1rem; flex-grow: 1; display: flex; flex-direction: column;">
              <span class="card-society" style="font-size: 0.75rem; color: #64748b; font-weight:600;">${opp.society || 'Official'}</span>
              <h3 class="card-title" style="font-size: 1.1rem; font-weight: 700; margin: 0.25rem 0; color: #0f172a;">${opp.title}</h3>
              <p style="font-size:0.8rem; color: #475569; margin:0.5rem 0 1rem 0;">📅 ${displayDate}</p>
              <div class="card-footer" style="margin-top: auto; display: flex; justify-content: space-between; align-items: center; padding-top: 0.75rem; border-top: 1px solid #f1f5f9;">
                <span class="registrations-count" style="font-size: 0.8rem; color: #64748b; font-weight:500;">${opp.registrations || 0} Applied</span>
                <button class="btn-card-action" onclick="window.openEventDetails('${currentId}')" style="background:#4f46e5; color:white; border:none; padding:0.4rem 0.8rem; border-radius:6px; cursor:pointer; font-size:0.8rem; font-weight:600;">View details</button>
              </div>
            </div>
          </div>
        `;
    });
    allGrid.innerHTML = allHtml;
}

function fetchSocietyAccess() {
    if (!state.currentUser) return Promise.resolve();
    return fetch(`${API_BASE_URL}/society/access?email=${encodeURIComponent(state.currentUser.email)}`)
        .then(res => res.json())
        .then(data => {
            state.accessibleOwners = data.accessibleOwners || [state.currentUser.email];
            state.isSocietyOwner = true;

            const newInvitations = data.newInvitations || [];
            newInvitations.forEach(invite => {
                window.showToast(`You've been added as a member of ${invite.societyName}!`, "success");
                fetch(`${API_BASE_URL}/society/mark-notified`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ownerEmail: invite.ownerEmail, memberEmail: state.currentUser.email })
                }).catch(err => console.error("Failed to mark notified:", err));
            });

            const newRemovals = data.newRemovals || [];
            newRemovals.forEach(removal => {
                window.showToast(`You've been removed from ${removal.societyName}.`, "error");
                fetch(`${API_BASE_URL}/society/mark-removal-notified`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ownerEmail: removal.ownerEmail, memberEmail: state.currentUser.email })
                }).catch(err => console.error("Failed to mark removal notified:", err));
            });
        })
        .catch(err => {
            console.error("Failed to fetch society access:", err);
            state.accessibleOwners = [state.currentUser.email];
            state.isSocietyOwner = true;
        });
}

function updateHostPermissions() {
    const launchBtn = document.querySelector('button[onclick="window.toggleCreateEventForm()"]');
    if (launchBtn) launchBtn.style.display = state.isSocietyOwner ? 'inline-block' : 'none';

    const addMemberBtn = document.getElementById('header-add-member-btn');
    if (addMemberBtn) addMemberBtn.style.display = state.isSocietyOwner ? 'inline-block' : 'none';
}

window.handleAddMember = function(e) {
    e.preventDefault();
    const memberEmail = document.getElementById('new-member-email').value.trim();
    fetch(`${API_BASE_URL}/society/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerEmail: state.currentUser.email, memberEmail })
    })
    .then(res => {
        if (!res.ok) throw new Error("Failed to add member");
        return res.json();
    })
    .then(() => {
        window.showToast(`${memberEmail} added as a member!`, "success");
        document.getElementById('new-member-email').value = '';
        window.closeAddMemberModal();
    })
    .catch(() => window.showToast("Failed to add member.", "error"));
};

window.openStatusModal = function(eventId) {
    const opp = state.opportunities.find(o => (o.eventId === eventId || o.id === eventId));
    const overlay = document.getElementById('status-modal-overlay');
    const titleEl = document.getElementById('status-modal-title');
    const countEl = document.getElementById('status-modal-count');
    const listEl = document.getElementById('status-modal-list');
    if (!overlay) return;

    titleEl.innerText = opp ? opp.title : 'Event Status';
    countEl.innerText = 'Loading...';
    listEl.innerHTML = '';
    overlay.style.display = 'flex';

    fetch(`${API_BASE_URL}/rsvp/by-event?eventId=${encodeURIComponent(eventId)}`)
        .then(res => res.json())
        .then(data => {
            state.lastStatusModalData = { eventTitle: opp ? opp.title : 'Event', registrants: data };

            const exportBtn = document.getElementById('status-modal-export-btn');
            if (exportBtn) exportBtn.style.display = data.length > 0 ? 'inline-block' : 'none';

            countEl.innerText = `${data.length} (${data.filter(r => r.checkedIn).length} checked in)`;
            if (data.length === 0) {
                listEl.innerHTML = `<div style="text-align:center; color:#94a3b8; padding:1rem; font-size:0.85rem;">No registrations yet.</div>`;
                return;
            }
            listEl.innerHTML = data.map(r => `
                <div style="padding:0.6rem; background:#f8fafc; border-radius:6px; font-size:0.85rem; display:flex; justify-content:space-between; align-items:center;">
                  <div>
                    <div style="font-weight:600; color:#0f172a;">${r.studentName}</div>
                    <div style="color:#64748b; font-size:0.75rem;">${r.studentEmail}</div>
                    ${r.paymentScreenshotUrl ? `<a href="${r.paymentScreenshotUrl}" target="_blank" style="color:#4f46e5; font-size:0.75rem;">View payment proof</a>` : ''}
                  </div>
                  <span style="font-size:0.7rem; font-weight:700; padding:0.2rem 0.5rem; border-radius:4px; ${r.checkedIn ? 'background:#dcfce7;color:#166534;' : 'background:#f1f5f9;color:#94a3b8;'}">${r.checkedIn ? '✓ Checked In' : 'Not yet'}</span>
                </div>
            `).join('');
        })
        .catch(err => {
            console.error("Failed to load status:", err);
            countEl.innerText = "Error";
            listEl.innerHTML = `<div style="color:#ef4444; font-size:0.85rem;">Failed to load registrations.</div>`;
        });
};

window.handleExportRegistrantsCsv = function() {
    const { eventTitle, registrants } = state.lastStatusModalData;
    if (!registrants || registrants.length === 0) {
        window.showToast("No registrants to export.", "error");
        return;
    }

    const headers = ["Student Name", "Email", "Registration Time", "Checked In", "Checked In At"];
    const escapeCsvField = (val) => {
        const str = String(val ?? '');
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    const rows = registrants.map(r => [
        r.studentName,
        r.studentEmail,
        r.registrationTime || '',
        r.checkedIn ? 'Yes' : 'No',
        r.checkedInAt || ''
    ]);

    const csvContent = [headers, ...rows]
        .map(row => row.map(escapeCsvField).join(','))
        .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const safeFileName = eventTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();

    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeFileName}_registrants.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    window.showToast("CSV exported successfully.", "success");
};

window.closeStatusModal = function() {
    const overlay = document.getElementById('status-modal-overlay');
    if (overlay) overlay.style.display = 'none';
};

window.openAddMemberModal = function() {
    const overlay = document.getElementById('add-member-modal-overlay');
    if (overlay) overlay.style.display = 'flex';
    loadMembersList();
};

function loadMembersList() {
    const container = document.getElementById('members-list-container');
    if (!container || !state.currentUser) return;

    container.innerHTML = `<div style="color:#94a3b8; font-size:0.8rem;">Loading...</div>`;

    fetch(`${API_BASE_URL}/society/members?ownerEmail=${encodeURIComponent(state.currentUser.email)}`)
        .then(res => res.json())
        .then(members => {
            if (!members || members.length === 0) {
                container.innerHTML = `<div style="color:#94a3b8; font-size:0.8rem;">No members added yet.</div>`;
                return;
            }
            container.innerHTML = members.map(m => `
                <div style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; padding:0.5rem 0.75rem; border-radius:6px;">
                  <span style="font-size:0.8rem; color:#334155;">${m.memberEmail}</span>
                  <button onclick="window.handleRemoveMember('${m.memberEmail}')" style="background:#fef2f2; color:#dc2626; border:none; padding:0.25rem 0.6rem; border-radius:6px; cursor:pointer; font-size:0.7rem; font-weight:600;">Remove</button>
                </div>
            `).join('');
        })
        .catch(() => {
            container.innerHTML = `<div style="color:#ef4444; font-size:0.8rem;">Failed to load members.</div>`;
        });
}

window.handleRemoveMember = function(memberEmail) {
    const confirmed = confirm(`Remove ${memberEmail} from your society? They'll lose access to all your events.`);
    if (!confirmed) return;

    fetch(`${API_BASE_URL}/society/members/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerEmail: state.currentUser.email, memberEmail })
    })
    .then(res => {
        if (!res.ok) throw new Error("Failed to remove member");
        return res.json();
    })
    .then(() => {
        window.showToast(`${memberEmail} removed from society.`, "success");
        loadMembersList();
    })
    .catch(() => window.showToast("Failed to remove member.", "error"));
};

window.closeAddMemberModal = function() {
    const overlay = document.getElementById('add-member-modal-overlay');
    if (overlay) overlay.style.display = 'none';
};

// ─── QR CHECK-IN: STUDENT-SIDE QR DISPLAY ───
window.openQrModal = function(eventId) {
    const meta = state.rsvpMeta[eventId];
    const rsvpId = meta && meta.rsvpId;
    const overlay = document.getElementById('qr-modal-overlay');
    const container = document.getElementById('qr-code-container');
    const label = document.getElementById('qr-modal-event-title');
    if (!overlay || !container) return;

    const opp = state.opportunities.find(o => (o.eventId === eventId || o.id === eventId));
    if (label) label.innerText = opp ? opp.title : 'Event Check-in';

    container.innerHTML = '';
    if (!rsvpId) {
        container.innerHTML = `<div style="color:#ef4444; font-size:0.85rem;">Check-in code unavailable — try refreshing the page.</div>`;
    } else if (meta.status === 'waitlisted') {
        container.innerHTML = `<div style="color:#b45309; font-size:0.85rem;">You're still on the waitlist — your check-in code will appear here once a spot opens up.</div>`;
    } else {
        new QRCode(container, { text: JSON.stringify({ rsvpId }), width: 200, height: 200 });
    }
    overlay.style.display = 'flex';
};

window.closeQrModal = function() {
    const overlay = document.getElementById('qr-modal-overlay');
    if (overlay) overlay.style.display = 'none';
};

// ─── QR CHECK-IN: HOST-SIDE CAMERA SCANNER ───
let activeScanner = null;

window.openScannerModal = function(eventId) {
    const overlay = document.getElementById('scanner-modal-overlay');
    const resultBox = document.getElementById('scanner-result-box');
    if (resultBox) resultBox.innerHTML = '';
    if (overlay) overlay.style.display = 'flex';

    activeScanner = new Html5Qrcode("qr-reader");
    activeScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 250 },
        (decodedText) => handleQrScanResult(decodedText),
        () => { /* ignore per-frame miss */ }
    ).catch(err => window.showToast("Camera access failed: " + err, "error"));
};

window.closeScannerModal = function() {
    const overlay = document.getElementById('scanner-modal-overlay');
    if (overlay) overlay.style.display = 'none';
    if (activeScanner) {
        activeScanner.stop().then(() => activeScanner.clear()).catch(() => {});
        activeScanner = null;
    }
};

function handleQrScanResult(decodedText) {
    let rsvpId;
    try { rsvpId = JSON.parse(decodedText).rsvpId; } catch (e) { rsvpId = decodedText; }
    if (!rsvpId || !activeScanner) return;

    activeScanner.pause(true);

    fetch(`${API_BASE_URL}/rsvp/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rsvpId })
    })
    .then(async res => {
        const data = await res.json();
        const resultBox = document.getElementById('scanner-result-box');
        if (res.status === 200) {
            window.showToast("✅ Checked in: " + (data.rsvp?.studentName || rsvpId), "success");
            if (resultBox) resultBox.innerHTML = `<div style="color:#059669; font-weight:700;">✅ ${data.rsvp?.studentName || 'Attendee'} checked in</div>`;
        } else if (res.status === 409) {
            window.showToast("Already checked in.", "error");
            if (resultBox) resultBox.innerHTML = `<div style="color:#d97706; font-weight:700;">⚠️ Already checked in</div>`;
        } else {
            window.showToast(data.error || "Invalid QR code.", "error");
            if (resultBox) resultBox.innerHTML = `<div style="color:#ef4444; font-weight:700;">❌ ${data.error || 'Invalid code'}</div>`;
        }
    })
    .catch(() => window.showToast("Check-in failed. Try again.", "error"))
    .finally(() => setTimeout(() => { if (activeScanner) activeScanner.resume(); }, 1500));
}

window.handleDeleteEvent = function(eventId) {
    const opp = state.opportunities.find(o => (o.eventId === eventId || o.id === eventId));
    if (!opp) return;

    const regCount = Number(opp.registrations) || 0;
    const warningLine = regCount > 0
        ? ` This event has ${regCount} registration${regCount === 1 ? '' : 's'} — all of them will be permanently removed too.`
        : '';

    const confirmed = confirm(`Delete "${opp.title}"? This cannot be undone.${warningLine}`);
    if (!confirmed) return;

    fetch(`${API_BASE_URL}/events/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            eventId: eventId,
            hostEmail: state.currentUser ? state.currentUser.email : ''
        })
    })
    .then(async res => {
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "Failed to delete event.");
        }
        return res.json();
    })
    .then((result) => {
        const removedCount = Number(result.orphanedRsvpsRemoved) || 0;
        const message = removedCount > 0
            ? `Event deleted. ${removedCount} registration${removedCount === 1 ? '' : 's'} also removed.`
            : "Event deleted successfully.";
        window.showToast(message, "success");

        state.opportunities = state.opportunities.filter(o => (o.eventId || o.id) !== eventId);
        delete state.eventTotalCounts[eventId];
        renderAllOpportunities();
        window.switchHostTimeline('active');
    })
    .catch(err => {
        console.error("Delete event failed:", err);
        window.showToast(err.message || "Failed to delete event.", "error");
    });
};

window.openEditEventModal = function(eventId) {
    const opp = state.opportunities.find(o => (o.eventId === eventId || o.id === eventId));
    if (!opp) return;

    document.getElementById('edit-event-id').value = eventId;
    document.getElementById('edit-event-title').value = opp.title || '';
    document.getElementById('edit-event-society').value = opp.society || '';
    document.getElementById('edit-event-category').value = opp.category || 'hackathon';
    document.getElementById('edit-event-image').value = opp.imageUrl || '';
    document.getElementById('edit-event-capacity').value = opp.capacity || '';
    document.getElementById('edit-event-start-date').value = opp.eventDate || '';
    document.getElementById('edit-event-end-date').value = opp.endDate || '';

    const payCheckbox = document.getElementById('edit-event-requires-payment');
    const payWrap = document.getElementById('edit-payment-details-wrap');
    payCheckbox.checked = !!opp.isPaid;
    payWrap.style.display = opp.isPaid ? 'grid' : 'none';
    document.getElementById('edit-event-amount').value = opp.amount || '';
    document.getElementById('edit-event-upi').value = opp.upi || '';

    document.getElementById('edit-event-modal-overlay').style.display = 'flex';
};

window.closeEditEventModal = function() {
    document.getElementById('edit-event-modal-overlay').style.display = 'none';
};

window.handleEditEventSubmit = function(e) {
    e.preventDefault();

    const eventId = document.getElementById('edit-event-id').value;
    const title = document.getElementById('edit-event-title').value.trim();
    const society = document.getElementById('edit-event-society').value.trim();
    const category = document.getElementById('edit-event-category').value;
    const imageUrl = document.getElementById('edit-event-image').value.trim();
    const capacity = document.getElementById('edit-event-capacity').value.trim();
    const startDate = document.getElementById('edit-event-start-date').value;
    const endDate = document.getElementById('edit-event-end-date').value;
    const isPaid = document.getElementById('edit-event-requires-payment').checked;
    const amount = isPaid ? document.getElementById('edit-event-amount').value : null;
    const upi = isPaid ? document.getElementById('edit-event-upi').value : null;

    fetch(`${API_BASE_URL}/events/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            eventId,
            hostEmail: state.currentUser ? state.currentUser.email : '',
            title, society, category, imageUrl,
            eventDate: startDate,
            endDate: endDate,
            durationText: `${startDate} to ${endDate}`,
            capacity, isPaid, amount, upi
        })
    })
    .then(async res => {
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "Failed to update event.");
        }
        return res.json();
    })
    .then(() => {
        window.showToast("Event updated successfully!", "success");
        window.closeEditEventModal();
        fetchLiveOpportunities();
    })
    .catch(err => {
        console.error("Edit event failed:", err);
        window.showToast(err.message || "Failed to update event.", "error");
    });
};

window.handleDownloadCertificate = function(eventId) {
    const opp = state.opportunities.find(o => (o.eventId === eventId || o.id === eventId));
    if (!opp || !state.currentUser) {
        window.showToast("Unable to generate certificate. Try refreshing.", "error");
        return;
    }

    if (opp.certificateTemplateUrl && opp.certificatePositions && opp.certificatePositions.name) {
        generateTemplateCertificate(opp);
    } else {
        generateDefaultCertificate(opp);
    }
};

function generateTemplateCertificate(opp) {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = function() {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.95);

            const { jsPDF } = window.jspdf;
            const isLandscape = img.naturalWidth >= img.naturalHeight;
            const doc = new jsPDF({
                orientation: isLandscape ? 'landscape' : 'portrait',
                unit: 'pt',
                format: 'a4'
            });

            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();

            doc.addImage(dataUrl, 'JPEG', 0, 0, pageWidth, pageHeight);

            const positions = opp.certificatePositions;

            if (positions.name) {
                doc.setFont("helvetica", "bold");
                doc.setFontSize(24);
                doc.setTextColor(15, 23, 42);
                doc.text(state.currentUser.name || "Participant",
                    (positions.name.xPercent / 100) * pageWidth,
                    (positions.name.yPercent / 100) * pageHeight,
                    { align: "center" });
            }

            if (positions.eventTitle) {
                doc.setFont("helvetica", "bold");
                doc.setFontSize(16);
                doc.setTextColor(15, 23, 42);
                doc.text(opp.title || "",
                    (positions.eventTitle.xPercent / 100) * pageWidth,
                    (positions.eventTitle.yPercent / 100) * pageHeight,
                    { align: "center" });
            }

            if (positions.date) {
                doc.setFont("helvetica", "normal");
                doc.setFontSize(12);
                doc.setTextColor(51, 65, 85);
                doc.text(opp.eventDate || "",
                    (positions.date.xPercent / 100) * pageWidth,
                    (positions.date.yPercent / 100) * pageHeight,
                    { align: "center" });
            }

            const safeFileName = opp.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            doc.save(`${safeFileName}_certificate.pdf`);
            window.showToast("Certificate downloaded!", "success");
        } catch (err) {
            console.error("Template certificate generation failed:", err);
            window.showToast("Couldn't use the custom template (likely a CORS restriction on the image host) — generating a default certificate instead.", "error");
            generateDefaultCertificate(opp);
        }
    };

    img.onerror = function() {
        window.showToast("Couldn't load the certificate template — generating a default certificate instead.", "error");
        generateDefaultCertificate(opp);
    };

    img.src = opp.certificateTemplateUrl;
}

function generateDefaultCertificate(opp) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    doc.setDrawColor(79, 70, 229);
    doc.setLineWidth(3);
    doc.rect(30, 30, pageWidth - 60, pageHeight - 60);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(30);
    doc.setTextColor(15, 23, 42);
    doc.text("Certificate of Participation", pageWidth / 2, 130, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(14);
    doc.setTextColor(100, 116, 139);
    doc.text("This certificate is proudly presented to", pageWidth / 2, 175, { align: "center" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(26);
    doc.setTextColor(79, 70, 229);
    doc.text(state.currentUser.name || "Participant", pageWidth / 2, 220, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(14);
    doc.setTextColor(51, 65, 85);
    doc.text(`for actively participating in`, pageWidth / 2, 265, { align: "center" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(15, 23, 42);
    doc.text(`"${opp.title}"`, pageWidth / 2, 295, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.setTextColor(100, 116, 139);
    doc.text(`hosted by ${opp.society || 'Official Chapter'} on ${opp.eventDate}`, pageWidth / 2, 320, { align: "center" });

    doc.setFontSize(10);
    doc.setTextColor(148, 163, 184);
    doc.text("Issued via evntr — verified attendance record", pageWidth / 2, pageHeight - 60, { align: "center" });

    const safeFileName = opp.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    doc.save(`${safeFileName}_certificate.pdf`);

    window.showToast("Certificate downloaded!", "success");
}

// ─── ANALYTICS DASHBOARD ───
let analyticsTrendChart = null;
let analyticsCategoryChart = null;

window.openAnalyticsModal = function() {
    const overlay = document.getElementById('analytics-modal-overlay');
    const loadingEl = document.getElementById('analytics-loading');
    const contentEl = document.getElementById('analytics-content');
    if (!overlay) return;

    overlay.style.display = 'flex';
    loadingEl.style.display = 'block';
    contentEl.style.display = 'none';

    // Every event this user owns or has member access to — no time-window cutoff,
    // since analytics should cover the full history, not just the last 30 days.
    const myEvents = state.opportunities.filter(opp =>
        state.accessibleOwners.includes((opp.hostEmail || '').toLowerCase())
    );

    if (myEvents.length === 0) {
        loadingEl.innerText = "No events found to analyze yet.";
        return;
    }

    Promise.all(
        myEvents.map(opp => {
            const eventId = opp.eventId || opp.id;
            return fetch(`${API_BASE_URL}/rsvp/by-event?eventId=${encodeURIComponent(eventId)}`)
                .then(res => res.json())
                .then(rsvps => ({ opp, rsvps: Array.isArray(rsvps) ? rsvps : [] }))
                .catch(() => ({ opp, rsvps: [] }));
        })
    ).then(results => {
        renderAnalyticsCharts(results);
        loadingEl.style.display = 'none';
        contentEl.style.display = 'block';
    });
};

window.closeAnalyticsModal = function() {
    const overlay = document.getElementById('analytics-modal-overlay');
    if (overlay) overlay.style.display = 'none';
};

function renderAnalyticsCharts(results) {
    // --- Registration trends: daily counts over the last 30 days ---
    const dayBuckets = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 29; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        dayBuckets[key] = 0;
    }

    // --- Category popularity: total registrations per category ---
    const categoryCounts = {};

    results.forEach(({ opp, rsvps }) => {
        const category = opp.category || 'Other';
        categoryCounts[category] = (categoryCounts[category] || 0) + rsvps.length;

        rsvps.forEach(r => {
            if (!r.registrationTime) return;
            const key = r.registrationTime.slice(0, 10);
            if (key in dayBuckets) {
                dayBuckets[key]++;
            }
        });
    });

    const trendLabels = Object.keys(dayBuckets).map(k => {
        const d = new Date(k);
        return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    });
    const trendData = Object.values(dayBuckets);

    const trendCtx = document.getElementById('analytics-trend-chart');
    if (analyticsTrendChart) analyticsTrendChart.destroy();
    analyticsTrendChart = new Chart(trendCtx, {
        type: 'line',
        data: {
            labels: trendLabels,
            datasets: [{
                label: 'Registrations',
                data: trendData,
                borderColor: '#4f46e5',
                backgroundColor: 'rgba(79,70,229,0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 2
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
    });

    const categoryLabels = Object.keys(categoryCounts);
    const categoryData = Object.values(categoryCounts);
    const palette = ['#4f46e5', '#059669', '#f59e0b', '#ef4444', '#7c3aed', '#0ea5e9', '#ec4899', '#84cc16', '#f97316', '#14b8a6'];

    const categoryCtx = document.getElementById('analytics-category-chart');
    if (analyticsCategoryChart) analyticsCategoryChart.destroy();
    analyticsCategoryChart = new Chart(categoryCtx, {
        type: 'bar',
        data: {
            labels: categoryLabels,
            datasets: [{
                label: 'Registrations',
                data: categoryData,
                backgroundColor: categoryLabels.map((_, i) => palette[i % palette.length])
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
    });
}
// ─── MULTI-DAY SCHEDULE BUILDER (create event form) ───
let scheduleDayCounter = 0;

window.addScheduleDay = function() {
    scheduleDayCounter++;
    const dayId = `day-${scheduleDayCounter}`;
    const container = document.getElementById('schedule-days-container');
    const dayBlock = document.createElement('div');
    dayBlock.id = dayId;
    dayBlock.style.cssText = 'background:#fff; border:1px solid #cbd5e1; border-radius:8px; padding:0.75rem;';
    dayBlock.innerHTML = `
      <div style="display:flex; gap:0.5rem; align-items:center; margin-bottom:0.5rem;">
        <input type="text" class="schedule-day-label" placeholder="Day 1" value="Day ${scheduleDayCounter}" style="flex:1; padding:0.4rem; border:1px solid #cbd5e1; border-radius:6px; font-size:0.8rem;">
        <input type="date" class="schedule-day-date" style="padding:0.4rem; border:1px solid #cbd5e1; border-radius:6px; font-size:0.8rem;">
        <button type="button" onclick="document.getElementById('${dayId}').remove()" style="background:#fef2f2; color:#dc2626; border:none; padding:0.35rem 0.6rem; border-radius:6px; cursor:pointer; font-size:0.75rem;">✕</button>
      </div>
      <div class="schedule-items-container" style="display:flex; flex-direction:column; gap:0.4rem; margin-bottom:0.5rem;"></div>
      <button type="button" onclick="window.addScheduleItem('${dayId}')" style="background:#eef2ff; color:#4f46e5; border:none; padding:0.3rem 0.6rem; border-radius:6px; cursor:pointer; font-size:0.75rem; font-weight:600;">+ Add Agenda Item</button>
    `;
    container.appendChild(dayBlock);
};

window.addScheduleItem = function(dayId) {
    const itemsContainer = document.querySelector(`#${dayId} .schedule-items-container`);
    const itemRow = document.createElement('div');
    itemRow.style.cssText = 'display:flex; gap:0.5rem;';
    itemRow.innerHTML = `
      <input type="text" class="schedule-item-time" placeholder="10:00 AM" style="width:100px; padding:0.4rem; border:1px solid #cbd5e1; border-radius:6px; font-size:0.8rem;">
      <input type="text" class="schedule-item-title" placeholder="Opening Ceremony" style="flex:1; padding:0.4rem; border:1px solid #cbd5e1; border-radius:6px; font-size:0.8rem;">
      <button type="button" onclick="this.parentElement.remove()" style="background:#fef2f2; color:#dc2626; border:none; padding:0.3rem 0.5rem; border-radius:6px; cursor:pointer; font-size:0.7rem;">✕</button>
    `;
    itemsContainer.appendChild(itemRow);
};

function collectScheduleFromForm() {
    const dayBlocks = document.querySelectorAll('#schedule-days-container > div');
    const schedule = [];
    dayBlocks.forEach(dayBlock => {
        const dayLabel = dayBlock.querySelector('.schedule-day-label').value.trim() || 'Day';
        const dayDate = dayBlock.querySelector('.schedule-day-date').value;
        const items = [];
        dayBlock.querySelectorAll('.schedule-items-container > div').forEach(itemRow => {
            const time = itemRow.querySelector('.schedule-item-time').value.trim();
            const itemTitle = itemRow.querySelector('.schedule-item-title').value.trim();
            if (itemTitle) {
                items.push({ time, title: itemTitle });
            }
        });
        schedule.push({ dayLabel, date: dayDate, items });
    });
    return schedule;
}

// ─── MULTI-DAY SCHEDULE DISPLAY (event details page) ───
function renderEventSchedule(opp) {
    const scheduleSection = document.getElementById('detail-schedule-section');
    const scheduleContent = document.getElementById('detail-schedule-content');
    if (!scheduleSection || !scheduleContent) return;

    if (opp.schedule && opp.schedule.length > 0) {
        scheduleSection.style.display = 'block';
        scheduleContent.innerHTML = opp.schedule.map(day => `
          <div style="border-left:3px solid #4f46e5; padding-left:1rem;">
            <div style="font-weight:700; color:#0f172a; margin-bottom:0.5rem;">${day.dayLabel}${day.date ? ` — ${day.date}` : ''}</div>
            <div style="display:flex; flex-direction:column; gap:0.4rem;">
              ${(day.items || []).map(item => `
                <div style="display:flex; gap:0.75rem; font-size:0.85rem; color:#475569;">
                  <span style="font-weight:600; color:#4f46e5; min-width:80px;">${item.time || ''}</span>
                  <span>${item.title}</span>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('');
    } else {
        scheduleSection.style.display = 'none';
    }
}
// ─── EXTRA EVENT DETAILS (team size, eligibility, why participate, prizes, contact) ───
window.addPrizeRow = function() {
    const container = document.getElementById('prizes-container');
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:0.5rem;';
    row.innerHTML = `
      <input type="text" class="prize-position" placeholder="Winner" style="flex:1; padding:0.4rem; border:1px solid #cbd5e1; border-radius:6px; font-size:0.8rem;">
      <input type="number" class="prize-amount" placeholder="20000" style="width:120px; padding:0.4rem; border:1px solid #cbd5e1; border-radius:6px; font-size:0.8rem;">
      <button type="button" onclick="this.parentElement.remove()" style="background:#fef2f2; color:#dc2626; border:none; padding:0.3rem 0.6rem; border-radius:6px; cursor:pointer; font-size:0.75rem;">✕</button>
    `;
    container.appendChild(row);
};

function collectPrizesFromForm() {
    const rows = document.querySelectorAll('#prizes-container > div');
    const prizes = [];
    rows.forEach(row => {
        const position = row.querySelector('.prize-position').value.trim();
        const amount = row.querySelector('.prize-amount').value.trim();
        if (position || amount) {
            prizes.push({ position, amount });
        }
    });
    return prizes;
}

function renderEventExtras(opp) {
    const section = document.getElementById('detail-extras-section');
    if (!section) return;
    let anyContent = false;

    const teamSizeBadge = document.getElementById('detail-team-size-badge');
    if (opp.teamSize) {
        teamSizeBadge.style.display = 'inline-block';
        teamSizeBadge.innerText = opp.teamSize;
        anyContent = true;
    } else {
        teamSizeBadge.style.display = 'none';
    }

    const eligBlock = document.getElementById('detail-eligibility-block');
    const eligList = document.getElementById('detail-eligibility-list');
    if (opp.eligibility && opp.eligibility.length > 0) {
        eligBlock.style.display = 'block';
        eligList.innerHTML = opp.eligibility.map(line => `<li>${line}</li>`).join('');
        anyContent = true;
    } else {
        eligBlock.style.display = 'none';
    }

    const whyBlock = document.getElementById('detail-why-participate-block');
    const whyList = document.getElementById('detail-why-list');
    if (opp.whyParticipate && opp.whyParticipate.length > 0) {
        whyBlock.style.display = 'block';
        whyList.innerHTML = opp.whyParticipate.map(line => `<li>${line}</li>`).join('');
        anyContent = true;
    } else {
        whyBlock.style.display = 'none';
    }

    const prizesBlock = document.getElementById('detail-prizes-block');
    const prizesCards = document.getElementById('detail-prizes-cards');
    if (opp.prizes && opp.prizes.length > 0) {
        prizesBlock.style.display = 'block';
        prizesCards.innerHTML = opp.prizes.map(p => `
          <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:1rem 1.5rem; text-align:center; min-width:140px;">
            <div style="font-size:1.3rem; font-weight:800; color:#b45309;">₹${p.amount || '0'}</div>
            <div style="font-size:0.8rem; color:#92400e; font-weight:600; margin-top:0.25rem;">${p.position || 'Prize'}</div>
          </div>
        `).join('');
        anyContent = true;
    } else {
        prizesBlock.style.display = 'none';
    }

    const contactBlock = document.getElementById('detail-contact-block');
    const contactInfo = document.getElementById('detail-contact-info');
    if (opp.contactName || opp.contactEmail) {
        contactBlock.style.display = 'block';
        contactInfo.innerHTML = `${opp.contactName || 'Organiser'}${opp.contactEmail ? ` — <a href="mailto:${opp.contactEmail}" style="color:#4f46e5;">${opp.contactEmail}</a>` : ''}`;
        anyContent = true;
    } else {
        contactBlock.style.display = 'none';
    }

    section.style.display = anyContent ? 'flex' : 'none';
}

// ─── CERTIFICATE TEMPLATE POSITIONER ───
let certificatePositionsDraft = { name: null, eventTitle: null, date: null };
let activePositionField = 'name';

window.openCertificatePositioner = function() {
    const url = document.getElementById('form-certificate-template-url').value.trim();
    if (!url) {
        window.showToast("Paste a template image URL first.", "error");
        return;
    }
    document.getElementById('certificate-preview-image').src = url;
    document.getElementById('certificate-positioner-overlay').style.display = 'flex';
    window.setActivePositionField('name');
    renderCertMarkers();
};

window.closeCertificatePositioner = function() {
    document.getElementById('certificate-positioner-overlay').style.display = 'none';
};

window.setActivePositionField = function(field) {
    activePositionField = field;
    document.querySelectorAll('.cert-field-btn').forEach(btn => {
        btn.style.border = '2px solid transparent';
        btn.style.background = '#f1f5f9';
        btn.style.color = '#475569';
    });
    const activeBtn = document.getElementById(`field-btn-${field}`);
    const colors = { name: ['#eef2ff', '#4f46e5'], eventTitle: ['#f0fdf4', '#059669'], date: ['#fffbeb', '#b45309'] };
    activeBtn.style.background = colors[field][0];
    activeBtn.style.color = colors[field][1];
    activeBtn.style.border = `2px solid ${colors[field][1]}`;
};

document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('certificate-preview-container');
    if (container) {
        container.addEventListener('click', (e) => {
            const rect = container.getBoundingClientRect();
            const xPercent = ((e.clientX - rect.left) / rect.width) * 100;
            const yPercent = ((e.clientY - rect.top) / rect.height) * 100;
            certificatePositionsDraft[activePositionField] = { xPercent, yPercent };
            renderCertMarkers();
        });
    }
});

function renderCertMarkers() {
    ['name', 'eventTitle', 'date'].forEach(field => {
        const marker = document.getElementById(`cert-marker-${field}`);
        const pos = certificatePositionsDraft[field];
        if (pos) {
            marker.style.display = 'block';
            marker.style.left = pos.xPercent + '%';
            marker.style.top = pos.yPercent + '%';
        } else {
            marker.style.display = 'none';
        }
    });
}

window.saveCertificatePositions = function() {
    if (!certificatePositionsDraft.name) {
        window.showToast("At least place the Name field before saving.", "error");
        return;
    }
    const statusEl = document.getElementById('certificate-position-status');
    const placedCount = Object.values(certificatePositionsDraft).filter(Boolean).length;
    statusEl.innerText = `✓ ${placedCount}/3 fields positioned`;
    window.closeCertificatePositioner();
};

// ─── PAID EVENT REGISTRATION FLOW ───
let pendingPaymentEventId = null;

window.openPaymentConfirmModal = function(eventId) {
    const opp = state.opportunities.find(o => (o.eventId === eventId || o.id === eventId));
    if (!opp) return;

    pendingPaymentEventId = eventId;
    document.getElementById('payment-confirm-amount').innerText = opp.amount || '0';
    document.getElementById('payment-confirm-upi').innerText = opp.upi || 'N/A';
    document.getElementById('payment-confirm-screenshot-url').value = '';
    document.getElementById('payment-confirm-modal-overlay').style.display = 'flex';
};

window.closePaymentConfirmModal = function() {
    document.getElementById('payment-confirm-modal-overlay').style.display = 'none';
    pendingPaymentEventId = null;
};

window.handlePaymentConfirmSubmit = function() {
    const screenshotUrl = document.getElementById('payment-confirm-screenshot-url').value.trim();
    if (!screenshotUrl) {
        window.showToast("Please paste a link to your payment screenshot.", "error");
        return;
    }
    if (!pendingPaymentEventId) return;

    const eventId = pendingPaymentEventId;
    document.getElementById('payment-confirm-modal-overlay').style.display = 'none';
    window.executeAwsRegistration(eventId, screenshotUrl);
    pendingPaymentEventId = null;
};