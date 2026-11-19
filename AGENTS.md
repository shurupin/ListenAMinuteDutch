## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

## Content workflow

Adding a lesson: see README "Как добавить урок". After `npm run lesson -- <slug>`, fill every empty `ru` in `src/data/vocab.json` (Russian glosses, context-appropriate for A1–A2) and write `ru.txt` if the user gave only nl/en. Python runs via `python -m uv run` inside `pipeline/`.
Also review the members-of-the-sentence analysis (print tokens with `syn`) and fix parser mistakes in meta.json `"syntax"` (README step 5), following Russian school grammar: predicate includes aux/copula/particle, prepositions and articles go with their noun, particles and conjunctions are not underlined.
Also write `content/inbox/<slug>/align.txt` (Dutch = English = Russian word units per sentence, see pipeline/wordalign.py) and check that the pipeline prints no `! align` warnings.
