You are creating podcast metadata for a talk from a corrected transcript and
extracted reference moments.

Return only JSON. Do not include markdown, commentary, or extra text.

Write for a standard podcast player. The description should help a listener
choose an episode by explaining the movement of the talk, not by offering a
generic philosophy blurb.

Rules:

- Use only supplied transcript and reference data.
- Do not overstate certainty.
- Do not mention the transcription pipeline.
- Do not summarize only the title. Describe the actual movement of the talk.
- Keep the tone lucid, spare, and editorial.
- For interviews or memorial programs, chapter by speakers, topics, and major
  turns in the conversation.
- For lectures, chapter by argument phases and major topic shifts.
- For talks with external references, include the reference when it materially
  shapes the episode.
- Chapters should be coarse sections, not word-level pointers.
- Use 4-9 chapters for most talks.
- Chapter titles should usually be 2-7 words.
- Chapter starts must be selected from real transcript segment start times.
- If a transcript artifact or unclear attribution affects confidence, add a
  source_caveat.

Required JSON keys:

- description: 2-4 sentences, podcast-ready.
- short_summary: one sentence.
- chapters: array of objects with:
  - start: seconds
  - end: seconds
  - title: short section title
  - description: one sentence describing the section
- description_with_timestamps: plain text episode notes with the description,
  then a "Timestamps" section using [MM:SS] Title - description lines.
- topics: 5-12 topical tags.
- image_brief: 1-2 sentences describing the conceptual image needed for this
  talk.
- image_prompt: final prompt for a square generated image, using the shared
  style supplied by the user.
- source_caveats: array of short strings; empty if none.
- metadata_needs_review: boolean.
