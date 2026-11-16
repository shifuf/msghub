const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const exportsObject = {};
const dom = new JSDOM('');
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/preview.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText, { exports: exportsObject, DOMParser: dom.window.DOMParser });

test('untrusted mail cannot retain active elements, event handlers, links or remote images', () => {
  const output = exportsObject.safePreviewDocument('<base href="https://evil.test"><meta http-equiv="refresh" content="0;url=https://evil.test"><script>alert(1)</script><svg onload="alert(1)"></svg><iframe srcdoc="bad"></iframe><form action="https://evil.test"><input></form><a href="javascript:alert(1)" onclick="alert(1)">Read</a><img src="https://evil.test/pixel" onerror="alert(1)"><p>Hello <strong>reader</strong></p>');
  const parsed = new JSDOM(output).window.document;
  assert.equal(parsed.querySelectorAll('script,base,svg,iframe,form,input').length, 0);
  assert.equal(parsed.querySelector('a').getAttribute('href'), null);
  assert.equal(parsed.querySelector('a').getAttribute('onclick'), null);
  assert.equal(parsed.querySelector('img').getAttribute('src'), null);
  assert.equal(parsed.querySelector('img').getAttribute('onerror'), null);
  assert.equal(parsed.querySelector('p').textContent, 'Hello reader');
  const csp = parsed.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
  assert.match(csp, /default-src 'none'/); assert.match(csp, /script-src 'none'/); assert.match(csp, /form-action 'none'/);
});
test('preview permits raster data images but rejects SVG data URLs and external srcset', () => {
  const result = new JSDOM(exportsObject.safePreviewDocument('<img src="data:image/png;base64,YQ==" srcset="https://evil.test/a 2x"><img src="data:image/svg+xml;base64,YQ==">')).window.document;
  assert.equal(result.images[0].getAttribute('src'), 'data:image/png;base64,YQ==');
  assert.equal(result.images[0].getAttribute('srcset'), null);
  assert.equal(result.images[1].getAttribute('src'), null);
});

test('preview component renders an opaque sandbox without script or same-origin permissions', async () => {
  const { parse, compileTemplate } = require('vue/compiler-sfc');
  const vue = require('vue');
  const { renderToString } = require('vue/server-renderer');
  const source = fs.readFileSync(path.join(__dirname, '../src/components/SafeHtmlPreview.vue'), 'utf8');
  const { descriptor } = parse(source);
  const compiled = compileTemplate({ source: descriptor.template.content, filename: 'SafeHtmlPreview.vue', id: 'preview' });
  const renderedExports = {};
  vm.runInNewContext(ts.transpileModule(compiled.code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: renderedExports, require: () => vue });
  const rendered = await renderToString(vue.createSSRApp({ render: renderedExports.render, data: () => ({ document: exportsObject.safePreviewDocument('<p>Hello</p>') }) }));
  const frame = new JSDOM(rendered).window.document.querySelector('iframe');
  assert.ok(frame); assert.equal(frame.getAttribute('sandbox'), '');
  assert.equal(frame.getAttribute('referrerpolicy'), 'no-referrer');
  assert.match(frame.getAttribute('srcdoc'), /default-src 'none'/);
});
