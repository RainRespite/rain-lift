import test from 'node:test';
import assert from 'node:assert/strict';
import {initial} from '../dist/data.js';
import {createAppHarness} from './helpers/app-harness.mjs';

function training(t, userAgent = 'Mozilla/5.0 (iPhone)') {
  let now = Date.parse('2026-11-04T19:00:00+08:00');
  t.mock.method(Date, 'now', () => now);
  const location = {href: 'https://example.test/rain-lift/'};
  const app = createAppHarness(initial(), {
    globals: {
      navigator: {userAgent, onLine: false},
      window: {location, addEventListener() {}},
      Date
    }
  });
  app.action('start', {id: app.state.plans[0].id});
  app.action('record', {reps: '8'});
  return {app, location, elapse: ms => { now += ms; }};
}

test('an iPhone rest hands off the adjusted remaining seconds without changing the active set', t => {
  const {app, location, elapse} = training(t);
  assert.match(app.html, /灵动岛提醒/);
  assert.equal(app.run("$('#island-start').disabled"), false);
  elapse(2800);
  app.action('rest-plus');
  const before = app.state;
  app.action('island-start');
  const url = new URL(location.href);
  assert.equal(url.protocol, 'shortcuts:');
  assert.equal(url.hostname, 'run-shortcut');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    name: 'Rain Lift 组间休息', input: 'text', text: '103'
  });
  assert.deepEqual(app.state, before);
});

test('expired rests keep the in-app alert and cannot start a system timer', t => {
  const {app, location, elapse} = training(t);
  elapse(90000);
  app.run('updateClock()');
  assert.equal(app.run("$('#island-start').disabled"), true);
  assert.match(app.toast, /休息结束/);
  app.action('island-start');
  assert.equal(location.href, 'https://example.test/rain-lift/');
  app.action('rest-end');
  assert.doesNotMatch(app.html, /island-start/);
});

test('iPhone settings provide a ten-second setup check without altering the workout', t => {
  const {app, location} = training(t);
  app.action('nav', {view: 'settings'});
  app.action('island-setup');
  assert.match(app.modalHtml, /Rain Lift 组间休息/);
  const before = app.state;
  app.modalAction('test');
  assert.equal(new URL(location.href).searchParams.get('text'), '10');
  assert.deepEqual(app.state, before);
});

test('other browsers keep the normal rest controls', t => {
  const {app, location} = training(t, 'Mozilla/5.0 (Macintosh)');
  assert.match(app.html, /结束休息/);
  assert.doesNotMatch(app.html, /灵动岛提醒/);
  app.action('island-start');
  assert.equal(location.href, 'https://example.test/rain-lift/');
});
