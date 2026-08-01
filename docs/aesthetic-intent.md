# Aesthetic intent

DeckForge now carries an `aestheticIntent` inside every validated `DeckSpec`.
The model must choose a visual theme from the presentation purpose, audience,
context, user voice, and visual preference. The intent records the reason for
the choice, mood, layout logic, image logic, and visual cliches to avoid.

Supported themes:

- `ink_acid`: high-contrast, analytical decision deck.
- `editorial_light`: restrained editorial or policy presentation.
- `warm_documentary`: human, contextual, case-study-oriented presentation.
- `mono_evidence`: neutral evidence and research presentation.

The renderer applies the selected theme deterministically. This is deliberately
not an open-ended color generator: a bounded theme set keeps artifacts readable
and testable while allowing the visual language to respond to the topic.

Every Art Director slide directive also records `informationShape`,
`dominantVisual`, and `layoutFamily`. These fields make the reason for a
composition inspectable instead of treating layout as a cosmetic choice. Five-slide
decks use each layout family at most once, and adjacent slides cannot repeat the
same derived silhouette. The constraint is content-led: timelines require
chronology, spatial maps require actual role or place relationships, comparison
panels require a real contrast, and step flows require an ordered sequence.

The deterministic renderer supports mirrored split-media layouts plus native
timeline and spatial-map geometry. Decorative shape changes do not satisfy the
contract; a new silhouette must clarify the slide's information shape.

For stock photography, DeckForge collects a bounded candidate pool from every
enabled stock provider that fits the source policy, ranks candidates by source
preference, requested orientation, resolution, and provider diversity, and
downloads only the selected candidate. User uploads and allowlisted official
images participate in the same deterministic ranking. Provider support therefore
does not imply that every provider is called or that several images are downloaded.

The browser intake asks for one brief and, only when needed, one free-form
additional-context field. The Research Planner resolves purpose, audience,
presentation context, user voice, and visual preference into a shared
`presentationProfile`. Explicit user constraints win over inference. The resolved
profile is visible in the trace; raw personal information is not copied into the
persisted DeckSpec artifact.
