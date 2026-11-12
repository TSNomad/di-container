# Mutations for the fixes the slice 6 review made, one per guard.
# Format and harness as mutations.py and mutate.py in this folder.
MUTATIONS = [
 ('C1-must-catch: every autowired class is refused', 'src/Container.ts', '    if (!Array.isArray(inject)) {\n      if (needed > 0) {', '    if (!Array.isArray(inject)) {\n      if (needed >= 0) {', 'killed'),
 ('C2-must-survive: comment only', 'src/Container.ts', '  private static parameterCount(concrete: Function): number {', '  // control\n  private static parameterCount(concrete: Function): number {', 'survive'),
 ('C3-must-refuse: syntax break', 'src/Container.ts', '  private static parameterCount(concrete: Function): number {', '  private static parameterCount(concrete: Function): number {{', 'refuse'),
 ('H1 the walk stops at the first constructor with no parameters', 'src/Container.ts', '      current = Object.getPrototypeOf(current);\n    }\n    return 0;', '      return 0;\n    }\n    return 0;', 'killed'),
 ('H2 an own inject list is held to the chain, not its own constructor', 'src/Container.ts', '      ? concrete.length\n      : Container.parameterCount(concrete);', '      ? Container.parameterCount(concrete)\n      : Container.parameterCount(concrete);', 'killed'),
 ("H3 an inherited inject list counts as the class's own", 'src/Container.ts', "    const needed = Object.prototype.hasOwnProperty.call(concrete, 'inject')", '    const needed = Array.isArray(inject)', 'killed'),
 ('H4 an own inject list is never checked for length', 'src/Container.ts', '      ? concrete.length\n      : Container.parameterCount(concrete);', '      ? 0\n      : Container.parameterCount(concrete);', 'killed'),
 ('F1 the 0.1 bind reads an explicit undefined singleton flag as transient', 'src/Container.ts', '    const singleton = rest[1] === undefined ? true : (rest[1] as boolean);', '    const singleton = rest.length > 1 ? (rest[1] as boolean) : true;', 'killed'),
 ('F1b rebind reads a missing flag as transient', 'src/Container.ts', 'factory: ContainerFactory<T>, singleton = true): void {', 'factory: ContainerFactory<T>, singleton = false): void {', 'killed'),
 ('F1c the 0.1 bind is always a singleton', 'src/Container.ts', '    const singleton = rest[1] === undefined ? true : (rest[1] as boolean);', '    const singleton = true;', 'killed'),
]
