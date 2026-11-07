// The console: ` (CS2's toggleconsole bind, the key left of 1 whatever the layout) opens and closes it, in a run or in
// the menus. Opening it in a run gives the mouse back (the run pauses solo, as for the menu; a round plays on);
// closing it with ` goes straight back in (the key press lets the page take the mouse again; Esc can't, so after Esc
// a click or Resume does).
//
//   installConsole({ net, restart, openMap, leaveRun })   main.js, once; registers everything and the key
//
// To add to it: defineCvar / defineCommand (app/console/registry.js) from any module, print / con (output.js) to
// write to it. builtins.js has the console's own commands, game.js the game's, feeds.js what is logged by itself.
import { S, G } from '../state.js';
import { ConsoleWindow } from '../../ui/console.js';
import { defineCommand } from './registry.js';
import { execute, complete } from './exec.js';
import { registerBuiltins } from './builtins.js';
import { registerGame } from './game.js';
import { installFeeds } from './feeds.js';
import { print } from './output.js';

let win = null;
let backInto = false; // closing goes back into the run it was opened from

export const consoleOpen = () => !!win?.isOpen;

export function installConsole({ net, restart, openMap, leaveRun }) {
  registerBuiltins();
  registerGame({ net, restart, openMap, leaveRun });
  defineCommand({ name: 'toggleconsole', help: 'Show/hide the console. (`)', run: () => { toggle(); } });
  defineCommand({ name: 'hideconsole', help: 'Hide the console.', run: () => { close(); } });
  win = new ConsoleWindow({
    submit: (line) => execute(line, { S, G, net }),
    complete,
    onClose: () => {
      const back = backInto;
      backInto = false;
      if (back && S.run && !S.run.done && !G.overlay?.open) G.resume?.();
    },
  });
  installFeeds(net);
  print('ZE Laser Practice console. help, find <text>, cvarlist; Tab completes.', 'dim');
  window.addEventListener('keydown', onKey, true); // capture: ahead of the game's keys (app/input.js)
}

function open() {
  if (win.isOpen) return;
  backInto = S.locked && !!S.run && !S.run.done && !S.replay;
  if (document.pointerLockElement) document.exitPointerLock?.();
  win.open();
  // the pause screen comes up with the lock's release: the entry keeps the keyboard
  requestAnimationFrame(() => { if (win.isOpen) win.input.focus(); });
}

function close() { win.close(); }
function toggle() { if (win.isOpen) close(); else open(); }

const typing = (t) => t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes(t.type)));

function onKey(ev) {
  if (!win) return;
  const mine = win.contains(ev.target);
  // ` is the console's key and nothing else's: it never types (not in the entry, the chat or a name box, not with
  // Shift, not held down), it only opens and closes the console
  if (ev.code === 'Backquote') {
    ev.preventDefault();
    ev.stopPropagation();
    if (!ev.repeat) toggle();
    return;
  }
  if (!win.isOpen || mine) return; // the entry's own keys: ui/console.js
  // open, the keyboard is the console's: Esc closes it, anything else goes to the entry
  ev.stopPropagation();
  if (ev.code === 'Escape') { ev.preventDefault(); close(); return; }
  if (!typing(ev.target)) win.input.focus();
}
