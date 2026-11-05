import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { ROOT } from '../src/paths.js';

const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));

function load() {
  const errors: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(String(e.message)));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    virtualConsole,
    beforeParse(w) {
      w.HTMLElement.prototype.scrollIntoView = () => {};
    },
  });
  const d = dom.window.document;
  const el = <T extends HTMLElement>(id: string) => d.getElementById(id) as T;
  const fire = (node: HTMLElement, type: string) => node.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
  return { dom, d, el, fire, errors };
}

test('page loads without script errors and renders its data', () => {
  const { d, errors } = load();
  assert.deepEqual(errors, []);
  assert.ok(d.querySelectorAll('#list .pc').length > 0);
  assert.ok(d.querySelectorAll('#gaPl option').length >= 31);
  assert.equal(d.querySelectorAll('#sTl span').length, 6);
});

test('library search filters plants', () => {
  const { d, el, fire } = load();
  const q = el<HTMLInputElement>('q');
  q.value = 'mango';
  fire(q, 'input');
  assert.equal(d.querySelectorAll('#list .pc').length, 1);
});

test('plant name search explains when the server search is unavailable', async () => {
  const { dom, el } = load();
  (dom.window as unknown as { fetch?: unknown }).fetch = undefined;
  const q = el<HTMLInputElement>('pnQ');
  q.value = 'rose';
  q.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await wait(400);
  assert.match(el('pnSum').textContent ?? '', /not available right now/i);
  assert.equal((el<HTMLButtonElement>('pnMore')).hidden, true);
});

test('plant name search renders names returned by the API', async () => {
  const { dom, d, el } = load();
  (dom.window as unknown as { fetch: () => Promise<unknown> }).fetch = async () => ({
    ok: true,
    json: async () => ({
      total: 1,
      limit: 20,
      offset: 0,
      items: [
        {
          symbol: 'ROSA',
          synonymSymbol: '',
          scientificName: 'Rosa rubiginosa L.',
          commonName: 'sweetbriar rose',
          family: 'Rosaceae',
          accepted: true,
        },
      ],
    }),
  });
  const q = el<HTMLInputElement>('pnQ');
  q.value = 'rose';
  q.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await wait(400);
  assert.equal(d.querySelectorAll('#pnList .pnrow').length, 1);
  assert.match(el('pnList').textContent ?? '', /sweetbriar rose/);
  assert.match(el('pnList').textContent ?? '', /Rosa rubiginosa L\./);
  assert.match(el('pnSum').textContent ?? '', /1 match/);
});

test('adding a plant to My garden renders a card and persists', () => {
  const { dom, d, el } = load();
  el<HTMLButtonElement>('gaAdd').click();
  assert.equal(d.querySelectorAll('#gaList .card').length, 1);
  assert.match(dom.window.localStorage.getItem('gl_garden') ?? '', /"pid"/);
});

test('watering reminders show due plants and can mark them watered', () => {
  const { d, el } = load();
  const past = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
  el<HTMLInputElement>('gaDate').value = past;
  el<HTMLInputElement>('gaW').value = '2';
  el<HTMLButtonElement>('gaAdd').click();
  const box = d.querySelector('#remList [data-rw]') as HTMLInputElement | null;
  assert.ok(box, 'a due plant should appear in the reminder checklist');
  box.checked = true;
  box.dispatchEvent(new d.defaultView!.Event('change', { bubbles: true }));
  assert.match(el('remSum').textContent ?? '', /caught up/i);
  assert.equal(d.querySelectorAll('#remList [data-rw]').length, 0);
});

test('harvest predictor, moisture checker and planner produce results', () => {
  const { el, fire } = load();
  assert.match(el('hO').textContent ?? '', /Signs it is ready/);
  const mF = el<HTMLSelectElement>('mF');
  mF.value = '2';
  fire(mF, 'change');
  assert.match(el('mO').textContent ?? '', /Do not water/);
  assert.match(el('pout').textContent ?? '', /ml/);
});

test('assistant falls back to offline help when no AI is available', async () => {
  const { el } = load();
  el<HTMLInputElement>('aI').value = 'How do I grow tomato?';
  el<HTMLButtonElement>('aG').click();
  await wait();
  assert.match(el('aC').textContent ?? '', /Offline help/);
});
