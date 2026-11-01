# Tests

```
pnpm test                 # everything
```

One command runs two things: the suites in this folder, on Node's own test
runner, and `scripts/canonical-id-check.mjs`, which predates the folder and
checks the Navidrome id transform against Navidrome's own vectors.

To run one file, or one test inside it:

```
node --test --import ./scripts/ts-register.mjs test/id3.test.ts
node --test --test-name-pattern "unsynchronisation" --import ./scripts/ts-register.mjs "test/**/*.test.ts"
```

## What this can and cannot reach

There is no renderer here and no device. What these tests are for is the pure
logic: functions that take values and return values, where the answer is either
right or wrong and nobody can tell by looking at the screen. `src/lib/id3.ts` is
the reason the folder exists, being five hundred lines of byte parsing whose
every failure is silent.

Everything the app is actually made of stays out of reach: the gestures, the
animations, the player, SQLite, the offline mirror, anything that needs a
server to answer. Those are verified on a phone, and an emulator is not a phone
either (the scroll and mount costs it reports are not the ones a device has). A
green run here is not evidence about any of that.

The exception is the queue rules, kept pure in `src/lib/queue.ts` so a queue fix
can start with a failing test here. The native extractors have their own
harness, `pnpm harness:extractor`.

## No stubs

`scripts/ts-resolve.mjs` is what lets Node import the app's TypeScript: it
resolves `@/…` and the extensionless relative imports that Metro resolves.
That is the whole harness. There are deliberately no fake `expo-*` or
`react-native` modules, because a fake nothing exercises drifts away from the
real one in silence, and the day somebody writes a test against it they are
testing the fake.

So a module is testable here when its import graph stays clear of the phone.
Where a module needs only a *type* from one that does not, say so at the
statement:

```ts
import type { LibrarySort } from '@/store/settings';   // erased outright
import { type LibrarySort } from '@/store/settings';   // the import survives
```

The second form leaves an import of the settings store behind, which pulls in
the locales and `expo-secure-store` with it. The first is gone by the time Node
sees the file. That one-word difference is what `test/librarySort.test.ts` runs
on instead of a pile of imitations.

If a test genuinely needs a phone module one day, a stub is the last resort and
belongs next to the test that exercises it, never ahead of one.
