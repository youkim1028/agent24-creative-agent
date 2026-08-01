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

The browser intake now accepts purpose, audience, presentation context, user
voice, and visual preference. These fields are prompt context only; raw personal
information is not copied into the persisted DeckSpec artifact.
