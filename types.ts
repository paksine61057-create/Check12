
export type Choice = 'ก' | 'ข' | 'ค' | 'ง' | null | 'multiple';

export interface QuestionResult {
  questionNo: number;
  studentAnswer: Choice;
  isCorrect: boolean;
  correctAnswer: Choice;
}

export interface StudentResult {
  id: string;
  studentNumber: string;
  studentName: string;
  answers: QuestionResult[];
  totalScore: number;
  hasError: boolean;
  errorMessage?: string;
}

export interface Subject {
  id: string;
  name: string;
  totalQuestions: number;
  answerKey: Choice[];
  results: StudentResult[];
  createdAt: number;
}

export enum AppStep {
  SUBJECT_LIST = 'SUBJECT_LIST',
  SETUP_SUBJECT = 'SETUP_SUBJECT',
  CALIBRATE_KEY = 'CALIBRATE_KEY',
  SCAN_STUDENTS = 'SCAN_STUDENTS',
  VIEW_RESULTS = 'VIEW_RESULTS'
}
