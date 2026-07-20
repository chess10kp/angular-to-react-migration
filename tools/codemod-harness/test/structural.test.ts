import { describe, it, expect } from 'vitest';
import { transformTemplate } from '../src/transform.js';

async function run(src: string) {
  const r = await transformTemplate(src, 'inline.html');
  expect(r.errors).toEqual([]);
  expect(r.ok).toBe(true);
  return r;
}

async function jsx(src: string): Promise<string> {
  return (await run(src)).jsx.trim();
}

describe('<ng-content> -> React children', () => {
  it('bare <ng-content> -> {children}', async () => {
    expect(await jsx('<ng-content></ng-content>')).toBe('const __template = children;');
  });

  it('nested bare <ng-content> splices into its parent', async () => {
    expect(await jsx('<div class="card"><ng-content></ng-content></div>')).toBe(
      'const __template = <div className="card">{children}</div>;',
    );
  });

  it('<ng-content select="…"> still yields {children} but is flagged', async () => {
    const r = await run('<ng-content select="[header]"></ng-content>');
    expect(r.jsx.trim()).toBe('const __template = children;');
    expect(r.coverage.todoReasons.join('\n')).toMatch(
      /ng-content select="\[header\]".*selector-based projection/,
    );
  });
});

describe('*ngIf then/else -> conditional JSX with inlined <ng-template>', () => {
  it('*ngIf="c; else ref" inlines the else template as the false branch', async () => {
    expect(await jsx('<div *ngIf="cond; else other">A</div><ng-template #other>B{{ y }}</ng-template>'))
      .toBe('const __template = cond ? <div>A</div> : <>B{y}</>;');
  });

  it('*ngIf="c; then a else b" inlines both branches (host content ignored)', async () => {
    expect(
      await jsx(
        '<div *ngIf="c; then a else b">ignored</div><ng-template #a>AA</ng-template><ng-template #b>BB</ng-template>',
      ),
    ).toBe("const __template = c ? 'AA' : 'BB';");
  });

  it('resolves a reference declared *before* its *ngIf (forward-safe)', async () => {
    expect(await jsx('<ng-template #other>B</ng-template><div *ngIf="cond; else other">A</div>'))
      .toBe("const __template = cond ? <div>A</div> : 'B';");
  });

  it('the referenced <ng-template> is consumed, not emitted standalone', async () => {
    const out = await jsx('<div *ngIf="cond; else other">A</div><ng-template #other>B</ng-template>');
    expect(out).not.toMatch(/MIGRATION_TODO/);
  });

  it('an *ngIf else pointing at a missing ref is flagged, then-branch kept', async () => {
    const r = await run('<div *ngIf="cond; else gone">A</div>');
    expect(r.jsx.trim()).toBe('const __template = cond && <div>A</div>;');
    expect(r.coverage.todoReasons.join('\n')).toMatch(/unknown template #gone/);
  });
});

describe('unreferenced <ng-template> / ngTemplateOutlet -> flagged, content preserved', () => {
  it('standalone <ng-template #x> is flagged but its content stays visible', async () => {
    const r = await run('<ng-template #tpl>hello {{ x }}</ng-template>');
    expect(r.jsx).toMatch(/MIGRATION_TODO: <ng-template #tpl>/);
    expect(r.jsx).toContain('hello {x}');
    expect(r.coverage.todoReasons.join('\n')).toMatch(/no deterministic React form/);
  });

  it('[ngTemplateOutlet] on a host is flagged (never silently dropped)', async () => {
    const r = await run('<ng-container [ngTemplateOutlet]="tpl"></ng-container>');
    expect(r.jsx).toMatch(/MIGRATION_TODO: \[ngTemplateOutlet\]="tpl"/);
    expect(r.coverage.todoReasons.join('\n')).toMatch(/render-prop\/child component/);
  });

  it('*ngTemplateOutlet on a host is flagged and keeps the host content', async () => {
    const r = await run('<div *ngTemplateOutlet="tpl">host</div>');
    expect(r.jsx).toMatch(/MIGRATION_TODO: \*ngTemplateOutlet="tpl"/);
    expect(r.jsx).toContain('<div>host</div>');
  });
});
