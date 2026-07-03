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
  opportunities: [],
  selectedEventId: null // Tracks which event details page is open
};

// Helper code

const DEFAULT_EVENT_IMAGE = 'https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=1400&q=80';

const CATEGORY_IMAGES = {
  technical: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=1400&q=80',
  hackathon: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1400&q=80',
  cultural: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=1400&q=80',
  debate: 'https://images.unsplash.com/photo-1475721027785-f74eccf877e2?auto=format&fit=crop&w=1400&q=80',
  workshop: 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1400&q=80',
  sports: 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=1400&q=80'
};

const SAMPLE_OPPORTUNITIES = [
  {
    eventId: 'evt_01',
    title: 'Innerve Hackathon 2026',
    society: 'ACM Student Chapter',
    category: 'Hackathon',
    mode: 'Offline',
    location: 'IGDTUW, Delhi',
    eventDate: 'Oct 14 - Oct 16, 2026',
    deadline: 'Oct 10, 2026',
    teamSize: '2 - 4 members',
    registrations: 432,
    prize: '₹50,000 prize pool',
    about: 'A 36-hour build challenge where students prototype practical technology solutions, pitch them to mentors, and compete for prizes. Build, demo, and present your strongest idea with your team.',
    eligibility: 'Open to IGDTUW students from all branches and years. Basic programming knowledge is recommended.',
    tags: ['Hackathon', 'Coding', 'Innovation'],
    timeline: [
      'Registration closes: Oct 10, 2026',
      'Opening ceremony: Oct 14, 2026',
      'Final demo and judging: Oct 16, 2026'
    ],
    rules: [
      'Each team can submit only one project.',
      'Projects must be built during the hackathon window.',
      'The decision of judges will be final.'
    ],
    perks: [
      'Certificates for all valid participants',
      'Mentor guidance during building hours',
      'Networking with seniors and society members'
    ],
    faqs: [
      {
        question: 'Can first-year students participate?',
        answer: 'Yes. First-year students can participate and are encouraged to join teams with mixed skill levels.'
      },
      {
        question: 'Do I need a complete idea before registering?',
        answer: 'No. You can refine the idea during the event with your team.'
      }
    ],
    contactEmail: 'acm@igdtuw.ac.in'
  },
  {
    eventId: 'evt_02',
    title: 'Taarangana Street Showdown',
    society: 'Hypnotics Society',
    category: 'Cultural',
    mode: 'Offline',
    location: 'IGDTUW Main Stage',
    eventDate: 'Nov 02, 2026',
    deadline: 'Oct 28, 2026',
    teamSize: '3 - 8 members',
    registrations: 189,
    prize: 'Trophies + certificates',
    about: 'A high-energy street performance competition inspired by college fest culture. Teams perform short, impactful pieces in dance, drama, or mixed creative format.',
    eligibility: 'Open to all college students. Participants must carry valid college ID cards.',
    tags: ['Cultural', 'Dance', 'Drama'],
    timeline: [
      'Registration closes: Oct 28, 2026',
      'Prelims: Nov 01, 2026',
      'Finale: Nov 02, 2026'
    ],
    rules: [
      'Performance duration must stay within the announced time limit.',
      'Teams must report at least 30 minutes before their slot.',
      'Use of unsafe props is not allowed.'
    ],
    perks: [
      'Performance certificates',
      'Fest exposure',
      'Featured social media coverage'
    ],
    faqs: [
      {
        question: 'Can non-IGDTUW teams register?',
        answer: 'Yes, unless the organizers announce a college-specific restriction.'
      }
    ],
    contactEmail: 'hypnotics@igdtuw.ac.in'
  }
];

function valueFrom(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function getEventId(opp = {}) {
  return String(
    valueFrom(opp.eventId, opp.event_id, opp.id, opp._id, opp.eventID, '')
  ).trim();
}

function getDataset() {
  return Array.isArray(state.opportunities) && state.opportunities.length > 0
    ? state.opportunities
    : SAMPLE_OPPORTUNITIES;
}

function findOpportunityById(eventId) {
  const target = String(eventId);
  return getDataset().find(opp => getEventId(opp) === target);
}

function escapeHtml(value) {
  return String(valueFrom(value, ''))
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normaliseList(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).map(item => String(item));
  }

  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/\n|\r|;|\|/)
      .map(item => item.trim())
      .filter(Boolean);
  }

  return fallback;
}

function normaliseFaqs(value) {
  if (!Array.isArray(value)) return [];

  return value.map(item => {
    if (typeof item === 'string') {
      return {
        question: item,
        answer: 'The organizing team will share more information soon.'
      };
    }

    return {
      question: valueFrom(item.question, item.q, 'Question'),
      answer: valueFrom(item.answer, item.a, 'The organizing team will share more information soon.')
    };
  });
}

function getCategoryImage(category) {
  const key = String(category || '').toLowerCase();
  return CATEGORY_IMAGES[key] || DEFAULT_EVENT_IMAGE;
}

function normaliseEvent(raw = {}, localFallback = {}) {
  const source = { ...localFallback, ...raw };

  const category = valueFrom(
    source.category,
    source.type,
    source.eventType,
    'General'
  );

  const registrationCount = Number(
    valueFrom(
      source.registrations,
      source.registrationCount,
      source.rsvpCount,
      source.registered,
      0
    )
  ) || 0;

  return {
    eventId: getEventId(source) || getEventId(localFallback),
    title: valueFrom(source.title, source.eventTitle, source.name, 'Campus Event'),
    society: valueFrom(source.society, source.organizer, source.host, source.club, source.societyName, 'Official Chapter'),
    category,
    mode: valueFrom(source.mode, source.format, source.eventMode, 'Offline'),
    location: valueFrom(source.location, source.venue, source.place, 'Campus venue to be announced'),
    eventDate: valueFrom(source.eventDate, source.date, source.startDate, source.start_time, source.startTime, 'Date to be announced'),
    deadline: valueFrom(source.deadline, source.registrationDeadline, source.endDate, source.lastDate, 'Registration open'),
    teamSize: valueFrom(source.teamSize, source.team_size, source.team, 'Individual / Team'),
    registrations: registrationCount,
    prize: valueFrom(source.prize, source.prizes, source.prizePool, source.reward, 'Certificates and recognition'),
    about: valueFrom(source.about, source.description, source.details, source.summary, 'Details will be shared by the organizing team soon.'),
    eligibility: valueFrom(source.eligibility, source.eligible, 'Open to eligible students as per organizer rules.'),
    bannerImage: valueFrom(source.bannerImage, source.image, source.imageUrl, source.posterUrl, source.poster, getCategoryImage(category)),
    tags: normaliseList(valueFrom(source.tags, source.keywords), [category, valueFrom(source.mode, 'Offline')]),
    timeline: normaliseList(source.timeline, [
      `Registration deadline: ${valueFrom(source.deadline, source.registrationDeadline, 'To be announced')}`,
      `Event date: ${valueFrom(source.eventDate, source.date, 'To be announced')}`,
      'Results / next steps will be announced by the organizers.'
    ]),
    rules: normaliseList(source.rules, [
      'Participants must provide correct registration details.',
      'Follow the schedule and instructions shared by the organizing society.',
      'The organizer decision will be final for selection, prizes, and results.'
    ]),
    perks: normaliseList(valueFrom(source.perks, source.benefits), [
      'Participation certificate',
      'Campus exposure and peer networking',
      'Learning experience with society mentors'
    ]),
    faqs: normaliseFaqs(source.faqs),
    contactEmail: valueFrom(source.contactEmail, source.email, source.contact, 'organizers@igdtuw.ac.in')
  };
}

function getDaysLeftLabel(deadline) {
  const parsed = new Date(deadline);

  if (Number.isNaN(parsed.getTime())) {
    return 'Registration Open';
  }

  const today = new Date();
  parsed.setHours(23, 59, 59, 999);

  const diffDays = Math.ceil((parsed - today) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'Deadline Passed';
  if (diffDays === 0) return 'Last Day';
  if (diffDays === 1) return '1 Day Left';
  if (diffDays <= 30) return `${diffDays} Days Left`;

  return `${Math.ceil(diffDays / 30)} Month Left`;
}

function renderList(items, className = 'detail-bullet-list') {
  return `
    <ul class="${className}">
      ${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
    </ul>
  `;
}

function getHashEventId() {
  if (!window.location.hash) return '';

  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return params.get('event') || '';
}

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
                    email: userProfile['email'] || cognitoUser.getUsername(), // FIXED: Pulls true email string instead of UUID string
                    role: userProfile['custom:role'] || 'Student',
                    branch: userProfile['custom:branch'] || 'CSE',
                    year: userProfile['custom:year'] || '2026'
                };

                localStorage.setItem('evntr_id_token', session.getIdToken().getJwtToken());
                localStorage.setItem('evntr_access_token', session.getAccessToken().getJwtToken());
                
                // Refresh UI with user details
                updateNavProfile();
                fetchUserRSVPs();
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

// Routing System between Views (Fixed Layout Visibility Architecture)
window.switchView = function(viewName) {
  state.activeView = viewName;
  
  // 1. Hide ALL view container elements completely first
  if (document.getElementById('view-student-dashboard')) document.getElementById('view-student-dashboard').style.display = 'none';
  if (document.getElementById('view-society-portal')) document.getElementById('view-society-portal').style.display = 'none';
  if (document.getElementById('view-auth-page')) document.getElementById('view-auth-page').style.display = 'none';
  if (document.getElementById('view-event-details')) document.getElementById('view-event-details').style.display = 'none';

  // Remove navigation highlights
  const studentBtn = document.getElementById('btn-nav-student');
  const hostBtn = document.getElementById('btn-nav-host');
  if (studentBtn) studentBtn.classList.remove('active');
  if (hostBtn) hostBtn.classList.remove('active');

  // 2. Show ONLY the single targeted interface screen
  const targetEl = document.getElementById('view-' + viewName);
  if (targetEl) {
      targetEl.style.display = 'block';
  }

  // Light up navigation button highlights based on perspective
  if (viewName === 'student-dashboard' && studentBtn) {
    studentBtn.classList.add('active');
    renderAllOpportunities();
  }
  if (viewName === 'host-dashboard' && hostBtn) {
    hostBtn.classList.add('active');
  }
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

// Close standalone event details page and return to student dashboard
window.closeEventDetails = function() {
    state.selectedEventId = null;

    if (window.location.hash.startsWith('#event=')) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    window.switchView('student-dashboard');
};

// Copy shareable event link
window.copyCurrentEventLink = function(eventId) {
    const link = `${window.location.origin}${window.location.pathname}#event=${encodeURIComponent(eventId)}`;

    if (navigator.clipboard) {
        navigator.clipboard.writeText(link)
            .then(() => {
                window.showToast('Event link copied.', 'success');
            })
            .catch(() => {
                window.showToast('Could not copy link. Copy it from the address bar.', 'error');
            });
    } else {
        window.showToast('Copy this URL from the address bar.', 'success');
    }
};


// Open standalone custom detail view parameters: Unstop-inspired layout
window.openEventDetails = async function(eventId) {
    const localEvent = findOpportunityById(eventId);

    if (!localEvent) {
        window.showToast('Event details could not be found.', 'error');
        return;
    }

    state.selectedEventId = String(eventId);

    // First render instantly using already-loaded card data
    renderEventDetails(localEvent, { loading: true });

    // Keep URL trackable without changing any backend logic
    history.replaceState(null, '', `#event=${encodeURIComponent(eventId)}`);

    // Use your existing view switch system
    window.switchView('event-details');

    // Try to fetch richer details from backend if endpoint exists.
    // If backend endpoint does not exist, it safely falls back to local event data.
    try {
        const res = await fetch(`${API_BASE_URL}/event/${encodeURIComponent(eventId)}`);

        if (!res.ok) {
            throw new Error(`Single event API unavailable: ${res.status}`);
        }

        const payload = await res.json();

        const remoteEvent = Array.isArray(payload)
            ? payload[0]
            : valueFrom(payload.event, payload.data, payload.Item, payload);

        renderEventDetails(remoteEvent, { localFallback: localEvent });
    } catch (err) {
        console.warn('Using already-loaded event data for details page:', err.message);
        renderEventDetails(localEvent);
    }
};

// Render the complete Unstop-inspired details UI inside #event-detail-root
function renderEventDetails(rawEvent, options = {}) {
    const root = document.getElementById('event-detail-root');

    if (!root) {
        console.error('Missing #event-detail-root in index.html');
        return;
    }

    const event = normaliseEvent(rawEvent, options.localFallback || {});
    const isRegistered = state.rsvps.map(String).includes(String(event.eventId));

    const statusText = isRegistered
        ? 'You are registered'
        : getDaysLeftLabel(event.deadline);

    const buttonText = isRegistered
        ? 'Registered ✓'
        : 'Register Now';

    const buttonClass = isRegistered
        ? 'detail-primary-btn registered'
        : 'detail-primary-btn';

    const safeBanner = escapeHtml(event.bannerImage);

    root.innerHTML = `
        <div class="event-detail-shell">
            <button class="detail-back-btn" type="button" onclick="window.closeEventDetails()">
                <span>←</span> Back to Dashboard
            </button>

            <section class="event-detail-hero-card" style="background-image: linear-gradient(90deg, rgba(15, 23, 42, 0.88), rgba(15, 23, 42, 0.52)), url('${safeBanner}')">
                <div class="detail-hero-content">
                    <div class="detail-chip-row">
                        <span class="detail-chip">${escapeHtml(event.mode)}</span>
                        <span class="detail-chip light">${escapeHtml(event.category)}</span>
                        <span class="detail-chip success">Registration Open</span>
                    </div>

                    <h1>${escapeHtml(event.title)}</h1>
                    <p class="detail-organizer">Hosted by ${escapeHtml(event.society)}</p>

                    <div class="detail-hero-meta-grid">
                        <div class="detail-hero-meta-item">
                            <span>📍</span>
                            <div>
                                <b>Location</b>
                                <small>${escapeHtml(event.location)}</small>
                            </div>
                        </div>

                        <div class="detail-hero-meta-item">
                            <span>📅</span>
                            <div>
                                <b>Date</b>
                                <small>${escapeHtml(event.eventDate)}</small>
                            </div>
                        </div>

                        <div class="detail-hero-meta-item">
                            <span>👥</span>
                            <div>
                                <b>Team Size</b>
                                <small>${escapeHtml(event.teamSize)}</small>
                            </div>
                        </div>

                        <div class="detail-hero-meta-item">
                            <span>🏆</span>
                            <div>
                                <b>Prize</b>
                                <small>${escapeHtml(event.prize)}</small>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <div class="detail-page-grid">
                <article class="detail-main-card">
                    <nav class="detail-tabs" aria-label="Event detail sections">
                        <a href="#detail-about">Details</a>
                        <a href="#detail-dates">Dates & Deadlines</a>
                        <a href="#detail-prizes">Prizes</a>
                        <a href="#detail-rules">Rules</a>
                        <a href="#detail-faqs">FAQs</a>
                    </nav>

                    <section id="detail-about" class="detail-section-block">
                        <div class="detail-section-heading">
                            <span class="heading-dot"></span>
                            <h2>About the Event</h2>
                        </div>

                        <p class="detail-body-text">${escapeHtml(event.about)}</p>

                        <div class="detail-tag-list">
                            ${event.tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}
                        </div>
                    </section>

                    <section id="detail-dates" class="detail-section-block">
                        <div class="detail-section-heading">
                            <span class="heading-dot"></span>
                            <h2>Dates & Deadlines</h2>
                        </div>

                        <div class="detail-info-grid">
                            <div class="detail-info-card">
                                <small>Registration Deadline</small>
                                <b>${escapeHtml(event.deadline)}</b>
                            </div>

                            <div class="detail-info-card">
                                <small>Event Date</small>
                                <b>${escapeHtml(event.eventDate)}</b>
                            </div>

                            <div class="detail-info-card">
                                <small>Mode</small>
                                <b>${escapeHtml(event.mode)}</b>
                            </div>
                        </div>

                        ${renderList(event.timeline, 'detail-timeline-list')}
                    </section>

                    <section id="detail-prizes" class="detail-section-block">
                        <div class="detail-section-heading">
                            <span class="heading-dot"></span>
                            <h2>Prizes and Perks</h2>
                        </div>

                        <div class="detail-prize-card">
                            <div class="prize-icon">🏆</div>
                            <div>
                                <small>Rewards</small>
                                <b>${escapeHtml(event.prize)}</b>
                            </div>
                        </div>

                        ${renderList(event.perks)}
                    </section>

                    <section id="detail-rules" class="detail-section-block">
                        <div class="detail-section-heading">
                            <span class="heading-dot"></span>
                            <h2>Eligibility & Rules</h2>
                        </div>

                        <p class="detail-body-text">
                            <b>Eligibility:</b> ${escapeHtml(event.eligibility)}
                        </p>

                        ${renderList(event.rules)}
                    </section>

                    <section id="detail-faqs" class="detail-section-block">
                        <div class="detail-section-heading">
                            <span class="heading-dot"></span>
                            <h2>FAQs & Discussions</h2>
                        </div>

                        ${
                            event.faqs.length
                                ? event.faqs.map(faq => `
                                    <details class="detail-faq-item">
                                        <summary>${escapeHtml(faq.question)}</summary>
                                        <p>${escapeHtml(faq.answer)}</p>
                                    </details>
                                `).join('')
                                : '<p class="detail-body-text">No FAQs have been added yet. Contact the organizing team for more details.</p>'
                        }
                    </section>
                </article>

                <aside class="detail-sidebar-card">
                    <div class="detail-deadline-pill">${escapeHtml(statusText)}</div>

                    <div class="detail-welcome-box">
                        <span class="welcome-emoji">👋</span>
                        <div>
                            <b>Hi Welcome!</b>
                            <small>Please register below.</small>
                        </div>
                    </div>

                    <button id="detail-register-btn" class="${buttonClass}" type="button" ${isRegistered ? 'disabled' : ''}>
                        ${buttonText}
                    </button>

                    <div class="detail-registered-count">
                        👥 <span>${escapeHtml(event.registrations)}</span> Registered
                    </div>

                    <div class="detail-side-divider"></div>

                    <div class="detail-side-meta">
                        <span>📅</span>
                        <div>
                            <small>Deadline</small>
                            <b>${escapeHtml(event.deadline)}</b>
                        </div>
                    </div>

                    <div class="detail-side-meta">
                        <span>📍</span>
                        <div>
                            <small>Venue</small>
                            <b>${escapeHtml(event.location)}</b>
                        </div>
                    </div>

                    <div class="detail-side-meta">
                        <span>✉️</span>
                        <div>
                            <small>Contact</small>
                            <b>${escapeHtml(event.contactEmail)}</b>
                        </div>
                    </div>

                    <button id="detail-share-btn" class="detail-secondary-btn" type="button">
                        Share Event
                    </button>

                    ${options.loading ? '<p class="detail-loading-note">Refreshing details from server...</p>' : ''}
                </aside>
            </div>
        </div>
    `;

    const registerBtn = document.getElementById('detail-register-btn');

    if (registerBtn && !isRegistered) {
        registerBtn.addEventListener('click', () => {
            window.executeAwsRegistration(event.eventId);
        });
    }

    const shareBtn = document.getElementById('detail-share-btn');

    if (shareBtn) {
        shareBtn.addEventListener('click', () => {
            window.copyCurrentEventLink(event.eventId);
        });
    }
}

// Process actual RSVP network pipeline out to AWS endpoints
window.executeAwsRegistration = function(eventId) {
    if (!state.currentUser) {
        window.showToast("Please sign in to register for this event!", "error");
        window.switchView('auth-page');
        return;
    }

    const idToken = localStorage.getItem('evntr_id_token');
    const regBtn = document.getElementById('detail-register-btn');
    
    if (regBtn) {
        regBtn.innerText = "Processing...";
        regBtn.disabled = true;
    }

    // 👇 UPDATED: Logs matching the exact keys your AWS Lambda expects
    console.log("Sending RSVP Payload:", { 
        eventId: eventId,
        studentName: state.currentUser.name,
        studentEmail: state.currentUser.email 
    });

    fetch(`${API_BASE_URL}/rsvp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': idToken
        },
        // 👇 FIXED: Changed keys to match your backend validation rules perfectly
        body: JSON.stringify({
            eventId: eventId,
            studentName: state.currentUser.name,
            studentEmail: state.currentUser.email
        })
    })
    .then(async res => {
        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`AWS Server Error (${res.status}): ${errorText}`);
        }
        return res.json();
    })
    .then(() => {
        window.showToast("Registration Confirmed! Slot secured.", "success");
        state.rsvps.push(eventId);
        renderRsvps();
        
        if (regBtn) {
            regBtn.innerText = "Registered ✓";
            regBtn.style.background = "#10b981";
            regBtn.disabled = true;
            regBtn.onclick = null;
        }
    })
    .catch(err => {
        console.error("🔴 AWS Sync Detailed Failure:", err.message);
        window.showToast("Could not complete registration. Try again.", "error");
        if (regBtn) {
            regBtn.innerText = "Register Now";
            regBtn.disabled = false;
        }
    });
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

// Unified Submission Interceptor
window.handleAuthWorkflowSubmit = function(e) {
    e.preventDefault();
    
    const email = document.getElementById('auth-core-email').value.trim();
    const password = document.getElementById('auth-core-password').value;

    if (state.currentAuthMode === 'register') {
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
        window.showToast("Verifying credentials database...", "success");
        
        const authDetails = new AuthenticationDetails({ Username: email, Password: password });
        const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });

        cognitoUser.authenticateUser(authDetails, {
            onSuccess: (result) => {
                localStorage.setItem('evntr_id_token', result.getIdToken().getJwtToken());
                localStorage.setItem('evntr_access_token', result.getAccessToken().getJwtToken());
                
                window.showToast("Welcome back! Access granted.", "success");
                
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
                            email: userProfile['email'] || cognitoUser.getUsername(), // FIXED: Pulls true email string instead of UUID string
                            role: userProfile['custom:role'] || 'Student',
                            branch: userProfile['custom:branch'] || 'CSE',
                            year: userProfile['custom:year'] || '2026'
                        };
                    }
                    
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

// Injects profile layout badges
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

// Template builder for the event dashboard cards with accurate tracking event loops
function renderAllOpportunities() {
  const allGrid = document.getElementById('opportunities-root');
  if (!allGrid) return;
  
  let allHtml = '';

  const dataset = state.opportunities.length > 0 ? state.opportunities : [
    {
      eventId: "evt_01",
      title: "Innerve Hackathon 2026",
      society: "ACM Student Chapter",
      category: "Technical",
      eventDate: "Oct 14th - Oct 16th, 2026",
      registrations: 432
    },
    {
      eventId: "evt_02",
      title: "Taarangana Street Showdown",
      society: "Hypnotics Society",
      category: "Cultural",
      eventDate: "Nov 02, 2026",
      registrations: 189
    }
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

          <p style="font-size:0.8rem; margin:0.5rem 0;">
            Date: ${opp.eventDate || '2026'}
          </p>

          <div class="card-footer">
            <span class="registrations-count">${opp.registrations || 0} Registered</span>

            <button class="btn-card-action" onclick="window.openEventDetails('${currentId}')">
              View details
            </button>
          </div>
        </div>
      </div>
    `;
  });

  allGrid.innerHTML = allHtml;
}

// Render active items directly to left panel drawers
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