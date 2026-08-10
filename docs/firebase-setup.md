# Firebase setup (one-time)

This site now needs a small Firebase project for two things: (1) syncing your
PT/prehab checkbox completion across devices, and (2) password-protecting the
whole site. Firebase can't be set up by Claude directly - it requires your
Google account - so these steps are for you to run once. Should take about
10 minutes. Once done, send Claude the config values from step 3 and the
email/password you created in step 5, and the code will be wired up and
committed.

## 1. Create the project
1. Go to https://console.firebase.google.com and sign in with your Google
   account.
2. Click **Add project**. Name it anything (e.g. `training-dashboard`).
3. You can decline Google Analytics for this project (not needed).
4. Wait for it to finish provisioning, then continue into the project.

No billing information is required - everything here stays on Firebase's
free "Spark" plan, which is far more than this app will ever use.

## 2. Enable the Realtime Database
1. In the left sidebar, go to **Build > Realtime Database**.
2. Click **Create Database**.
3. Pick any location (doesn't matter for this use case).
4. Start in **locked mode** (you'll paste real rules in step 4 below).

## 3. Enable Authentication
1. In the left sidebar, go to **Build > Authentication**.
2. Click **Get started**.
3. Under **Sign-in method**, enable the **Email/Password** provider (toggle
   it on, save). Leave "Email link" off - just the plain Email/Password
   toggle.

## 4. Add yourself as the one user
1. Still in **Authentication**, go to the **Users** tab.
2. Click **Add user**.
3. Enter the email and password you want to sign in with on the dashboard.
   This does not need to be a real inbox - it's just your login for this
   site. Pick something you'll remember (a password manager entry is a good
   idea, since this password protects your training data).

There's deliberately no public "sign up" page on the site - this is the only
way an account gets created, so nobody else can register themselves.

## 5. Apply the security rules
1. Back in **Realtime Database**, go to the **Rules** tab.
2. Replace the contents with what's in this repo's `database.rules.json`:
   ```json
   {
     "rules": {
       ".read": "auth != null",
       ".write": "auth != null"
     }
   }
   ```
3. Click **Publish**.

This means only someone signed in (i.e. you) can read or write anything in
the database - no public access at all.

## 6. Get your config values
1. Click the gear icon next to **Project Overview** > **Project settings**.
2. Scroll to **Your apps**. Click the **</>** (web) icon to register a new
   web app (nickname doesn't matter, no Firebase Hosting needed - just
   register it).
3. You'll see a `firebaseConfig` object like:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "training-dashboard-xxxxx.firebaseapp.com",
     databaseURL: "https://training-dashboard-xxxxx-default-rtdb.firebaseio.com",
     projectId: "training-dashboard-xxxxx",
     ...
   };
   ```
4. Send Claude these four values (`apiKey`, `authDomain`, `databaseURL`,
   `projectId`) - they get pasted into `assets/js/firebase-auth.js`. These
   values are not secret (they just identify which project to talk to);
   real access control comes from the rules in step 5 and the login in
   step 4.

## What this doesn't do
- It doesn't touch `data/plan.json` / `data/history.json` - those still come
  from git, updated via the weekly Garmin chat workflow, same as always.
- It's a single login for you only. If you ever want to share the site with
  someone else (a coach, a training partner), that's a separate step - ask
  and it can be added.
