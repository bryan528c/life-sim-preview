import { nextYearMoment } from '../src/game/year-flow.mjs';
// Monotonic, in-memory wall time between persisted simulation moments.
// A new life, year, or decision stage starts a fresh interval; version is not time.
export function playbackStage(life) {
  return life ? JSON.stringify([life.lifeId, life.age, life.year, life.pending?.id ?? null, life.flags?.yearFlow?.month??0]) : null;
}
export function playbackIntervalMs(life,yearMs) {
  return life?.pending?yearMs:Math.max(1,yearMs*(nextYearMoment(life)?.months??12)/12);
}

const integrityErrors = new Set(['invalid_input', 'invalid_transition', 'wrong_life', 'id_conflict', 'command_limit']);
export function shouldStopPlayback(result, automated = false) {
  return automated ? !result.ok || result.noOp === true : !result.ok && integrityErrors.has(result.error ?? result.code);
}

export function createPlaybackClock() {
  let key = null, duration = 0, remaining = 0, deadline = null;
  const left = now => deadline === null ? remaining : Math.max(0, deadline - now);
  const snapshot = now => ({ key, duration, remaining: left(now), deadline, running: deadline !== null });
  return {
    reconcile({ key: nextKey, duration: nextDuration, running }, now) {
      if (nextKey === null) {
        key = null; duration = 0; remaining = 0; deadline = null;
        return snapshot(now);
      }
      if (!Number.isFinite(nextDuration) || nextDuration <= 0 || !Number.isFinite(now)) throw new TypeError('Invalid playback clock interval');
      if (nextKey !== key) {
        key = nextKey; duration = nextDuration; remaining = duration; deadline = null;
      } else if (nextDuration !== duration) {
        // Speed/pace changes retain the fraction of this interval still unplayed.
        remaining = Math.max(0, Math.min(1, left(now) / duration)) * nextDuration;
        duration = nextDuration;
        deadline = deadline === null ? null : now + remaining;
      }
      if (running && deadline === null) deadline = now + remaining;
      else if (!running && deadline !== null) { remaining = left(now); deadline = null; }
      return snapshot(now);
    },
    suspend(now) {
      remaining = left(now); deadline = null;
      return snapshot(now);
    },
    reset() { key = null; duration = 0; remaining = 0; deadline = null; },
    snapshot,
  };
}
