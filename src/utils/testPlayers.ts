import { User } from 'firebase/auth';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import {
  DropInMatch,
  GoalieOption,
  PlayerProfile,
  PlayerRating,
} from '../types';
import { calculateAgeFromDob } from './clubUtils';

export const TEST_PLAYERS_DISMISSED_KEY = 'vancity_test_players_dismissed';

export interface TestPlayerSeed {
  uid: string;
  firstName: string;
  lastName: string;
  dob: string;
  email: string;
  phone: string;
  emergencyContact: string;
  favoritePositions: [string, string, string];
  skill: number;
  stamina: number;
  assessedPositions: string[];
  notes: string;
  defaultGoalieOption: GoalieOption;
}

export const TEST_PLAYER_SEEDS: TestPlayerSeed[] = [
  {
    uid: 'test_player_1',
    firstName: 'Liam',
    lastName: "O'Connor",
    dob: '1997-04-12',
    email: 'liam.oconnor.test@vancitypitch.ca',
    phone: '604-555-0101',
    emergencyContact: '604-555-0201',
    favoritePositions: ['GK', 'CB', 'CDM'],
    skill: 80,
    stamina: 70,
    assessedPositions: ['GK', 'CB'],
    notes: 'Confident shot-stopper and vocal organizer from the back.',
    defaultGoalieOption: 'only_goalie',
  },
  {
    uid: 'test_player_2',
    firstName: 'Mateo',
    lastName: 'Silva',
    dob: '2002-08-19',
    email: 'mateo.silva.test@vancitypitch.ca',
    phone: '604-555-0102',
    emergencyContact: '604-555-0202',
    favoritePositions: ['CB', 'LB', 'CDM'],
    skill: 75,
    stamina: 80,
    assessedPositions: ['CB', 'LB'],
    notes: 'Strong 1v1 defender, willing to rotate into goal when needed.',
    defaultGoalieOption: 'willing',
  },
  {
    uid: 'test_player_3',
    firstName: 'Noah',
    lastName: 'Takahashi',
    dob: '1995-02-03',
    email: 'noah.takahashi.test@vancitypitch.ca',
    phone: '604-555-0103',
    emergencyContact: '604-555-0203',
    favoritePositions: ['RB', 'CB', 'RM'],
    skill: 70,
    stamina: 85,
    assessedPositions: ['RB', 'RM'],
    notes: 'Tireless overlap runner on the right flank.',
    defaultGoalieOption: 'none',
  },
  {
    uid: 'test_player_4',
    firstName: 'Devon',
    lastName: 'Brooks',
    dob: '2000-11-25',
    email: 'devon.brooks.test@vancitypitch.ca',
    phone: '604-555-0104',
    emergencyContact: '604-555-0204',
    favoritePositions: ['LB', 'LW', 'LM'],
    skill: 80,
    stamina: 85,
    assessedPositions: ['LB', 'LW'],
    notes: 'Left-footed wide player with good recovery speed.',
    defaultGoalieOption: 'none',
  },
  {
    uid: 'test_player_5',
    firstName: 'Tariq',
    lastName: 'Al-Mansoor',
    dob: '1998-06-14',
    email: 'tariq.almansoor.test@vancitypitch.ca',
    phone: '604-555-0105',
    emergencyContact: '604-555-0205',
    favoritePositions: ['CDM', 'CM', 'CB'],
    skill: 85,
    stamina: 80,
    assessedPositions: ['CDM', 'CM'],
    notes: 'Calm under press, breaks up counters and recycles possession.',
    defaultGoalieOption: 'none',
  },
  {
    uid: 'test_player_6',
    firstName: 'Lucas',
    lastName: 'Bernard',
    dob: '2004-01-30',
    email: 'lucas.bernard.test@vancitypitch.ca',
    phone: '604-555-0106',
    emergencyContact: '604-555-0206',
    favoritePositions: ['CM', 'CAM', 'RM'],
    skill: 90,
    stamina: 85,
    assessedPositions: ['CM', 'CAM'],
    notes: 'High-tempo playmaker with sharp through-balls.',
    defaultGoalieOption: 'none',
  },
  {
    uid: 'test_player_7',
    firstName: 'Soren',
    lastName: 'Lindqvist',
    dob: '1992-09-07',
    email: 'soren.lindqvist.test@vancitypitch.ca',
    phone: '604-555-0107',
    emergencyContact: '604-555-0207',
    favoritePositions: ['CM', 'CDM', 'GK'],
    skill: 70,
    stamina: 65,
    assessedPositions: ['CM', 'GK'],
    notes: 'Experienced organizer who happily covers goalie rotations.',
    defaultGoalieOption: 'willing',
  },
  {
    uid: 'test_player_8',
    firstName: 'Rafael',
    lastName: 'Costa',
    dob: '2001-05-22',
    email: 'rafael.costa.test@vancitypitch.ca',
    phone: '604-555-0108',
    emergencyContact: '604-555-0208',
    favoritePositions: ['RW', 'LW', 'ST'],
    skill: 85,
    stamina: 90,
    assessedPositions: ['RW', 'ST'],
    notes: 'Direct winger who presses high all match.',
    defaultGoalieOption: 'none',
  },
  {
    uid: 'test_player_9',
    firstName: 'Ethan',
    lastName: 'Kowalski',
    dob: '1999-12-09',
    email: 'ethan.kowalski.test@vancitypitch.ca',
    phone: '604-555-0109',
    emergencyContact: '604-555-0209',
    favoritePositions: ['ST', 'CAM', 'LW'],
    skill: 80,
    stamina: 75,
    assessedPositions: ['ST', 'CAM'],
    notes: 'Clinical finisher with smart movement in the box.',
    defaultGoalieOption: 'none',
  },
];

export function isTestPlayerUid(uid: string): boolean {
  return uid.startsWith('test_player_');
}

export async function seedTestPlayers(
  adminUser: User,
  managerProfile: PlayerProfile
): Promise<void> {
  const profileBatch = writeBatch(db);

  for (const seed of TEST_PLAYER_SEEDS) {
    profileBatch.set(doc(db, 'players', seed.uid), {
      uid: seed.uid,
      firstName: seed.firstName,
      lastName: seed.lastName,
      age: calculateAgeFromDob(seed.dob),
      favoritePositions: seed.favoritePositions,
      photoStatus: 'approved',
      approvedPhotoUrl: '',
      role: 'player',
      appearances: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    profileBatch.set(doc(db, 'player_private', seed.uid), {
      uid: seed.uid,
      email: seed.email,
      dob: seed.dob,
      phone: seed.phone,
      emergencyContact: seed.emergencyContact,
      updatedAt: serverTimestamp(),
    });
  }

  await profileBatch.commit();

  // Commit initial manager scouting ratings in a second batch so exists(players/{id}) succeeds
  const ratingsBatch = writeBatch(db);
  const clampStat = (n: number) => Math.max(25, Math.min(98, Math.round(n)));
  for (const seed of TEST_PLAYER_SEEDS) {
    const ratingId = `${seed.uid}_${adminUser.uid}`;
    const pos = seed.assessedPositions[0] || 'CM';
    const isAtt = ['ST', 'LW', 'RW', 'CAM'].includes(pos);
    const isDef = ['CB', 'LB', 'RB', 'CDM', 'GK'].includes(pos);
    const isWide = ['LW', 'RW', 'LB', 'RB', 'LM', 'RM'].includes(pos);

    ratingsBatch.set(doc(db, 'player_ratings', ratingId), {
      playerId: seed.uid,
      managerId: adminUser.uid,
      managerName: `${managerProfile.firstName} ${managerProfile.lastName}`,
      skill: seed.skill,
      overall: seed.skill,
      attack: clampStat(seed.skill + (isAtt ? 7 : isDef ? -10 : 1)),
      technique: clampStat(seed.skill + (pos === 'GK' ? -8 : 3)),
      stamina: seed.stamina,
      defense: clampStat(seed.skill + (isDef ? 8 : isAtt ? -12 : 2)),
      speed: clampStat((seed.skill + seed.stamina) / 2 + (isWide ? 6 : pos === 'GK' ? -10 : -1)),
      physics: clampStat(seed.skill + (pos === 'CB' || pos === 'ST' || pos === 'CDM' ? 6 : -3)),
      assessedPositions: seed.assessedPositions,
      notes: seed.notes,
      updatedAt: serverTimestamp(),
    });
  }

  await ratingsBatch.commit();
  localStorage.removeItem(TEST_PLAYERS_DISMISSED_KEY);
}

export async function removeAllTestPlayers(
  players: PlayerProfile[],
  ratings: PlayerRating[],
  matches: DropInMatch[]
): Promise<number> {
  const testUids = new Set<string>(TEST_PLAYER_SEEDS.map((s) => s.uid));
  for (const p of players) {
    if (isTestPlayerUid(p.uid)) testUids.add(p.uid);
  }

  const batch = writeBatch(db);
  for (const uid of testUids) {
    batch.delete(doc(db, 'players', uid));
    batch.delete(doc(db, 'player_private', uid));
    for (const m of matches) {
      batch.delete(doc(db, 'matches', m.id, 'votes', uid));
    }
  }

  for (const r of ratings) {
    if (testUids.has(r.playerId)) {
      batch.delete(doc(db, 'player_ratings', r.id));
    }
  }

  await batch.commit();
  localStorage.setItem(TEST_PLAYERS_DISMISSED_KEY, 'true');
  return testUids.size;
}

export async function voteForTestPlayers(
  matchId: string,
  players: PlayerProfile[]
): Promise<number> {
  const seedByUid = new Map(TEST_PLAYER_SEEDS.map((s) => [s.uid, s]));
  const activeTestPlayers = players.filter((p) => isTestPlayerUid(p.uid));
  if (activeTestPlayers.length === 0) return 0;

  const batch = writeBatch(db);
  for (const p of activeTestPlayers) {
    const seed = seedByUid.get(p.uid);
    batch.set(doc(db, 'matches', matchId, 'votes', p.uid), {
      uid: p.uid,
      matchId,
      attending: true,
      goalieOption: seed?.defaultGoalieOption || 'none',
      playerName: `${p.firstName} ${p.lastName}`,
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
  return activeTestPlayers.length;
}
