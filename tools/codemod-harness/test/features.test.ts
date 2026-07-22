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

  it('emits useRef for signal queries viewChild()/viewChild.required()/viewChildren()', async () => {
    const r = await tsx(`
      box = viewChild<ElementRef>('box');
      req = viewChild.required('req');
      items = viewChildren(Item);
      panel = contentChild('panel', { read: ElementRef });
    `);
    // viewChild<ElementRef>('box') keeps its type arg on the useRef.
    expect(r.tsx).toContain('const boxRef = useRef<ElementRef>(null);');
    // signal read note points at .current
    expect(r.tsx).toMatch(/was viewChild\('box'\)/);
    expect(r.tsx).toMatch(/`box\(\)` maps to `boxRef\.current`/);
    // .required form is recorded in the origin
    expect(r.tsx).toMatch(/was viewChild\.required\('req'\)/);
    // viewChildren -> list ref
    expect(r.tsx).toContain('const itemsRef = useRef<HTMLElement[]>([]);');
    expect(r.tsx).toMatch(/was viewChildren\(Item\)/);
    // contentChild { read: ElementRef } -> ref type + content note
    expect(r.tsx).toContain('const panelRef = useRef<ElementRef>(null);');
    expect(r.tsx).toMatch(/Content queries target projected children/);
  });
});

describe('E. reactive forms -> react-hook-form', () => {
  it('lowers a fb.group() to useForm() with extracted defaultValues', async () => {
    const r = await tsx(`
      form: FormGroup = this.fb.group({ name: [''], age: [0] });
      fb = inject(FormBuilder);
    `);
    expect(r.ok).toBe(true);
    expect(r.tsx).toMatch(/import \{ useForm \} from 'react-hook-form';/);
    expect(r.tsx).toMatch(/const form = useForm<\{ name: string; age: number \}>\(\{/);
    expect(r.tsx).toMatch(/name: '',/);
    expect(r.tsx).toMatch(/age: 0,/);
    expect(r.todos.join('\n')).toMatch(/forms: field `form` -> react-hook-form useForm/);
  });

  it('lowers new FormGroup + FormControl and surfaces validators as a resolver TODO', async () => {
    const r = await tsx(`
      loginForm = new FormGroup({
        username: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
        password: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(8)] }),
      });
    `);
    expect(r.ok).toBe(true);
    expect(r.tsx).toMatch(/const loginForm = useForm<\{ username: string; password: string \}>/);
    expect(r.tsx).toMatch(/username: '',/);
    expect(r.tsx).not.toMatch(/new FormControl/);
    expect(r.tsx).toMatch(/MIGRATION_TODO\(forms-validators\).*zod\/yup/);
    expect(r.tsx).toMatch(/username: \[Validators\.required\]/);
    expect(r.tsx).toMatch(/password: \[Validators\.required, Validators\.minLength\(8\)\]/);
  });

  it('falls back to residue when the group config is not a literal', async () => {
    const r = await tsx(`
      editForm: FormGroup = this.fb.group(this.buildConfig());
    `);
    // Detected as a form, but no object literal to read -> residue, not a bogus useForm.
    expect(r.tsx).not.toMatch(/= useForm\(/);
    expect(r.tsx).toMatch(/MIGRATION_TODO\(forms\)/);
    expect(r.todos.join('\n')).toMatch(/forms: field `editForm`/);
  });

  it('marks nested FormGroups for hand-porting', async () => {
    const r = await tsx(`
      form = new FormGroup({
        name: new FormControl(''),
        address: new FormGroup({ city: new FormControl('') }),
      });
    `);
    expect(r.tsx).toMatch(/const form = useForm/);
    expect(r.tsx).toMatch(/address: undefined,.*nested FormGroup/);
  });

  it('lowers template form bindings to react-hook-form idioms', async () => {
    const r = await tsx(
      `
        editForm = this.fb.group({ name: [''] });
        fb = inject(FormBuilder);
        save() {}
      `,
      `<form [formGroup]="editForm" (ngSubmit)="save()">
        <input formControlName="name" />
        <div *ngIf="editForm.get('name')?.invalid">bad</div>
        <span>{{ editForm.value.name }}</span>
        <button [disabled]="editForm.invalid">Save</button>
      </form>`,
    );
    // [formGroup] + (ngSubmit) -> onSubmit={handleSubmit(save)}; formGroup dropped.
    expect(r.tsx).toMatch(/<form onSubmit=\{editForm\.handleSubmit\(save\)\}>/);
    expect(r.tsx).not.toMatch(/formGroup=/);
    // formControlName -> register spread
    expect(r.tsx).toMatch(/<input \{\.\.\.editForm\.register\('name'\)\} \/>/);
    // get('name')?.invalid -> formState.errors.name
    expect(r.tsx).toMatch(/editForm\.formState\.errors\.name && <div>bad<\/div>/);
    // editForm.value.name -> watch('name')
    expect(r.tsx).toMatch(/editForm\.watch\('name'\)/);
    // editForm.invalid -> !formState.isValid
    expect(r.tsx).toMatch(/disabled=\{!editForm\.formState\.isValid\}/);
  });

  it('lowers method-body reactive-form ops to react-hook-form idioms', async () => {
    const r = await tsx(
      `
        editForm = this.fb.group({ name: [''], age: [0] });
        fb = inject(FormBuilder);
        load(data: any) {
          this.editForm.patchValue({ name: data.name });
          this.editForm.get('age')?.setValue(data.age);
        }
        submit() {
          if (this.editForm.invalid) { this.editForm.markAllAsTouched(); return; }
          const payload = this.editForm.value;
          const who = this.editForm.get('name')?.value;
          console.log(payload, who);
        }
      `,
    );
    // patchValue(v) -> reset(v) (whole-form, args preserved)
    expect(r.tsx).toMatch(/editForm\.reset\(\{ name: data\.name \}\)/);
    // get('age')?.setValue(x) -> setValue('age', x) (arg preserved)
    expect(r.tsx).toMatch(/editForm\.setValue\('age', data\.age\)/);
    // invalid -> !formState.isValid; markAllAsTouched() -> trigger()
    expect(r.tsx).toMatch(/if \(!editForm\.formState\.isValid\)/);
    expect(r.tsx).toMatch(/editForm\.trigger\(\);/);
    // whole-form .value -> getValues()
    expect(r.tsx).toMatch(/const payload = editForm\.getValues\(\);/);
    // get('name')?.value -> getValues('name')
    expect(r.tsx).toMatch(/const who = editForm\.getValues\('name'\);/);
    // no raw Angular form API survives in the method bodies
    expect(r.tsx).not.toMatch(/editForm\.patchValue/);
    expect(r.tsx).not.toMatch(/editForm\.get\(/);
  });

  it('lowers form.valueChanges.subscribe(cb) to RHF watch(cb)', async () => {
    const r = await tsx(
      `
        editForm = this.fb.group({ name: [''] });
        fb = inject(FormBuilder);
        ngOnInit() {
          this.sub = this.editForm.valueChanges.subscribe((v) => this.onChange(v));
        }
        ngOnDestroy() { this.sub?.unsubscribe(); }
      `,
    );
    // .valueChanges.subscribe( -> .watch( (head-only, callback preserved)
    expect(r.tsx).toMatch(/editForm\.watch\(\(v\) => this\.onChange\(v\)\)/);
    // the RxJS accessor is gone; the .unsubscribe() cleanup still type-checks
    // against watch()'s return value
    expect(r.tsx).not.toMatch(/valueChanges/);
    expect(r.tsx).toMatch(/\.unsubscribe\(\)/);
  });

  it('leaves piped .valueChanges and .statusChanges as residue', async () => {
    const r = await tsx(
      `
        editForm = this.fb.group({ name: [''] });
        fb = inject(FormBuilder);
        ngOnInit() {
          this.editForm.valueChanges.pipe(debounceTime(300)).subscribe((v) => this.onChange(v));
          this.editForm.statusChanges.subscribe((s) => this.onStatus(s));
        }
      `,
    );
    // a .pipe(...) between valueChanges and subscribe blocks the mechanical rewrite
    expect(r.tsx).toMatch(/editForm\.valueChanges\.pipe/);
    // both are surfaced in the flag note, not silently rewritten
    expect(r.todos.join('\n')).toMatch(/`editForm\.valueChanges`/);
    expect(r.todos.join('\n')).toMatch(/`editForm\.statusChanges`/);
    expect(r.todos.join('\n')).toMatch(/watch\(cb\)` inside a `useEffect`/);
  });
});

describe('F. @HostListener / @HostBinding', () => {
  it('lowers a global-target @HostListener to a mount useEffect with teardown', async () => {
    const r = await tsx(`
      width = signal(0);
      @HostListener('window:resize', ['$event'])
      onResize(event: Event) { this.width.set(window.innerWidth); }
    `);
    expect(r.tsx).toContain("import { useEffect, useState } from 'react';");
    // real, compilable listener wiring — not a comment
    expect(r.tsx).toMatch(/const onResize = \(event: Event\) => \{/);
    expect(r.tsx).toMatch(/setWidth\(window\.innerWidth\)/); // this. rewired
    expect(r.tsx).toMatch(/window\.addEventListener\('resize', onResize as EventListener\)/);
    expect(r.tsx).toMatch(/return \(\) => window\.removeEventListener\('resize', onResize as EventListener\)/);
  });

  it('flags a host-element @HostListener with the root-element prop to bind', async () => {
    const r = await tsx(`
      @HostListener('click', ['$event'])
      onClick(e: MouseEvent) { console.log(e); }
    `);
    // handler kept as a named const so the reviewer can wire it up
    expect(r.tsx).toMatch(/const onClick = \(e: MouseEvent\) => \{/);
    expect(r.tsx).toMatch(/onClick=\{onClick\}/); // in the note
    expect(r.todos.join('\n')).toMatch(/@HostListener\('click'\).*onClick.*root JSX element/);
  });

  it('maps keydown pseudo-events to the base React prop', async () => {
    const r = await tsx(`
      @HostListener('keydown.escape', ['$event'])
      onEsc(e: KeyboardEvent) { this.close(); }
    `);
    expect(r.todos.join('\n')).toMatch(/onKeydown=\{onEsc\}/);
  });

  it('flags @HostBinding with a kind-shaped root-element hint and keeps the value', async () => {
    const r = await tsx(`
      @HostBinding('class.active') isActive = false;
      @HostBinding('attr.role') role = 'button';
      @HostBinding('style.width') width = '10px';
      @HostBinding('disabled') disabled = false;
    `);
    expect(r.tsx).toContain('const isActive = false;');
    expect(r.todos.join('\n')).toMatch(/className=\{clsx\(\{ 'active': isActive \}\)\}/);
    expect(r.todos.join('\n')).toMatch(/role=\{role\}/);
    expect(r.todos.join('\n')).toMatch(/style=\{\{ width: width \}\}/);
    expect(r.todos.join('\n')).toMatch(/disabled=\{disabled\}/);
  });

  it('parses @HostListener/@HostBinding into the IR (not methods/fields)', () => {
    const { model } = parseAngularComponent(
      comp(`
        @HostBinding('class.open') open = false;
        @HostListener('document:keyup', ['$event'])
        onKeyup(e: Event) {}
      `),
      '/tmp/t.component.ts',
    );
    expect(model!.hostBindings).toEqual([
      { binding: 'class.open', propName: 'open', init: 'false' },
    ]);
    expect(model!.hostListeners[0]).toMatchObject({
      event: 'keyup',
      target: 'document',
      args: ['$event'],
      name: 'onKeyup',
    });
    // not double-counted as a plain method/field
    expect(model!.methods.find((m) => m.name === 'onKeyup')).toBeUndefined();
    expect(model!.plainFields.find((f) => f.name === 'open')).toBeUndefined();
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
