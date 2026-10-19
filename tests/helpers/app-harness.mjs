import fs from 'node:fs';
import vm from 'node:vm';
import * as data from '../../dist/data.js';

export class Storage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) {
    if (this.fail) throw new Error('quota');
    this.values.set(key, String(value));
  }
}

const decode = value => String(value ?? '').replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) => ({amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'"}[entity]));
const attributes = html => Object.fromEntries([...html.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(match => [match[1], decode(match[2] ?? '')]));

// Executes the shipped app module and its real event callbacks. This small DOM
// seam verifies UI state changes and storage, but does not claim browser layout QA.
export function createAppHarness(database = data.initial(), {storage = new Storage(), globals = {}} = {}) {
  if (database) storage.setItem(data.KEY, JSON.stringify(database));
  class Element {
    listeners = {};
    classList = {add() {}, remove() {}, toggle() {}};
    open = false;
    textContent = '';
    dataset = {};
    fields = {};
    constructor(attrs = {}) {
      this.attrs = attrs;
      this.value = attrs.value ?? '';
      this.disabled = Object.hasOwn(attrs, 'disabled');
      for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    }
    set innerHTML(html) {
      this.html = html;
      this.nodes = [...html.matchAll(/<(button|input|select|textarea)\b([^>]*)>(?:([\s\S]*?)<\/\1>)?/g)].map(match => {
        const node = new Element(attributes(match[2]));
        node.textContent = decode((match[3] ?? '').replace(/<[^>]*>/g, ''));
        if (match[1] === 'select') {
          const options = [...(match[3] ?? '').matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)];
          const option = options.find(option => /\bselected\b/.test(option[1])) ?? options[0];
          node.value = option ? attributes(option[1]).value ?? decode(option[2]) : '';
        }
        return node;
      });
      this.form = new Element();
      for (const node of this.nodes) if (node.attrs.name) this.form.fields[node.attrs.name] = node.value;
    }
    get innerHTML() { return this.html ?? ''; }
    querySelectorAll(selector) {
      const attribute = selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
      if (attribute) return this.nodes?.filter(node => Object.hasOwn(node.attrs, attribute[1]) && (attribute[2] === undefined || node.attrs[attribute[1]] === attribute[2])) ?? [];
      return [];
    }
    querySelector(selector) { return selector === 'form' ? this.form : this.querySelectorAll(selector)[0] ?? null; }
    addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }
    closest(selector) { return selector === '[data-action]' && this.dataset.action ? this : null; }
    close() { this.open = false; }
    showModal() { this.open = true; }
  }
  const app = new Element(), modal = new Element(), toast = new Element();
  const roots = {'#app': app, '#modal': modal, '#toast': toast};
  const document = {
    body: new Element(), visibilityState: 'visible',
    addEventListener() {},
    querySelector(selector) {
      if (roots[selector]) return roots[selector];
      if (selector.startsWith('#modal ')) return modal.querySelector(selector.slice(7));
      if (selector.startsWith('#')) return app.nodes?.find(node => node.attrs.id === selector.slice(1)) ?? null;
      return null;
    }
  };
  class FormData {
    constructor(form) { this.fields = form.fields; }
    get(name) { return this.fields[name] ?? null; }
    has(name) { return Object.hasOwn(this.fields, name); }
  }
  const context = vm.createContext({__data: data, document, localStorage: storage, structuredClone, FormData,
    navigator: {onLine: true}, window: {addEventListener() {}}, matchMedia: () => ({matches: true}),
    setTimeout: () => 1, clearTimeout() {}, setInterval() {}, scrollTo() {}, ...globals});
  const source = fs.readFileSync(new URL('../../dist/app.js', import.meta.url), 'utf8').replace(/^import \{([^}]+)\} from '[^']+';/, 'const {$1} = __data;');
  vm.runInContext(source, context, {filename: 'dist/app.js'});
  return {
    storage,
    get state() { return structuredClone(vm.runInContext('db()', context)); },
    get html() { return app.innerHTML; },
    get modalHtml() { return modal.innerHTML; },
    get toast() { return toast.textContent; },
    get modalOpen() { return modal.open; },
    run(code) { return vm.runInContext(code, context); },
    action(action, dataset = {}) {
      const button = new Element(Object.fromEntries(Object.entries({action, ...dataset}).map(([key, value]) => ['data-' + key, value])));
      for (const listener of app.listeners.click ?? []) listener({target: button, preventDefault() {}});
    },
    modalAction(name) {
      const button = modal.querySelector(`[data-modal="${name}"]`);
      if (!button) throw new Error(`Missing modal action: ${name}`);
      if (!button.disabled) button.onclick?.();
    },
    field(name, value) {
      const input = modal.querySelector(`[name="${name}"]`);
      if (!input) throw new Error(`Missing form field: ${name}`);
      input.value = String(value);
      modal.form.fields[name] = String(value);
    },
    submit(values = {}) {
      Object.assign(modal.form.fields, values);
      for (const listener of modal.form.listeners.submit ?? []) listener({target: modal.form, preventDefault() {}});
    }
  };
}
