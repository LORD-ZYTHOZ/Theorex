// a2a/index.ts — Public re-exports for the A2A task protocol module.
export {
  createTask,
  updateTaskStatus,
  saveTask,
  loadTask,
  listPendingTasks,
} from "./tasks";
export type { A2ATask, A2ATaskStatus } from "./tasks";
