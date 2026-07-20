import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { transformComponent } from '../src/transform-component.js';
import { parseAngularComponent } from '../src/parse/angular-component.js';

const here = dirname(fileURLToPath(import.meta.url));
const APP = resolve(here, '../../../references/jhipster-ng17-fixture/src/main/webapp/app');

function load(rel: string): { src: string; path: string } {
  const path = resolve(APP, rel);
  return { src: readFileSync(path, 'utf8'), path };
}

describe('component extraction', () => {
  it('extracts @Input, methods, selector, templateUrl', () => {
    const { src, path } = load('shared/filter/filter.component.ts');
    const { model } = parseAngularComponent(src, path);
    expect(model).toBeTruthy();
    expect(model!.className).toBe('FilterComponent');
    expect(model!.selector).toBe('jhi-filter');
    expect(model!.inputs).toEqual([
      { name: 'filters', type: 'IFilterOptions', required: true, default: null },
    ]);
    expect(model!.methods.map((m) => m.name)).toEqual(['clearAllFilters', 'clearFilter']);
    expect(model!.methods.every((m) => m.usesThis)).toBe(true);
  });

  it('classifies inject / signal / lifecycle', () => {
    const { src, path } = load('home/home.component.ts');
    const { model } = parseAngularComponent(src, path);
    expect(model!.injected.map((d) => d.token).sort()).toEqual(['AccountService', 'Router']);
    expect(model!.signals.map((s) => s.name)).toEqual(['account']);
    expect(model!.lifecycle.map((h) => h.name).sort()).toEqual(['ngOnDestroy', 'ngOnInit']);
  });
});

describe('component -> tsx', () => {
  it('filter: clean deterministic skeleton (golden)', async () => {
    const { src, path } = load('shared/filter/filter.component.ts');
    const r = await transformComponent(src, path);
    expect(r.ok).toBe(true);
    expect(r.templateSource).toBe('external');
    expect(r.tsx).toContain('export interface FilterComponentProps');
    expect(r.tsx).toContain('export function FilterComponent({ filters }: FilterComponentProps)');
    // jhiTranslate in the template wires up react-i18next deterministically.
    expect(r.tsx).toContain("import { useTranslation } from 'react-i18next';");
    expect(r.tsx).toContain('const { t } = useTranslation();');
    expect(r.tsx).toMatchSnapshot();
  });

  it('home: DI + lifecycle become flagged React idioms (golden)', async () => {
    const { src, path } = load('home/home.component.ts');
    const r = await transformComponent(src, path);
    expect(r.ok).toBe(true);
    // Signals surface as useState with a verify note...
    expect(r.tsx).toMatch(/const \[account, setAccount\] = useState/);
    // ...Router maps to a real react-router hook (slice 8)...
    expect(r.tsx).toMatch(/const navigate = useNavigate\(\);/);
    expect(r.tsx).toMatch(/import \{[^}]*\buseNavigate\b[^}]*\} from 'react-router-dom';/);
    // ...an app service becomes a use<Service>() hook-call hint, still flagged...
    expect(r.tsx).toMatch(/const accountService = useAccountService\(\);/);
    expect(r.tsx).toMatch(/MIGRATION_TODO\(di\)/);
    // ...but lifecycle now emits a real, review-flagged useEffect (slice 7).
    expect(r.tsx).toMatch(/import \{[^}]*\buseEffect\b[^}]*\} from 'react';/);
    expect(r.tsx).toMatch(/MIGRATION_TODO\(effect\)/);
    expect(r.tsx).toMatch(/useEffect\(\(\) => \{/);
    // ...and the effect body is fully `this.`-rewired (slice 9): signal set,
    // app-service + RxJS subject strips — so it loses the "rewire this." note.
    expect(r.tsx).toMatch(/\.subscribe\(\(account\) => setAccount\(account\)\)/);
    expect(r.tsx).toMatch(/takeUntil\(destroy\$\)/);
    expect(r.tsx).toMatch(/return \(\) => \{\s*destroy\$\.next\(\);/);
    // The one ref with a real API change (Router) stays honestly flagged.
    expect(r.tsx).toMatch(/MIGRATION_TODO\(this\): unresolved `this\.router`/);
    expect(r.tsx).toMatchSnapshot();
  });

  it('reserved-word method (delete) is renamed and flagged', async () => {
    const { src, path } = load('entities/blog/list/blog.component.ts');
    const r = await transformComponent(src, path);
    expect(r.ok).toBe(true);
    expect(r.tsx).toContain('function deleteItem(');
    // Template `(click)="delete(blog)"` must call the renamed fn — a bare
    // `delete(…)` is the JS delete operator and fails to parse as JSX.
    expect(r.tsx).toMatch(/onClick=\{\(\) => deleteItem\(blog\)\}/);
    expect(r.tsx).not.toMatch(/onClick=\{\(\) => delete\b/);
    expect(r.todos.some((t) => /reserved word/.test(t))).toBe(true);
  });

  it('is deterministic (same input -> identical tsx)', async () => {
    const { src, path } = load('home/home.component.ts');
    const a = await transformComponent(src, path);
    const b = await transformComponent(src, path);
    expect(a.tsx).toBe(b.tsx);
  });
});
