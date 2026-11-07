// KV3 text (what VRF prints for a compiled resource's DATA block) -> plain JS values.
//   { key = value ... }  -> object      [ a, b, ]  -> array
//   "str" / """multi"""  -> string      resource:"x" / soundevent:"x" / panorama:"x" -> the string x
//   numbers, true / false, null; <!-- header --> and // comments are skipped.
export function parseKv3(text) {
  let i = 0;
  const n = text.length;
  const ws = () => {
    for (;;) {
      while (i < n && /\s/.test(text[i])) i++;
      if (text.startsWith('<!--', i)) { const e = text.indexOf('-->', i); i = e < 0 ? n : e + 3; continue; }
      if (text.startsWith('//', i)) { const e = text.indexOf('\n', i); i = e < 0 ? n : e + 1; continue; }
      break;
    }
  };
  const fail = (m) => { throw new Error(`kv3: ${m} at ${i} (${JSON.stringify(text.slice(i, i + 40))})`); };
  const str = () => {
    if (text.startsWith('"""', i)) { const e = text.indexOf('"""', i + 3); const s = text.slice(i + 3, e); i = e + 3; return s.replace(/^\r?\n/, ''); }
    i++;
    let s = '';
    while (i < n && text[i] !== '"') { if (text[i] === '\\' && i + 1 < n) { s += text[i + 1]; i += 2; } else s += text[i++]; }
    i++;
    return s;
  };
  const value = () => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      const o = {};
      for (;;) {
        ws();
        if (text[i] === '}') { i++; return o; }
        let k;
        if (text[i] === '"') k = str();
        else { const m = /^[A-Za-z0-9_.:]+/.exec(text.slice(i, i + 256)); if (!m) fail('key'); k = m[0]; i += k.length; }
        ws();
        if (text[i] !== '=') fail('=');
        i++;
        o[k] = value();
        ws();
        if (text[i] === ',') i++;
      }
    }
    if (c === '[') {
      i++;
      const a = [];
      for (;;) {
        ws();
        if (text[i] === ']') { i++; return a; }
        a.push(value());
        ws();
        if (text[i] === ',') i++;
      }
    }
    if (c === '"') return str();
    if (c === '#' && text[i + 1] === '[') { // binary blob: hex bytes
      const e = text.indexOf(']', i);
      const hex = text.slice(i + 2, e).replace(/[^0-9A-Fa-f]/g, '');
      i = e + 1;
      return Uint8Array.from(hex.match(/../g) || [], (h) => parseInt(h, 16));
    }
    const m = /^[A-Za-z_][A-Za-z0-9_]*:"/.exec(text.slice(i, i + 64)); // resource:"..." and friends
    if (m) { i += m[0].length - 1; return str(); }
    const t = /^[^\s,\]}]+/.exec(text.slice(i, i + 128));
    if (!t) fail('value');
    i += t[0].length;
    const w = t[0];
    if (w === 'true') return true;
    if (w === 'false') return false;
    if (w === 'null') return null;
    const num = Number(w);
    if (Number.isNaN(num)) return w;
    return num;
  };
  const out = value();
  return out;
}
