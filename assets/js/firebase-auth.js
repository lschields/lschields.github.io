// Firebase auth + realtime checkbox sync, shared by all 4 pages.
//
// This is the ONLY page that talks to Firebase directly. It exposes
// window.tdAuth for the page-specific scripts (app.js, trends.js,
// exercises.js, workouts.js) to use:
//
//   await window.tdAuth.requireAuth()   - shows a sign-in overlay and blocks
//                                          until someone is signed in. Every
//                                          page's init() should await this
//                                          before loading/rendering anything.
//   window.tdAuth.watchCheckins(fn)     - attaches a live listener on the
//                                          shared checkbox-completion data.
//                                          Resolves once on the first
//                                          snapshot; calls fn() on every
//                                          snapshot after that (including
//                                          changes made from another device).
//   window.tdAuth.isCheckedIn(key)      - reads current state for a key.
//   window.tdAuth.setCheckin(key, bool) - writes new state for a key.
//   window.tdAuth.initSignOut()         - wires up a #sign-out button if the
//                                          page has one.
//
// Single-user site: sign-in is plain email/password, no public sign-up UI.
// The one account is created directly in the Firebase console - see
// docs/firebase-setup.md. Data access is controlled by the Realtime
// Database security rules (auth != null required for all read/write - see
// database.rules.json), not by hiding this config, so it's fine for
// firebaseConfig below to be public.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getDatabase, ref, onValue, set, remove,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

// --- Fill these in from the Firebase console: Project settings (gear icon)
// -> General -> Your apps -> SDK setup and configuration -> Config. ---
const firebaseConfig = {
  apiKey: "AIzaSyDuaXoD_R_OVE008XH3hFxq3vX3rf7GrXw",
  authDomain: "training-dashboard-eff4b.firebaseapp.com",
  databaseURL: "https://training-dashboard-eff4b-default-rtdb.firebaseio.com",
  projectId: "training-dashboard-eff4b",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});

// Realtime Database keys can't contain . # $ [ ] - session titles won't
// normally hit these, but sanitize defensively rather than risk a silent
// write failure.
function fbKey(key) {
  return key.replace(/[.#$[\]]/g, "_");
}

// ---------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------
function buildGateOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "auth-gate";
  overlay.innerHTML = `
    <form class="auth-card">
      <div class="auth-title">Training Dashboard</div>
      <div class="auth-sub">Sign in to continue</div>
      <input type="email" name="email" placeholder="Email" autocomplete="username" required>
      <input type="password" name="password" placeholder="Password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
      <div class="auth-error"></div>
    </form>`;
  return overlay;
}

function requireAuth() {
  return new Promise((resolve) => {
    let overlay = null;
    let settled = false;

    onAuthStateChanged(auth, (user) => {
      if (user) {
        if (overlay) overlay.remove();
        if (!settled) { settled = true; resolve(user); }
      } else if (!overlay) {
        overlay = buildGateOverlay();
        document.body.appendChild(overlay);
        const form = overlay.querySelector("form");
        const errorEl = overlay.querySelector(".auth-error");
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          errorEl.textContent = "";
          const btn = form.querySelector("button[type=submit]");
          btn.disabled = true;
          btn.textContent = "Signing in…";
          try {
            await signInWithEmailAndPassword(auth, form.email.value.trim(), form.password.value);
          } catch (err) {
            errorEl.textContent = "Wrong email or password.";
          } finally {
            btn.disabled = false;
            btn.textContent = "Sign in";
          }
        });
      }
    });
  });
}

function initSignOut() {
  const btn = document.getElementById("sign-out");
  if (!btn) return;
  btn.addEventListener("click", () => signOut(auth));
}

// ---------------------------------------------------------------------
// Realtime checkbox sync
// ---------------------------------------------------------------------
const checkinsState = {};

function watchCheckins(onRemoteChange) {
  return new Promise((resolveFirst) => {
    let first = true;
    onValue(ref(db, "checkins"), (snap) => {
      const val = snap.val() || {};
      Object.keys(checkinsState).forEach((k) => delete checkinsState[k]);
      Object.assign(checkinsState, val);
      if (first) {
        first = false;
        resolveFirst();
      } else {
        onRemoteChange();
      }
    });
  });
}

function isCheckedIn(key) {
  return !!checkinsState[fbKey(key)];
}

function setCheckin(key, done) {
  const k = fbKey(key);
  if (done) {
    checkinsState[k] = true;
    set(ref(db, "checkins/" + k), true);
  } else {
    delete checkinsState[k];
    remove(ref(db, "checkins/" + k));
  }
}

window.tdAuth = { requireAuth, initSignOut, watchCheckins, isCheckedIn, setCheckin, checkinsState };
window.dispatchEvent(new CustomEvent("tdAuthReady"));
