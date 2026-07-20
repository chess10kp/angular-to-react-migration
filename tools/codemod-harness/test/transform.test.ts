import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { transformTemplate } from '../src/transform.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, '../../../references/jhipster-ng17-fixture/src/main/webapp/app');

async function jsx(src: string): Promise<string> {
  const r = await transformTemplate(src, 'inline.html');
  expect(r.errors).toEqual([]);
  expect(r.ok).toBe(true);
  return r.jsx.trim();
}

describe('control-flow -> JSX', () => {
  it('@if / @else if / @else -> conditional chain', async () => {
    expect(
      await jsx('@if (a > 1) { <p>hi</p> } @else if (b) { <b>bb</b> } @else { <span>x</span> }'),
    ).toMatchInlineSnapshot(`"const __template = a > 1 ? <p>hi</p> : b ? <b>bb</b> : <span>x</span>;"`);
  });

  it('bare @if (no else) -> logical-and', async () => {
    expect(await jsx('@if (ok) { <p>hi</p> }')).toMatchInlineSnapshot(`
      "const __template = ok && <p>hi</p>;"
    `);
  });

  it('@for with track -> .map with key', async () => {
    expect(await jsx('@for (x of xs; track x.id) { <li>{{ x.n }}</li> }')).toMatchInlineSnapshot(`
      "const __template = xs.map((x) => <li key={x.id}>{x.n}</li>);"
    `);
  });

  it('@for with @empty -> length-guarded conditional', async () => {
    expect(await jsx('@for (x of xs; track x) { <li>{{ x }}</li> } @empty { <li>none</li> }'))
      .toMatchInlineSnapshot(`
      "const __template = xs.length ? xs.map((x) => <li key={x}>{x}</li>) : <li>none</li>;"
    `);
  });

  it('@for with $index alias -> second map param', async () => {
    expect(await jsx('@for (x of xs; track x; let i = $index) { <li>{{ i }}</li> }'))
      .toMatchInlineSnapshot(`
      "const __template = xs.map((x, i) => <li key={x}>{i}</li>);"
    `);
  });
});

describe('bindings & interpolation', () => {
  it('property, event, class, style bindings', async () => {
    const out = await jsx(
      '<a [href]="url" (click)="go($event)" [class.on]="active" [style.color]="c">x</a>',
    );
    expect(out).toContain('href={url}');
    expect(out).toContain('onClick={(e) => go(e)}');
    expect(out.replace(/\s+/g, ' ')).toMatch(/className=\{clsx\(\{ on: active,? \}/);
    expect(out.replace(/\s+/g, ' ')).toMatch(/style=\{\{ color: c,? \}\}/);
  });

  it('interpolation splices into parent, translate pipe -> t()', async () => {
    expect(await jsx('<span title="{{ \'k\' | translate }}">{{ a }}: {{ b }}</span>'))
      .toMatchInlineSnapshot(`
      "const __template = (
        <span title={t('k')}>
          {a}: {b}
        </span>
      );"
    `);
  });
});

describe('classic structural directives', () => {
  it('*ngIf -> logical-and', async () => {
    expect(await jsx('<div *ngIf="a > 1">hi</div>')).toMatchInlineSnapshot(
      `"const __template = a > 1 && <div>hi</div>;"`,
    );
  });

  it('*ngFor with trackBy -> map with key={fn(i, item)}', async () => {
    expect(await jsx('<li *ngFor="let x of xs; let i = index; trackBy: tb">{{ x.n }}</li>'))
      .toMatchInlineSnapshot(`"const __template = xs.map((x, i) => <li key={tb(i, x)}>{x.n}</li>);"`);
  });

  it('*ngFor without trackBy -> index key (flagged)', async () => {
    const r = await transformTemplate('<li *ngFor="let y of ys">{{ y }}</li>', 'inline.html');
    expect(r.jsx.trim()).toBe('const __template = ys.map((y, i) => <li key={i}>{y}</li>);');
    expect(r.coverage.todoReasons.join('\n')).toMatch(/without trackBy/);
  });

  it('[ngSwitch] host -> conditional chain', async () => {
    const out = await jsx(
      '<div [ngSwitch]="s"><p *ngSwitchCase="1">a</p><p *ngSwitchDefault>d</p></div>',
    );
    expect(out.replace(/\s+/g, ' ')).toContain('{s === 1 ? <p>a</p> : <p>d</p>}');
  });
});

describe('common directives & pipes', () => {
  it('merges static class + [class.x] + [ngClass] into one clsx className', async () => {
    const out = await jsx('<div class="base" [ngClass]="dyn" [class.hi]="h">x</div>');
    const flat = out.replace(/\s+/g, ' ');
    expect(flat).toMatch(/clsx\( ?'base', \{ hi: h,? \}, dyn,? ?\)/);
  });

  it('[ngStyle] + [style.x] merge into one style object', async () => {
    const out = await jsx('<div [ngStyle]="base" [style.top]="tp">x</div>');
    const flat = out.replace(/\s+/g, ' ');
    expect(flat).toContain('style={{ ...base, top: tp');
  });

  it('[(ngModel)] -> value + onChange (write side flagged)', async () => {
    const r = await transformTemplate('<input [(ngModel)]="query" />', 'inline.html');
    expect(r.jsx).toContain('value={query}');
    expect(r.jsx).toContain('onChange={(e) => (query = e.target.value)}');
    expect(r.jsx).not.toContain('data-migration-todo');
    expect(r.coverage.todoReasons.join('\n')).toMatch(/make `query` React state/);
  });

  it('[ngModel] signal read + (ngModelChange) -> value + valid setter (no call assignment)', async () => {
    const r = await transformTemplate(
      '<input [ngModel]="beansFilter()" (ngModelChange)="beansFilter.set($event)" />',
      'inline.html',
    );
    expect(r.jsx).toContain('value={beansFilter()}');
    expect(r.jsx).toContain('onChange={(e) => beansFilter.set(e.target.value)}');
    expect(r.jsx).not.toContain('MIGRATION_TODO');
    expect(r.jsx).not.toMatch(/beansFilter\(\)\s*=/);
    expect(r.coverage.todoReasons.join('\n')).toMatch(/signal `beansFilter`/);
  });

  it('built-in pipes: exact JS where possible, helper calls otherwise', async () => {
    expect(await jsx('<p>{{ o | json }}</p>')).toContain('JSON.stringify(o)');
    expect(await jsx('<p>{{ s | uppercase }}</p>')).toContain('s.toUpperCase()');
    expect(await jsx('<p>{{ xs | slice:1:3 }}</p>')).toContain('xs.slice(1, 3)');
    const r = await transformTemplate("<p>{{ d | date:'short' }}</p>", 'inline.html');
    expect(r.jsx).toContain("formatDate(d, 'short')");
    expect(r.helpers).toContain('formatDate');
  });

  it('async pipe unwraps to the base expression with a residue note', async () => {
    const r = await transformTemplate('<p>{{ data$ | async }}</p>', 'inline.html');
    expect(r.jsx.trim()).toBe('const __template = <p>{data$}</p>;');
    expect(r.coverage.todoReasons.join('\n')).toMatch(/async pipe on `data\$`/);
  });
});

describe('router & misc template directives', () => {
  it('static routerLink -> <Link to="…">', async () => {
    expect(await jsx('<a routerLink="/home">Home</a>')).toBe(
      'const __template = <Link to="/home">Home</Link>;',
    );
  });

  it('[routerLink] array -> joined path', async () => {
    const out = await jsx('<a [routerLink]="[\'/user\', id]">U</a>');
    expect(out).toContain("to={['/user', id].join('/')}");
  });

  it('routerLinkActive -> <NavLink> with isActive className (merged)', async () => {
    const out = await jsx('<a routerLink="/d" routerLinkActive="active" class="nav">D</a>');
    const flat = out.replace(/\s+/g, ' ');
    expect(flat).toContain('<NavLink');
    expect(flat).toMatch(/className=\{\(\{ isActive \}\) => clsx\('nav', isActive && 'active'\)\}/);
  });

  it('<router-outlet> -> <Outlet />', async () => {
    expect(await jsx('<router-outlet></router-outlet>')).toBe('const __template = <Outlet />;');
  });

  it('<ng-container> -> Fragment', async () => {
    expect(await jsx('<ng-container><span>{{ x }}</span></ng-container>')).toMatchInlineSnapshot(`
      "const __template = (
        <>
          <span>{x}</span>
        </>
      );"
    `);
  });

  it('[innerHTML] -> dangerouslySetInnerHTML (children dropped)', async () => {
    const out = await jsx('<div [innerHTML]="html"></div>');
    expect(out.replace(/\s+/g, ' ')).toMatch(/dangerouslySetInnerHTML=\{\{ __html: html,? \}\}/);
  });
});

describe('jhiTranslate directive -> t()', () => {
  it('static key -> {t(\'key\')}, fallback text dropped', async () => {
    const r = await transformTemplate(
      '<span jhiTranslate="metrics.refresh.button">Refresh</span>',
      'inline.html',
    );
    expect(r.jsx.trim()).toBe("const __template = <span>{t('metrics.refresh.button')}</span>;");
    expect(r.usesTranslate).toBe(true);
  });

  it('key + [translateValues] -> {t(\'key\', {…})}', async () => {
    const out = await jsx(
      '<p jhiTranslate="logs.nbloggers" [translateValues]="{ total: loggers()?.length }">x</p>',
    );
    const flat = out.replace(/\s+/g, ' ');
    expect(flat).toContain("t('logs.nbloggers', {");
    expect(flat).toContain('total: loggers()?.length');
  });

  it('bound [jhiTranslate] -> {t(expr)}', async () => {
    const out = await jsx('<td [jhiTranslate]="\'health.indicator.\' + h.key">x</td>');
    expect(out).toContain("{t('health.indicator.' + h.key)}");
  });

  it('templates without translation report usesTranslate=false', async () => {
    const r = await transformTemplate('<p>plain</p>', 'inline.html');
    expect(r.usesTranslate).toBe(false);
  });
});

describe('residue (never silently dropped)', () => {
  it('unknown pipe becomes recorded residue', async () => {
    const r = await transformTemplate('<p>{{ n | myCustomPipe }}</p>', 'inline.html');
    expect(r.coverage.todoReasons.join('\n')).toMatch(/unsupported pipe `myCustomPipe`/);
  });

  it('unmappable event -> data-migration-todo marker', async () => {
    const out = await jsx('<input (keydown.enter)="submit()" />');
    expect(out).toContain('data-migration-todo');
  });

  it('@switch is emitted as a MIGRATION_TODO node, not dropped', async () => {
    const r = await transformTemplate('@switch (x) { @case (1) { <p>a</p> } }', 'inline.html');
    expect(r.coverage.todoNodes).toBeGreaterThan(0);
    expect(r.jsx).toMatch(/MIGRATION_TODO/);
  });
});

describe('lifecycle -> useEffect (slice 7)', () => {
  const COMPONENT = `
    import { Component, OnInit, OnDestroy, Input } from '@angular/core';
    @Component({ selector: 'x', template: '<p>x</p>' })
    export class XComponent implements OnInit, OnDestroy {
      @Input() id!: string;
      ngOnInit() { this.load(); }
      ngOnDestroy() { this.sub.unsubscribe(); }
    }`;

  it('ngOnInit + ngOnDestroy fold into one mount effect with cleanup', async () => {
    const { transformComponent } = await import('../src/transform-component.js');
    const r = await transformComponent(COMPONENT, 'x.component.ts');
    expect(r.ok).toBe(true);
    const flat = r.tsx.replace(/\s+/g, ' ');
    expect(r.tsx).toContain("import { useEffect } from 'react';");
    expect(flat).toMatch(/useEffect\(\(\) => \{ this\.load\(\); return \(\) => \{ this\.sub\.unsubscribe\(\); \}; \}, \[\]\);/);
  });

  it('ngOnChanges -> effect keyed on @Input deps', async () => {
    const { transformComponent } = await import('../src/transform-component.js');
    const src = `
      import { Component, OnChanges, Input } from '@angular/core';
      @Component({ selector: 'x', template: '<p>x</p>' })
      export class XComponent implements OnChanges {
        @Input() a!: string;
        @Input() b!: number;
        ngOnChanges() { this.recompute(); }
      }`;
    const r = await transformComponent(src, 'x.component.ts');
    expect(r.ok).toBe(true);
    expect(r.tsx.replace(/\s+/g, ' ')).toContain('}, [a, b]);');
  });

  it('async hook body is wrapped in an IIFE (effects can\'t be async)', async () => {
    const { transformComponent } = await import('../src/transform-component.js');
    const src = `
      import { Component, AfterContentInit } from '@angular/core';
      @Component({ selector: 'x', template: '<p>x</p>' })
      export class XComponent implements AfterContentInit {
        async ngAfterContentInit() { const v = await this.load(); }
      }`;
    const r = await transformComponent(src, 'x.component.ts');
    expect(r.ok).toBe(true); // would fail prettier if `await` sat in a non-async effect
    expect(r.tsx.replace(/\s+/g, ' ')).toContain('void (async () => { const v = await this.load(); })();');
  });

  it('ngDoCheck stays residue (no safe effect)', async () => {
    const { transformComponent } = await import('../src/transform-component.js');
    const src = `
      import { Component, DoCheck } from '@angular/core';
      @Component({ selector: 'x', template: '<p>x</p>' })
      export class XComponent implements DoCheck {
        ngDoCheck() { this.tick(); }
      }`;
    const r = await transformComponent(src, 'x.component.ts');
    expect(r.tsx).toMatch(/MIGRATION_TODO\(lifecycle\): ngDoCheck/);
    expect(r.tsx).not.toMatch(/useEffect/);
  });
});

describe('DI -> React hooks/context (slice 8)', () => {
  const run = async (body: string, imports = 'Component') => {
    const { transformComponent } = await import('../src/transform-component.js');
    const src = `
      import { ${imports} } from '@angular/core';
      @Component({ selector: 'x', template: '<p>x</p>' })
      export class XComponent {
        ${body}
      }`;
    return transformComponent(src, 'x.component.ts');
  };

  it('Router -> useNavigate() from react-router-dom', async () => {
    const r = await run('private router = inject(Router);');
    expect(r.tsx).toContain('const navigate = useNavigate();');
    expect(r.tsx).toMatch(/import \{[^}]*\buseNavigate\b[^}]*\} from 'react-router-dom';/);
  });

  it('ActivatedRoute -> useParams()/useLocation()', async () => {
    const r = await run('private route = inject(ActivatedRoute);');
    expect(r.tsx).toContain('const params = useParams();');
    expect(r.tsx).toContain('const location = useLocation();');
  });

  it('TranslateService -> useTranslation(), suppressing a duplicate hook', async () => {
    // Template also uses jhiTranslate, so usesTranslate is set independently.
    const { transformComponent } = await import('../src/transform-component.js');
    const src = `
      import { Component, inject } from '@angular/core';
      @Component({ selector: 'x', template: '<p jhiTranslate="a.b">x</p>' })
      export class XComponent {
        private ts = inject(TranslateService);
      }`;
    const r = await transformComponent(src, 'x.component.ts');
    expect(r.tsx).toContain('const { t, i18n } = useTranslation();');
    // Exactly one useTranslation() call — the DI mapping wins over the plain one.
    expect(r.tsx.match(/useTranslation\(\)/g)).toHaveLength(1);
  });

  it('ElementRef -> useRef()', async () => {
    const r = await run('private host = inject(ElementRef);');
    expect(r.tsx).toContain('const hostRef = useRef<HTMLElement>(null);');
    expect(r.tsx).toMatch(/import \{[^}]*\buseRef\b[^}]*\} from 'react';/);
  });

  it('ChangeDetectorRef is dropped with an explanatory TODO (no call emitted)', async () => {
    const r = await run('private cdr = inject(ChangeDetectorRef);');
    expect(r.tsx).toMatch(/MIGRATION_TODO\(di\): cdr = inject\(ChangeDetectorRef\) dropped/);
    expect(r.tsx).not.toMatch(/useChangeDetectorRef/);
  });

  it('unknown app service -> use<Service>() hook-call hint, flagged', async () => {
    const r = await run('private svc = inject(AccountService);');
    expect(r.tsx).toContain('const svc = useAccountService();');
    expect(r.tsx).toMatch(/MIGRATION_TODO\(di\)/);
  });

  it('constructor-injected deps map the same way as inject()', async () => {
    const { transformComponent } = await import('../src/transform-component.js');
    const src = `
      import { Component } from '@angular/core';
      @Component({ selector: 'x', template: '<p>x</p>' })
      export class XComponent {
        constructor(private router: Router, private svc: FooService) {}
      }`;
    const r = await transformComponent(src, 'x.component.ts');
    expect(r.tsx).toContain('const navigate = useNavigate();');
    expect(r.tsx).toContain('const svc = useFooService();');
  });
});

describe('this. rewiring (slice 9)', () => {
  const run = async (members: string, opts = 'Component, signal, computed, Input, Output, EventEmitter, inject') => {
    const { transformComponent } = await import('../src/transform-component.js');
    const src = `
      import { ${opts} } from '@angular/core';
      @Component({ selector: 'x', template: '<p>x</p>' })
      export class XComponent {
        ${members}
      }`;
    return transformComponent(src, 'x.component.ts');
  };

  it('signal read/set/update rewire to state + setter', async () => {
    const r = await run(`
      count = signal<number>(0);
      inc() { this.count.set(this.count() + 1); }
      bump() { this.count.update((n) => n + 1); }
    `);
    const flat = r.tsx.replace(/\s+/g, ' ');
    // inner `this.count()` read also collapses to `count`.
    expect(flat).toContain('setCount(count + 1);');
    expect(flat).toContain('setCount((n) => n + 1);');
    // .update() is mechanically rewritten but flagged for a semantics glance.
    expect(r.tsx).toMatch(/MIGRATION_TODO\(this\):[^\n]*`count\.update\(\)`/);
  });

  it('output emit rewires to the on<Output>?. handler prop', async () => {
    const r = await run(`
      @Output() saved = new EventEmitter<string>();
      save() { this.saved.emit('ok'); }
    `);
    expect(r.tsx.replace(/\s+/g, ' ')).toContain("onSaved?.('ok');");
  });

  it('plain field / method / input refs strip this. (incl. $-suffixed)', async () => {
    const r = await run(`
      @Input() label!: string;
      destroy$ = new Subject<void>();
      title() { return this.label; }
      teardown() { this.destroy$.next(); this.title(); }
    `);
    const flat = r.tsx.replace(/\s+/g, ' ');
    expect(flat).toContain('return label;');
    expect(flat).toContain('destroy$.next();');
    expect(flat).toContain('title();');
  });

  it('a fully-rewired method carries no MIGRATION_TODO(this)', async () => {
    const r = await run(`
      @Input() label!: string;
      greet() { return 'hi ' + this.label; }
    `);
    expect(r.tsx).toContain("return 'hi ' + label;");
    expect(r.tsx).not.toMatch(/MIGRATION_TODO\(this\)/);
  });

  it('known-token API calls (Router) stay flagged, not blindly rewritten', async () => {
    const r = await run(`
      private router = inject(Router);
      go() { this.router.navigate(['/home']); }
    `);
    // `navigate` local exists, but `this.router.navigate` is left for a human.
    expect(r.tsx).toContain("this.router.navigate(['/home']);");
    expect(r.tsx).toMatch(/MIGRATION_TODO\(this\): unresolved `this\.router`/);
  });

  it('computed/getter body is this.-rewired too', async () => {
    const r = await run(`
      @Input() first!: string;
      @Input() last!: string;
      get full() { return this.first + ' ' + this.last; }
    `);
    expect(r.tsx.replace(/\s+/g, ' ')).toContain("const full = (() => { return first + ' ' + last;");
  });

  // AST-driven (not regex): a `this.x` inside a string/comment is NOT a real
  // property access, so it must be left untouched.
  it('this.x inside a string literal is left verbatim', async () => {
    const r = await run(`
      @Input() label!: string;
      describe() { return 'set via this.label please'; }
    `);
    // The real ref rewires; the identical text inside the string does not.
    expect(r.tsx).toContain("return 'set via this.label please';");
    expect(r.tsx).not.toMatch(/MIGRATION_TODO\(this\)/);
  });

  it('rewires the real ref while sparing an identical-looking string', async () => {
    const r = await run(`
      @Input() name!: string;
      log() { console.log('this.name =', this.name); }
    `);
    const flat = r.tsx.replace(/\s+/g, ' ');
    expect(flat).toContain("console.log('this.name =', name);");
  });
});

describe('harness invariants', () => {
  it('is deterministic / idempotent (same input -> byte-identical output)', async () => {
    const src = readFileSync(resolve(FIXTURE, 'shared/filter/filter.component.html'), 'utf8');
    const a = await transformTemplate(src, 'filter.html');
    const b = await transformTemplate(src, 'filter.html');
    expect(a.jsx).toBe(b.jsx);
    expect(a.jsx.length).toBeGreaterThan(0);
  });

  it('the real filter.component.html transforms cleanly (golden snapshot)', async () => {
    const src = readFileSync(resolve(FIXTURE, 'shared/filter/filter.component.html'), 'utf8');
    const r = await transformTemplate(src, 'filter.html');
    expect(r.ok).toBe(true);
    // The only residue is the two (keydown.enter) handlers, surfaced as
    // data-migration-todo markers — visible, not silently dropped.
    expect(r.coverage.todoReasons.every((t) => /keydown\.enter/.test(t))).toBe(true);
    expect(r.jsx).toMatchSnapshot();
  });
});
