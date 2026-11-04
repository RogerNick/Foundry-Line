// Builds public/index.html from the single-file game (build/game.html) plus the website shell.
// Run: node build/build.js
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');

let game = read('game.html');
const head = read('site-head.html');
const css = read('site.css') + '\n' + read('overhaul.css');
const boot = read('site-boot.js');

function swap(from, to) {
  if (!game.includes(from)) throw new Error('Build step could not find: ' + from.slice(0, 60));
  game = game.replace(from, to);
}

// 1. Add the shell CSS, the gate markup and the account button.
swap('</style>', css + '\n</style>');
swap('<canvas id="cv"></canvas>', '</head>\n<body>\n<div id="gate" hidden><div class="gbox panel" id="gbox"></div></div>\n<canvas id="cv"></canvas>');
swap('<button class="btn" data-act="help">Help <kbd>H</kbd></button>', '<button class="btn" data-act="acct" id="acctBtn">Account</button>\n    <button class="btn" data-act="help">Help <kbd>H</kbd></button>');

// 2. Let the website versions of save() take over the timers and page-close hooks.
swap('setInterval(save,20000);', 'setInterval(()=>save(),20000);');
swap("addEventListener('pagehide',save);", "addEventListener('pagehide',()=>save());");

// 3. Ignore game keys until a factory is open.
swap("addEventListener('keydown',ev=>{\n  const tg=ev.target.tagName;", "addEventListener('keydown',ev=>{\n  if(!gameReady)return;\n  const tg=ev.target.tagName;");

// 4. Replace the artifact boot block with the website boot (accounts, slots, cloud saves).
const marker = '// ================== BOOT ==================';
const i = game.indexOf(marker);
const j = game.lastIndexOf('</script>');
if (i < 0 || j < 0) throw new Error('Build step could not find the boot block.');
game = game.slice(0, i) + boot + '\n' + game.slice(j);

// 5. Put the machine and terrain illustrations inside the page, so the repo doesn't need the asset folder.
const art = fs.existsSync(path.join(dir, 'illustrations.json')) ? read('illustrations.json') : '{}';
swap('<script>', '<script>window.ILLUSTRATIONS=' + art.replace(/</g, '\\u003c') + ';</script>\n<script>');

const out = head + game.replace(/^\s+/, '') + '\n</body>\n</html>\n';
fs.writeFileSync(path.join(dir, '..', 'public', 'index.html'), out);
console.log('Built public/index.html (' + Math.round(out.length / 1024) + ' KB)');
