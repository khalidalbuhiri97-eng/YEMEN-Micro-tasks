import type { SurveyQuestion } from '../src/types/index.js';

/**
 * Resolves the active path of questions visited based on answers & conditional branching rules.
 * Supports:
 *  - option.nextQuestionId (jump to specific question or 'END')
 *  - question.branchRules (matching answerValue/optionId/optionText -> jump to nextQuestionId or 'END')
 */
export function resolveSurveyNextQuestionIndex(
  questions: SurveyQuestion[],
  currentIndex: number,
  answers: Record<string, any>
): number | 'REVIEW' {
  if (!questions || questions.length === 0) return 'REVIEW';
  const current = questions[currentIndex];
  if (!current) return 'REVIEW';

  const answer = answers[current.id];

  // 1. Check option-level nextQuestionId (for single_choice / yes_no)
  if (typeof answer === 'string' && answer.trim()) {
    const matchedOpt = (current.options || []).find(
      (o) => o.id === answer || o.optionText === answer
    );
    if (matchedOpt?.nextQuestionId) {
      if (matchedOpt.nextQuestionId === 'END') return 'REVIEW';
      const targetIdx = questions.findIndex((q) => q.id === matchedOpt.nextQuestionId);
      if (targetIdx > currentIndex) return targetIdx;
    }
  }

  // 2. Check question-level branchRules
  const rules = Array.isArray(current.branchRules) ? current.branchRules : [];
  for (const rule of rules) {
    const matches =
      (rule.optionId && answer === rule.optionId) ||
      (rule.optionText && (answer === rule.optionText || (Array.isArray(answer) && answer.includes(rule.optionText)))) ||
      (rule.answerValue !== undefined &&
        (String(answer ?? '') === String(rule.answerValue) ||
          (Array.isArray(answer) && answer.includes(rule.answerValue))));

    if (matches) {
      if (rule.action === 'end' || rule.nextQuestionId === 'END') {
        return 'REVIEW';
      }
      if (rule.nextQuestionId) {
        const targetIdx = questions.findIndex((q) => q.id === rule.nextQuestionId);
        if (targetIdx > currentIndex) return targetIdx;
      }
    }
  }

  // 3. Default sequential progression
  const next = currentIndex + 1;
  return next < questions.length ? next : 'REVIEW';
}

export function isSurveyQuestionAnswered(question: SurveyQuestion, answer: any): boolean {
  if (answer === null || answer === undefined) return false;
  switch (question.questionType) {
    case 'multiple_choice':
      return Array.isArray(answer) && answer.length > 0;
    case 'rating_1_5': {
      const n = Number(answer);
      return Number.isFinite(n) && n >= 1 && n <= 5;
    }
    case 'single_choice':
    case 'yes_no':
    case 'short_text':
    case 'long_text':
    default:
      return String(answer).trim().length > 0;
  }
}

/**
 * Walks the survey from index 0 with the given answers to return the exact ordered
 * list of visible questions along the active branch and validate required questions.
 */
export function evaluateSurveyPath(
  questions: SurveyQuestion[],
  answers: Record<string, any>
): {
  visitedQuestions: SurveyQuestion[];
  missingRequiredQuestions: SurveyQuestion[];
} {
  const ordered = [...(questions || [])].sort((a, b) => a.orderIndex - b.orderIndex);
  const visitedQuestions: SurveyQuestion[] = [];
  const missingRequiredQuestions: SurveyQuestion[] = [];
  const seen = new Set<number>();

  let idx: number | 'REVIEW' = ordered.length > 0 ? 0 : 'REVIEW';
  while (idx !== 'REVIEW' && !seen.has(idx) && idx >= 0 && idx < ordered.length) {
    seen.add(idx);
    const q = ordered[idx];
    visitedQuestions.push(q);
    if (q.isRequired && !isSurveyQuestionAnswered(q, answers[q.id])) {
      missingRequiredQuestions.push(q);
    }
    idx = resolveSurveyNextQuestionIndex(ordered, idx, answers);
  }

  return { visitedQuestions, missingRequiredQuestions };
}
