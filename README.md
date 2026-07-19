# Aurora — a notes app for the two of you

A small, glassy notes app: pinboard of glass cards over a drifting dusk sky,
soft pastel tags, pinning, search, and optional real-time sync between your
two phones.

## Files

```
index.html          the page
style.css            all styling (glassmorphism, colors, layout)
app.js                notes logic, editor, search, sync
firebase-config.js    your cloud sync keys go here (optional)
manifest.json          makes it installable as an app
sw.js                    offline support
icon-192.png / icon-512.png   app icon
```

## Try it right now

You don't need to set anything up to start using it. Just open
`index.html` in a browser — notes save to that device automatically.
Nothing else is required for it to work as a private, single-device
notes app.

## Turning it into an "app" you can download

Browsers can only install a site as an app (and only sync in real time
across devices) once it's served over `https://`, not opened as a local
file. The easiest free way to do that:

1. Create a free account at [Netlify](https://app.netlify.com) (or
   [Vercel](https://vercel.com), or use **GitHub Pages** if you already
   have GitHub).
2. Drag the whole `notes-app` folder onto Netlify's "Deploy manually"
   box. It gives you a URL like `https://your-app-name.netlify.app`.
3. Open that URL on both of your phones.
4. On iPhone: Share button → **Add to Home Screen**.
   On Android/Chrome: menu (⋮) → **Install app**, or you'll see an
   install icon in the address bar on desktop.

It'll now sit on the home screen with its own icon, open full-screen
with no browser bar, and keep working offline.

## Turning on sync between your two phones

This is optional — the app works great locally without it. Sync lets
a note either of you write show up on the other's phone within a
second or two.

1. Go to the [Firebase console](https://console.firebase.google.com)
   and create a new project (free).
2. In the left sidebar: **Build → Firestore Database → Create
   database**. Choose "Start in test mode" — that's fine for a small
   private app just between the two of you.
3. Click the ⚙️ gear icon → **Project settings**, scroll to
   "Your apps", click the `</>` (web) icon, and register an app
   (any nickname is fine, you don't need Firebase Hosting).
4. It'll show you a `firebaseConfig` object. Copy those values into
   `firebase-config.js` in this project, replacing the placeholder
   text.
5. Re-deploy (or just re-upload the folder if you're using Netlify's
   drag-and-drop).
6. Open the app, tap the cloud icon in the header, and tap
   **Generate one** to make a shared code (something like
   `moonlit-harbor-42`). Tap **Connect**.
7. On the other phone, open the app, tap the cloud icon, type in the
   exact same code, and tap **Connect**.

Both phones are now sharing one space. The dot on the cloud icon turns
green when connected.

> Test mode Firestore rules expire after 30 days and are open to
> anyone with the project's keys — fine for a low-stakes personal
> project, but if you want it locked down long-term, you can tighten
> the rules in the Firebase console under Firestore → Rules later.

## Using the app

- **New note** — top right button, or the button on the empty state.
- **Edit** — tap any note to open it.
- **Delete** — hover a note for the trash icon, or open it and tap
  Delete.
- **Pin** — the pin icon inside the editor keeps a note at the top.
- **Color tag** — pick a soft color at the bottom of the editor.
- **Search** — the search bar filters by title and content as you
  type.
- **Save shortcut** — ⌘/Ctrl + Enter while writing a note.

## Making it feel more like "yours"

A few easy things to personalize in `app.js` and `index.html`:

- The app name ("Aurora") and tagline are in `index.html` near the
  top of `<body>`.
- The color palette (`COLORS` in `app.js`) can have names or hex
  values swapped for ones you like better.
- The moon/star icon can be regenerated in any style — just replace
  `icon-192.png` and `icon-512.png` with your own square images.
