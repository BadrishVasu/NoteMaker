// Ticket 09's intra-file guard: parses a source file and reports every way it could write to
// Firestore other than runTransaction. Parsed, not grepped, so an aliased import is still caught.

import ts from 'typescript'

const DIRECT_WRITES = new Set(['setDoc', 'updateDoc', 'addDoc', 'deleteDoc', 'writeBatch'])
const isFirestore = (specifier: string) => specifier === 'firebase/firestore' || specifier.startsWith('firebase/firestore/')

/** Names imported from firebase/firestore, by their exported (not local) name. */
export function firestoreImportsIn(source: string): string[] {
  const names: string[] = []
  const file = ts.createSourceFile('gateway.ts', source, ts.ScriptTarget.Latest, true)
  for (const stmt of file.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier) || !isFirestore(stmt.moduleSpecifier.text)) continue
    const bindings = stmt.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) names.push((el.propertyName ?? el.name).text)
    }
  }
  return names
}

export function writePathViolations(source: string): string[] {
  const violations: string[] = []
  const file = ts.createSourceFile('gateway.ts', source, ts.ScriptTarget.Latest, true)

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && isFirestore(node.moduleSpecifier.text)) {
      if (node.moduleSpecifier.text !== 'firebase/firestore') violations.push(`subpath import ${node.moduleSpecifier.text}`)
      const clause = node.importClause
      if (clause?.name) violations.push('default import of firebase/firestore')
      const bindings = clause?.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) violations.push('namespace import of firebase/firestore')
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          const name = (el.propertyName ?? el.name).text
          if (DIRECT_WRITES.has(name)) violations.push(`imports ${name}`)
        }
      }
    }
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const arg = node.arguments[0]!
      const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const required = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if ((dynamic || required) && ts.isStringLiteralLike(arg) && isFirestore(arg.text)) {
        violations.push(`${dynamic ? 'dynamic import' : 'require'} of ${arg.text}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return violations
}
