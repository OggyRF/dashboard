import type { TaskCategory, TaskPriority, TaskStatus } from "@/generated/prisma/enums";

// Shared with forms in the browser, so kept apart from the task service.
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  QA: "In QA",
  APPROVED: "Approved",
  COMPLETED: "Completed",
  BLOCKED: "Blocked",
};
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", URGENT: "Urgent" };
export const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  TECHNICAL: "Technical SEO",
  ON_PAGE: "On-page",
  CONTENT: "Content",
  OFF_PAGE: "Off-page",
  GMB: "GMB",
  REPORTING: "Reporting",
  OTHER: "Other",
};
