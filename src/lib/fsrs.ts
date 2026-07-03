// FSRS (Free Spaced Repetition Scheduler) 算法实现
// 基于 FSRS-4.5 规范

import type { Card as DbCard } from "./db";

export type Rating = 1 | 2 | 3 | 4; // Again | Hard | Good | Easy
export type State = "new" | "learning" | "review" | "relearning";

export type Card = DbCard;

export interface ReviewLog {
  id: number;
  card_id: number;
  rating: Rating;
  state: State;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  review_time: string;
}

export interface SchedulingInfo {
  card: Card;
  review_log: Omit<ReviewLog, "id" | "review_time">;
}

// FSRS 默认参数 (优化后的通用参数)
const w = [
  0.4072, 1.1829, 3.1262, 15.4722, 7.2102,
  0.5316, 1.0651, 0.0234, 1.616, 0.1544,
  1.0824, 1.9813, 0.0953, 0.2975, 2.2042,
  0.2407, 2.9466, 0.5034, 0.6567,
];

const DECAY = -0.5;
const FACTOR = 0.9 ** (1 / DECAY) - 1;

function constrain_difficulty(difficulty: number): number {
  return Math.min(Math.max(difficulty, 1), 10);
}

function mean_reversion(init: number, current: number): number {
  return w[7] * init + (1 - w[7]) * current;
}

function init_difficulty(rating: Rating): number {
  return constrain_difficulty(w[4] - w[5] * (rating - 3));
}

function next_difficulty(d: number, rating: Rating): number {
  const next_d = d - w[6] * (rating - 3);
  return constrain_difficulty(mean_reversion(init_difficulty(4), next_d));
}

function init_stability(rating: Rating): number {
  return Math.max(w[rating - 1], 0.1);
}

function next_recall_stability(
  d: number,
  s: number,
  r: number,
  rating: Rating
): number {
  const hard_penalty = rating === 2 ? w[15] : 1;
  const easy_bonus = rating === 4 ? w[16] : 1;
  return s * (
    1 +
    Math.exp(w[8]) *
      (11 - d) *
      Math.pow(s, -w[9]) *
      (Math.exp((1 - r) * w[10]) - 1) *
      hard_penalty *
      easy_bonus
  );
}

function next_forget_stability(d: number, s: number, r: number): number {
  return (
    w[11] *
    Math.pow(d, -w[12]) *
    (Math.pow(s + 1, w[13]) - 1) *
    Math.exp((1 - r) * w[14])
  );
}

function next_short_term_stability(s: number, rating: Rating): number {
  return s * Math.exp(w[17] * (rating - 3 + w[18]));
}

function next_interval(s: number, desired_retention = 0.9): number {
  const interval = (s / FACTOR) * (Math.pow(desired_retention, 1 / DECAY) - 1);
  return Math.max(1, Math.round(interval));
}

function current_retrievability(elapsed_days: number, stability: number): number {
  return Math.pow(1 + (FACTOR * elapsed_days) / stability, DECAY);
}

export function schedule(card: Card, now: Date, rating: Rating): SchedulingInfo {
  const elapsed_days =
    card.state === "new"
      ? 0
      : Math.max(0, Math.floor((now.getTime() - new Date(card.due).getTime()) / 86400000));

  let scheduled_days = 0;
  let difficulty = card.difficulty;
  let stability = card.stability;
  let state = card.state;
  let new_lapses = card.lapses;
  let new_reps = card.reps;

  const retrievability = current_retrievability(elapsed_days, stability);

  if (card.state === "new") {
    // 新卡片
    difficulty = init_difficulty(rating);
    stability = init_stability(rating);
    if (rating === 1) {
      scheduled_days = 0;
      state = "learning";
    } else if (rating === 2) {
      scheduled_days = 0;
      state = "learning";
      stability = next_short_term_stability(stability, rating);
    } else if (rating === 3) {
      scheduled_days = next_interval(stability);
      state = "review";
    } else {
      scheduled_days = next_interval(stability);
      state = "review";
      stability = next_short_term_stability(stability, rating);
    }
    new_reps = 1;
  } else if (card.state === "learning" || card.state === "relearning") {
    if (rating === 1) {
      stability = next_short_term_stability(stability, rating);
      scheduled_days = 0;
      state = card.state;
    } else if (rating === 2) {
      stability = next_short_term_stability(stability, rating);
      scheduled_days = 0;
      state = card.state;
    } else if (rating === 3) {
      stability = next_short_term_stability(stability, rating);
      scheduled_days = next_interval(stability);
      state = "review";
    } else {
      stability = next_short_term_stability(stability, rating);
      scheduled_days = next_interval(stability);
      state = "review";
    }
    new_reps += 1;
  } else if (card.state === "review") {
    if (rating === 1) {
      stability = next_forget_stability(difficulty, stability, retrievability);
      difficulty = next_difficulty(difficulty, rating);
      scheduled_days = 0;
      state = "relearning";
      new_lapses += 1;
    } else {
      stability = next_recall_stability(difficulty, stability, retrievability, rating);
      difficulty = next_difficulty(difficulty, rating);
      scheduled_days = next_interval(stability);
      state = "review";
    }
    new_reps += 1;
  }

  const due = new Date(now.getTime() + scheduled_days * 86400000);

  const updated_card: Card = {
    ...card,
    state,
    due: due.toISOString(),
    stability,
    difficulty,
    elapsed_days,
    scheduled_days,
    reps: new_reps,
    lapses: new_lapses,
    last_review: now.toISOString(),
  };

  const review_log: Omit<ReviewLog, "id" | "review_time"> = {
    card_id: card.id,
    rating,
    state: card.state as State,
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days,
    scheduled_days,
  };

  return { card: updated_card, review_log };
}

export function createNewCard(step_id: number): Omit<Card, "id" | "created_at"> {
  return {
    step_id,
    state: "new" as State,
    due: new Date().toISOString(),
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    last_review: null,
  };
}
