// Minimal constructor-injection container: a class lists its dependencies as tokens,
// the container resolves them lazily and caches singletons.

export class Token<T> {
    declare public readonly _: T;
    public readonly id: string;

    public constructor(id: string) {
        this.id = id;
    }
}

export function token<T>(id: string): Token<T> {
    return new Token<T>(id);
}

type Resolve<Deps extends readonly Token<unknown>[]> = {
    [K in keyof Deps]: Deps[K] extends Token<infer T> ? T : never;
};

export interface Injectable<T, Deps extends readonly Token<unknown>[]> {
    readonly dependencies: Deps;
    new (...args: Resolve<Deps>): T;
}

interface InjectableClass {
    readonly dependencies: readonly Token<unknown>[];
    new (...args: unknown[]): unknown;
}

export type ContainerModule<Ctx = void> = (container: Container, ctx: Ctx) => void;

export class Container {
    private readonly factories = new Map<Token<unknown>, () => unknown>();
    private readonly cache = new Map<Token<unknown>, unknown>();
    private readonly resolving = new Set<Token<unknown>>();

    public bind<T, Deps extends readonly Token<unknown>[]>(tok: Token<T>, ctor: Injectable<T, Deps>): this;
    public bind<T>(tok: Token<T>, factory: () => T): this;
    public bind(tok: Token<unknown>, ctorOrFactory: InjectableClass | (() => unknown)): this {
        if ("dependencies" in ctorOrFactory) {
            const ctor = ctorOrFactory;
            this.factories.set(tok, () => new ctor(...ctor.dependencies.map((d) => this.get(d))));
        } else {
            this.factories.set(tok, ctorOrFactory);
        }
        return this;
    }

    public use<Ctx>(module: ContainerModule<Ctx>, ctx: Ctx): this;
    public use(module: ContainerModule): this;
    public use<Ctx>(module: ContainerModule<Ctx>, ctx?: Ctx): this {
        module(this, ctx as Ctx);
        return this;
    }

    public get<T>(tok: Token<T>): T {
        if (this.cache.has(tok)) return this.cache.get(tok) as T;
        if (this.resolving.has(tok)) {
            const chain = [...this.resolving].map((t) => t.id).join(" → ");
            throw new Error(`Circular dependency: ${chain} → ${tok.id}`);
        }
        const factory = this.factories.get(tok);
        if (!factory) throw new Error(`No binding for "${tok.id}"`);
        this.resolving.add(tok);
        try {
            const value = factory() as T;
            this.cache.set(tok, value);
            return value;
        } finally {
            this.resolving.delete(tok);
        }
    }
}
