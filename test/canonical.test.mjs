import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeJson } from '../src/canonical.mjs';

test('sorts object keys recursively', () => {
  assert.equal(canonicalizeJson({ b: 1, a: { d: 4, c: [3, 2, 1] } }), '{"a":{"c":[3,2,1],"d":4},"b":1}');
});

test('drops undefined properties and keeps null', () => {
  assert.equal(canonicalizeJson({ a: undefined, b: null, c: 0 }), '{"b":null,"c":0}');
});

test('writes null for holes and unrepresentable array items', () => {
  const sparse = [1];
  sparse[2] = 3;
  assert.equal(canonicalizeJson(sparse), '[1,null,3]');
  assert.equal(canonicalizeJson([undefined, () => 1, Symbol('x')]), '[null,null,null]');
});

test('honours toJSON', () => {
  assert.equal(canonicalizeJson({ when: { toJSON: () => '2026-11-11' } }), '{"when":"2026-11-11"}');
});

test('escapes strings like JSON.stringify', () => {
  assert.equal(canonicalizeJson({ text: 'a"b\nc' }), '{"text":"a\\"b\\nc"}');
});

test('rejects a value with no JSON representation', () => {
  assert.throws(() => canonicalizeJson(undefined), TypeError);
});
