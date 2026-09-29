import type { LessonStep } from './models';

export const PRACTICE_STORAGE_KEY = 'sologsb-1012-sign-course-practice-v1';

/** 每个步骤最多保留的已结束练习记录数 */
export const FINISHED_SESSION_LIMIT = 5;

export type CheckpointVerdict = 'pass' | 'reinforce';

export interface CheckpointMark {
  /** 检查点时间（秒），开始练习时从步骤快照复制，之后不再随步骤变化 */
  cue: number;
  /** 通过 / 待加强；未标记时为 undefined */
  verdict?: CheckpointVerdict;
  /** 当堂提示（一句话） */
  hint: string;
}

export interface PracticeSession {
  id: string;
  stepId: string;
  moduleId: string;
  startedAt: string;
  endedAt?: string;
  /** 开始练习时的步骤时长，用于回看记录时还原时间线语境 */
  duration: number;
  checkpoints: CheckpointMark[];
}

export interface PracticeStore {
  /** key 为步骤 id；数组首位是未结束记录（若有），其后按结束时间倒序排列 */
  sessionsByStep: Record<string, PracticeSession[]>;
}

export function emptyPracticeStore(): PracticeStore {
  return { sessionsByStep: {} };
}

export function loadPracticeStore(): PracticeStore {
  try {
    const raw = localStorage.getItem(PRACTICE_STORAGE_KEY);
    if (!raw) return emptyPracticeStore();
    const parsed = JSON.parse(raw) as Partial<PracticeStore>;
    if (!parsed || typeof parsed !== 'object' || !parsed.sessionsByStep || typeof parsed.sessionsByStep !== 'object') {
      return emptyPracticeStore();
    }
    return { sessionsByStep: parsed.sessionsByStep as PracticeStore['sessionsByStep'] };
  } catch {
    return emptyPracticeStore();
  }
}

export function getActiveSession(store: PracticeStore, stepId: string): PracticeSession | undefined {
  return store.sessionsByStep[stepId]?.find((session) => !session.endedAt);
}

export function getFinishedSessions(store: PracticeStore, stepId: string): PracticeSession[] {
  return (store.sessionsByStep[stepId] ?? []).filter((session) => Boolean(session.endedAt));
}

/** 开始一次练习；同一步骤已有未结束记录时保持原记录，不另开新记录 */
export function startPractice(
  store: PracticeStore,
  moduleId: string,
  step: LessonStep,
  nowIso: string,
): PracticeStore {
  const sessions = store.sessionsByStep[step.id] ?? [];
  if (sessions.some((session) => !session.endedAt)) return store;
  const session: PracticeSession = {
    id: `practice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    stepId: step.id,
    moduleId,
    startedAt: nowIso,
    duration: step.duration,
    checkpoints: step.cuePoints.map((cue) => ({ cue, hint: '' })),
  };
  return {
    sessionsByStep: { ...store.sessionsByStep, [step.id]: [session, ...sessions] },
  };
}

function mapActive(
  store: PracticeStore,
  stepId: string,
  update: (session: PracticeSession) => PracticeSession,
): PracticeStore {
  const sessions = store.sessionsByStep[stepId];
  if (!sessions) return store;
  let touched = false;
  const nextSessions = sessions.map((session) => {
    if (session.endedAt) return session;
    touched = true;
    return update(session);
  });
  if (!touched) return store;
  return { sessionsByStep: { ...store.sessionsByStep, [stepId]: nextSessions } };
}

/** 记录检查点结果，重复标记以最后一次为准；再次点击当前结果可取消 */
export function setCheckpointVerdict(
  store: PracticeStore,
  stepId: string,
  index: number,
  verdict: CheckpointVerdict,
): PracticeStore {
  return mapActive(store, stepId, (session) => {
    const current = session.checkpoints[index];
    if (!current) return session;
    const checkpoints = session.checkpoints.map((mark, i) =>
      i === index ? { ...mark, verdict: mark.verdict === verdict ? undefined : verdict } : mark,
    );
    return { ...session, checkpoints };
  });
}

/** 写入某检查点的当堂提示，重复输入以最后一次为准 */
export function setCheckpointHint(
  store: PracticeStore,
  stepId: string,
  index: number,
  hint: string,
): PracticeStore {
  return mapActive(store, stepId, (session) => {
    if (!session.checkpoints[index]) return session;
    const checkpoints = session.checkpoints.map((mark, i) => (i === index ? { ...mark, hint } : mark));
    return { ...session, checkpoints };
  });
}

/**
 * 结束当前步骤的未结束记录，写入结束时间并放入历史；
 * 历史只保留最近 FINISHED_SESSION_LIMIT 次。返回结束后的记录供界面提示。
 */
export function finalizeActive(
  store: PracticeStore,
  stepId: string,
  nowIso: string,
): { store: PracticeStore; session?: PracticeSession } {
  const sessions = store.sessionsByStep[stepId];
  if (!sessions) return { store };
  const activeIndex = sessions.findIndex((session) => !session.endedAt);
  if (activeIndex < 0) return { store };
  const ended: PracticeSession = { ...sessions[activeIndex], endedAt: nowIso };
  const restFinished = sessions.filter((session) => session.endedAt);
  const finished = [ended, ...restFinished].slice(0, FINISHED_SESSION_LIMIT);
  return {
    store: { sessionsByStep: { ...store.sessionsByStep, [stepId]: finished } },
    session: ended,
  };
}

/** 删除步骤时清掉它的全部练习记录 */
export function removeStepRecords(store: PracticeStore, stepId: string): PracticeStore {
  if (!store.sessionsByStep[stepId]) return store;
  const sessionsByStep = { ...store.sessionsByStep };
  delete sessionsByStep[stepId];
  return { sessionsByStep };
}

export interface PracticeSummary {
  pass: number;
  reinforce: number;
  pending: number;
  total: number;
}

export function summarizeSession(session: PracticeSession): PracticeSummary {
  const summary: PracticeSummary = { pass: 0, reinforce: 0, pending: 0, total: session.checkpoints.length };
  for (const mark of session.checkpoints) {
    if (mark.verdict === 'pass') summary.pass += 1;
    else if (mark.verdict === 'reinforce') summary.reinforce += 1;
    else summary.pending += 1;
  }
  return summary;
}
