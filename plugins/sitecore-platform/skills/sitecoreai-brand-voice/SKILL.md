---
name: sitecoreai-brand-voice
description: "Writes Sitecore page content in a brand's voice and identity, taken from the PRD or spec or a Sitecore brand kit, never guessed. Sets register (brand, marketing, technical-neutral). Use for copy on a brand or client site. Not page structure."
license: Apache-2.0
metadata:
  author: Christian Hahn
  version: "0.1.1"
  validated: "NOT FIELD-TESTED as a standalone skill. Marketing and technical-neutral registers carried over from a voice skill used on real site builds; the Marketer MCP brand tool names were read from its tool list, and the one environment checked had no brand context."
---

# Brand voice — write as the brand, from what the spec says

`sitecoreai-content-composition` decides **which components go on the page**. This skill decides **how the words in them sound**: the voice belongs to the brand, and it comes from a written source. The agent's own taste is not a source.

## When to use

- Filling a Sitecore page or component with copy for a brand or client site.
- Reviewing authored content against the brand it was written for.
- Writing the "Brand voice and identity" section of a PRD or spec.

**Not for:** which components to use (`sitecoreai-content-composition`), reference documentation, or a person's own blog voice.

## Step 1 — Find the source, in this order

1. **The PRD or spec.** Look for its "Brand voice and identity" section (template below). This wins, because it is what was agreed for this build.
2. **A Sitecore brand kit or brand context**, through the Marketer MCP: `list_brand_contexts`, `get_brand_context`, `get_brand_context_items`, `list_brandkits`, `get_brandkit_by_id`. An empty list is a normal result: many environments have none.
3. **Guidelines the user points you at**, such as a linked document or an existing site.

**If none of them exists, stop and ask.** Do not invent a personality. Offer to write the spec section with the user, then continue. If the user wants placeholder copy for a build test, use the technical-neutral register and say that the copy is a placeholder.

If two sources disagree, follow the spec and name the conflict in your output.

## Step 2 — Pick the register

The register is **how** it sounds. The brand is **whose** voice it is. Take the register from the spec for that surface; otherwise use the default for the surface and say so.

| Register | Use for | Dials | Avoid |
|---|---|---|---|
| **brand** (default for site copy) | Page copy on the brand's surface | The spec's voice attributes, vocabulary and tone | Any voice the spec does not describe |
| **marketing** | Launch, landing or campaign content | Benefit first; second person; superlatives earned by specifics; rhythmic and tight; imperative closers | Empty buzzwords, walls of text, hedging |
| **technical-neutral** | Documentation, specs, legal or factual content | Third person or imperative; no emoji; flat, precise statements of behaviour, inputs and limits | Personality, persuasion, hype |

State the register and the source at the top of your output, so a reviewer can check the choice:

```text
Register: brand | Source: spec, "Brand voice and identity"
```

## Step 3 — Write to the slot

- **Fit the field.** Read the component's fields first and write to them: an eyebrow is a few words, a heading is one line, and a body field can hold a paragraph.
- **Claims need a source.** Use only the facts, numbers, prices and customer names the spec or the brand's material gives you. Mark anything else as needing confirmation; never present it as fact.
- **Identity reaches past the words.** Image alt text and any imagery brief follow the spec's visual identity.
- **Language.** Write each locale as native copy for that market. Do not translate word for word if the spec gives a tone for that locale.

## Generic AI tells to avoid, in every register

- "In today's fast-paced world…", "Let's dive in", "It's worth noting that", "In conclusion", "Unlock the power of…".
- Hedging everything, or a balanced "on one hand… on the other" that never takes a position.
- Superlatives with nothing concrete behind them.
- Uniform paragraph lengths and repeated sentence shapes.

## Spec template: "Brand voice and identity"

Put this in the PRD or spec. It is short on purpose, and every field is something a writer or a reviewer can check against.

```markdown
## Brand voice and identity

- **Brand and surface:** whose site this is, and which sites or pages this covers
- **Source:** brand kit or brand context id, guidelines link, or "defined here"
- **Audience:** who reads it, and what they already know
- **Voice attributes:** three to five, each with a line on what it means in practice
- **Tone by surface:** for example hero: confident; forms: plain; errors: calm
- **Vocabulary:** words to use, and words to avoid
- **Claims allowed:** facts, numbers and names that may be stated, and what needs sign-off
- **Register default:** brand, marketing or technical-neutral
- **Example:** two or three sentences that sound right
- **Visual identity:** palette, typography and imagery direction, or where they are defined
```

## Check before you hand it over

- The source is named, and it exists.
- The copy could not belong to a different brand with the name swapped out.
- Every number, price and customer name traces back to the source.
- Each text fits its field on the rendered page, read in preview.

## Relationship to other skills

- **`sitecoreai-content-composition`** — the page structure and the Marketer MCP write recipe. Load it together with this skill when authoring a page.
- **`sitecoreai-localization`** — language versions and per-locale publishing.
- **`sitecoreai-agent`** — the API behind the Marketer MCP, including brand kits, brand contexts and briefs. Brand review is in `marketplace-sdk-ai`.
