// One screen of the feed. Mounted slots hold an iframe with the card; others are light placeholders.
import { memo, useEffect, useRef } from "react";

import type { FeedCard } from "../../shared/types.ts";
import { CARD_PROTOCOL, cardDocument, type ShellMessage } from "./cardFrame.ts";
import { STREAM_TITLES } from "./format.ts";

export interface CardSlotProps {
    card: FeedCard;
    index: number;
    mounted: boolean;
    active: boolean;
    onFrame: (cardId: string, frame: HTMLIFrameElement | null) => void;
}

export function postToCard(frame: HTMLIFrameElement | null, msg: ShellMessage): void {
    frame?.contentWindow?.postMessage({ mijnfeed: CARD_PROTOCOL, ...msg }, "*");
}

export const CardSlot = memo(function CardSlot({ card, index, mounted, active, onFrame }: CardSlotProps) {
    const ref = useRef<HTMLIFrameElement>(null);

    useEffect(() => {
        if (!mounted) return;
        const frame = ref.current;
        onFrame(card.id, frame);
        return () => {
            onFrame(card.id, null);
        };
    }, [mounted, card.id, onFrame]);

    useEffect(() => {
        if (!mounted) return;
        postToCard(ref.current, { type: active ? "active" : "inactive" });
    }, [active, mounted]);

    const title = STREAM_TITLES[card.stream] ?? card.stream;
    return (
        <section className="slot" data-index={index} aria-label={`Карточка ${index + 1}`}>
            <div className="stream-tag">
                <b>{title}</b>
                {card.meta.isNew === true ? " · новое" : ""}
            </div>
            {mounted ? (
                <iframe
                    ref={ref}
                    title={`${title} ${index + 1}`}
                    sandbox="allow-scripts"
                    srcDoc={cardDocument(card)}
                    loading="eager"
                    onLoad={() => {
                        postToCard(ref.current, { type: active ? "active" : "inactive" });
                    }}
                />
            ) : (
                <div className="placeholder" aria-hidden="true">
                    {index + 1}
                </div>
            )}
        </section>
    );
});
