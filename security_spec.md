# Firestore Security Specification — Vancouver Drop-In Club

## 1. Data Invariants
1. **PII Isolation**: Email, DOB, phone, and emergency contact numbers live exclusively in `player_private/{uid}` and are readable only by the owning user, managers, and admins. `players/{uid}` contains zero PII.
2. **Role Authority**: `admin` and `manager` permissions are verified strictly via `/admins/{uid}`, `/managers/{uid}`, or verified runtime bootstrapped email (`mohsenghodrat2@gmail.com` with `email_verified == true`), never from client-supplied `players/{uid}.role` strings.
3. **Self-Role Escalation Prevention**: A user creating their own `players/{uid}` document cannot set `role != 'player'`, `photoStatus == 'approved'`, or `appearances != 0`.
4. **Photo Approval Gate**: Only admins may approve/reject photos and write `approvedPhotoUrl` into `players/{uid}`.
5. **Manager Evaluation Isolation**: Individual manager ratings in `player_ratings/{ratingId}` are readable and writable only by verified managers and admins, never by regular players.
6. **Master Gate Voting**: A player can only cast, modify, or delete a vote in `matches/{matchId}/votes/{uid}` when the parent `matches/{matchId}` document exists and its `status == 'open'` (unless overridden by manager/admin).
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
