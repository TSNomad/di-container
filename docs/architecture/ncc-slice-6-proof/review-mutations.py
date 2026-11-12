# Slice 6 review spot check of the P1 class path, run against the PR head.
# The inherited-parameter walk moved to review-fix-mutations.py, as H1.
# Format and harness as mutations.py and mutate.py in this folder.
MUTATIONS = [
 ('C1-must-catch: get always rejects', 'src/Container.ts', '    return (await this.resolve(abstract, null)) as T;', "    throw new Error('control');", 'killed'),
 ('C2-must-survive: comment only', 'src/Container.ts', '  private static emptySlot(): Slot {', '  // control comment\n  private static emptySlot(): Slot {', 'survive'),
 ('C3-must-refuse: syntax break', 'src/Container.ts', '  private static emptySlot(): Slot {', '  private static emptySlot(): Slot {{', 'refuse'),
 ('R1 a failed build stays pending, so its rejection is cached', 'src/Container.ts', '    const node = this.start(build, (settled) => {\n      slot.pending = undefined;', '    const node = this.start(build, (settled) => {', 'killed'),
 ('R2 a failed autowire stays recorded', 'src/Container.ts', '      this.autowired.delete(cls);\n    });', '    });', 'killed'),
 ('R3 a short inject list is accepted', 'src/Container.ts', '    if (inject.length < needed) {', '    if (inject.length < needed - 1000) {', 'killed'),
 ('R4 no loop check when waiting on a build in flight', 'src/Container.ts', '    const loop = this.loopThrough(target, name, requester);\n    if (loop) {\n      return Promise.reject(loop);\n    }\n\n    // Every wait', '    // Every wait', 'killed'),
 ('R5 an abstract named twice in one bind call is accepted', 'src/Container.ts', "keys.includes(key) ? 'repeated' : this.refusal(key)", 'this.refusal(key)', 'killed'),
]
