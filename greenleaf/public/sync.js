/* Syncs gl_* localStorage keys with the GreenLeaf server and provides the AI bridge.
   Keys never reach the browser: AI calls go through /api/ai/messages. */
(function () {
  if (location.protocol === 'file:') return;
  var timers = {};
  try {
    var x = new XMLHttpRequest();
    x.open('GET', '/api/data', false);
    x.send();
    if (x.status === 200) {
      var d = JSON.parse(x.responseText).data || {};
      Object.keys(d).forEach(function (k) { localStorage.setItem(k, JSON.stringify(d[k])); });
    }
  } catch (e) { /* server unreachable: keep local data */ }
  var orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    orig.call(this, k, v);
    if (this !== localStorage || !/^gl_/.test(k)) return;
    clearTimeout(timers[k]);
    timers[k] = setTimeout(function () {
      var val;
      try { val = JSON.parse(v); } catch (e) { return; }
      fetch('/api/data/' + k, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: val }) }).catch(function () {});
    }, 400);
  };
  function b64(blob) {
    return new Promise(function (ok, no) {
      var r = new FileReader();
      r.onload = function () { ok(String(r.result).split(',')[1]); };
      r.onerror = no;
      r.readAsDataURL(blob);
    });
  }
  async function sample(input, o) {
    o = o || {};
    var msgs = typeof input === 'string' ? [{ role: 'user', content: input }] : input.map(function (m) { return { role: m.role, content: m.content }; });
    if (o.images && o.images.length) {
      var last = msgs[msgs.length - 1], blocks = [];
      for (const b of o.images) blocks.push({ type: 'image', source: { type: 'base64', media_type: b.type || 'image/jpeg', data: await b64(b) } });
      blocks.push({ type: 'text', text: String(last.content) });
      last.content = blocks;
    }
    var tools = (o.tools || []).map(function (t) { return { name: t.name, description: t.description, input_schema: t.inputSchema }; });
    for (var i = 0; i < 5; i++) {
      var r = await fetch('/api/ai/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(tools.length ? { messages: msgs, tools: tools } : { messages: msgs }) });
      if (!r.ok) throw { code: r.status === 429 ? 'rate_limited' : r.status === 503 ? 'not_granted' : 'error' };
      var j = await r.json();
      var text = (j.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('');
      if (j.stop_reason === 'tool_use') {
        msgs.push({ role: 'assistant', content: j.content });
        var results = [];
        for (const u of j.content.filter(function (c) { return c.type === 'tool_use'; })) {
          var t = (o.tools || []).find(function (z) { return z.name === u.name; }), out = 'Tool not available.';
          try { if (t) out = await t.execute(u.input); } catch (e) { out = 'Tool error.'; }
          results.push({ type: 'tool_result', tool_use_id: u.id, content: String(out) });
        }
        msgs.push({ role: 'user', content: results });
        continue;
      }
      if (o.onText) o.onText({ text: text });
      return { text: text };
    }
    throw { code: 'error' };
  }
  sample.limits = async function () { return { images: true }; };
  window.claude = {
    use: async function (n) {
      if (n !== 'sample') return null;
      var ok = false;
      try { ok = (await (await fetch('/api/health')).json()).ai; } catch (e) { /* offline */ }
      return ok ? sample : null;
    },
  };
})();
