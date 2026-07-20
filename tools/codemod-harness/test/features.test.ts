import { describe, it, expect } from 'vitest';
import { transformComponent } from '../src/transform-component.js';
import { parseAngularComponent } from '../src/parse/angular-component.js';

/** Wrap a class body in a minimal @Component with an inline template. */
function comp(body: string, template = '<div></div>'): string {
  return `
    import { Component } from '@angular/core';
    @Component({ selector: 'x-test', template: \`${template}\` })
    export class TestComponent {
      ${body}
    }
  `;
}

async function tsx(body: string, template?: string) {
  const r = await transformComponent(comp(body, template), '/tmp/test.component.ts');
  expect(r.ok).toBe(true);
  return r;
}

describe('A. HttpClient -> axios', () => {
  it('rewrites this.http.<verb>() to axios.<verb>() and flags Promise semantics', async () => {
    const r = await tsx(`
      http = inject(HttpClient);
      load(id: string) { return this.http.get<Thing>('/api/thing/' + id); }
      save(t: Thing) { return this.http.post('/api/thing', t); }
    `);
    expect(r.tsx).toContain("import axios from 'axios';");
    expect(r.tsx).toContain("axios.get<Thing>('/api/thing/' + id)");
    expect(r.tsx).toContain("axios.post('/api/thing', t)");
    expect(r.tsx).not.toContain('return this.http'); // no un-rewritten call left in a body
    expect(r.todos.join('\n')).toMatch(/HttpClient -> .*axios\.get.*res\.data/);
  });

  it('no axios import when HttpClient is injected but never called', async () => {
    const r = await tsx(`http = inject(HttpClient);`);
    expect(r.tsx).not.toContain("import axios");
  });
});

describe('B. RxJS residue', () => {
  it('flags Observable-typed fields and $-suffixed fields', async () => {
    const r = await tsx(`
      data$: Observable<number> = of(1);
      plain = 5;
    `);
    expect(r.tsx).toMatch(/MIGRATION_TODO\(rxjs\).*data\$/);
    expect(r.tsx).toContain('const plain = 5;');
    expect(r.todos.join('\n')).toMatch(/rxjs: field `data\$`/);
  });

  it('flags .subscribe() in a method and Observable return types', async () => {
    const r = await tsx(`
      run(): Observable<void> { this.svc.thing().subscribe(x => x); return of(); }
    `);
    expect(r.tsx).toMatch(/MIGRATION_TODO\(rxjs\).*\.subscribe\(\) call/);
    expect(r.tsx).toMatch(/MIGRATION_TODO\(rxjs\): returns `Observable<void>`/);
  });

  it('flags subscribe teardown in ngOnInit', async () => {
    const r = await tsx(`
      ngOnInit() { this.svc.load().subscribe(v => v); }
    `);
    expect(r.tsx).toMatch(/MIGRATION_TODO\(rxjs\): 1 \.subscribe\(\) call\(s\) here.*unsubscribe/);
  });
});

describe('C. async pipe -> component-scope hook stub', () => {
  it('lowers x | async in JSX and emits an unwrap stub', async () => {
    const r = await tsx(`user$ = of(null);`, '<span>{{ user$ | async }}</span>');
    expect(r.tsx).toContain('{user$}'); // lowered to a bare ref in JSX
    expect(r.tsx).toMatch(/MIGRATION_TODO\(async\): template bound `user\$ \| async`/);
    expect(r.tsx).toMatch(/const user = useObservable\(user\$\)/);
    expect(r.todos.join('\n')).toMatch(/async pipe: unwrap `user\$`|bind `user` in JSX/);
  });
});

describe('D. @ViewChild -> useRef', () => {
  it('emits useRef for @ViewChild and flags @ViewChildren', async () => {
    const r = await tsx(`
      @ViewChild('box') box!: ElementRef;
      @ViewChildren(Item) items!: QueryList<Item>;
    `);
    expect(r.tsx).toContain('const boxRef = useRef<ElementRef>(null);');
    expect(r.tsx).toMatch(/MIGRATION_TODO\(viewchild\).*ref=\{boxRef\}/);
    expect(r.tsx).toContain('const itemsRef = useRef<HTMLElement[]>([]);');
    expect(r.tsx).toMatch(/@ViewChildren\(Item\)/);
    expect(r.tsx).toMatch(/import \{[^}]*useRef/);
  });
});

describe('E. reactive forms residue', () => {
  it('flags FormGroup fields and FormBuilder init', async () => {
    const r = await tsx(`
      form: FormGroup = this.fb.group({ name: [''] });
      fb = inject(FormBuilder);
    `);
    expect(r.tsx).toMatch(/MIGRATION_TODO\(forms\).*react-hook-form/);
    expect(r.todos.join('\n')).toMatch(/forms: field `form`/);
  });

  it('comments out multi-line FormGroup initializers (prettier-safe)', async () => {
    const r = await tsx(`
      loginForm = new FormGroup({
        username: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
        password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
      });
    `);
    expect(r.ok).toBe(true);
    expect(r.tsx).toMatch(/\/\/ was: const loginForm = new FormGroup\(\{/);
    expect(r.tsx).not.toMatch(/^\s+username: new FormControl/m);
    expect(r.tsx).toMatch(/\/\/\s+username: new FormControl/);
  });
});

describe('parser IR fields', () => {
  it('populates viewChildren and subscribeCount', () => {
    const { model } = parseAngularComponent(
      comp(`
        @ViewChild('r') r!: ElementRef;
        ngOnInit() { this.a().subscribe(); this.b().subscribe(); }
      `),
      '/tmp/t.component.ts',
    );
    expect(model!.viewChildren).toEqual([
      { propName: 'r', selector: "'r'", isList: false, type: 'ElementRef' },
    ]);
    expect(model!.lifecycle.find((h) => h.name === 'ngOnInit')!.subscribeCount).toBe(2);
  });
});
