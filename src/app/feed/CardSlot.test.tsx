// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { deckCard, itemCard } from "../testUtils.tsx";
import { CardSlot, postToCard } from "./CardSlot.tsx";

afterEach(cleanup);

describe("CardSlot", () => {
    it("renders a placeholder when not mounted and an iframe with the card document when mounted", () => {
        const onFrame = vi.fn();
        const { container, rerender } = render(
            <CardSlot
                card={deckCard("a", { meta: { isNew: true } })}
                index={2}
                mounted={false}
                active={false}
                onFrame={onFrame}
            />,
        );
        expect(container.querySelector(".placeholder")?.textContent).toBe("3");
        expect(container.querySelector(".stream-tag")?.textContent).toBe("Nederlands · новое");
        expect(onFrame).not.toHaveBeenCalled();

        rerender(
            <CardSlot
                card={deckCard("a", { meta: { isNew: true } })}
                index={2}
                mounted
                active={false}
                onFrame={onFrame}
            />,
        );
        const frame = container.querySelector("iframe")!;
        expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
        expect(frame.getAttribute("srcdoc")).toContain('window.__cardId="nl:a"');
        expect(onFrame).toHaveBeenCalledWith("nl:a", frame);

        rerender(
            <CardSlot
                card={deckCard("a", { meta: { isNew: true } })}
                index={2}
                mounted={false}
                active={false}
                onFrame={onFrame}
            />,
        );
        expect(onFrame).toHaveBeenLastCalledWith("nl:a", null);
    });

    it("labels items by stream only and tolerates a missing frame when posting", () => {
        const { container, rerender } = render(
            <CardSlot card={itemCard("n")} index={0} mounted active onFrame={vi.fn()} />,
        );
        expect(container.querySelector(".stream-tag")?.textContent).toBe("Новости");
        rerender(<CardSlot card={{ ...itemCard("n"), stream: "weer" }} index={0} mounted active onFrame={vi.fn()} />);
        expect(container.querySelector(".stream-tag")?.textContent).toBe("weer");
        expect(() => {
            postToCard(null, { type: "active" });
        }).not.toThrow();
    });
});
