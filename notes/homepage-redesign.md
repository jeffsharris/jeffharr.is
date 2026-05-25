# Homepage Redesign — Proposal

A concrete plan for up-leveling `jeffharr.is/` to the same editorial polish as
`/poems` and `/dharma`. Intended as a complete brief for an implementing
agent.

---

## 1. The strategic gap

The sub-pages succeed because each one is a **visual world** built around
generated imagery in a specific painterly vocabulary (Burbea's "imaginal night
garden," Watts's "zen modernist," Brensilver's "pastoral dawn," and one
hand-painted scene per poem). The homepage today is a 420px-wide white card
with a 100×100 profile photo and six off-the-shelf platform logos in a 3×2
grid. Visitors who came in from `/poems` or `/dharma` feel a tonal drop when
they land on home.

The fix is to make the homepage **the master of the same design language** — an
editorial hero introducing Jeff, a gallery of image-led "collection" tiles for
the things he's made (Poems, Dharma, Read Later, Substack), and a quiet
"elsewhere" footer for generic external links. Every collection tile is its
own generated scene in its own visual vocabulary, exactly like the dharma
teacher tiles. The result: home feels like the lobby of a museum that's been
curated by the same hand that designed each room.

A second, important point: stop treating "Jeff's curated collections" and
"Jeff's profiles on third-party platforms" as the same thing. GitHub /
Goodreads / Letterboxd are not destinations Jeff designed — they're places
his data lives. They deserve a smaller, quieter treatment than Poems / Dharma
/ Read Later.

---

## 2. Page structure

```
┌─────────────────────────────────────────────────────────────────┐
│                       [theme toggle]                            │
│                                                                 │
│              ┌──────────────────────────────┐                  │
│              │      EDITORIAL HERO          │                  │
│              │   (portrait + introduction)  │                  │
│              └──────────────────────────────┘                  │
│                                                                 │
│              ──  Collections  ──                                │
│                                                                 │
│        ┌─────────┐  ┌─────────┐  ┌─────────┐                   │
│        │  POEMS  │  │ DHARMA  │  │  READ   │                   │
│        │  tile   │  │  tile   │  │  LATER  │                   │
│        └─────────┘  └─────────┘  └─────────┘                   │
│                                                                 │
│              ──  Lately  ──                                     │
│                                                                 │
│   ┌────┐ ┌────┐ ┌──────────────────┐                           │
│   │book│ │film│ │  commit / tweet  │                           │
│   └────┘ └────┘ └──────────────────┘                           │
│   ┌──────────────────┐ ┌────┐ ┌────┐                           │
│   │  commit / tweet  │ │book│ │film│                           │
│   └──────────────────┘ └────┘ └────┘                           │
│                                                                 │
│              ──  Elsewhere  ──                                  │
│                                                                 │
│   substack · linkedin · youtube · instagram · x                 │
└─────────────────────────────────────────────────────────────────┘
```

Four zones, top to bottom.

### A. The hero

- Centered, ~720px wide, generous top padding (`72–96px`).
- One eyebrow line above the title: `JEFF HARRIS` in 12px tracked-out
  uppercase (the same eyebrow pattern the dharma page uses for `DHARMA`).
- Tagline ("Building things, raising humans, tending my inner and outer
  worlds.") rendered in **Cormorant Garamond** italic at
  `clamp(1.8rem, 4vw, 2.6rem)`, with one phrase italicized in the accent
  color: *"Building things, raising humans, tending my **inner and outer
  worlds**."*
- A **larger** profile portrait — 160×160 on desktop, with the same soft
  vignette/halo used on dharma tiles. The current 140px source is too small;
  needs either a 640px re-export or an editorial generation (see §5.6).
- A single understated CTA line below the tagline: 1–2 short links rendered
  as plain prose-style underlined text — e.g. *"Currently building at OpenAI
  · writing weekly at Waking Patiently →"* — so the hero feels like a
  magazine bio block, not a profile card.

### B. The Collections gallery

- A responsive grid: `repeat(auto-fit, minmax(280px, 1fr))` with `gap: 32px`,
  max-width `1080px`. Three tiles will sit ~340px wide on desktop, which
  reads as poster-like and feels curated rather than dashboard-like.
- Each tile is the **portrait 2:3 image-led card pattern** from `/dharma` —
  see §4.2.
- Order: **Poems, Dharma, Read Later**. Collections is reserved for
  *living* curated bodies of work — not platforms where Jeff has a
  profile, and not dormant projects.
- Below each tile's image, a one-line meta caption matching the dharma
  pattern: `<count>` + `<noun>` (e.g. "55 poems," "3 teachers,"
  "127 saved").
- A section label above the grid: `—  Collections  —` rendered as a centered
  eyebrow.

*(Joybox is intentionally **not** included — it's an unlisted page.
Substack is intentionally **not** here either — it's been dormant since
~2021 and lives in Elsewhere instead. If Jeff resumes writing there
regularly, promote it back to a fourth tile.)*

### C. The Lately mosaic

An editorial mosaic between Collections and Elsewhere showing what Jeff's
been into recently. See §6 for the full spec. The shape: a single section,
single eyebrow (`—  Lately  —`), six cards total in an asymmetric bento
grid (2 book covers, 2 film posters, 2 textual cards from the merged
GitHub/X pool sorted by recency).

### D. The Elsewhere footer

- A single horizontal row of small text links separated by hairline dots
  (the existing `secondary-links__dot` pattern works — just expand it to
  include all generic platforms).
- 12–13px, muted color, hover to accent.
- No icons. This is intentional — visual silence here is the whole point.
- Order: `Substack · LinkedIn · YouTube · Instagram · X`.
  - Substack is here (not Collections) because the publication is
    currently dormant; it's a place Jeff has written, not a place he's
    writing.
- GitHub, Goodreads, and Letterboxd are *not* in Elsewhere — they have
  inline previews in Lately (which is more honest than a link to their
  generic UIs).

### What changes about the side panel

The current 3×2 social-button grid is replaced by the Collections gallery
+ Lately mosaic + Elsewhere row. The slide-in panel goes away entirely —
Lately handles the "preview before going out" job for the sources that
needed it. See §6.8 for the deletion list.

---

## 3. Visual design system

Borrow the editorial palette already established in `/poems` and `/dharma`
so the three pages feel like one publication.

### 3.1 Color tokens

**Light mode** (warm paper):

```
--bg:             #F8F6F1   /* warm off-white, splits poems & dharma */
--bg-elev:        #FFFFFF   /* tiles, hero card */
--bg-sunken:      #F1EEE8   /* subtle wells / dividers */
--ink:            #1F1B17   /* primary text, warmer than current #1A1A1A */
--ink-muted:      #6B645B
--ink-light:      #9A938A
--line:           rgba(31, 27, 23, 0.10)
--accent:         #6F5743   /* warm umber — pulled from /poems */
--accent-strong:  #523F2F
--accent-soft:    rgba(111, 87, 67, 0.10)
--shadow-soft:    0 4px 18px rgba(31, 27, 23, 0.06)
--shadow-lift:    0 16px 40px rgba(31, 27, 23, 0.14)
```

**Dark mode** (deep umber, not pure black):

```
--bg:             #14110E
--bg-elev:        #1F1B17
--bg-sunken:      #100D0B
--ink:            #ECE5D9
--ink-muted:      #A89E8E
--ink-light:      #6F665A
--line:           rgba(236, 229, 217, 0.10)
--accent:         #C9A877   /* warm brass — matches /poems dark */
--accent-strong:  #DBBE8E
--accent-soft:    rgba(201, 168, 119, 0.14)
--shadow-soft:    0 4px 18px rgba(0, 0, 0, 0.36)
--shadow-lift:    0 18px 44px rgba(0, 0, 0, 0.55)
```

**Per-collection accents and halos** (one set per tile, used in the soft
glow behind the card on hover — see §4.2). These should derive from the
dominant palette of each collection's generated image so the halo feels
like the painting is leaking off the canvas.

| Collection  | `--tile-accent` | `--tile-halo` (two radial gradients)                                                         |
|-------------|-----------------|----------------------------------------------------------------------------------------------|
| Poems       | `#B98856`       | warm rose + amber (`rgba(185, 137, 71, 0.55)` + `rgba(216, 122, 105, 0.35)`)                |
| Dharma      | `#6A6FA5`       | indigo + brass (matches existing burbea palette)                                             |
| Read Later  | `#4F8C7B`       | sea-green + paper (`rgba(79, 140, 123, 0.50)` + `rgba(199, 173, 122, 0.30)`)                |

### 3.2 Typography

Three-font system (already loaded today, just used differently):

| Role               | Font                       | Weight | Size                                |
|--------------------|----------------------------|--------|-------------------------------------|
| Eyebrow / meta     | Inter                      | 600    | 11–12px, 0.20em tracking, uppercase |
| Hero tagline       | Cormorant Garamond italic  | 500    | `clamp(1.8rem, 4vw, 2.6rem)`, 1.15  |
| Tile title         | Cormorant Garamond         | 600    | 1.55rem, line 1.12                  |
| Body / chrome      | Inter                      | 400/500| 14–15px, line 1.5                   |
| Footer / elsewhere | Inter                      | 500    | 13px                                |

**Drop Sora entirely from this page.** Inter handles the chrome and Cormorant
handles every editorial moment. Sora was a holdover from the more "product-y"
original design and it fights with the editorial sub-pages.

### 3.3 Spacing & radius

- Tile radius: `18px` (matches `/dharma`)
- Hero card radius: `24px` (large enough to feel deliberate, not just rounded)
- Tile image internal radius: continuous with the outer — no inner crop
- Section gaps: `64–80px` between hero / collections / elsewhere
- Page side padding: `clamp(20px, 4vw, 32px)`
- Page max width: `1180px`

### 3.4 Background

Keep the existing `.bg-gradient` + `.bg-noise` pattern, but **retune the
gradient stops** to use warm umber, deep indigo, and sea-green instead of the
current rose/lavender/blue (which fight the warm paper palette):

```css
.bg-gradient {
  background:
    radial-gradient(ellipse 80% 50% at 18% 35%, rgba(185, 137, 71, 0.10), transparent),
    radial-gradient(ellipse 60% 45% at 82% 18%, rgba(106, 111, 165, 0.07), transparent),
    radial-gradient(ellipse 55% 40% at 50% 82%, rgba(79, 140, 123, 0.08), transparent);
}
```

Keep `.bg-noise` at `opacity: 0.30`. Both already work.

### 3.5 Motion

- All transitions: `220ms cubic-bezier(0.22, 0.61, 0.36, 1)` (matches dharma
  tiles)
- Tile hover: `translateY(-4px)`, halo opacity 0.5 → 0.85, image
  `scale(1.025)`, accent border
- Profile portrait hover: `scale(1.03)` (already in place)
- Initial load: existing `fadeIn` works; consider staggering tile entrances
  by 60ms each for a small editorial flourish

---

## 4. Component specs

### 4.1 Hero

```html
<header class="hero">
  <img class="hero__portrait" src="/images/jeff-portrait.jpg" alt="Jeff Harris" width="160" height="160">
  <span class="hero__eyebrow">Jeff Harris</span>
  <p class="hero__tagline">
    Building things, raising humans, tending my <em>inner and outer worlds</em>.
  </p>
  <p class="hero__bio">
    Currently building at <a href="…">OpenAI</a>. Writing weekly at <a href="…">Waking Patiently ↗</a>.
  </p>
</header>
```

- `.hero__portrait`: 160×160, `border-radius: 50%`, `box-shadow:
  var(--shadow-soft)`, with a 1px inner ring (`box-shadow: inset 0 0 0 1px
  rgba(255,255,255,0.08)`) so it doesn't sit too flat on the paper.
- `.hero__eyebrow`: Inter 600, 12px, `letter-spacing: 0.22em`,
  `text-transform: uppercase`, color `--ink-muted`, `margin: 18px 0 14px`.
- `.hero__tagline`: as specified in §3.2, `max-width: 22ch`, center-aligned.
  The `em` color is `--accent-strong`.
- `.hero__bio`: 14px, `--ink-muted`, links underlined with
  `text-underline-offset: 3px` and `text-decoration-color: var(--line)`;
  hover swaps decoration color to accent.

### 4.2 Collection tile (the key component)

```html
<a class="collection-tile collection-tile--poems"
   href="/poems/"
   data-count-src="/poems/manifest.json"
   data-count-noun="poems">
  <div class="collection-tile__image-wrap">
    <img class="collection-tile__image"
         src="/images/collections/poems-tile.jpg"
         alt="" loading="lazy" decoding="async">
  </div>
  <div class="collection-tile__caption">
    <h2 class="collection-tile__name">Poems</h2>
    <span class="collection-tile__meta">
      <span data-count>—</span> poems
    </span>
  </div>
</a>
```

CSS scaffold, modeled on `.tile` in `/dharma`:

```css
.collection-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  isolation: isolate;
  border-radius: 18px;
  overflow: hidden;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-soft);
  text-decoration: none;
  color: inherit;
  transition: transform 320ms cubic-bezier(.22,.61,.36,1),
              box-shadow 320ms ease,
              border-color 320ms ease;
}

.collection-tile::before {
  content: '';
  position: absolute;
  inset: -32px;
  z-index: -1;
  border-radius: 28px;
  background: var(--tile-halo, transparent);
  filter: blur(44px);
  opacity: 0.5;
  transition: opacity 320ms ease, transform 320ms ease;
}

.collection-tile:hover {
  transform: translateY(-4px);
  border-color: var(--tile-accent);
  box-shadow: var(--shadow-lift);
}
.collection-tile:hover::before { opacity: 0.85; transform: scale(1.04); }

.collection-tile__image-wrap { aspect-ratio: 2 / 3; overflow: hidden; background: var(--tile-bg); }
.collection-tile__image      { width: 100%; height: 100%; object-fit: cover; transition: transform 600ms ease, filter 500ms ease; }
.collection-tile:hover .collection-tile__image { transform: scale(1.025); filter: saturate(1.04); }

.collection-tile__caption { padding: 18px 20px 20px; background: var(--bg-elev); border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 4px; }
.collection-tile__name    { font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 600; font-size: 1.55rem; line-height: 1.12; margin: 0; }
.collection-tile__meta    { font-size: 11px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: var(--ink-muted); }
.collection-tile__meta [data-count] { font-variant-numeric: tabular-nums; color: var(--tile-accent); }
```

This is the same DNA as `/dharma`'s tile — that's the point. Each tile gets
its `--tile-accent`, `--tile-halo`, and `--tile-bg` via a modifier class
(`.collection-tile--poems`, etc.) — values per §3.1.

### 4.3 Elsewhere row

```html
<nav class="elsewhere" aria-label="Elsewhere on the web">
  <a href="https://linkedin.com/in/jeffreysharris">LinkedIn</a>
  <span class="elsewhere__dot"></span>
  <a href="https://github.com/…">GitHub</a>
  <span class="elsewhere__dot"></span>
  …
</nav>
```

CSS reuses the current `.secondary-links` rules essentially as-is. Add a 13px
section eyebrow `—  Elsewhere  —` above it, centered, muted color.

### 4.4 Count fetching

Generic `data-count-src` + `data-count-noun` pattern on each tile, processed
by a small init script (~20 lines, same shape as the dharma index script).

| Tile        | Source                                   | Counting rule                                       |
|-------------|------------------------------------------|-----------------------------------------------------|
| Poems       | `/poems/manifest.json`                   | `memorized.length + learning.length`                |
| Dharma      | sum of `/dharma/{teacher}/talks.json`    | or static `3 teachers`                              |
| Read Later  | existing read-later API if available     | else static label                                   |

If a count can't be fetched, the script hides the meta line — same fallback
the dharma tiles already use.

---

## 5. Image generation guidelines

Each Collection tile gets one **portrait 2:3 painted scene** that captures
the spirit of that collection in its own visual vocabulary, with the
bottom-right quarter intentionally quiet — exactly like the dharma teacher
tiles, because the same script (made more generic — see §6.3) can produce
these.

### 5.1 Common scaffolding (every prompt starts with this)

```
Editorial illustration. Portrait orientation, 2:3 aspect ratio, 1024x1536.
Hand-painted feel with soft paper texture; gentle gradients; no harsh
outlines. Restrained, palette-aware composition that leaves the bottom-
right quarter visually quiet and uncluttered — a soft empty area suitable
for hosting a small square inset. No text, no logos, no human figures, no
captions, no brand marks. Avoid AI-generic "fantasy art" gloss, lens
flares, or chromatic aberration; aim for a printed magazine cover
sensibility.
```

That negative scaffolding matters as much as the positive — it's what keeps
the existing dharma tiles out of "generic AI fantasy" territory.

### 5.2 Per-collection prompts

**Poems** — *library at dusk, words half-remembered*:

```
{scaffolding}
A warm interior at the blue hour: an open book on a wooden table, a slender
glass of water catching the last light, a single pressed flower between the
pages, an open window with linen curtains stirring. Outside, an indistinct
landscape — hills, a small road. Palette: warm rose-amber, soft umber,
parchment cream, with one breath of dusty blue from the window. The mood
is intimate, contemplative, the moment just before a poem is read aloud.
```

Halo: rose + amber. Accent: `#B98856`.

**Dharma** — *the listener's seat*:

```
{scaffolding}
A simple wooden seat at the edge of a temple veranda overlooking an
imaginal night garden: distant indigo hills, white star-flowers near the
foreground, a faint luminous path winding into the distance, a half-moon
held high. No figure on the seat. Palette: deep indigo, black-green,
pearl white, muted gold. The mood is reverent and spacious — the seat
seems to be saved for the listener.
```

Halo: indigo + brass. Accent: `#6A6FA5`. *(Deliberately echoes the existing
Burbea tile vocabulary, since Burbea is the spiritual center of the dharma
section.)*

**Read Later** — *the unread pile, lovingly*:

```
{scaffolding}
A quiet still life on a sea-green linen surface: a small stack of folded
periodicals and a paperback with a ribbon bookmark, an enameled cup half
full of tea, a fountain pen resting beside a notepad with a single
handwritten line. A small jar holds a sprig of rosemary. Soft afternoon
light from the left. Palette: sea-green, oat-cream, warm ochre, charcoal.
The mood is unhurried — the feeling of "I'll come back to this."
```

Halo: sea-green + paper. Accent: `#4F8C7B`.

*(A Substack tile prompt — "the writing desk" — was previously sketched
here. Removed because Substack moved to Elsewhere. The prompt is kept in
git history if needed when Substack gets promoted back to Collections.)*

### 5.3 Why this template works

Three constraints unify the whole gallery:

1. **Same canvas:** all 1024×1536 portrait, all hand-painted/editorial, all
   "object scenes" (never figures, never type, never landscape-only). The
   tiles read as a *series of magazine plates*.
2. **Same negative space rule:** the bottom-right quarter is always quiet.
   This (a) gives the tile caption room to breathe in alternate layouts,
   and (b) lets you composite a small inset later if you ever want a
   homepage-tile equivalent of the dharma-teacher-inset pattern.
3. **Distinct palettes:** each collection owns one warm-axis + one
   cool-axis pair. Together they cover an editorial spread without
   clashing, because every palette includes the shared cream/ivory/charcoal
   neutrals.

### 5.4 Generation workflow

Use the renamed generic tile script — see §6.3. Generate **3–5 candidates
per tile** into `tmp/tile-candidates/{slug}/`, pick the best one by eye,
copy the chosen one to `images/collections/{slug}-tile.jpg`. (Same review
pattern as the poem-image workflow.) The chosen prompts live in
`images/collections/tiles.json` (and analogously `dharma/tiles.json`) so
they're regenerable.

### 5.5 Iterating on a tile

When a tile feels off, the dial that almost always helps is **specificity
of objects, not specificity of style**. "A book and a flower" → "an open
book on a wooden table, a slender glass of water catching the last light, a
single pressed flower between the pages." The dharma prompts are good
precisely because they name concrete things ("pearl-white star clusters,"
"muted gold seed-lights"). Apply the same instinct here.

### 5.6 Editorial portrait of Jeff for the hero

The current `images/profile.jpg` is 140×140 — too small to render crisply
at 160px @ 2x DPR. Two paths:

- **A. Safe re-export.** Re-export the original sky-lantern photo at
  640×640 (same image, just larger). 15-minute fix; recognizable.
- **B. Painted version of a source photo.** Use OpenAI's image-edit
  endpoint (`images/edits` or the Responses API image-generation tool with
  image input) to transform a chosen source photo into a painted editorial
  portrait in the gallery's visual vocabulary. This makes the whole
  homepage feel like a single piece.

Recommendation: ship **A** first, then iterate on **B** once the tiles are
in place so you can judge the portrait against them.

For path **B**, here are three prompt variants at increasing levels of
direction. Use whichever feels right for the source photo. All assume the
source image is sent as the reference / mask input.

**Variant 1 — minimal, trust the model.** Best when the source photo is
already strong and you mostly want a medium change:

```
Reimagine this photograph as a softly painted editorial portrait in a
warm, contemplative palette of umber, cream, and one quiet accent color
drawn from the original scene. Preserve the subject's likeness and the
spirit of the original moment. Let the painted treatment be loose and
confident — like a magazine cover by an artist who understands restraint.
The composition should still work when cropped to a circle. No text.
```

**Variant 2 — series-aware.** Best when you want the portrait to obviously
belong to the same family as the collection tiles:

```
Reimagine this photograph as one piece in a series of painted editorial
portraits. The series favors hand-painted texture, warm paper tones, and
moments of stillness — never glossy or photorealistic. Preserve the
subject's likeness clearly. Keep the palette warm: umber, cream, ochre,
with one quiet accent color drawn from the original image. The
composition should read well at small sizes and inside a circular crop.
No text, no overt filters, no AI-fantasy gloss.
```

**Variant 3 — keep / change / avoid.** Most directive; best when an
earlier pass drifted too far from the source:

```
Make a painted editorial portrait based on this photograph.

Keep: the subject's likeness, posture, gaze, and the meaningful objects
in their hands. Keep the warmth and intimacy of the original moment.

Change: replace photographic detail with confident hand-painted
brushwork; warm the palette toward umber, cream, and ochre with one quiet
accent drawn from the original scene; soften backgrounds into atmospheric
color rather than literal detail.

Avoid: glossy AI-fantasy aesthetic, anime stylization, harsh outlines,
filters, lens flares, captions or text of any kind.

The result should feel like a portrait painted for the cover of a small
literary magazine. It should still work when cropped to a circle.
```

**Technical notes for path B:**

- Endpoint: `POST /v1/images/edits` with the source as `image` (or the
  Responses API image-generation tool with image input).
- Size: 1024×1024 (the hero crop is circular, so square input is ideal).
- Generate 4–6 candidates per source photo; the dial that tends to need
  most adjustment between runs is *how loosely* the model paints — if a
  pass looks too photographic, add "looser brushwork, less photographic
  detail" to the prompt; if it looks too painterly to recognize, add
  "preserve the subject's facial structure and gaze precisely."
- Source photo choice matters more than prompt: pick one with clear
  facial light, a recognizable gesture or object, and a non-busy
  background.

---

## 6. Lately — inline activity mosaic

A single editorial mosaic between Collections and Elsewhere showing what
Jeff's been into recently. The discipline that keeps this from becoming a
dashboard:

- **One zone, one eyebrow.** Single header (`—  Lately  —`); no per-source
  labels like "Reading" / "Watching" / "Building."
- **Hard cap at 6 cards.** Don't let the section grow over time.
- **Hand-tuned mix.** 2 books, 2 films, 2 textual cards from the merged
  GitHub/X pool sorted by recency. Never deviate.
- **Source attribution is small.** A single lowercase monogram in the card
  corner (`g` Goodreads, `l` Letterboxd, `h` GitHub, `x` X) tinted to
  that source's accent.
- **Click goes to source.** No hover preview, no panel pop-up, no
  secondary surface — that's the whole point.

### 6.1 Slot allocation

| Slot pair        | Source                                                     |
|------------------|------------------------------------------------------------|
| 1–2: Reading     | 2 latest Goodreads books                                   |
| 3–4: Watching    | 2 latest Letterboxd films                                  |
| 5–6: Building/Writing | 2 latest items from merged `[GitHub, X]`, sorted by `publishedAt` desc |

The bottom pair is *recency-sorted across the two writing/building
sources*. Both are active today: GitHub is essentially always populated
(daily commits), and X is wired via a daily cron (§6.6). In practice the
row will show a mix of recent commits and recent tweets depending on
which Jeff posted most recently. No special priority — most recent wins.

### 6.2 Why no per-row eyebrows

A "Reading" / "Watching" / "Building" labeling scheme would (a) advertise
that the writing slot is currently empty and (b) add three eyebrows where
one does the job. The corner monogram + card shape (cover image vs.
poster vs. textual card) already make the source self-evident. Trust the
reader.

### 6.3 Empty-state handling

The fetcher contract:

1. Each source returns 0..N candidates with a `publishedAt` timestamp.
2. The mixer fills fixed slots: 2 from `goodreads`, 2 from `letterboxd`,
   2 from the merged `[github, x]` pool sorted by `publishedAt`.
3. If a fixed slot can't be filled (e.g. Goodreads down), the mixer
   borrows from the merged pool to fill 6 total.
4. If everything is short, the mixer silently shows fewer cards rather
   than placeholder skeletons.

Lately should *never* render a "couldn't load" state. Either it shows
something or it shows nothing — both are honest.

### 6.4 Item specs

#### Book item (Goodreads)

```
┌──────────┐
│          │  ← cover image, aspect 2:3
│  cover   │      monogram [g] top-right
│          │
└──────────┘
The Master and Margarita
Mikhail Bulgakov
★★★★½
```

- Cover: `aspect-ratio: 2/3`, `border-radius: 8px`, `box-shadow: var(--shadow-soft)`.
- Title: Cormorant 600, 15px, `-webkit-line-clamp: 2`.
- Author: Inter 500, 11px tracked uppercase, `--ink-muted`.
- Rating: small star row in `--accent`, 11px (omit if no rating).
- Monogram `g`: 11px Inter 600, top-right of cover, `opacity: 0.7`,
  background tint `rgba(135, 80, 40, 0.6)` (Goodreads brown) in a 16px
  square with `border-radius: 4px`.

#### Film item (Letterboxd)

Identical shape and treatment to book item — substitute film poster,
director instead of author, optional star rating. Monogram `l` with
Letterboxd green tint.

#### Commit item (GitHub)

```
┌──────────────────────────────────────┐
│  jeffharr.is                    [h]  │  ← repo as eyebrow
│                                      │
│  Centralize Dharma identity matching │  ← commit message, Cormorant
│                                      │
│  1123afb · 2 days ago                │  ← sha + relative time, mono
└──────────────────────────────────────┘
```

- Wider, landscape, no image. Spans 2 grid cells.
- Repo name: Inter 600, 11px tracked uppercase, `--accent`.
- Commit message: Cormorant 500, 17px, `-webkit-line-clamp: 2`.
- Sha + time: JetBrains Mono / Fira Code, 11px, `--ink-light`.
- `border-left: 3px solid var(--accent-soft)` to anchor textual cards
  visually against the colorful poster cards beside them.

#### Tweet item (X)

```
┌──────────────────────────────────────┐
│  @jeffintime · 2 days ago      [x]   │
│                                      │
│  the trick of writing well isn't     │
│  having ideas — it's noticing which  │
│  ideas of yours are actually yours.  │
└──────────────────────────────────────┘
```

- Wider, landscape, no image hero (most of Jeff's tweets are text).
- Handle + relative time: Inter 600, 11px tracked uppercase, `--accent`.
- Tweet body: Cormorant 500, 16px, `-webkit-line-clamp: 4`.
- Same `border-left: 3px solid var(--accent-soft)` anchor as commit
  items.
- If a tweet has an image attached, render with a small (40×40)
  thumbnail inset top-right.
- If a tweet is image-dominant with little/no text (rare for Jeff per
  what we know), fall back to a larger thumbnail and use any alt text
  as the body. Don't render a thread-style multi-tweet card — just the
  root tweet.

### 6.5 Visual layout

```
┌─────┐ ┌─────┐ ┌─────────────────────────┐
│book │ │film │ │   commit / post / tweet │
└─────┘ └─────┘ └─────────────────────────┘
┌─────────────────────────┐ ┌─────┐ ┌─────┐
│   commit / post / tweet │ │book │ │film │
└─────────────────────────┘ └─────┘ └─────┘
```

- 6-column grid on desktop. Image cards span 1 column; textual cards
  span 3.
- The recency-sorted textual cards interleave with image cards rather
  than stacking — image-text-image creates visual rhythm and avoids the
  "spreadsheet of feeds" feel.
- On tablet (~720–960px): 4-column grid; textual cards span 2.
- On mobile (≤480px): single column. Image cards collapse to landscape
  strips (small cover thumbnail on left, title on right). Textual cards
  stay full-width.
- Quiet hover: `translateY(-2px)` + shadow lift only. No image scaling
  — these aren't the hero tiles.

### 6.6 X integration — daily Cloudflare cron

The existing Cloudflare worker (the one with the X API key, currently
used by `/share` and `/read-later`) is the right home for this. Add a
daily cron handler that pulls Jeff's recent tweets and caches them in
KV. The Lately mixer reads from a small endpoint that returns the
cached JSON.

**Cron handler** (in the existing worker, or a sibling worker):

```js
// Triggered daily at 12:00 UTC via wrangler.toml cron trigger
export default {
  async scheduled(event, env, ctx) {
    const userId = env.X_USER_ID;          // numeric ID for @jeffintime
    const params = new URLSearchParams({
      max_results: '20',
      exclude: 'replies,retweets',
      'tweet.fields': 'created_at,attachments,entities',
      'media.fields': 'url,preview_image_url,alt_text',
      expansions: 'attachments.media_keys',
    });
    const res = await fetch(
      `https://api.x.com/2/users/${userId}/tweets?${params}`,
      { headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` } }
    );
    if (!res.ok) return; // silent failure; previous KV stays
    const body = await res.json();

    const tweets = (body.data || []).map((t) => ({
      id: t.id,
      text: t.text,
      publishedAt: t.created_at,
      url: `https://x.com/jeffintime/status/${t.id}`,
      media: extractMedia(t, body.includes),
    }));

    await env.LATELY_KV.put('lately:x', JSON.stringify({
      tweets,
      fetchedAt: new Date().toISOString(),
    }));
  },
};
```

**Read endpoint** — `GET /api/lately/x` returns the cached array. The
Lately mixer fetches this just like the Goodreads/Letterboxd/GitHub
sources.

**`wrangler.toml` addition:**

```toml
[triggers]
crons = ["0 12 * * *"]

[[kv_namespaces]]
binding = "LATELY_KV"
id = "..."
```

**Filtering** — `exclude=replies,retweets` keeps the feed to original
posts only. Replies are conversational and don't surface well in a
"lately" mosaic; RTs aren't Jeff's voice. Easy to revisit if you want
either back in.

**Why daily and not hourly:** tweets aren't time-sensitive enough to
need faster refresh. Daily is plenty for "what Jeff's been saying
lately." Also keeps the worker invocation count + X API usage trivially
low.

**Why KV and not D1:** small list, no transactions, no queries — KV is
the right shape. One key (`lately:x`), one JSON blob, ~5KB max.

### 6.7 Goodreads / Letterboxd / GitHub fetch notes

Existing panel infrastructure already fetches Goodreads, Letterboxd,
and GitHub. The Lately mixer should reuse those fetcher modules rather
than rewriting them.

| Source     | Feed                                                                         | Cache  |
|------------|------------------------------------------------------------------------------|--------|
| Goodreads  | `https://www.goodreads.com/review/list_rss/<user_id>?shelf=read`             | hourly |
| Letterboxd | `https://letterboxd.com/<username>/rss/`                                     | hourly |
| GitHub     | `https://api.github.com/users/<username>/events/public` (filter to PushEvent)| 30 min |
| X          | KV cache populated by daily cron (see §6.6)                                  | daily  |

All four should be served via the existing Cloudflare Workers
infrastructure. Hourly cache + server-side rendering keeps the page
fast and resilient when a source is briefly down.

### 6.8 What to delete from the existing panel

With Lately handling preview duties, the slide-in panel is no longer
needed. Delete:

- `js/panel.js`
- `js/main.js` panel-related event wiring (keep theme toggle)
- `aside.panel`, `.panel-overlay`, and `.panel__*` markup in `index.html`
- All `.panel*`, `.content-item*`, `.film*`, `.x-profile-card*` rules
  in `css/style.css` (the latter classes were panel-only)

The existing fetcher modules (whatever currently populates the panel's
Goodreads / Letterboxd / GitHub views) **stay** — they become the
backing data sources for Lately. Move them to a shared `js/feeds/`
directory if they aren't already, since they're now consumed by a
non-panel surface.

---

## 7. The tile-image generator (rename, generalize, relocate)

`scripts/generate-dharma-tiles.py` already does almost exactly what the
homepage needs. It just needs to (a) lose its Dharma-only identity, (b)
move its data out of the script body and into per-collection JSON configs,
and (c) make the inset-compositing step opt-in.

### 7.1 Renaming and reshaping

| Old | New |
|---|---|
| `scripts/generate-dharma-tiles.py` | `scripts/build-tile-images.py` |
| inline `TILES` dict in the script | `*/tiles.json` next to each output dir |
| inset compositing always runs | opt-in per spec via `inset` keys |

`build-tile-images.py` matches the existing `build-*` naming convention in
`scripts/` (`build-burbea-feed.py`, `build-poem-image-prompts.js`, etc.).

### 7.2 Where each config lives

Co-locate each config with its output, so a future agent looking at
`dharma/` or `images/collections/` sees the prompts that produced what
they're seeing.

```
dharma/
  tiles.json                          # Brensilver / Burbea / Watts specs
  brensilver/artwork/brensilver-tile.jpg
  burbea/artwork/burbea-tile.jpg
  watts/artwork/watts-tile.jpg

images/
  collections/
    tiles.json                        # Poems / Dharma / Read Later / Substack
    poems-tile.jpg
    dharma-tile.jpg
    read-later-tile.jpg
    substack-tile.jpg
```

### 7.3 `tiles.json` schema

```json
{
  "tiles": [
    {
      "slug": "burbea",
      "name": "Rob Burbea",
      "output": "dharma/burbea/artwork/burbea-tile.jpg",
      "backdrop": "dharma/burbea/artwork/burbea-tile-backdrop.jpg",
      "size": "1024x1536",
      "prompt": "Editorial illustration in Imaginal Night Garden style. …",
      "inset": {
        "source": "dharma/burbea/artwork/rob-burbea-podcast-cover.jpg",
        "size": 460,
        "margin": 60,
        "frame": 10,
        "corner_radius": 18,
        "shadow_blur": 36,
        "shadow_offset_y": 20,
        "shadow_opacity": 140
      }
    },
    {
      "slug": "poems",
      "name": "Poems",
      "output": "images/collections/poems-tile.jpg",
      "size": "1024x1536",
      "prompt": "Editorial illustration. … A warm interior at the blue hour: …"
    }
  ]
}
```

Tiles **with** an `inset` block run the composite step (dharma teacher
pattern). Tiles **without** it stop after the backdrop is generated
(homepage collection pattern). Same script, two modes.

### 7.4 CLI

```
scripts/build-tile-images.py                              # process all known tiles.json files
scripts/build-tile-images.py --config dharma/tiles.json   # one config file
scripts/build-tile-images.py --slug burbea                # one tile by slug (auto-discovers config)
scripts/build-tile-images.py --slug poems --force         # regenerate even if output exists
scripts/build-tile-images.py --slug watts --composite-only # skip backdrop generation
```

"All known" can be discovered by globbing the repo for `tiles.json` (or by
a small explicit list at the top of the script — pick whichever feels
nicer).

### 7.5 Behaviors to preserve from the existing script

- Model fallback chain: `gpt-image-2` → `gpt-image-1.5` → `gpt-image-1`.
- HTTP retries with exponential backoff on 429/5xx.
- `OPENAI_API_KEY` env var required for generation; `--composite-only`
  must work without it.
- Output as JPEG, quality `high`.
- `--force` overrides existing files; default is "skip if exists".

---

## 8. Notes for the implementing agent

Suggested execution order:

1. **Generalize the tile-image script** (§7). Do this first so the rest
   of the work can use it without modification.
2. **Generate tile images** — adapt the prompts in §5 into
   `images/collections/tiles.json`, run the script, review 3–5 candidates
   per tile in `tmp/tile-candidates/{slug}/`, commit the winners to
   `images/collections/*.jpg`. This is the long pole.
3. **Profile portrait** — start with §5.6 path A (re-export at 640×640).
   Defer path B (painted portrait) until after tiles ship.
4. **Extract the feed fetchers** — the existing panel JS already pulls
   Goodreads, Letterboxd, GitHub. Move those fetcher modules into a
   shared `js/feeds/` directory so they can be consumed by the Lately
   mixer instead of being panel-private.
5. **Wire the X cron + endpoint** (§6.6) — add a daily `scheduled`
   handler to the existing Cloudflare worker that has the X API key
   (used by `/share` and `/read-later`), bind a KV namespace
   `LATELY_KV`, and add a `GET /api/lately/x` read endpoint that returns
   the cached JSON. Add a `js/feeds/x.js` module that hits that
   endpoint. Manually invoke the cron once after deploy to seed the KV
   (no need to wait for first scheduled run).
6. **Build the Lately mixer** (`js/lately.js`) — fetches all 4 sources
   in parallel, applies the slot-allocation rules from §6.1, handles
   empty states per §6.3, renders the bento grid into a
   `<section id="lately">` placeholder in `index.html`.
7. **Rewrite `index.html`** to the four-zone structure in §2 (hero,
   Collections, Lately, Elsewhere). Use semantic landmarks (`<header>`,
   `<nav>`, `<section>`, `<footer>`). Keep `.bg-gradient` / `.bg-noise`
   / theme-toggle markup as-is — they work.
8. **Rewrite `css/style.css`** — most of it can go. Keep theme-toggle
   and bg-gradient/noise rules. Replace `.card`, `.profile`,
   `.social-grid`, `.social-btn` with the new hero, collection-tile,
   lately-card, and elsewhere components per §4 and §6.4. Update color
   tokens per §3.1; drop Sora from the `<link>`; retune the gradient per
   §3.4.
9. **Delete the side panel** per §6.8 (`js/panel.js`, panel markup,
   panel CSS rules, `.content-item*` / `.film*` / `.x-profile-card*`).
10. **Add a tiny `data-count` init script** for Collection tiles,
    modeled on `/dharma/index.html`'s inline script.
11. **Cache-bust** `style.css?v=` and any image URLs per repo convention.
12. **Visual QA** on at minimum: 1440px desktop, 768px tablet, 390px
    mobile, and dark mode at each. Collection tile grid should sit
    3-up on desktop, 2-up at ~720px, 1-up at ~480px. Lately grid:
    6 cols → 4 cols (textual cards span 2) → 1 col with image cards as
    landscape strips. Hero should never feel "lost in space."
13. **Don't write any onboarding / CLAUDE.md / new markdown notes**
    about the redesign unless asked. The `tiles.json` configs are the
    one "documentation" artifact, and they're operationally useful for
    regeneration.

---

## 9. Deliberate non-goals

- **No new content sections.** This proposal restages what's already on
  the site; it doesn't propose adding a `/writing` or `/projects` or
  `/talks` section. Those are separate decisions.
- **No Joybox surfacing.** Joybox is unlisted and stays unlisted.
- **No analytics / tracking changes.** Out of scope.
- **No information-architecture changes to the sub-pages.** `/poems` and
  `/dharma` stay exactly as they are — the homepage is being brought up
  to *their* level, not the other way around.
- **No animation budget.** A small entrance fade and hover lift is all.
  Anything fancier (parallax, scroll-tied effects) would fight the
  editorial-magazine tone.

---

## 10. Addendum — Review of the implemented redesign (2026-05-25)

Notes from walking through the shipped site on 1440px desktop and 390px
mobile, both light and dark, plus a read of `index.html`, `js/lately.js`,
`css/style.css`, `images/collections/tiles.json`, and the
`functions/api/*` feed endpoints.

### 10.1 What landed beautifully

- **The three Collection tiles are doing exactly the job they were meant
  to do.** Poems (warm interior at the blue hour), Dharma (the listener's
  bench under a half-moon, with white star-flowers exactly as specced),
  and Read Later (sea-green linen still life with rosemary). They read
  as a coherent series even though each is its own visual world. The
  bottom-right negative space holds; nothing feels cluttered.
- **The editorial portrait of Jeff is excellent.** It survives a tight
  circular crop, the painterly brushwork is confident, and the small
  brass accent in the background quietly ties to the homepage palette.
  Path B from §5.6 was the right call — much better than re-exporting
  the sky-lantern photo would have been.
- **The hero composition** — eyebrow / italic tagline with a single
  accented phrase / one-line bio with two understated links — is exactly
  the editorial bio block it was meant to be.
- **Staggered fade-in delays** (hero 0ms / Collections 80ms / Lately
  140ms / footer 180ms) give a small editorial flourish without feeling
  fancy. The `prefers-reduced-motion` guard at the bottom of the
  stylesheet is the right safety net.
- **The portrait halo** (`.hero__portrait-halo`) wasn't in the proposal
  — it's a soft warm radial behind Jeff's head. Beautiful detail in
  light mode; check it in dark too (it may want a slightly different
  blend mode there).
- **`.lately-grid:empty { display: none; }`** is exactly the right
  graceful-degradation rule. If all four feeds fail, the section
  disappears rather than rendering an empty bento.
- **Mobile layout** does the right thing: collection tiles stack
  full-width and stay poster-shaped; lately book/film cards collapse to
  landscape strips with a 92px cover thumbnail on the left. Reads well
  without scroll-fatigue.
- **The `lately-card--media` placeholder fallback** (initials in
  Cormorant on a muted ground) is a tasteful empty state. Even when it
  fires (see §10.3), the page doesn't feel broken.

### 10.2 What's specced but didn't land

- **X / tweets are not actually fetched.** `functions/api/x.js` is still
  a stub that returns only `{handle, name, profileUrl, profileImageUrl}`
  — no `tweets` array. The Lately mixer plumbs tweet normalization and
  rendering correctly, but no tweet ever arrives, so the Building /
  Writing row is currently 100% GitHub commits. To finish the §6.6
  spec: add the daily `scheduled` handler that hits the X API, store in
  KV (or wherever the existing `/share` worker already keeps state),
  and update `/api/x` to return `{ tweets: [...] }`.
- **The tile-image script was not renamed or generalized.**
  `scripts/generate-dharma-tiles.py` still exists Dharma-only, and
  `images/collections/tiles.json` exists but no script reads it. The
  three homepage tiles must have been generated by hand or via an
  ad-hoc invocation. If they ever need regenerating, that's a manual
  process today. Per §7, fold this into one
  `scripts/build-tile-images.py` that reads any `tiles.json` (including
  the existing Dharma tiles) and makes the inset step opt-in. Worth
  doing before the next time you want a new tile.
- **Hero CTA copy uses static markup**, not data. Fine for now; just
  noting that "Currently building at OpenAI" is hardcoded in
  `index.html` and will need a hand-edit when that changes.

### 10.3 Bugs to fix

1. **Letterboxd posters return `null` for every entry.** Verified by
   hitting `/api/letterboxd` directly — `entries[*].poster` is null
   across the board. Both Marty Supreme and Bad Santa fall back to the
   "MS" / "BS" Cormorant placeholders, which look intentional but
   aren't. The HTML selector in
   `functions/api/letterboxd.js → parseFilmsHtml()` has broken or
   Letterboxd changed their markup. **High visual impact** — the
   placeholders break the "image-led mosaic" intent of Lately. This is
   probably the single highest-leverage fix.

2. **Goodreads URLs are CDATA-wrapped.** From `/api/goodreads` the
   `recentlyRead[0].url` field is:
   `"<![CDATA[https://www.goodreads.com/review/show/8589373718?...]]>"` —
   literal `<![CDATA[...]]>` markers in the string. The RSS XML parser
   isn't stripping CDATA on the `<link>` element. Clicking a book card
   either fails or routes through `safeUrl()` to a fallback. Patch the
   parser in `functions/api/goodreads.js` to strip CDATA, then
   double-check the book card click destinations.

3. **OG image aspect mismatch.** `<meta property="og:image">` now points
   to `/images/jeff-editorial-portrait.png` (1024×1024 square). Most
   social previews (Twitter, LinkedIn, iMessage) expect ~1.91:1 and will
   crop the square awkwardly — likely cutting Jeff's forehead and chin.
   Generate a dedicated landscape OG card (1536×1024 or 1200×630) that
   echoes the homepage hero feel: portrait inset on one side, italic
   tagline rendered as part of the image, warm-paper palette. The
   existing `dharma-preview.jpg` is the pattern.

4. **Editorial portrait is PNG (725KB).** JPG at quality 88 would be
   ~150–250KB with no visible quality loss for a painterly image. Same
   visual asset, faster first paint.

### 10.4 Polish opportunities (smaller calls)

- **Letterboxd monogram green (`#00A86B`) is too saturated** for the
  warm-paper palette. It's the only neon-bright color anywhere on the
  page. Try `#4F8C7B` (the Read Later sea-green) for harmony, or a
  muted Letterboxd-adjacent forest tone like `#3D7A5F`. Same for
  Goodreads `#875028` — works, but tilting it warmer toward `#B98856`
  (the Poems tile accent) would unify the row.
- **`.lately-card__source` opacity 0.82** with `color-mix(...76%, #1F1B17)`
  for background — the X monogram pill in light mode comes out as a
  muddy almost-black square. In dark mode it inverts to almost-white.
  Both work but the contrast isn't quite editorial-feeling. Try a
  consistent low-saturation neutral pill (`--bg-sunken` with the source
  color used only on the letter itself) for a quieter result.
- **Goodreads card cover image hover state is missing.** Collection
  tiles get a subtle `scale(1.025)` + saturation bump on hover. Lately
  cards just shadow-lift. A gentle image scale on the media cards
  (matching the collection-tile pattern) would tie them visually to
  Collections.
- **Read Later count "66 reading"** comes through correctly — good. The
  static fallback was `"Saved" reading` which would have read awkwardly;
  the live count is much better. Worth a sanity-check that
  `/api/read-later` count stays accurate.
- **Hero portrait halo in dark mode** — at light-mode bg `#F8F6F1` the
  warm radial sits beautifully; at dark-mode bg `#14110E` the
  `rgba(201, 168, 119, 0.24)` may be too bright. Worth a side-by-side
  check; if it pops, drop opacity 30–40% in the dark theme.
- **Substack moved to Elsewhere correctly**, but the existing
  `functions/api/substack.js` endpoint is still live (and fetches the
  RSS feed). It's unused now. Either: (a) remove the endpoint, or
  (b) leave it as a no-op for the day Substack gets promoted back to
  Collections. Either's fine; just don't forget.

### 10.5 Things worth considering for v2

- **A subtle "last updated" relative time on Lately items**, or none at
  all? The commit cards show `c8d0ff8 · today` in a mono font — nice
  for code, but the book/film cards have no time signal. Consider
  surfacing "read 2 days ago" / "watched yesterday" in the eyebrow
  position, in the same Inter-tracked style as the existing metadata.
  Helps tell the recency story without adding visual noise.
- **A small JSON-LD `Person` block in `<head>`** for SEO — name,
  jobTitle, url, image, sameAs links to LinkedIn / X / GitHub / Goodreads
  / Letterboxd / Substack. Cheap, helps search engines render rich
  results, and slots cleanly into the editorial framing.
- **Once X is wired, consider showing tweet thumbnails (40×40)** when a
  tweet has media. The §6.4 spec mentions it; the renderer in
  `lately.js` already extracts `tweet.media[0].url` — just needs CSS
  for the inset thumbnail on the text card.
- **The Dharma teacher tiles** (`/dharma/`) and the new homepage tiles
  are visually first cousins, but the Dharma tiles still have the
  composited podcast-cover inset in the bottom-right. If
  `build-tile-images.py` ever gets built (§10.2), it'd be tempting to
  add an optional inset to the homepage tiles too — a tiny circular
  Jeff portrait in Poems' bottom-right corner, for example, as a quiet
  signature. Worth experimenting with, but not necessary.
- **Lately could grow a "View more" affordance** to a `/elsewhere/` or
  `/recently/` page that consolidates all four feeds in a long, scrollable
  editorial view (the deferred Pattern C from the original side-panel
  discussion). Not needed now — homepage Lately is doing its job — but
  if you find yourself wanting to surface more than 6 items, that's the
  natural next move.

### 10.6 Net assessment

This is a substantial level-up. The page now feels like the lobby of
the museum that `/poems` and `/dharma` set up rooms inside. The two
real misses are (a) X never wired up and (b) Letterboxd posters
broken — both are mechanical fixes, not design problems. Once those
land, the page is essentially done and can sit untouched for a long
time.

---

## 11. Addendum — UX polish pass (2026-05-25)

Follow-up after the implemented redesign expanded Lately to ~12 items
across seven buckets and added `Read` / `Reading` / `Watched` /
`Watchlist` / `Saved` / `Commit` / `Post` labels on every card. Three
issues called out: (1) GitHub commit cards too big and undifferentiated,
(2) `lately-links` footer felt misaligned, (3) labels competed with
titles for visual weight.

### 11.1 What this pass changed

- **GitHub gets a single, distinct heatmap-summary card** (replaces the
  per-commit text cards in the rotation). `functions/api/github.js` now
  scrapes `github.com/users/<u>/contributions` and returns `{ days,
  totalContributions, rangeStart, rangeEnd }` alongside commits.
  `js/lately.js` synthesizes one `type: 'github'` item that combines a
  26-week heatmap with the latest commit message + sha · time line.
  Cells are tinted in warm umber (light) / brass (dark) to match the
  site palette rather than GitHub's neon green — the `h` monogram still
  identifies the source. Days padded so columns start on Sunday and end
  on Saturday (GitHub convention). Card spans 2 columns at desktop;
  collapses to full width on mobile.
- **Labels merged into a quieter `lately-card__credit` line** on media
  cards. Was: a separate uppercase tracked `lately-card__label` element
  reading "WATCHED" / "READ" / etc. above the title. Now: combined with
  the byline into one italic Cormorant line — "Read · Adyashanti",
  "Watched · 2025", "Saved · personfamiliar.com". Tertiary in the
  hierarchy; title is now unambiguously the dominant element.
- **Tweet cards drop the `Post` label** entirely (the handle
  `@jeffintime` + monogram badge `x` already convey source). Topline is
  now just `@handle · relative time` baseline-aligned.
- **Text card sizing freed.** Removed `min-height: 208px` from
  `.lately-card--text` and the `margin-top: auto` + `padding-top: 18px`
  from `.lately-card--github .lately-text-card__detail`. Cards now size
  to their content; no more huge empty cards with detail line floating
  at the bottom.
- **`.lately-links` differentiated from `.elsewhere`.** Added a `MORE
  ON` eyebrow-style prefix in tracked uppercase Inter, dropped link size
  to 12px and color to `--ink-light`, shrunk the dots to 2px. Visually
  reads as a footer for the Lately section rather than a second
  Elsewhere row.
- **Goodreads CDATA leakage fixed.** `extractTag()` regex now tolerates
  whitespace around `<![CDATA[ … ]]>` boundaries, and the fallback path
  strips lingering markers from matched content. Book card click URLs
  will now route to the real Goodreads review pages instead of getting
  swallowed by `safeUrl()`.
- **OG / portrait already addressed by the implementer:**
  `images/jeff-editorial-portrait.png` was re-encoded as `.jpg` and the
  `og:image` meta updated. (Still square; landscape OG card remains a
  follow-up.)

### 11.2 Heatmap card data shape

```js
// what the renderer expects
{
  type: 'github',
  source: 'github',
  label: 'Building',
  title: 'Refine Lately footer links',   // latest commit message
  repo: 'jeffharr.is',                    // latest commit's repo
  detail: 'df62764 · today',              // sha · relative time
  days: [{ date: '2025-11-27', level: 0 }, { date: '', level: 0, blank: true }, …],
  caption: '936 contributions · last year',
  url: 'https://github.com/jeffsharris/jeffharr.is/commit/df62764…',
  publishedAt: '2026-05-25T01:50:19Z'
}
```

The `blank: true` cells are padding so the leftmost column always starts
on Sunday and the rightmost column always ends on Saturday. They render
as transparent — the heatmap visually "begins" mid-column where the data
actually starts.

### 11.3 Still pending

- **Letterboxd posters.** Verified locally: scraping the films page now
  returns a Cloudflare interstitial (the `Just a moment…` challenge
  page) for non-browser User-Agents. From a Cloudflare Worker IP it
  appears to pass through to the actual HTML but the poster attributes
  the scraper looks for (`data-image-url`, `data-film-id`,
  `data-postered-identifier`) aren't reliably present in the new
  markup — title / year / rating still parse, but `poster: null` for
  most entries. The RSS feed (`/jeffharris/rss/`) doesn't help: it's
  empty for this user (only diary entries appear there). Two reasonable
  paths: (a) re-derive the scraper against current Letterboxd HTML by
  inspecting what attributes survive, (b) switch to TMDB API (with a
  film-name search) for poster lookup, decoupling from Letterboxd's
  markup entirely.
- **OG image landscape variant.** §10.3 item 3 stands. Square portrait
  will still crop awkwardly on Twitter / iMessage.
- **Tile-image script generalization** (§7) still pending — homepage
  tiles remain ad-hoc regenerable.
- **Tweet thumbnails** — `lately.js` extracts `media[0].url` but the
  renderer doesn't show it. Add a small (40×40) thumbnail inset to
  `.lately-card--x` when present (§10.5).

### 11.4 What I'd recommend looking at after deploy

1. **Heatmap card on mobile.** At ~340px column width on desktop the
   heatmap cells are ~11px each; at full mobile width (~340–390px) the
   cells get a touch chunkier and the card reads beautifully. Verify
   nothing wraps or overflows at the 4-col tablet breakpoint where the
   card is at its narrowest.
2. **Credit line truncation.** "Saved · christian-gonzales-eponymous-…"
   uses `white-space: nowrap` + `text-overflow: ellipsis`. If publisher
   strings are long, they'll truncate to a single line rather than wrap;
   verify that looks intentional rather than broken.
3. **Heatmap dark mode contrast.** The level-0 (no contributions) cells
   are `rgba(236, 229, 217, 0.06)` — very faint against `#14110E`. Verify
   the inactive grid is visible enough to read as "the empty days" rather
   than disappearing into the card background. If invisible, bump opacity
   to ~0.10.
4. **The 'MORE ON' lately-links prefix** is a small typographic choice;
   if it reads as fussy or labels-y, an alternative is to drop the
   prefix and just rely on size/color differentiation from `.elsewhere`.
