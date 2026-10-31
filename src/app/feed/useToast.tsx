import { useCallback, useEffect, useRef, useState } from "react";

export function useToast(ms = 1800) {
    const [text, setText] = useState<string | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const toast = useCallback(
        (t: string) => {
            setText(t);
            if (timer.current !== null) clearTimeout(timer.current);
            timer.current = setTimeout(() => {
                setText(null);
            }, ms);
        },
        [ms],
    );
    useEffect(
        () => () => {
            if (timer.current !== null) clearTimeout(timer.current);
        },
        [],
    );
    const Toast = useCallback(
        () => (
            <div className={`toast${text ? " show" : ""}`} role="status">
                {text ?? ""}
            </div>
        ),
        [text],
    );
    return { toast, Toast };
}
