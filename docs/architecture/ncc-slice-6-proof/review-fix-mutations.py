# Mutations for the fixes the slice 6 review made, one per guard.
# Format and harness as mutations.py and mutate.py in this folder.
MUTATIONS = [
 ('C1-must-catch: every autowired class is refused', 'src/Container.ts', '    if (!Array.isArray(inject)) {\n      if (needed > 0) {', '    if (!Array.isArray(inject)) {\n      if (needed >= 0) {', 'killed'),
 ('C2-must-survive: comment only', 'src/Container.ts', '  private static ownerOfInject(concrete: Function): Function | undefined {', '  // control\n  private static ownerOfInject(concrete: Function): Function | undefined {', 'survive'),
 ('C3-must-refuse: syntax break', 'src/Container.ts', '  private static ownerOfInject(concrete: Function): Function | undefined {', '  private static ownerOfInject(concrete: Function): Function | undefined {{', 'refuse'),
 ('H1 the walk stops at the first constructor with no parameters', 'src/Container.ts', '      current = Object.getPrototypeOf(current);\n    }\n    return 0;', '      return 0;\n    }\n    return 0;', 'killed'),
 ('K1 an empty list never stops the walk', 'src/Container.ts', '    const stop = Array.isArray(inject) && inject.length === 0 ? Container.ownerOfInject(concrete) : undefined;', '    const stop = undefined;', 'killed'),
 ('K2 any list stops the walk at its owner', 'src/Container.ts', '    const stop = Array.isArray(inject) && inject.length === 0 ? Container.ownerOfInject(concrete) : undefined;', '    const stop = Array.isArray(inject) ? Container.ownerOfInject(concrete) : undefined;', 'killed'),
 ('K3 the walk stops before counting the owner of the empty list', 'src/Container.ts', '      if (current.length > 0) {\n        return current.length;\n      }\n      if (current === stop) {\n        return 0;\n      }', '      if (current === stop) {\n        return 0;\n      }\n      if (current.length > 0) {\n        return current.length;\n      }', 'killed'),
 ('F1 the 0.1 bind reads an explicit undefined singleton flag as transient', 'src/Container.ts', '    const singleton = rest[1] === undefined ? true : (rest[1] as boolean);', '    const singleton = rest.length > 1 ? (rest[1] as boolean) : true;', 'killed'),
 ('F1b rebind reads a missing flag as transient', 'src/Container.ts', 'factory: ContainerFactory<T>, singleton = true): void {', 'factory: ContainerFactory<T>, singleton = false): void {', 'killed'),
 ('F1c the 0.1 bind is always a singleton', 'src/Container.ts', '    const singleton = rest[1] === undefined ? true : (rest[1] as boolean);', '    const singleton = true;', 'killed'),
]
