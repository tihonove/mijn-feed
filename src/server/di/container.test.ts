import { describe, expect, it } from "vitest";

import { Container, token } from "./container.ts";

const A = token<{ a: number }>("A");
const B = token<{ a: number; b: string }>("B");

class BImpl {
    public static readonly dependencies = [A] as const;
    public readonly b = "b";
    public constructor(private readonly dep: { a: number }) {}
    public get a(): number {
        return this.dep.a;
    }
}

describe("Container", () => {
    it("resolves constructor dependencies by token and caches singletons", () => {
        const c = new Container().bind(A, () => ({ a: 1 })).bind(B, BImpl);
        const b = c.get(B);
        expect(b.a).toBe(1);
        expect(b.b).toBe("b");
        expect(c.get(B)).toBe(b);
    });

    it("applies modules with and without context", () => {
        const c = new Container();
        c.use((container, ctx: { value: number }) => container.bind(A, () => ({ a: ctx.value })), { value: 7 });
        c.use((container) => container.bind(B, BImpl));
        expect(c.get(B).a).toBe(7);
    });

    it("reports a missing binding and a circular dependency", () => {
        expect(() => new Container().get(A)).toThrow(/No binding for "A"/);
        const c = new Container();
        c.bind(A, () => c.get(B)).bind(B, BImpl);
        expect(() => c.get(A)).toThrow(/Circular dependency: A → B → A/);
    });
});
