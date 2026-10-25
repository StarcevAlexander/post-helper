import { SYNC_MASTER_KEYS } from '../constants';
import { JsonValue, SyncBundle, SyncKey } from '../models';

type JsonObject = { [key: string]: JsonValue };

interface DoneRecord extends JsonObject {
  id: string;
  done: boolean;
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDoneRecord(value: JsonValue): value is DoneRecord {
  return isObject(value) && typeof value['id'] === 'string' && typeof value['done'] === 'boolean';
}

function doneRecords(value: JsonValue | undefined): DoneRecord[] | undefined {
  return Array.isArray(value) && value.every(isDoneRecord) ? value : undefined;
}

function withLocalDone(remote: DoneRecord[], local: DoneRecord[]): DoneRecord[] {
  const marks = new Map(local.map((record) => [record.id, record.done]));
  return remote.map((record) => {
    const done = marks.get(record.id);
    return done === undefined ? record : { ...record, done };
  });
}

function mergeCalendar(
  remote: JsonValue | undefined,
  local: JsonValue | undefined,
): JsonValue | undefined {
  if (!isObject(remote) || !isObject(local)) {
    return remote ?? local;
  }
  const remoteItems = doneRecords(remote['items']);
  const localItems = doneRecords(local['items']);
  if (!remoteItems || !localItems) {
    return remote;
  }
  return { ...remote, items: withLocalDone(remoteItems, localItems) };
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
