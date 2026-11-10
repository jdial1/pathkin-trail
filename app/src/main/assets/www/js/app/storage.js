// Local-first storage. On Android the native bridge writes each document
// atomically (temp file, then rename) and keeps a rolling backup of the last
// three saves. In a desktop browser the same contract runs on localStorage.

const native = window.PathkinNative || null;
const BACKUPS = 3;

const web = {
  load: (key) => localStorage.getItem('pathkin.' + key),
  loadBackup: (key, n) => localStorage.getItem(`pathkin.${key}.bak${n}`),
  save(key, json) {
    const cur = localStorage.getItem('pathkin.' + key);
    if (cur !== null) {
      for (let n = BACKUPS; n > 1; n--) {
        const prev = localStorage.getItem(`pathkin.${key}.bak${n - 1}`);
        if (prev !== null) localStorage.setItem(`pathkin.${key}.bak${n}`, prev);
      }
      localStorage.setItem(`pathkin.${key}.bak1`, cur);
    }
    localStorage.setItem('pathkin.' + key, json);
    return true;
  },
  remove(key) {
    localStorage.removeItem('pathkin.' + key);
    for (let n = 1; n <= BACKUPS; n++) localStorage.removeItem(`pathkin.${key}.bak${n}`);
  },
};

export const storage = {
  load: (key) => (native ? native.load(key) : web.load(key)) || null,
  loadBackup: (key, n) => (native ? native.loadBackup(key, n) : web.loadBackup(key, n)) || null,
  save: (key, json) => (native ? native.save(key, json) : web.save(key, json)),
  remove: (key) => (native ? native.remove(key) : web.remove(key)),
  backups: BACKUPS,
};

export function vibrate(ms) {
  if (native) native.vibrate(ms);
  else if (navigator.vibrate) navigator.vibrate(ms);
}
