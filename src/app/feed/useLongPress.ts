import { useCallback, useRef } from "react";

/** Pointer handlers: a short tap calls onTap, holding for `ms` calls onLong (and suppresses the tap). */
export function useLongPress(onTap: () => void, onLong: () => void, ms = 450) {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fired = useRef(false);

    const clear = useCallback(() => {
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = null;
    }, []);

    const onPointerDown = useCallback(() => {
        fired.current = false;
        clear();
        timer.current = setTimeout(() => {
            fired.current = true;
            onLong();
        }, ms);
    }, [clear, onLong, ms]);

    const onPointerUp = useCallback(() => {
        clear();
        if (!fired.current) onTap();
        fired.current = false;
    }, [clear, onTap]);

    const onPointerLeave = useCallback(() => {
        clear();
        fired.current = false;
    }, [clear]);

    return {
        onPointerDown,
        onPointerUp,
        onPointerLeave,
        onPointerCancel: onPointerLeave,
        onContextMenu: (e: { preventDefault: () => void }) => {
            e.preventDefault();
        },
    };
}
