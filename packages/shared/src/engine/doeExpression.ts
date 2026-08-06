/**
 * A tiny, deterministic expression parser/evaluator for `DoeConstraint.expression`.
 *
 * This is the whole surface: numeric literals, factor-code identifiers,
 * `+ - * /`, parentheses, unary minus, and one comparison operator
 * (`<= >= < > == !=`). Nothing else. There is NO `eval`, NO `new Function`,
 * NO access to any host object, and NO way to call anything — a malformed
 * or hostile expression can only ever fail to parse or evaluate, never
 * execute arbitrary code. See spec Phase 5 §5.3/§20: "expressions must use
 * a safe deterministic parser… never execute arbitrary JavaScript, Python
 * or shell expressions."
 */

export type DoeExpressionVariables = Record<string, number>;

interface DoeExpressionEvaluation {
  ok: boolean;
  value?: number;
  /** Present only for a comparison expression (contains one of `<= >= < > == !=`). */
  satisfied?: boolean;
  error?: string;
}

type TokenType = "number" | "identifier" | "op" | "lparen" | "rparen" | "eof";
interface Token {
  type: TokenType;
  value: string;
}

const COMPARISON_OPS = ["<=", ">=", "==", "!=", "<", ">"] as const;

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = expression;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ type: "lparen", value: c });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ type: "rparen", value: c });
      i++;
      continue;
    }
    // Two-character operators must be checked before their single-char prefix.
    const two = s.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "==" || two === "!=") {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }
    if ("+-*/<>".includes(c)) {
      tokens.push({ type: "op", value: c });
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const numText = s.slice(i, j);
      if (!/^\d+(\.\d+)?$/.test(numText)) {
        throw new Error(`Invalid number literal "${numText}" in expression.`);
      }
      tokens.push({ type: "number", value: numText });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_-]/.test(s[j])) j++;
      tokens.push({ type: "identifier", value: s.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error(`Unexpected character "${c}" in expression.`);
  }
  tokens.push({ type: "eof", value: "" });
  return tokens;
}

/** Recursive-descent parser producing a numeric AST, plus at most one
 *  top-level comparison. Grammar (highest to lowest precedence):
 *  primary -> number | identifier | "(" comparison ")"
 *  unary   -> "-" unary | primary
 *  term    -> unary (("*" | "/") unary)*
 *  additive -> term (("+" | "-") term)*
 *  comparison -> additive (COMPARISON_OP additive)? */
type AstNode =
  | { kind: "number"; value: number }
  | { kind: "identifier"; name: string }
  | { kind: "unary"; op: "-"; operand: AstNode }
  | { kind: "binary"; op: "+" | "-" | "*" | "/"; left: AstNode; right: AstNode };

interface ParsedExpression {
  left: AstNode;
  comparisonOp?: (typeof COMPARISON_OPS)[number];
  right?: AstNode;
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    return this.tokens[this.pos++];
  }

  private expect(type: TokenType): Token {
    const t = this.consume();
    if (t.type !== type) throw new Error(`Expected ${type} but found "${t.value || "end of expression"}".`);
    return t;
  }

  parse(): ParsedExpression {
    const left = this.parseAdditive();
    const next = this.peek();
    if (next.type === "op" && (COMPARISON_OPS as readonly string[]).includes(next.value)) {
      const op = this.consume().value as (typeof COMPARISON_OPS)[number];
      const right = this.parseAdditive();
      this.expect("eof");
      return { left, comparisonOp: op, right };
    }
    this.expect("eof");
    return { left };
  }

  private parseAdditive(): AstNode {
    let node = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (t.type === "op" && (t.value === "+" || t.value === "-")) {
        this.consume();
        const right = this.parseTerm();
        node = { kind: "binary", op: t.value, left: node, right };
      } else break;
    }
    return node;
  }

  private parseTerm(): AstNode {
    let node = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.type === "op" && (t.value === "*" || t.value === "/")) {
        this.consume();
        const right = this.parseUnary();
        node = { kind: "binary", op: t.value, left: node, right };
      } else break;
    }
    return node;
  }

  private parseUnary(): AstNode {
    const t = this.peek();
    if (t.type === "op" && t.value === "-") {
      this.consume();
      return { kind: "unary", op: "-", operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): AstNode {
    const t = this.consume();
    if (t.type === "number") return { kind: "number", value: Number(t.value) };
    if (t.type === "identifier") return { kind: "identifier", name: t.value };
    if (t.type === "lparen") {
      const node = this.parseAdditive();
      this.expect("rparen");
      return node;
    }
    throw new Error(`Unexpected token "${t.value || "end of expression"}".`);
  }
}

function evaluateNode(node: AstNode, variables: DoeExpressionVariables): number {
  switch (node.kind) {
    case "number":
      return node.value;
    case "identifier": {
      const v = variables[node.name];
      if (v === undefined) throw new Error(`Unknown factor code "${node.name}" in expression.`);
      return v;
    }
    case "unary":
      return -evaluateNode(node.operand, variables);
    case "binary": {
      const l = evaluateNode(node.left, variables);
      const r = evaluateNode(node.right, variables);
      switch (node.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          if (r === 0) throw new Error("Division by zero in expression.");
          return l / r;
      }
    }
  }
}

/** Parses and validates an expression against a set of known factor codes,
 *  without evaluating it — used at constraint-creation time so a typo in a
 *  factor code is caught immediately rather than at design-generation time. */
export function validateDoeExpressionSyntax(expression: string, knownFactorCodes: readonly string[]): { valid: boolean; error?: string; referencedFactorCodes: string[] } {
  try {
    const tokens = tokenize(expression);
    const parsed = new Parser(tokens).parse();
    const referenced = new Set<string>();
    const collect = (node: AstNode): void => {
      if (node.kind === "identifier") referenced.add(node.name);
      else if (node.kind === "unary") collect(node.operand);
      else if (node.kind === "binary") {
        collect(node.left);
        collect(node.right);
      }
    };
    collect(parsed.left);
    if (parsed.right) collect(parsed.right);
    const unknown = [...referenced].filter((name) => !knownFactorCodes.includes(name));
    if (unknown.length > 0) {
      return { valid: false, error: `Unknown factor code(s): ${unknown.join(", ")}.`, referencedFactorCodes: [...referenced] };
    }
    return { valid: true, referencedFactorCodes: [...referenced] };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err), referencedFactorCodes: [] };
  }
}

/** Evaluates an expression (numeric, or one comparison) against a set of
 *  factor-code -> numeric-value bindings. Never throws — a parse or
 *  evaluation error is returned as `{ ok: false, error }`, so a caller
 *  validating many candidate points in a loop never needs try/catch. */
export function evaluateDoeExpression(expression: string, variables: DoeExpressionVariables): DoeExpressionEvaluation {
  try {
    const tokens = tokenize(expression);
    const parsed = new Parser(tokens).parse();
    const leftValue = evaluateNode(parsed.left, variables);
    if (!parsed.comparisonOp || parsed.right === undefined) {
      return { ok: true, value: leftValue };
    }
    const rightValue = evaluateNode(parsed.right, variables);
    let satisfied: boolean;
    switch (parsed.comparisonOp) {
      case "<=":
        satisfied = leftValue <= rightValue;
        break;
      case ">=":
        satisfied = leftValue >= rightValue;
        break;
      case "<":
        satisfied = leftValue < rightValue;
        break;
      case ">":
        satisfied = leftValue > rightValue;
        break;
      case "==":
        satisfied = Math.abs(leftValue - rightValue) < 1e-9;
        break;
      case "!=":
        satisfied = Math.abs(leftValue - rightValue) >= 1e-9;
        break;
    }
    return { ok: true, value: leftValue - rightValue, satisfied };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
