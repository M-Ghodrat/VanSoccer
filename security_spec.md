# Firestore Security Specification — Vancouver Drop-In Club

## 1. Data Invariants
1. **PII Isolation**: Email, DOB, phone, and emergency contact numbers live exclusively in `player_private/{uid}` and are readable only by the owning user and admins. Approved members can read roster fields such as name, age, and approved photo.
2. **Role Authority**: `admin` and `manager` permissions are verified strictly via `/admins/{uid}`, `/managers/{uid}`, or verified runtime bootstrapped email (`mohsenghodrat2@gmail.com` with `email_verified == true`), never from client-supplied `players/{uid}.role` strings.
3. **Self-Role Escalation Prevention**: A user creating their own `players/{uid}` document cannot set `role != 'player'`, `photoStatus == 'approved'`, or `appearances != 0`.
4. **Photo Approval Gate**: Only admins may approve/reject photos and write `approvedPhotoUrl` into `players/{uid}`.
5. **Manager Evaluation Isolation**: Individual manager ratings in `player_ratings/{ratingId}` are readable and writable only by verified managers and admins, never by regular players.
6. **Master Gate Voting**: Players submit RSVPs through the attendance function. The function enforces approved membership, an open poll for joining, payment eligibility, and a kickoff cutoff. Staff retain manual roster controls.
7. **Terminal State Locking**: Once `matches/{matchId}.status == 'completed'`, non-admin writes to the match document are blocked.
8. **Temporal Integrity**: All `createdAt`, `updatedAt`, and `submittedAt` timestamps must equal `request.time`.

## 2. "Dirty Dozen" Adversarial Payloads
1. **Privilege Escalation on Signup**: Player creates `players/{uid}` with `role: "admin"` -> **DENIED**.
2. **Self-Approved Avatar Bypass**: Player updates `players/{uid}` setting `photoStatus: "approved"` -> **DENIED**.
3. **Ghost Field Shadow Update**: Player updates `players/{uid}` adding `isCaptain: true` -> **DENIED**.
4. **PII Blanket Read**: Player A tries `get` or `list` on `player_private/{playerB}` -> **DENIED**.
5. **Unverified Email Write**: Newly registered user with `email_verified: false` tries to create `players/{uid}` -> **DENIED**.
6. **Email Spoof Attack**: User with `email: "mohsenghodrat2@gmail.com"` and `email_verified: false` tries to read `player_ratings` -> **DENIED**.
7. **Post-Lock Vote Injection**: Player tries to create `matches/{matchId}/votes/{uid}` when `matches/{matchId}.status == "locked"` -> **DENIED**.
8. **Vote Impersonation**: Player A tries to write `matches/{matchId}/votes/{playerB}` -> **DENIED**.
9. **Rating Tampering by Player**: Player tries to create/read `player_ratings/{ratingId}` -> **DENIED**.
10. **Completed Match Alteration**: Manager tries to update `matches/{matchId}` after `status == "completed"` -> **DENIED**.
11. **1MB Payload / ID Poisoning**: Attacker creates doc with 500-char ID or 500KB string in `firstName` -> **DENIED**.
12. **Fake Timestamp Backdating**: User submits `createdAt` from last year instead of `request.time` -> **DENIED**.

## Launch deployment

- Use Node 24.12 or later and `npm ci`. Netlify builds the app and runs the scheduled completion function every five minutes on the published production deploy.
- Set `FIREBASE_SERVICE_ACCOUNT_JSON` in the Netlify Functions environment using a dedicated Firebase service account for the project in `firebase-applet-config.json`. It needs permission to verify Firebase Authentication users and read and write the named Firestore database. Keep the credentials out of Git and browser-exposed variables. Use a separate Firebase project for staging and preview tests.
- The previous release wrote player RSVPs directly. Publish the client, functions, and Firestore rules together during a maintenance window and have players reload. The new attendance function checks the time, the player's approval, and the canonical payment record (`payments/{uid}_{YYYY-MM}` using Vancouver time). Players can withdraw until kickoff. Managers retain manual roster controls.
- Existing regular players require an admin to select **Approve member** in the Admin roster. A player can complete their own profile before approval. Managers and admins retain access through their role grants. Review the pending roster and approve your existing players before inviting them back.
- Run `npm exec -- tsx scripts/migrate-private-businesses.ts` with Firebase credentials to count legacy private business entries still stored in member-visible profiles. Run it with `--apply` to move them into owner/admin-only documents. Run the migration during rollout and check that the dry run returns zero. New business changes split private and promoted entries automatically.
- Individual rating documents are staff-only. Player Cards remain visible to players with match history and without individual staff rating data.
- AI formations default to disabled. Enable `ENABLE_AI_FORMATIONS=true` only after checking Gemini eligibility for the club and configuring billing and `GEMINI_API_KEY`. The manual team builder is available with AI disabled.
- Self-service account deletion removes profile, business, and membership documents. Historical matches, ratings and payment entries are retained. The deletion flow surfaces an Auth deletion failure after profile cleanup so it can be followed up.
