import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.mjs';

test('same-origin UI serves index, assets and navigation without masking private API or missing files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'simlink-static-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<html>SIMLink test shell</html>');
  writeFileSync(join(root, 'assets/app.js'), '/* fictional test asset */');
  writeFileSync(join(root, '.env'), 'fixture-only');
  writeFileSync(join(root, 'sw.js'), '/* fictional service worker */');
  writeFileSync(join(root, 'manifest.webmanifest'), '{"name":"SIMLink"}');
  const app = createApp({ webRoot: root });
  try {
    for (const url of ['/', '/messages/example']) {
      const r = await app.inject({ url, headers: { accept: 'text/html' } });
      assert.equal(r.statusCode, 200);
      assert.match(r.headers['content-type'], /text\/html/);
      assert.match(r.body, /SIMLink test shell/);
      assert.equal(r.headers['cache-control'], 'no-store');
    }
    assert.equal((await app.inject('/assets/app.js')).statusCode, 200);
    const sw = await app.inject('/sw.js');
    assert.match(sw.headers['content-type'], /javascript/);
    assert.equal(sw.headers['cache-control'], 'no-store');
    assert.equal((await app.inject('/manifest.webmanifest')).statusCode, 200);
    for (const url of ['/api/unknown', '/api', '/assets/missing.js', '/.env', '/.well-known/missing', '/missing.json']) {
      assert.notEqual((await app.inject({ url, headers: { accept: 'text/html' } })).statusCode, 200, url);
    }
    assert.equal((await app.inject({ url: '/api/v1/messages', headers: { accept: 'text/html' } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/messages/example', headers: { accept: 'text/html' } })).statusCode, 404);
    assert.equal((await app.inject('/.well-known/sim-gateway')).json().apiVersion, 1);
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});
