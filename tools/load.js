/**
 * Loads gas-mock.js + every src/*.gs file into one shared VM context,
 * exactly like Apps Script's single global scope. Returns that context.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function load() {
  const ctx = vm.createContext({ console, Buffer, crypto: require('crypto'), setTimeout });
  ctx.globalThis = ctx;
  const run = (file) => vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  run(path.join(__dirname, 'gas-mock.js'));
  const src = path.join(__dirname, '..', 'src');
  fs.readdirSync(src).filter(f => f.endsWith('.gs')).sort().forEach(f => run(path.join(src, f)));
  return ctx;
};
