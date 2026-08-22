// =================================================================
// Aurora Notes — app logic
// Local-first notes with optional real-time cloud sync via Firebase.
// =================================================================

import { firebaseConfig } from "./firebase-config.js";

const STORAGE_KEY = "aurora-notes-v1";
const ROOM_KEY = "aurora-room-code";
const LOCK_KEY = "aurora-lock-v1";
const UNLOCK_SESSION_KEY = "aurora-unlocked";
const LOCK_GRACE_MS = 30 * 1000; // re-ask for the PIN after being backgrounded this long
const OWNER_NAMES_KEY = "aurora-owner-names";
const OWNER_FILTER_KEY = "aurora-owner-filter";

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
let ownerNamesUnsub = null;
let db = null;

let draftPhotos = []; // [{ id, dataUrl }] for the note currently open in the editor
let draftOwner = null; // "a" | "b" | null (unassigned/shared) for the note in the editor
let ownerFilter = localStorage.getItem(OWNER_FILTER_KEY) || "all"; // "all" | "a" | "b"
let appStarted = false;
let pinBuffer = "";
let lockBackgroundTimer = null;

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

const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightboxImg");
const lightboxClose = document.getElementById("lightboxClose");

const photoStrip = document.getElementById("photoStrip");
const addPhotoBtn = document.getElementById("addPhotoBtn");
const photoInput = document.getElementById("photoInput");

const ownerTabs = document.getElementById("ownerTabs");
const ownerPicker = document.getElementById("ownerPicker");
const namesBtn = document.getElementById("namesBtn");
const namesModalScrim = document.getElementById("namesModalScrim");
const ownerAInput = document.getElementById("ownerAInput");
const ownerBInput = document.getElementById("ownerBInput");
const cancelNamesBtn = document.getElementById("cancelNamesBtn");
const saveNamesBtn = document.getElementById("saveNamesBtn");

const lockDot = document.getElementById("lockDot");
const lockSettingsBtn = document.getElementById("lockSettingsBtn");
const lockModalScrim = document.getElementById("lockModalScrim");
const lockSetupView = document.getElementById("lockSetupView");
const lockManageView = document.getElementById("lockManageView");
const newPinInput = document.getElementById("newPinInput");
const confirmPinInput = document.getElementById("confirmPinInput");
const biometricRow = document.getElementById("biometricRow");
const biometricToggle = document.getElementById("biometricToggle");
const biometricRowManage = document.getElementById("biometricRowManage");
const biometricToggleManage = document.getElementById("biometricToggleManage");
const lockSetupError = document.getElementById("lockSetupError");
const changePinBtn = document.getElementById("changePinBtn");
const removeLockBtn = document.getElementById("removeLockBtn");
const cancelLockBtn = document.getElementById("cancelLockBtn");
const saveLockBtn = document.getElementById("saveLockBtn");

const lockScreen = document.getElementById("lockScreen");
const lockScreenSub = document.getElementById("lockScreenSub");
const pinDots = document.getElementById("pinDots");
const lockError = document.getElementById("lockError");
const biometricBtn = document.getElementById("biometricBtn");
const keypad = document.getElementById("keypad");

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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch (err) {
    console.error(err);
    showToast("Storage is full — try removing some photos or old notes");
  }
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
  if (ownerFilter !== "all") {
    list = list.filter((n) => n.owner === ownerFilter);
  }
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
  const names = getOwnerNames();
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

      const photos = note.photos || [];
      card.innerHTML = `
        ${
          photos.length
            ? `<div class="card-photos" data-action="preview" data-photo="0"><img src="${photos[0].dataUrl}" alt="" />${
                photos.length > 1 ? `<span class="card-photos-count">+${photos.length - 1}</span>` : ""
              }</div>`
            : ""
        }
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
        ${
          !note.owner
            ? `<div class="quick-assign">
                <span>Tag as</span>
                <button type="button" data-action="assign" data-value="a">${escapeHtml(names.a)}</button>
                <button type="button" data-action="assign" data-value="b">${escapeHtml(names.b)}</button>
              </div>`
            : ""
        }
      `;

      card.addEventListener("click", (e) => {
        if (e.target.closest('[data-action="delete"]')) {
          e.stopPropagation();
          removeNote(note.id);
          return;
        }
        if (e.target.closest('[data-action="preview"]')) {
          e.stopPropagation();
          openLightbox(photos[0].dataUrl);
          return;
        }
        const assignBtn = e.target.closest('[data-action="assign"]');
        if (assignBtn) {
          e.stopPropagation();
          note.owner = assignBtn.dataset.value;
          note.updatedAt = Date.now();
          saveLocalNotes();
          pushRemote(note);
          render();
          showToast(`Tagged as ${getOwnerNames()[assignBtn.dataset.value]}`);
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

// ---------------------------------------------------------------
// photos
// ---------------------------------------------------------------

function resizeImage(file, maxDim = 1400, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round(height * (maxDim / width));
            width = maxDim;
          } else {
            width = Math.round(width * (maxDim / height));
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Couldn't read that image"));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Couldn't read that file"));
    reader.readAsDataURL(file);
  });
}

function renderPhotoStrip() {
  photoStrip.innerHTML = "";
  if (draftPhotos.length === 0) {
    photoStrip.hidden = true;
    return;
  }
  photoStrip.hidden = false;
  draftPhotos.forEach((p) => {
    const wrap = document.createElement("div");
    wrap.className = "photo-thumb";
    wrap.innerHTML = `<img src="${p.dataUrl}" alt="" data-action="preview" /><button type="button" class="photo-remove" data-id="${p.id}" aria-label="Remove photo">✕</button>`;
    photoStrip.appendChild(wrap);
  });
}

photoStrip.addEventListener("click", (e) => {
  const removeBtn = e.target.closest(".photo-remove");
  if (removeBtn) {
    draftPhotos = draftPhotos.filter((p) => p.id !== removeBtn.dataset.id);
    renderPhotoStrip();
    return;
  }
  const img = e.target.closest('img[data-action="preview"]');
  if (img) openLightbox(img.src);
});

// -- full-size photo lightbox --

function openLightbox(dataUrl) {
  lightboxImg.src = dataUrl;
  lightbox.hidden = false;
}
function closeLightbox() {
  lightbox.hidden = true;
  lightboxImg.src = "";
}
lightboxClose.addEventListener("click", closeLightbox);
lightbox.addEventListener("click", (e) => {
  if (e.target === lightbox) closeLightbox();
});

addPhotoBtn.addEventListener("click", () => photoInput.click());

photoInput.addEventListener("change", async (e) => {
  const files = [...e.target.files];
  for (const file of files) {
    try {
      const dataUrl = await resizeImage(file);
      draftPhotos.push({ id: crypto.randomUUID(), dataUrl });
    } catch (err) {
      console.error(err);
      showToast("Couldn't add one of those photos");
    }
  }
  renderPhotoStrip();
  photoInput.value = "";
});

// ---------------------------------------------------------------
// owner sections (Me / Them tabs + names)
// ---------------------------------------------------------------

function getOwnerNames() {
  try {
    const raw = localStorage.getItem(OWNER_NAMES_KEY);
    return raw ? JSON.parse(raw) : { a: "Me", b: "Them" };
  } catch {
    return { a: "Me", b: "Them" };
  }
}

function setOwnerNames(names) {
  localStorage.setItem(OWNER_NAMES_KEY, JSON.stringify(names));
}

function applyOwnerNames() {
  const names = getOwnerNames();
  ownerTabs.querySelector('[data-owner="a"]').textContent = names.a;
  ownerTabs.querySelector('[data-owner="b"]').textContent = names.b;
  ownerPicker.querySelector('[data-owner="a"]').textContent = names.a;
  ownerPicker.querySelector('[data-owner="b"]').textContent = names.b;
}

function setOwnerFilter(value) {
  ownerFilter = value;
  localStorage.setItem(OWNER_FILTER_KEY, value);
  [...ownerTabs.children].forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.owner === value)
  );
  render();
}

ownerTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".owner-tab");
  if (!btn) return;
  setOwnerFilter(btn.dataset.owner);
});

ownerPicker.addEventListener("click", (e) => {
  const btn = e.target.closest(".owner-pill");
  if (!btn) return;
  draftOwner = draftOwner === btn.dataset.owner ? null : btn.dataset.owner;
  [...ownerPicker.querySelectorAll(".owner-pill")].forEach((el) =>
    el.classList.toggle("selected", el.dataset.owner === draftOwner)
  );
});

namesBtn.addEventListener("click", () => {
  const names = getOwnerNames();
  ownerAInput.value = names.a;
  ownerBInput.value = names.b;
  namesModalScrim.hidden = false;
  setTimeout(() => ownerAInput.focus(), 30);
});
cancelNamesBtn.addEventListener("click", () => (namesModalScrim.hidden = true));
namesModalScrim.addEventListener("click", (e) => {
  if (e.target === namesModalScrim) namesModalScrim.hidden = true;
});
saveNamesBtn.addEventListener("click", () => {
  const a = ownerAInput.value.trim() || "Me";
  const b = ownerBInput.value.trim() || "Them";
  setOwnerNames({ a, b });
  applyOwnerNames();
  pushOwnerNames();
  namesModalScrim.hidden = true;
  showToast(
    syncState === "on" ? "Section names updated — synced to both phones" : "Section names updated on this device"
  );
});

// ---------------------------------------------------------------
// editor open/close
// ---------------------------------------------------------------

function openEditor(noteId) {
  activeNoteId = noteId || null;
  const note = notes.find((n) => n.id === noteId);

  titleInput.value = note ? note.title : "";
  contentInput.value = note ? note.content : "";
  selectedColor = note ? note.color || "none" : "none";
  pinnedDraft = note ? !!note.pinned : false;
  draftPhotos = note && note.photos ? note.photos.map((p) => ({ ...p })) : [];
  renderPhotoStrip();

  // New notes default to whichever section tab is currently active.
  draftOwner = note ? note.owner || null : ownerFilter !== "all" ? ownerFilter : null;
  [...ownerPicker.querySelectorAll(".owner-pill")].forEach((el) =>
    el.classList.toggle("selected", el.dataset.owner === draftOwner)
  );

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
  draftPhotos = [];
  draftOwner = null;
}

function saveNote() {
  const title = titleInput.value.trim();
  const content = contentInput.value.trim();
  if (!title && !content && draftPhotos.length === 0) {
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
    note.photos = draftPhotos;
    note.owner = draftOwner;
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
      photos: draftPhotos,
      owner: draftOwner,
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
    if (!lightbox.hidden) { closeLightbox(); return; }
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

    // keep "Me"/"Them" section names in sync between both phones
    const namesRef = doc(collection(db, "rooms", roomCode, "meta"), "ownerNames");
    if (ownerNamesUnsub) ownerNamesUnsub();

    ownerNamesUnsub = onSnapshot(
      namesRef,
      (snap) => {
        if (snap.exists()) {
          const remote = snap.data();
          const local = getOwnerNames();
          if (remote.a !== local.a || remote.b !== local.b) {
            setOwnerNames({ a: remote.a, b: remote.b });
            applyOwnerNames();
          }
        } else {
          // nothing shared yet — publish this device's names as the starting point
          pushOwnerNames();
        }
      },
      (err) => console.error("owner name sync error", err)
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

function pushOwnerNames() {
  if (syncState !== "on" || !db || !window.__aurora) return;
  const { doc, setDoc, collection } = window.__aurora;
  const ref = doc(collection(db, "rooms", roomCode, "meta"), "ownerNames");
  const names = getOwnerNames();
  setDoc(ref, { ...names, updatedAt: Date.now() }).catch((err) =>
    console.error("owner name push failed", err)
  );
}

function deleteRemote(id) {
  if (syncState !== "on" || !db || !window.__aurora) return;
  const { doc, deleteDoc, collection } = window.__aurora;
  const ref = doc(collection(db, "rooms", roomCode, "notes"), id);
  deleteDoc(ref).catch((err) => console.error("sync delete failed", err));
}

// ---------------------------------------------------------------
// app lock (PIN + optional device biometrics)
// ---------------------------------------------------------------
// Stored locally only: a salted SHA-256 hash of the PIN, never the PIN
// itself. Biometrics use the device's own platform authenticator
// (Face ID / fingerprint / Windows Hello) purely as a local unlock
// gate — there's no server here to verify the signature against, the
// same way a phone's own lock screen doesn't "verify" with anyone.

function getLockConfig() {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setLockConfig(cfg) {
  localStorage.setItem(LOCK_KEY, JSON.stringify(cfg));
}

function clearLockConfig() {
  localStorage.removeItem(LOCK_KEY);
}

function randomHex(byteLength) {
  const arr = crypto.getRandomValues(new Uint8Array(byteLength));
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPin(pin, saltHex) {
  const data = new TextEncoder().encode(saltHex + ":" + pin);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function biometricAvailable() {
  if (!window.PublicKeyCredential || !PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
    return false;
  }
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function bufToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function base64ToBuf(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
}

async function registerBiometric() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Aurora Notes" },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: "aurora-user",
        displayName: "Aurora",
      },
      pubKeyCredParams: [
        { alg: -7, type: "public-key" },
        { alg: -257, type: "public-key" },
      ],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
      timeout: 60000,
    },
  });
  return cred ? bufToBase64(cred.rawId) : null;
}

async function verifyBiometric(credentialIdBase64) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ id: base64ToBuf(credentialIdBase64), type: "public-key" }],
      userVerification: "required",
      timeout: 60000,
    },
  });
  return !!assertion;
}

function updateLockDot() {
  lockDot.className = "dot " + (getLockConfig() ? "on" : "off");
}

// -- lock settings modal --

async function openLockModal() {
  const cfg = getLockConfig();
  newPinInput.value = "";
  confirmPinInput.value = "";
  lockSetupError.hidden = true;

  const canBiometric = await biometricAvailable();

  if (cfg) {
    lockSetupView.hidden = true;
    lockManageView.hidden = false;
    removeLockBtn.hidden = false;
    saveLockBtn.textContent = "Done";
    biometricRowManage.hidden = !canBiometric;
    biometricToggleManage.checked = !!cfg.credentialId;
  } else {
    lockSetupView.hidden = false;
    lockManageView.hidden = true;
    removeLockBtn.hidden = true;
    saveLockBtn.textContent = "Turn on lock";
    biometricRow.hidden = !canBiometric;
    biometricToggle.checked = false;
  }

  lockModalScrim.hidden = false;
  if (!cfg) setTimeout(() => newPinInput.focus(), 30);
}

function closeLockModal() {
  lockModalScrim.hidden = true;
}

function showChangePinView() {
  lockManageView.hidden = true;
  lockSetupView.hidden = false;
  newPinInput.value = "";
  confirmPinInput.value = "";
  lockSetupError.hidden = true;
  saveLockBtn.textContent = "Update PIN";
  setTimeout(() => newPinInput.focus(), 30);
}

lockSettingsBtn.addEventListener("click", openLockModal);
cancelLockBtn.addEventListener("click", closeLockModal);
changePinBtn.addEventListener("click", showChangePinView);
lockModalScrim.addEventListener("click", (e) => {
  if (e.target === lockModalScrim) closeLockModal();
});

saveLockBtn.addEventListener("click", async () => {
  // Manage view with no PIN change in progress — just persist the biometric toggle.
  if (!lockManageView.hidden) {
    const cfg = getLockConfig();
    if (!cfg) return closeLockModal();

    if (biometricToggleManage.checked && !cfg.credentialId) {
      try {
        const credentialId = await registerBiometric();
        cfg.credentialId = credentialId;
        setLockConfig(cfg);
        showToast("Biometric unlock turned on");
      } catch (err) {
        console.error(err);
        biometricToggleManage.checked = false;
        showToast("Couldn't set up biometrics on this device");
      }
    } else if (!biometricToggleManage.checked && cfg.credentialId) {
      cfg.credentialId = null;
      setLockConfig(cfg);
    }
    closeLockModal();
    return;
  }

  // Setup / change-PIN view.
  const pin = newPinInput.value.trim();
  const confirm = confirmPinInput.value.trim();

  if (!/^\d{4,8}$/.test(pin)) {
    lockSetupError.textContent = "PIN must be 4–8 digits.";
    lockSetupError.hidden = false;
    return;
  }
  if (pin !== confirm) {
    lockSetupError.textContent = "PINs don't match.";
    lockSetupError.hidden = false;
    return;
  }

  const saltHex = randomHex(16);
  const hashHex = await hashPin(pin, saltHex);
  const existing = getLockConfig();
  const cfg = {
    saltHex,
    hashHex,
    length: pin.length,
    credentialId: existing ? existing.credentialId : null,
  };

  if (!existing && biometricToggle.checked) {
    try {
      cfg.credentialId = await registerBiometric();
    } catch (err) {
      console.error(err);
      showToast("Couldn't set up biometrics — PIN lock is still on");
    }
  }

  setLockConfig(cfg);
  sessionStorage.setItem(UNLOCK_SESSION_KEY, "1"); // don't immediately re-lock the device that just set this up
  updateLockDot();
  closeLockModal();
  showToast(existing ? "PIN updated" : "App lock turned on");
});

removeLockBtn.addEventListener("click", () => {
  clearLockConfig();
  sessionStorage.removeItem(UNLOCK_SESSION_KEY);
  updateLockDot();
  closeLockModal();
  showToast("App lock turned off");
});

// -- lock screen --

function setPinDots(count) {
  pinDots.innerHTML = "";
  const total = Math.max(count, 4);
  for (let i = 0; i < total; i++) {
    const dot = document.createElement("span");
    if (i < count) dot.classList.add("filled");
    pinDots.appendChild(dot);
  }
}

function shakeAndClear(message) {
  lockError.textContent = message;
  lockError.hidden = false;
  pinDots.classList.add("shake");
  setTimeout(() => pinDots.classList.remove("shake"), 400);
  pinBuffer = "";
  setPinDots(0);
}

async function tryUnlockWithPin() {
  const cfg = getLockConfig();
  if (!cfg) return;
  const hash = await hashPin(pinBuffer, cfg.saltHex);
  if (hash === cfg.hashHex) {
    unlockApp();
  } else {
    shakeAndClear("Wrong PIN — try again");
  }
}

keypad.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-key]");
  if (!btn) return;
  const key = btn.dataset.key;
  const cfg = getLockConfig();
  if (!cfg) return;

  lockError.hidden = true;

  if (key === "back") {
    pinBuffer = pinBuffer.slice(0, -1);
    setPinDots(pinBuffer.length);
    return;
  }

  if (pinBuffer.length >= cfg.length) return;
  pinBuffer += key;
  setPinDots(pinBuffer.length);

  if (pinBuffer.length === cfg.length) {
    tryUnlockWithPin();
  }
});

document.addEventListener("keydown", (e) => {
  if (lockScreen.hidden) return;
  if (/^\d$/.test(e.key)) {
    keypad.querySelector(`button[data-key="${e.key}"]`)?.click();
  } else if (e.key === "Backspace") {
    keypad.querySelector('button[data-key="back"]')?.click();
  }
});

biometricBtn.addEventListener("click", attemptBiometricUnlock);

async function attemptBiometricUnlock() {
  const cfg = getLockConfig();
  if (!cfg || !cfg.credentialId) return;
  try {
    const ok = await verifyBiometric(cfg.credentialId);
    if (ok) unlockApp();
  } catch (err) {
    console.error(err);
    // user cancelled or it failed — they can fall back to the PIN pad
  }
}

function showLockScreen(auto = true) {
  const cfg = getLockConfig();
  if (!cfg) return;
  pinBuffer = "";
  setPinDots(0);
  lockError.hidden = true;
  lockScreenSub.textContent = cfg.credentialId ? "Enter your PIN or use biometrics" : "Enter your PIN to continue";
  biometricBtn.hidden = !cfg.credentialId;
  lockScreen.hidden = false;
  if (auto && cfg.credentialId) attemptBiometricUnlock();
}

function hideLockScreen() {
  lockScreen.hidden = true;
}

function unlockApp() {
  hideLockScreen();
  sessionStorage.setItem(UNLOCK_SESSION_KEY, "1");
  if (!appStarted) {
    appStarted = true;
    completeInit();
  }
}

// Re-lock after the app has been backgrounded for a while, WhatsApp-style.
document.addEventListener("visibilitychange", () => {
  const cfg = getLockConfig();
  if (!cfg) return;

  if (document.hidden) {
    clearTimeout(lockBackgroundTimer);
    lockBackgroundTimer = setTimeout(() => {
      sessionStorage.removeItem(UNLOCK_SESSION_KEY);
    }, LOCK_GRACE_MS);
  } else {
    clearTimeout(lockBackgroundTimer);
    if (sessionStorage.getItem(UNLOCK_SESSION_KEY) !== "1") {
      showLockScreen();
    }
  }
});

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

function completeInit() {
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
}

function init() {
  applyTimePhase();
  setInterval(applyTimePhase, 5 * 60 * 1000); // recheck every 5 min in case the app stays open
  paintStars();
  updateLockDot();
  applyOwnerNames();
  [...ownerTabs.children].forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.owner === ownerFilter)
  );

  const cfg = getLockConfig();
  const alreadyUnlocked = sessionStorage.getItem(UNLOCK_SESSION_KEY) === "1";

  if (cfg && !alreadyUnlocked) {
    showLockScreen();
  } else {
    appStarted = true;
    completeInit();
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

init();
