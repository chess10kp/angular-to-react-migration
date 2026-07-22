# Codemod slice tickets — Tier A (deterministic burn-down)

Grounded in the 356-item `residue.jsonl` run on the jHipster ng17 fixture (2026-07-21).
These are the **finite, mechanically-completable** slices the Angular→React compiler still
has in it. Ordered by leverage (residue killed ÷ effort). After ~T-8 the compiler is
essentially tapped: remaining residue is Tier B (skeleton + typed TODO) and Tier C
(plausible-but-wrong — needs the behavioral oracle, not a codemod). See `TODO.md` §"honest gaps".

**Not in scope here (do not codemod):** `di-provider`/`di-hook` composition (112),
`rxjs-subscribe` keep-vs-convert (60), `effect-verify`/`state-verify` (69). Those are Tier B/C.

---

## T-1 — Router call-sites (TS side)

**Category:** `rename` / router · **Kills:** router TS residue · **Effort:** M

Template router directives already migrate (slice 6). The component-body call-sites are still residue.

- `Router.navigate([...])` / `navigateByUrl(...)` → `navigate(...)` from `useNavigate()`
- `ActivatedRoute.snapshot.paramMap.get('x')` → `useParams()`
- `ActivatedRoute.queryParams` / `.snapshot.queryParamMap` → `useSearchParams()`
- Drop `Router`/`ActivatedRoute` from DI once fully rewired (extends slice-9 drop-flag path).

**Done when:** no `Router.navigate`/`ActivatedRoute.*` residue on fixture; hooks wired at component head.

---

## T-2 — OpenAPI client regeneration

**Category:** generated · **Kills:** ~54 generated files at once · **Effort:** M

Do **not** hand-port generated clients. Regenerate from YAML.

- `typescript-angular` generated client → `typescript-axios`, preserving models + operationIds.
- Wire against the shared Axios instance (slice 11 HttpClient→axios already lands the instance).
- Flag hand-edited generated files (rare) as residue rather than clobbering.

**Done when:** generated dir regenerates deterministically; `tsc` green on the regenerated client.

---

## T-3 — `@switch` / `@defer` template blocks

**Category:** `tpl-node` · **Kills:** native control-flow gap · **Effort:** S–M

Only remaining Angular 17 native control-flow not yet lowered.

- `@switch`/`@case`/`@default` → chained ternary or `switch`-in-IIFE per printer convention.
- `@defer` (+ `@placeholder`/`@loading`/`@error`) → `React.lazy` + `Suspense`, or residue with a
  precise TODO when triggers (`on viewport`, `on interaction`) have no clean React equivalent.

**Done when:** `@switch` fully mechanical; `@defer` either lowered or emits a shaped TODO (not silent).

---

## T-4 — `this`-rewire + `rename` + `async-unwrap` tail

**Category:** `this` (18) / `rename` (4) / `async` (2) · **Kills:** 24 · **Effort:** S

Cheap cleanup of the mechanical remainder in already-shipped paths.

- Remaining `this.X` resolutions the slice-9 pass leaves flagged (edge shapes).
- `rename-callsites` residue (4).
- `async-unwrap` (2) — component-scope `| async` / promise unwrap the async-hook pass missed.

**Done when:** these three categories hit 0 on the fixture.

---

## T-5 — Bootstrap → React-Bootstrap mapping table

**Category:** `tpl-node` (ng-bootstrap) · **Kills:** UI-lib residue · **Effort:** M

Mapping-table deterministic; visual review still required downstream.

- `NgbModal.open` / `NgbActiveModal` → React-Bootstrap `<Modal>` + show/close state (closure per plan).
- `ngbDropdown` / `ngbTooltip` / `ngbCollapse` etc. → `<Dropdown>` / `<OverlayTrigger>` / `<Collapse>`.
- Retain existing Bootstrap classes (no PrimeReact/Tailwind).

**Done when:** mapping table covers the fixture's ng-bootstrap usages; unmapped ones emit shaped residue.

---

## T-6 — `ng-content` / `ng-template` completeness

**Category:** `tpl-node` · **Kills:** structural template residue · **Effort:** S–M

Partial today (slice 11 landed `ng-content` + `ng-template`+else). Close the gaps.

- Named `ng-content select="..."` → named children/slot props.
- `ng-template` referenced via `ngTemplateOutlet` / `*ngIf...else`/`then` → render-prop or component.
- `TemplateRef` / `ViewContainerRef` imperative use → shaped residue (Tier B boundary).

**Done when:** structural `tpl-node` residue from these constructs is 0 or shaped-TODO only.

---

## T-7 — Pipe long-tail

**Category:** `tpl-node` (pipes) · **Kills:** template pipe residue · **Effort:** S

Built-in pipes landed (slice 5); close the parameterized + custom tail.

- `date` / `currency` / `number` / `percent` with format args → `Intl.*` or date-lib helper.
- Custom app pipes → import + call stub with a TODO to port the pipe body (skeleton only).

**Done when:** parameterized built-ins mechanical; custom pipes emit consistent import+stub.

---

## T-8 — Test scaffold (Jest/TestBed → Vitest/RTL)

**Category:** tests (not in current residue; new surface) · **Kills:** spec porting · **Effort:** M–L

Mechanical scaffolding only — assertions/semantics stay reviewer-gated (no weakening).

- `describe`/`it`/`expect` + Jest timers/mocks → Vitest equivalents.
- `TestBed.configureTestingModule` + `ComponentFixture` → RTL `render` + provider wrapper.
- HTTP mocks → MSW handlers; CDK harness / `fakeAsync` → shaped residue.

**Done when:** spec files scaffold to compiling Vitest/RTL; residue only for TestBed-DI + harness cases.

---

## Stop line

After T-8, residue is dominated by `di` (112), `rxjs` (60), `state`/`effect` (69) — all Tier B/C.
No further codemod meaningfully moves those; the next investment is the **behavioral parity oracle**
(`PLAN.md` §90/§163), which gates trust for the stubs these tickets leave behind.
