/**
 * Builds dist/ — the whole app as 3 files for easy copy-paste into Apps Script:
 *   Code.gs  (all server code)   Index.html  (whole UI)   appsscript.json
 * Run:  node tools/build-bundle.js
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const order = ['Config', 'Data', 'Settings', 'Investors', 'Import', 'Deals', 'Email', 'Distribution', 'Responses', 'Code'];
const all = fs.readdirSync(path.join(root, 'src')).filter(f => f.endsWith('.gs')).map(f => f.slice(0, -3));
all.forEach(n => { if (!order.includes(n)) order.push(n); });
const code = '/**\n * SameDayInvestments — Deal Distribution System (single-file bundle)\n * Paste this whole file into Code.gs in the Apps Script editor.\n */\n\n' +
  order.map(n => '// ================= ' + n + '.gs =================\n' + read('src/' + n + '.gs')).join('\n\n');
const index = read('src/Index.html')
  .replace("<?!= include('Styles') ?>", () => read('src/Styles.html'))
  .replace("<?!= include('App') ?>", () => read('src/App.html'));
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'Code.gs'), code);
fs.writeFileSync(path.join(root, 'dist', 'Index.html'), index);
fs.copyFileSync(path.join(root, 'src', 'appsscript.json'), path.join(root, 'dist', 'appsscript.json'));
console.log('dist/Code.gs ' + Math.round(code.length / 1024) + ' KB, dist/Index.html ' + Math.round(index.length / 1024) + ' KB');
