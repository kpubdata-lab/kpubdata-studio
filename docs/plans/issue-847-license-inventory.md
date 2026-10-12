# Studio license inventory plan (#847)

## Scope

- Record each `package-lock.json` entry with its exact version, license declaration,
  registry source, and installation scope. Do not equate lock presence with a Vite
  bundle module.
- Record tracked images, icons, screenshots, and font-derived brand assets separately
  from the MIT code license. Keep uncertain asset rights for maintainer review.
- Serve a generated notice with the production static site and Docker image. Gate
  lock, asset coverage, container references, and notice drift in CI.

## Files

`scripts/license-inventory.mjs`, its tests, `docs/compliance/license_inventory.json`,
`public/THIRD_PARTY_NOTICES.md`, `.github/workflows/ci.yml`, and `CHANGELOG.md`.

## Risks and verification

- The npm lock records package declarations but does not prove which modules survive
  Vite tree shaking. Check the built `dist` for the served notice and referenced
  assets; keep exact bundle and image package analysis open.
- Brand artwork contains paths based on Pretendard. Record the upstream license and
  attribution, but leave the effect of outlining the font for maintainer/legal review.
- Test that unlisted images, lock changes, stale entries, and notice changes fail;
  run lint, type check, tests, build and CI before merging.
