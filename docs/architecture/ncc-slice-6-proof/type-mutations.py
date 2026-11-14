# One mutation per @ts-expect-error directive in test/autowire-type-safety.ts, plus three controls.
T = 'src/types.ts'
C = 'src/Container.ts'
H = 'src/HasBindings.ts'
P = 'src/InstanceProvider.ts'
BIND_OK = "  [K in keyof A]: T extends AbstractType<A[K]> ? A[K] : never;"
MUTATIONS = [
  ('TC1-must-catch: bind checks no abstract against the concrete', T, BIND_OK, "  [K in keyof A]: A[K];",
   ['must satisfy every abstract it is bound to', 'not only the first', 'HasBindings checks the concrete']),
  ('TC2-must-survive: comment only', T, BIND_OK, "  // harmless\n" + BIND_OK, 'survive'),
  ('TC3-must-refuse: syntax break', T, BIND_OK, "  [K in keyof A: A[K];", 'refuse'),
  ('TM1 Container.bind skips Injectable', C, "    concrete: C & Injectable<C>,", "    concrete: C,",
   ['must declare an inject list', 'must resolve to its constructor parameter', 'shorter than the constructor']),
  ('TM2 inject entries lose their parameter types', T, "  readonly [K in keyof P]: InjectEntry<P[K]>;", "  readonly [K in keyof P]: InjectEntry<any>;",
   ['must resolve to its constructor parameter']),
  ('TM3 a one-entry list passes for any constructor', T, "    : { readonly inject: InjectList<P> }", "    : { readonly inject: InjectList<P> | readonly [InjectEntry<P[0]>] }",
   ['shorter than the constructor']),
  ('TM5 only the first abstract is checked', T, BIND_OK, "  [K in keyof A]: K extends '0' ? (T extends AbstractType<A[K]> ? A[K] : never) : A[K];",
   ['not only the first']),
  ('TM6 Container.bind accepts zero abstracts', C, "  bind<C extends Constructor<object>, const A extends readonly [AnyAbstract, ...AnyAbstract[]]>(",
   "  bind<C extends Constructor<object>, const A extends readonly AnyAbstract[]>(", ['needs at least one abstract']),
  ('TM7a token factories unchecked', C, "  bindFactory<T>(abstract: TypedToken<T> | AbstractConstructor<T>, factory: ContainerFactory<NoInfer<T>>): this;",
   "  bindFactory<T>(abstract: TypedToken<T>, factory: ContainerFactory<unknown>): this;\n  bindFactory<T>(abstract: AbstractConstructor<T>, factory: ContainerFactory<NoInfer<T>>): this;",
   ["a factory must return the abstract"]),
  ('TM7b class factories unchecked', C, "  bindFactory<T>(abstract: TypedToken<T> | AbstractConstructor<T>, factory: ContainerFactory<NoInfer<T>>): this;",
   "  bindFactory<T>(abstract: TypedToken<T>, factory: ContainerFactory<NoInfer<T>>): this;\n  bindFactory<T>(abstract: AbstractConstructor<T>, factory: ContainerFactory<unknown>): this;",
   ["class abstract must return that class"]),
  ('TM9 Container.get loses the token type', C, "  get<T>(token: TypedToken<T>): Promise<T>;", "  get<T>(token: TypedToken<T>): Promise<any>;",
   ["token's resolved type"]),
  ('TM10 HasBindings.bind skips Injectable', H, "    concrete: C & Injectable<C>,", "    concrete: C,", ['HasBindings checks inject lists']),
  ('TM11 HasBindings.bind skips the abstract check', H, "    ...abstracts: A & BindableAbstracts<InstanceType<C>, A>", "    ...abstracts: A",
   ['HasBindings checks the concrete']),
  ('TM12 HasBindings.bindFactory unchecked', H, "  bindFactory<T>(abstract: TypedToken<T> | AbstractConstructor<T>, factory: ContainerFactory<NoInfer<T>>): this;",
   "  bindFactory<T>(abstract: TypedToken<T> | AbstractConstructor<T>, factory: ContainerFactory<unknown>): this;", ['HasBindings checks factory return']),
  ('TM13 InstanceProvider.get loses the token type', P, "  get<T>(abstract: TypedToken<T>): Promise<T>;", "  get<T>(abstract: TypedToken<T>): Promise<any>;",
   ['InstanceProvider keeps']),
  ('TM14 a class rebind factory is unchecked', C, "  rebind<T>(abstract: AbstractConstructor<T>, factory: ContainerFactory<NoInfer<T>>): void;",
   "  rebind<T>(abstract: AbstractConstructor<T>, factory: ContainerFactory<unknown>): void;", ["class rebind's factory"]),
]
