# Localization Pull Request Guide

Neo Chat localizes UI catalogs and selected marketplace metadata. Keep runtime
behavior predictable: use the translated data that exists, fall back to English
where it does not, and verify that catalog keys stay compatible.

## Add a UI locale

- Add namespace files under `src/i18n/locales/<locale>/` and the matching
  `src/i18n/locales/<locale>.ts` aggregator.
- Add the locale to `SUPPORTED_LOCALES` and `localeLoaders` in
  `src/i18n/request.ts`.
- Add its label to `System.json` and update the selector in
  `src/components/settings/SystemSettings.tsx`.
- Update `src/__tests__/messagesParity.test.ts` so the catalog is checked
  against English.

## Localize marketplace data

For assistant market data:

- Normalize request locales in `src/lib/market/agentLocale.ts`.
- Map list files in `src/app/api/agents/route.ts`, for example
  `ja -> index.ja-JP.json`.
- Map detail files in `src/app/api/agents/[identifier]/route.ts`, for example
  `ja -> <identifier>.ja-JP.json`.
- Add route and client-service tests for both file names.

For Skills marketplace data:

- Add localized metadata only when the marketplace list has enough translation
  coverage, for example `public/data/skills/skills.metadata.ja.json`.
- Keep `file` values pointed at English definition files unless the PR also
  ships complete localized definitions. Detailed Skill content can then fall
  back to English safely.
- Add the locale to `SkillDataLocale`, `resolveSkillDataLocale`, and
  `getCatalogPath`.
- Update `src/__tests__/skillsDataset.test.ts` and
  `src/__tests__/skillService.test.ts` to cover metadata loading and the
  intended English definition fallback.

## Update SEO and speech

- Add locale-specific metadata in `src/lib/seo.ts`, including the Open Graph
  locale and JSON-LD `inLanguage`.
- Add speech-language labels in `Voice.json` and update
  `src/components/settings/VoiceSettings.tsx`.
- Update voice language types, schema validation, browser BCP 47 mapping, and
  provider transcription-language hints.

## Review checklist

- Review terminology, UI length, placeholders, and product names instead of
  relying on unreviewed machine translation.
- Preserve placeholders such as `{name}`, rich-text markers, and code-like
  strings exactly.
- Keep URLs, provider names, model IDs, environment variables, and file names
  unchanged unless only the surrounding prose is intentionally localized.
- Do not add locale files containing English copy only. Route surfaces without
  localized data to English explicitly and document that fallback.
- Keep PRs focused. Combine UI locale files, assistant mappings, Skills
  metadata, SEO, and voice support only when they target the same locale.

## Verification

Run the checks that cover the changed surfaces:

```bash
corepack pnpm exec vitest run src/__tests__/messagesParity.test.ts
corepack pnpm exec vitest run src/__tests__/agentListRoute.test.ts src/__tests__/agentService.test.ts
corepack pnpm exec vitest run src/__tests__/skillsDataset.test.ts src/__tests__/skillService.test.ts
corepack pnpm exec vitest run src/__tests__/seo.test.ts src/__tests__/schemas.test.ts
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
```

When visible UI changes, also select the locale in **Settings**, reload to
confirm persistence, and open any affected Assistants, Skills, Plugins,
Settings, or Voice views. Missing localized Skill definitions should show
English content rather than broken links.
