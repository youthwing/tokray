import assert from 'node:assert/strict';
import test from 'node:test';
import { invalidateSessionDiscovery, subscribeSessionDiscovery } from '../dist/index.js';

test('session discovery publishes monotonic invalidation events and supports unsubscribe', () => {
  const changes = [];
  const unsubscribe = subscribeSessionDiscovery((change) => changes.push(change));

  invalidateSessionDiscovery();
  invalidateSessionDiscovery();
  assert.equal(changes.length, 2);
  assert.ok(changes[1].generation > changes[0].generation);
  assert.ok(changes.every((change) => Number.isFinite(change.at)));

  unsubscribe();
  invalidateSessionDiscovery();
  assert.equal(changes.length, 2);
});
