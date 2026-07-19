// =================================================================
// Aurora Notes — app logic
// Local-first notes with optional real-time cloud sync via Firebase.
// =================================================================

import { firebaseConfig } from "./firebase-config.js";

const STORAGE_KEY = "aurora-notes-v1";
const ROOM_KEY = "aurora-room-code";

const COLORS = [
  { id: "none",     hex: "transparent" },
  { id: "coral",    hex: "#FF9B85" },
  { id: "lavender", hex: "#B9A6E0" },
  { id: "sage",     hex: "#9FC9A6" },
  { id: "butter",   hex: "#F4D58D" },
  { id: "sky",      hex: "#8FC1E3" },
  { id: "blush",    hex: "#E8A0B4" },
];

const WORDS_A = ["moonlit", "quiet", "amber", "velvet", "hazy", "gentle", "coral", "dusky", "soft", "wild"];
const WORDS_B = ["harbor", "orchard", "meadow", "ember", "tide", "willow", "canyon", "lantern", "petal", "atlas"];

// ---------------------------------------------------------------
// state
// ---------------------------------------------------------------

let notes = loadLocalNotes();
let activeNoteId = null;
let selectedColor = "none";
let pinnedDraft = false;
let searchTerm = "";

let syncState = "off"; // off | connecting | on | error
let roomCode = localStorage.getItem(ROOM_KEY) || "";
let firestoreUnsub = null;
let db = null;

const isConfigured = () =>
  firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("YOUR_");

// ---------------------------------------------------------------
// elements
// ---------------------------------------------------------------

const board = document.getElementById("board");
const emptyState = document.getElementById("emptyState");
const searchInput = document.getElementById("searchInput");

const newNoteBtn = document.getElementById("newNoteBtn");
const emptyNewNoteBtn = document.getElementById("emptyNewNoteBtn");

const modalScrim = document.getElementById("modalScrim");
const titleInput = document.getElementById("noteTitleInput");
const contentInput = document.getElementById("noteContentInput");
const colorPicker = document.getElementById("colorPicker");
const pinToggle = document.getElementById("pinToggle");
const saveNoteBtn = document.getElementById("saveNoteBtn");
const cancelBtn = document.getElementById("cancelBtn");
const deleteNoteBtn = document.getElementById("deleteNoteBtn");

const syncBtn = document.getElementById("syncBtn");
const syncDot = document.getElementById("syncDot");
const syncModalScrim = document.getElementById("syncModalScrim");
const roomCodeInput = document.getElementById("roomCodeInput");
const generateCodeBtn = document.getElementById("generateCodeBtn");
const connectBtn = document.getElementById("connectBtn");
const staySoloBtn = document.getElementById("staySoloBtn");
const syncFineprint = document.getElementById("syncFineprint");

const banner = document.getElementById("syncBanner");
const bannerText = document.getElementById("syncBannerText");
const bannerAction = document.getElementById("syncBannerAction");
const bannerClose = document.getElementById("syncBannerClose");

const toastEl = document.getElementById("toast");

// ---------------------------------------------------------------
// local storage
// ---------------------------------------------------------------

function loadLocalNotes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalNotes() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

// ---------------------------------------------------------------
// rendering
// ---------------------------------------------------------------

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function visibleNotes() {
  const term = searchTerm.trim().toLowerCase();
  let list = notes.filter((n) => !n.deleted);
  if (term) {
    list = list.filter(
      (n) =>
        n.title.toLowerCase().includes(term) ||
        n.content.toLowerCase().includes(term)
    );
  }
  return list.sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

function render() {
  const list = visibleNotes();
  board.innerHTML = "";

  if (list.length === 0) {
    emptyState.hidden = false;
    board.hidden = true;
  } else {
    emptyState.hidden = true;
    board.hidden = false;

    list.forEach((note, i) => {
      const color = COLORS.find((c) => c.id === note.color) || COLORS[0];
      const card = document.createElement("article");
      card.className = "note-card glass";
      card.tabIndex = 0;
      card.style.animationDelay = `${Math.min(i * 35, 300)}ms`;
      if (color.hex !== "transparent") {
        card.style.setProperty("--card-tint", `${color.hex}22`);
        card.style.borderColor = `${color.hex}55`;
      }

      card.innerHTML = `
        <div class="note-card-top">
          <h3>${escapeHtml(note.title) || "Untitled"}</h3>
          ${note.pinned ? '<span class="pin-mark">✦</span>' : ""}
        </div>
        <p class="snippet">${escapeHtml(note.content)}</p>
        <div class="meta">
          <span>${timeAgo(note.updatedAt)}</span>
          <div class="card-actions">
            <button data-action="delete" aria-label="Delete note" title="Delete">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </div>
      `;

      card.addEventListener("click", (e) => {
        if (e.target.closest('[data-action="delete"]')) {
          e.stopPropagation();
          removeNote(note.id);
          return;
        }
        openEditor(note.id);
      });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter") openEditor(note.id);
      });

      board.appendChild(card);
    });
  }

  updateSyncUI();
}

// ---------------------------------------------------------------
// editor modal
// ---------------------------------------------------------------

function buildColorPicker() {
  colorPicker.innerHTML = "";
  COLORS.forEach((c) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "color-swatch";
    btn.style.background =
      c.hex === "transparent"
        ? "linear-gradient(135deg, rgba(255,255,255,0.25), rgba(255,255,255,0.08))"
        : c.hex;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-label", c.id);
    btn.dataset.color = c.id;
    btn.addEventListener("click", () => {
      selectedColor = c.id;
      [...colorPicker.children].forEach((el) =>
        el.classList.toggle("selected", el.dataset.color === c.id)
      );
    });
    colorPicker.appendChild(btn);
  });
}
buildColorPicker();

function openEditor(noteId) {
  activeNoteId = noteId || null;
  const note = notes.find((n) => n.id === noteId);

  titleInput.value = note ? note.title : "";
  contentInput.value = note ? note.content : "";
  selectedColor = note ? note.color || "none" : "none";
  pinnedDraft = note ? !!note.pinned : false;

  [...colorPicker.children].forEach((el) =>
    el.classList.toggle("selected", el.dataset.color === selectedColor)
  );
  pinToggle.classList.toggle("active", pinnedDraft);
  deleteNoteBtn.hidden = !note;

  modalScrim.hidden = false;
  setTimeout(() => titleInput.focus(), 30);
}

function closeEditor() {
  modalScrim.hidden = true;
  activeNoteId = null;
}

function saveNote() {
  const title = titleInput.value.trim();
  const content = contentInput.value.trim();
  if (!title && !content) {
    closeEditor();
    return;
  }

  const now = Date.now();
  if (activeNoteId) {
    const note = notes.find((n) => n.id === activeNoteId);
    note.title = title;
    note.content = content;
    note.color = selectedColor;
    note.pinned = pinnedDraft;
    note.updatedAt = now;
    pushRemote(note);
    showToast("Note updated");
  } else {
    const note = {
      id: crypto.randomUUID(),
      title,
      content,
      color: selectedColor,
      pinned: pinnedDraft,
      createdAt: now,
      updatedAt: now,
    };
    notes.push(note);
    pushRemote(note);
    showToast("Note saved");
  }

  saveLocalNotes();
  closeEditor();
  render();
}

function removeNote(id) {
  const note = notes.find((n) => n.id === id);
  if (!note) return;
  notes = notes.filter((n) => n.id !== id);
  saveLocalNotes();
  deleteRemote(id);
  render();
  showToast("Note deleted");
  if (activeNoteId === id) closeEditor();
}

pinToggle.addEventListener("click", () => {
  pinnedDraft = !pinnedDraft;
  pinToggle.classList.toggle("active", pinnedDraft);
});

saveNoteBtn.addEventListener("click", saveNote);
cancelBtn.addEventListener("click", closeEditor);
deleteNoteBtn.addEventListener("click", () => {
  if (activeNoteId) removeNote(activeNoteId);
});

modalScrim.addEventListener("click", (e) => {
  if (e.target === modalScrim) closeEditor();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!modalScrim.hidden) closeEditor();
    if (!syncModalScrim.hidden) closeSyncModal();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !modalScrim.hidden) {
    saveNote();
  }
});

newNoteBtn.addEventListener("click", () => openEditor(null));
emptyNewNoteBtn.addEventListener("click", () => openEditor(null));

// ---------------------------------------------------------------
// search
// ---------------------------------------------------------------

searchInput.addEventListener("input", (e) => {
  searchTerm = e.target.value;
  render();
});

// ---------------------------------------------------------------
// toast
// ---------------------------------------------------------------

let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

// ---------------------------------------------------------------
// sync UI
// ---------------------------------------------------------------

function updateSyncUI() {
  syncDot.className = "dot " + (syncState === "on" ? "on" : syncState === "connecting" ? "pending" : "off");
  syncBtn.title =
    syncState === "on"
      ? `Synced as "${roomCode}"`
      : syncState === "connecting"
      ? "Connecting…"
      : "Not syncing — click to connect";
}

function openSyncModal() {
  roomCodeInput.value = roomCode || "";
  if (!isConfigured()) {
    syncFineprint.textContent =
      "Cloud sync needs a Firebase project connected first. Open firebase-config.js and follow the steps in README.md — it takes about five minutes and it's free.";
    connectBtn.disabled = true;
    connectBtn.style.opacity = 0.5;
  } else {
    syncFineprint.textContent =
      roomCode
        ? `Currently syncing as "${roomCode}". Enter a different code to switch spaces.`
        : "Both of you enter the exact same code to share one space.";
    connectBtn.disabled = false;
    connectBtn.style.opacity = 1;
  }
  syncModalScrim.hidden = false;
}
function closeSyncModal() {
  syncModalScrim.hidden = true;
}

syncBtn.addEventListener("click", openSyncModal);
staySoloBtn.addEventListener("click", closeSyncModal);
syncModalScrim.addEventListener("click", (e) => {
  if (e.target === syncModalScrim) closeSyncModal();
});

generateCodeBtn.addEventListener("click", () => {
  const a = WORDS_A[Math.floor(Math.random() * WORDS_A.length)];
  const b = WORDS_B[Math.floor(Math.random() * WORDS_B.length)];
  const n = Math.floor(Math.random() * 90 + 10);
  roomCodeInput.value = `${a}-${b}-${n}`;
});

connectBtn.addEventListener("click", async () => {
  const code = roomCodeInput.value.trim().toLowerCase().replace(/\s+/g, "-");
  if (!code) return;
  roomCode = code;
  localStorage.setItem(ROOM_KEY, code);
  closeSyncModal();
  await connectSync();
});

bannerClose.addEventListener("click", () => (banner.hidden = true));

// ---------------------------------------------------------------
// Firebase cloud sync (optional — only runs if configured)
// ---------------------------------------------------------------

async function connectSync() {
  if (!isConfigured() || !roomCode) return;

  syncState = "connecting";
  render();

  try {
    const { initializeApp } = await import(
      "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"
    );
    const {
      getFirestore,
      collection,
      doc,
      setDoc,
      deleteDoc,
      onSnapshot,
    } = await import(
      "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
    );

    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);

    // stash helpers on window-scope closures for push/delete functions below
    window.__aurora = { collection, doc, setDoc, deleteDoc };

    const colRef = collection(db, "rooms", roomCode, "notes");

    if (firestoreUnsub) firestoreUnsub();

    firestoreUnsub = onSnapshot(
      colRef,
      (snapshot) => {
        syncState = "on";
        snapshot.docChanges().forEach((change) => {
          const remote = change.doc.data();
          if (change.type === "removed") {
            notes = notes.filter((n) => n.id !== remote.id);
            return;
          }
          const local = notes.find((n) => n.id === remote.id);
          if (!local || remote.updatedAt > local.updatedAt) {
            const merged = { ...remote };
            notes = notes.filter((n) => n.id !== remote.id);
            notes.push(merged);
          }
        });
        saveLocalNotes();
        render();
      },
      (err) => {
        console.error(err);
        syncState = "error";
        showToast("Sync connection lost — check your Firebase settings");
        render();
      }
    );

    // push any notes that existed only locally up to the room
    notes.forEach((n) => pushRemote(n));

    showToast(`Connected — syncing as "${roomCode}"`);
  } catch (err) {
    console.error(err);
    syncState = "error";
    showToast("Couldn't connect. Check your Firebase config.");
    render();
  }
}

function pushRemote(note) {
  if (syncState !== "on" || !db || !window.__aurora) return;
  const { doc, setDoc, collection } = window.__aurora;
  const ref = doc(collection(db, "rooms", roomCode, "notes"), note.id);
  setDoc(ref, note).catch((err) => console.error("sync push failed", err));
}

function deleteRemote(id) {
  if (syncState !== "on" || !db || !window.__aurora) return;
  const { doc, deleteDoc, collection } = window.__aurora;
  const ref = doc(collection(db, "rooms", roomCode, "notes"), id);
  deleteDoc(ref).catch((err) => console.error("sync delete failed", err));
}

// ---------------------------------------------------------------
// time-of-day sky
// ---------------------------------------------------------------

const brandMarkEl = document.querySelector(".brand-mark");

function getTimePhase(date = new Date()) {
  const h = date.getHours();
  if (h >= 5 && h < 8) return "dawn";
  if (h >= 8 && h < 17) return "day";
  if (h >= 17 && h < 21) return "dusk";
  return "night";
}

const PHASE_GLYPH = {
  dawn: "🌅",
  day: "☀",
  dusk: "🌇",
  night: "☾",
};

let currentPhase = null;

function applyTimePhase() {
  const phase = getTimePhase();
  if (phase === currentPhase) return;
  currentPhase = phase;
  document.body.dataset.timePhase = phase;
  if (brandMarkEl) brandMarkEl.textContent = PHASE_GLYPH[phase];
}

// ---------------------------------------------------------------
// starfield (tiny decorative dots, generated once)
// ---------------------------------------------------------------

function paintStars() {
  const el = document.getElementById("stars");
  const count = 60;
  let svg = `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='800'>`;
  for (let i = 0; i < count; i++) {
    const x = Math.random() * 800;
    const y = Math.random() * 800;
    const r = Math.random() * 1.1 + 0.3;
    const o = (Math.random() * 0.5 + 0.3).toFixed(2);
    svg += `<circle cx='${x.toFixed(1)}' cy='${y.toFixed(1)}' r='${r.toFixed(
      2
    )}' fill='white' fill-opacity='${o}'/>`;
  }
  svg += `</svg>`;
  el.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// ---------------------------------------------------------------
// init
// ---------------------------------------------------------------

function init() {
  applyTimePhase();
  setInterval(applyTimePhase, 5 * 60 * 1000); // recheck every 5 min in case the app stays open
  paintStars();
  render();

  if (isConfigured() && roomCode) {
    connectSync();
  } else if (!isConfigured()) {
    banner.hidden = false;
    bannerText.textContent =
      "Working on this device only. Connect a free Firebase project to sync notes between your phones.";
    bannerAction.textContent = "How to set it up";
    bannerAction.addEventListener("click", openSyncModal);
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

init();
