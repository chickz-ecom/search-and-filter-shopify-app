# SDK contract (maintainers)

`v1.json` is the recorded public API surface of `window.SearchApp` v1, extracted from `dist/types.d.ts` (signatures only, not JSDoc). `contract.test.ts` runs in CI and fails when:

- **Breaking change in the same major version.** Something was removed, a type changed, an output field became optional, or an input (`SearchParams`, `MountOptions`, …) gained a required field. Keep the old signature and deprecate it for at least 90 days, or release a new major version.
- **Unrecorded addition.** New types, members or event names. Add a `docs/developers/CHANGELOG.md` entry, bump the minor version in `package.json`, then run `npm run sdk:snapshot` and `npm run docs:sdk`.

For a new major version, bump `package.json` to `2.0.0` and run `npm run sdk:snapshot`. That writes `v2.json` and keeps `v1.json` for reference.
