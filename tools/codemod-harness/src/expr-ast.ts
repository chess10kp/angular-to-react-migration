/**
 * Angular binding-expression AST -> JS expression string.
 *
 * This is the AST-boosted core of the expression layer. Angular's template
 * parser already builds a full expression AST for every binding, interpolation
 * and event handler; rather than re-scan the raw source string with regexes,
 * we walk that AST with a precedence-aware printer and lower it to JS.
 *
 * Working on the AST (not the source text) is what makes pipes correct at any
 * nesting depth (`'a.' + k | translate`, `cond ? (x | date) : y`), makes
 * `$event` a *node* we rewrite rather than a substring we hope isn't inside a
 * string literal, and lets precedence — not a parenthesization heuristic —
 * decide where parens go. Output is re-parsed by Babel and Prettier downstream,
 * so redundant parens / quote style are normalized for us.
 */

import { Lexer, Parser } from '@angular/compiler';
import type {
  AST,
  ASTWithSource,
  AstVisitor,
  Binary,
  BindingPipe,
  Call,
  Chain,
  Conditional,
  Interpolation,
  KeyedRead,
  KeyedWrite,
  LiteralArray,
  LiteralMap,
  LiteralPrimitive,
  NonNullAssert,
  PrefixNot,
  PropertyRead,
  PropertyWrite,
  SafeCall,
  SafeKeyedRead,
  SafePropertyRead,
  Unary,
} from '@angular/compiler';
import type { ExprResult } from './expr.js';

/** JS operator precedence tiers (higher binds tighter). */
const P = {
  PRIMARY: 20,
  POSTFIX: 18, // member access, call, non-null `!`
  UNARY: 15,
  MUL: 14,
  ADD: 13,
  REL: 11,
  EQ: 10,
  BAND: 9,
  BXOR: 8,
  BOR: 7,
  LAND: 6,
  LOR: 5,
  NULLISH: 5,
  COND: 4,
  ASSIGN: 3,
  COMMA: 1,
} as const;

const BINARY_PREC: Record<string, number> = {
  '*': P.MUL, '/': P.MUL, '%': P.MUL,
  '+': P.ADD, '-': P.ADD,
  '<': P.REL, '>': P.REL, '<=': P.REL, '>=': P.REL, in: P.REL, instanceof: P.REL,
  '==': P.EQ, '!=': P.EQ, '===': P.EQ, '!==': P.EQ,
  '&': P.BAND, '^': P.BXOR, '|': P.BOR,
  '&&': P.LAND, '||': P.LOR, '??': P.NULLISH,
};

/** A printed subexpression plus the precedence of its outermost operator. */
interface Printed {
  t: string;
  p: number;
}

/** Wrap `r` in parens if its precedence is below the required minimum. */
function paren(r: Printed, min: number): string {
  return r.p < min ? `(${r.t})` : r.t;
}

/** Constructor name with Angular's minification suffix (`Foo$1`) stripped. */
function kind(node: any): string {
  return (node?.constructor?.name ?? '').replace(/\$\d+$/, '');
}

/** True for the implicit template receiver (`x` desugars from `<implicit>.x`). */
function isImplicit(node: any): boolean {
  const k = kind(node);
  return k === 'ImplicitReceiver' || k === 'ThisReceiver';
}

/**
 * Prints an Angular expression AST to JS. One instance per translated
 * expression so pipe side-effects (todos / translate / helper imports)
 * accumulate into a single `ExprResult`.
 */
class Printer implements AstVisitor {
  constructor(
    private readonly out: ExprResult,
    /** Identifier a template `$event` lowers to (event handlers only). */
    private readonly eventVar: string | null = null,
    /**
     * Bare identifiers to rewrite (e.g. reserved-word methods `delete` ->
     * `deleteItem`). Applied only to implicit-receiver reads/writes — member
     * access on another object (`obj.delete`) is left alone.
     */
    private readonly renames: ReadonlyMap<string, string> = new Map(),
  ) {}

  /** Entry point: print a whole expression AST to a JS string. */
  print(node: AST): string {
    return this.go(node).t;
  }

  /** Visit a node and return `{ text, precedence }`. */
  private go(node: AST): Printed {
    return node.visit(this) as Printed;
  }

  /** Print a node, parenthesizing to satisfy a minimum precedence. */
  private at(node: AST, min: number): string {
    return paren(this.go(node), min);
  }

  /** Rename a bare component member if the component emitter renamed it. */
  private id(name: string): string {
    return this.renames.get(name) ?? name;
  }

  visitASTWithSource(ast: ASTWithSource): Printed {
    return this.go(ast.ast);
  }

  visitImplicitReceiver(): Printed {
    return { t: '', p: P.PRIMARY };
  }

  visitThisReceiver(): Printed {
    return { t: 'this', p: P.PRIMARY };
  }

  visitPropertyRead(ast: PropertyRead): Printed {
    // A bare `$event` (implicit receiver) in a handler body -> the JSX arg.
    if (this.eventVar && ast.name === '$event' && isImplicit(ast.receiver)) {
      return { t: this.eventVar, p: P.PRIMARY };
    }
    if (isImplicit(ast.receiver)) {
      const self = kind(ast.receiver) === 'ThisReceiver' ? 'this.' : '';
      return { t: `${self}${this.id(ast.name)}`, p: self ? P.POSTFIX : P.PRIMARY };
    }
    return { t: `${this.at(ast.receiver, P.POSTFIX)}.${ast.name}`, p: P.POSTFIX };
  }

  visitSafePropertyRead(ast: SafePropertyRead): Printed {
    return { t: `${this.at(ast.receiver, P.POSTFIX)}?.${ast.name}`, p: P.POSTFIX };
  }

  visitPropertyWrite(ast: PropertyWrite): Printed {
    const target = isImplicit(ast.receiver)
      ? (kind(ast.receiver) === 'ThisReceiver' ? `this.${this.id(ast.name)}` : this.id(ast.name))
      : `${this.at(ast.receiver, P.POSTFIX)}.${ast.name}`;
    return { t: `${target} = ${this.at(ast.value, P.ASSIGN)}`, p: P.ASSIGN };
  }

  visitKeyedRead(ast: KeyedRead): Printed {
    return { t: `${this.at(ast.receiver, P.POSTFIX)}[${this.at(ast.key, P.COMMA)}]`, p: P.POSTFIX };
  }

  visitSafeKeyedRead(ast: SafeKeyedRead): Printed {
    return { t: `${this.at(ast.receiver, P.POSTFIX)}?.[${this.at(ast.key, P.COMMA)}]`, p: P.POSTFIX };
  }

  visitKeyedWrite(ast: KeyedWrite): Printed {
    const target = `${this.at(ast.receiver, P.POSTFIX)}[${this.at(ast.key, P.COMMA)}]`;
    return { t: `${target} = ${this.at(ast.value, P.ASSIGN)}`, p: P.ASSIGN };
  }

  visitCall(ast: Call): Printed {
    // `$any(x)` is a compile-time cast in Angular; JS keeps just the value.
    if (kind(ast.receiver) === 'PropertyRead') {
      const r = ast.receiver as PropertyRead;
      if (r.name === '$any' && isImplicit(r.receiver) && ast.args.length === 1) {
        return { t: this.at(ast.args[0], P.COMMA), p: P.PRIMARY };
      }
    }
    return { t: `${this.at(ast.receiver, P.POSTFIX)}(${this.argList(ast.args)})`, p: P.POSTFIX };
  }

  visitSafeCall(ast: SafeCall): Printed {
    return { t: `${this.at(ast.receiver, P.POSTFIX)}?.(${this.argList(ast.args)})`, p: P.POSTFIX };
  }

  private argList(args: AST[]): string {
    return args.map((a) => this.at(a, P.ASSIGN)).join(', ');
  }

  visitLiteralArray(ast: LiteralArray): Printed {
    return { t: `[${ast.expressions.map((e) => this.at(e, P.ASSIGN)).join(', ')}]`, p: P.PRIMARY };
  }

  visitLiteralMap(ast: LiteralMap): Printed {
    const entries = ast.keys.map((k, i) => {
      const key = k.quoted ? quoteString(k.key) : k.key;
      return `${key}: ${this.at(ast.values[i], P.ASSIGN)}`;
    });
    return { t: entries.length ? `{ ${entries.join(', ')} }` : '{}', p: P.PRIMARY };
  }

  visitLiteralPrimitive(ast: LiteralPrimitive): Printed {
    return { t: printPrimitive(ast.value), p: P.PRIMARY };
  }

  visitConditional(ast: Conditional): Printed {
    const t = `${this.at(ast.condition, P.LOR)} ? ${this.at(ast.trueExp, P.ASSIGN)} : ${this.at(ast.falseExp, P.ASSIGN)}`;
    return { t, p: P.COND };
  }

  visitBinary(ast: Binary): Printed {
    // `Unary` is modeled as a Binary subclass; route it out.
    if (kind(ast) === 'Unary') return this.visitUnary(ast as unknown as Unary);
    const op = ast.operation;
    const prec = BINARY_PREC[op] ?? P.COMMA;
    // A child operand needs parens either for precedence, or because mixing
    // `??` with `&&`/`||` is a syntax error in JS regardless of precedence.
    const operand = (node: AST, min: number): string => {
      const childOp = kind(node) === 'Binary' ? (node as Binary).operation : null;
      const mustParen =
        (op === '??') !== (childOp === '??') && (childOp === '&&' || childOp === '||' || childOp === '??');
      const r = this.go(node);
      return mustParen ? `(${r.t})` : paren(r, min);
    };
    // Left-associative: the right operand binds one tier tighter.
    return { t: `${operand(ast.left, prec)} ${op} ${operand(ast.right, prec + 1)}`, p: prec };
  }

  visitUnary(ast: Unary): Printed {
    return { t: `${ast.operator}${this.at(ast.expr, P.UNARY)}`, p: P.UNARY };
  }

  visitPrefixNot(ast: PrefixNot): Printed {
    return { t: `!${this.at(ast.expression, P.UNARY)}`, p: P.UNARY };
  }

  visitNonNullAssert(ast: NonNullAssert): Printed {
    return { t: `${this.at(ast.expression, P.POSTFIX)}!`, p: P.POSTFIX };
  }

  visitChain(ast: Chain): Printed {
    // Multi-statement handler bodies -> comma expression (arrow-body friendly).
    return { t: ast.expressions.map((e) => this.at(e, P.ASSIGN)).join(', '), p: P.COMMA };
  }

  visitInterpolation(ast: Interpolation): Printed {
    // Bindings don't usually surface as an Interpolation node here, but if one
    // does, render a template literal so nothing is lost.
    let s = '`' + ast.strings[0].replace(/`/g, '\\`');
    ast.expressions.forEach((e, i) => {
      s += '${' + this.go(e).t + '}' + ast.strings[i + 1].replace(/`/g, '\\`');
    });
    return { t: s + '`', p: P.PRIMARY };
  }

  visitPipe(ast: BindingPipe): Printed {
    const base = this.go(ast.exp);
    const args = ast.args.map((a) => this.at(a, P.ASSIGN));
    return applyPipe(base, ast.name, args, this.out);
  }
}

/** Lower one `exp | name:args` pipe to a JS `Printed` value. */
function applyPipe(base: Printed, name: string, args: string[], out: ExprResult): Printed {
  const call = (callee: string): Printed => ({ t: `${callee}(${[base.t, ...args].join(', ')})`, p: P.POSTFIX });
  const method = (m: string): Printed => ({ t: `${paren(base, P.POSTFIX)}.${m}(${args.join(', ')})`, p: P.POSTFIX });
  const helper = (fn: string): Printed => {
    (out.helpers ??= []).push(fn);
    return call(fn);
  };
  switch (name) {
    case 'translate':
      out.usesTranslate = true;
      if (args.length > 0) out.todos.push(`translate pipe with params not yet supported: \`${base.t} | translate:…\``);
      return { t: `t(${base.t})`, p: P.POSTFIX };
    case 'json':
      return { t: `JSON.stringify(${base.t})`, p: P.POSTFIX };
    case 'uppercase':
      return method('toUpperCase');
    case 'lowercase':
      return method('toLowerCase');
    case 'slice':
      return method('slice');
    case 'titlecase':
      return helper('titleCase');
    case 'date':
      return helper('formatDate');
    case 'number':
      return helper('formatNumber');
    case 'currency':
      return helper('formatCurrency');
    case 'percent':
      return helper('formatPercent');
    case 'keyvalue':
      out.todos.push(`keyvalue pipe -> Object.entries (verify sort/compareFn semantics): \`${base.t} | keyvalue\``);
      return { t: `Object.entries(${base.t})`, p: P.POSTFIX };
    case 'async':
      // Lower `x | async` to a bare `x` in the JSX and record a structured hint
      // (the `async pipe: unwrap \`EXPR\`` marker) so the component emitter can
      // emit a component-scope unwrap stub. See transform-component.ts.
      (out.asyncBindings ??= []).push(base.t);
      out.todos.push(
        `async pipe on \`${base.t}\` — unwrap the Observable/Promise at component scope (useObservable / useState+useEffect+subscribe with teardown) and bind the result in JSX`,
      );
      return base;
    default:
      out.todos.push(`unsupported pipe \`${name}\` in expression \`${base.t} | ${name}\``);
      return base;
  }
}

/** Render a `LiteralPrimitive` value as JS source. */
function printPrimitive(value: unknown): string {
  if (typeof value === 'string') return quoteString(value);
  if (value === undefined) return 'undefined';
  return String(value); // number, boolean, null
}

/** Single-quoted JS string literal (Prettier reconciles final quote style). */
function quoteString(v: string): string {
  return "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r') + "'";
}

// One parser instance is enough — it is stateless across calls.
const parser = new Parser(new Lexer());

/** Parse + print an Angular *binding* expression (pipes allowed). */
export function printBinding(
  src: string,
  out: ExprResult,
  renames?: ReadonlyMap<string, string>,
): string | null {
  const parsed = parser.parseBinding(src, 'expr', 0);
  return finish(parsed, out, null, renames);
}

/** Parse + print an Angular *action* expression (assignments/chains, `$event`). */
export function printAction(
  src: string,
  out: ExprResult,
  eventVar: string,
  renames?: ReadonlyMap<string, string>,
): string | null {
  const parsed = parser.parseAction(src, 'action', 0);
  return finish(parsed, out, eventVar, renames);
}

function finish(
  parsed: ASTWithSource,
  out: ExprResult,
  eventVar: string | null,
  renames?: ReadonlyMap<string, string>,
): string | null {
  if (parsed.errors.length) {
    out.todos.push(`could not parse expression \`${parsed.source}\` (${parsed.errors[0].message})`);
    return null;
  }
  if (kind(parsed.ast) === 'EmptyExpr') return '';
  return new Printer(out, eventVar, renames ?? new Map()).print(parsed.ast);
}
