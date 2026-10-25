import { SYNC_MASTER_KEYS } from '../constants';
import { JsonValue, SyncBundle, SyncKey } from '../models';

type JsonObject = Record<string, JsonValue>;

interface DoneRecord extends JsonObject {
  id: string;
  done: boolean;
}

interface DatedRecord extends DoneRecord {
  date: string;
}

function movedFromOf(record: DatedRecord): string | undefined {
  const origin = record['movedFrom'];
  return typeof origin === 'string' ? origin : undefined;
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDoneRecord(value: JsonValue): value is DoneRecord {
  return isObject(value) && typeof value['id'] === 'string' && typeof value['done'] === 'boolean';
}

function isDatedRecord(value: JsonValue): value is DatedRecord {
  return (
    isDoneRecord(value) &&
    typeof value['date'] === 'string' &&
    (value['movedFrom'] === undefined || typeof value['movedFrom'] === 'string')
  );
}

function doneRecords(value: JsonValue | undefined): DoneRecord[] | undefined {
  return Array.isArray(value) && value.every(isDoneRecord) ? value : undefined;
}

function datedRecords(value: JsonValue | undefined): DatedRecord[] | undefined {
  return Array.isArray(value) && value.every(isDatedRecord) ? value : undefined;
}

function withLocalDone<T extends DoneRecord>(remote: T[], local: DoneRecord[]): T[] {
  const marks = new Map(local.map((record) => [record.id, record.done]));
  return remote.map((record) => {
    const done = marks.get(record.id);
    return done === undefined ? record : { ...record, done };
  });
}

function withLocalMoves(remote: DatedRecord[], local: DatedRecord[]): DatedRecord[] {
  const moves = new Map(
    local
      .filter((record) => movedFromOf(record) !== undefined)
      .map((record) => [record.id, record]),
  );
  return remote.map((record) => {
    const moved = moves.get(record.id);
    const origin = moved ? movedFromOf(moved) : undefined;
    if (!moved || origin !== record.date) {
      return record;
    }
    return { ...record, date: moved.date, movedFrom: origin };
  });
}

function mergeCalendar(
  remote: JsonValue | undefined,
  local: JsonValue | undefined,
): JsonValue | undefined {
  if (!isObject(remote) || !isObject(local)) {
    return remote ?? local;
  }
  const remoteItems = datedRecords(remote['items']);
  const localItems = datedRecords(local['items']);
  if (!remoteItems || !localItems) {
    return remote;
  }
  return { ...remote, items: withLocalMoves(withLocalDone(remoteItems, localItems), localItems) };
}

function mergeRecommendations(
  remote: JsonValue | undefined,
  local: JsonValue | undefined,
): JsonValue | undefined {
  const remoteList = doneRecords(remote);
  const localList = doneRecords(local);
  if (!remoteList || !localList) {
    return remote ?? local;
  }
  return withLocalDone(remoteList, localList);
}

export function mergeBundles(remote: SyncBundle, local: SyncBundle): SyncBundle {
  const merged: SyncBundle = { ...local, ...remote };
  for (const key of SYNC_MASTER_KEYS) {
    if (local[key] !== undefined) {
      merged[key] = local[key];
    }
  }
  const calendar = mergeCalendar(remote.calendar, local.calendar);
  const recommendations = mergeRecommendations(remote.recommendations, local.recommendations);
  assign(merged, 'calendar', calendar);
  assign(merged, 'recommendations', recommendations);
  return merged;
}

function assign(bundle: SyncBundle, key: SyncKey, value: JsonValue | undefined): void {
  if (value === undefined) {
    delete bundle[key];
  } else {
    bundle[key] = value;
  }
}
