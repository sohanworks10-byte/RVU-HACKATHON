import { EventEmitter } from 'events';

const emitter = new EventEmitter();

export function notifyRunQueued(runId) {
  emitter.emit('run_queued', runId);
}

export function onRunQueued(handler) {
  emitter.on('run_queued', handler);
  return () => emitter.off('run_queued', handler);
}
