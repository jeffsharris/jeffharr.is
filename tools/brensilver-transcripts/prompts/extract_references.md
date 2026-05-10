You are extracting reference moments from corrected transcripts of Matthew
Brensilver Dharma talks.

Return only JSON. Do not include markdown, commentary, or extra text.

The user does not need exact quote clipping. The user wants a reference database
that can answer questions like:

- Which talks mention Ajahn Chah, and what teaching or story did Matthew draw
  from?
- Which poems, books, scriptures, or writers recur?
- Where should the listener jump in the talk to hear the reference in context?
- How does Matthew use the reference inside the Dharma teaching?

Reference moment policy:

- Extract holistic reference moments, not isolated quote fragments.
- A reference moment may span 30 seconds to several minutes when Matthew names a
  source, speaks in his own words, returns to the source, then comments on it.
- Include attribution segments. If the author/work is named 30-90 seconds before
  the most memorable line, include that earlier segment id and set the reference
  start there.
- Consolidate adjacent mentions of the same person/work into one reference when
  they are part of the same teaching movement.
- Do not split a person mention and work mention into separate references when
  they belong together. Prefer one reference with both `person` and `work_title`.
- Do not invent authors, titles, or exact quotations.
- If Matthew says "a poet", "a yogi", "a teacher", or "someone" and no name is
  supplied, leave `person` null and set `needs_review` true.
- Keep uncertainty explicit. Use `needs_review` when attribution, work title, or
  span boundary is unclear.

Required JSON keys:

- references: array of objects with:
  - reference_type: one of direct_quote, paraphrase, story, person_mention,
    work_mention, teaching_reference, tradition_reference
  - person: canonical person/source name, or null
  - person_role: short role such as Buddhist teacher, poet, psychoanalyst,
    scripture, tradition, or null
  - work_title: title of poem/book/article/scripture/talk if present, or null
  - work_type: poem, book, article, scripture, talk, story, teaching, or null
  - reference_title: short title for this reference moment
  - reference_annotation: 1-3 sentences explaining what Matthew is drawing from
    and how it functions in the talk
  - selected_material: concise description of the part/aspect/lines/story he
    uses; this is not required to be verbatim
  - attribution_cue: transcript phrase that identifies the source or signals the
    attribution
  - segment_ids: all supporting segment ids, including attribution and selected
    material
  - start: earliest start seconds from supporting segments
  - end: latest end seconds from supporting segments
  - confidence: number from 0 to 1
  - needs_review: boolean
- people: array of objects with name, role, aliases, and segment_ids.
- works: array of objects with title, creator, work_type, and segment_ids.
- concepts: array of objects with name, aliases, and segment_ids.
- uncertain_references: array of objects with text, reason, segment_ids, and
  timestamp_range.

Every reference must include segment ids and timestamps that allow the user to
jump to the whole relevant moment in the talk.
