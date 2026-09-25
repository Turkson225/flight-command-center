import { onValue, ref, remove, serverTimestamp, set, update, type Database } from 'firebase/database';
import { parseMissionJson, sealMission, type MissionDocument } from './missionPlanner';

export type MissionAckStatus = 'received' | 'stored' | 'validated' | 'rejected';

export interface MissionAcknowledgement {
  missionId: string;
  revision: number;
  checksum: string;
  status: MissionAckStatus;
  acknowledgedAt: number;
  detail: string;
  currentWaypointIndex: number | null;
}

export interface MissionTransferState {
  requestId: string | null;
  requestedAt: number | null;
  missionId: string | null;
  revision: number | null;
  checksum: string | null;
  nodeMcu: MissionAcknowledgement | null;
  nano: MissionAcknowledgement | null;
}

export type MissionCloudStatus = 'connecting' | 'ready' | 'empty' | 'denied' | 'unavailable';

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function safeId(value: string, label: string, max = 128) {
  if (value.length > max || !SAFE_ID.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

export function missionLibraryPath(userId: string, aircraftId: string) {
  return `missionLibraries/${safeId(userId, 'user ID')}/${safeId(aircraftId, 'aircraft ID', 40)}`;
}

export function missionTransferPath(aircraftId: string) {
  return `aircraft/${safeId(aircraftId, 'aircraft ID', 40)}/missionTransfer`;
}

function cloudMessage(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code).toLowerCase() : '';
  return code.includes('permission') ? 'Firebase denied mission access.' : 'Firebase mission storage is unavailable.';
}

export function subscribeMissionLibrary(
  database: Database,
  userId: string,
  aircraftId: string,
  onUpdate: (missions: MissionDocument[], status: MissionCloudStatus, message: string) => void,
) {
  onUpdate([], 'connecting', 'Connecting to Firebase mission library.');
  return onValue(ref(database, missionLibraryPath(userId, aircraftId)), snapshot => {
    if (!snapshot.exists()) {
      onUpdate([], 'empty', 'No missions saved for this aircraft.');
      return;
    }
    const raw = snapshot.val();
    const missions = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? Object.values(raw).flatMap(value => {
        const parsed = parseMissionJson(JSON.stringify(value));
        return parsed.ok ? [parsed.mission] : [];
      }).sort((a, b) => b.updatedAt - a.updatedAt)
      : [];
    onUpdate(missions, 'ready', missions.length ? `${missions.length} mission${missions.length === 1 ? '' : 's'} available.` : 'No valid missions found.');
  }, error => {
    const message = cloudMessage(error);
    onUpdate([], message.includes('denied') ? 'denied' : 'unavailable', message);
  });
}

export async function saveMission(database: Database, userId: string, mission: MissionDocument) {
  const saved = sealMission(mission);
  const path = `${missionLibraryPath(userId, saved.aircraftId)}/${safeId(saved.id, 'mission ID', 64)}`;
  await set(ref(database, path), { ...saved, updatedAt: serverTimestamp() });
  return saved;
}

export async function deleteMission(database: Database, userId: string, mission: MissionDocument) {
  await remove(ref(database, `${missionLibraryPath(userId, mission.aircraftId)}/${safeId(mission.id, 'mission ID', 64)}`));
}

export async function stageMission(database: Database, userId: string, mission: MissionDocument) {
  const staged = sealMission(mission);
  const rootPath = missionTransferPath(staged.aircraftId);
  const requestId = `transfer-${Date.now().toString(36)}`;
  await update(ref(database), {
    [`${rootPath}/pending`]: {
      schemaVersion: 1,
      requestId,
      requestedAt: serverTimestamp(),
      requestedBy: userId,
      mission: { ...staged, updatedAt: serverTimestamp() },
    },
    [`${rootPath}/acknowledgements`]: null,
  });
  return { mission: staged, requestId };
}

function acknowledgement(value: unknown): MissionAcknowledgement | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.missionId !== 'string' || !Number.isSafeInteger(item.revision) ||
      typeof item.checksum !== 'string' || !['received', 'stored', 'validated', 'rejected'].includes(String(item.status)) ||
      typeof item.acknowledgedAt !== 'number' || !Number.isFinite(item.acknowledgedAt)) return null;
  return {
    missionId: item.missionId,
    revision: item.revision as number,
    checksum: item.checksum,
    status: item.status as MissionAckStatus,
    acknowledgedAt: item.acknowledgedAt,
    detail: typeof item.detail === 'string' ? item.detail.slice(0, 160) : '',
    currentWaypointIndex: Number.isSafeInteger(item.currentWaypointIndex) && Number(item.currentWaypointIndex) >= 0 && Number(item.currentWaypointIndex) < 25 ? item.currentWaypointIndex as number : null,
  };
}

export function subscribeMissionTransfer(
  database: Database,
  aircraftId: string,
  onUpdate: (state: MissionTransferState) => void,
) {
  return onValue(ref(database, missionTransferPath(aircraftId)), snapshot => {
    const value = snapshot.val();
    const object = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const pending = object.pending && typeof object.pending === 'object' && !Array.isArray(object.pending) ? object.pending as Record<string, unknown> : {};
    const mission = pending.mission && typeof pending.mission === 'object' && !Array.isArray(pending.mission) ? pending.mission as Record<string, unknown> : {};
    const acknowledgements = object.acknowledgements && typeof object.acknowledgements === 'object' && !Array.isArray(object.acknowledgements) ? object.acknowledgements as Record<string, unknown> : {};
    onUpdate({
      requestId: typeof pending.requestId === 'string' ? pending.requestId : null,
      requestedAt: typeof pending.requestedAt === 'number' ? pending.requestedAt : null,
      missionId: typeof mission.id === 'string' ? mission.id : null,
      revision: Number.isSafeInteger(mission.revision) ? mission.revision as number : null,
      checksum: typeof mission.checksum === 'string' ? mission.checksum : null,
      nodeMcu: acknowledgement(acknowledgements.nodeMcu),
      nano: acknowledgement(acknowledgements.nano),
    });
  }, () => onUpdate({ requestId: null, requestedAt: null, missionId: null, revision: null, checksum: null, nodeMcu: null, nano: null }));
}
