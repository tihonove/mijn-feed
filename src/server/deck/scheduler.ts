// FSRS behind one seam, so the algorithm can change without touching the deck.
import { type Card, createEmptyCard, fsrs, type Grade as FsrsGrade, Rating, type ReviewLog, State } from "ts-fsrs";

import type { FacetState, Grade, Settings } from "../../shared/types.ts";
import { token } from "../di/container.ts";

export type { Card, ReviewLog };

export const GRADE_TO_RATING: Record<Grade, FsrsGrade> = {
    again: Rating.Again,
    hard: Rating.Hard,
    good: Rating.Good,
    easy: Rating.Easy,
};

export const GRADES = Object.keys(GRADE_TO_RATING) as Grade[];

export const STATE_NAMES: Record<number, FacetState> = {
    [State.New]: "new",
    [State.Learning]: "learning",
    [State.Review]: "review",
    [State.Relearning]: "relearning",
};

export interface SchedulerParams {
    requestRetention: number;
    maximumInterval: number;
    learningSteps: string[];
    relearningSteps: string[];
}

export interface IScheduler {
    emptyCard(now: number): Card;
    /** Applies a grade at `now`; returns the updated card and the review log entry. */
    next(card: Card, now: number, grade: Grade, params: SchedulerParams): { card: Card; log: ReviewLog };
    /** What each grade would schedule, without applying it. */
    preview(card: Card, now: number, params: SchedulerParams): Record<Grade, number>;
}

export const SchedulerDIToken = token<IScheduler>("Scheduler");

export class FsrsScheduler implements IScheduler {
    public static readonly dependencies = [] as const;

    public constructor(private readonly enableFuzz = true) {}

    public emptyCard(now: number): Card {
        return createEmptyCard(new Date(now));
    }

    public next(card: Card, now: number, grade: Grade, params: SchedulerParams): { card: Card; log: ReviewLog } {
        const result = this.instance(params).next(card, new Date(now), GRADE_TO_RATING[grade]);
        return { card: result.card, log: result.log };
    }

    public preview(card: Card, now: number, params: SchedulerParams): Record<Grade, number> {
        const record = this.instance(params).repeat(card, new Date(now));
        const out = {} as Record<Grade, number>;
        for (const grade of GRADES) out[grade] = record[GRADE_TO_RATING[grade]].card.due.getTime();
        return out;
    }

    private instance(params: SchedulerParams) {
        return fsrs({
            request_retention: params.requestRetention,
            maximum_interval: params.maximumInterval,
            learning_steps: params.learningSteps as `${number}m`[],
            relearning_steps: params.relearningSteps as `${number}m`[],
            enable_fuzz: this.enableFuzz,
            enable_short_term: true,
        });
    }
}

export const schedulerParams = (deck: Settings["deck"]): SchedulerParams => ({
    requestRetention: deck.requestRetention,
    maximumInterval: deck.maximumInterval,
    learningSteps: deck.learningSteps,
    relearningSteps: deck.relearningSteps,
});

/** Cards round-trip through JSON; dates come back as strings. */
export function reviveCard(raw: unknown): Card {
    const c = raw as Card & { due: string | Date; last_review?: string | Date };
    return {
        ...c,
        due: new Date(c.due),
        last_review: c.last_review === undefined ? undefined : new Date(c.last_review),
    };
}
