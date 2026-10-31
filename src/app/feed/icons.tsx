const PATHS: Record<string, string> = {
    sound: "M11 5 6 9H3v6h3l5 4z M15.5 8.5a5 5 0 0 1 0 7 M18.5 5.5a9 9 0 0 1 0 13",
    muted: "M11 5 6 9H3v6h3l5 4z M22 9l-6 6 M16 9l6 6",
    replay: "M3 12a9 9 0 1 0 3-6.7 M3 4v5h5",
    check: "M5 12.5l4.5 4.5L19 7.5",
    cross: "M6 6l12 12 M18 6L6 18",
    down: "M12 5v14 M5 12l7 7 7-7",
    yawn: "M4 12h16 M8 7h.01 M16 7h.01 M9 17c1-1 5-1 6 0",
    heart: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z",
    chart: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
    sliders: "M4 6h10 M18 6h2 M4 12h4 M12 12h8 M4 18h12 M20 18h0 M14 4v4 M8 10v4 M16 16v4",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0",
    play: "M8 5v14l11-7z",
};

export function Icon({ name }: { name: keyof typeof PATHS }) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d={PATHS[name]} />
        </svg>
    );
}
